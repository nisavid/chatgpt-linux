use std::fs;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

const VERSION: u8 = 1;
const OP_LIST: u8 = 1;
const OP_READ: u8 = 2;
const OP_REPLACE: u8 = 3;
const STATUS_OK: u8 = 0;
const STATUS_ERROR: u8 = 1;

struct Broker {
    child: Child,
}

impl Drop for Broker {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let _ = self.child.wait();
    }
}

fn private_tempdir() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    directory
}

fn path_request(opcode: u8, flags: u8, components: &[&[u8]]) -> Vec<u8> {
    let mut request = vec![VERSION, opcode, flags, 0];
    request.extend_from_slice(&(components.len() as u16).to_be_bytes());
    for component in components {
        request.extend_from_slice(&(component.len() as u16).to_be_bytes());
        request.extend_from_slice(component);
    }
    request
}

impl Broker {
    fn spawn(root: &fs::File) -> Self {
        Self::spawn_with_blocked_syscall(root, None)
    }

    fn spawn_with_blocked_syscall(root: &fs::File, blocked_syscall: Option<libc::c_long>) -> Self {
        let root_fd = unsafe { libc::fcntl(root.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 10) };
        assert!(root_fd >= 10);
        let mut command = Command::new(env!("CARGO_BIN_EXE_chatgpt-generated-app-mutation-broker"));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(root_fd, 3) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                if let Some(syscall) = blocked_syscall {
                    install_errno_filter(syscall)?;
                }
                Ok(())
            });
        }
        let child = command.spawn().expect("broker starts");
        unsafe { libc::close(root_fd) };
        Self { child }
    }

    fn spawn_with_rename_notification(root: &fs::File) -> (Self, OwnedFd) {
        let root_fd = unsafe { libc::fcntl(root.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 10) };
        assert!(root_fd >= 10);
        let mut sockets = [-1; 2];
        assert_eq!(
            unsafe {
                libc::socketpair(
                    libc::AF_UNIX,
                    libc::SOCK_DGRAM | libc::SOCK_CLOEXEC,
                    0,
                    sockets.as_mut_ptr(),
                )
            },
            0
        );
        let parent_socket = sockets[0];
        let child_socket = sockets[1];
        let mut command = Command::new(env!("CARGO_BIN_EXE_chatgpt-generated-app-mutation-broker"));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        unsafe {
            command.pre_exec(move || {
                if libc::dup2(root_fd, 3) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                let listener = install_notification_filter(libc::SYS_renameat2)?;
                send_fd(child_socket, listener)?;
                libc::close(listener);
                libc::close(child_socket);
                Ok(())
            });
        }
        let child = command.spawn().expect("broker starts");
        unsafe {
            libc::close(root_fd);
            libc::close(child_socket);
        }
        let listener = recv_fd(parent_socket).expect("receive seccomp listener");
        unsafe { libc::close(parent_socket) };
        // SAFETY: recv_fd returned a new descriptor owned by this process.
        let listener = unsafe { OwnedFd::from_raw_fd(listener) };
        (Self { child }, listener)
    }

    fn send(&mut self, payload: &[u8]) {
        let stdin = self.child.stdin.as_mut().unwrap();
        stdin
            .write_all(&(payload.len() as u32).to_be_bytes())
            .unwrap();
        stdin.write_all(payload).unwrap();
        stdin.flush().unwrap();
    }

    fn request(&mut self, payload: &[u8]) -> Vec<u8> {
        self.send(payload);
        self.response()
    }

    fn request_fragmented(&mut self, payload: &[u8]) -> Vec<u8> {
        let mut frame = (payload.len() as u32).to_be_bytes().to_vec();
        frame.extend_from_slice(payload);
        let stdin = self.child.stdin.as_mut().unwrap();
        for byte in frame {
            stdin.write_all(&[byte]).unwrap();
            stdin.flush().unwrap();
        }
        self.response()
    }

    fn response(&mut self) -> Vec<u8> {
        let stdout = self.child.stdout.as_mut().unwrap();
        let mut size = [0_u8; 4];
        if let Err(error) = stdout.read_exact(&mut size) {
            let mut stderr = String::new();
            self.child
                .stderr
                .as_mut()
                .unwrap()
                .read_to_string(&mut stderr)
                .unwrap();
            panic!("broker response header: {error}; stderr: {stderr}");
        }
        let mut response = vec![0; u32::from_be_bytes(size) as usize];
        stdout.read_exact(&mut response).unwrap();
        response
    }

    fn assert_rejected(&mut self) {
        drop(self.child.stdin.take());
        let status = self.child.wait().expect("broker exits after rejection");
        assert!(!status.success(), "rejected request must exit nonzero");
        let mut trailing = Vec::new();
        self.child
            .stdout
            .as_mut()
            .unwrap()
            .read_to_end(&mut trailing)
            .expect("drain broker stdout after rejection");
        assert!(
            trailing.is_empty(),
            "rejected request must emit at most one response frame"
        );
    }
}

#[repr(C, align(8))]
struct ControlMessage([u8; 64]);

unsafe fn send_fd(socket: libc::c_int, descriptor: libc::c_int) -> std::io::Result<()> {
    let mut byte = [0_u8; 1];
    let mut iovec = libc::iovec {
        iov_base: byte.as_mut_ptr().cast(),
        iov_len: byte.len(),
    };
    let mut control = ControlMessage([0; 64]);
    let mut message: libc::msghdr = std::mem::zeroed();
    message.msg_iov = &mut iovec;
    message.msg_iovlen = 1;
    message.msg_control = control.0.as_mut_ptr().cast();
    message.msg_controllen = libc::CMSG_SPACE(std::mem::size_of::<libc::c_int>() as _) as usize;
    let header = libc::CMSG_FIRSTHDR(&message);
    if header.is_null() {
        return Err(std::io::Error::other("missing control-message header"));
    }
    (*header).cmsg_level = libc::SOL_SOCKET;
    (*header).cmsg_type = libc::SCM_RIGHTS;
    (*header).cmsg_len = libc::CMSG_LEN(std::mem::size_of::<libc::c_int>() as _) as usize;
    std::ptr::copy_nonoverlapping(
        &descriptor,
        libc::CMSG_DATA(header).cast::<libc::c_int>(),
        1,
    );
    if libc::sendmsg(socket, &message, 0) == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn recv_fd(socket: libc::c_int) -> std::io::Result<libc::c_int> {
    let mut byte = [0_u8; 1];
    let mut iovec = libc::iovec {
        iov_base: byte.as_mut_ptr().cast(),
        iov_len: byte.len(),
    };
    let mut control = ControlMessage([0; 64]);
    let mut message: libc::msghdr = unsafe { std::mem::zeroed() };
    message.msg_iov = &mut iovec;
    message.msg_iovlen = 1;
    message.msg_control = control.0.as_mut_ptr().cast();
    message.msg_controllen = control.0.len();
    if unsafe { libc::recvmsg(socket, &mut message, 0) } == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let header = unsafe { libc::CMSG_FIRSTHDR(&message) };
    if header.is_null()
        || unsafe { (*header).cmsg_level } != libc::SOL_SOCKET
        || unsafe { (*header).cmsg_type } != libc::SCM_RIGHTS
    {
        return Err(std::io::Error::other("missing descriptor control message"));
    }
    Ok(unsafe { *libc::CMSG_DATA(header).cast::<libc::c_int>() })
}

unsafe fn install_notification_filter(
    blocked_syscall: libc::c_long,
) -> std::io::Result<libc::c_int> {
    let statement = |code: u32, value: u32| libc::sock_filter {
        code: code as u16,
        jt: 0,
        jf: 0,
        k: value,
    };
    let mut filter = [
        statement(libc::BPF_LD | libc::BPF_W | libc::BPF_ABS, 0),
        libc::sock_filter {
            code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
            jt: 0,
            jf: 1,
            k: blocked_syscall as u32,
        },
        statement(libc::BPF_RET | libc::BPF_K, libc::SECCOMP_RET_USER_NOTIF),
        statement(libc::BPF_RET | libc::BPF_K, libc::SECCOMP_RET_ALLOW),
    ];
    let mut program = libc::sock_fprog {
        len: filter.len() as u16,
        filter: filter.as_mut_ptr(),
    };
    if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == -1 {
        return Err(std::io::Error::last_os_error());
    }
    let listener = libc::syscall(
        libc::SYS_seccomp,
        libc::SECCOMP_SET_MODE_FILTER,
        libc::SECCOMP_FILTER_FLAG_NEW_LISTENER,
        &mut program,
    ) as libc::c_int;
    if listener == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(listener)
}

fn receive_notification(listener: &OwnedFd) -> libc::seccomp_notif {
    let mut notification: libc::seccomp_notif = unsafe { std::mem::zeroed() };
    assert_eq!(
        unsafe {
            libc::ioctl(
                listener.as_raw_fd(),
                libc::SECCOMP_IOCTL_NOTIF_RECV,
                &mut notification,
            )
        },
        0,
        "receive seccomp notification: {}",
        std::io::Error::last_os_error()
    );
    notification
}

fn continue_notification(listener: &OwnedFd, notification: &libc::seccomp_notif) {
    let response = libc::seccomp_notif_resp {
        id: notification.id,
        val: 0,
        error: 0,
        flags: libc::SECCOMP_USER_NOTIF_FLAG_CONTINUE as u32,
    };
    assert_eq!(
        unsafe {
            libc::ioctl(
                listener.as_raw_fd(),
                libc::SECCOMP_IOCTL_NOTIF_SEND,
                &response,
            )
        },
        0,
        "continue seccomp notification: {}",
        std::io::Error::last_os_error()
    );
}

unsafe fn install_errno_filter(blocked_syscall: libc::c_long) -> std::io::Result<()> {
    let statement = |code: u32, value: u32| libc::sock_filter {
        code: code as u16,
        jt: 0,
        jf: 0,
        k: value,
    };
    let mut filter = [
        statement(libc::BPF_LD | libc::BPF_W | libc::BPF_ABS, 0),
        libc::sock_filter {
            code: (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16,
            jt: 0,
            jf: 1,
            k: blocked_syscall as u32,
        },
        statement(
            libc::BPF_RET | libc::BPF_K,
            libc::SECCOMP_RET_ERRNO | libc::ENOSYS as u32,
        ),
        statement(libc::BPF_RET | libc::BPF_K, libc::SECCOMP_RET_ALLOW),
    ];
    let mut program = libc::sock_fprog {
        len: filter.len() as u16,
        filter: filter.as_mut_ptr(),
    };
    if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == -1
        || libc::prctl(
            libc::PR_SET_SECCOMP,
            libc::SECCOMP_MODE_FILTER,
            &mut program,
        ) == -1
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

fn read_request(components: &[&[u8]]) -> Vec<u8> {
    path_request(OP_READ, 0, components)
}

fn replace_request(components: &[&[u8]], operation_id: &[u8; 16], bytes: &[u8]) -> Vec<u8> {
    replace_request_with_flags(0, components, operation_id, bytes)
}

fn replace_request_with_flags(
    flags: u8,
    components: &[&[u8]],
    operation_id: &[u8; 16],
    bytes: &[u8],
) -> Vec<u8> {
    let mut request = path_request(OP_REPLACE, flags, components);
    request.extend_from_slice(operation_id);
    request.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    request.extend_from_slice(bytes);
    request
}

fn error_code(response: &[u8]) -> u16 {
    assert_eq!(response[0], VERSION);
    assert_eq!(response[1], STATUS_ERROR);
    u16::from_be_bytes([response[4], response[5]])
}

fn read_parts(response: &[u8]) -> ([u8; 16], &[u8; 32], &[u8]) {
    assert_eq!(&response[..4], &[VERSION, STATUS_OK, OP_READ, 0]);
    let operation_id = response[4..20].try_into().unwrap();
    let digest = response[72..104].try_into().unwrap();
    let data_length = u32::from_be_bytes(response[104..108].try_into().unwrap()) as usize;
    assert_eq!(response.len(), 108 + data_length);
    (operation_id, digest, &response[108..])
}

#[test]
fn rejects_non_relative_component_grammar() {
    let root_dir = private_tempdir();
    let root = fs::File::open(root_dir.path()).unwrap();

    for components in [
        vec![],
        vec![b"".as_slice()],
        vec![b".".as_slice()],
        vec![b"..".as_slice()],
        vec![b"a/b".as_slice()],
        vec![b"nul\0byte".as_slice()],
    ] {
        let mut broker = Broker::spawn(&root);
        let response = broker.request(&read_request(&components));
        assert_eq!(&response[..4], &[VERSION, STATUS_ERROR, OP_READ, 0]);
        assert_eq!(u16::from_be_bytes([response[4], response[5]]), 2);
        broker.assert_rejected();
    }
}

#[test]
fn reads_non_utf8_paths_without_changing_bytes() {
    let root_dir = private_tempdir();
    let name = b"raw-\xff-name";
    fs::write(
        root_dir.path().join(std::ffi::OsStr::from_bytes(name)),
        b"abc\0\xff",
    )
    .unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);

    let response = broker.request(&read_request(&[name]));
    let (_, digest, data) = read_parts(&response);
    assert_eq!(data, b"abc\0\xff");
    assert_eq!(
        digest,
        &[
            0x77, 0xcb, 0x6b, 0xea, 0x09, 0x1f, 0xf2, 0x50, 0xaf, 0x30, 0x4a, 0x09, 0x02, 0x4b,
            0x0c, 0x52, 0x6b, 0xe6, 0xa2, 0x10, 0x14, 0xa9, 0x1a, 0xb5, 0x6e, 0x78, 0x8c, 0x63,
            0xa6, 0x9e, 0x81, 0x1f,
        ]
    );
}

#[test]
fn lists_raw_names_with_no_follow_metadata() {
    let root_dir = private_tempdir();
    fs::write(root_dir.path().join("regular"), b"data").unwrap();
    symlink("regular", root_dir.path().join("link")).unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);

    let response = broker.request(&path_request(OP_LIST, 0, &[]));
    assert_eq!(&response[..4], &[VERSION, STATUS_OK, OP_LIST, 0]);
    assert_eq!(u32::from_be_bytes(response[4..8].try_into().unwrap()), 2);
    let first_length = u16::from_be_bytes(response[8..10].try_into().unwrap()) as usize;
    assert_eq!(&response[10..10 + first_length], b"link");
    let first_mode_offset = 10 + first_length + 16;
    let first_mode = u32::from_be_bytes(
        response[first_mode_offset..first_mode_offset + 4]
            .try_into()
            .unwrap(),
    );
    assert_eq!(first_mode & libc::S_IFMT, libc::S_IFLNK);
}

#[test]
fn listing_a_missing_directory_is_empty_and_keeps_the_session_usable() {
    let root_dir = private_tempdir();
    fs::write(root_dir.path().join("regular"), b"data").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);

    let missing = broker.request(&path_request(OP_LIST, 0, &[b"missing"]));
    assert_eq!(&missing[..4], &[VERSION, STATUS_OK, OP_LIST, 0]);
    assert_eq!(u32::from_be_bytes(missing[4..8].try_into().unwrap()), 0);

    let root_listing = broker.request(&path_request(OP_LIST, 0, &[]));
    assert_eq!(&root_listing[..4], &[VERSION, STATUS_OK, OP_LIST, 0]);
    assert_eq!(
        u32::from_be_bytes(root_listing[4..8].try_into().unwrap()),
        1
    );
}

#[test]
fn replaces_only_the_file_bound_to_the_read_token() {
    let root_dir = private_tempdir();
    let target = root_dir.path().join("target");
    fs::write(&target, b"before").unwrap();
    fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
    let target_path = std::ffi::CString::new(target.as_os_str().as_bytes()).unwrap();
    let timestamps = [
        libc::timespec {
            tv_sec: 1_700_000_000,
            tv_nsec: 123_456_789,
        },
        libc::timespec {
            tv_sec: 1_700_000_000,
            tv_nsec: 123_456_789,
        },
    ];
    assert_eq!(
        unsafe { libc::utimensat(libc::AT_FDCWD, target_path.as_ptr(), timestamps.as_ptr(), 0) },
        0
    );
    let original = fs::metadata(&target).unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);

    let read = broker.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);
    let replace = broker.request(&replace_request(&[b"target"], &operation_id, b"after"));
    assert_eq!(&replace[..4], &[VERSION, STATUS_OK, OP_REPLACE, 0]);
    assert_eq!(fs::read(&target).unwrap(), b"after");
    assert_eq!(
        fs::metadata(&target).unwrap().permissions().mode() & 0o777,
        0o640
    );
    let replaced = fs::metadata(&target).unwrap();
    assert_eq!(replaced.mtime(), original.mtime());
    assert_eq!(replaced.mtime_nsec(), original.mtime_nsec());
    assert_eq!(fs::read_dir(root_dir.path()).unwrap().count(), 1);
}

#[test]
fn changed_target_fails_before_replacement() {
    let root_dir = private_tempdir();
    let target = root_dir.path().join("target");
    fs::write(&target, b"before").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);
    let read = broker.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);

    fs::write(&target, b"attacker").unwrap();
    let response = broker.request(&replace_request(&[b"target"], &operation_id, b"after"));
    assert_eq!(error_code(&response), 4);
    assert_eq!(fs::read(&target).unwrap(), b"attacker");
    broker.assert_rejected();
}

#[test]
fn digest_mismatch_fails_even_when_identity_fields_are_restored() {
    let root_dir = private_tempdir();
    let target = root_dir.path().join("target");
    fs::write(&target, b"before").unwrap();
    let original = fs::metadata(&target).unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);
    let read = broker.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);

    fs::write(&target, b"change").unwrap();
    let target_path = std::ffi::CString::new(target.as_os_str().as_bytes()).unwrap();
    let timestamps = [
        libc::timespec {
            tv_sec: original.atime(),
            tv_nsec: original.atime_nsec(),
        },
        libc::timespec {
            tv_sec: original.mtime(),
            tv_nsec: original.mtime_nsec(),
        },
    ];
    assert_eq!(
        unsafe { libc::utimensat(libc::AT_FDCWD, target_path.as_ptr(), timestamps.as_ptr(), 0) },
        0
    );
    let restored = fs::metadata(&target).unwrap();
    assert_eq!(restored.ino(), original.ino());
    assert_eq!(restored.len(), original.len());
    assert_eq!(restored.mtime(), original.mtime());
    assert_eq!(restored.mtime_nsec(), original.mtime_nsec());

    let response = broker.request(&replace_request(&[b"target"], &operation_id, b"after"));
    assert_eq!(error_code(&response), 4);
    assert_eq!(fs::read(&target).unwrap(), b"change");
}

#[test]
fn swapped_inode_with_identical_bytes_fails_identity_validation() {
    let root_dir = private_tempdir();
    let target = root_dir.path().join("target");
    fs::write(&target, b"same-bytes").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);
    let read = broker.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);

    fs::rename(&target, root_dir.path().join("old-target")).unwrap();
    fs::write(&target, b"same-bytes").unwrap();
    let response = broker.request(&replace_request(&[b"target"], &operation_id, b"after"));
    assert_eq!(error_code(&response), 4);
    assert_eq!(fs::read(&target).unwrap(), b"same-bytes");
    broker.assert_rejected();
}

#[test]
fn revoked_root_privacy_poisons_the_session() {
    let root_dir = private_tempdir();
    let target = root_dir.path().join("target");
    fs::write(&target, b"before").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let mut broker = Broker::spawn(&root);
    let read = broker.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);

    fs::set_permissions(root_dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
    let response = broker.request(&replace_request(&[b"target"], &operation_id, b"after"));
    assert_eq!(error_code(&response), 4);
    assert_eq!(fs::read(&target).unwrap(), b"before");
}

#[test]
fn bounds_partial_io_and_error_codes_are_stable() {
    let root_dir = private_tempdir();
    fs::write(root_dir.path().join("target"), b"content").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();

    let mut fragmented = Broker::spawn(&root);
    let response = fragmented.request_fragmented(&read_request(&[b"target"]));
    assert_eq!(read_parts(&response).2, b"content");

    let overlong = vec![b'x'; 256];
    let mut bounded = Broker::spawn(&root);
    assert_eq!(error_code(&bounded.request(&read_request(&[&overlong]))), 8);

    let mut malformed = Broker::spawn(&root);
    let mut malformed_request = read_request(&[b"target"]);
    malformed_request.push(0);
    assert_eq!(error_code(&malformed.request(&malformed_request)), 1);

    let mut missing = Broker::spawn(&root);
    assert_eq!(
        error_code(&missing.request(&read_request(&[b"missing"]))),
        5
    );

    let mut partial = Broker::spawn(&root);
    partial
        .child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&10_u32.to_be_bytes())
        .unwrap();
    partial
        .child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&[VERSION, OP_READ])
        .unwrap();
    drop(partial.child.stdin.take());
    assert!(!partial.child.wait().unwrap().success());
}

#[test]
fn unsupported_syscalls_fail_closed_and_private_fallback_is_explicit() {
    let root_dir = private_tempdir();
    let target = root_dir.path().join("target");
    fs::write(&target, b"before").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();

    let mut required_openat2 = Broker::spawn_with_blocked_syscall(&root, Some(libc::SYS_openat2));
    assert_eq!(
        error_code(&required_openat2.request(&read_request(&[b"target"]))),
        3
    );
    required_openat2.assert_rejected();

    let mut explicit_fallback = Broker::spawn_with_blocked_syscall(&root, Some(libc::SYS_openat2));
    let fallback_read = explicit_fallback.request(&path_request(OP_READ, 1, &[b"target"]));
    let (fallback_operation_id, _, fallback_bytes) = read_parts(&fallback_read);
    assert_eq!(fallback_bytes, b"before");
    let fallback_replace = explicit_fallback.request(&replace_request_with_flags(
        1,
        &[b"target"],
        &fallback_operation_id,
        b"fallback-after",
    ));
    assert_eq!(&fallback_replace[..4], &[VERSION, STATUS_OK, OP_REPLACE, 0]);
    assert_eq!(fs::read(&target).unwrap(), b"fallback-after");
    fs::write(&target, b"before").unwrap();

    let mut required_exchange =
        Broker::spawn_with_blocked_syscall(&root, Some(libc::SYS_renameat2));
    let read = required_exchange.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);
    let response =
        required_exchange.request(&replace_request(&[b"target"], &operation_id, b"after"));
    assert_eq!(error_code(&response), 3);
    assert_eq!(fs::read(&target).unwrap(), b"before");
    assert_eq!(fs::read_dir(root_dir.path()).unwrap().count(), 1);
    required_exchange.assert_rejected();
}

#[test]
fn symlinks_and_special_files_fail_closed() {
    let root_dir = private_tempdir();
    let outside_dir = private_tempdir();
    let outside = outside_dir.path().join("outside");
    fs::write(&outside, b"untouched").unwrap();
    symlink(&outside, root_dir.path().join("link")).unwrap();
    let fifo = root_dir.path().join("fifo");
    let fifo_name = std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
    let root = fs::File::open(root_dir.path()).unwrap();

    let mut link_broker = Broker::spawn(&root);
    assert_eq!(
        error_code(&link_broker.request(&read_request(&[b"link"]))),
        4
    );
    let mut fifo_broker = Broker::spawn(&root);
    assert_eq!(
        error_code(&fifo_broker.request(&read_request(&[b"fifo"]))),
        6
    );
    assert_eq!(fs::read(&outside).unwrap(), b"untouched");
}

#[test]
fn parent_and_final_component_swaps_never_mutate_outside_root() {
    let root_dir = private_tempdir();
    let outside_dir = private_tempdir();
    fs::write(outside_dir.path().join("target"), b"outside").unwrap();
    fs::create_dir(root_dir.path().join("parent")).unwrap();
    fs::write(root_dir.path().join("parent/target"), b"inside").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();

    let mut parent_broker = Broker::spawn(&root);
    let read = parent_broker.request(&read_request(&[b"parent", b"target"]));
    let (operation_id, _, _) = read_parts(&read);
    fs::rename(
        root_dir.path().join("parent"),
        root_dir.path().join("parked"),
    )
    .unwrap();
    symlink(outside_dir.path(), root_dir.path().join("parent")).unwrap();
    let response = parent_broker.request(&replace_request(
        &[b"parent", b"target"],
        &operation_id,
        b"replacement",
    ));
    assert_eq!(error_code(&response), 4);
    assert_eq!(
        fs::read(outside_dir.path().join("target")).unwrap(),
        b"outside"
    );
    assert_eq!(
        fs::read(root_dir.path().join("parked/target")).unwrap(),
        b"inside"
    );

    fs::remove_file(root_dir.path().join("parent")).unwrap();
    fs::write(root_dir.path().join("target"), b"inside-final").unwrap();
    let mut final_broker = Broker::spawn(&root);
    let read = final_broker.request(&read_request(&[b"target"]));
    let (operation_id, _, _) = read_parts(&read);
    fs::remove_file(root_dir.path().join("target")).unwrap();
    symlink(
        outside_dir.path().join("target"),
        root_dir.path().join("target"),
    )
    .unwrap();
    let response = final_broker.request(&replace_request(
        &[b"target"],
        &operation_id,
        b"replacement",
    ));
    assert_eq!(error_code(&response), 4);
    assert_eq!(
        fs::read(outside_dir.path().join("target")).unwrap(),
        b"outside"
    );
}

#[test]
fn concurrent_parent_move_before_exchange_cannot_mutate_outside_root() {
    let root_dir = private_tempdir();
    let outside_dir = private_tempdir();
    fs::create_dir(root_dir.path().join("parent")).unwrap();
    fs::write(root_dir.path().join("parent/target"), b"inside").unwrap();
    let root = fs::File::open(root_dir.path()).unwrap();
    let (mut broker, listener) = Broker::spawn_with_rename_notification(&root);

    let read = broker.request(&read_request(&[b"parent", b"target"]));
    let (operation_id, _, _) = read_parts(&read);
    broker.send(&replace_request(
        &[b"parent", b"target"],
        &operation_id,
        b"replacement",
    ));

    let notification = receive_notification(&listener);
    assert_eq!(notification.data.nr as libc::c_long, libc::SYS_renameat2);
    let moved_parent = outside_dir.path().join("moved-parent");
    fs::rename(root_dir.path().join("parent"), &moved_parent).unwrap();
    continue_notification(&listener, &notification);

    let response = broker.response();
    assert_eq!(error_code(&response), 5);
    broker.assert_rejected();
    assert_eq!(fs::read(moved_parent.join("target")).unwrap(), b"inside");
    assert_eq!(
        fs::read_dir(&moved_parent).unwrap().count(),
        2,
        "broker must not unlink the already-created temporary through the moved parent"
    );
}
