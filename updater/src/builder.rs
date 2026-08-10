//! Rebuilds native Linux packages from a downloaded official OpenAI ChatGPT DMG.

use crate::{
    config::{RuntimeConfig, RuntimePaths},
    install::PackageKind,
    package_verification, redaction,
    state::{ArtifactPaths, PersistedState, UpdateStatus},
};
use anyhow::{Context, Result};
use serde::Serialize;
use std::{
    ffi::OsString,
    fs, io,
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    process::Command as StdCommand,
};
use tokio::process::Command;
use tracing::info;

const UPDATE_BUILDER_MANIFEST: &str = ".chatgpt-linux/update-builder-manifest.txt";
const TRUSTED_SYSTEM_PATH: &str = "/usr/sbin:/usr/bin:/sbin:/bin";
const TRUSTED_GIT_PATHS: &[&str] = &["/usr/bin/git", "/bin/git"];
const PREBUILT_HELPERS_DIR: &str = "prebuilt-helpers";
const COMPUTER_USE_BACKEND_HELPER: &str = "chatgpt-computer-use-linux";
const COMPUTER_USE_COSMIC_HELPER: &str = "chatgpt-computer-use-cosmic";
const MUTATION_BROKER_HELPER: &str = "chatgpt-generated-app-mutation-broker";
const MUTATION_BROKER_DIGEST: &str = "chatgpt-generated-app-mutation-broker.sha256";
const MUTATION_BROKER_SOURCE_ENV: &str = "CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE";
const PREBUILT_HELPER_ENV_MAPPINGS: [(&str, &str); 4] = [
    (
        "chatgpt-chrome-extension-host",
        "CHATGPT_CHROME_EXTENSION_HOST_SOURCE",
    ),
    (
        "chatgpt-notification-actions-linux",
        "CHATGPT_NOTIFICATION_ACTIONS_SOURCE",
    ),
    (
        "chatgpt-global-dictation-linux",
        "CHATGPT_GLOBAL_DICTATION_LINUX_SOURCE",
    ),
    (
        "chatgpt-read-aloud-linux",
        "CHATGPT_LINUX_READ_ALOUD_MCP_SOURCE",
    ),
];

const REQUIRED_BUNDLE_FILES: [(&str, &str); 23] = [
    ("Cargo.toml", "Cargo.toml"),
    ("Cargo.lock", "Cargo.lock"),
    ("computer-use-linux", "computer-use-linux"),
    (
        "generated-app-mutation-broker",
        "generated-app-mutation-broker",
    ),
    ("notification-actions-linux", "notification-actions-linux"),
    ("read-aloud-linux", "read-aloud-linux"),
    ("record-replay-linux", "record-replay-linux"),
    ("updater", "updater"),
    (
        "plugins/openai-bundled/plugins/computer-use",
        "plugins/openai-bundled/plugins/computer-use",
    ),
    (
        "plugins/openai-bundled/plugins/read-aloud",
        "plugins/openai-bundled/plugins/read-aloud",
    ),
    ("install.sh", "install.sh"),
    ("launcher/start.sh.template", "launcher/start.sh.template"),
    ("launcher/cli-launch-path.py", "launcher/cli-launch-path.py"),
    ("launcher/webview-server.py", "launcher/webview-server.py"),
    ("scripts/build-deb.sh", "scripts/build-deb.sh"),
    (
        "scripts/patch-linux-window-ui.js",
        "scripts/patch-linux-window-ui.js",
    ),
    ("scripts/patches", "scripts/patches"),
    ("scripts/lib", "scripts/lib"),
    (
        "scripts/validate-upstream-dmg.js",
        "scripts/validate-upstream-dmg.js",
    ),
    ("packaging/linux", "packaging/linux"),
    ("assets/chatgpt.png", "assets/chatgpt.png"),
    ("assets/chatgpt-linux.png", "assets/chatgpt-linux.png"),
    ("port-integrations", "port-integrations"),
];
const OPTIONAL_BUNDLE_FILES: [(&str, &str); 7] = [
    ("CHANGELOG.md", "CHANGELOG.md"),
    (
        ".chatgpt-linux/source-info.json",
        ".chatgpt-linux/source-info.json",
    ),
    ("scripts/build-rpm.sh", "scripts/build-rpm.sh"),
    ("scripts/build-pacman.sh", "scripts/build-pacman.sh"),
    (
        "scripts/rebuild-candidate.sh",
        "scripts/rebuild-candidate.sh",
    ),
    ("node-runtime", "node-runtime"),
    (PREBUILT_HELPERS_DIR, PREBUILT_HELPERS_DIR),
];
const BUILDER_ONLY_PAYLOAD_FILES: [(&str, &str); 2] = [
    ("node-runtime", "node-runtime"),
    (PREBUILT_HELPERS_DIR, PREBUILT_HELPERS_DIR),
];
const PACMAN_PACKAGE_SUFFIXES: &[&str] = &[
    ".pkg.tar.zst",
    ".pkg.tar.xz",
    ".pkg.tar.gz",
    ".pkg.tar.bz2",
    ".pkg.tar.lz",
    ".pkg.tar.lz4",
    ".pkg.tar.lz5",
];

#[derive(Debug, Clone, PartialEq, Eq)]
/// Paths to the temporary workspace and generated package produced by a rebuild.
pub struct BuildArtifacts {
    pub workspace_dir: PathBuf,
    pub package_path: PathBuf,
}

/// Rebuilds a Linux package from the downloaded official OpenAI ChatGPT DMG.
pub async fn build_update(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    candidate_version: &str,
    dmg_path: &Path,
) -> Result<BuildArtifacts> {
    build_update_from(
        &config.builder_bundle_root,
        config,
        state,
        paths,
        candidate_version,
        dmg_path,
    )
    .await
}

/// Rebuilds a Linux package using an explicit wrapper/builder source tree.
pub async fn build_update_from(
    bundle_source: &Path,
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    candidate_version: &str,
    dmg_path: &Path,
) -> Result<BuildArtifacts> {
    let workspace = BuilderWorkspace::prepare(&config.workspace_root, candidate_version)?;

    state.status = UpdateStatus::PreparingWorkspace;
    state.package_verification = None;
    state.artifact_paths.workspace_dir = Some(workspace.workspace_dir.clone());
    state.save_updater(&paths.state_file)?;

    let trusted_dmg_sha256 = state
        .dmg_sha256
        .as_deref()
        .context("Ready update is missing a trusted DMG digest before package verification")?;
    let current_dmg_sha256 = package_verification::file_sha256(dmg_path)?;
    anyhow::ensure!(
        current_dmg_sha256 == trusted_dmg_sha256,
        "Downloaded DMG digest changed before package build"
    );

    copy_builder_bundle(bundle_source, &workspace.bundle_dir)?;
    let build_path = build_command_path(&config.builder_bundle_root)?;
    let managed_node_source = if config.builder_bundle_root.join("node-runtime").exists() {
        config.builder_bundle_root.join("node-runtime")
    } else {
        bundle_source.join("node-runtime")
    };
    let integration_config = crate::config::effective_integration_config_path(config);
    let prebuilt_helpers = PrebuiltHelperSources::from_bundle(&config.builder_bundle_root)?;
    stage_git_source_info(bundle_source, &workspace.bundle_dir)?;

    state.status = UpdateStatus::PatchingApp;
    state.save_updater(&paths.state_file)?;
    let mut install = Command::new(workspace.bundle_dir.join("install.sh"));
    configure_build_command(&mut install, &build_path, &workspace.build_home);
    install
        .arg(dmg_path)
        .env("CHATGPT_INSTALL_DIR", &workspace.app_dir)
        .env(
            "CHATGPT_PATCH_REPORT_JSON",
            workspace.reports_dir.join("patch-report.json"),
        )
        .env(
            "CHATGPT_REBUILD_REPORT_JSON",
            workspace.reports_dir.join("rebuild-report.json"),
        )
        .env("CHATGPT_ACCEPTANCE_OVERRIDE", "0")
        .env("CHATGPT_MANAGED_NODE_SOURCE", managed_node_source)
        .current_dir(&workspace.bundle_dir);
    // Honor the user's saved integration selection (the in-app Update picker
    // writes it to a stable per-user path) so the rebuild stages exactly those
    // integrations. Only set it when the file actually exists; an absent path
    // lets port-integrations.js use its bundled defaults.
    if let Some(integration_config) = &integration_config {
        install.env("CHATGPT_PORT_INTEGRATIONS_CONFIG", integration_config);
    }
    prebuilt_helpers.apply_to(&mut install);
    run_and_log(&mut install, &workspace.install_log)
        .await
        .context("install.sh failed during local rebuild")?;

    state.status = UpdateStatus::BuildingPackage;
    let package_version = read_app_package_version(&workspace.app_dir)?;
    state.candidate_version = Some(package_version.clone());
    state.save_updater(&paths.state_file)?;

    let build_script = package_build_script(&workspace.bundle_dir);
    let mut package_build = Command::new(&build_script);
    configure_build_command(&mut package_build, &build_path, &workspace.build_home);
    package_build
        .env("PACKAGE_VERSION", &package_version)
        .env("APP_DIR_OVERRIDE", &workspace.app_dir)
        .env("DIST_DIR_OVERRIDE", &workspace.dist_dir)
        .env("UPDATER_BINARY_SOURCE", std::env::current_exe()?)
        .env(
            "UPDATER_SERVICE_SOURCE",
            workspace
                .bundle_dir
                .join("packaging/linux/chatgpt-updater.service"),
        )
        .current_dir(&workspace.bundle_dir);
    if let Some(integration_config) = &integration_config {
        package_build.env("CHATGPT_PORT_INTEGRATIONS_CONFIG", integration_config);
    }
    prebuilt_helpers.apply_mutation_broker_to(&mut package_build);
    run_and_log(&mut package_build, &workspace.build_log)
        .await
        .with_context(|| format!("{} failed during local rebuild", build_script.display()))?;

    let package_path = find_package_in(&workspace.dist_dir)?;
    state.package_verification = Some(package_verification::record_built_package(
        &package_path,
        &workspace.workspace_dir,
        &package_version,
        &current_dmg_sha256,
    )?);
    state.status = UpdateStatus::ReadyToInstall;
    state.artifact_paths = ArtifactPaths {
        dmg_path: Some(dmg_path.to_path_buf()),
        workspace_dir: Some(workspace.workspace_dir.clone()),
        package_path: Some(package_path.clone()),
        rollback_package_path: state.artifact_paths.rollback_package_path.clone(),
    };
    state.save_updater(&paths.state_file)?;
    info!(candidate_version = %package_version, package = %package_path.display(), "local update build ready");

    Ok(BuildArtifacts {
        workspace_dir: workspace.workspace_dir,
        package_path,
    })
}

#[derive(Debug, Clone)]
struct BuilderWorkspace {
    workspace_dir: PathBuf,
    bundle_dir: PathBuf,
    dist_dir: PathBuf,
    app_dir: PathBuf,
    reports_dir: PathBuf,
    build_home: PathBuf,
    install_log: PathBuf,
    build_log: PathBuf,
}

#[derive(Debug)]
struct PrebuiltHelperSources {
    mutation_broker: PathBuf,
    computer_use_backend: Option<PathBuf>,
    computer_use_cosmic: Option<PathBuf>,
    independent: Vec<(&'static str, PathBuf)>,
}

impl PrebuiltHelperSources {
    fn from_bundle(bundle_root: &Path) -> Result<Self> {
        let helpers_dir = bundle_root.join(PREBUILT_HELPERS_DIR);
        let mutation_broker = required_mutation_broker_from_bundle(bundle_root)?;
        let computer_use_backend =
            trusted_prebuilt_helper(&helpers_dir, COMPUTER_USE_BACKEND_HELPER);
        let computer_use_cosmic = trusted_prebuilt_helper(&helpers_dir, COMPUTER_USE_COSMIC_HELPER);
        let (computer_use_backend, computer_use_cosmic) =
            match (computer_use_backend, computer_use_cosmic) {
                (Some(backend), Some(cosmic)) => (Some(backend), Some(cosmic)),
                _ => (None, None),
            };

        Ok(Self {
            mutation_broker,
            computer_use_backend,
            computer_use_cosmic,
            independent: PREBUILT_HELPER_ENV_MAPPINGS
                .iter()
                .filter_map(|(helper, env_name)| {
                    trusted_prebuilt_helper(&helpers_dir, helper).map(|path| (*env_name, path))
                })
                .collect(),
        })
    }

    fn apply_to(&self, command: &mut Command) {
        self.apply_mutation_broker_to(command);
        if let (Some(backend), Some(cosmic)) =
            (&self.computer_use_backend, &self.computer_use_cosmic)
        {
            command
                .env("CHATGPT_LINUX_COMPUTER_USE_BACKEND_SOURCE", backend)
                .env("CHATGPT_LINUX_COMPUTER_USE_COSMIC_SOURCE", cosmic);
        }
        for (env_name, helper) in &self.independent {
            command.env(env_name, helper);
        }
    }

    fn apply_mutation_broker_to(&self, command: &mut Command) {
        command.env(MUTATION_BROKER_SOURCE_ENV, &self.mutation_broker);
    }
}

impl BuilderWorkspace {
    fn prepare(workspace_root: &Path, candidate_version: &str) -> Result<Self> {
        let workspace_dir = workspace_root.join("workspaces").join(candidate_version);
        let bundle_dir = workspace_dir.join("builder");
        let dist_dir = workspace_dir.join("dist");
        let app_dir = workspace_dir.join("chatgpt");
        let logs_dir = workspace_dir.join("logs");
        let reports_dir = workspace_dir.join("reports");
        let build_home = workspace_dir.join("build-home");
        let install_log = logs_dir.join("install.log");
        let build_log = logs_dir.join("build-package.log");

        if workspace_dir.exists() {
            fs::remove_dir_all(&workspace_dir)
                .with_context(|| format!("Failed to remove {}", workspace_dir.display()))?;
        }

        fs::create_dir_all(&logs_dir)
            .with_context(|| format!("Failed to create {}", logs_dir.display()))?;
        fs::create_dir_all(&reports_dir)
            .with_context(|| format!("Failed to create {}", reports_dir.display()))?;
        fs::create_dir_all(&build_home)
            .with_context(|| format!("Failed to create {}", build_home.display()))?;

        Ok(Self {
            workspace_dir,
            bundle_dir,
            dist_dir,
            app_dir,
            reports_dir,
            build_home,
            install_log,
            build_log,
        })
    }
}

/// Returns the path to the native-package build script appropriate for the running system.
fn package_build_script(bundle_dir: &Path) -> PathBuf {
    match PackageKind::detect() {
        PackageKind::Rpm => bundle_dir.join("scripts/build-rpm.sh"),
        PackageKind::Pacman => bundle_dir.join("scripts/build-pacman.sh"),
        PackageKind::Deb => bundle_dir.join("scripts/build-deb.sh"),
    }
}

fn copy_builder_bundle(source_root: &Path, destination_root: &Path) -> Result<()> {
    let manifest_path = source_root.join(UPDATE_BUILDER_MANIFEST);
    if manifest_path.exists() {
        return copy_builder_bundle_from_manifest(source_root, destination_root, &manifest_path);
    }

    for (source, destination) in REQUIRED_BUNDLE_FILES {
        copy_entry(
            &source_root.join(source),
            &destination_root.join(destination),
            false,
        )?;
    }

    for (source, destination) in OPTIONAL_BUNDLE_FILES {
        copy_entry(
            &source_root.join(source),
            &destination_root.join(destination),
            true,
        )?;
    }

    Ok(())
}

/// Seeds generated files that exist only in an installed update-builder bundle.
///
/// A fresh wrapper checkout has source files but not the managed Node.js runtime
/// generated during app packaging. Packaged wrapper updates overlay this payload
/// before calling [`build_update_from`] so the normal builder-bundle copy sees a
/// complete source tree without reusing installed source metadata.
pub fn seed_builder_only_payload(source_root: &Path, destination_root: &Path) -> Result<()> {
    for (source, destination) in BUILDER_ONLY_PAYLOAD_FILES {
        let destination = destination_root.join(destination);
        remove_existing_payload_path(&destination)?;
        copy_entry(&source_root.join(source), &destination, false)?;
    }

    Ok(())
}

fn remove_existing_payload_path(path: &Path) -> Result<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| format!("Failed to stat {}", path.display()));
        }
    };

    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).with_context(|| format!("Failed to remove {}", path.display()))
    } else {
        fs::remove_file(path).with_context(|| format!("Failed to remove {}", path.display()))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitSourceInfo {
    commit: String,
    short_commit: String,
    branch: Option<String>,
    remote: Option<String>,
    describe: Option<String>,
    dirty: Option<bool>,
    provenance: &'static str,
}

impl GitSourceInfo {
    fn capture(source_root: &Path) -> Option<Self> {
        let top_level = git_capture(source_root, &["rev-parse", "--show-toplevel"])?;
        let source_root = fs::canonicalize(source_root).ok()?;
        let top_level = fs::canonicalize(top_level).ok()?;
        if source_root != top_level {
            return None;
        }

        let commit = git_capture(source_root.as_path(), &["rev-parse", "HEAD"])?;
        let status = git_capture(
            source_root.as_path(),
            &["status", "--porcelain", "--untracked-files=normal"],
        );
        Some(Self {
            short_commit: commit.chars().take(12).collect(),
            commit,
            branch: non_empty(git_capture(
                source_root.as_path(),
                &["branch", "--show-current"],
            )),
            remote: sanitize_git_remote(non_empty(git_capture(
                source_root.as_path(),
                &["remote", "get-url", "origin"],
            ))),
            describe: non_empty(git_capture(
                source_root.as_path(),
                &["describe", "--always", "--dirty", "--tags"],
            )),
            dirty: status.map(|value| !value.trim().is_empty()),
            provenance: "git",
        })
    }
}

fn git_capture(repo: &Path, args: &[&str]) -> Option<String> {
    let git = trusted_system_program(TRUSTED_GIT_PATHS)?;
    let output = StdCommand::new(git)
        .env_clear()
        .env("HOME", "/nonexistent")
        .env("XDG_CONFIG_HOME", "/nonexistent")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("LC_ALL", "C")
        .env("PATH", TRUSTED_SYSTEM_PATH)
        .arg("-C")
        .arg(repo)
        .args(["-c", "core.fsmonitor=false"])
        .args(["-c", "core.hooksPath=/dev/null"])
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|value| value.trim().to_string())
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|item| !item.is_empty())
}

fn sanitize_git_remote(remote: Option<String>) -> Option<String> {
    let value = remote?.trim().to_string();
    if value.is_empty()
        || Path::new(&value).is_absolute()
        || value.starts_with("./")
        || value.starts_with("../")
        || value.starts_with('~')
        || value.contains('\\')
    {
        return None;
    }

    if let Ok(mut url) = reqwest::Url::parse(&value) {
        if !matches!(url.scheme(), "http" | "https" | "ssh" | "git") || url.host_str().is_none() {
            return None;
        }
        url.set_username("").ok()?;
        url.set_password(None).ok()?;
        url.set_query(None);
        url.set_fragment(None);
        return Some(url.to_string());
    }

    sanitize_scp_like_git_remote(&value)
}

fn sanitize_scp_like_git_remote(remote: &str) -> Option<String> {
    if remote.contains("::")
        || remote.chars().any(char::is_whitespace)
        || remote.contains(['?', '#'])
    {
        return None;
    }

    let host_start = remote.rfind('@').map_or(0, |index| index + 1);
    let separator = host_start + remote[host_start..].find(':')?;
    let authority = &remote[..separator];
    let path = &remote[separator + 1..];
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if host.is_empty()
        || host.contains(['/', '\\', ':'])
        || path.is_empty()
        || path.starts_with(['/', '.', '~'])
    {
        return None;
    }

    Some(format!("{host}:{path}"))
}

fn stage_git_source_info(source_root: &Path, destination_root: &Path) -> Result<()> {
    let Some(source_info) = GitSourceInfo::capture(source_root) else {
        return Ok(());
    };
    let info_path = destination_root.join(".chatgpt-linux/source-info.json");
    let info_dir = info_path
        .parent()
        .context("Source info path has no parent directory")?;
    fs::create_dir_all(info_dir)
        .with_context(|| format!("Failed to create {}", info_dir.display()))?;
    fs::write(
        &info_path,
        format!("{}\n", serde_json::to_string_pretty(&source_info)?),
    )
    .with_context(|| format!("Failed to write {}", info_path.display()))?;
    Ok(())
}

fn copy_builder_bundle_from_manifest(
    source_root: &Path,
    destination_root: &Path,
    manifest_path: &Path,
) -> Result<()> {
    let manifest = fs::read_to_string(manifest_path)
        .with_context(|| format!("Failed to read {}", manifest_path.display()))?;

    for (index, line) in manifest.lines().enumerate() {
        let entry = line.trim();
        if entry.is_empty() || entry.starts_with('#') {
            continue;
        }
        let relative_path = Path::new(entry);
        if !is_safe_manifest_relative_path(relative_path) {
            anyhow::bail!(
                "Unsafe update-builder manifest entry at line {}: {}",
                index + 1,
                entry
            );
        }
        copy_entry(
            &source_root.join(relative_path),
            &destination_root.join(relative_path),
            false,
        )?;
    }

    copy_entry(
        manifest_path,
        &destination_root.join(UPDATE_BUILDER_MANIFEST),
        false,
    )?;
    Ok(())
}

fn is_safe_manifest_relative_path(path: &Path) -> bool {
    let mut has_component = false;
    for component in path.components() {
        match component {
            Component::Normal(_) => has_component = true,
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    has_component && !path.is_absolute()
}

fn copy_entry(source: &Path, destination: &Path, optional: bool) -> Result<()> {
    if !source.exists() {
        if optional {
            return Ok(());
        }
        anyhow::bail!(
            "Required builder bundle path is missing: {}",
            source.display()
        );
    }

    validate_builder_source_entry(source)?;

    if source.is_dir() {
        copy_dir_recursive(source, destination)?;
    } else {
        copy_path(source, destination)?;
    }

    Ok(())
}

fn validate_builder_source_entry(source: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(source)
        .with_context(|| format!("Failed to stat {}", source.display()))?;
    anyhow::ensure!(
        !metadata.file_type().is_symlink(),
        "Builder bundle path must not be a symlink: {}",
        source.display()
    );
    anyhow::ensure!(
        metadata.permissions().mode() & 0o022 == 0,
        "Builder bundle path must not be group/world writable: {}",
        source.display()
    );
    Ok(())
}

fn copy_path(source: &Path, destination: &Path) -> Result<()> {
    let parent = destination
        .parent()
        .context("Destination path has no parent directory")?;
    fs::create_dir_all(parent).with_context(|| format!("Failed to create {}", parent.display()))?;
    fs::copy(source, destination).with_context(|| {
        format!(
            "Failed to copy {} to {}",
            source.display(),
            destination.display()
        )
    })?;
    let metadata =
        fs::metadata(source).with_context(|| format!("Failed to stat {}", source.display()))?;
    fs::set_permissions(destination, metadata.permissions())
        .with_context(|| format!("Failed to set permissions on {}", destination.display()))?;
    Ok(())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)
        .with_context(|| format!("Failed to create {}", destination.display()))?;

    for entry in
        fs::read_dir(source).with_context(|| format!("Failed to read {}", source.display()))?
    {
        let entry = entry?;
        let entry_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        validate_builder_source_entry(&entry_path)?;

        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry_path, &destination_path)?;
        } else {
            copy_path(&entry_path, &destination_path)?;
        }
    }

    Ok(())
}

/// Find a native package file inside `dist_dir`.
fn find_package_in(dist_dir: &Path) -> Result<PathBuf> {
    for entry in
        fs::read_dir(dist_dir).with_context(|| format!("Failed to read {}", dist_dir.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        if is_native_package_file(&path) {
            return Ok(path);
        }
    }

    anyhow::bail!(
        "No native package (.deb, .rpm, or .pkg.tar.*) found in {}",
        dist_dir.display()
    )
}

fn is_native_package_file(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    name.ends_with(".deb")
        || name.ends_with(".rpm")
        || PACMAN_PACKAGE_SUFFIXES
            .iter()
            .any(|suffix| name.ends_with(suffix))
}

fn read_app_package_version(app_dir: &Path) -> Result<String> {
    let version_file = app_dir.join("chatgpt-version.env");
    let contents = fs::read_to_string(&version_file)
        .with_context(|| format!("Failed to read {}", version_file.display()))?;
    let version = contents
        .lines()
        .find_map(|line| line.strip_prefix("CHATGPT_APP_PACKAGE_VERSION="))
        .map(|value| value.trim_matches(['"', '\'']))
        .context("chatgpt-version.env is missing CHATGPT_APP_PACKAGE_VERSION")?;

    if version
        .split('.')
        .all(|segment| !segment.is_empty() && segment.chars().all(|ch| ch.is_ascii_digit()))
        && matches!(version.split('.').count(), 3 | 4)
    {
        Ok(version.to_string())
    } else {
        anyhow::bail!("Invalid CHATGPT_APP_PACKAGE_VERSION: {version}")
    }
}

fn build_command_path(builder_bundle_root: &Path) -> Result<OsString> {
    let mut entries = managed_node_bin_dirs(builder_bundle_root);
    entries.extend(system_bin_dirs());
    std::env::join_paths(entries).context("Could not construct trusted updater build PATH")
}

fn managed_node_bin_dirs(builder_bundle_root: &Path) -> Vec<PathBuf> {
    let bin_dir = builder_bundle_root.join("node-runtime/bin");
    if is_node_toolchain_dir(&bin_dir) {
        vec![bin_dir]
    } else {
        Vec::new()
    }
}

fn system_bin_dirs() -> Vec<PathBuf> {
    TRUSTED_SYSTEM_PATH.split(':').map(PathBuf::from).collect()
}

fn configure_build_command(command: &mut Command, build_path: &OsString, build_home: &Path) {
    command
        .env_clear()
        .env("HOME", build_home)
        .env("PATH", build_path);
}

fn trusted_system_program(candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|path| is_executable_file(path))
}

fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

fn trusted_prebuilt_helper(helpers_dir: &Path, helper_name: &str) -> Option<PathBuf> {
    let helper = helpers_dir.join(helper_name);
    fs::symlink_metadata(&helper)
        .ok()
        .filter(|metadata| {
            metadata.file_type().is_file() && metadata.permissions().mode() & 0o111 != 0
        })
        .map(|_| helper)
}

fn host_elf_machine() -> Result<u16> {
    match std::env::consts::ARCH {
        "x86_64" => Ok(62),
        "aarch64" => Ok(183),
        "arm" => Ok(40),
        "x86" => Ok(3),
        architecture => anyhow::bail!(
            "Unsupported host architecture for generated-app mutation broker: {architecture}"
        ),
    }
}

fn host_elf_class() -> Result<u8> {
    match std::env::consts::ARCH {
        "x86_64" | "aarch64" => Ok(2),
        "arm" | "x86" => Ok(1),
        architecture => anyhow::bail!(
            "Unsupported host architecture for generated-app mutation broker: {architecture}"
        ),
    }
}

fn required_mutation_broker_from_bundle(bundle_root: &Path) -> Result<PathBuf> {
    let helpers_dir = bundle_root.join(PREBUILT_HELPERS_DIR);
    let broker = helpers_dir.join(MUTATION_BROKER_HELPER);
    let digest_path = helpers_dir.join(MUTATION_BROKER_DIGEST);

    let metadata = fs::symlink_metadata(&broker).with_context(|| {
        format!(
            "Required generated-app mutation broker is missing: {}",
            broker.display()
        )
    })?;
    anyhow::ensure!(
        metadata.file_type().is_file()
            && !metadata.file_type().is_symlink()
            && metadata.permissions().mode() & 0o111 != 0,
        "Required generated-app mutation broker must be a regular non-symlink executable: {}",
        broker.display()
    );
    anyhow::ensure!(
        metadata.permissions().mode() & 0o022 == 0,
        "Required generated-app mutation broker must not be group- or world-writable: {}",
        broker.display()
    );

    let digest_metadata = fs::symlink_metadata(&digest_path).with_context(|| {
        format!(
            "Required generated-app mutation broker digest is missing: {}",
            digest_path.display()
        )
    })?;
    anyhow::ensure!(
        digest_metadata.file_type().is_file() && !digest_metadata.file_type().is_symlink(),
        "Required generated-app mutation broker digest must be a regular non-symlink file: {}",
        digest_path.display()
    );

    let expected_digest = package_verification::file_sha256(&broker)?;
    let expected_manifest = format!("{expected_digest}  {MUTATION_BROKER_HELPER}\n");
    let manifest = fs::read_to_string(&digest_path)
        .with_context(|| format!("Failed to read {}", digest_path.display()))?;
    anyhow::ensure!(
        manifest == expected_manifest,
        "Generated-app mutation broker digest manifest is malformed or does not match {}",
        broker.display()
    );

    let elf = fs::read(&broker).with_context(|| format!("Failed to read {}", broker.display()))?;
    anyhow::ensure!(
        elf.len() >= 20 && elf[..4] == *b"\x7fELF" && elf[4] == host_elf_class()? && elf[5] == 1,
        "Generated-app mutation broker ELF class and endianness must match this host: {}",
        broker.display()
    );
    let machine = u16::from_le_bytes([elf[18], elf[19]]);
    anyhow::ensure!(
        machine == host_elf_machine()?,
        "Generated-app mutation broker ELF architecture does not match this host: {}",
        broker.display()
    );
    Ok(broker)
}

fn is_node_toolchain_dir(path: &Path) -> bool {
    ["node", "npm", "npx"]
        .into_iter()
        .all(|binary| path.join(binary).is_file())
}

async fn run_and_log(command: &mut Command, log_path: &Path) -> Result<()> {
    let output = command
        .output()
        .await
        .context("Failed to spawn external command")?;

    let mut combined = Vec::new();
    combined.extend_from_slice(&output.stdout);
    combined.extend_from_slice(&output.stderr);
    fs::write(log_path, redaction::redact_bytes_for_persistence(&combined))
        .with_context(|| format!("Failed to write {}", log_path.display()))?;

    if !output.status.success() {
        anyhow::bail!(
            "Command failed with status {:?}; see {}",
            output.status.code(),
            log_path.display()
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::RuntimePaths;
    use anyhow::Result;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    enum FakePackageOutput {
        Deb,
        Rpm,
        Pacman,
    }

    const FRESH_PATCH_BUNDLE_FILES: &[&str] = &[
        "scripts/patches/descriptor.js",
        "scripts/patches/engine.js",
        "scripts/patches/runner.js",
        "scripts/patches/lib/assets.js",
        "scripts/patches/lib/minified-js.js",
        "scripts/patches/lib/settings-keys.js",
        "scripts/patches/impl/webview/index.js",
        "scripts/patches/core/all-linux/main-process/lifecycle/patch.js",
        "scripts/patches/core/all-linux/webview/theme-and-sunset/patch.js",
    ];

    fn host_tool(name: &str) -> Result<PathBuf> {
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .filter(|directory| directory.is_absolute())
            .map(|directory| directory.join(name))
            .find(|candidate| {
                fs::metadata(candidate).is_ok_and(|metadata| {
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                })
            })
            .with_context(|| format!("host tool {name} not found in PATH"))
    }

    fn host_bash_script(body: &str) -> Result<String> {
        Ok(format!("#!{}\n{body}", host_tool("bash")?.display()))
    }

    fn initialize_test_git_repository(root: &Path, dirty: bool) -> Result<()> {
        let git = trusted_system_program(TRUSTED_GIT_PATHS)
            .context("A trusted system Git executable is required for builder metadata tests")?;
        let run = |args: &[&str]| -> Result<()> {
            let status = StdCommand::new(&git)
                .args(args)
                .current_dir(root)
                .status()?;
            anyhow::ensure!(status.success(), "git {} failed", args.join(" "));
            Ok(())
        };

        run(&["init", "--quiet"])?;
        run(&["symbolic-ref", "HEAD", "refs/heads/main"])?;
        run(&["config", "user.name", "ChatGPT Builder Test"])?;
        run(&["config", "user.email", "builder-test@example.invalid"])?;
        fs::write(root.join(".source-info-test"), b"source metadata fixture\n")?;
        run(&["add", "."])?;
        run(&["commit", "--quiet", "-m", "test builder metadata"])?;
        run(&["tag", "v0.10.2"])?;
        run(&[
            "remote",
            "add",
            "origin",
            "https://builder:secret-token@github.com/example/chatgpt-linux.git",
        ])?;
        if dirty {
            fs::write(
                root.join(".source-info-test"),
                b"dirty source metadata fixture\n",
            )?;
        }
        Ok(())
    }

    fn write_fake_build_script(path: &Path, output: FakePackageOutput) -> Result<()> {
        let script_body = match output {
            FakePackageOutput::Deb => {
                r#"set -euo pipefail
mkdir -p "${DIST_DIR_OVERRIDE}"
printf '%s\n' "$PATH" > "${DIST_DIR_OVERRIDE}/package-build-path"
printf '%s\n' "${CHATGPT_UNTRUSTED_TEST:-}" > "${DIST_DIR_OVERRIDE}/package-build-untrusted"
printf '%s\n' "${NODE_OPTIONS:-}" > "${DIST_DIR_OVERRIDE}/package-build-node-options"
printf '%s\n' "$HOME" > "${DIST_DIR_OVERRIDE}/package-build-home"
printf '%s\n' "${CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE:-}" > "${DIST_DIR_OVERRIDE}/package-mutation-broker-source"
printf '%s\n' "${CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED:-}" > "${DIST_DIR_OVERRIDE}/package-mutation-broker-resolved"
cp .chatgpt-linux/source-info.json "${DIST_DIR_OVERRIDE}/package-source-info.json"
printf 'CHATGPT_PORT_INTEGRATIONS_CONFIG=%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}"
printf '%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}" > "${DIST_DIR_OVERRIDE}/package-integration-config-path"
touch "${DIST_DIR_OVERRIDE}/chatgpt_${PACKAGE_VERSION}_amd64.deb"
"#
            }
            FakePackageOutput::Rpm => {
                r#"set -euo pipefail
mkdir -p "${DIST_DIR_OVERRIDE}"
printf '%s\n' "$PATH" > "${DIST_DIR_OVERRIDE}/package-build-path"
printf '%s\n' "${CHATGPT_UNTRUSTED_TEST:-}" > "${DIST_DIR_OVERRIDE}/package-build-untrusted"
printf '%s\n' "${NODE_OPTIONS:-}" > "${DIST_DIR_OVERRIDE}/package-build-node-options"
printf '%s\n' "$HOME" > "${DIST_DIR_OVERRIDE}/package-build-home"
printf '%s\n' "${CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE:-}" > "${DIST_DIR_OVERRIDE}/package-mutation-broker-source"
printf '%s\n' "${CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED:-}" > "${DIST_DIR_OVERRIDE}/package-mutation-broker-resolved"
cp .chatgpt-linux/source-info.json "${DIST_DIR_OVERRIDE}/package-source-info.json"
printf 'CHATGPT_PORT_INTEGRATIONS_CONFIG=%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}"
printf '%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}" > "${DIST_DIR_OVERRIDE}/package-integration-config-path"
touch "${DIST_DIR_OVERRIDE}/chatgpt-${PACKAGE_VERSION}.x86_64.rpm"
"#
            }
            FakePackageOutput::Pacman => {
                r#"set -euo pipefail
VER="${PACKAGE_VERSION%%+*}"
mkdir -p "${DIST_DIR_OVERRIDE}"
printf '%s\n' "$PATH" > "${DIST_DIR_OVERRIDE}/package-build-path"
printf '%s\n' "${CHATGPT_UNTRUSTED_TEST:-}" > "${DIST_DIR_OVERRIDE}/package-build-untrusted"
printf '%s\n' "${NODE_OPTIONS:-}" > "${DIST_DIR_OVERRIDE}/package-build-node-options"
printf '%s\n' "$HOME" > "${DIST_DIR_OVERRIDE}/package-build-home"
printf '%s\n' "${CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE:-}" > "${DIST_DIR_OVERRIDE}/package-mutation-broker-source"
printf '%s\n' "${CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED:-}" > "${DIST_DIR_OVERRIDE}/package-mutation-broker-resolved"
cp .chatgpt-linux/source-info.json "${DIST_DIR_OVERRIDE}/package-source-info.json"
printf 'CHATGPT_PORT_INTEGRATIONS_CONFIG=%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}"
printf '%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}" > "${DIST_DIR_OVERRIDE}/package-integration-config-path"
touch "${DIST_DIR_OVERRIDE}/chatgpt-${VER}-1-x86_64.pkg.tar.zst"
"#
            }
        };

        fs::write(path, host_bash_script(script_body)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
        }
        Ok(())
    }

    #[tokio::test]
    async fn run_and_log_redacts_command_output_before_writing_log() -> Result<()> {
        let temp = tempdir()?;
        let script = temp.path().join("leaky-command.sh");
        let log_path = temp.path().join("command.log");
        fs::write(
            &script,
            "#!/bin/sh\necho 'stdout token=stdout-secret'\necho 'stderr Authorization: Bearer stderr-secret' >&2\nexit 1\n",
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&script, fs::Permissions::from_mode(0o755))?;
        }

        let mut command = Command::new("/bin/sh");
        command.arg(&script).env_clear();
        let result = run_and_log(&mut command, &log_path).await;

        assert!(result.is_err());
        let log = fs::read_to_string(&log_path)?;
        assert_eq!(
            log,
            "stdout token=[REDACTED]\nstderr Authorization: [REDACTED]\n"
        );
        assert!(!log.contains("stdout-secret"));
        assert!(!log.contains("stderr-secret"));
        Ok(())
    }

    fn write_fake_computer_use_bundle(root: &Path) -> Result<()> {
        fs::write(
            root.join("Cargo.toml"),
            b"[workspace]\nmembers = [\"computer-use-linux\", \"generated-app-mutation-broker\", \"notification-actions-linux\", \"read-aloud-linux\", \"record-replay-linux\", \"updater\"]\n",
        )?;
        fs::write(root.join("Cargo.lock"), b"# fake lock\n")?;
        fs::create_dir_all(root.join("computer-use-linux/src"))?;
        fs::write(
            root.join("computer-use-linux/Cargo.toml"),
            b"[package]\nname = \"chatgpt-computer-use-linux\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(
            root.join("computer-use-linux/src/main.rs"),
            b"fn main() {}\n",
        )?;
        fs::create_dir_all(root.join("generated-app-mutation-broker/src"))?;
        fs::write(
            root.join("generated-app-mutation-broker/Cargo.toml"),
            b"[package]\nname = \"generated-app-mutation-broker\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(
            root.join("generated-app-mutation-broker/src/main.rs"),
            b"fn main() {}\n",
        )?;
        fs::create_dir_all(root.join("notification-actions-linux/src"))?;
        fs::write(
            root.join("notification-actions-linux/Cargo.toml"),
            b"[package]\nname = \"chatgpt-notification-actions-linux\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(
            root.join("notification-actions-linux/src/main.rs"),
            b"fn main() {}\n",
        )?;
        fs::create_dir_all(root.join("read-aloud-linux/src"))?;
        fs::write(
            root.join("read-aloud-linux/Cargo.toml"),
            b"[package]\nname = \"chatgpt-read-aloud-linux\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(root.join("read-aloud-linux/src/main.rs"), b"fn main() {}\n")?;
        fs::create_dir_all(root.join("record-replay-linux/src"))?;
        fs::write(
            root.join("record-replay-linux/Cargo.toml"),
            b"[package]\nname = \"chatgpt-record-replay-linux\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(
            root.join("record-replay-linux/src/main.rs"),
            b"fn main() {}\n",
        )?;
        fs::create_dir_all(root.join("updater/src"))?;
        fs::write(
            root.join("updater/Cargo.toml"),
            b"[package]\nname = \"chatgpt-updater\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )?;
        fs::write(root.join("updater/src/main.rs"), b"fn main() {}\n")?;
        fs::create_dir_all(root.join("plugins/openai-bundled/plugins/computer-use/.codex-plugin"))?;
        fs::write(
            root.join("plugins/openai-bundled/plugins/computer-use/.codex-plugin/plugin.json"),
            b"{\"name\":\"computer-use\",\"version\":\"0.1.0\"}\n",
        )?;
        fs::write(
            root.join("plugins/openai-bundled/plugins/computer-use/.mcp.json"),
            b"{\"mcpServers\":{}}\n",
        )?;
        fs::create_dir_all(root.join("plugins/openai-bundled/plugins/read-aloud/.codex-plugin"))?;
        fs::write(
            root.join("plugins/openai-bundled/plugins/read-aloud/.codex-plugin/plugin.json"),
            b"{\"name\":\"read-aloud\",\"version\":\"0.1.0\"}\n",
        )?;
        fs::write(
            root.join("plugins/openai-bundled/plugins/read-aloud/.mcp.json"),
            b"{\"mcpServers\":{}}\n",
        )?;
        Ok(())
    }

    fn write_fake_port_integrations_bundle(root: &Path) -> Result<()> {
        fs::create_dir_all(root.join("port-integrations/example-integration"))?;
        fs::write(
            root.join("port-integrations/integrations.example.json"),
            b"{\"enabled\":[],\"disabled\":[]}\n",
        )?;
        fs::write(
            root.join("port-integrations/example-integration/integration.json"),
            b"{\"id\":\"example-integration\"}\n",
        )?;
        Ok(())
    }

    fn write_fake_patch_bundle(root: &Path) -> Result<()> {
        for relative_path in FRESH_PATCH_BUNDLE_FILES {
            let file_path = root.join(relative_path);
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(file_path, b"module.exports = {};\n")?;
        }
        Ok(())
    }

    fn write_fake_mutation_broker_bundle(root: &Path, machine: u16) -> Result<PathBuf> {
        let helpers = root.join(PREBUILT_HELPERS_DIR);
        let broker = helpers.join("chatgpt-generated-app-mutation-broker");
        fs::create_dir_all(&helpers)?;
        let mut elf = vec![0_u8; 64];
        elf[..4].copy_from_slice(b"\x7fELF");
        elf[4] = host_elf_class()?;
        elf[5] = 1;
        elf[6] = 1;
        elf[18..20].copy_from_slice(&machine.to_le_bytes());
        fs::write(&broker, elf)?;
        fs::set_permissions(&broker, fs::Permissions::from_mode(0o755))?;
        let digest = package_verification::file_sha256(&broker)?;
        fs::write(
            helpers.join("chatgpt-generated-app-mutation-broker.sha256"),
            format!("{digest}  chatgpt-generated-app-mutation-broker\n"),
        )?;
        Ok(broker)
    }

    #[test]
    fn required_mutation_broker_accepts_matching_host_elf_and_digest() -> Result<()> {
        let temp = tempdir()?;
        let broker = write_fake_mutation_broker_bundle(temp.path(), host_elf_machine()?)?;

        assert_eq!(required_mutation_broker_from_bundle(temp.path())?, broker);
        Ok(())
    }

    #[test]
    fn required_mutation_broker_rejects_missing_tampered_wrong_arch_nonexec_and_symlink(
    ) -> Result<()> {
        let missing = tempdir()?;
        assert!(required_mutation_broker_from_bundle(missing.path()).is_err());

        let tampered = tempdir()?;
        let broker = write_fake_mutation_broker_bundle(tampered.path(), host_elf_machine()?)?;
        fs::write(&broker, b"tampered")?;
        assert!(required_mutation_broker_from_bundle(tampered.path()).is_err());

        let wrong_arch = tempdir()?;
        let other_machine = if host_elf_machine()? == 62 { 183 } else { 62 };
        write_fake_mutation_broker_bundle(wrong_arch.path(), other_machine)?;
        assert!(required_mutation_broker_from_bundle(wrong_arch.path()).is_err());

        let nonexec = tempdir()?;
        let broker = write_fake_mutation_broker_bundle(nonexec.path(), host_elf_machine()?)?;
        fs::set_permissions(&broker, fs::Permissions::from_mode(0o644))?;
        assert!(required_mutation_broker_from_bundle(nonexec.path()).is_err());

        let symlinked = tempdir()?;
        let broker = write_fake_mutation_broker_bundle(symlinked.path(), host_elf_machine()?)?;
        let actual = broker.with_extension("actual");
        fs::rename(&broker, &actual)?;
        std::os::unix::fs::symlink(&actual, &broker)?;
        assert!(required_mutation_broker_from_bundle(symlinked.path()).is_err());
        Ok(())
    }

    fn assert_fresh_patch_bundle(root: &Path) {
        for relative_path in FRESH_PATCH_BUNDLE_FILES {
            let file_path = root.join(relative_path);
            assert!(
                file_path.exists(),
                "expected fresh patch bundle file {}",
                file_path.display()
            );
        }
        let stale_registry = root
            .join("scripts/patches")
            .join("registry")
            .with_extension("js");
        assert!(
            !stale_registry.exists(),
            "stale patch registry should not be present at {}",
            stale_registry.display()
        );
    }

    #[test]
    fn builds_update_with_package_verification_and_source_metadata() -> Result<()> {
        let env_guard = crate::test_util::env_lock();
        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
            "PATH",
            "CHATGPT_LINUX_SETTINGS_FILE",
            "CHATGPT_UNTRUSTED_TEST",
            "NODE_OPTIONS",
            "CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED",
        ]);
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempdir()?;
        let bundle_root = temp.path().join("bundle");
        let state_root = temp.path().join("state");
        let cache_root = temp.path().join("cache");
        fs::create_dir_all(bundle_root.join("scripts/lib"))?;
        fs::create_dir_all(bundle_root.join("launcher"))?;
        fs::create_dir_all(bundle_root.join("packaging/linux"))?;
        fs::create_dir_all(bundle_root.join("assets"))?;
        fs::create_dir_all(bundle_root.join("node-runtime/bin"))?;
        fs::create_dir_all(bundle_root.join("prebuilt-helpers"))?;
        fs::create_dir_all(bundle_root.join(".chatgpt-linux"))?;
        write_fake_computer_use_bundle(&bundle_root)?;
        write_fake_port_integrations_bundle(&bundle_root)?;
        write_fake_patch_bundle(&bundle_root)?;
        fs::write(bundle_root.join("CHANGELOG.md"), b"# Changelog\n")?;
        fs::write(
            bundle_root.join("launcher/start.sh.template"),
            b"# fake launcher template\n",
        )?;
        fs::write(
            bundle_root.join("launcher/cli-launch-path.py"),
            b"# fake CLI launch path helper\n",
        )?;
        fs::write(
            bundle_root.join("launcher/webview-server.py"),
            b"# fake webview server\n",
        )?;
        fs::write(bundle_root.join("assets/chatgpt.png"), b"png")?;
        fs::write(bundle_root.join("assets/chatgpt-linux.png"), b"linux png")?;
        fs::write(
            bundle_root.join("packaging/linux/control"),
            "Package: chatgpt",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt.spec"),
            "Name: chatgpt",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt.desktop"),
            "[Desktop Entry]",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt-updater.service"),
            "[Unit]\nDescription=ChatGPT Update Manager\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt-updater-user-service.sh"),
            "#!/bin/bash\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt-updater.postinst"),
            "#!/bin/sh\nexit 0\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt-updater.prerm"),
            "#!/bin/sh\nexit 0\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt-updater.postrm"),
            "#!/bin/sh\nexit 0\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt-packaged-runtime.sh"),
            "#!/bin/bash\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/PKGBUILD.template"),
            "pkgname=chatgpt\n",
        )?;
        fs::write(
            bundle_root.join("packaging/linux/chatgpt.install"),
            "post_install() { :; }\n",
        )?;
        fs::write(
            bundle_root.join("install.sh"),
            host_bash_script(
                r#"set -euo pipefail
mkdir -p "${CHATGPT_INSTALL_DIR}"
printf '%s\n' "$PATH" > "${CHATGPT_INSTALL_DIR}/install-path"
printf '%s\n' "${CHATGPT_UNTRUSTED_TEST:-}" > "${CHATGPT_INSTALL_DIR}/install-untrusted"
printf '%s\n' "${NODE_OPTIONS:-}" > "${CHATGPT_INSTALL_DIR}/install-node-options"
printf '%s\n' "$HOME" > "${CHATGPT_INSTALL_DIR}/install-home"
for helper_source in \
    "$CHATGPT_GENERATED_APP_MUTATION_BROKER_SOURCE" \
    "$CHATGPT_LINUX_COMPUTER_USE_BACKEND_SOURCE" \
    "$CHATGPT_LINUX_COMPUTER_USE_COSMIC_SOURCE" \
    "$CHATGPT_CHROME_EXTENSION_HOST_SOURCE" \
    "$CHATGPT_NOTIFICATION_ACTIONS_SOURCE" \
    "$CHATGPT_GLOBAL_DICTATION_LINUX_SOURCE" \
    "$CHATGPT_LINUX_READ_ALOUD_MCP_SOURCE"; do
  [ -x "$helper_source" ]
  printf '%s\n' "$helper_source"
done > "${CHATGPT_INSTALL_DIR}/install-prebuilt-helper-sources"
echo launcher > "${CHATGPT_INSTALL_DIR}/start.sh"
chmod +x "${CHATGPT_INSTALL_DIR}/start.sh"
echo CHATGPT_APP_PACKAGE_VERSION=26.429.20946 > "${CHATGPT_INSTALL_DIR}/chatgpt-version.env"
cp .chatgpt-linux/source-info.json "${CHATGPT_INSTALL_DIR}/app-source-info.json"
printf '%s\n' "${CHATGPT_PORT_INTEGRATIONS_CONFIG:-}" > "${CHATGPT_INSTALL_DIR}/install-integration-config-path"
if [ -n "${CHATGPT_PATCH_REPORT_JSON:-}" ]; then
  mkdir -p "$(dirname "$CHATGPT_PATCH_REPORT_JSON")"
  printf '{"patches":[]}\n' > "${CHATGPT_PATCH_REPORT_JSON}"
fi
if [ -n "${CHATGPT_REBUILD_REPORT_JSON:-}" ]; then
  mkdir -p "$(dirname "$CHATGPT_REBUILD_REPORT_JSON")"
  printf '{"appDir":"%s"}\n' "${CHATGPT_INSTALL_DIR}" > "${CHATGPT_REBUILD_REPORT_JSON}"
fi
"#,
            )?,
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(
                bundle_root.join("install.sh"),
                fs::Permissions::from_mode(0o755),
            )?;
        }

        write_fake_build_script(
            &bundle_root.join("scripts/build-deb.sh"),
            FakePackageOutput::Deb,
        )?;
        write_fake_build_script(
            &bundle_root.join("scripts/build-rpm.sh"),
            FakePackageOutput::Rpm,
        )?;
        write_fake_build_script(
            &bundle_root.join("scripts/build-pacman.sh"),
            FakePackageOutput::Pacman,
        )?;
        fs::write(
            bundle_root.join("scripts/rebuild-candidate.sh"),
            b"#!/bin/bash\n",
        )?;
        fs::write(
            bundle_root.join("scripts/validate-upstream-dmg.js"),
            b"#!/usr/bin/env node\n",
        )?;
        fs::write(
            bundle_root.join("scripts/patch-linux-window-ui.js"),
            b"console.log('patched');\n",
        )?;
        fs::write(
            bundle_root.join("scripts/lib/package-common.sh"),
            b"#!/bin/bash\n",
        )?;
        fs::write(
            bundle_root.join("scripts/lib/node-runtime.sh"),
            b"#!/bin/bash\n",
        )?;
        for binary in ["node", "npm", "npx"] {
            fs::write(bundle_root.join("node-runtime/bin").join(binary), b"node")?;
        }
        for helper in [
            "chatgpt-computer-use-linux",
            "chatgpt-computer-use-cosmic",
            "chatgpt-chrome-extension-host",
            "chatgpt-notification-actions-linux",
            "chatgpt-global-dictation-linux",
            "chatgpt-read-aloud-linux",
        ] {
            let helper_path = bundle_root.join("prebuilt-helpers").join(helper);
            fs::write(&helper_path, b"#!/bin/sh\nexit 0\n")?;
            fs::set_permissions(&helper_path, fs::Permissions::from_mode(0o755))?;
        }
        let mutation_broker = write_fake_mutation_broker_bundle(&bundle_root, host_elf_machine()?)?;
        initialize_test_git_repository(&bundle_root, false)?;
        let expected_commit = git_capture(&bundle_root, &["rev-parse", "HEAD"])
            .expect("trusted Git should resolve the fixture commit");
        let expected_describe = "v0.10.2";
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: state_root.join("state.json"),
            log_file: state_root.join("service.log"),
            cache_dir: cache_root.clone(),
            state_dir: state_root.clone(),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let settings_dir = temp.path().join("settings");
        let settings_file = settings_dir.join("settings.json");
        let saved_integration_config = settings_dir.join("port-integrations.json");
        fs::create_dir_all(&settings_dir)?;
        fs::write(
            &saved_integration_config,
            b"{\"enabled\":[\"example-integration\"],\"disabled\":[]}\n",
        )?;
        let _settings_guard = crate::test_util::EnvVarGuard::set(
            &env_guard,
            "CHATGPT_LINUX_SETTINGS_FILE",
            &settings_file,
        );
        let _untrusted_guard = crate::test_util::EnvVarGuard::set(
            &env_guard,
            "CHATGPT_UNTRUSTED_TEST",
            "must-not-reach-builder",
        );
        let _node_options_guard = crate::test_util::EnvVarGuard::set(
            &env_guard,
            "NODE_OPTIONS",
            "--require=/tmp/must-not-reach-builder.js",
        );
        let _resolved_guard = crate::test_util::EnvVarGuard::set(
            &env_guard,
            "CHATGPT_GENERATED_APP_MUTATION_BROKER_RESOLVED",
            "/tmp/must-not-reach-builder",
        );

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 30,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: true,
            developer_mode: false,
            workspace_root: cache_root,
            builder_bundle_root: bundle_root.clone(),
            app_executable_path: PathBuf::from("/opt/chatgpt/electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };
        let dmg_path = temp.path().join("ChatGPT.dmg");
        fs::write(&dmg_path, b"dmg")?;
        let trusted_dmg_sha256 = package_verification::file_sha256(&dmg_path)?;

        let mut state = PersistedState::new(true);
        state.dmg_sha256 = Some(trusted_dmg_sha256.clone());
        let artifacts = runtime.block_on(build_update(
            &config,
            &mut state,
            &paths,
            "2026.03.24+abcd1234",
            &dmg_path,
        ))?;
        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert_eq!(state.candidate_version.as_deref(), Some("26.429.20946"));
        assert!(artifacts.workspace_dir.exists());
        assert!(artifacts.package_path.exists());
        assert!(artifacts
            .workspace_dir
            .join("builder/scripts/rebuild-candidate.sh")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("builder/assets/chatgpt-linux.png")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("builder/record-replay-linux/Cargo.toml")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("builder/CHANGELOG.md")
            .exists());
        assert!(!artifacts.workspace_dir.join("builder/.git").exists());
        for relative_path in [
            "chatgpt/app-source-info.json",
            "dist/package-source-info.json",
        ] {
            let source_info: serde_json::Value =
                serde_json::from_slice(&fs::read(artifacts.workspace_dir.join(relative_path))?)?;
            assert_eq!(source_info["commit"], expected_commit);
            assert_eq!(source_info["shortCommit"], &expected_commit[..12]);
            assert_eq!(source_info["branch"], "main");
            assert_eq!(
                source_info["remote"],
                "https://github.com/example/chatgpt-linux.git"
            );
            assert_eq!(source_info["describe"], expected_describe);
            assert_eq!(source_info["dirty"], false);
            assert_eq!(source_info["provenance"], "git");
        }
        for relative_path in [
            "chatgpt/install-integration-config-path",
            "dist/package-integration-config-path",
        ] {
            assert_eq!(
                fs::read_to_string(artifacts.workspace_dir.join(relative_path))?,
                format!("{}\n", saved_integration_config.display())
            );
        }
        assert!(artifacts
            .workspace_dir
            .join("builder/launcher/cli-launch-path.py")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("builder/launcher/webview-server.py")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("builder/scripts/lib/node-runtime.sh")
            .exists());
        assert_fresh_patch_bundle(&artifacts.workspace_dir.join("builder"));
        assert!(artifacts
            .workspace_dir
            .join("builder/port-integrations/integrations.example.json")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("reports/patch-report.json")
            .exists());
        assert!(artifacts
            .workspace_dir
            .join("reports/rebuild-report.json")
            .exists());
        let expected_path = std::env::join_paths([
            bundle_root.join("node-runtime/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/sbin"),
            PathBuf::from("/bin"),
        ])?;
        for relative_path in ["chatgpt/install-path", "dist/package-build-path"] {
            assert_eq!(
                fs::read_to_string(artifacts.workspace_dir.join(relative_path))?,
                format!("{}\n", expected_path.to_string_lossy())
            );
        }
        for relative_path in ["chatgpt/install-untrusted", "dist/package-build-untrusted"] {
            assert_eq!(
                fs::read_to_string(artifacts.workspace_dir.join(relative_path))?,
                "\n"
            );
        }
        for relative_path in [
            "chatgpt/install-node-options",
            "dist/package-build-node-options",
        ] {
            assert_eq!(
                fs::read_to_string(artifacts.workspace_dir.join(relative_path))?,
                "\n"
            );
        }
        for relative_path in ["chatgpt/install-home", "dist/package-build-home"] {
            assert_eq!(
                fs::read_to_string(artifacts.workspace_dir.join(relative_path))?,
                format!("{}\n", artifacts.workspace_dir.join("build-home").display())
            );
        }
        assert_eq!(
            fs::read_to_string(
                artifacts
                    .workspace_dir
                    .join("chatgpt/install-prebuilt-helper-sources"),
            )?,
            [
                "chatgpt-generated-app-mutation-broker",
                "chatgpt-computer-use-linux",
                "chatgpt-computer-use-cosmic",
                "chatgpt-chrome-extension-host",
                "chatgpt-notification-actions-linux",
                "chatgpt-global-dictation-linux",
                "chatgpt-read-aloud-linux",
            ]
            .into_iter()
            .map(|helper| bundle_root.join("prebuilt-helpers").join(helper))
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("\n")
                + "\n"
        );
        assert_eq!(
            fs::read_to_string(
                artifacts
                    .workspace_dir
                    .join("dist/package-mutation-broker-source"),
            )?,
            format!("{}\n", mutation_broker.display())
        );
        assert_eq!(
            fs::read_to_string(
                artifacts
                    .workspace_dir
                    .join("dist/package-mutation-broker-resolved"),
            )?,
            "\n"
        );
        assert!(
            is_native_package_file(&artifacts.package_path),
            "expected a native package (.deb, .rpm, or .pkg.tar.zst), got {}",
            artifacts.package_path.display()
        );
        let verification = state
            .package_verification
            .as_ref()
            .expect("package verification should be recorded for updater-built packages");
        assert_eq!(verification.package_name, "chatgpt");
        assert_eq!(
            verification.package_version,
            crate::install::expected_package_version_from_source(
                PackageKind::detect(),
                "26.429.20946"
            )
        );
        assert_eq!(verification.candidate_version, "26.429.20946");
        assert_eq!(verification.dmg_sha256, trusted_dmg_sha256);
        assert_eq!(
            verification.package_path,
            artifacts.package_path.canonicalize()?
        );
        assert_eq!(
            verification.workspace_dir,
            artifacts.workspace_dir.canonicalize()?
        );
        assert_eq!(verification.sha256.len(), 64);
        let package_build_log =
            fs::read_to_string(artifacts.workspace_dir.join("logs/build-package.log"))?;
        assert!(package_build_log.contains(&format!(
            "CHATGPT_PORT_INTEGRATIONS_CONFIG={}",
            saved_integration_config.display()
        )));
        Ok(())
    }

    #[tokio::test]
    async fn build_update_rejects_dmg_digest_mismatch() -> Result<()> {
        let temp = tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 30,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("bundle"),
            app_executable_path: PathBuf::from("/opt/chatgpt/electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };
        let dmg_path = temp.path().join("ChatGPT.dmg");
        fs::write(&dmg_path, b"changed-dmg")?;

        let mut state = PersistedState::new(true);
        state.dmg_sha256 = Some("0".repeat(64));
        let error = build_update(
            &config,
            &mut state,
            &paths,
            "2026.03.24+abcd1234",
            &dmg_path,
        )
        .await
        .expect_err("mismatched DMG digest should fail before rebuilding");

        assert!(error
            .to_string()
            .contains("Downloaded DMG digest changed before package build"));
        Ok(())
    }

    #[test]
    fn stages_dirty_git_source_identity() -> Result<()> {
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");
        fs::create_dir_all(&source_root)?;
        initialize_test_git_repository(&source_root, true)?;
        let expected_commit = git_capture(&source_root, &["rev-parse", "HEAD"])
            .expect("trusted Git should resolve the fixture commit");

        stage_git_source_info(&source_root, &destination_root)?;

        let source_info: serde_json::Value = serde_json::from_slice(&fs::read(
            destination_root.join(".chatgpt-linux/source-info.json"),
        )?)?;
        assert_eq!(source_info["commit"], expected_commit);
        assert_eq!(source_info["dirty"], true);
        assert_eq!(source_info["describe"], "v0.10.2-dirty");
        assert_eq!(
            source_info["remote"],
            "https://github.com/example/chatgpt-linux.git"
        );
        assert_eq!(source_info["provenance"], "git");
        Ok(())
    }

    #[test]
    fn source_identity_does_not_leak_from_parent_checkout() -> Result<()> {
        let temp = tempdir()?;
        let parent_root = temp.path().join("parent");
        let source_root = parent_root.join("nested-builder");
        let destination_root = temp.path().join("destination");
        fs::create_dir_all(&source_root)?;
        initialize_test_git_repository(&parent_root, false)?;

        stage_git_source_info(&source_root, &destination_root)?;

        assert!(!destination_root
            .join(".chatgpt-linux/source-info.json")
            .exists());
        Ok(())
    }

    #[test]
    fn no_git_source_leaves_packaged_metadata_unchanged() -> Result<()> {
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");
        let source_info = destination_root.join(".chatgpt-linux/source-info.json");
        fs::create_dir_all(&source_root)?;
        fs::create_dir_all(source_info.parent().unwrap())?;
        fs::write(&source_info, "{\"commit\":\"packaged\"}\n")?;

        stage_git_source_info(&source_root, &destination_root)?;

        assert_eq!(
            fs::read_to_string(source_info)?,
            "{\"commit\":\"packaged\"}\n"
        );
        Ok(())
    }

    #[test]
    fn git_source_metadata_ignores_git_from_ambient_path() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&["PATH"]);
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");
        let attacker_bin = temp.path().join("attacker-bin");
        let marker = temp.path().join("attacker-git-ran");
        fs::create_dir_all(&source_root)?;
        fs::create_dir_all(&attacker_bin)?;
        let attacker_git = attacker_bin.join("git");
        fs::write(
            &attacker_git,
            format!("#!/bin/sh\ntouch {}\n", marker.display()),
        )?;
        fs::set_permissions(&attacker_git, fs::Permissions::from_mode(0o755))?;
        std::env::set_var("PATH", &attacker_bin);

        stage_git_source_info(&source_root, &destination_root)?;

        assert!(
            !marker.exists(),
            "optional source metadata must not execute Git from ambient PATH"
        );
        assert!(!destination_root
            .join(".chatgpt-linux/source-info.json")
            .exists());
        Ok(())
    }

    #[test]
    fn git_source_metadata_disables_repository_fsmonitor_commands() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");
        let marker = temp.path().join("fsmonitor-ran");
        let fsmonitor = temp.path().join("fsmonitor-hook");
        fs::create_dir_all(&source_root)?;
        initialize_test_git_repository(&source_root, false)?;
        fs::write(
            &fsmonitor,
            format!("#!/bin/sh\ntouch '{}'\nprintf '0\\n'\n", marker.display()),
        )?;
        fs::set_permissions(&fsmonitor, fs::Permissions::from_mode(0o755))?;
        let git = trusted_system_program(TRUSTED_GIT_PATHS)
            .context("A trusted system Git executable is required for builder metadata tests")?;
        let status = StdCommand::new(git)
            .args([
                "-C",
                source_root.to_string_lossy().as_ref(),
                "config",
                "core.fsmonitor",
                fsmonitor.to_string_lossy().as_ref(),
            ])
            .status()?;
        anyhow::ensure!(status.success(), "failed to configure test fsmonitor");

        stage_git_source_info(&source_root, &destination_root)?;

        assert!(
            !marker.exists(),
            "optional source metadata must not execute repository-configured fsmonitor commands"
        );
        assert!(destination_root
            .join(".chatgpt-linux/source-info.json")
            .exists());
        Ok(())
    }

    #[test]
    fn sanitizes_credential_bearing_network_remotes() {
        assert_eq!(
            sanitize_git_remote(Some(
                "ssh://builder:secret-token@github.com/example/chatgpt-linux.git".to_string()
            )),
            Some("ssh://github.com/example/chatgpt-linux.git".to_string())
        );
        assert_eq!(
            sanitize_git_remote(Some(
                "private-user@github.com:example/chatgpt-linux.git".to_string()
            )),
            Some("github.com:example/chatgpt-linux.git".to_string())
        );
    }

    #[test]
    fn rejects_local_and_custom_git_remotes() {
        for remote in [
            "/home/builder/private/chatgpt-linux",
            "./private/chatgpt-linux",
            "../private/chatgpt-linux",
            "~/private/chatgpt-linux",
            "private/chatgpt-linux",
            "file:///home/builder/private/chatgpt-linux",
            "C:\\Users\\builder\\private\\chatgpt-linux",
            "ext::ssh -i /home/builder/.ssh/private_key github.com %S",
            "custom://builder:secret@internal.example/private/repo.git",
        ] {
            assert_eq!(
                sanitize_git_remote(Some(remote.to_string())),
                None,
                "remote should be rejected: {remote}"
            );
        }
    }

    #[test]
    fn fake_package_builders_emit_source_info() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempdir()?;
        for (index, output) in [
            FakePackageOutput::Deb,
            FakePackageOutput::Rpm,
            FakePackageOutput::Pacman,
        ]
        .into_iter()
        .enumerate()
        {
            let bundle_root = temp.path().join(format!("bundle-{index}"));
            let source_info = bundle_root.join(".chatgpt-linux/source-info.json");
            let script_path = bundle_root.join("build-package.sh");
            let dist_dir = bundle_root.join("dist");
            fs::create_dir_all(source_info.parent().unwrap())?;
            fs::write(&source_info, "{\"commit\":\"test-commit\"}\n")?;
            write_fake_build_script(&script_path, output)?;

            let status = StdCommand::new(&script_path)
                .current_dir(&bundle_root)
                .env("DIST_DIR_OVERRIDE", &dist_dir)
                .env("PACKAGE_VERSION", "2026.07.22+test")
                .status()?;

            assert!(status.success(), "fake package builder {index} failed");
            assert_eq!(
                fs::read_to_string(dist_dir.join("package-source-info.json"))?,
                "{\"commit\":\"test-commit\"}\n"
            );
        }
        Ok(())
    }

    #[test]
    fn bundle_copy_supports_source_checkout_without_builder_only_payload_or_optional_package_scripts(
    ) -> Result<()> {
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");

        fs::create_dir_all(source_root.join("scripts/lib"))?;
        fs::create_dir_all(source_root.join("launcher"))?;
        fs::create_dir_all(source_root.join("packaging/linux"))?;
        fs::create_dir_all(source_root.join("assets"))?;
        write_fake_computer_use_bundle(&source_root)?;
        write_fake_port_integrations_bundle(&source_root)?;
        write_fake_patch_bundle(&source_root)?;
        fs::write(source_root.join("install.sh"), b"#!/bin/bash\n")?;
        fs::write(
            source_root.join("launcher/start.sh.template"),
            b"# fake launcher template\n",
        )?;
        fs::write(
            source_root.join("launcher/cli-launch-path.py"),
            b"# fake CLI launch path helper\n",
        )?;
        fs::write(
            source_root.join("launcher/webview-server.py"),
            b"# fake webview server\n",
        )?;
        fs::write(source_root.join("scripts/build-deb.sh"), b"#!/bin/bash\n")?;
        fs::write(
            source_root.join("scripts/validate-upstream-dmg.js"),
            b"#!/usr/bin/env node\n",
        )?;
        fs::write(
            source_root.join("scripts/patch-linux-window-ui.js"),
            b"console.log('patched');\n",
        )?;
        fs::write(
            source_root.join("scripts/lib/package-common.sh"),
            b"#!/bin/bash\n",
        )?;
        fs::write(
            source_root.join("scripts/lib/node-runtime.sh"),
            b"#!/bin/bash\n",
        )?;
        fs::write(
            source_root.join("packaging/linux/control"),
            b"Package: chatgpt\n",
        )?;
        fs::write(
            source_root.join("packaging/linux/chatgpt-updater.service"),
            b"[Unit]\nDescription=ChatGPT Update Manager\n",
        )?;
        fs::write(source_root.join("assets/chatgpt.png"), b"png")?;
        fs::write(source_root.join("assets/chatgpt-linux.png"), b"linux png")?;

        copy_builder_bundle(&source_root, &destination_root)?;

        assert!(destination_root.join("scripts/build-deb.sh").exists());
        assert!(destination_root
            .join("scripts/patch-linux-window-ui.js")
            .exists());
        assert!(destination_root
            .join("launcher/cli-launch-path.py")
            .exists());
        assert!(destination_root.join("launcher/webview-server.py").exists());
        assert_fresh_patch_bundle(&destination_root);
        assert!(destination_root.join("computer-use-linux").exists());
        assert!(destination_root
            .join("notification-actions-linux/Cargo.toml")
            .exists());
        assert!(!destination_root.join("global-dictation-linux").exists());
        assert!(destination_root.join("read-aloud-linux").exists());
        assert!(destination_root.join("record-replay-linux").exists());
        assert!(destination_root.join("updater").exists());
        assert!(destination_root.join("assets/chatgpt-linux.png").exists());
        assert!(destination_root
            .join("plugins/openai-bundled/plugins/computer-use/.mcp.json")
            .exists());
        assert!(destination_root
            .join("plugins/openai-bundled/plugins/read-aloud/.mcp.json")
            .exists());
        assert!(destination_root
            .join("scripts/lib/node-runtime.sh")
            .exists());
        assert!(!destination_root.join("node-runtime").exists());
        assert!(!destination_root.join(PREBUILT_HELPERS_DIR).exists());
        assert!(destination_root
            .join("port-integrations/integrations.example.json")
            .exists());
        assert!(!destination_root.join("scripts/build-rpm.sh").exists());
        assert!(!destination_root.join("scripts/build-pacman.sh").exists());
        Ok(())
    }

    #[test]
    fn bundle_copy_prefers_packaged_update_builder_manifest() -> Result<()> {
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");

        fs::create_dir_all(source_root.join(".chatgpt-linux"))?;
        fs::create_dir_all(source_root.join("assets"))?;
        fs::create_dir_all(source_root.join("record-replay-linux"))?;
        fs::create_dir_all(source_root.join("scripts"))?;
        fs::write(source_root.join("assets/chatgpt-linux.png"), b"linux png")?;
        fs::write(
            source_root.join("record-replay-linux/Cargo.toml"),
            b"[package]\nname = \"chatgpt-record-replay-linux\"\n",
        )?;
        fs::write(source_root.join("scripts/build-deb.sh"), b"#!/bin/bash\n")?;
        fs::write(
            source_root.join(UPDATE_BUILDER_MANIFEST),
            b"# generated\nassets/chatgpt-linux.png\nrecord-replay-linux/Cargo.toml\n",
        )?;

        copy_builder_bundle(&source_root, &destination_root)?;

        assert!(destination_root.join("assets/chatgpt-linux.png").exists());
        assert!(destination_root
            .join("record-replay-linux/Cargo.toml")
            .exists());
        assert!(destination_root.join(UPDATE_BUILDER_MANIFEST).exists());
        assert!(!destination_root.join("scripts/build-deb.sh").exists());
        Ok(())
    }

    #[test]
    fn bundle_manifest_rejects_parent_paths() -> Result<()> {
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");

        fs::create_dir_all(source_root.join(".chatgpt-linux"))?;
        fs::write(source_root.join(UPDATE_BUILDER_MANIFEST), b"../escape\n")?;

        let error = copy_builder_bundle(&source_root, &destination_root)
            .expect_err("manifest parent path should be rejected");
        assert!(error
            .to_string()
            .contains("Unsafe update-builder manifest entry"));
        Ok(())
    }

    #[test]
    fn bundle_manifest_rejects_absolute_paths() -> Result<()> {
        let temp = tempdir()?;
        let source_root = temp.path().join("source");
        let destination_root = temp.path().join("destination");

        fs::create_dir_all(source_root.join(".chatgpt-linux"))?;
        fs::write(source_root.join(UPDATE_BUILDER_MANIFEST), b"/tmp/escape\n")?;

        let error = copy_builder_bundle(&source_root, &destination_root)
            .expect_err("manifest absolute path should be rejected");
        assert!(error
            .to_string()
            .contains("Unsafe update-builder manifest entry"));
        Ok(())
    }

    #[test]
    fn returns_error_when_dist_has_no_native_package() -> Result<()> {
        let temp = tempdir()?;
        fs::write(temp.path().join("README.txt"), b"no packages here")?;

        let error = find_package_in(temp.path()).expect_err("package discovery should fail");
        assert!(error
            .to_string()
            .contains("No native package (.deb, .rpm, or .pkg.tar.*)"));
        Ok(())
    }

    #[test]
    fn finds_pacman_package_in_dist_dir() -> Result<()> {
        let temp = tempdir()?;
        let pkg_path = temp
            .path()
            .join("chatgpt-2026.03.30.120000-1-x86_64.pkg.tar.zst");
        fs::write(&pkg_path, b"pkg")?;

        let found = find_package_in(temp.path())?;
        assert_eq!(found, pkg_path);
        Ok(())
    }

    #[test]
    fn build_command_path_includes_system_dirs() {
        let path = build_command_path(Path::new("/tmp/missing-chatgpt-builder"))
            .expect("trusted PATH should be constructible");
        let directories = std::env::split_paths(&path).collect::<Vec<_>>();

        assert!(directories.iter().any(|dir| dir == Path::new("/usr/bin")));
        assert!(directories.iter().any(|dir| dir == Path::new("/bin")));
    }

    #[test]
    fn build_command_path_excludes_user_local_bin_from_home() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempdir()?;
        let user_bin = temp.path().join(".local/bin");
        fs::create_dir_all(&user_bin)?;

        let original_home = std::env::var_os("HOME");
        std::env::set_var("HOME", temp.path());

        let path = build_command_path(Path::new("/tmp/missing-chatgpt-builder"))?;

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }

        let directories = std::env::split_paths(&path).collect::<Vec<_>>();
        assert!(
            !directories.iter().any(|dir| dir == &user_bin),
            "rebuild commands must not search user-local executables"
        );
        Ok(())
    }

    #[test]
    fn build_command_path_prefers_packaged_managed_node_runtime() -> Result<()> {
        let temp = tempdir()?;
        let runtime_bin = temp.path().join("node-runtime/bin");
        fs::create_dir_all(&runtime_bin)?;
        for binary in ["node", "npm", "npx"] {
            fs::write(runtime_bin.join(binary), b"bin")?;
        }

        let path = build_command_path(temp.path())?;
        let directories = std::env::split_paths(&path).collect::<Vec<_>>();
        assert_eq!(directories.first(), Some(&runtime_bin));
        Ok(())
    }

    #[test]
    fn build_command_path_excludes_cargo_bin_from_home() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempdir()?;
        let home_dir = temp.path().join("home");
        let cargo_bin = home_dir.join(".cargo/bin");
        fs::create_dir_all(&cargo_bin)?;
        fs::write(cargo_bin.join("cargo"), b"bin")?;
        fs::set_permissions(cargo_bin.join("cargo"), fs::Permissions::from_mode(0o755))?;

        let _home_guard = crate::test_util::EnvVarGuard::set(&_env_guard, "HOME", &home_dir);

        let path = build_command_path(Path::new("/tmp/missing-chatgpt-builder"))?;

        let directories = std::env::split_paths(&path).collect::<Vec<_>>();
        assert!(
            !directories.iter().any(|dir| dir == &cargo_bin),
            "rebuild commands must not search user-managed Rust toolchains"
        );
        Ok(())
    }
}
