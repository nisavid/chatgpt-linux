use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::{fs::PermissionsExt, net::UnixListener},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const BINARY: &str = env!("CARGO_BIN_EXE_chatgpt-computer-use-linux");
const SIBLING_HELPER_SOCKET_ENV: &str = "CHATGPT_CUA_TEST_SIBLING_HELPER_SOCKET";
const SIBLING_HELPER_READY_ENV: &str = "CHATGPT_CUA_TEST_SIBLING_HELPER_READY";
const SIBLING_HELPER_BYTES_ENV: &str = "CHATGPT_CUA_TEST_SIBLING_HELPER_BYTES";

enum Reply {
    Allow(u64, [u8; 32]),
    Deny(u64),
}

struct TestRuntime {
    root: PathBuf,
    socket: PathBuf,
}

impl TestRuntime {
    fn new() -> Self {
        let root = PathBuf::from(format!(
            "/tmp/cua-{}-{}",
            std::process::id(),
            getrandom::u64().unwrap()
        ));
        let app_dir = root.join("t");
        fs::create_dir_all(&app_dir).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&app_dir, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = app_dir.join("computer-use-authority.sock");
        Self { root, socket }
    }

    fn authority(&self, replies: Vec<Reply>) -> thread::JoinHandle<()> {
        let listener = UnixListener::bind(&self.socket).unwrap();
        fs::set_permissions(&self.socket, fs::Permissions::from_mode(0o600)).unwrap();
        thread::spawn(move || {
            for reply in replies {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = String::new();
                stream.read_to_string(&mut request).unwrap();
                let nonce = request.split_ascii_whitespace().nth(2).unwrap();
                let response = match reply {
                    Reply::Allow(generation, token) => format!(
                        "CHATGPT-CUA-AUTH/1 ALLOW {generation} {} {nonce}\n",
                        encode_hex(&token)
                    ),
                    Reply::Deny(generation) => {
                        format!("CHATGPT-CUA-AUTH/1 DENY {generation} {nonce}\n")
                    }
                };
                stream.write_all(response.as_bytes()).unwrap();
            }
        })
    }
}

impl Drop for TestRuntime {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct McpProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl McpProcess {
    fn start(runtime: &TestRuntime) -> Self {
        let mut child = Command::new(BINARY)
            .arg("mcp")
            .env("XDG_RUNTIME_DIR", &runtime.root)
            .env("CHATGPT_LINUX_APP_ID", "t")
            .env_remove("CHATGPT_APP_ID")
            .env_remove("CHATGPT_LINUX_INSTANCE_ID")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut process = Self {
            child,
            stdin,
            stdout,
            next_id: 2,
        };
        process.send(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "authorization-test", "version": "1"}
            }
        }));
        let initialized = process.response(1);
        assert!(initialized.get("result").is_some(), "{initialized}");
        process.send(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }));
        process
    }

    fn call_doctor(&mut self) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": {"name": "doctor", "arguments": {}}
        }));
        self.response(id)
    }

    fn send(&mut self, message: &Value) {
        writeln!(self.stdin, "{message}").unwrap();
        self.stdin.flush().unwrap();
    }

    fn response(&mut self, id: u64) -> Value {
        loop {
            let mut line = String::new();
            assert_ne!(self.stdout.read_line(&mut line).unwrap(), 0);
            let message: Value = serde_json::from_str(&line).unwrap();
            if message.get("id").and_then(Value::as_u64) == Some(id) {
                return message;
            }
        }
    }
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn mcp_tool_call_denies_without_live_authority() {
    let runtime = TestRuntime::new();
    let mut process = McpProcess::start(&runtime);

    let response = process.call_doctor();

    assert_eq!(response["result"]["isError"], true, "{response}");
    assert!(response["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("authorization"));
}

#[test]
fn mcp_tool_call_revalidates_allow_then_revoke() {
    let runtime = TestRuntime::new();
    let authority = runtime.authority(vec![Reply::Allow(7, [0x77; 32]), Reply::Deny(8)]);
    let mut process = McpProcess::start(&runtime);

    let allowed = process.call_doctor();
    let revoked = process.call_doctor();

    assert_ne!(allowed["result"]["isError"], true, "{allowed}");
    assert_eq!(revoked["result"]["isError"], true, "{revoked}");
    authority.join().unwrap();
}

#[test]
fn direct_doctor_cli_is_not_authority_gated() {
    let runtime = TestRuntime::new();
    let output = Command::new(BINARY)
        .arg("doctor")
        .env("XDG_RUNTIME_DIR", &runtime.root)
        .env("CHATGPT_LINUX_APP_ID", "t")
        .output()
        .unwrap();

    assert!(output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(report.is_object());
}

#[test]
fn sibling_authority_helper_process() {
    let Some(socket) = std::env::var_os(SIBLING_HELPER_SOCKET_ENV).map(PathBuf::from) else {
        return;
    };
    let ready = PathBuf::from(std::env::var_os(SIBLING_HELPER_READY_ENV).unwrap());
    let observed_bytes = PathBuf::from(std::env::var_os(SIBLING_HELPER_BYTES_ENV).unwrap());
    let listener = UnixListener::bind(&socket).unwrap();
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).unwrap();
    fs::write(ready, b"ready").unwrap();

    let (mut stream, _) = listener.accept().unwrap();
    let mut request = Vec::new();
    stream.read_to_end(&mut request).unwrap();
    fs::write(observed_bytes, request).unwrap();
}

#[test]
fn mcp_rejects_live_same_uid_sibling_authority_before_transmitting_check() {
    let runtime = TestRuntime::new();
    let ready = runtime.root.join("sibling-ready");
    let observed_bytes = runtime.root.join("sibling-bytes");
    let mut helper = Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("sibling_authority_helper_process")
        .arg("--nocapture")
        .env(SIBLING_HELPER_SOCKET_ENV, &runtime.socket)
        .env(SIBLING_HELPER_READY_ENV, &ready)
        .env(SIBLING_HELPER_BYTES_ENV, &observed_bytes)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready.exists() {
        if let Some(status) = helper.try_wait().unwrap() {
            panic!("sibling authority helper exited before readiness: {status}");
        }
        assert!(
            Instant::now() < deadline,
            "sibling authority helper did not become ready"
        );
        thread::sleep(Duration::from_millis(10));
    }

    let mut process = McpProcess::start(&runtime);
    let response = process.call_doctor();

    assert_eq!(response["result"]["isError"], true, "{response}");
    assert!(helper.wait().unwrap().success());
    assert_eq!(fs::read(observed_bytes).unwrap(), b"");
}
