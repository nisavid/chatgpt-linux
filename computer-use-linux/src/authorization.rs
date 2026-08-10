//! Live, app-owned authorization for the MCP transport.
//!
//! The ChatGPT main-process authority binds a Unix stream socket at either
//! `$XDG_RUNTIME_DIR/<app-id>/computer-use-authority.sock` or the
//! instance-scoped
//! `$XDG_RUNTIME_DIR/<app-id>/instances/<instance-id>/computer-use-authority.sock`
//! path selected by the existing cursor identity rules. The runtime root and
//! each parent are real current-user `0700` directories; the endpoint is a real
//! current-user `0600` socket; and the complete path is at most 100 bytes.
//! Each connection serves exactly one exchange, completes within 150 ms,
//! returns at most 256 bytes, and closes:
//!
//! ```text
//! CHATGPT-CUA-AUTH/1 CHECK <32 lowercase nonce hex>\n
//! CHATGPT-CUA-AUTH/1 ALLOW <nonzero u64 generation> <64 lowercase token hex> <nonce>\n
//! CHATGPT-CUA-AUTH/1 DENY <nonzero u64 generation> <nonce>\n
//! ```
//!
//! The response must echo the request nonce. The authority rotates the
//! generation and random token whenever eligibility changes. A deny at a
//! generation prevents an allow at that generation, and a token change without
//! a generation change is stale. Rust accepts no renderer state, persisted
//! grant, prompt, setting, or environment-carried authorization result. Linux
//! peer credentials must identify the current process or one of its ancestors,
//! binding the authority to the app process tree rather than merely to another
//! process of the user.

use std::{
    os::unix::{
        ffi::OsStrExt,
        fs::{FileTypeExt, MetadataExt},
    },
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    time::timeout,
};

const PROTOCOL: &str = "CHATGPT-CUA-AUTH/1";
const SOCKET_MAX_BYTES: usize = 100;
const RESPONSE_MAX_BYTES: usize = 256;
const AUTHORITY_TIMEOUT: Duration = Duration::from_millis(150);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorizationDenial {
    Unavailable,
    Invalid,
    TimedOut,
    Denied,
    Stale,
}

#[derive(Debug, Default)]
struct LeaseState {
    generation_floor: u64,
    observed_token: Option<[u8; 32]>,
    denied: bool,
}

#[derive(Debug)]
enum AuthorityResponse {
    Allow { generation: u64, token: [u8; 32] },
    Deny { generation: u64 },
}

#[derive(Debug)]
enum AuthorityLocator {
    CurrentProcess,
    #[cfg(test)]
    Fixed {
        runtime_root: PathBuf,
        socket_path: PathBuf,
    },
}

#[derive(Debug)]
pub(crate) struct AuthorizationLease {
    locator: AuthorityLocator,
    state: Mutex<LeaseState>,
}

impl Default for AuthorizationLease {
    fn default() -> Self {
        Self {
            locator: AuthorityLocator::CurrentProcess,
            state: Mutex::new(LeaseState::default()),
        }
    }
}

impl AuthorizationLease {
    #[cfg(test)]
    pub(crate) fn for_test(runtime_root: &Path, socket_path: PathBuf) -> Self {
        Self {
            locator: AuthorityLocator::Fixed {
                runtime_root: runtime_root.to_path_buf(),
                socket_path,
            },
            state: Mutex::new(LeaseState::default()),
        }
    }

    pub(crate) async fn revalidate(&self) -> Result<(), AuthorizationDenial> {
        let current_endpoint;
        let (runtime_root, socket_path, require_app_peer) = match &self.locator {
            AuthorityLocator::CurrentProcess => {
                current_endpoint = current_process_endpoint()?;
                (&current_endpoint.0, &current_endpoint.1, true)
            }
            #[cfg(test)]
            AuthorityLocator::Fixed {
                runtime_root,
                socket_path,
            } => (runtime_root, socket_path, false),
        };
        self.exchange(runtime_root, socket_path, require_app_peer)
            .await
    }

    async fn exchange(
        &self,
        runtime_root: &Path,
        socket_path: &Path,
        require_app_peer: bool,
    ) -> Result<(), AuthorizationDenial> {
        validate_authority_socket(runtime_root, socket_path)?;
        let mut nonce = [0_u8; 16];
        getrandom::fill(&mut nonce).map_err(|_| AuthorizationDenial::Unavailable)?;
        let request = format!("{PROTOCOL} CHECK {}\n", encode_hex(&nonce));
        let exchange = async {
            let mut stream = UnixStream::connect(socket_path)
                .await
                .map_err(|_| AuthorizationDenial::Unavailable)?;
            if require_app_peer {
                validate_app_peer(&stream)?;
            }
            stream
                .write_all(request.as_bytes())
                .await
                .map_err(|_| AuthorizationDenial::Unavailable)?;
            stream
                .shutdown()
                .await
                .map_err(|_| AuthorizationDenial::Unavailable)?;
            let mut response = Vec::with_capacity(RESPONSE_MAX_BYTES);
            (&mut stream)
                .take((RESPONSE_MAX_BYTES + 1) as u64)
                .read_to_end(&mut response)
                .await
                .map_err(|_| AuthorizationDenial::Unavailable)?;
            if response.len() > RESPONSE_MAX_BYTES {
                return Err(AuthorizationDenial::Invalid);
            }
            parse_response(&response, &nonce)
        };
        let response = timeout(AUTHORITY_TIMEOUT, exchange)
            .await
            .map_err(|_| AuthorizationDenial::TimedOut)??;
        self.apply_response(response)
    }

    fn apply_response(&self, response: AuthorityResponse) -> Result<(), AuthorizationDenial> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AuthorizationDenial::Unavailable)?;
        match response {
            AuthorityResponse::Allow { generation, token } => {
                if generation < state.generation_floor {
                    return Err(AuthorizationDenial::Stale);
                }
                if generation == state.generation_floor && state.generation_floor != 0 {
                    if !state.denied && state.observed_token == Some(token) {
                        return Ok(());
                    }
                    return Err(AuthorizationDenial::Stale);
                }
                state.generation_floor = generation;
                state.observed_token = Some(token);
                state.denied = false;
                Ok(())
            }
            AuthorityResponse::Deny { generation } => {
                if generation < state.generation_floor {
                    return Err(AuthorizationDenial::Stale);
                }
                state.generation_floor = generation;
                state.observed_token = None;
                state.denied = true;
                Err(AuthorizationDenial::Denied)
            }
        }
    }
}

fn authority_socket_path_from_cursor(mut cursor_path: PathBuf) -> Option<PathBuf> {
    cursor_path.set_file_name("computer-use-authority.sock");
    (cursor_path.as_os_str().as_bytes().len() <= SOCKET_MAX_BYTES).then_some(cursor_path)
}

fn current_process_endpoint() -> Result<(PathBuf, PathBuf), AuthorizationDenial> {
    let runtime_root = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or(AuthorizationDenial::Unavailable)?;
    let socket_path = crate::server::avatar_cursor_socket_path()
        .and_then(authority_socket_path_from_cursor)
        .ok_or(AuthorizationDenial::Unavailable)?;
    Ok((runtime_root, socket_path))
}

fn current_uid() -> u32 {
    // SAFETY: geteuid has no preconditions and accesses no memory.
    unsafe { libc::geteuid() }
}

fn validate_app_peer(stream: &UnixStream) -> Result<(), AuthorizationDenial> {
    let credentials = stream
        .peer_cred()
        .map_err(|_| AuthorizationDenial::Unavailable)?;
    let peer_pid = credentials
        .pid()
        .and_then(|pid| u32::try_from(pid).ok())
        .ok_or(AuthorizationDenial::Invalid)?;
    if credentials.uid() != current_uid() || !is_self_or_ancestor(peer_pid) {
        return Err(AuthorizationDenial::Invalid);
    }
    Ok(())
}

fn is_self_or_ancestor(expected: u32) -> bool {
    let mut pid = std::process::id();
    for _ in 0..16 {
        if pid == expected {
            return true;
        }
        let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) else {
            return false;
        };
        let Some(parent) = status
            .lines()
            .find_map(|line| line.strip_prefix("PPid:")?.trim().parse::<u32>().ok())
        else {
            return false;
        };
        if parent <= 1 || parent == pid {
            return parent == expected;
        }
        pid = parent;
    }
    false
}

fn validate_private_directory(path: &Path) -> Result<(), AuthorizationDenial> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| AuthorizationDenial::Unavailable)?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != current_uid()
        || metadata.mode() & 0o777 != 0o700
    {
        return Err(AuthorizationDenial::Invalid);
    }
    Ok(())
}

fn validate_authority_socket(
    runtime_root: &Path,
    socket_path: &Path,
) -> Result<(), AuthorizationDenial> {
    if !runtime_root.is_absolute()
        || !socket_path.starts_with(runtime_root)
        || socket_path.as_os_str().as_bytes().len() > SOCKET_MAX_BYTES
    {
        return Err(AuthorizationDenial::Invalid);
    }
    validate_private_directory(runtime_root)?;
    let parent = socket_path.parent().ok_or(AuthorizationDenial::Invalid)?;
    let relative_parent = parent
        .strip_prefix(runtime_root)
        .map_err(|_| AuthorizationDenial::Invalid)?;
    let mut directory = runtime_root.to_path_buf();
    for component in relative_parent.components() {
        let std::path::Component::Normal(component) = component else {
            return Err(AuthorizationDenial::Invalid);
        };
        directory.push(component);
        validate_private_directory(&directory)?;
    }
    let metadata =
        std::fs::symlink_metadata(socket_path).map_err(|_| AuthorizationDenial::Unavailable)?;
    if !metadata.file_type().is_socket()
        || metadata.uid() != current_uid()
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(AuthorizationDenial::Invalid);
    }
    Ok(())
}

fn parse_response(
    bytes: &[u8],
    expected_nonce: &[u8; 16],
) -> Result<AuthorityResponse, AuthorizationDenial> {
    let response = std::str::from_utf8(bytes).map_err(|_| AuthorizationDenial::Invalid)?;
    if !response.ends_with('\n') || response[..response.len() - 1].contains(['\n', '\r']) {
        return Err(AuthorizationDenial::Invalid);
    }
    let fields = response[..response.len() - 1]
        .split(' ')
        .collect::<Vec<_>>();
    if fields.first().copied() != Some(PROTOCOL) {
        return Err(AuthorizationDenial::Invalid);
    }
    match fields.as_slice() {
        [_, "ALLOW", generation, token, nonce] => {
            let generation = parse_generation(generation)?;
            let token = decode_hex::<32>(token)?;
            if decode_hex::<16>(nonce)? != *expected_nonce {
                return Err(AuthorizationDenial::Invalid);
            }
            Ok(AuthorityResponse::Allow { generation, token })
        }
        [_, "DENY", generation, nonce] => {
            let generation = parse_generation(generation)?;
            if decode_hex::<16>(nonce)? != *expected_nonce {
                return Err(AuthorizationDenial::Invalid);
            }
            Ok(AuthorityResponse::Deny { generation })
        }
        _ => Err(AuthorizationDenial::Invalid),
    }
}

fn parse_generation(value: &str) -> Result<u64, AuthorizationDenial> {
    if value.is_empty()
        || value.starts_with('0')
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(AuthorizationDenial::Invalid);
    }
    let generation = value
        .parse::<u64>()
        .map_err(|_| AuthorizationDenial::Invalid)?;
    Ok(generation)
}

fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

fn decode_hex<const N: usize>(value: &str) -> Result<[u8; N], AuthorizationDenial> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(AuthorizationDenial::Invalid);
    }
    let mut output = [0_u8; N];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = (pair[0] as char)
            .to_digit(16)
            .ok_or(AuthorizationDenial::Invalid)?;
        let low = (pair[1] as char)
            .to_digit(16)
            .ok_or(AuthorizationDenial::Invalid)?;
        output[index] = ((high << 4) | low) as u8;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    enum Reply {
        Allow(u64, [u8; 32]),
        Deny(u64),
        Malformed,
        Oversized,
        Hang,
    }

    struct TestEndpoint {
        root: PathBuf,
        socket: PathBuf,
    }

    impl TestEndpoint {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "chatgpt-cua-authority-{name}-{}-{}",
                std::process::id(),
                getrandom::u64().unwrap(),
            ));
            std::fs::create_dir(&root).unwrap();
            std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
            let socket = root.join("authority.sock");
            Self { root, socket }
        }

        fn lease(&self) -> AuthorizationLease {
            AuthorizationLease::for_test(&self.root, self.socket.clone())
        }
    }

    impl Drop for TestEndpoint {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn hex(bytes: &[u8]) -> String {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut output = String::with_capacity(bytes.len() * 2);
        for byte in bytes {
            output.push(DIGITS[(byte >> 4) as usize] as char);
            output.push(DIGITS[(byte & 0x0f) as usize] as char);
        }
        output
    }

    fn spawn_authority(path: &Path, replies: Vec<Reply>) -> tokio::task::JoinHandle<()> {
        let listener = tokio::net::UnixListener::bind(path).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
        tokio::spawn(async move {
            for reply in replies {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                stream.read_to_end(&mut request).await.unwrap();
                let request = std::str::from_utf8(&request).unwrap();
                let nonce = request.split_ascii_whitespace().nth(2).unwrap();
                let response = match reply {
                    Reply::Allow(generation, token) => format!(
                        "CHATGPT-CUA-AUTH/1 ALLOW {generation} {} {nonce}\n",
                        hex(&token),
                    ),
                    Reply::Deny(generation) => {
                        format!("CHATGPT-CUA-AUTH/1 DENY {generation} {nonce}\n")
                    }
                    Reply::Malformed => "CHATGPT-CUA-AUTH/2 ALLOW 1 nope nope\n".to_string(),
                    Reply::Oversized => "x".repeat(RESPONSE_MAX_BYTES + 1),
                    Reply::Hang => {
                        tokio::time::sleep(AUTHORITY_TIMEOUT * 2).await;
                        continue;
                    }
                };
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
        })
    }

    #[tokio::test]
    async fn absent_authority_denies() {
        let root = std::env::temp_dir().join(format!(
            "chatgpt-cua-authority-absent-{}",
            std::process::id()
        ));
        let lease = AuthorizationLease::for_test(&root, root.join("missing.sock"));

        assert_eq!(
            lease.revalidate().await,
            Err(AuthorizationDenial::Unavailable)
        );
    }

    #[tokio::test]
    async fn live_allow_is_revalidated_and_revocation_denies() {
        let endpoint = TestEndpoint::new("allow-revoke");
        let authority = spawn_authority(
            &endpoint.socket,
            vec![Reply::Allow(1, [0x11; 32]), Reply::Deny(2)],
        );
        let lease = endpoint.lease();

        assert_eq!(lease.revalidate().await, Ok(()));
        assert_eq!(lease.revalidate().await, Err(AuthorizationDenial::Denied));
        authority.await.unwrap();
    }

    #[tokio::test]
    async fn stale_generation_after_reenable_is_denied() {
        let endpoint = TestEndpoint::new("stale-reenable");
        let authority = spawn_authority(
            &endpoint.socket,
            vec![
                Reply::Allow(4, [0x44; 32]),
                Reply::Deny(5),
                Reply::Allow(4, [0x44; 32]),
            ],
        );
        let lease = endpoint.lease();

        assert_eq!(lease.revalidate().await, Ok(()));
        assert_eq!(lease.revalidate().await, Err(AuthorizationDenial::Denied));
        assert_eq!(lease.revalidate().await, Err(AuthorizationDenial::Stale));
        authority.await.unwrap();
    }

    #[tokio::test]
    async fn transient_invalid_response_can_recover_only_with_same_generation_token() {
        let endpoint = TestEndpoint::new("transient-recovery");
        let authority = spawn_authority(
            &endpoint.socket,
            vec![
                Reply::Allow(4, [0x44; 32]),
                Reply::Malformed,
                Reply::Allow(4, [0x44; 32]),
            ],
        );
        let lease = endpoint.lease();

        assert_eq!(lease.revalidate().await, Ok(()));
        assert_eq!(lease.revalidate().await, Err(AuthorizationDenial::Invalid));
        assert_eq!(lease.revalidate().await, Ok(()));
        authority.await.unwrap();
    }

    #[tokio::test]
    async fn delayed_older_deny_does_not_poison_a_newer_allow() {
        let endpoint = TestEndpoint::new("older-deny");
        let authority = spawn_authority(
            &endpoint.socket,
            vec![
                Reply::Allow(5, [0x55; 32]),
                Reply::Deny(4),
                Reply::Allow(5, [0x55; 32]),
            ],
        );
        let lease = endpoint.lease();

        assert_eq!(lease.revalidate().await, Ok(()));
        assert_eq!(lease.revalidate().await, Err(AuthorizationDenial::Stale));
        assert_eq!(lease.revalidate().await, Ok(()));
        authority.await.unwrap();
    }

    #[tokio::test]
    async fn malformed_and_oversized_responses_deny() {
        for (name, reply) in [
            ("malformed", Reply::Malformed),
            ("oversized", Reply::Oversized),
        ] {
            let endpoint = TestEndpoint::new(name);
            let authority = spawn_authority(&endpoint.socket, vec![reply]);

            assert_eq!(
                endpoint.lease().revalidate().await,
                Err(AuthorizationDenial::Invalid)
            );
            authority.await.unwrap();
        }
    }

    #[tokio::test]
    async fn symlinked_and_wrong_mode_sockets_deny_before_connect() {
        let symlinked = TestEndpoint::new("symlink");
        let real_socket = symlinked.root.join("real.sock");
        let _listener = tokio::net::UnixListener::bind(&real_socket).unwrap();
        std::os::unix::fs::symlink(&real_socket, &symlinked.socket).unwrap();
        assert_eq!(
            symlinked.lease().revalidate().await,
            Err(AuthorizationDenial::Invalid)
        );

        let wrong_mode = TestEndpoint::new("wrong-mode");
        let _listener = tokio::net::UnixListener::bind(&wrong_mode.socket).unwrap();
        std::fs::set_permissions(&wrong_mode.socket, std::fs::Permissions::from_mode(0o660))
            .unwrap();
        assert_eq!(
            wrong_mode.lease().revalidate().await,
            Err(AuthorizationDenial::Invalid)
        );
    }

    #[tokio::test]
    async fn unavailable_and_timed_out_authorities_deny() {
        let unavailable = TestEndpoint::new("unavailable");
        assert_eq!(
            unavailable.lease().revalidate().await,
            Err(AuthorizationDenial::Unavailable)
        );

        let timed_out = TestEndpoint::new("timeout");
        let authority = spawn_authority(&timed_out.socket, vec![Reply::Hang]);
        assert_eq!(
            timed_out.lease().revalidate().await,
            Err(AuthorizationDenial::TimedOut)
        );
        authority.await.unwrap();
    }

    #[test]
    fn current_process_endpoint_reuses_cursor_identity() {
        let cursor = PathBuf::from("/run/user/1000/chatgpt/instances/abc/computer-use-cursor.sock");
        assert_eq!(
            authority_socket_path_from_cursor(cursor),
            Some(PathBuf::from(
                "/run/user/1000/chatgpt/instances/abc/computer-use-authority.sock"
            ))
        );
    }

    #[test]
    fn peer_identity_accepts_only_self_or_ancestor() {
        assert!(is_self_or_ancestor(std::process::id()));
        assert!(!is_self_or_ancestor(u32::MAX));
    }

    #[test]
    fn generation_is_canonical_nonzero_decimal() {
        assert_eq!(parse_generation("1"), Ok(1));
        for invalid in ["0", "01", "+1", "-1", " 1", "1 ", "one"] {
            assert_eq!(parse_generation(invalid), Err(AuthorizationDenial::Invalid));
        }
    }
}
