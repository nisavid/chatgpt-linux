# Generated-app mutation broker protocol

The broker is a build-only Linux helper. It accepts no path arguments. Its
only destination capability is an inherited directory descriptor at file
descriptor 3. That directory must be owned by the broker's effective user and
must have no group or other permission bits.

Every stdin request and stdout response is a four-byte big-endian payload
length followed by that many payload bytes. The maximum payload is 16 MiB plus
64 KiB. Integers in payloads are unsigned big-endian unless called out below.
Version 1 paths are a `u16` component count followed by `u16 length, bytes`
pairs. Components are opaque bytes; empty components, `.`, `..`, `/`, NUL,
components over 255 bytes, paths over 4096 bytes, and paths over 128 components
are rejected.

Requests begin with:

```text
u8 version = 1
u8 operation: list = 1, read = 2, replace = 3
u8 flags: bit 0 = caller verified the private-root fallback invariant
u8 reserved = 0
path
```

`list` has no additional fields and may use an empty path for the root. `read`
requires a nonempty path. `replace` adds the 16-byte operation ID from a prior
read in the same broker process, a `u32` replacement length, and the replacement
bytes. A read token is single-use, bound to its original raw path, and never
valid in another broker process.

Successful responses begin with `version = 1, status = 0, operation, reserved
= 0`. List then returns a `u32` count of at most 8,192 and sorted entries
containing `u16 name length, name bytes, metadata`. Read returns `16-byte operation ID, metadata,
32-byte SHA-256 digest, u32 content length, content bytes`. Replace returns the
consumed 16-byte operation ID.

Listing a directory that does not exist returns a successful zero-entry list.
This preserves fail-soft discovery for absent optional generated-app surfaces
without weakening read or replacement identity checks. A link, wrong file
type, mount-boundary violation, malformed path, or other lookup failure remains
a request error and poisons the session.

Metadata is:

```text
u64 st_dev
u64 st_ino
u32 st_mode
u32 st_uid
u32 st_gid
u64 st_size
i64 st_mtime seconds
u64 st_mtime nanoseconds
```

Error responses begin with `version = 1, status = 1, operation, reserved = 0`,
then a `u16` code and `u16 length, ASCII message`. Codes are protocol 1,
invalid path 2, unsupported syscall 3, integrity 4, not found 5, wrong type 6,
I/O 7, and bounds 8. Every request error poisons the session: the broker emits
at most that one error response, exits nonzero, and accepts no later operation.

Lookup uses `openat2` with `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`,
`RESOLVE_NO_MAGICLINKS`, and `RESOLVE_NO_XDEV`. `ENOSYS` or a kernel-level
`EINVAL` fails closed unless bit 0 explicitly asserts that the caller already
verified a private, exclusive-writer root and trusted mount namespace. Only
then does the broker use a componentwise `openat` walk with `O_NOFOLLOW` and
same-device checks. Replacement requires `renameat2(RENAME_EXCHANGE)`; there is
no replacement fallback. Replacement preserves the source file's permission
mode and nanosecond modification time. Access time, status-change time, and
inode identity are not preserved; extended attributes are rejected rather
than silently dropped.
