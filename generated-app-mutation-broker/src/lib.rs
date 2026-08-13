#![cfg(target_os = "linux")]

use rustix::fd::{AsFd, BorrowedFd, OwnedFd};
use rustix::fs::{
    self, AtFlags, Dir, Mode, OFlags, RenameFlags, ResolveFlags, Stat, Timespec, Timestamps,
    UTIME_OMIT,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::CString;
use std::fs::File;
use std::io::{self, Read, Write};

const VERSION: u8 = 1;
const OP_LIST: u8 = 1;
const OP_READ: u8 = 2;
const OP_REPLACE: u8 = 3;
const STATUS_OK: u8 = 0;
const STATUS_ERROR: u8 = 1;
const FLAG_VERIFIED_PRIVATE_FALLBACK: u8 = 1;
const MAX_FRAME: usize = 16 * 1024 * 1024 + 64 * 1024;
const MAX_FILE: usize = 16 * 1024 * 1024;
const MAX_COMPONENTS: usize = 128;
const MAX_COMPONENT: usize = 255;
const MAX_PATH: usize = 4096;
const MAX_LIST_ENTRIES: usize = 8192;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
enum ErrorCode {
    Protocol = 1,
    InvalidPath = 2,
    Unsupported = 3,
    Integrity = 4,
    NotFound = 5,
    WrongType = 6,
    Io = 7,
    Bounds = 8,
}

#[derive(Debug)]
struct BrokerError {
    code: ErrorCode,
    message: &'static str,
}

type Result<T> = std::result::Result<T, BrokerError>;

impl BrokerError {
    const fn new(code: ErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }

    fn io(error: rustix::io::Errno) -> Self {
        match error {
            rustix::io::Errno::NOENT => Self::new(ErrorCode::NotFound, "entry not found"),
            rustix::io::Errno::LOOP | rustix::io::Errno::AGAIN => {
                Self::new(ErrorCode::Integrity, "symbolic link rejected")
            }
            rustix::io::Errno::XDEV => Self::new(ErrorCode::Integrity, "mount boundary rejected"),
            _ => Self::new(ErrorCode::Io, "filesystem operation failed"),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Metadata {
    dev: u64,
    ino: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    size: u64,
    mtime_sec: i64,
    mtime_nsec: u64,
}

impl Metadata {
    fn from_stat(stat: &Stat) -> Result<Self> {
        let size = u64::try_from(stat.st_size)
            .map_err(|_| BrokerError::new(ErrorCode::Integrity, "negative file size"))?;
        Ok(Self {
            dev: stat.st_dev,
            ino: stat.st_ino,
            mode: stat.st_mode,
            uid: stat.st_uid,
            gid: stat.st_gid,
            size,
            mtime_sec: stat.st_mtime,
            mtime_nsec: stat.st_mtime_nsec,
        })
    }

    fn encode(&self, output: &mut Vec<u8>) {
        output.extend_from_slice(&self.dev.to_be_bytes());
        output.extend_from_slice(&self.ino.to_be_bytes());
        output.extend_from_slice(&self.mode.to_be_bytes());
        output.extend_from_slice(&self.uid.to_be_bytes());
        output.extend_from_slice(&self.gid.to_be_bytes());
        output.extend_from_slice(&self.size.to_be_bytes());
        output.extend_from_slice(&self.mtime_sec.to_be_bytes());
        output.extend_from_slice(&self.mtime_nsec.to_be_bytes());
    }
}

#[derive(Clone)]
struct ReadToken {
    path: Vec<Vec<u8>>,
    metadata: Metadata,
    digest: [u8; 32],
}

struct Broker<'fd> {
    root: BorrowedFd<'fd>,
    root_dev: u64,
    root_ino: u64,
    root_uid: u32,
    tokens: HashMap<[u8; 16], ReadToken>,
}

/// Serve framed broker requests until clean EOF or the first rejected request.
///
/// Every failure writes one bounded error response and poisons the session by
/// returning immediately. The caller must reject the whole build candidate.
pub fn serve<R: Read, W: Write>(
    root: BorrowedFd<'_>,
    mut input: R,
    mut output: W,
) -> io::Result<()> {
    let root_stat = fs::fstat(root).map_err(io::Error::from)?;
    let is_directory = root_stat.st_mode & libc::S_IFMT == libc::S_IFDIR;
    // SAFETY: geteuid has no preconditions and does not access memory.
    let effective_uid = unsafe { libc::geteuid() };
    if !is_directory || root_stat.st_uid != effective_uid || root_stat.st_mode & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "fd 3 is not an owned private directory",
        ));
    }

    let mut broker = Broker {
        root,
        root_dev: root_stat.st_dev,
        root_ino: root_stat.st_ino,
        root_uid: root_stat.st_uid,
        tokens: HashMap::new(),
    };
    loop {
        let Some(frame) = read_frame(&mut input)? else {
            return Ok(());
        };
        let opcode = frame.get(1).copied().unwrap_or(0);
        match broker.handle(&frame) {
            Ok(response) => write_frame(&mut output, &response)?,
            Err(error) => {
                write_frame(&mut output, &error_response(opcode, &error))?;
                output.flush()?;
                return Err(io::Error::other("broker request rejected"));
            }
        }
        output.flush()?;
    }
}

fn read_frame(input: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut length = [0_u8; 4];
    let mut read = 0;
    while read < length.len() {
        match input.read(&mut length[read..])? {
            0 if read == 0 => return Ok(None),
            0 => {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "partial frame length",
                ))
            }
            count => read += count,
        }
    }
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "frame length out of bounds",
        ));
    }
    let mut frame = vec![0_u8; length];
    input.read_exact(&mut frame)?;
    Ok(Some(frame))
}

fn write_frame(output: &mut impl Write, payload: &[u8]) -> io::Result<()> {
    let length = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "response too large"))?;
    output.write_all(&length.to_be_bytes())?;
    output.write_all(payload)
}

impl Broker<'_> {
    fn handle(&mut self, frame: &[u8]) -> Result<Vec<u8>> {
        self.verify_root()?;
        let mut request = Decoder::new(frame);
        let version = request.u8()?;
        let opcode = request.u8()?;
        let flags = request.u8()?;
        let reserved = request.u8()?;
        if version != VERSION || reserved != 0 || flags & !FLAG_VERIFIED_PRIVATE_FALLBACK != 0 {
            return Err(BrokerError::new(
                ErrorCode::Protocol,
                "invalid request header",
            ));
        }
        let allow_fallback = flags & FLAG_VERIFIED_PRIVATE_FALLBACK != 0;
        let allow_empty = opcode == OP_LIST;
        let path = request.path(allow_empty)?;
        let response = match opcode {
            OP_LIST => {
                request.end()?;
                self.list(&path, allow_fallback)?
            }
            OP_READ => {
                request.end()?;
                self.read(&path, allow_fallback)?
            }
            OP_REPLACE => {
                let operation_id = request.array_16()?;
                let replacement = request.bytes_u32(MAX_FILE)?.to_vec();
                request.end()?;
                self.replace(&path, allow_fallback, operation_id, &replacement)?
            }
            _ => return Err(BrokerError::new(ErrorCode::Protocol, "unknown operation")),
        };
        self.verify_root()?;
        Ok(response)
    }

    fn list(&self, path: &[Vec<u8>], allow_fallback: bool) -> Result<Vec<u8>> {
        let directory = match self.open_directory(path, allow_fallback) {
            Ok(directory) => directory,
            Err(error) if error.code == ErrorCode::NotFound => {
                let mut response = ok_header(OP_LIST);
                response.extend_from_slice(&0_u32.to_be_bytes());
                return Ok(response);
            }
            Err(error) => return Err(error),
        };
        let mut entries = Vec::new();
        let mut iterator = Dir::new(directory).map_err(BrokerError::io)?;
        while let Some(entry) = iterator.read() {
            let entry = entry.map_err(BrokerError::io)?;
            let name = entry.file_name().to_bytes();
            if name == b"." || name == b".." {
                continue;
            }
            if entries.len() == MAX_LIST_ENTRIES {
                return Err(BrokerError::new(
                    ErrorCode::Bounds,
                    "directory entry limit exceeded",
                ));
            }
            let stat = fs::statat(
                iterator.fd().map_err(BrokerError::io)?,
                entry.file_name(),
                AtFlags::SYMLINK_NOFOLLOW,
            )
            .map_err(BrokerError::io)?;
            entries.push((name.to_vec(), Metadata::from_stat(&stat)?));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0));

        let mut response = ok_header(OP_LIST);
        response.extend_from_slice(&(entries.len() as u32).to_be_bytes());
        for (name, metadata) in entries {
            response.extend_from_slice(&(name.len() as u16).to_be_bytes());
            response.extend_from_slice(&name);
            metadata.encode(&mut response);
        }
        Ok(response)
    }

    fn read(&mut self, path: &[Vec<u8>], allow_fallback: bool) -> Result<Vec<u8>> {
        let (metadata, bytes, digest) = self.read_regular(path, allow_fallback)?;
        let mut operation_id = [0_u8; 16];
        getrandom::fill(&mut operation_id)
            .map_err(|_| BrokerError::new(ErrorCode::Io, "operation id generation failed"))?;
        while self.tokens.contains_key(&operation_id) {
            getrandom::fill(&mut operation_id)
                .map_err(|_| BrokerError::new(ErrorCode::Io, "operation id generation failed"))?;
        }
        self.tokens.insert(
            operation_id,
            ReadToken {
                path: path.to_vec(),
                metadata: metadata.clone(),
                digest,
            },
        );

        let mut response = ok_header(OP_READ);
        response.extend_from_slice(&operation_id);
        metadata.encode(&mut response);
        response.extend_from_slice(&digest);
        response.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        response.extend_from_slice(&bytes);
        Ok(response)
    }

    fn replace(
        &mut self,
        path: &[Vec<u8>],
        allow_fallback: bool,
        operation_id: [u8; 16],
        replacement: &[u8],
    ) -> Result<Vec<u8>> {
        let token = self.tokens.get(&operation_id).cloned().ok_or_else(|| {
            BrokerError::new(ErrorCode::Integrity, "unknown or consumed read token")
        })?;
        if token.path != path {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "read token path mismatch",
            ));
        }

        let (current_metadata, _, current_digest) = self.read_regular(path, allow_fallback)?;
        if current_metadata != token.metadata || current_digest != token.digest {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "target changed after read",
            ));
        }
        if token.metadata.uid != current_euid() || token.metadata.gid != current_egid() {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "target ownership cannot be preserved",
            ));
        }

        let (parents, _) = path.split_at(path.len() - 1);
        let mut temporary_bytes = b".chatgpt-mutation-".to_vec();
        append_hex(&mut temporary_bytes, &operation_id);
        let mut temporary_path = parents.to_vec();
        temporary_path.push(temporary_bytes);
        let temporary_joined = joined_path(&temporary_path)?;
        let target_joined = joined_path(path)?;

        let temporary = self.create_temporary(&temporary_path, allow_fallback)?;
        let mut temporary_file = File::from(temporary);
        if let Err(error) = write_replacement(&mut temporary_file, replacement, &token.metadata) {
            let _ = fs::unlinkat(self.root, &temporary_joined, AtFlags::empty());
            return Err(error);
        }

        fs::renameat_with(
            self.root,
            &temporary_joined,
            self.root,
            &target_joined,
            RenameFlags::EXCHANGE,
        )
        .map_err(|error| {
            let _ = fs::unlinkat(self.root, &temporary_joined, AtFlags::empty());
            if matches!(
                error,
                rustix::io::Errno::NOSYS | rustix::io::Errno::INVAL | rustix::io::Errno::NOTSUP
            ) {
                BrokerError::new(ErrorCode::Unsupported, "atomic exchange is unsupported")
            } else {
                BrokerError::io(error)
            }
        })?;

        let (displaced_metadata, displaced_bytes, displaced_digest) = self
            .read_regular(&temporary_path, allow_fallback)
            .map_err(|_| BrokerError::new(ErrorCode::Integrity, "displaced target unavailable"))?;
        if displaced_metadata != token.metadata
            || displaced_digest != token.digest
            || displaced_bytes.len() as u64 != token.metadata.size
        {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "displaced target failed validation",
            ));
        }
        fs::unlinkat(self.root, &temporary_joined, AtFlags::empty()).map_err(BrokerError::io)?;
        let parent = self.open_directory(parents, allow_fallback)?;
        fs::fsync(&parent).map_err(BrokerError::io)?;
        self.tokens.remove(&operation_id);

        let mut response = ok_header(OP_REPLACE);
        response.extend_from_slice(&operation_id);
        Ok(response)
    }

    fn read_regular(
        &self,
        path: &[Vec<u8>],
        allow_fallback: bool,
    ) -> Result<(Metadata, Vec<u8>, [u8; 32])> {
        let probe = self.open_path(path, OFlags::PATH | OFlags::CLOEXEC, allow_fallback)?;
        let probe_metadata = require_regular_metadata(&probe)?;
        let descriptor = self.open_path(
            path,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            allow_fallback,
        )?;
        let (metadata, bytes, digest) = read_open_regular(descriptor)?;
        if metadata != probe_metadata {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "target changed while opening",
            ));
        }
        Ok((metadata, bytes, digest))
    }

    fn open_directory(&self, path: &[Vec<u8>], allow_fallback: bool) -> Result<OwnedFd> {
        if path.is_empty() {
            return rustix::io::dup(self.root).map_err(BrokerError::io);
        }
        self.open_path(
            path,
            OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            allow_fallback,
        )
    }

    fn open_path(&self, path: &[Vec<u8>], flags: OFlags, allow_fallback: bool) -> Result<OwnedFd> {
        let joined = joined_path(path)?;
        match fs::openat2(
            self.root,
            &joined,
            flags,
            Mode::empty(),
            confinement_flags(),
        ) {
            Ok(descriptor) => Ok(descriptor),
            Err(rustix::io::Errno::NOSYS | rustix::io::Errno::INVAL) => {
                if !allow_fallback {
                    return Err(BrokerError::new(
                        ErrorCode::Unsupported,
                        "openat2 is required",
                    ));
                }
                self.open_path_fallback(path, flags)
            }
            Err(error) => Err(BrokerError::io(error)),
        }
    }

    fn create_temporary(&self, path: &[Vec<u8>], allow_fallback: bool) -> Result<OwnedFd> {
        let joined = joined_path(path)?;
        let flags =
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC;
        match fs::openat2(
            self.root,
            &joined,
            flags,
            Mode::RUSR | Mode::WUSR,
            confinement_flags(),
        ) {
            Ok(descriptor) => Ok(descriptor),
            Err(rustix::io::Errno::NOSYS | rustix::io::Errno::INVAL) => {
                if !allow_fallback {
                    return Err(BrokerError::new(
                        ErrorCode::Unsupported,
                        "openat2 is required",
                    ));
                }
                let (parents, name) = path.split_at(path.len() - 1);
                let parent = self.open_directory(parents, true)?;
                let name = c_string(&name[0])?;
                fs::openat(&parent, &name, flags, Mode::RUSR | Mode::WUSR).map_err(BrokerError::io)
            }
            Err(error) => Err(BrokerError::io(error)),
        }
    }

    fn open_path_fallback(&self, path: &[Vec<u8>], final_flags: OFlags) -> Result<OwnedFd> {
        let mut directory = rustix::io::dup(self.root).map_err(BrokerError::io)?;
        for component in &path[..path.len() - 1] {
            let name = c_string(component)?;
            let next = fs::openat(
                &directory,
                &name,
                OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .map_err(BrokerError::io)?;
            require_same_device(&next, self.root_dev)?;
            directory = next;
        }
        let name = c_string(path.last().expect("validated nonempty path"))?;
        let descriptor = fs::openat(
            &directory,
            &name,
            final_flags | OFlags::NOFOLLOW,
            Mode::empty(),
        )
        .map_err(BrokerError::io)?;
        require_same_device(&descriptor, self.root_dev)?;
        Ok(descriptor)
    }

    fn verify_root(&self) -> Result<()> {
        let stat = fs::fstat(self.root).map_err(BrokerError::io)?;
        if stat.st_mode & libc::S_IFMT != libc::S_IFDIR
            || stat.st_dev != self.root_dev
            || stat.st_ino != self.root_ino
            || stat.st_uid != self.root_uid
            || stat.st_mode & 0o077 != 0
        {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "root privacy or identity changed",
            ));
        }
        Ok(())
    }
}

fn confinement_flags() -> ResolveFlags {
    ResolveFlags::BENEATH
        | ResolveFlags::NO_SYMLINKS
        | ResolveFlags::NO_MAGICLINKS
        | ResolveFlags::NO_XDEV
}

fn write_replacement(file: &mut File, bytes: &[u8], source: &Metadata) -> Result<()> {
    file.write_all(bytes)
        .map_err(|_| BrokerError::new(ErrorCode::Io, "replacement write failed"))?;
    fs::fchmod(file.as_fd(), Mode::from_raw_mode(source.mode)).map_err(BrokerError::io)?;
    let mtime_nsec = source
        .mtime_nsec
        .try_into()
        .map_err(|_| BrokerError::new(ErrorCode::Integrity, "invalid modification time"))?;
    fs::futimens(
        file.as_fd(),
        &Timestamps {
            last_access: Timespec {
                tv_sec: 0,
                tv_nsec: UTIME_OMIT,
            },
            last_modification: Timespec {
                tv_sec: source.mtime_sec,
                tv_nsec: mtime_nsec,
            },
        },
    )
    .map_err(BrokerError::io)?;
    fs::fsync(file.as_fd()).map_err(BrokerError::io)
}

fn read_open_regular(descriptor: OwnedFd) -> Result<(Metadata, Vec<u8>, [u8; 32])> {
    let before = fs::fstat(&descriptor).map_err(BrokerError::io)?;
    if before.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(BrokerError::new(
            ErrorCode::WrongType,
            "regular file required",
        ));
    }
    let mut xattr_names: Vec<u8> = Vec::with_capacity(1);
    let xattrs = fs::flistxattr(&descriptor, &mut xattr_names);
    match xattrs {
        Ok(name_bytes) if name_bytes != 0 => {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "extended metadata is unsupported",
            ))
        }
        Err(rustix::io::Errno::RANGE) => {
            return Err(BrokerError::new(
                ErrorCode::Integrity,
                "extended metadata is unsupported",
            ))
        }
        Err(error) if error != rustix::io::Errno::NOTSUP => return Err(BrokerError::io(error)),
        _ => {}
    }
    let expected_size = usize::try_from(before.st_size)
        .map_err(|_| BrokerError::new(ErrorCode::Bounds, "file size out of bounds"))?;
    if expected_size > MAX_FILE {
        return Err(BrokerError::new(
            ErrorCode::Bounds,
            "file size limit exceeded",
        ));
    }
    let mut file = File::from(descriptor);
    let mut bytes = Vec::with_capacity(expected_size);
    Read::by_ref(&mut file)
        .take((MAX_FILE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| BrokerError::new(ErrorCode::Io, "file read failed"))?;
    if bytes.len() > MAX_FILE {
        return Err(BrokerError::new(
            ErrorCode::Bounds,
            "file size limit exceeded",
        ));
    }
    let after = fs::fstat(&file).map_err(BrokerError::io)?;
    let before = Metadata::from_stat(&before)?;
    let after = Metadata::from_stat(&after)?;
    if before != after || before.size != bytes.len() as u64 {
        return Err(BrokerError::new(
            ErrorCode::Integrity,
            "file changed during read",
        ));
    }
    let digest: [u8; 32] = Sha256::digest(&bytes).into();
    Ok((before, bytes, digest))
}

fn require_regular_metadata(descriptor: &impl AsFd) -> Result<Metadata> {
    let stat = fs::fstat(descriptor).map_err(BrokerError::io)?;
    if stat.st_mode & libc::S_IFMT != libc::S_IFREG {
        return Err(BrokerError::new(
            ErrorCode::WrongType,
            "regular file required",
        ));
    }
    Metadata::from_stat(&stat)
}

fn require_same_device(descriptor: &impl AsFd, root_dev: u64) -> Result<()> {
    let stat = fs::fstat(descriptor).map_err(BrokerError::io)?;
    if stat.st_dev != root_dev {
        return Err(BrokerError::new(
            ErrorCode::Integrity,
            "mount boundary rejected",
        ));
    }
    Ok(())
}

fn current_euid() -> u32 {
    // SAFETY: geteuid has no preconditions and does not access memory.
    unsafe { libc::geteuid() }
}

fn current_egid() -> u32 {
    // SAFETY: getegid has no preconditions and does not access memory.
    unsafe { libc::getegid() }
}

fn joined_path(path: &[Vec<u8>]) -> Result<CString> {
    let mut joined = Vec::new();
    for (index, component) in path.iter().enumerate() {
        if index != 0 {
            joined.push(b'/');
        }
        joined.extend_from_slice(component);
    }
    c_string(&joined)
}

fn c_string(bytes: &[u8]) -> Result<CString> {
    CString::new(bytes).map_err(|_| BrokerError::new(ErrorCode::InvalidPath, "path contains NUL"))
}

fn append_hex(output: &mut Vec<u8>, bytes: &[u8]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize]);
        output.push(HEX[(byte & 0x0f) as usize]);
    }
}

fn ok_header(opcode: u8) -> Vec<u8> {
    vec![VERSION, STATUS_OK, opcode, 0]
}

fn error_response(opcode: u8, error: &BrokerError) -> Vec<u8> {
    let message = error.message.as_bytes();
    let mut response = vec![VERSION, STATUS_ERROR, opcode, 0];
    response.extend_from_slice(&(error.code as u16).to_be_bytes());
    response.extend_from_slice(&(message.len() as u16).to_be_bytes());
    response.extend_from_slice(message);
    response
}

struct Decoder<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16> {
        let bytes: [u8; 2] = self.take(2)?.try_into().expect("fixed length");
        Ok(u16::from_be_bytes(bytes))
    }

    fn u32(&mut self) -> Result<u32> {
        let bytes: [u8; 4] = self.take(4)?.try_into().expect("fixed length");
        Ok(u32::from_be_bytes(bytes))
    }

    fn array_16(&mut self) -> Result<[u8; 16]> {
        Ok(self.take(16)?.try_into().expect("fixed length"))
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| BrokerError::new(ErrorCode::Bounds, "request length overflow"))?;
        if end > self.bytes.len() {
            return Err(BrokerError::new(ErrorCode::Protocol, "truncated request"));
        }
        let result = &self.bytes[self.position..end];
        self.position = end;
        Ok(result)
    }

    fn bytes_u32(&mut self, maximum: usize) -> Result<&'a [u8]> {
        let length = self.u32()? as usize;
        if length > maximum {
            return Err(BrokerError::new(
                ErrorCode::Bounds,
                "byte payload limit exceeded",
            ));
        }
        self.take(length)
    }

    fn path(&mut self, allow_empty: bool) -> Result<Vec<Vec<u8>>> {
        let count = self.u16()? as usize;
        if count == 0 && !allow_empty {
            return Err(BrokerError::new(ErrorCode::InvalidPath, "path is empty"));
        }
        if count > MAX_COMPONENTS {
            return Err(BrokerError::new(
                ErrorCode::Bounds,
                "too many path components",
            ));
        }
        let mut total = count.saturating_sub(1);
        let mut path = Vec::with_capacity(count);
        for _ in 0..count {
            let length = self.u16()? as usize;
            if length == 0 {
                return Err(BrokerError::new(
                    ErrorCode::InvalidPath,
                    "invalid component length",
                ));
            }
            if length > MAX_COMPONENT {
                return Err(BrokerError::new(
                    ErrorCode::Bounds,
                    "path component limit exceeded",
                ));
            }
            let component = self.take(length)?;
            if component == b"."
                || component == b".."
                || component.contains(&b'/')
                || component.contains(&0)
            {
                return Err(BrokerError::new(
                    ErrorCode::InvalidPath,
                    "invalid path component",
                ));
            }
            total = total
                .checked_add(length)
                .ok_or_else(|| BrokerError::new(ErrorCode::Bounds, "path length overflow"))?;
            if total > MAX_PATH {
                return Err(BrokerError::new(
                    ErrorCode::Bounds,
                    "path length limit exceeded",
                ));
            }
            path.push(component.to_vec());
        }
        Ok(path)
    }

    fn end(&self) -> Result<()> {
        if self.position != self.bytes.len() {
            return Err(BrokerError::new(
                ErrorCode::Protocol,
                "trailing request bytes",
            ));
        }
        Ok(())
    }
}
