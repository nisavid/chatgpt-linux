//! Application entrypoints and orchestration for the local updater daemon.

use crate::{
    builder, cache_cleanup,
    cli::{Cli, Commands},
    codex_cli,
    config::{RuntimeConfig, RuntimePaths},
    diagnostics, dmg_source, install, install_rollback, integration_picker, liveness, logging,
    notify, package_verification, redaction, restart, rollback,
    state::{CliStatus, DmgVerification, DmgVerificationResult, PersistedState, UpdateStatus},
    trust, wrapper, wrapper_apply,
};
use anyhow::{Context, Result};
use chrono::{Duration as ChronoDuration, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};
use tokio::io::AsyncReadExt;
use tokio::time::{self, Duration};
use tracing::{error, info, warn};

const RECONCILE_INTERVAL_SECONDS: u64 = 15;
const CLI_MISSING_NOTIFICATION_EVENT: &str = "cli_missing";
const CLI_MISSING_PROMPT_DISMISS_TTL: ChronoDuration = ChronoDuration::minutes(10);
const PROMPT_INSTALL_CLI_CANCELLED_EXIT_CODE: i32 = 10;
const PROMPT_INSTALL_CLI_NO_BACKEND_EXIT_CODE: i32 = 11;
// Nonzero so `Restart=on-failure` relaunches the daemon on the new binary.
const BINARY_REPLACED_RESTART_EXIT_CODE: i32 = 12;
const POLKIT_AUTH_AGENT_PROCESS_TOKENS: &[&str] = &[
    "budgie-polkit",
    "cinnamon-polkit",
    "cosmic-osd",
    "gnome-shell",
    "hyprpolkitagent",
    "io.elementary.desktop.agent-polkit",
    "lxpolkit",
    "lxqt-policykit-agent",
    "mate-polkit",
    "polkit-agent",
    "polkit-dde-agent",
    "polkit-gnome-authentication-agent",
    "polkit-kde-authentication-agent",
    "soteria",
    "ukui-polkit",
    "xfce-polkit",
];

/// Runs the updater command-line entrypoint.
pub async fn run(cli: Cli) -> Result<()> {
    if let Commands::RunNpmSupervisor {
        owner_pid,
        timeout_millis,
        install_lock_fd,
        program,
        args,
    } = &cli.command
    {
        return codex_cli::run_npm_supervisor(
            *owner_pid,
            *timeout_millis,
            *install_lock_fd,
            program,
            args,
        );
    }

    let paths = RuntimePaths::detect()?;
    if let Commands::Diagnose { json } = &cli.command {
        return run_diagnose_command(&paths, *json).await;
    }

    paths.ensure_dirs()?;
    logging::init(&paths.log_file)?;

    let mut config = RuntimeConfig::load_or_default(&paths)?;
    if let Some(enabled) = crate::config::settings_wrapper_updates_override() {
        config.enable_wrapper_updates = enabled;
    }
    let mut state =
        PersistedState::load_or_default(&paths.state_file, effective_auto_install(&config))?;
    #[cfg(test)]
    wait_for_process_test_barrier(
        "CHATGPT_UPDATER_TEST_ENTRYPOINT_LOADED",
        "CHATGPT_UPDATER_TEST_ENTRYPOINT_CONTINUE",
    )?;
    if !matches!(
        &cli.command,
        Commands::Daemon | Commands::CheckNow { .. } | Commands::InstallReady
    ) {
        let original_state = state.clone();
        state.installed_version = install::installed_package_version();
        persist_if_changed(&paths, &state, &original_state)?;
    }
    #[cfg(test)]
    signal_process_test_marker("CHATGPT_UPDATER_TEST_ENTRYPOINT_PRE_DISPATCH")?;

    match cli.command {
        Commands::Daemon => run_daemon(&config, &mut state, &paths).await,
        Commands::CheckNow { if_stale } => {
            run_check_now(&config, &mut state, &paths, if_stale).await
        }
        Commands::CheckWrapper { json } => run_check_wrapper(&config, &mut state, &paths, json),
        Commands::ApplyWrapperUpdate => {
            wrapper_apply::run_apply_wrapper_update(&config, &mut state, &paths).await
        }
        Commands::PickIntegrations { json } => {
            integration_picker::run_pick_integrations(&config, &paths, json)
        }
        Commands::CliPreflight {
            cli_path,
            print_path,
            allow_install_missing,
        } => run_cli_preflight(
            &config,
            &mut state,
            &paths,
            cli_path,
            print_path,
            allow_install_missing,
        ),
        Commands::RecoverStandaloneCli {
            codex_home,
            install_dir,
            print_path,
        } => run_recover_standalone_cli(codex_home, install_dir, print_path),
        Commands::RepairCli => run_repair_cli(&mut state, &paths),
        Commands::RunNpmSupervisor { .. } => {
            unreachable!("npm supervisor is handled before runtime writes")
        }
        Commands::PromptInstallCli {
            cli_path,
            print_path,
        } => run_prompt_install_cli(&config, &mut state, &paths, cli_path, print_path),
        Commands::Status { json } => run_status(&config, &mut state, &paths, json),
        Commands::Diagnose { .. } => unreachable!("diagnose is handled before runtime writes"),
        Commands::InstallReady => run_install_ready(&config, &mut state, &paths).await,
        Commands::Rollback => rollback::run(&config, &mut state, &paths).await,
        Commands::InstallDeb {
            path,
            expected_sha256,
            expected_package_name,
            expected_package_version,
            allow_same_version,
        } => {
            let expected = install::expected_package_from_args(
                expected_sha256,
                expected_package_name,
                expected_package_version,
            )?;
            install::install_deb_with_options(
                &path,
                expected.as_ref(),
                install::InstallOptions::new(allow_same_version, expected.as_ref())?,
            )
        }
        Commands::InstallRpm {
            path,
            expected_sha256,
            expected_package_name,
            expected_package_version,
            allow_same_version,
        } => {
            let expected = install::expected_package_from_args(
                expected_sha256,
                expected_package_name,
                expected_package_version,
            )?;
            install::install_rpm_with_options(
                &path,
                expected.as_ref(),
                install::InstallOptions::new(allow_same_version, expected.as_ref())?,
            )
        }
        Commands::InstallPacman {
            path,
            expected_sha256,
            expected_package_name,
            expected_package_version,
            allow_same_version,
        } => {
            let expected = install::expected_package_from_args(
                expected_sha256,
                expected_package_name,
                expected_package_version,
            )?;
            install::install_pacman_with_options(
                &path,
                expected.as_ref(),
                install::InstallOptions::new(allow_same_version, expected.as_ref())?,
            )
        }
        Commands::InstallRollbackDeb {
            path,
            expected_sha256,
            expected_package_name,
            expected_package_version,
        } => {
            let expected = install::expected_package_from_args(
                expected_sha256,
                expected_package_name,
                expected_package_version,
            )?;
            install_rollback::install_deb(&path, expected.as_ref())
        }
        Commands::InstallRollbackRpm {
            path,
            expected_sha256,
            expected_package_name,
            expected_package_version,
        } => {
            let expected = install::expected_package_from_args(
                expected_sha256,
                expected_package_name,
                expected_package_version,
            )?;
            install_rollback::install_rpm(&path, expected.as_ref())
        }
        Commands::InstallRollbackPacman {
            path,
            expected_sha256,
            expected_package_name,
            expected_package_version,
        } => {
            let expected = install::expected_package_from_args(
                expected_sha256,
                expected_package_name,
                expected_package_version,
            )?;
            install_rollback::install_pacman(&path, expected.as_ref())
        }
    }
}

async fn run_diagnose_command(paths: &RuntimePaths, json: bool) -> Result<()> {
    let mut config = RuntimeConfig::load_or_default(paths)?;
    if let Some(enabled) = crate::config::settings_wrapper_updates_override() {
        config.enable_wrapper_updates = enabled;
    }
    let mut state =
        PersistedState::load_or_default(&paths.state_file, effective_auto_install(&config))?;
    state.installed_version = install::installed_package_version();
    diagnostics::run(&config, &state, paths, json).await
}

fn persist_state(paths: &RuntimePaths, state: &PersistedState) -> Result<()> {
    state.save_updater(&paths.state_file)
}

fn persist_if_changed(
    paths: &RuntimePaths,
    state: &PersistedState,
    original_state: &PersistedState,
) -> Result<()> {
    if state != original_state {
        persist_state(paths, state)?;
    }

    Ok(())
}

fn effective_auto_install(config: &RuntimeConfig) -> bool {
    crate::config::settings_auto_install_override().unwrap_or(config.auto_install_on_app_exit)
}

fn sync_runtime_state(config: &RuntimeConfig, state: &mut PersistedState) {
    state.auto_install_on_app_exit = effective_auto_install(config);
    if state.status != UpdateStatus::WaitingForAppExit {
        state.waiting_for_app_exit_auto_install = false;
    }
    state.installed_version = install::installed_package_version();
}

fn sync_and_persist(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let original_state = state.clone();
    sync_runtime_state(config, state);
    persist_if_changed(paths, state, &original_state)
}

fn reload_state_from_disk(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let previous_status = state.status.clone();
    let previous_candidate_version = state.candidate_version.clone();
    let previous_waiting_auto_install = state.waiting_for_app_exit_auto_install;

    let loaded =
        PersistedState::load_or_default(&paths.state_file, effective_auto_install(config))?;
    let mut refreshed = loaded.clone();
    sync_runtime_state(config, &mut refreshed);
    persist_if_changed(paths, &refreshed, &loaded)?;

    if previous_status != refreshed.status
        || previous_candidate_version != refreshed.candidate_version
        || previous_waiting_auto_install != refreshed.waiting_for_app_exit_auto_install
    {
        info!(
            previous_status = ?previous_status,
            status = ?refreshed.status,
            previous_candidate_version = previous_candidate_version.as_deref(),
            candidate_version = refreshed.candidate_version.as_deref(),
            previous_waiting_auto_install,
            waiting_auto_install = refreshed.waiting_for_app_exit_auto_install,
            "reloaded updater state from disk"
        );
    }

    *state = refreshed;
    Ok(())
}

fn normalize_workspace_dir_and_persist(
    workspace_root: &Path,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let original_state = state.clone();
    cache_cleanup::normalize_artifact_workspace_dir(workspace_root, state);
    persist_if_changed(paths, state, &original_state)
}

fn maybe_prune_workspace_cache(workspace_root: &Path, state: &PersistedState) {
    match cache_cleanup::prune_unreferenced_workspaces(workspace_root, state) {
        Ok(summary) if summary.pruned_workspaces > 0 => {
            info!(
                pruned_workspaces = summary.pruned_workspaces,
                workspace_root = %workspace_root.display(),
                "pruned unreferenced updater workspaces"
            );
        }
        Ok(_) => {}
        Err(error) => {
            warn!(
                ?error,
                workspace_root = %workspace_root.display(),
                "failed to prune unreferenced updater workspaces"
            );
        }
    }
}

fn maybe_prune_generated_artifacts(config: &RuntimeConfig) {
    match cache_cleanup::prune_generated_artifacts(
        &config.generated_artifact_cleanup,
        &config.builder_bundle_root,
    ) {
        Ok(summary) if summary.pruned_paths > 0 => {
            info!(
                inspected_roots = summary.inspected_roots,
                pruned_paths = summary.pruned_paths,
                bytes_removed = summary.bytes_removed,
                "pruned generated wrapper artifacts"
            );
        }
        Ok(_) => {}
        Err(error) => {
            warn!(?error, "failed to prune generated wrapper artifacts");
        }
    }
}

fn maybe_prune_caches(config: &RuntimeConfig, state: &PersistedState) {
    maybe_prune_workspace_cache(&config.workspace_root, state);
    match cache_cleanup::prune_dmg_cache(&config.workspace_root, state) {
        Ok(summary) if summary.pruned_dmgs > 0 || summary.pruned_temps > 0 => {
            info!(
                pruned_dmgs = summary.pruned_dmgs,
                pruned_temps = summary.pruned_temps,
                "pruned updater DMG cache"
            );
        }
        Ok(summary) if summary.skipped_locked => {
            info!("skipping DMG cache cleanup while another updater flow holds its lease");
        }
        Ok(_) => {}
        Err(error) => warn!(?error, "failed to prune updater DMG cache"),
    }
    maybe_prune_generated_artifacts(config);
}

fn run_daemon_startup_maintenance(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let _check_lock = match try_acquire_check_lock(paths) {
        Ok(Some(check_lock)) => check_lock,
        Ok(None) => {
            info!("skipping updater startup maintenance because another check is already active");
            return Ok(());
        }
        Err(error) => {
            warn!(
                ?error,
                "skipping updater startup maintenance because the check lock is unavailable"
            );
            return Ok(());
        }
    };

    if let Err(error) = reload_state_from_disk(config, state, paths) {
        warn!(
            ?error,
            "skipping updater startup maintenance because persisted state could not be reloaded"
        );
        return Ok(());
    }

    sync_and_persist(config, state, paths)?;
    recover_interrupted_install(&config.workspace_root, state, paths)?;
    complete_current_dmg_update_if_already_installed(config, state, paths)?;
    codex_cli::reconcile_if_present(config, state, paths)?;
    normalize_workspace_dir_and_persist(&config.workspace_root, state, paths)?;
    maybe_prune_caches(config, state);
    maybe_notify_cli_missing(state, paths, config.notifications)?;
    Ok(())
}

fn clear_wrapper_update_candidate_and_persist(
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let original_state = state.clone();
    state.clear_wrapper_update_candidate();
    persist_if_changed(paths, state, &original_state)
}

fn refresh_installed_wrapper_state(config: &RuntimeConfig, state: &mut PersistedState) {
    if let Some(installed) = wrapper::installed_wrapper_from_metadata(
        &config.app_executable_path,
        &config.builder_bundle_root,
    ) {
        state.installed_wrapper_version = installed.version;
        state.installed_wrapper_commit = Some(installed.commit);
    } else {
        state.installed_wrapper_version = None;
        state.installed_wrapper_commit = None;
    }
}

fn clear_stale_wrapper_update_and_persist(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let original_state = state.clone();
    refresh_installed_wrapper_state(config, state);
    state.clear_wrapper_update_candidate();
    persist_if_changed(paths, state, &original_state)
}

fn set_status(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    status: UpdateStatus,
) -> Result<()> {
    state.status = status;
    if state.status != UpdateStatus::WaitingForAppExit {
        state.waiting_for_app_exit_auto_install = false;
    }
    persist_state(paths, state)
}

fn set_waiting_for_app_exit(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    auto_install: bool,
) -> Result<()> {
    state.waiting_for_app_exit_auto_install = auto_install;
    state.status = UpdateStatus::WaitingForAppExit;
    persist_state(paths, state)
}

fn mark_failed_and_persist(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    message: impl Into<String>,
) -> Result<()> {
    state.mark_failed(message);
    persist_state(paths, state)
}

fn record_verified_dmg(state: &mut PersistedState, verified: &trust::VerifiedDmg) {
    state.dmg_verification = Some(DmgVerification {
        result: DmgVerificationResult::Verified,
        version: Some(verified.version.clone()),
        sha256: Some(verified.sha256.clone()),
        manifest_path: Some(verified.manifest_path.clone()),
        verified_at: Some(Utc::now()),
        message: Some("Downloaded DMG matched repo-trusted metadata".to_string()),
    });
}

fn record_failed_dmg_verification(
    state: &mut PersistedState,
    downloaded_sha256: &str,
    manifest_path: PathBuf,
    message: String,
) {
    state.dmg_verification = Some(DmgVerification {
        result: DmgVerificationResult::Failed,
        version: None,
        sha256: Some(downloaded_sha256.to_string()),
        manifest_path: Some(manifest_path),
        verified_at: Some(Utc::now()),
        message: Some(message),
    });
}

fn ensure_ready_update_has_verified_dmg(state: &PersistedState) -> Result<()> {
    let Some(verification) = state.dmg_verification.as_ref() else {
        anyhow::bail!("Ready update is missing trusted DMG verification");
    };
    if verification.result != DmgVerificationResult::Verified {
        anyhow::bail!("Ready update is not backed by successful trusted DMG verification");
    }
    let Some(verified_version) = verification.version.as_deref() else {
        anyhow::bail!("Ready update trusted DMG verification is missing a version");
    };
    let Some(candidate_version) = state.candidate_version.as_deref() else {
        anyhow::bail!("Ready update is missing a candidate version");
    };
    if verified_version != candidate_version {
        anyhow::bail!("Ready update version does not match trusted DMG verification");
    }
    let Some(verified_sha256) = verification.sha256.as_deref() else {
        anyhow::bail!("Ready update trusted DMG verification is missing a digest");
    };
    let Some(dmg_sha256) = state.dmg_sha256.as_deref() else {
        anyhow::bail!("Ready update is missing a DMG digest");
    };
    if verified_sha256 != dmg_sha256 {
        anyhow::bail!("Ready update digest does not match trusted DMG verification");
    }
    Ok(())
}

fn state_has_verified_current_dmg(state: &PersistedState) -> bool {
    let Some(verification) = state.dmg_verification.as_ref() else {
        return false;
    };
    verification.result == DmgVerificationResult::Verified
        && verification.version.is_some()
        && state
            .candidate_version
            .as_deref()
            .is_none_or(|candidate| verification.version.as_deref() == Some(candidate))
        && verification.sha256.as_deref() == state.dmg_sha256.as_deref()
}

async fn file_sha256(path: &Path) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await.with_context(|| {
        format!(
            "Failed to open {} for trusted DMG hash check",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let bytes_read = file.read(&mut buffer).await.with_context(|| {
            format!(
                "Failed to read {} for trusted DMG hash check",
                path.display()
            )
        })?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>())
}

async fn ensure_downloaded_dmg_still_matches_verified_metadata(
    path: &Path,
    verified: &trust::VerifiedDmg,
) -> Result<()> {
    let current_sha256 = file_sha256(path).await?;
    if current_sha256 != verified.sha256 {
        anyhow::bail!(
            "Downloaded DMG changed after trusted metadata verification: expected {}, found {}",
            verified.sha256,
            current_sha256
        );
    }
    Ok(())
}

fn packaged_runtime_removed(config: &RuntimeConfig) -> bool {
    config.builder_bundle_root == Path::new("/usr/lib/chatgpt/update-builder")
        && !config.app_executable_path.exists()
        && !install::is_primary_package_installed()
}

fn summarize_command_output(output: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(output);
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    let mut lines = text
        .lines()
        .rev()
        .take(3)
        .map(redaction::redact_for_persistence)
        .collect::<Vec<_>>();
    lines.reverse();
    Some(lines.join(" | "))
}

struct CheckLock {
    _file: fs::File,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum CheckLockBehavior {
    SkipIfBusy,
    Wait,
}

fn try_acquire_check_lock(paths: &RuntimePaths) -> Result<Option<CheckLock>> {
    let lock_path = paths.state_dir.join("check.lock");
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .with_context(|| format!("Failed to open {}", lock_path.display()))?;

    match file.try_lock() {
        Ok(()) => {}
        Err(fs::TryLockError::WouldBlock) => {
            return Ok(None);
        }
        Err(fs::TryLockError::Error(error)) => {
            return Err(error).with_context(|| format!("Failed to lock {}", lock_path.display()));
        }
    }

    file.set_len(0)
        .with_context(|| format!("Failed to truncate {}", lock_path.display()))?;
    file.seek(SeekFrom::Start(0))
        .with_context(|| format!("Failed to seek {}", lock_path.display()))?;
    writeln!(file, "{}", std::process::id())
        .with_context(|| format!("Failed to write {}", lock_path.display()))?;

    Ok(Some(CheckLock { _file: file }))
}

async fn acquire_check_lock(
    paths: &RuntimePaths,
    behavior: CheckLockBehavior,
) -> Result<Option<CheckLock>> {
    let mut logged_wait = false;
    loop {
        if let Some(check_lock) = try_acquire_check_lock(paths)? {
            return Ok(Some(check_lock));
        }
        #[cfg(test)]
        signal_process_test_marker("CHATGPT_UPDATER_TEST_CHECK_LOCK_BUSY")?;

        if behavior == CheckLockBehavior::SkipIfBusy {
            return Ok(None);
        }

        if !logged_wait {
            info!("waiting for the active updater flow");
            logged_wait = true;
        }
        time::sleep(Duration::from_millis(50)).await;
    }
}

fn update_install_is_pending(status: &UpdateStatus) -> bool {
    matches!(
        status,
        UpdateStatus::ReadyToInstall | UpdateStatus::WaitingForAppExit | UpdateStatus::Installing
    )
}

fn reconcile_cli_if_present_best_effort(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    context: &'static str,
) {
    if let Err(error) = codex_cli::reconcile_if_present(config, state, paths) {
        warn!(?error, context, "unable to reconcile Codex CLI");
    }
}

// Failed attempts and transient states persisted before fallible download or
// build work must retry after the next checker acquires the check lock. A
// still-running checker continues to own that lock and prevents duplicate work.
fn update_check_should_retry(status: &UpdateStatus) -> bool {
    matches!(
        status,
        UpdateStatus::Failed
            | UpdateStatus::DownloadingDmg
            | UpdateStatus::UpdateDetected
            | UpdateStatus::PreparingWorkspace
            | UpdateStatus::PatchingApp
            | UpdateStatus::BuildingPackage
    )
}

fn prepare_upstream_check(state: &mut PersistedState, paths: &RuntimePaths) -> Result<bool> {
    let retrying_update = update_check_should_retry(&state.status);

    // Keep a retryable status durable until the metadata request completes. If
    // the updater exits while that request is in flight, the next run must not
    // mistake the interrupted rebuild for an ordinary unchanged-upstream check.
    if !retrying_update {
        state.status = UpdateStatus::CheckingUpstream;
    }
    state.last_check_at = Some(Utc::now());
    state.error_message = None;
    persist_state(paths, state)?;

    Ok(retrying_update)
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum PendingInstallRecovery {
    NoChange,
    CandidateInstalled,
    SupersededByInstalledVersion,
}

impl PendingInstallRecovery {
    fn completed(self) -> bool {
        !matches!(self, Self::NoChange)
    }

    fn should_notify_installed(self) -> bool {
        matches!(self, Self::CandidateInstalled)
    }
}

async fn run_daemon(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    run_daemon_startup_maintenance(config, state, paths)?;
    if packaged_runtime_removed(config) {
        info!("packaged app files are gone; stopping updater daemon");
        return Ok(());
    }
    info!("daemon initialized");

    time::sleep(config.initial_check_delay_duration()).await;
    if let Err(error) = run_check_cycle_from_disk(config, state, paths).await {
        error!(?error, "initial check failed");
    }
    if let Err(error) = reconcile_pending_install_from_disk(config, state, paths).await {
        error!(?error, "initial reconciliation failed");
    }

    let mut check_interval = time::interval(config.check_interval_duration()?);
    let mut reconcile_interval = time::interval(Duration::from_secs(RECONCILE_INTERVAL_SECONDS));
    check_interval.tick().await;
    reconcile_interval.tick().await;
    loop {
        if packaged_runtime_removed(config) {
            info!("packaged app files are gone; stopping updater daemon");
            break;
        }

        if let Some(installed_binary) = restart::replacement_binary() {
            info!(
                installed_binary = %installed_binary.display(),
                "updater binary was replaced on disk; exiting so systemd restarts the daemon"
            );
            std::process::exit(BINARY_REPLACED_RESTART_EXIT_CODE);
        }

        tokio::select! {
            _ = check_interval.tick() => {
                if let Err(error) = run_check_cycle_from_disk(config, state, paths).await {
                    error!(?error, "periodic check failed");
                }
            }
            _ = reconcile_interval.tick() => {
                if let Err(error) = reconcile_pending_install_from_disk(config, state, paths).await {
                    error!(?error, "pending install reconciliation failed");
                }
            }
            signal = tokio::signal::ctrl_c() => {
                signal?;
                info!("daemon received shutdown signal");
                break;
            }
        }
    }

    Ok(())
}

async fn run_check_now(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    if_stale: bool,
) -> Result<()> {
    let lock_behavior = if if_stale {
        CheckLockBehavior::SkipIfBusy
    } else {
        CheckLockBehavior::Wait
    };
    run_check_cycle_with_options(config, state, paths, lock_behavior, if_stale, true, true).await
}

/// Detects a newer wrapper release and records it into state. Returns
/// `Ok(true)` when an update was found and recorded. No-ops (returning
/// `Ok(false)`) when wrapper tracking is disabled, the builder bundle is not a
/// git checkout, or no newer commit is available. Never mutates the checkout.
fn detect_and_record_wrapper_update(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<bool> {
    if !config.enable_wrapper_updates {
        clear_wrapper_update_candidate_and_persist(state, paths)?;
        return Ok(false);
    }

    let Some(installed) = wrapper::installed_wrapper_from_metadata(
        &config.app_executable_path,
        &config.builder_bundle_root,
    ) else {
        clear_stale_wrapper_update_and_persist(config, state, paths)?;
        return Ok(false);
    };

    use wrapper::WrapperDetectionState::*;

    let detection = match wrapper::detect_state_from_bundle_root(
        &config.builder_bundle_root,
        &installed,
        &config.wrapper_remote,
        &config.wrapper_branch,
    ) {
        Ok(result) => result,
        Err(error) => {
            warn!(?error, "wrapper update detection failed");
            let original_state = state.clone();
            state.installed_wrapper_version = installed.version;
            state.installed_wrapper_commit = Some(installed.commit);
            persist_if_changed(paths, state, &original_state)?;
            return Ok(false);
        }
    };

    let original_state = state.clone();
    state.installed_wrapper_version = installed.version.clone();
    state.installed_wrapper_commit = Some(installed.commit.clone());

    match detection {
        (UpdateAvailable, Some(update)) => {
            state.wrapper_dev_mode = Some(false);
            state.installed_wrapper_version = update.installed_version.clone();
            state.installed_wrapper_commit = Some(update.installed_commit.clone());
            state.candidate_wrapper_version = update.candidate_version.clone();
            state.candidate_wrapper_commit = Some(update.candidate_commit.clone());
            state.wrapper_changelog = Some(update.changelog.clone());
            persist_if_changed(paths, state, &original_state)?;

            let change_count = update
                .changelog
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count();
            maybe_notify(
                state,
                paths,
                config.notifications,
                &format!("wrapper_update:{}", update.candidate_commit),
                "ChatGPT wrapper update available",
                &format!(
                    "A newer chatgpt build is available ({change_count} change(s)). Rebuild to apply."
                ),
            )?;

            Ok(true)
        }
        (DevMode, _) => {
            state.clear_wrapper_update_candidate();
            state.wrapper_dev_mode = Some(true);
            persist_if_changed(paths, state, &original_state)?;
            Ok(false)
        }
        (Aligned, _) => {
            state.clear_wrapper_update_candidate();
            state.wrapper_dev_mode = Some(false);
            persist_if_changed(paths, state, &original_state)?;
            Ok(false)
        }
        (UnknownOffline, _) | (UpdateAvailable, None) => {
            state.clear_wrapper_update_candidate();
            persist_if_changed(paths, state, &original_state)?;
            Ok(false)
        }
    }
}

fn run_check_wrapper(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    json: bool,
) -> Result<()> {
    if !config.enable_wrapper_updates {
        clear_wrapper_update_candidate_and_persist(state, paths)?;
        if json {
            println!("{}", serde_json::json!({ "enabled": false }));
        } else {
            println!(
                "Wrapper update tracking is disabled (set enable_wrapper_updates = true in config.toml)."
            );
        }
        return Ok(());
    }

    let found = detect_and_record_wrapper_update(config, state, paths)?;

    if json {
        println!("{}", serde_json::to_string_pretty(state)?);
    } else if found {
        println!(
            "wrapper update available: {} -> {}",
            state
                .installed_wrapper_commit
                .as_deref()
                .unwrap_or("unknown"),
            state
                .candidate_wrapper_commit
                .as_deref()
                .unwrap_or("unknown")
        );
        if let Some(changelog) = state.wrapper_changelog.as_deref() {
            println!("\n{changelog}");
        }
    } else if state.wrapper_dev_mode == Some(true) {
        println!("wrapper is a local/dev build ahead of upstream; updates are disabled.");
    } else {
        println!("wrapper is up to date (or not a git checkout).");
    }

    Ok(())
}

fn upstream_check_is_fresh(config: &RuntimeConfig, state: &PersistedState) -> bool {
    let Some(last_successful_check_at) = state.last_successful_check_at else {
        return false;
    };

    let Ok(freshness_window) = config.check_interval_chrono_duration() else {
        return false;
    };
    Utc::now().signed_duration_since(last_successful_check_at) < freshness_window
}
fn run_status(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    json: bool,
) -> Result<()> {
    let _ = codex_cli::reconcile_if_present(config, state, paths)?;
    complete_current_dmg_update_if_already_installed(config, state, paths)?;
    let _ = complete_pending_install_if_already_installed(&config.workspace_root, state, paths)?;
    recover_interrupted_install(&config.workspace_root, state, paths)?;
    normalize_workspace_dir_and_persist(&config.workspace_root, state, paths)?;
    if !config.enable_wrapper_updates {
        clear_wrapper_update_candidate_and_persist(state, paths)?;
    }

    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&status_json_value(state)?)?
        );
    } else {
        println!("status: {:?}", state.status);
        println!("installed_version: {}", state.installed_version);
        println!(
            "candidate_version: {}",
            state.candidate_version.as_deref().unwrap_or("none")
        );
        println!(
            "last_known_good_version: {}",
            state.last_known_good_version.as_deref().unwrap_or("none")
        );
        println!(
            "rollback_blocked_candidate_version: {}",
            state
                .rollback_blocked_candidate_version
                .as_deref()
                .unwrap_or("none")
        );
        println!(
            "rollback_blocked_dmg_sha256: {}",
            state
                .rollback_blocked_dmg_sha256
                .as_deref()
                .unwrap_or("none")
        );
        println!("{}", update_error_status_line(state));
        println!("cli_status: {:?}", state.cli_status);
        println!(
            "cli_installed_version: {}",
            state.cli_installed_version.as_deref().unwrap_or("unknown")
        );
        println!(
            "cli_official_latest_version: {}",
            state
                .cli_official_latest_version
                .as_deref()
                .unwrap_or("unknown")
        );
        println!(
            "cli_package_manager_latest_version: {}",
            state
                .cli_package_manager_latest_version
                .as_deref()
                .unwrap_or("unknown")
        );
        println!(
            "cli_error: {}",
            state
                .cli_error_message
                .as_deref()
                .map(redaction::redact_for_persistence)
                .as_deref()
                .unwrap_or("none")
        );
    }

    Ok(())
}

fn status_json_value(state: &PersistedState) -> Result<serde_json::Value> {
    let mut value = serde_json::to_value(state.redacted_for_persistence())?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "cli_latest_version".to_string(),
            serde_json::to_value(&state.cli_official_latest_version)?,
        );
    }
    Ok(value)
}

fn update_error_status_line(state: &PersistedState) -> String {
    format!(
        "update_error: {}",
        state
            .error_message
            .as_deref()
            .map(redaction::redact_for_persistence)
            .as_deref()
            .unwrap_or("none")
    )
}

fn run_prompt_install_cli(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    cli_path: Option<PathBuf>,
    print_path: bool,
) -> Result<()> {
    let outcome = prompt_install_cli(config, state, paths, cli_path)?;
    match outcome {
        PromptInstallCliOutcome::Installed(path) => {
            if print_path {
                println!("{}", path.display());
            }
            std::process::exit(0);
        }
        PromptInstallCliOutcome::Cancelled => {
            std::process::exit(PROMPT_INSTALL_CLI_CANCELLED_EXIT_CODE);
        }
        PromptInstallCliOutcome::NoBackend => {
            std::process::exit(PROMPT_INSTALL_CLI_NO_BACKEND_EXIT_CODE);
        }
    }
}

fn run_cli_preflight(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    cli_path: Option<std::path::PathBuf>,
    print_path: bool,
    allow_install_missing: bool,
) -> Result<()> {
    let outcome = codex_cli::preflight(config, state, paths, cli_path, allow_install_missing)?;
    if print_path {
        println!("{}", outcome.cli_path.display());
    }
    Ok(())
}

fn run_recover_standalone_cli(
    codex_home: Option<PathBuf>,
    install_dir: Option<PathBuf>,
    print_path: bool,
) -> Result<()> {
    let launch_path = codex_cli::recover_standalone_cli(codex_home, install_dir)?;
    if print_path {
        println!("{}", launch_path.display());
    }
    Ok(())
}

fn run_repair_cli(state: &mut PersistedState, paths: &RuntimePaths) -> Result<()> {
    let outcome = codex_cli::repair_cli(state, paths)?;
    if outcome.quarantine_paths.is_empty() {
        println!(
            "Codex CLI repaired at version {}. The stale npm directory was already absent.",
            outcome.installed_version
        );
    } else {
        println!(
            "Codex CLI repaired at version {}. Quarantines preserved at {}",
            outcome.installed_version,
            outcome
                .quarantine_paths
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PromptInstallCliOutcome {
    Installed(PathBuf),
    Cancelled,
    NoBackend,
}

fn prompt_install_cli(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    cli_path: Option<PathBuf>,
) -> Result<PromptInstallCliOutcome> {
    if let Some(path) = cli_path
        .as_deref()
        .and_then(|path| codex_cli::resolve_cli_path(Some(path)))
        .or_else(|| {
            state
                .cli_path
                .as_deref()
                .and_then(|path| codex_cli::resolve_cli_path(Some(path)))
        })
        .or_else(|| {
            config
                .cli_path
                .as_deref()
                .and_then(|path| codex_cli::resolve_cli_path(Some(path)))
        })
        .or_else(|| codex_cli::resolve_cli_path(None))
    {
        return Ok(PromptInstallCliOutcome::Installed(path));
    }

    if recently_dismissed_cli_prompt(state) {
        return Ok(PromptInstallCliOutcome::Cancelled);
    }

    if !has_interactive_graphical_session() {
        return Ok(PromptInstallCliOutcome::NoBackend);
    }

    let consent = if prefers_kdialog() && command_in_path("kdialog").is_some() {
        run_kdialog_prompt()?
    } else if command_in_path("zenity").is_some() {
        run_zenity_prompt()?
    } else if command_in_path("kdialog").is_some() {
        run_kdialog_prompt()?
    } else {
        run_actionable_notification_prompt()?
    };

    if !consent {
        state.cli_prompt_dismissed_at = Some(Utc::now());
        persist_state(paths, state)?;
        return Ok(PromptInstallCliOutcome::Cancelled);
    }

    state.cli_prompt_dismissed_at = None;
    let outcome = codex_cli::preflight(config, state, paths, cli_path, true)?;
    Ok(PromptInstallCliOutcome::Installed(outcome.cli_path))
}

fn recently_dismissed_cli_prompt(state: &PersistedState) -> bool {
    state.cli_prompt_dismissed_at.is_some_and(|dismissed_at| {
        let elapsed = Utc::now().signed_duration_since(dismissed_at);
        elapsed >= ChronoDuration::zero() && elapsed < CLI_MISSING_PROMPT_DISMISS_TTL
    })
}

fn has_interactive_graphical_session() -> bool {
    let has_display =
        std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some();
    let has_dbus = std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some()
        || std::env::var_os("XDG_RUNTIME_DIR").is_some();
    has_display && has_dbus
}

fn has_user_session_bus_for_polkit() -> bool {
    std::env::var_os("DBUS_SESSION_BUS_ADDRESS").is_some()
        || std::env::var_os("XDG_RUNTIME_DIR").is_some()
}

fn prefers_kdialog() -> bool {
    desktop_tokens().iter().any(|token| {
        matches!(
            token.as_str(),
            "kde" | "plasma" | "plasmawayland" | "plasmax11"
        )
    })
}

fn desktop_tokens() -> Vec<String> {
    [
        std::env::var("XDG_CURRENT_DESKTOP").ok(),
        std::env::var("DESKTOP_SESSION").ok(),
    ]
    .into_iter()
    .flatten()
    .flat_map(|value| {
        value
            .split(':')
            .map(|segment| segment.trim().to_ascii_lowercase())
            .collect::<Vec<_>>()
    })
    .filter(|token| !token.is_empty())
    .collect()
}

fn command_in_path(name: &str) -> Option<PathBuf> {
    let path_env = std::env::var_os("PATH").unwrap_or_else(|| OsString::from(""));
    std::env::split_paths(&path_env).find_map(|entry| {
        let candidate = entry.join(name);
        if is_executable_file(&candidate) {
            Some(candidate)
        } else {
            None
        }
    })
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

fn run_kdialog_prompt() -> Result<bool> {
    let status = Command::new("kdialog")
        .args([
            "--title",
            "ChatGPT",
            "--yesno",
            "Codex CLI is not installed. Install it now?",
        ])
        .status()
        .context("Failed to launch kdialog")?;
    Ok(status.success())
}

fn run_zenity_prompt() -> Result<bool> {
    let status = Command::new("zenity")
        .args([
            "--question",
            "--title=ChatGPT",
            "--text=Codex CLI is not installed. Install it now?",
        ])
        .status()
        .context("Failed to launch zenity")?;
    Ok(status.success())
}

fn run_actionable_notification_prompt() -> Result<bool> {
    match notify::send_actionable(
        "Codex CLI not installed",
        "ChatGPT needs the Codex CLI. Choose Install now to let ChatGPT install it.",
        &[("install", "Install now"), ("dismiss", "Dismiss")],
    )? {
        notify::ActionResponse::Invoked(action) if action == "install" => Ok(true),
        _ => Ok(false),
    }
}

async fn run_check_cycle_from_disk(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    run_check_cycle_with_options(
        config,
        state,
        paths,
        CheckLockBehavior::SkipIfBusy,
        false,
        false,
        false,
    )
    .await
}

#[cfg(test)]
async fn run_check_cycle(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    state.save_updater(&paths.state_file)?;
    run_check_cycle_with_options(
        config,
        state,
        paths,
        CheckLockBehavior::SkipIfBusy,
        false,
        false,
        false,
    )
    .await
}

async fn run_check_cycle_with_options(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    lock_behavior: CheckLockBehavior,
    if_stale: bool,
    recover_entrypoint_state: bool,
    reconcile_after_check: bool,
) -> Result<()> {
    let Some(_check_lock) = acquire_check_lock(paths, lock_behavior).await? else {
        info!("skipping upstream check because another check is already active");
        return Ok(());
    };

    // Reload only after entering the serialization boundary. Every operation
    // below can persist the complete state document, so using a snapshot read
    // before the lock could overwrite an active checker's workspace metadata.
    reload_state_from_disk(config, state, paths)?;
    if recover_entrypoint_state {
        recover_interrupted_install(&config.workspace_root, state, paths)?;
        complete_current_dmg_update_if_already_installed(config, state, paths)?;
        normalize_workspace_dir_and_persist(&config.workspace_root, state, paths)?;
        maybe_notify_cli_missing(state, paths, config.notifications)?;
    }

    // Keep wrapper state fresh even while a DMG package is pending; otherwise
    // `status --json` could keep advertising stale wrapper candidates.
    if let Err(error) = detect_and_record_wrapper_update(config, state, paths) {
        warn!(?error, "wrapper update detection failed during check cycle");
    }

    if update_install_is_pending(&state.status) {
        info!("skipping upstream check because an update is already pending");
        maybe_prune_caches(config, state);
        if reconcile_after_check {
            reconcile_pending_install(config, state, paths).await?;
        }
        return Ok(());
    }

    reconcile_cli_if_present_best_effort(config, state, paths, "check cycle");

    if if_stale
        && !update_check_should_retry(&state.status)
        && upstream_check_is_fresh(config, state)
    {
        info!("skipping check-now because the last successful upstream check is still fresh");
        maybe_prune_caches(config, state);
        if reconcile_after_check {
            reconcile_pending_install(config, state, paths).await?;
        }
        return Ok(());
    }

    let client = dmg_source::http_client()?;

    let retrying_update = prepare_upstream_check(state, paths)?;

    let result: Result<()> = async {
        let metadata = dmg_source::fetch_remote_metadata(&client, &config.dmg_url).await?;
        let previous_headers_fingerprint = state.remote_headers_fingerprint.clone();
        state.remote_headers_fingerprint = Some(metadata.headers_fingerprint.clone());
        state.last_successful_check_at = Some(Utc::now());

        if previous_headers_fingerprint.as_deref() == Some(metadata.headers_fingerprint.as_str())
            && state.dmg_sha256.is_some()
            && state_has_verified_current_dmg(state)
            && !retrying_update
        {
            set_status(state, paths, UpdateStatus::Idle)?;
            info!("official DMG fingerprint unchanged; skipping download");
            return Ok(());
        }

        set_status(state, paths, UpdateStatus::DownloadingDmg)?;

        let downloads_dir = config.workspace_root.join("downloads");
        let downloaded =
            dmg_source::download_dmg(&client, &config.dmg_url, &downloads_dir, Utc::now()).await?;
        let manifest_path = trust::trusted_dmg_manifest_path(&config.builder_bundle_root);
        let verified = match trust::verify_downloaded_dmg_with_manifest(
            &manifest_path,
            &config.dmg_url,
            &downloaded.sha256,
        ) {
            Ok(verified) => {
                record_verified_dmg(state, &verified);
                info!(
                    candidate_version = %verified.version,
                    dmg_sha256 = %verified.sha256,
                    manifest = %verified.manifest_path.display(),
                    "verified downloaded DMG against repo-trusted metadata"
                );
                verified
            }
            Err(error) => {
                record_failed_dmg_verification(
                    state,
                    &downloaded.sha256,
                    manifest_path,
                    error.to_string(),
                );
                return Err(error);
            }
        };

        if installed_official_dmg_matches(config, &downloaded.sha256) {
            clear_dmg_update_candidate(
                state,
                paths,
                Some(downloaded.path),
                Some(downloaded.sha256),
            )?;
            info!("downloaded DMG hash matches installed app; no update detected");
            return Ok(());
        }

        if downloaded_dmg_is_blocked_by_rollback(
            state,
            &verified.version,
            &downloaded.candidate_version,
            &downloaded.sha256,
        ) {
            state.candidate_version = None;
            state.dmg_sha256 = Some(verified.sha256.clone());
            state.artifact_paths.dmg_path = Some(downloaded.path.clone());
            state.status = UpdateStatus::Idle;
            state.error_message = Some(format!(
                "Candidate {} was rolled back and will not be reinstalled automatically",
                verified.version
            ));
            persist_state(paths, state)?;
            info!(
                candidate_version = %verified.version,
                "skipping candidate blocked by rollback"
            );
            return Ok(());
        }

        if state.dmg_sha256.as_deref() == Some(downloaded.sha256.as_str()) && !retrying_update {
            state.status = UpdateStatus::Idle;
            state.artifact_paths.dmg_path = Some(downloaded.path);
            persist_state(paths, state)?;
            info!("downloaded DMG hash matches current cached DMG; no update detected");
            return Ok(());
        }

        rollback::record_current_package_as_known_good(state);
        state.status = UpdateStatus::UpdateDetected;
        state.candidate_version = Some(verified.version.clone());
        state.dmg_sha256 = Some(verified.sha256.clone());
        state.artifact_paths.dmg_path = Some(downloaded.path.clone());
        state.notified_events.clear();
        state.save_updater(&paths.state_file)?;

        maybe_notify(
            state,
            paths,
            config.notifications,
            "update_detected",
            "New ChatGPT update detected",
            "Preparing a local Linux package from the new official OpenAI ChatGPT DMG.",
        )?;

        let candidate_version = state
            .candidate_version
            .clone()
            .expect("candidate version should be set before local build");
        ensure_downloaded_dmg_still_matches_verified_metadata(&downloaded.path, &verified).await?;
        builder::build_update(config, state, paths, &candidate_version, &downloaded.path).await?;
        if state.candidate_version.as_deref() != Some(verified.version.as_str()) {
            let message = format!(
                "Built package version {} did not match trusted DMG metadata version {}",
                state.candidate_version.as_deref().unwrap_or("unknown"),
                verified.version
            );
            mark_failed_and_persist(state, paths, message.clone())?;
            return Err(anyhow::anyhow!(message));
        }
        drop(downloaded);
        maybe_notify_update_ready(state, paths, config.notifications)?;
        Ok(())
    }
    .await;

    // Every check outcome, including an early no-update return, releases its
    // DMG lease before bounded cache cleanup runs here.
    maybe_prune_caches(config, state);
    if let Err(error) = result {
        mark_failed_and_persist(state, paths, error.to_string())?;
        let _ = notify_failure(config, state, paths, &error);
        return Err(error);
    }

    if reconcile_after_check {
        reconcile_pending_install(config, state, paths).await?;
    }

    Ok(())
}

async fn reconcile_pending_install_from_disk(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let Some(_check_lock) = acquire_check_lock(paths, CheckLockBehavior::SkipIfBusy).await? else {
        info!("skipping pending install reconciliation because another updater flow is active");
        return Ok(());
    };
    reload_state_from_disk(config, state, paths)?;
    reconcile_pending_install(config, state, paths).await
}

async fn reconcile_pending_install(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    sync_runtime_state(config, state);
    recover_interrupted_install(&config.workspace_root, state, paths)?;
    let pending_recovery =
        complete_pending_install_if_already_installed(&config.workspace_root, state, paths)?;
    if pending_recovery.completed() {
        if pending_recovery.should_notify_installed() {
            let _ = maybe_notify_installed(state, paths, config.notifications);
        }
        return Ok(());
    }

    match state.status {
        UpdateStatus::ReadyToInstall => {
            let Some(package_path) = state.artifact_paths.package_path.clone() else {
                return Ok(());
            };

            if !package_path.exists() {
                mark_failed_and_persist(
                    state,
                    paths,
                    format!(
                        "Pending package artifact is missing: {}",
                        package_path.display()
                    ),
                )?;
                return Ok(());
            }

            if let Err(error) = ensure_ready_update_has_verified_dmg(state) {
                mark_failed_and_persist(state, paths, error.to_string())?;
                return Ok(());
            }
            let expected_package = match expected_package_for_ready_install(
                state,
                &config.workspace_root,
                &package_path,
            ) {
                Ok(expected) => expected,
                Err(error) => {
                    mark_failed_and_persist(state, paths, error.to_string())?;
                    return Ok(());
                }
            };

            // The persisted `auto_install_on_app_exit` key is kept for config
            // compatibility. In this flow it controls whether the updater
            // nudges a running app; installation still requires an explicit
            // install-ready trigger from the app/menu path.
            if state.auto_install_on_app_exit && liveness::is_app_running(config)? {
                if !graphical_polkit_auth_agent_is_likely_available() {
                    defer_install_for_manual_auth(state, paths, &package_path, &expected_package)?;
                    maybe_notify_manual_install_required(state, paths, config.notifications)?;
                    return Ok(());
                }
                clear_install_auth_required_event(state, paths)?;
                set_waiting_for_app_exit(state, paths, true)?;
                maybe_notify(
                    state,
                    paths,
                    config.notifications,
                    "ready_to_install",
                    "ChatGPT update ready",
                    "Open ChatGPT and choose Update to install the ready update.",
                )?;
                return Ok(());
            }

            set_status(state, paths, UpdateStatus::ReadyToInstall)?;
        }
        UpdateStatus::WaitingForAppExit => {
            let Some(package_path) = state.artifact_paths.package_path.clone() else {
                return Ok(());
            };

            if !package_path.exists() {
                mark_failed_and_persist(
                    state,
                    paths,
                    format!(
                        "Pending package artifact is missing: {}",
                        package_path.display()
                    ),
                )?;
                return Ok(());
            }

            if let Err(error) = ensure_ready_update_has_verified_dmg(state) {
                mark_failed_and_persist(state, paths, error.to_string())?;
                return Ok(());
            }
            let expected_package = match expected_package_for_ready_install(
                state,
                &config.workspace_root,
                &package_path,
            ) {
                Ok(expected) => expected,
                Err(error) => {
                    mark_failed_and_persist(state, paths, error.to_string())?;
                    return Ok(());
                }
            };
            if state.waiting_for_app_exit_auto_install && !state.auto_install_on_app_exit {
                set_status(state, paths, UpdateStatus::ReadyToInstall)?;
                return Ok(());
            }

            if liveness::is_app_running(config)? {
                if !graphical_polkit_auth_agent_is_likely_available() {
                    defer_install_for_manual_auth(state, paths, &package_path, &expected_package)?;
                    maybe_notify_manual_install_required(state, paths, config.notifications)?;
                    return Ok(());
                }
                clear_install_auth_required_event(state, paths)?;
                maybe_notify(
                    state,
                    paths,
                    config.notifications,
                    "waiting_for_app_exit",
                    "ChatGPT update ready",
                    "An update is ready and will install after you close ChatGPT.",
                )?;
                return Ok(());
            }

            if install_auth_retry_is_blocked(state) {
                return Ok(());
            }

            if !graphical_polkit_auth_agent_is_likely_available() {
                defer_install_for_manual_auth(state, paths, &package_path, &expected_package)?;
                maybe_notify_manual_install_required(state, paths, config.notifications)?;
                return Ok(());
            }

            trigger_install(
                state,
                paths,
                &config.workspace_root,
                &package_path,
                &expected_package,
                config.notifications,
            )
            .await?;
        }
        _ => {}
    }

    Ok(())
}

async fn run_install_ready(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let Some(_check_lock) = acquire_check_lock(paths, CheckLockBehavior::Wait).await? else {
        unreachable!("waiting for the updater flow lock always returns a lock");
    };
    reload_state_from_disk(config, state, paths)?;
    #[cfg(test)]
    wait_for_process_test_barrier(
        "CHATGPT_UPDATER_TEST_INSTALL_READY_RELOADED",
        "CHATGPT_UPDATER_TEST_INSTALL_READY_CONTINUE",
    )?;
    run_install_ready_locked(config, state, paths).await
}

#[cfg(test)]
fn signal_process_test_marker(variable: &str) -> Result<()> {
    let Some(path) = std::env::var_os(variable).map(PathBuf::from) else {
        return Ok(());
    };
    std::fs::write(&path, b"ready")
        .with_context(|| format!("Failed to write process test marker {}", path.display()))
}

#[cfg(test)]
fn wait_for_process_test_barrier(marker_variable: &str, release_variable: &str) -> Result<()> {
    let Some(marker_path) = std::env::var_os(marker_variable).map(PathBuf::from) else {
        return Ok(());
    };
    let release_path = std::env::var_os(release_variable)
        .map(PathBuf::from)
        .with_context(|| {
            format!("{release_variable} must be set when {marker_variable} is used")
        })?;
    std::fs::write(&marker_path, b"ready").with_context(|| {
        format!(
            "Failed to write process test marker {}",
            marker_path.display()
        )
    })?;

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !release_path.exists() {
        anyhow::ensure!(
            std::time::Instant::now() < deadline,
            "Timed out waiting for process test release {}",
            release_path.display()
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}

async fn run_install_ready_locked(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    sync_and_persist(config, state, paths)?;
    let recovering_interrupted_install = state.status == UpdateStatus::Installing;
    recover_interrupted_install(&config.workspace_root, state, paths)?;
    if recovering_interrupted_install && state.status == UpdateStatus::Failed {
        let message = state
            .error_message
            .clone()
            .unwrap_or_else(|| "Previous install attempt could not be recovered".to_string());
        maybe_send_notification(
            config.notifications,
            "ChatGPT update failed",
            "The previous install attempt could not be recovered. Check the updater log for details.",
        );
        return Err(anyhow::anyhow!(message));
    }

    if complete_current_dmg_update_if_already_installed(config, state, paths)? {
        println!("ChatGPT is already up to date.");
        return Ok(());
    }

    let pending_recovery =
        complete_pending_install_if_already_installed(&config.workspace_root, state, paths)?;
    if pending_recovery.completed() {
        if pending_recovery.should_notify_installed() {
            let _ = maybe_notify_installed(state, paths, config.notifications);
        }
        println!("ChatGPT update is already installed or superseded.");
        return Ok(());
    }

    match state.status {
        UpdateStatus::ReadyToInstall | UpdateStatus::WaitingForAppExit => {}
        UpdateStatus::Installing => {
            maybe_send_notification(
                config.notifications,
                "ChatGPT update already installing",
                "ChatGPT is already applying the ready update.",
            );
            println!("ChatGPT update is already installing.");
            return Ok(());
        }
        _ => {
            maybe_send_notification(
                config.notifications,
                "No ChatGPT update ready",
                "There is no rebuilt ChatGPT update waiting to install.",
            );
            println!("No ChatGPT update is ready to install.");
            return Ok(());
        }
    }

    let Some(package_path) = state.artifact_paths.package_path.clone() else {
        let message = "No ready update package is recorded";
        mark_failed_and_persist(state, paths, message)?;
        maybe_send_notification(
            config.notifications,
            "ChatGPT update failed",
            "The updater has no package path recorded for the ready update.",
        );
        return Err(anyhow::anyhow!(message));
    };

    if !package_path.exists() {
        let message = format!(
            "Pending package artifact is missing: {}",
            package_path.display()
        );
        mark_failed_and_persist(state, paths, message.clone())?;
        maybe_send_notification(
            config.notifications,
            "ChatGPT update failed",
            "The rebuilt package is missing. Check the updater log for details.",
        );
        return Err(anyhow::anyhow!(message));
    }

    if let Err(error) = ensure_ready_update_has_verified_dmg(state) {
        let message = error.to_string();
        mark_failed_and_persist(state, paths, message.clone())?;
        maybe_send_notification(config.notifications, "ChatGPT update failed", &message);
        return Err(anyhow::anyhow!(message));
    }
    let expected_package =
        match expected_package_for_ready_install(state, &config.workspace_root, &package_path) {
            Ok(expected) => expected,
            Err(error) => {
                let message = error.to_string();
                mark_failed_and_persist(state, paths, message.clone())?;
                maybe_send_notification(config.notifications, "ChatGPT update failed", &message);
                return Err(anyhow::anyhow!(message));
            }
        };

    if liveness::is_app_running(config)? {
        if !graphical_polkit_auth_agent_is_likely_available() {
            defer_install_for_manual_auth(state, paths, &package_path, &expected_package)?;
            maybe_send_manual_install_required_notification(config.notifications);
            print_manual_install_required(&package_path, &expected_package);
            return Ok(());
        }
        clear_install_auth_required_event(state, paths)?;
        set_waiting_for_app_exit(state, paths, false)?;
        maybe_send_notification(
            config.notifications,
            "ChatGPT update ready",
            "Close ChatGPT to install the ready update.",
        );
        println!("ChatGPT is running. Close it to install the ready update.");
        return Ok(());
    }

    clear_install_auth_required_event(state, paths)?;
    state.waiting_for_app_exit_auto_install = false;
    if !graphical_polkit_auth_agent_is_likely_available() {
        defer_install_for_manual_auth(state, paths, &package_path, &expected_package)?;
        maybe_send_manual_install_required_notification(config.notifications);
        print_manual_install_required(&package_path, &expected_package);
        return Ok(());
    }
    trigger_install(
        state,
        paths,
        &config.workspace_root,
        &package_path,
        &expected_package,
        config.notifications,
    )
    .await
}

fn expected_package_for_ready_install(
    state: &PersistedState,
    workspace_root: &Path,
    package_path: &Path,
) -> Result<install::ExpectedPackage> {
    package_verification::expected_package_for_ready_install(
        package_path,
        workspace_root,
        state.candidate_version.as_deref(),
        state.dmg_sha256.as_deref(),
        state.package_verification.as_ref(),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledBuildInfo {
    official_dmg: Option<InstalledOfficialDmg>,
}

#[derive(Debug, Deserialize)]
struct InstalledOfficialDmg {
    sha256: Option<String>,
}

fn complete_current_dmg_update_if_already_installed(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<bool> {
    if !dmg_update_state_can_be_cleared_as_current(&state.status) {
        return Ok(false);
    }

    if state.candidate_version.is_none() {
        return Ok(false);
    }

    let Some(candidate_sha256) = state.dmg_sha256.clone() else {
        return Ok(false);
    };

    if !installed_official_dmg_matches(config, &candidate_sha256) {
        return Ok(false);
    }

    clear_dmg_update_candidate(state, paths, None, Some(candidate_sha256))?;
    info!("recovered DMG update state because the candidate DMG is already installed");
    Ok(true)
}

fn dmg_update_state_can_be_cleared_as_current(status: &UpdateStatus) -> bool {
    matches!(
        status,
        UpdateStatus::UpdateDetected
            | UpdateStatus::DownloadingDmg
            | UpdateStatus::PreparingWorkspace
            | UpdateStatus::PatchingApp
            | UpdateStatus::BuildingPackage
            | UpdateStatus::ReadyToInstall
            | UpdateStatus::WaitingForAppExit
            | UpdateStatus::Installing
            | UpdateStatus::Failed
    )
}

fn clear_dmg_update_candidate(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    dmg_path: Option<PathBuf>,
    sha256: Option<String>,
) -> Result<()> {
    state.status = UpdateStatus::Idle;
    state.waiting_for_app_exit_auto_install = false;
    state.candidate_version = None;
    if let Some(sha256) = sha256 {
        state.dmg_sha256 = Some(sha256);
    }
    if let Some(dmg_path) = dmg_path {
        state.artifact_paths.dmg_path = Some(dmg_path);
    }
    state.artifact_paths.package_path = None;
    state.error_message = None;
    clear_dmg_update_notification_events(state);
    cache_cleanup::normalize_artifact_workspace_dir(&paths.cache_dir, state);
    persist_state(paths, state)
}

fn clear_dmg_update_notification_events(state: &mut PersistedState) {
    state.notified_events.retain(|event| {
        !event.starts_with("update_detected:")
            && !event.starts_with("ready_to_install:")
            && !event.starts_with("waiting_for_app_exit:")
            && !event.starts_with("install_auth_required:")
            && !event.starts_with("manual_install_required:")
            && !event.starts_with("build_failed:")
    });
}

fn installed_official_dmg_matches(config: &RuntimeConfig, sha256: &str) -> bool {
    installed_official_dmg_sha256(config).as_deref() == Some(sha256)
}

fn installed_official_dmg_sha256(config: &RuntimeConfig) -> Option<String> {
    installed_build_info_paths(config)
        .into_iter()
        .find_map(|path| official_dmg_sha256_from_build_info(&path))
}

fn installed_build_info_paths(config: &RuntimeConfig) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(app_root) = config.app_executable_path.parent() {
        paths.push(app_root.join(".chatgpt-linux/build-info.json"));
        paths.push(app_root.join("resources/chatgpt-linux-build-info.json"));
    }
    paths
}

fn official_dmg_sha256_from_build_info(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let build_info = serde_json::from_str::<InstalledBuildInfo>(&content).ok()?;
    build_info
        .official_dmg?
        .sha256
        .filter(|value| !value.is_empty())
}

fn complete_pending_install_if_already_installed(
    workspace_root: &Path,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<PendingInstallRecovery> {
    if !matches!(
        state.status,
        UpdateStatus::ReadyToInstall | UpdateStatus::WaitingForAppExit
    ) {
        return Ok(PendingInstallRecovery::NoChange);
    }

    let Some(candidate_version) = state.candidate_version.clone().filter(|candidate| {
        installed_version_satisfies_candidate(&state.installed_version, candidate)
    }) else {
        return Ok(PendingInstallRecovery::NoChange);
    };

    let candidate_is_installed =
        installed_version_matches_candidate(&state.installed_version, &candidate_version);
    if candidate_is_installed
        && state_has_verified_current_dmg(state)
        && state
            .artifact_paths
            .package_path
            .as_ref()
            .is_some_and(|package_path| package_path.exists())
    {
        return Ok(PendingInstallRecovery::NoChange);
    }
    let recovery = if candidate_is_installed {
        PendingInstallRecovery::CandidateInstalled
    } else {
        PendingInstallRecovery::SupersededByInstalledVersion
    };

    state.status = UpdateStatus::Installed;
    state.waiting_for_app_exit_auto_install = false;
    state.candidate_version = None;
    clear_rollback_blocked_candidate(state);
    if !candidate_is_installed {
        state.artifact_paths.package_path = None;
        state.package_verification = None;
    }
    state.error_message = None;
    state.notified_events.clear();
    cache_cleanup::normalize_artifact_workspace_dir(workspace_root, state);
    persist_state(paths, state)?;
    maybe_prune_workspace_cache(workspace_root, state);
    info!("recovered pending install state because the candidate version is already installed or superseded");
    Ok(recovery)
}

fn recover_interrupted_install(
    workspace_root: &Path,
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    if state.status != UpdateStatus::Installing {
        return Ok(());
    }

    if let Some(candidate_version) = state.candidate_version.clone().filter(|candidate| {
        installed_version_satisfies_candidate(&state.installed_version, candidate)
    }) {
        let candidate_is_installed =
            installed_version_matches_candidate(&state.installed_version, &candidate_version);

        state.status = UpdateStatus::Installed;
        state.waiting_for_app_exit_auto_install = false;
        state.candidate_version = None;
        clear_rollback_blocked_candidate(state);
        if !candidate_is_installed {
            state.artifact_paths.package_path = None;
            state.package_verification = None;
        }
        state.error_message = None;
        state.notified_events.clear();
        cache_cleanup::normalize_artifact_workspace_dir(workspace_root, state);
        persist_state(paths, state)?;
        maybe_prune_workspace_cache(workspace_root, state);
        info!("recovered interrupted install state because the candidate version is already installed");
        return Ok(());
    }

    let Some(package_path) = state.artifact_paths.package_path.clone() else {
        mark_failed_and_persist(
            state,
            paths,
            "Previous install attempt was interrupted and no package artifact is recorded",
        )?;
        return Ok(());
    };

    if !package_path.exists() {
        mark_failed_and_persist(
            state,
            paths,
            format!(
                "Previous install attempt was interrupted and the package artifact is missing: {}",
                package_path.display()
            ),
        )?;
        return Ok(());
    }

    state.status = UpdateStatus::ReadyToInstall;
    state.waiting_for_app_exit_auto_install = false;
    state.error_message =
        Some("Previous install attempt was interrupted before completion".to_string());
    cache_cleanup::normalize_artifact_workspace_dir(workspace_root, state);
    persist_state(paths, state)?;
    info!(package = %package_path.display(), "recovered interrupted install state back to ready_to_install");
    Ok(())
}

fn installed_version_satisfies_candidate(installed: &str, candidate: &str) -> bool {
    if installed == "unknown" {
        return false;
    }

    match compare_generated_versions(installed, candidate) {
        Some(std::cmp::Ordering::Less) => false,
        Some(_) => true,
        None => installed == candidate,
    }
}

fn installed_version_matches_candidate(installed: &str, candidate: &str) -> bool {
    match compare_generated_versions(installed, candidate) {
        Some(std::cmp::Ordering::Equal) => true,
        Some(_) => false,
        None => installed == candidate,
    }
}

fn clear_rollback_blocked_candidate(state: &mut PersistedState) {
    state.rollback_blocked_candidate_version = None;
    state.rollback_blocked_dmg_sha256 = None;
}

fn compare_generated_versions(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    let left = parse_generated_version(left)?;
    let right = parse_generated_version(right)?;
    Some(left.cmp(&right))
}

fn parse_generated_version(version: &str) -> Option<Vec<u32>> {
    let without_metadata = version
        .split_once('+')
        .map(|(prefix, _)| prefix)
        .unwrap_or(version);
    let base = without_metadata
        .split_once('-')
        .map(|(prefix, _)| prefix)
        .unwrap_or(without_metadata);
    let mut parts = Vec::new();
    for segment in base.split('.') {
        parts.push(segment.parse::<u32>().ok()?);
    }
    if !matches!(parts.len(), 3 | 4) {
        return None;
    }
    Some(parts)
}

fn maybe_notify(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    enabled: bool,
    event_name: &str,
    summary: &str,
    body: &str,
) -> Result<()> {
    let version = state
        .candidate_version
        .as_deref()
        .unwrap_or(&state.installed_version);
    let event_key = format!("{event_name}:{version}");
    maybe_notify_with_event_key(state, paths, enabled, &event_key, summary, body)
}

fn maybe_notify_with_event_key(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    enabled: bool,
    event_key: &str,
    summary: &str,
    body: &str,
) -> Result<()> {
    if !state.notified_events.insert(event_key.to_string()) {
        return Ok(());
    }

    if enabled {
        if let Err(error) = notify::send(summary, body) {
            warn!(?error, "failed to send desktop notification");
        }
    }

    persist_state(paths, state)?;
    Ok(())
}

fn clear_notification_event(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    event_key: &str,
) -> Result<()> {
    if state.notified_events.remove(event_key) {
        persist_state(paths, state)?;
    }

    Ok(())
}

fn cli_is_missing(state: &PersistedState) -> bool {
    state.cli_status == CliStatus::NotInstalled
}

fn maybe_notify_cli_missing(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    enabled: bool,
) -> Result<()> {
    if !cli_is_missing(state) {
        return clear_notification_event(state, paths, CLI_MISSING_NOTIFICATION_EVENT);
    }

    maybe_notify_with_event_key(
        state,
        paths,
        enabled,
        CLI_MISSING_NOTIFICATION_EVENT,
        "Codex CLI not installed",
        "ChatGPT needs the Codex CLI. Open the app to retry the automatic install flow, or install it manually with npm.",    )
}

fn maybe_notify_installed(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    enabled: bool,
) -> Result<()> {
    if state.status != UpdateStatus::Installed {
        return Ok(());
    }

    maybe_notify(
        state,
        paths,
        enabled,
        "installed",
        "ChatGPT updated",
        "The new package is installed and will be used the next time you open the app.",
    )
}

fn maybe_notify_update_ready(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    enabled: bool,
) -> Result<()> {
    let version = state
        .candidate_version
        .as_deref()
        .unwrap_or(&state.installed_version);
    let event_key = format!("ready_to_install:{version}");
    if !state.notified_events.insert(event_key) {
        return Ok(());
    }

    if enabled {
        let body = if state.auto_install_on_app_exit {
            "A rebuilt Linux package is ready. Close ChatGPT to install it, or open ChatGPT and choose Update."
        } else {
            "A rebuilt Linux package is ready. Open ChatGPT and choose Update to install it."
        };
        if let Err(error) = notify::send("ChatGPT update ready", body) {
            warn!(?error, "failed to send update-ready notification");
        }
    }

    persist_state(paths, state)?;
    Ok(())
}

fn maybe_send_notification(enabled: bool, summary: &str, body: &str) {
    if enabled {
        let _ = notify::send(summary, body);
    }
}

fn downloaded_dmg_is_blocked_by_rollback(
    state: &PersistedState,
    trusted_version: &str,
    legacy_download_candidate_version: &str,
    dmg_sha256: &str,
) -> bool {
    state
        .rollback_blocked_dmg_sha256
        .as_deref()
        .is_some_and(|blocked| blocked == dmg_sha256)
        || state
            .rollback_blocked_candidate_version
            .as_deref()
            .is_some_and(|blocked| {
                rollback_version_satisfies_candidate(blocked, trusted_version)
                    || rollback_version_satisfies_candidate(
                        blocked,
                        legacy_download_candidate_version,
                    )
            })
}

fn rollback_version_satisfies_candidate(blocked: &str, candidate: &str) -> bool {
    match (
        parse_generated_version(blocked),
        parse_generated_version(candidate),
    ) {
        (Some(blocked_parts), Some(candidate_parts))
            if blocked_parts.len() == 3 && candidate_parts.len() == 3 =>
        {
            false
        }
        (Some(blocked_parts), Some(candidate_parts))
            if blocked_parts.len() == candidate_parts.len() =>
        {
            installed_version_satisfies_candidate(blocked, candidate)
        }
        (Some(_), Some(_)) => false,
        _ => blocked == candidate,
    }
}

async fn trigger_install(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    workspace_root: &Path,
    package_path: &Path,
    expected_package: &install::ExpectedPackage,
    notifications: bool,
) -> Result<()> {
    state.status = UpdateStatus::Installing;
    state.waiting_for_app_exit_auto_install = false;
    state.error_message = None;
    persist_state(paths, state)?;

    maybe_send_notification(
        notifications,
        "Installing ChatGPT update",
        "Applying the locally rebuilt Linux package.",
    );

    let output = install::pkexec_command(package_path, Some(expected_package))?
        .output()
        .context("Failed to launch pkexec for update installation")?;
    let status = output.status;

    if status.success() {
        state.status = UpdateStatus::Installed;
        state.waiting_for_app_exit_auto_install = false;
        state.installed_version = install::installed_package_version();
        state.candidate_version = None;
        clear_rollback_blocked_candidate(state);
        state.error_message = None;
        state.notified_events.clear();
        cache_cleanup::normalize_artifact_workspace_dir(workspace_root, state);
        persist_state(paths, state)?;
        let _ = maybe_notify_installed(state, paths, notifications);
        maybe_prune_workspace_cache(workspace_root, state);
        return Ok(());
    }

    let stdout = summarize_command_output(&output.stdout);
    let stderr = summarize_command_output(&output.stderr);
    error!(
        status = %status,
        stdout = stdout.as_deref().unwrap_or(""),
        stderr = stderr.as_deref().unwrap_or(""),
        "privileged install failed"
    );

    let mut message = format!("Privileged install exited with status {status}");
    if let Some(stderr) = stderr {
        message.push_str(": ");
        message.push_str(&stderr);
    }

    let error = anyhow::anyhow!(message);
    if pkexec_authentication_was_not_obtained(&status) {
        defer_install_until_next_app_exit(state, paths, error.to_string())?;
        return Err(error);
    }

    mark_failed_and_persist(state, paths, error.to_string())?;
    let _ = notify::send(
        "ChatGPT update failed",
        "The package could not be installed. Check the updater log for details.",
    );
    Err(error)
}

fn pkexec_authentication_was_not_obtained(status: &std::process::ExitStatus) -> bool {
    matches!(status.code(), Some(126 | 127))
}

fn install_auth_required_event_key(state: &PersistedState) -> Option<String> {
    state
        .candidate_version
        .as_deref()
        .map(|candidate| format!("install_auth_required:{candidate}"))
}

fn install_auth_retry_is_blocked(state: &PersistedState) -> bool {
    install_auth_required_event_key(state)
        .as_ref()
        .is_some_and(|event_key| state.notified_events.contains(event_key))
}

fn manual_install_required_message(
    package_path: &Path,
    expected_package: &install::ExpectedPackage,
) -> String {
    format!(
        "No graphical polkit authentication agent is available for pkexec. Run this from a terminal after closing ChatGPT: {}",
        manual_install_command(package_path, expected_package)    )
}

fn manual_install_command(
    package_path: &Path,
    expected_package: &install::ExpectedPackage,
) -> String {
    let subcommand = match install::PackageKind::from_path(package_path) {
        install::PackageKind::Deb => "install-deb",
        install::PackageKind::Rpm => "install-rpm",
        install::PackageKind::Pacman => "install-pacman",
    };
    format!(
        "sudo /usr/bin/chatgpt-updater {subcommand} --path {} --expected-sha256 {} --expected-package-name {} --expected-package-version {}",
        shell_quote_path(package_path),
        shell_quote_value(expected_package.sha256()),
        shell_quote_value(expected_package.package_name()),
        shell_quote_value(expected_package.package_version()),
    )
}

fn shell_quote_path(path: &Path) -> String {
    shell_quote_value(&path.to_string_lossy())
}

fn shell_quote_value(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn print_manual_install_required(package_path: &Path, expected_package: &install::ExpectedPackage) {
    println!("Manual install required: no graphical polkit authentication agent is available.");
    println!("Run this from a terminal after closing ChatGPT:");
    println!("{}", manual_install_command(package_path, expected_package));
}

fn defer_install_for_manual_auth(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    package_path: &Path,
    expected_package: &install::ExpectedPackage,
) -> Result<()> {
    state.status = UpdateStatus::ReadyToInstall;
    state.waiting_for_app_exit_auto_install = false;
    state.error_message = Some(manual_install_required_message(
        package_path,
        expected_package,
    ));
    persist_state(paths, state)
}

fn maybe_notify_manual_install_required(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    enabled: bool,
) -> Result<()> {
    maybe_notify(
        state,
        paths,
        enabled,
        "manual_install_required",
        "ChatGPT update needs manual install",
        "No graphical authentication agent was found for pkexec. Run chatgpt-updater status for details.",    )
}

fn maybe_send_manual_install_required_notification(enabled: bool) {
    maybe_send_notification(
        enabled,
        "ChatGPT update needs manual install",
        "No graphical authentication agent was found for pkexec. Run chatgpt-updater status for details.",    );
}

fn graphical_polkit_auth_agent_is_likely_available() -> bool {
    if std::env::var_os("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT").is_some() {
        return false;
    }
    if std::env::var_os("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT").is_some() {
        return true;
    }
    if !has_user_session_bus_for_polkit() {
        return false;
    }
    polkit_auth_agent_process_is_running()
}

fn polkit_auth_agent_process_is_running() -> bool {
    let Ok(entries) = fs::read_dir("/proc") else {
        return true;
    };

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        if !file_name
            .to_string_lossy()
            .chars()
            .all(|character| character.is_ascii_digit())
        {
            continue;
        }
        let process_dir = entry.path();
        let mut process_text = String::new();
        if let Ok(comm) = fs::read_to_string(process_dir.join("comm")) {
            process_text.push_str(&comm);
            process_text.push('\n');
        }
        if let Ok(cmdline) = fs::read(process_dir.join("cmdline")) {
            process_text.push_str(&String::from_utf8_lossy(&cmdline).replace('\0', " "));
        }
        if process_text_matches_polkit_auth_agent(&process_text) {
            return true;
        }
    }

    false
}

fn process_text_matches_polkit_auth_agent(process_text: &str) -> bool {
    let normalized = process_text.to_ascii_lowercase();
    if normalized.contains("polkitd") || normalized.contains("polkit-agent-helper") {
        return false;
    }
    POLKIT_AUTH_AGENT_PROCESS_TOKENS
        .iter()
        .any(|token| normalized.contains(token))
}

fn clear_install_auth_required_event(
    state: &mut PersistedState,
    paths: &RuntimePaths,
) -> Result<()> {
    let Some(event_key) = install_auth_required_event_key(state) else {
        return Ok(());
    };

    if state.notified_events.remove(&event_key) {
        persist_state(paths, state)?;
    }

    Ok(())
}

fn defer_install_until_next_app_exit(
    state: &mut PersistedState,
    paths: &RuntimePaths,
    message: String,
) -> Result<()> {
    state.status = UpdateStatus::ReadyToInstall;
    state.waiting_for_app_exit_auto_install = false;
    state.error_message = Some(message);

    if let Some(event_key) = install_auth_required_event_key(state) {
        if state.notified_events.insert(event_key) {
            let _ = notify::send(
                "ChatGPT update needs permission",
                "The ready update will retry after the next app close. Approve the system authentication dialog to install it.",
            );
        }
    }

    persist_state(paths, state)
}

fn notify_failure(
    config: &RuntimeConfig,
    state: &mut PersistedState,
    paths: &RuntimePaths,
    error: &anyhow::Error,
) -> Result<()> {
    let body = format!("The local rebuild failed: {error}");
    maybe_notify(
        state,
        paths,
        config.notifications,
        "build_failed",
        "ChatGPT update failed",
        &body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        matchers::{method, path},
        Mock, MockServer, ResponseTemplate,
    };

    const TRUSTED_TEST_DMG_SHA256: &str =
        "6d440c7133771935c860a5546bcd603f8b9b65b37e9b82bdb0019d4fd0c85b6a";

    fn mark_test_dmg_verified(state: &mut PersistedState, version: &str) {
        state.dmg_sha256 = Some(TRUSTED_TEST_DMG_SHA256.to_string());
        state.dmg_verification = Some(DmgVerification {
            result: DmgVerificationResult::Verified,
            version: Some(version.to_string()),
            sha256: Some(TRUSTED_TEST_DMG_SHA256.to_string()),
            manifest_path: Some(PathBuf::from(
                "/usr/lib/chatgpt/update-builder/updater/trusted-dmg-manifest.json",
            )),
            verified_at: Some(Utc::now()),
            message: Some("Downloaded DMG matched repo-trusted metadata".to_string()),
        });
    }

    fn write_test_package_and_verification(
        state: &mut PersistedState,
        workspace_root: &Path,
        version: &str,
    ) -> Result<PathBuf> {
        let workspace = workspace_root.join("workspaces").join(version);
        let package_path = workspace.join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;
        state.package_verification = Some(package_verification::record_built_package(
            &package_path,
            &workspace,
            version,
            TRUSTED_TEST_DMG_SHA256,
        )?);
        Ok(package_path)
    }

    mod cli_repair_process_tests;

    fn test_paths(root: &std::path::Path) -> RuntimePaths {
        RuntimePaths {
            config_file: root.join("config/config.toml"),
            state_file: root.join("state/state.json"),
            log_file: root.join("state/service.log"),
            cache_dir: root.join("cache"),
            state_dir: root.join("state"),
            config_dir: root.join("config"),
        }
    }

    fn test_config(root: &std::path::Path) -> RuntimeConfig {
        RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: root.join("cache"),
            builder_bundle_root: root.join("builder"),
            app_executable_path: root.join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        }
    }

    fn write_installed_build_info(config: &RuntimeConfig, sha256: &str) -> Result<()> {
        let app_root = config
            .app_executable_path
            .parent()
            .expect("test app executable should have parent");
        std::fs::create_dir_all(app_root.join(".chatgpt-linux"))?;
        std::fs::write(
            app_root.join(".chatgpt-linux/build-info.json"),
            format!(
                r#"{{
  "officialDmg": {{
    "sha256": "{sha256}"
  }}
}}
"#
            ),
        )?;
        Ok(())
    }

    #[test]
    fn interrupted_preinstall_states_retry_the_update_check() {
        for status in [
            UpdateStatus::Failed,
            UpdateStatus::DownloadingDmg,
            UpdateStatus::UpdateDetected,
            UpdateStatus::PreparingWorkspace,
            UpdateStatus::PatchingApp,
            UpdateStatus::BuildingPackage,
        ] {
            assert!(update_check_should_retry(&status), "status: {status:?}");
        }

        for status in [
            UpdateStatus::Idle,
            UpdateStatus::CheckingUpstream,
            UpdateStatus::ReadyToInstall,
            UpdateStatus::WaitingForAppExit,
            UpdateStatus::Installing,
            UpdateStatus::Installed,
        ] {
            assert!(!update_check_should_retry(&status), "status: {status:?}");
        }
    }

    #[test]
    fn upstream_check_setup_preserves_persisted_retry_intent() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;

        for status in [
            UpdateStatus::Failed,
            UpdateStatus::DownloadingDmg,
            UpdateStatus::UpdateDetected,
            UpdateStatus::PreparingWorkspace,
            UpdateStatus::PatchingApp,
            UpdateStatus::BuildingPackage,
        ] {
            let mut state = PersistedState::new(true);
            state.status = status.clone();
            state.error_message = Some("previous failure".to_string());

            assert!(prepare_upstream_check(&mut state, &paths)?);
            assert_eq!(state.status, status);
            assert!(state.last_check_at.is_some());
            assert_eq!(state.error_message, None);

            let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
            assert_eq!(persisted.status, status);
        }

        let mut fresh_state = PersistedState::new(true);
        assert!(!prepare_upstream_check(&mut fresh_state, &paths)?);
        assert_eq!(fresh_state.status, UpdateStatus::CheckingUpstream);
        let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(persisted.status, UpdateStatus::CheckingUpstream);
        Ok(())
    }

    #[test]
    fn disabled_wrapper_tracking_clears_stale_candidate() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());

        let mut state = PersistedState::new(true);
        state.installed_wrapper_commit = Some("installed".to_string());
        state.candidate_wrapper_commit = Some("stale".to_string());
        state.candidate_wrapper_version = Some("0.9.0".to_string());
        state.wrapper_changelog = Some("old changelog".to_string());
        state.wrapper_dev_mode = Some(true);

        let found = detect_and_record_wrapper_update(&config, &mut state, &paths)?;

        assert!(!found);
        assert_eq!(state.installed_wrapper_commit.as_deref(), Some("installed"));
        assert_eq!(state.candidate_wrapper_commit, None);
        assert_eq!(state.candidate_wrapper_version, None);
        assert_eq!(state.wrapper_changelog, None);
        assert_eq!(state.wrapper_dev_mode, None);

        let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(persisted.candidate_wrapper_commit, None);
        assert_eq!(persisted.wrapper_changelog, None);
        assert_eq!(persisted.wrapper_dev_mode, None);
        Ok(())
    }

    #[test]
    fn no_wrapper_update_clears_stale_candidate() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let mut config = test_config(temp.path());
        config.enable_wrapper_updates = true;
        std::fs::create_dir_all(&config.builder_bundle_root)?;

        let mut state = PersistedState::new(true);
        state.installed_wrapper_commit = Some("old-installed".to_string());
        state.candidate_wrapper_commit = Some("stale".to_string());
        state.candidate_wrapper_version = Some("0.9.0".to_string());
        state.wrapper_changelog = Some("old changelog".to_string());
        state.wrapper_dev_mode = Some(true);

        let found = detect_and_record_wrapper_update(&config, &mut state, &paths)?;

        assert!(!found);
        assert_eq!(state.installed_wrapper_commit, None);
        assert_eq!(state.installed_wrapper_version, None);
        assert_eq!(state.candidate_wrapper_commit, None);
        assert_eq!(state.candidate_wrapper_version, None);
        assert_eq!(state.wrapper_changelog, None);
        assert_eq!(state.wrapper_dev_mode, None);

        let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(persisted.installed_wrapper_commit, None);
        assert_eq!(persisted.candidate_wrapper_commit, None);
        assert_eq!(persisted.wrapper_changelog, None);
        assert_eq!(persisted.wrapper_dev_mode, None);
        Ok(())
    }

    #[test]
    fn unknown_wrapper_detection_clears_stale_candidate_but_records_installed_metadata(
    ) -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let mut config = test_config(temp.path());
        config.enable_wrapper_updates = true;
        std::fs::create_dir_all(config.builder_bundle_root.join(".chatgpt-linux"))?;
        std::fs::write(
            config
                .builder_bundle_root
                .join(".chatgpt-linux/source-info.json"),
            r#"{
  "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "version": "0.8.1"
}
"#,
        )?;

        let mut state = PersistedState::new(true);
        state.candidate_wrapper_commit = Some("stale".to_string());
        state.candidate_wrapper_version = Some("0.9.0".to_string());
        state.wrapper_changelog = Some("old changelog".to_string());
        state.wrapper_dev_mode = Some(true);

        let found = detect_and_record_wrapper_update(&config, &mut state, &paths)?;

        assert!(!found);
        assert_eq!(
            state.installed_wrapper_commit.as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
        assert_eq!(state.installed_wrapper_version.as_deref(), Some("0.8.1"));
        assert_eq!(state.candidate_wrapper_commit, None);
        assert_eq!(state.candidate_wrapper_version, None);
        assert_eq!(state.wrapper_changelog, None);
        assert_eq!(state.wrapper_dev_mode, None);
        Ok(())
    }

    #[tokio::test]
    async fn pending_dmg_update_still_clears_stale_wrapper_candidate() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_wrapper_commit = Some("stale".to_string());
        state.candidate_wrapper_version = Some("0.9.0".to_string());
        state.wrapper_changelog = Some("old changelog".to_string());
        state.wrapper_dev_mode = Some(true);

        run_check_cycle(&config, &mut state, &paths).await?;

        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert_eq!(state.candidate_wrapper_commit, None);
        assert_eq!(state.candidate_wrapper_version, None);
        assert_eq!(state.wrapper_changelog, None);
        assert_eq!(state.wrapper_dev_mode, None);
        let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(persisted.candidate_wrapper_commit, None);
        assert_eq!(persisted.wrapper_changelog, None);
        assert_eq!(persisted.wrapper_dev_mode, None);
        Ok(())
    }

    #[test]
    fn fresh_check_now_still_clears_stale_wrapper_candidate() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
            "HOME",
            "PATH",
            "NVM_DIR",
            "XDG_CONFIG_HOME",
            "CODEX_CLI_PATH",
            "CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP",
        ]);
        std::env::set_var("HOME", temp.path());
        std::env::set_var("PATH", temp.path().join("missing-bin"));
        std::env::remove_var("NVM_DIR");
        std::env::remove_var("XDG_CONFIG_HOME");
        std::env::remove_var("CODEX_CLI_PATH");
        std::env::set_var("CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP", "1");

        let mut state = PersistedState::new(true);
        state.last_successful_check_at = Some(Utc::now());
        state.candidate_wrapper_commit = Some("stale".to_string());
        state.candidate_wrapper_version = Some("0.9.0".to_string());
        state.wrapper_changelog = Some("old changelog".to_string());
        state.wrapper_dev_mode = Some(true);
        state.save_updater(&paths.state_file)?;

        runtime.block_on(run_check_now(&config, &mut state, &paths, true))?;

        assert_eq!(state.status, UpdateStatus::Idle);
        assert_eq!(state.candidate_wrapper_commit, None);
        assert_eq!(state.candidate_wrapper_version, None);
        assert_eq!(state.wrapper_changelog, None);
        assert_eq!(state.wrapper_dev_mode, None);
        let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(persisted.candidate_wrapper_commit, None);
        assert_eq!(persisted.wrapper_changelog, None);
        assert_eq!(persisted.wrapper_dev_mode, None);
        Ok(())
    }

    #[test]
    fn plain_status_reports_update_error() {
        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::Failed;
        state.error_message = Some("install.sh failed during local rebuild".to_string());

        assert_eq!(
            update_error_status_line(&state),
            "update_error: install.sh failed during local rebuild"
        );

        state.error_message = None;
        assert_eq!(update_error_status_line(&state), "update_error: none");
    }

    #[tokio::test]
    async fn failed_state_with_existing_deb_stays_failed() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: std::env::current_exe()?,
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::Failed;
        state.candidate_version = Some("2999.03.25.010203+deadbeef".to_string());
        state.error_message = Some("previous failure".to_string());
        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;
        state.artifact_paths.package_path = Some(package_path);

        reconcile_pending_install(&config, &mut state, &paths).await?;

        assert_eq!(state.status, UpdateStatus::Failed);
        assert_eq!(state.error_message.as_deref(), Some("previous failure"));
        Ok(())
    }

    #[tokio::test]
    async fn run_check_cycle_skips_when_update_is_already_pending() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            dmg_url: "https://invalid.example/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        for status in [
            UpdateStatus::ReadyToInstall,
            UpdateStatus::WaitingForAppExit,
            UpdateStatus::Installing,
        ] {
            let mut state = PersistedState::new(true);
            state.status = status.clone();

            run_check_cycle(&config, &mut state, &paths).await?;

            assert_eq!(state.status, status);
            assert_eq!(state.last_check_at, None);
        }

        Ok(())
    }

    #[tokio::test]
    async fn daemon_check_cycle_reloads_pending_state_written_by_another_process() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let mut config = test_config(temp.path());
        config.dmg_url = "https://invalid.example/ChatGPT.dmg".to_string();

        let mut on_disk = PersistedState::new(true);
        on_disk.status = UpdateStatus::WaitingForAppExit;
        on_disk.candidate_version = Some("2999.03.25.010203+deadbeef".to_string());
        on_disk.waiting_for_app_exit_auto_install = true;
        on_disk.save(&paths.state_file)?;

        let mut stale_daemon_state = PersistedState::new(true);
        stale_daemon_state.status = UpdateStatus::Idle;

        run_check_cycle_from_disk(&config, &mut stale_daemon_state, &paths).await?;

        assert_eq!(stale_daemon_state.status, UpdateStatus::WaitingForAppExit);
        assert!(stale_daemon_state.waiting_for_app_exit_auto_install);
        assert_eq!(stale_daemon_state.last_check_at, None);
        Ok(())
    }

    #[tokio::test]
    async fn run_check_cycle_fails_when_downloaded_dmg_has_no_trusted_metadata() -> Result<()> {
        use wiremock::{
            matchers::{method, path},
            Mock, MockServer, ResponseTemplate,
        };
        let server = MockServer::start().await;
        Mock::given(method("HEAD"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("ETag", "\"untrusted\"")
                    .insert_header("Content-Length", "13"),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"untrusted-dmg".to_vec()))
            .mount(&server)
            .await;

        let temp = tempfile::tempdir()?;
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
            dmg_url: format!("{}/ChatGPT.dmg", server.uri()),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);
        let error = run_check_cycle(&config, &mut state, &paths)
            .await
            .expect_err("untrusted DMG should fail before local rebuild");

        assert!(error
            .to_string()
            .contains("Failed to read trusted DMG metadata"));
        assert_eq!(state.status, UpdateStatus::Failed);
        assert!(state
            .error_message
            .as_deref()
            .unwrap_or_default()
            .contains("Failed to read trusted DMG metadata"));
        assert_eq!(state.artifact_paths.package_path, None);
        Ok(())
    }

    #[tokio::test]
    async fn run_check_cycle_rechecks_unchanged_headers_without_verification_state() -> Result<()> {
        use wiremock::{
            matchers::{method, path},
            Mock, MockServer, ResponseTemplate,
        };

        let server = MockServer::start().await;
        Mock::given(method("HEAD"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("ETag", "\"stable\"")
                    .insert_header("Content-Length", "13"),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"untrusted-dmg".to_vec()))
            .mount(&server)
            .await;

        let temp = tempfile::tempdir()?;
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
            dmg_url: format!("{}/ChatGPT.dmg", server.uri()),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);
        state.remote_headers_fingerprint =
            Some("etag=\"stable\"|last_modified=|content_length=13".to_string());
        state.dmg_sha256 =
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string());

        let error = run_check_cycle(&config, &mut state, &paths)
            .await
            .expect_err("state without trusted DMG verification should be rechecked");

        assert!(error
            .to_string()
            .contains("Failed to read trusted DMG metadata"));
        assert_eq!(state.status, UpdateStatus::Failed);
        Ok(())
    }

    #[tokio::test]
    async fn run_check_cycle_rechecks_unchanged_headers_with_incomplete_verification_state(
    ) -> Result<()> {
        use wiremock::{
            matchers::{method, path},
            Mock, MockServer, ResponseTemplate,
        };

        let server = MockServer::start().await;
        Mock::given(method("HEAD"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("ETag", "\"stable\"")
                    .insert_header("Content-Length", "13"),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"untrusted-dmg".to_vec()))
            .mount(&server)
            .await;

        let temp = tempfile::tempdir()?;
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
            dmg_url: format!("{}/ChatGPT.dmg", server.uri()),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);
        state.remote_headers_fingerprint =
            Some("etag=\"stable\"|last_modified=|content_length=13".to_string());
        state.dmg_sha256 = Some(TRUSTED_TEST_DMG_SHA256.to_string());
        state.dmg_verification = Some(DmgVerification {
            result: DmgVerificationResult::Verified,
            version: None,
            sha256: Some(TRUSTED_TEST_DMG_SHA256.to_string()),
            manifest_path: Some(PathBuf::from(
                "/usr/lib/chatgpt/update-builder/updater/trusted-dmg-manifest.json",
            )),
            verified_at: Some(Utc::now()),
            message: Some("Downloaded DMG matched repo-trusted metadata".to_string()),
        });

        let error = run_check_cycle(&config, &mut state, &paths)
            .await
            .expect_err("incomplete trusted DMG verification should be rechecked");

        assert!(error
            .to_string()
            .contains("Failed to read trusted DMG metadata"));
        assert_eq!(state.status, UpdateStatus::Failed);
        Ok(())
    }

    #[tokio::test]
    async fn interrupted_download_with_cached_hash_requires_trusted_metadata() -> Result<()> {
        let server = MockServer::start().await;
        let body = b"chatgpt-dmg-test-payload";
        let sha256 = "678cd508ffe0071e217020a7a4eecbebe25362c022ac78c13a5ae87b7a3a0c92";
        let headers_fingerprint = format!(
            "etag=\"same-dmg\"|last_modified=|content_length={}",
            body.len()
        );

        Mock::given(method("HEAD"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("ETag", "\"same-dmg\"")
                    .insert_header("Content-Length", body.len().to_string()),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body.to_vec()))
            .expect(1)
            .mount(&server)
            .await;

        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let mut config = test_config(temp.path());
        config.dmg_url = format!("{}/ChatGPT.dmg", server.uri());
        write_installed_build_info(
            &config,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::DownloadingDmg;
        state.remote_headers_fingerprint = Some(headers_fingerprint);
        state.dmg_sha256 = Some(sha256.to_string());

        let error = run_check_cycle(&config, &mut state, &paths)
            .await
            .expect_err("retry without trusted metadata should fail closed");
        server.verify().await;

        assert!(error
            .to_string()
            .contains("Failed to read trusted DMG metadata"));
        assert_eq!(state.status, UpdateStatus::Failed);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.dmg_sha256.as_deref(), Some(sha256));
        assert_eq!(state.artifact_paths.workspace_dir, None);
        assert!(state
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("Failed to read trusted DMG metadata")));
        assert!(state.last_successful_check_at.is_some());
        Ok(())
    }

    #[test]
    fn check_lock_file_without_kernel_lock_does_not_block_acquire() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let lock_path = paths.state_dir.join("check.lock");
        std::fs::write(&lock_path, b"stale-pid")?;

        let lock = try_acquire_check_lock(&paths)?;

        assert!(lock.is_some());
        assert_eq!(
            std::fs::read_to_string(&lock_path)?.trim(),
            std::process::id().to_string()
        );
        Ok(())
    }

    #[test]
    fn held_check_lock_blocks_second_acquire_until_drop() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let first_lock =
            try_acquire_check_lock(&paths)?.expect("first lock acquisition should succeed");
        let second_lock = try_acquire_check_lock(&paths)?;

        assert!(second_lock.is_none());
        drop(second_lock);
        drop(first_lock);

        let mut reacquired_lock = None;
        for _ in 0..20 {
            reacquired_lock = try_acquire_check_lock(&paths)?;
            if reacquired_lock.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        assert!(reacquired_lock.is_some());
        Ok(())
    }

    #[test]
    fn forced_check_now_waits_for_startup_maintenance_lock_then_checks_upstream() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        runtime.block_on(async {
            let server = MockServer::start().await;
            let body_len = 42;
            Mock::given(method("HEAD"))
                .and(path("/ChatGPT.dmg"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .insert_header("ETag", "\"unchanged\"")
                        .insert_header("Content-Length", body_len.to_string()),
                )
                .expect(1)
                .mount(&server)
                .await;

            let temp = tempfile::tempdir()?;
            let paths = test_paths(temp.path());
            paths.ensure_dirs()?;
            let mut config = test_config(temp.path());
            config.dmg_url = format!("{}/ChatGPT.dmg", server.uri());
            let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
                "HOME",
                "PATH",
                "NVM_DIR",
                "XDG_CONFIG_HOME",
                "CODEX_CLI_PATH",
                "CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP",
            ]);
            std::env::set_var("HOME", temp.path());
            std::env::set_var("PATH", temp.path().join("missing-bin"));
            std::env::remove_var("NVM_DIR");
            std::env::remove_var("XDG_CONFIG_HOME");
            std::env::remove_var("CODEX_CLI_PATH");
            std::env::set_var("CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP", "1");

            let mut persisted_state = PersistedState::new(true);
            persisted_state.remote_headers_fingerprint = Some(format!(
                "etag=\"unchanged\"|last_modified=|content_length={body_len}"
            ));
            mark_test_dmg_verified(&mut persisted_state, "26.513.31313");
            persisted_state.last_successful_check_at = Some(Utc::now());
            persisted_state.save_updater(&paths.state_file)?;

            let active_maintenance =
                try_acquire_check_lock(&paths)?.expect("startup maintenance should hold the lock");
            let started = tokio::time::Instant::now();
            let release_maintenance = async move {
                time::sleep(Duration::from_millis(100)).await;
                drop(active_maintenance);
            };
            let mut stale_state = PersistedState::new(true);
            let forced_check = run_check_now(&config, &mut stale_state, &paths, false);

            let (check_result, ()) = tokio::join!(forced_check, release_maintenance);
            check_result?;
            server.verify().await;

            assert!(started.elapsed() >= Duration::from_millis(75));
            assert!(stale_state.last_check_at.is_some());
            assert_eq!(stale_state.status, UpdateStatus::Idle);
            Ok(())
        })
    }

    #[test]
    fn daemon_startup_does_not_persist_stale_state_or_prune_while_check_is_active() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let workspace = config.workspace_root.join("workspaces/active-build");
        std::fs::create_dir_all(workspace.join("builder"))?;
        std::fs::write(workspace.join("builder/install.sh"), b"#!/bin/sh\n")?;

        let mut persisted_state = PersistedState::new(true);
        persisted_state.status = UpdateStatus::PatchingApp;
        persisted_state.candidate_version = Some("2999.07.23.010927+05a76850".to_string());
        persisted_state.artifact_paths.workspace_dir = Some(workspace.clone());
        persisted_state.save_updater(&paths.state_file)?;

        let _active_check =
            try_acquire_check_lock(&paths)?.expect("active check should acquire the lock");
        let mut stale_state = PersistedState::new(true);
        stale_state.installed_version = "stale-entrypoint-snapshot".to_string();

        run_daemon_startup_maintenance(&config, &mut stale_state, &paths)?;

        let after = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(after.status, UpdateStatus::PatchingApp);
        assert_eq!(
            after.candidate_version.as_deref(),
            Some("2999.07.23.010927+05a76850")
        );
        assert_eq!(
            after.artifact_paths.workspace_dir.as_deref(),
            Some(workspace.as_path())
        );
        assert!(workspace.join("builder/install.sh").exists());
        Ok(())
    }

    #[tokio::test]
    async fn daemon_reconcile_does_not_persist_stale_state_while_check_is_active() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let workspace = config.workspace_root.join("workspaces/active-build");
        std::fs::create_dir_all(workspace.join("builder"))?;

        let mut persisted_state = PersistedState::new(true);
        persisted_state.status = UpdateStatus::BuildingPackage;
        persisted_state.candidate_version = Some("2999.07.23.010927+05a76850".to_string());
        persisted_state.artifact_paths.workspace_dir = Some(workspace.clone());
        persisted_state.save_updater(&paths.state_file)?;

        let _active_check =
            try_acquire_check_lock(&paths)?.expect("active check should acquire the lock");
        let mut stale_state = PersistedState::new(true);

        reconcile_pending_install_from_disk(&config, &mut stale_state, &paths).await?;

        let after = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(after.status, UpdateStatus::BuildingPackage);
        assert_eq!(
            after.artifact_paths.workspace_dir.as_deref(),
            Some(workspace.as_path())
        );
        Ok(())
    }

    fn process_test_paths(root: &Path) -> RuntimePaths {
        let config_dir = root.join("xdg-config/chatgpt-updater");
        let state_dir = root.join("xdg-state/chatgpt-updater");
        RuntimePaths {
            config_file: config_dir.join("config.toml"),
            state_file: state_dir.join("state.json"),
            log_file: state_dir.join("service.log"),
            cache_dir: root.join("xdg-cache/chatgpt-updater"),
            state_dir,
            config_dir,
        }
    }

    fn configure_process_test_command(
        command: &mut std::process::Command,
        root: &Path,
        role: &str,
    ) {
        use std::os::unix::process::CommandExt;

        command
            .arg("--exact")
            .arg("app::tests::updater_flow_process_child")
            .arg("--nocapture")
            .env("CHATGPT_UPDATER_TEST_PROCESS_ROLE", role)
            .env(
                "CHATGPT_UPDATER_TEST_INSTALLED_BINARY",
                std::env::current_exe().expect("current updater test executable"),
            )
            .env("HOME", root.join("home"))
            .env("XDG_CONFIG_HOME", root.join("xdg-config"))
            .env("XDG_STATE_HOME", root.join("xdg-state"))
            .env("XDG_CACHE_HOME", root.join("xdg-cache"))
            .env(
                "CHATGPT_LINUX_SETTINGS_FILE",
                root.join("missing-settings.json"),
            )
            .env_remove("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT")
            .env("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", "1")
            .env_remove("CODEX_CLI_PATH")
            .env_remove("FNM_DIR")
            .env_remove("FNM_MULTISHELL_PATH")
            .env_remove("HOMEBREW_PREFIX")
            .env_remove("NVM_DIR")
            .env_remove("XDG_DATA_HOME");
        command.process_group(0);
    }

    struct ProcessTestChild {
        child: Option<std::process::Child>,
        release_paths: Vec<PathBuf>,
        role: String,
    }

    impl ProcessTestChild {
        fn process_group(&self) -> i32 {
            self.child
                .as_ref()
                .expect("process test child should be present")
                .id() as i32
        }

        fn wait(mut self) -> Result<()> {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                let status = self
                    .child
                    .as_mut()
                    .expect("process test child should be present")
                    .try_wait()
                    .with_context(|| {
                        format!(
                            "Failed to wait for updater process test child {}",
                            self.role
                        )
                    })?;
                if let Some(status) = status {
                    self.child.take();
                    anyhow::ensure!(
                        status.success(),
                        "Updater process test child {} exited with {status}",
                        self.role
                    );
                    return Ok(());
                }
                if std::time::Instant::now() >= deadline {
                    self.terminate();
                    anyhow::bail!("Updater process test child {} timed out", self.role);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }

        fn terminate(&mut self) {
            for path in &self.release_paths {
                let _ = std::fs::write(path, b"cleanup");
            }

            let Some(child) = self.child.as_mut() else {
                return;
            };
            let process_group = child.id() as i32;
            // SAFETY: each test child is spawned as the leader of a dedicated
            // process group, so signaling the negative child pid cannot target
            // the cargo test runner or an unrelated process.
            unsafe {
                let _ = libc::kill(-process_group, libc::SIGTERM);
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
            while std::time::Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    self.child.take();
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }

            // SAFETY: the same dedicated process-group invariant applies.
            unsafe {
                let _ = libc::kill(-process_group, libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            self.child.take();
        }
    }

    impl Drop for ProcessTestChild {
        fn drop(&mut self) {
            self.terminate();
        }
    }

    fn spawn_process_test_child(
        root: &Path,
        role: &str,
        env: &[(&str, &Path)],
        release_paths: &[&Path],
    ) -> Result<ProcessTestChild> {
        let mut command = std::process::Command::new(std::env::current_exe()?);
        configure_process_test_command(&mut command, root, role);
        for (key, value) in env {
            command.env(key, value);
        }
        let child = command
            .spawn()
            .with_context(|| format!("Failed to spawn updater process test child {role}"))?;
        Ok(ProcessTestChild {
            child: Some(child),
            release_paths: release_paths
                .iter()
                .map(|path| path.to_path_buf())
                .collect(),
            role: role.to_string(),
        })
    }

    fn wait_for_process_test_path(path: &Path, description: &str) -> Result<()> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !path.exists() {
            anyhow::ensure!(
                std::time::Instant::now() < deadline,
                "Timed out waiting for {description}: {}",
                path.display()
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        Ok(())
    }

    fn prepare_process_install_fixture(root: &Path) -> Result<(RuntimePaths, PathBuf, PathBuf)> {
        let paths = process_test_paths(root);
        paths.ensure_dirs()?;
        std::fs::create_dir_all(root.join("home"))?;

        let mut config = test_config(root);
        config.workspace_root = paths.cache_dir.clone();
        std::fs::write(&paths.config_file, toml::to_string(&config)?)?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::WaitingForAppExit;
        state.installed_version = "stale-entrypoint-snapshot".to_string();
        let candidate_version = "2999.07.24.010203+deadbeef";
        state.candidate_version = Some(candidate_version.to_string());
        state.waiting_for_app_exit_auto_install = true;
        mark_test_dmg_verified(&mut state, candidate_version);
        let package_path =
            write_test_package_and_verification(&mut state, &paths.cache_dir, candidate_version)?;
        state.artifact_paths.package_path = Some(package_path);
        state.save_updater(&paths.state_file)?;

        let install_log = root.join("install.log");
        let fake_pkexec = root.join("pkexec");
        std::fs::write(
            &fake_pkexec,
            "#!/bin/sh\n\
             printf 'install\\n' >> \"$CHATGPT_UPDATER_TEST_INSTALL_LOG\"\n\
             if [ -n \"${CHATGPT_UPDATER_TEST_INSTALL_STARTED:-}\" ]; then\n\
               /bin/touch \"$CHATGPT_UPDATER_TEST_INSTALL_STARTED\"\n\
             fi\n\
             if [ -n \"${CHATGPT_UPDATER_TEST_INSTALL_RELEASE:-}\" ]; then\n\
               while [ ! -e \"$CHATGPT_UPDATER_TEST_INSTALL_RELEASE\" ]; do\n\
                 /bin/sleep 0.01\n\
               done\n\
             fi\n",
        )?;
        let mut permissions = std::fs::metadata(&fake_pkexec)?.permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&fake_pkexec, permissions)?;
        Ok((paths, fake_pkexec, install_log))
    }

    #[test]
    fn updater_flow_process_child() -> Result<()> {
        let Some(role) = std::env::var_os("CHATGPT_UPDATER_TEST_PROCESS_ROLE") else {
            return Ok(());
        };
        let role = role.to_string_lossy();
        let runtime = tokio::runtime::Runtime::new()?;
        match role.as_ref() {
            "install-ready" => runtime.block_on(run(Cli {
                command: Commands::InstallReady,
            })),
            "daemon-reconcile" => {
                let paths = RuntimePaths::detect()?;
                let config = RuntimeConfig::load_or_default(&paths)?;
                let mut state = PersistedState::load_or_default(
                    &paths.state_file,
                    effective_auto_install(&config),
                )?;
                runtime.block_on(reconcile_pending_install_from_disk(
                    &config, &mut state, &paths,
                ))
            }
            "cli-preflight" => {
                let cli_path = std::env::var_os("CHATGPT_UPDATER_TEST_CLI_PATH")
                    .map(PathBuf::from)
                    .context("missing process test CLI path")?;
                runtime.block_on(run(Cli {
                    command: Commands::CliPreflight {
                        cli_path: Some(cli_path),
                        print_path: false,
                        allow_install_missing: false,
                    },
                }))
            }
            "cli-preflight-install-missing" => runtime.block_on(run(Cli {
                command: Commands::CliPreflight {
                    cli_path: None,
                    print_path: false,
                    allow_install_missing: true,
                },
            })),
            "cli-status" => runtime.block_on(run(Cli {
                command: Commands::Status { json: true },
            })),
            "repair-cli" => runtime.block_on(run(Cli {
                command: Commands::RepairCli,
            })),
            "diagnose" => runtime.block_on(run(Cli {
                command: Commands::Diagnose { json: false },
            })),
            other => anyhow::bail!("Unknown updater process test role {other}"),
        }
    }

    #[test]
    fn process_test_child_drop_releases_and_reaps_install_group() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        let (_paths, fake_pkexec, install_log) = prepare_process_install_fixture(temp.path())?;
        let install_started = temp.path().join("install.started");
        let install_release = temp.path().join("install.release");
        let daemon_reconcile = spawn_process_test_child(
            temp.path(),
            "daemon-reconcile",
            &[
                ("CHATGPT_UPDATER_TEST_PKEXEC_PATH", &fake_pkexec),
                ("CHATGPT_UPDATER_TEST_INSTALL_LOG", &install_log),
                ("CHATGPT_UPDATER_TEST_INSTALL_STARTED", &install_started),
                ("CHATGPT_UPDATER_TEST_INSTALL_RELEASE", &install_release),
            ],
            &[&install_release],
        )?;
        wait_for_process_test_path(&install_started, "blocked daemon reconciliation install")?;
        let process_group = daemon_reconcile.process_group();

        drop(daemon_reconcile);

        assert!(install_release.exists());
        // SAFETY: signal 0 only probes the dedicated process group and does not
        // deliver a signal. Drop must have reaped every process in that group.
        let probe = unsafe { libc::kill(-process_group, 0) };
        assert_eq!(probe, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
        Ok(())
    }

    #[test]
    fn install_ready_entrypoint_does_not_overwrite_active_install_state() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        let (paths, fake_pkexec, install_log) = prepare_process_install_fixture(temp.path())?;
        let entrypoint_loaded = temp.path().join("entrypoint.loaded");
        let entrypoint_continue = temp.path().join("entrypoint.continue");
        let pre_dispatch = temp.path().join("entrypoint.pre-dispatch");
        let install_started = temp.path().join("install.started");
        let install_release = temp.path().join("install.release");

        let install_ready = spawn_process_test_child(
            temp.path(),
            "install-ready",
            &[
                ("CHATGPT_UPDATER_TEST_ENTRYPOINT_LOADED", &entrypoint_loaded),
                (
                    "CHATGPT_UPDATER_TEST_ENTRYPOINT_CONTINUE",
                    &entrypoint_continue,
                ),
                (
                    "CHATGPT_UPDATER_TEST_ENTRYPOINT_PRE_DISPATCH",
                    &pre_dispatch,
                ),
                ("CHATGPT_UPDATER_TEST_PKEXEC_PATH", &fake_pkexec),
                ("CHATGPT_UPDATER_TEST_INSTALL_LOG", &install_log),
            ],
            &[&entrypoint_continue],
        )?;
        wait_for_process_test_path(&entrypoint_loaded, "install-ready state load")?;

        let daemon_reconcile = spawn_process_test_child(
            temp.path(),
            "daemon-reconcile",
            &[
                ("CHATGPT_UPDATER_TEST_PKEXEC_PATH", &fake_pkexec),
                ("CHATGPT_UPDATER_TEST_INSTALL_LOG", &install_log),
                ("CHATGPT_UPDATER_TEST_INSTALL_STARTED", &install_started),
                ("CHATGPT_UPDATER_TEST_INSTALL_RELEASE", &install_release),
            ],
            &[&install_release],
        )?;
        wait_for_process_test_path(&install_started, "daemon reconciliation install")?;

        std::fs::write(&entrypoint_continue, b"continue")?;
        wait_for_process_test_path(&pre_dispatch, "install-ready pre-dispatch boundary")?;
        let state_while_installing = PersistedState::load_or_default(&paths.state_file, true)?;

        std::fs::write(&install_release, b"continue")?;
        daemon_reconcile.wait()?;
        install_ready.wait()?;

        assert_eq!(state_while_installing.status, UpdateStatus::Installing);
        let final_state = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(final_state.status, UpdateStatus::Installed);
        assert_eq!(std::fs::read_to_string(&install_log)?.lines().count(), 1);
        Ok(())
    }

    #[test]
    fn concurrent_install_ready_entrypoints_launch_only_one_install() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        let (paths, fake_pkexec, install_log) = prepare_process_install_fixture(temp.path())?;
        let first_loaded = temp.path().join("first.loaded");
        let second_loaded = temp.path().join("second.loaded");
        let entrypoint_continue = temp.path().join("entrypoint.continue");
        let first_reloaded = temp.path().join("first.reloaded");
        let second_reloaded = temp.path().join("second.reloaded");
        let first_lock_busy = temp.path().join("first.lock-busy");
        let second_lock_busy = temp.path().join("second.lock-busy");
        let reload_continue = temp.path().join("reload.continue");

        let common_env = [
            (
                "CHATGPT_UPDATER_TEST_ENTRYPOINT_CONTINUE",
                entrypoint_continue.as_path(),
            ),
            (
                "CHATGPT_UPDATER_TEST_INSTALL_READY_CONTINUE",
                reload_continue.as_path(),
            ),
            ("CHATGPT_UPDATER_TEST_PKEXEC_PATH", fake_pkexec.as_path()),
            ("CHATGPT_UPDATER_TEST_INSTALL_LOG", install_log.as_path()),
        ];
        let mut first_env = common_env.to_vec();
        first_env.extend([
            (
                "CHATGPT_UPDATER_TEST_ENTRYPOINT_LOADED",
                first_loaded.as_path(),
            ),
            (
                "CHATGPT_UPDATER_TEST_INSTALL_READY_RELOADED",
                first_reloaded.as_path(),
            ),
            (
                "CHATGPT_UPDATER_TEST_CHECK_LOCK_BUSY",
                first_lock_busy.as_path(),
            ),
        ]);
        let mut second_env = common_env.to_vec();
        second_env.extend([
            (
                "CHATGPT_UPDATER_TEST_ENTRYPOINT_LOADED",
                second_loaded.as_path(),
            ),
            (
                "CHATGPT_UPDATER_TEST_INSTALL_READY_RELOADED",
                second_reloaded.as_path(),
            ),
            (
                "CHATGPT_UPDATER_TEST_CHECK_LOCK_BUSY",
                second_lock_busy.as_path(),
            ),
        ]);

        let first = spawn_process_test_child(
            temp.path(),
            "install-ready",
            &first_env,
            &[&entrypoint_continue, &reload_continue],
        )?;
        let second = spawn_process_test_child(
            temp.path(),
            "install-ready",
            &second_env,
            &[&entrypoint_continue, &reload_continue],
        )?;
        wait_for_process_test_path(&first_loaded, "first install-ready state load")?;
        wait_for_process_test_path(&second_loaded, "second install-ready state load")?;

        std::fs::write(&entrypoint_continue, b"continue")?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !((first_reloaded.exists() && second_lock_busy.exists())
            || (second_reloaded.exists() && first_lock_busy.exists()))
        {
            anyhow::ensure!(
                std::time::Instant::now() < deadline,
                "Timed out waiting for one install-ready process to hold the lock and the other to block"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let reloads_before_release =
            usize::from(first_reloaded.exists()) + usize::from(second_reloaded.exists());

        std::fs::write(&reload_continue, b"continue")?;
        first.wait()?;
        second.wait()?;

        assert_eq!(
            reloads_before_release, 1,
            "only the lock holder may reload state before serialization is released"
        );
        let final_state = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(final_state.status, UpdateStatus::Installed);
        assert_eq!(std::fs::read_to_string(&install_log)?.lines().count(), 1);
        Ok(())
    }

    #[test]
    fn daemon_startup_reloads_active_workspace_state_after_locking() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
            "HOME",
            "PATH",
            "NVM_DIR",
            "XDG_CONFIG_HOME",
            "CODEX_CLI_PATH",
            "CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP",
        ]);
        std::env::set_var("HOME", temp.path());
        std::env::set_var("PATH", temp.path().join("missing-bin"));
        std::env::remove_var("NVM_DIR");
        std::env::remove_var("XDG_CONFIG_HOME");
        std::env::remove_var("CODEX_CLI_PATH");
        std::env::set_var("CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP", "1");

        let workspace = config.workspace_root.join("workspaces/active-build");
        std::fs::create_dir_all(workspace.join("builder"))?;
        std::fs::write(workspace.join("builder/install.sh"), b"#!/bin/sh\n")?;

        let mut persisted_state = PersistedState::new(true);
        persisted_state.status = UpdateStatus::PatchingApp;
        persisted_state.artifact_paths.workspace_dir = Some(workspace.clone());
        persisted_state.save_updater(&paths.state_file)?;

        let mut stale_state = PersistedState::new(true);
        run_daemon_startup_maintenance(&config, &mut stale_state, &paths)?;

        assert_eq!(stale_state.status, UpdateStatus::PatchingApp);
        assert_eq!(
            stale_state.artifact_paths.workspace_dir.as_deref(),
            Some(workspace.as_path())
        );
        assert!(workspace.join("builder/install.sh").exists());
        Ok(())
    }

    #[test]
    fn daemon_startup_check_lock_failure_is_fail_soft() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let workspace = config.workspace_root.join("workspaces/unreferenced");
        std::fs::create_dir_all(workspace.join("builder"))?;
        std::fs::write(workspace.join("builder/install.sh"), b"#!/bin/sh\n")?;
        std::fs::create_dir(paths.state_dir.join("check.lock"))?;
        let mut state = PersistedState::new(true);

        run_daemon_startup_maintenance(&config, &mut state, &paths)?;

        assert!(workspace.join("builder/install.sh").exists());
        Ok(())
    }

    #[test]
    fn daemon_startup_state_reload_failure_is_fail_soft() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let workspace = config.workspace_root.join("workspaces/unreferenced");
        std::fs::create_dir_all(workspace.join("builder"))?;
        std::fs::write(workspace.join("builder/install.sh"), b"#!/bin/sh\n")?;
        std::fs::write(&paths.state_file, b"not json")?;
        let mut state = PersistedState::new(true);

        run_daemon_startup_maintenance(&config, &mut state, &paths)?;

        assert!(workspace.join("builder/install.sh").exists());
        assert_eq!(std::fs::read(&paths.state_file)?, b"not json");
        Ok(())
    }

    #[test]
    fn std_file_try_lock_reports_would_block_for_second_holder() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let lock_path = temp.path().join("check.lock");
        let first_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)?;
        let second_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)?;

        first_file.try_lock()?;
        let second_attempt = second_file.try_lock();

        assert!(matches!(
            second_attempt,
            Err(std::fs::TryLockError::WouldBlock)
        ));
        first_file.unlock()?;
        Ok(())
    }

    #[tokio::test]
    async fn missing_pending_package_marks_state_failed() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203+deadbeef".to_string());
        state.artifact_paths.package_path = Some(temp.path().join("missing/chatgpt.deb"));

        reconcile_pending_install(&config, &mut state, &paths).await?;

        assert_eq!(state.status, UpdateStatus::Failed);
        assert!(state
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("Pending package artifact is missing")));
        Ok(())
    }

    #[test]
    fn ready_update_waits_for_explicit_install_ready_when_auto_install_is_off() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let settings_path = temp.path().join("settings.json");
        let previous_settings_file = std::env::var_os("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_path);
        std::fs::write(
            &settings_path,
            r#"{"chatgpt-linux-auto-update-on-exit": false}"#,
        )?;

        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203");
        let package_path = write_test_package_and_verification(
            &mut state,
            &config.workspace_root,
            "2999.03.25.010203",
        )?;
        state.artifact_paths.package_path = Some(package_path);

        let result = runtime.block_on(reconcile_pending_install(&config, &mut state, &paths));

        if let Some(value) = previous_settings_file {
            std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", value);
        } else {
            std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        }

        result?;
        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert_eq!(state.error_message, None);
        Ok(())
    }

    #[test]
    fn ready_update_auto_install_waits_for_app_exit_when_app_is_running() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let settings_path = temp.path().join("settings.json");
        let previous_settings_file = std::env::var_os("CHATGPT_LINUX_SETTINGS_FILE");
        let previous_assume_agent = std::env::var_os("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_path);
        std::env::set_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", "1");
        std::fs::write(
            &settings_path,
            r#"{"chatgpt-linux-auto-update-on-exit": true}"#,
        )?;

        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: std::env::current_exe()?,
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203");
        let package_path = write_test_package_and_verification(
            &mut state,
            &config.workspace_root,
            "2999.03.25.010203",
        )?;
        state.artifact_paths.package_path = Some(package_path);
        state
            .notified_events
            .insert("install_auth_required:2999.03.25.010203+deadbeef".to_string());

        let result = runtime.block_on(reconcile_pending_install(&config, &mut state, &paths));

        if let Some(value) = previous_settings_file {
            std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", value);
        } else {
            std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        }
        if let Some(value) = previous_assume_agent {
            std::env::set_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", value);
        } else {
            std::env::remove_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT");
        }

        result?;
        assert_eq!(state.status, UpdateStatus::WaitingForAppExit);
        assert!(state.waiting_for_app_exit_auto_install);
        assert!(!install_auth_retry_is_blocked(&state));
        Ok(())
    }

    #[test]
    fn daemon_reconcile_reloads_waiting_state_written_by_another_process() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
            "CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT",
            "CHATGPT_LINUX_SETTINGS_FILE",
        ]);
        let runtime = tokio::runtime::Runtime::new()?;
        std::env::set_var("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT", "1");

        let temp = tempfile::tempdir()?;
        std::env::set_var(
            "CHATGPT_LINUX_SETTINGS_FILE",
            temp.path().join("isolated-settings.json"),
        );
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());

        let mut on_disk = PersistedState::new(true);
        on_disk.status = UpdateStatus::WaitingForAppExit;
        let candidate_version = "2999.03.25.010203+deadbeef";
        on_disk.candidate_version = Some(candidate_version.to_string());
        on_disk.waiting_for_app_exit_auto_install = true;
        mark_test_dmg_verified(&mut on_disk, candidate_version);
        let package_path = write_test_package_and_verification(
            &mut on_disk,
            &config.workspace_root,
            candidate_version,
        )?;
        on_disk.artifact_paths.package_path = Some(package_path);
        on_disk.save(&paths.state_file)?;

        let mut stale_daemon_state = PersistedState::new(true);
        stale_daemon_state.status = UpdateStatus::Idle;

        let result = runtime.block_on(reconcile_pending_install_from_disk(
            &config,
            &mut stale_daemon_state,
            &paths,
        ));

        result?;
        assert_eq!(stale_daemon_state.status, UpdateStatus::ReadyToInstall);
        assert!(!stale_daemon_state.waiting_for_app_exit_auto_install);
        assert!(stale_daemon_state
            .error_message
            .as_deref()
            .unwrap_or_default()
            .contains("No graphical polkit authentication agent"));

        let persisted = PersistedState::load_or_default(&paths.state_file, true)?;
        assert_eq!(persisted.status, UpdateStatus::ReadyToInstall);
        assert!(!persisted.waiting_for_app_exit_auto_install);
        Ok(())
    }

    #[test]
    fn waiting_for_app_exit_auto_install_cancelled_when_setting_turns_off() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let settings_path = temp.path().join("settings.json");
        let previous_settings_file = std::env::var_os("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_path);
        std::fs::write(
            &settings_path,
            r#"{"chatgpt-linux-auto-update-on-exit": false}"#,
        )?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: std::env::current_exe()?,
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::WaitingForAppExit;
        state.waiting_for_app_exit_auto_install = true;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203");
        let package_path = write_test_package_and_verification(
            &mut state,
            &config.workspace_root,
            "2999.03.25.010203",
        )?;
        state.artifact_paths.package_path = Some(package_path);

        let result = runtime.block_on(reconcile_pending_install(&config, &mut state, &paths));

        if let Some(value) = previous_settings_file {
            std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", value);
        } else {
            std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        }

        result?;
        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert!(!state.auto_install_on_app_exit);
        assert!(!state.waiting_for_app_exit_auto_install);
        assert_eq!(state.error_message, None);
        assert!(state.artifact_paths.package_path.is_some());
        Ok(())
    }

    #[test]
    fn waiting_for_app_exit_manual_install_survives_auto_toggle_off() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let settings_path = temp.path().join("settings.json");
        let previous_settings_file = std::env::var_os("CHATGPT_LINUX_SETTINGS_FILE");
        let previous_assume_agent = std::env::var_os("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_path);
        std::env::set_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", "1");
        std::fs::write(
            &settings_path,
            r#"{"chatgpt-linux-auto-update-on-exit": false}"#,
        )?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: std::env::current_exe()?,
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::WaitingForAppExit;
        state.waiting_for_app_exit_auto_install = false;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203");
        let package_path = write_test_package_and_verification(
            &mut state,
            &config.workspace_root,
            "2999.03.25.010203",
        )?;
        state.artifact_paths.package_path = Some(package_path);

        let result = runtime.block_on(reconcile_pending_install(&config, &mut state, &paths));

        if let Some(value) = previous_settings_file {
            std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", value);
        } else {
            std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        }
        if let Some(value) = previous_assume_agent {
            std::env::set_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", value);
        } else {
            std::env::remove_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT");
        }

        result?;
        assert_eq!(state.status, UpdateStatus::WaitingForAppExit);
        assert!(!state.auto_install_on_app_exit);
        assert!(!state.waiting_for_app_exit_auto_install);
        assert_eq!(state.error_message, None);
        Ok(())
    }

    #[test]
    fn reconcile_reloads_auto_install_setting_override() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;
        let settings_path = temp.path().join("settings.json");

        let previous_settings_file = std::env::var_os("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_path);

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(true);

        std::fs::write(
            &settings_path,
            r#"{"chatgpt-linux-auto-update-on-exit": false}"#,
        )?;
        let first_result = runtime.block_on(reconcile_pending_install(&config, &mut state, &paths));
        assert!(!state.auto_install_on_app_exit);

        std::fs::write(
            &settings_path,
            r#"{"chatgpt-linux-auto-update-on-exit": true}"#,
        )?;
        let second_result =
            runtime.block_on(reconcile_pending_install(&config, &mut state, &paths));

        if let Some(value) = previous_settings_file {
            std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", value);
        } else {
            std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        }

        first_result?;
        second_result?;
        assert!(state.auto_install_on_app_exit);
        Ok(())
    }

    #[tokio::test]
    async fn install_ready_waits_when_app_is_running() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let previous_assume_agent = std::env::var_os("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT");
        std::env::set_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", "1");
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: std::env::current_exe()?,
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203");
        let package_path = write_test_package_and_verification(
            &mut state,
            &config.workspace_root,
            "2999.03.25.010203",
        )?;
        state.artifact_paths.package_path = Some(package_path);
        state
            .notified_events
            .insert("install_auth_required:2999.03.25.010203".to_string());

        let result = run_install_ready_locked(&config, &mut state, &paths).await;

        if let Some(value) = previous_assume_agent {
            std::env::set_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT", value);
        } else {
            std::env::remove_var("CHATGPT_UPDATER_ASSUME_POLKIT_AGENT");
        }

        result?;
        assert_eq!(state.status, UpdateStatus::WaitingForAppExit);
        assert!(!install_auth_retry_is_blocked(&state));
        Ok(())
    }

    #[tokio::test]
    async fn install_ready_fails_when_ready_update_has_no_trusted_dmg_verification() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        state.dmg_sha256 = Some(TRUSTED_TEST_DMG_SHA256.to_string());
        state.artifact_paths.package_path = Some(package_path);

        let error = run_install_ready_locked(&config, &mut state, &paths)
            .await
            .expect_err("ready update without trusted DMG verification should fail");
        assert!(error
            .to_string()
            .contains("Ready update is missing trusted DMG verification"));
        assert_eq!(state.status, UpdateStatus::Failed);
        assert!(state
            .error_message
            .as_deref()
            .unwrap_or_default()
            .contains("Ready update is missing trusted DMG verification"));
        Ok(())
    }

    #[tokio::test]
    async fn package_verification_missing_ready_update_fails_closed() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203");
        let package_path = config
            .workspace_root
            .join("workspaces/2999.03.25.010203/dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;
        state.artifact_paths.package_path = Some(package_path);

        let error = run_install_ready_locked(&config, &mut state, &paths)
            .await
            .expect_err("ready update without package verification should fail");

        assert!(error
            .to_string()
            .contains("Ready update package verification is missing"));
        assert_eq!(state.status, UpdateStatus::Failed);
        Ok(())
    }

    #[tokio::test]
    async fn install_ready_fails_when_verified_dmg_record_is_missing_digest() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203".to_string());
        state.dmg_sha256 = None;
        state.artifact_paths.package_path = Some(package_path);
        state.dmg_verification = Some(DmgVerification {
            result: DmgVerificationResult::Verified,
            version: Some("2999.03.25.010203".to_string()),
            sha256: None,
            manifest_path: Some(PathBuf::from(
                "/usr/lib/chatgpt/update-builder/updater/trusted-dmg-manifest.json",
            )),
            verified_at: Some(Utc::now()),
            message: Some("Downloaded DMG matched repo-trusted metadata".to_string()),
        });

        let error = run_install_ready_locked(&config, &mut state, &paths)
            .await
            .expect_err("verified DMG record without digest should fail");

        assert!(error
            .to_string()
            .contains("Ready update trusted DMG verification is missing a digest"));
        assert_eq!(state.status, UpdateStatus::Failed);
        Ok(())
    }

    #[test]
    fn install_ready_stays_open_when_no_polkit_agent_is_available() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let runtime = tokio::runtime::Runtime::new()?;
        let previous_no_agent = std::env::var_os("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT");
        std::env::set_var("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT", "1");
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let workspace = temp
            .path()
            .join("cache/workspaces/2999.03.25.010203+deadbeef");
        let package_path = workspace.join("dist/chatgpt desktop.pkg.tar.zst");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"pkg")?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: std::env::current_exe()?,
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203+deadbeef".to_string());
        mark_test_dmg_verified(&mut state, "2999.03.25.010203+deadbeef");
        state.package_verification = Some(package_verification::record_built_package(
            &package_path,
            &workspace,
            "2999.03.25.010203+deadbeef",
            TRUSTED_TEST_DMG_SHA256,
        )?);
        state.artifact_paths.package_path = Some(package_path);

        let result = runtime.block_on(run_install_ready_locked(&config, &mut state, &paths));

        if let Some(value) = previous_no_agent {
            std::env::set_var("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT", value);
        } else {
            std::env::remove_var("CHATGPT_UPDATER_ASSUME_NO_POLKIT_AGENT");
        }

        result?;
        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert!(!state.waiting_for_app_exit_auto_install);
        let message = state.error_message.as_deref().unwrap_or("");
        assert!(message.contains("No graphical polkit authentication agent"));
        assert!(message.contains("sudo /usr/bin/chatgpt-updater install-pacman"));
        assert!(message.contains("--expected-sha256"));
        assert!(message.contains("--expected-package-name 'chatgpt'"));
        assert!(message.contains("--expected-package-version '2999.03.25.010203_deadbeef-1'"));
        assert!(message.contains("chatgpt desktop.pkg.tar.zst'"));
        Ok(())
    }

    #[tokio::test]
    async fn install_ready_marks_missing_artifact_failed() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2999.03.25.010203+deadbeef".to_string());
        state.artifact_paths.package_path = Some(temp.path().join("missing/chatgpt.deb"));

        let result = run_install_ready_locked(&config, &mut state, &paths).await;
        assert!(result.is_err());
        assert_eq!(state.status, UpdateStatus::Failed);
        assert!(state
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("Pending package artifact is missing")));
        Ok(())
    }

    #[tokio::test]
    async fn install_ready_marks_missing_package_record_failed() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::ReadyToInstall;
        state.candidate_version = Some("2026.03.25.010203+deadbeef".to_string());

        let result = run_install_ready_locked(&config, &mut state, &paths).await;

        assert!(result.is_err());
        assert_eq!(state.status, UpdateStatus::Failed);
        assert_eq!(
            state.error_message.as_deref(),
            Some("No ready update package is recorded")
        );
        Ok(())
    }

    #[tokio::test]
    async fn install_ready_reports_unrecoverable_interrupted_install() -> Result<()> {
        let temp = tempfile::tempdir()?;
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
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::Installing;
        state.candidate_version = Some("2026.03.25.010203+deadbeef".to_string());
        state.artifact_paths.package_path = Some(temp.path().join("missing/chatgpt.deb"));

        let result = run_install_ready_locked(&config, &mut state, &paths).await;

        assert!(result.is_err());
        assert_eq!(state.status, UpdateStatus::Failed);
        assert!(state
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("interrupted")));
        Ok(())
    }

    #[test]
    fn pkexec_authentication_failures_are_retryable() -> Result<()> {
        for code in [126, 127] {
            let status = std::process::Command::new("/bin/sh")
                .arg("-c")
                .arg(format!("exit {code}"))
                .status()?;
            assert!(pkexec_authentication_was_not_obtained(&status));
        }

        let status = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("exit 1")
            .status()?;
        assert!(!pkexec_authentication_was_not_obtained(&status));
        Ok(())
    }

    #[test]
    fn user_session_bus_for_polkit_allows_user_service_env_without_display() {
        let _env_guard = crate::test_util::env_lock();
        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "DBUS_SESSION_BUS_ADDRESS",
            "XDG_RUNTIME_DIR",
        ]);

        std::env::remove_var("DISPLAY");
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("DBUS_SESSION_BUS_ADDRESS", "unix:path=/run/user/1000/bus");
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");

        assert!(has_user_session_bus_for_polkit());
    }

    #[test]
    fn manual_install_command_selects_package_kind_and_quotes_path() -> Result<()> {
        let expected = install::ExpectedPackage::new("a".repeat(64), "chatgpt", "1.2.3")?;
        let pacman =
            manual_install_command(Path::new("/tmp/chatgpt update.pkg.tar.zst"), &expected);
        assert!(pacman.contains("chatgpt-updater install-pacman"));
        assert!(pacman.contains("--path '/tmp/chatgpt update.pkg.tar.zst'"));
        assert!(pacman.contains("--expected-sha256"));
        assert!(pacman.contains("--expected-package-name 'chatgpt'"));
        assert!(pacman.contains("--expected-package-version '1.2.3'"));

        let deb = manual_install_command(Path::new("/tmp/chatgpt'update.deb"), &expected);
        assert!(deb.contains("chatgpt-updater install-deb"));
        assert!(deb.contains("--path '/tmp/chatgpt'\\''update.deb'"));
        Ok(())
    }

    #[test]
    fn command_output_summary_redacts_privileged_install_output() {
        let output = b"line one\nerror token=install-secret\nAuthorization: Bearer header-secret\n";

        let summary = summarize_command_output(output).expect("summary");

        assert_eq!(
            summary,
            "line one | error token=[REDACTED] | Authorization: [REDACTED]"
        );
        assert!(!summary.contains("install-secret"));
        assert!(!summary.contains("header-secret"));
    }

    #[test]
    fn command_lookup_requires_executable_file() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let candidate = temp.path().join("zenity");
        std::fs::write(&candidate, b"#!/bin/sh\n")?;

        let mut permissions = std::fs::metadata(&candidate)?.permissions();
        permissions.set_mode(0o644);
        std::fs::set_permissions(&candidate, permissions)?;

        assert!(!is_executable_file(&candidate));

        let mut permissions = std::fs::metadata(&candidate)?.permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&candidate, permissions)?;

        assert!(is_executable_file(&candidate));
        Ok(())
    }

    #[test]
    fn prompt_install_cli_does_not_treat_non_executable_file_as_installed() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o755))?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let _restore_env = crate::test_util::EnvRestoreGuard::capture(&[
            "DISPLAY",
            "WAYLAND_DISPLAY",
            "DBUS_SESSION_BUS_ADDRESS",
            "XDG_RUNTIME_DIR",
            "PATH",
            "HOME",
            "NVM_DIR",
            "CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP",
        ]);

        std::env::remove_var("DISPLAY");
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::remove_var("DBUS_SESSION_BUS_ADDRESS");
        std::env::remove_var("XDG_RUNTIME_DIR");
        std::env::set_var("PATH", temp.path().join("missing-bin"));
        std::env::set_var("HOME", temp.path());
        std::env::remove_var("NVM_DIR");
        std::env::set_var("CHATGPT_UPDATER_SKIP_SYSTEM_CLI_LOOKUP", "1");
        let invalid_cli_path = temp.path().join("codex.txt");
        std::fs::write(&invalid_cli_path, b"not executable")?;

        let mut state = PersistedState::new(true);
        state.cli_path = Some(invalid_cli_path);
        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: true,
            notifications: false,
            developer_mode: false,
            workspace_root: temp.path().join("cache"),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("not-running-electron"),
            cli_path: None,
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let outcome = prompt_install_cli(&config, &mut state, &paths, None)?;
        assert_eq!(outcome, PromptInstallCliOutcome::NoBackend);
        Ok(())
    }

    #[test]
    fn install_auth_retry_block_is_scoped_to_candidate() {
        let mut state = PersistedState::new(true);
        state.candidate_version = Some("2026.04.28.082247+abcdef12".to_string());

        assert!(!install_auth_retry_is_blocked(&state));

        state
            .notified_events
            .insert("install_auth_required:2026.04.28.082247+abcdef12".to_string());
        assert!(install_auth_retry_is_blocked(&state));

        state.candidate_version = Some("2026.04.29.010203+abcdef12".to_string());
        assert!(!install_auth_retry_is_blocked(&state));
    }

    #[test]
    fn clear_install_auth_required_event_keeps_unrelated_notifications() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.candidate_version = Some("2026.04.28.082247+abcdef12".to_string());
        state
            .notified_events
            .insert("install_auth_required:2026.04.28.082247+abcdef12".to_string());
        state
            .notified_events
            .insert("installed:2026.04.25.054929+12345678".to_string());

        clear_install_auth_required_event(&mut state, &paths)?;

        assert!(!install_auth_retry_is_blocked(&state));
        assert!(state
            .notified_events
            .contains("installed:2026.04.25.054929+12345678"));
        Ok(())
    }

    #[test]
    fn in_progress_same_dmg_update_is_cleared_as_current() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let sha256 = "51eeeba58394c4747cbc9d9fee7aa613500253fedd7ad5b114f48dfcb89a6cbb";
        write_installed_build_info(&config, sha256)?;

        let package_path = temp
            .path()
            .join("cache/workspaces/2026.06.12.120204+51eeeba5/dist/chatgpt.pkg.tar.zst");

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::PatchingApp;
        state.installed_version = "2026.06.12.094134-1".to_string();
        state.candidate_version = Some("2026.06.12.120204+51eeeba5".to_string());
        state.dmg_sha256 = Some(sha256.to_string());
        state.artifact_paths.package_path = Some(package_path);
        state.artifact_paths.workspace_dir = Some(
            temp.path()
                .join("cache/workspaces/2026.06.12.120204+51eeeba5"),
        );
        state.error_message = Some("interrupted rebuild".to_string());
        state
            .notified_events
            .insert("update_detected:2026.06.12.120204+51eeeba5".to_string());

        assert!(complete_current_dmg_update_if_already_installed(
            &config, &mut state, &paths
        )?);

        assert_eq!(state.status, UpdateStatus::Idle);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.dmg_sha256.as_deref(), Some(sha256));
        assert_eq!(state.artifact_paths.package_path, None);
        assert_eq!(state.artifact_paths.workspace_dir, None);
        assert_eq!(state.error_message, None);
        assert!(state.notified_events.is_empty());
        Ok(())
    }

    #[test]
    fn same_dmg_recovery_keeps_unrelated_notification_markers() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let sha256 = "51eeeba58394c4747cbc9d9fee7aa613500253fedd7ad5b114f48dfcb89a6cbb";
        write_installed_build_info(&config, sha256)?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::PatchingApp;
        state.candidate_version = Some("2026.06.12.120204+51eeeba5".to_string());
        state.dmg_sha256 = Some(sha256.to_string());
        state
            .notified_events
            .insert("update_detected:2026.06.12.120204+51eeeba5".to_string());
        state.notified_events.insert("cli_missing".to_string());

        assert!(complete_current_dmg_update_if_already_installed(
            &config, &mut state, &paths
        )?);

        assert!(!state
            .notified_events
            .contains("update_detected:2026.06.12.120204+51eeeba5"));
        assert!(state.notified_events.contains("cli_missing"));
        Ok(())
    }

    #[test]
    fn in_progress_different_dmg_update_is_not_cleared() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        write_installed_build_info(
            &config,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::PatchingApp;
        state.candidate_version = Some("2026.06.12.120204+51eeeba5".to_string());
        state.dmg_sha256 =
            Some("51eeeba58394c4747cbc9d9fee7aa613500253fedd7ad5b114f48dfcb89a6cbb".to_string());
        state
            .notified_events
            .insert("update_detected:2026.06.12.120204+51eeeba5".to_string());

        assert!(!complete_current_dmg_update_if_already_installed(
            &config, &mut state, &paths
        )?);

        assert_eq!(state.status, UpdateStatus::PatchingApp);
        assert_eq!(
            state.candidate_version.as_deref(),
            Some("2026.06.12.120204+51eeeba5")
        );
        assert!(state
            .notified_events
            .contains("update_detected:2026.06.12.120204+51eeeba5"));
        Ok(())
    }

    #[test]
    fn same_dmg_recovery_keeps_ready_wrapper_update_package() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;
        let config = test_config(temp.path());
        let sha256 = "51eeeba58394c4747cbc9d9fee7aa613500253fedd7ad5b114f48dfcb89a6cbb";
        write_installed_build_info(&config, sha256)?;

        let package_path = temp.path().join("dist/chatgpt-wrapper.deb");
        let workspace_dir = temp
            .path()
            .join("cache/workspaces/2026.06.12.120204+51eeeba5");
        let wrapper_commit = "b".repeat(40);

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.dmg_sha256 = Some(sha256.to_string());
        state.candidate_wrapper_commit = Some(wrapper_commit.clone());
        state.candidate_wrapper_version = Some("0.9.0".to_string());
        state.artifact_paths.package_path = Some(package_path.clone());
        state.artifact_paths.workspace_dir = Some(workspace_dir.clone());

        assert!(!complete_current_dmg_update_if_already_installed(
            &config, &mut state, &paths
        )?);

        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.dmg_sha256.as_deref(), Some(sha256));
        assert_eq!(
            state.candidate_wrapper_commit.as_deref(),
            Some(wrapper_commit.as_str())
        );
        assert_eq!(state.candidate_wrapper_version.as_deref(), Some("0.9.0"));
        assert_eq!(state.artifact_paths.package_path, Some(package_path));
        assert_eq!(state.artifact_paths.workspace_dir, Some(workspace_dir));
        Ok(())
    }

    #[test]
    fn pending_install_becomes_installed_when_candidate_is_already_present() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.installed_version = "2026.04.28.082247-abcdef12.fc43".to_string();
        state.candidate_version = Some("2026.04.28.082247+abcdef12".to_string());
        state.rollback_blocked_candidate_version = Some("2026.04.20.120000".to_string());
        state.rollback_blocked_dmg_sha256 = Some("rolled-back-dmg-sha256".to_string());
        state.error_message = Some("authentication was not obtained".to_string());
        state
            .notified_events
            .insert("install_auth_required:2026.04.28.082247+abcdef12".to_string());

        assert_eq!(
            complete_pending_install_if_already_installed(&paths.cache_dir, &mut state, &paths,)?,
            PendingInstallRecovery::CandidateInstalled
        );

        assert_eq!(state.status, UpdateStatus::Installed);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.rollback_blocked_candidate_version, None);
        assert_eq!(state.rollback_blocked_dmg_sha256, None);
        assert_eq!(state.error_message, None);
        assert!(state.notified_events.is_empty());
        Ok(())
    }

    #[test]
    fn verified_same_version_pending_install_is_not_auto_completed() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.installed_version = "26.513.31313".to_string();
        state.candidate_version = Some("26.513.31313".to_string());
        state.dmg_sha256 = Some(TRUSTED_TEST_DMG_SHA256.to_string());
        let package_path = temp.path().join("dist/chatgpt.pkg.tar.zst");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"pkg")?;
        state.artifact_paths.package_path = Some(package_path);
        state.dmg_verification = Some(DmgVerification {
            result: DmgVerificationResult::Verified,
            version: Some("26.513.31313".to_string()),
            sha256: Some(TRUSTED_TEST_DMG_SHA256.to_string()),
            manifest_path: Some(temp.path().join("trusted-dmg-manifest.json")),
            verified_at: Some(Utc::now()),
            message: Some("Downloaded DMG matched repo-trusted metadata".to_string()),
        });

        assert_eq!(
            complete_pending_install_if_already_installed(&paths.cache_dir, &mut state, &paths,)?,
            PendingInstallRecovery::NoChange
        );

        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert_eq!(state.candidate_version.as_deref(), Some("26.513.31313"));
        Ok(())
    }

    #[test]
    fn verified_current_dmg_requires_matching_candidate_version() {
        let mut state = PersistedState::new(true);
        state.candidate_version = Some("26.513.31314".to_string());
        state.dmg_sha256 = Some(TRUSTED_TEST_DMG_SHA256.to_string());
        state.dmg_verification = Some(DmgVerification {
            result: DmgVerificationResult::Verified,
            version: Some("26.513.31313".to_string()),
            sha256: Some(TRUSTED_TEST_DMG_SHA256.to_string()),
            manifest_path: Some(PathBuf::from("trusted-dmg-manifest.json")),
            verified_at: Some(Utc::now()),
            message: Some("Downloaded DMG matched repo-trusted metadata".to_string()),
        });

        assert!(!state_has_verified_current_dmg(&state));
    }

    #[test]
    fn pending_install_is_cleared_when_installed_version_is_newer() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.installed_version = "2026.05.01.010203-99999999.fc43".to_string();
        state.candidate_version = Some("2026.04.28.082247+abcdef12".to_string());
        state.error_message = Some("authentication was not obtained".to_string());
        let superseded_package_path = temp.path().join("superseded.deb");
        std::fs::write(&superseded_package_path, b"deb")?;
        state.artifact_paths.package_path = Some(superseded_package_path);
        let workspace_root = temp.path().join("custom-workspace-root");
        state.artifact_paths.workspace_dir =
            Some(workspace_root.join("workspaces/2026.04.28.082247+abcdef12"));

        assert_eq!(
            complete_pending_install_if_already_installed(&workspace_root, &mut state, &paths,)?,
            PendingInstallRecovery::SupersededByInstalledVersion
        );

        assert_eq!(state.status, UpdateStatus::Installed);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.artifact_paths.package_path, None);
        assert_eq!(state.artifact_paths.workspace_dir, None);
        assert_eq!(state.error_message, None);
        crate::rollback::record_current_package_as_known_good(&mut state);
        assert_eq!(state.artifact_paths.rollback_package_path, None);
        Ok(())
    }

    #[test]
    fn matching_pending_install_recovery_records_installed_notification_event() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.installed_version = "2026.04.28.082247-abcdef12.fc43".to_string();
        state.candidate_version = Some("2026.04.28.082247+abcdef12".to_string());

        let recovery =
            complete_pending_install_if_already_installed(&paths.cache_dir, &mut state, &paths)?;
        if recovery.should_notify_installed() {
            maybe_notify_installed(&mut state, &paths, false)?;
        }

        assert_eq!(state.status, UpdateStatus::Installed);
        assert_eq!(state.candidate_version, None);
        assert!(state
            .notified_events
            .contains("installed:2026.04.28.082247-abcdef12.fc43"));
        Ok(())
    }

    #[test]
    fn superseded_pending_install_recovery_skips_installed_notification_event() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = test_paths(temp.path());
        paths.ensure_dirs()?;

        let package_path = temp.path().join("superseded.pkg.tar.zst");
        std::fs::write(&package_path, b"package")?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.installed_version = "2026.06.24.051729-1".to_string();
        state.candidate_version = Some("2026.06.24.050316+4bb552bf".to_string());
        state.artifact_paths.package_path = Some(package_path);
        state
            .notified_events
            .insert("ready_to_install:2026.06.24.050316+4bb552bf".to_string());

        let recovery =
            complete_pending_install_if_already_installed(&paths.cache_dir, &mut state, &paths)?;
        if recovery.should_notify_installed() {
            maybe_notify_installed(&mut state, &paths, false)?;
        }

        assert_eq!(state.status, UpdateStatus::Installed);
        assert_eq!(state.candidate_version, None);
        assert!(!state
            .notified_events
            .iter()
            .any(|event| event.starts_with("installed:")));
        Ok(())
    }

    #[test]
    fn status_clears_superseded_ready_update() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::ReadyToInstall;
        state.installed_version = "2026.05.01.010203".to_string();
        state.candidate_version = Some("2026.04.28.082247+abcdef12".to_string());
        let superseded_package_path = temp.path().join("superseded-status.deb");
        std::fs::write(&superseded_package_path, b"deb")?;
        state.artifact_paths.package_path = Some(superseded_package_path);
        state.artifact_paths.workspace_dir = Some(
            temp.path()
                .join("cache/workspaces/2026.04.28.082247+abcdef12"),
        );
        state.save_updater(&paths.state_file)?;

        let original_home = std::env::var_os("HOME");
        let original_path = std::env::var_os("PATH");
        let original_nvm_dir = std::env::var_os("NVM_DIR");
        let original_codex_cli_path = std::env::var_os("CODEX_CLI_PATH");
        let original_skip_system_cli_lookup =
            std::env::var_os("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP");
        std::env::set_var("HOME", temp.path());
        std::env::set_var("PATH", temp.path().join("missing-bin"));
        std::env::remove_var("NVM_DIR");
        std::env::remove_var("CODEX_CLI_PATH");
        std::env::set_var("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP", "1");

        let config = test_config(temp.path());
        let result = run_status(&config, &mut state, &paths, true);

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(path) = original_path {
            std::env::set_var("PATH", path);
        } else {
            std::env::remove_var("PATH");
        }
        if let Some(nvm_dir) = original_nvm_dir {
            std::env::set_var("NVM_DIR", nvm_dir);
        } else {
            std::env::remove_var("NVM_DIR");
        }
        if let Some(cli_path) = original_codex_cli_path {
            std::env::set_var("CODEX_CLI_PATH", cli_path);
        } else {
            std::env::remove_var("CODEX_CLI_PATH");
        }
        if let Some(value) = original_skip_system_cli_lookup {
            std::env::set_var("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP", value);
        } else {
            std::env::remove_var("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP");
        }

        result?;

        assert_eq!(state.status, UpdateStatus::Installed);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.artifact_paths.package_path, None);
        assert_eq!(state.artifact_paths.workspace_dir, None);
        Ok(())
    }

    #[test]
    fn status_reports_cli_update_required() -> Result<()> {
        let _env_guard = crate::test_util::env_lock();
        let temp = tempfile::tempdir()?;
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o755))?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let bin_dir = temp.path().join("bin");
        fs::create_dir_all(&bin_dir)?;
        fs::set_permissions(&bin_dir, fs::Permissions::from_mode(0o755))?;
        let codex_path = bin_dir.join("codex");
        fs::write(
            &codex_path,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ] || [ \"$1\" = \"version\" ]; then\n  echo 'codex-cli v0.42.0'\n  exit 0\nfi\nexit 1\n",
        )?;
        let mut permissions = fs::metadata(&codex_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&codex_path, permissions)?;

        let npm_path = bin_dir.join("npm");
        fs::write(
            &npm_path,
            "#!/bin/sh\nif [ \"$1\" = \"view\" ] && [ \"$2\" = \"@openai/codex\" ] && [ \"$3\" = \"version\" ]; then\n  echo '0.42.1'\n  exit 0\nfi\nexit 1\n",
        )?;
        let mut permissions = fs::metadata(&npm_path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&npm_path, permissions)?;
        let node_path = bin_dir.join("node");
        fs::write(&node_path, "#!/bin/sh\nexec /bin/sh \"$@\"\n")?;
        fs::set_permissions(node_path, fs::Permissions::from_mode(0o755))?;

        let original_home = std::env::var_os("HOME");
        let original_path = std::env::var_os("PATH");
        let original_nvm_dir = std::env::var_os("NVM_DIR");
        let original_codex_cli_path = std::env::var_os("CODEX_CLI_PATH");
        let original_skip_system_cli_lookup =
            std::env::var_os("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP");
        std::env::set_var("HOME", temp.path());
        std::env::set_var("PATH", std::env::join_paths([bin_dir])?);
        std::env::remove_var("NVM_DIR");
        std::env::remove_var("CODEX_CLI_PATH");
        std::env::set_var("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP", "1");

        let config = test_config(temp.path());
        let mut state = PersistedState::new(true);
        state.cli_path = Some(codex_path);
        let result = run_status(&config, &mut state, &paths, true);

        if let Some(home) = original_home {
            std::env::set_var("HOME", home);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(path) = original_path {
            std::env::set_var("PATH", path);
        } else {
            std::env::remove_var("PATH");
        }
        if let Some(nvm_dir) = original_nvm_dir {
            std::env::set_var("NVM_DIR", nvm_dir);
        } else {
            std::env::remove_var("NVM_DIR");
        }
        if let Some(cli_path) = original_codex_cli_path {
            std::env::set_var("CODEX_CLI_PATH", cli_path);
        } else {
            std::env::remove_var("CODEX_CLI_PATH");
        }
        if let Some(value) = original_skip_system_cli_lookup {
            std::env::set_var("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP", value);
        } else {
            std::env::remove_var("CHATGPT_UPDATER_TEST_SKIP_SYSTEM_CLI_LOOKUP");
        }

        assert!(result.is_err());
        assert_eq!(state.cli_status, CliStatus::Failed);
        assert!(state
            .cli_error_message
            .as_deref()
            .is_some_and(|message| message.contains("npm")));
        Ok(())
    }

    #[test]
    fn status_json_keeps_legacy_cli_latest_version_alias() -> Result<()> {
        let mut state = PersistedState::new(true);
        state.cli_official_latest_version = Some("0.42.1".to_string());
        state.cli_package_manager_latest_version = Some("0.42.0-1".to_string());

        let value = status_json_value(&state)?;

        assert_eq!(value["cli_latest_version"], "0.42.1");
        assert_eq!(value["cli_official_latest_version"], "0.42.1");
        assert_eq!(value["cli_package_manager_latest_version"], "0.42.0-1");
        Ok(())
    }

    #[test]
    fn generated_versions_compare_by_timestamp_segments() {
        assert_eq!(
            compare_generated_versions("2026.04.01.035152", "2026.03.27.025604+1086e799"),
            Some(std::cmp::Ordering::Greater)
        );
    }

    #[test]
    fn generated_versions_ignore_package_release_suffixes() {
        assert_eq!(
            compare_generated_versions(
                "2026.04.25.054929-90dd7716x11.fc43",
                "2026.04.25.054929+90dd7716",
            ),
            Some(std::cmp::Ordering::Equal)
        );
    }

    #[test]
    fn generated_version_comparison_supports_dmg_app_versions() {
        assert_eq!(
            compare_generated_versions("26.429.20946", "26.428.10000"),
            Some(std::cmp::Ordering::Greater)
        );
    }

    #[test]
    fn rollback_block_prefers_stable_dmg_hash() {
        let mut state = PersistedState::new(true);
        state.rollback_blocked_dmg_sha256 = Some("badcafe0".repeat(8));

        assert!(downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.07.091500+fresh123",
            &"badcafe0".repeat(8),
        ));
        assert!(!downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.07.091500+fresh123",
            &"feedface".repeat(8),
        ));
    }

    #[test]
    fn rollback_block_keeps_candidate_version_fallback() {
        let mut state = PersistedState::new(true);
        state.rollback_blocked_candidate_version = Some("2026.05.06.120000+badcafe0".to_string());

        assert!(downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.06.120000+fresh123",
            &"feedface".repeat(8),
        ));
    }

    #[test]
    fn rollback_block_keeps_legacy_download_candidate_version_fallback() {
        let mut state = PersistedState::new(true);
        state.rollback_blocked_candidate_version = Some("2026.05.06.120000+badcafe0".to_string());

        assert!(downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.06.120000+fresh123",
            &"feedface".repeat(8),
        ));
    }

    #[test]
    fn rollback_block_does_not_compare_legacy_timestamp_to_trusted_app_version() {
        let mut state = PersistedState::new(true);
        state.rollback_blocked_candidate_version = Some("2026.05.06.120000+badcafe0".to_string());

        assert!(!downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.07.120000+fresh123",
            &"feedface".repeat(8),
        ));
    }

    #[test]
    fn rollback_block_does_not_block_same_app_version_with_different_digest() {
        let mut state = PersistedState::new(true);
        state.rollback_blocked_candidate_version = Some("26.513.31313".to_string());
        state.rollback_blocked_dmg_sha256 = Some("badcafe0".repeat(8));

        assert!(!downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.07.120000+fresh123",
            &"feedface".repeat(8),
        ));
        assert!(downloaded_dmg_is_blocked_by_rollback(
            &state,
            "26.513.31313",
            "2026.05.07.120000+fresh123",
            &"badcafe0".repeat(8),
        ));
    }

    #[tokio::test]
    async fn trusted_dmg_recheck_fails_when_cached_file_changes() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let dmg_path = temp.path().join("ChatGPT.dmg");
        tokio::fs::write(&dmg_path, b"trusted bytes").await?;
        let expected_sha256 = file_sha256(&dmg_path).await?;
        let verified = trust::VerifiedDmg {
            version: "26.513.31313".to_string(),
            sha256: expected_sha256,
            manifest_path: temp.path().join("trusted-dmg-manifest.json"),
        };

        ensure_downloaded_dmg_still_matches_verified_metadata(&dmg_path, &verified).await?;

        tokio::fs::write(&dmg_path, b"changed bytes").await?;
        let error = ensure_downloaded_dmg_still_matches_verified_metadata(&dmg_path, &verified)
            .await
            .expect_err("changed cached DMG should fail the rebuild-time hash check");
        assert!(error
            .to_string()
            .contains("Downloaded DMG changed after trusted metadata verification"));
        Ok(())
    }

    #[test]
    fn successful_install_clears_both_rollback_block_identifiers() {
        let mut state = PersistedState::new(true);
        state.rollback_blocked_candidate_version = Some("2026.05.04.131500".to_string());
        state.rollback_blocked_dmg_sha256 = Some("rolled-back-sha256".to_string());

        clear_rollback_blocked_candidate(&mut state);

        assert_eq!(state.rollback_blocked_candidate_version, None);
        assert_eq!(state.rollback_blocked_dmg_sha256, None);
    }

    #[tokio::test]
    async fn interrupted_install_becomes_installed_when_candidate_is_already_present() -> Result<()>
    {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::Installing;
        state.installed_version = "2026.04.01.035152".to_string();
        state.candidate_version = Some("2026.03.27.025604+1086e799".to_string());
        state.rollback_blocked_candidate_version = Some("2026.03.20.120000".to_string());
        state.rollback_blocked_dmg_sha256 = Some("rolled-back-dmg-sha256".to_string());
        state.artifact_paths.package_path = Some(package_path);
        let recovered_workspace = temp
            .path()
            .join("cache/workspaces/2026.03.27.025604+1086e799");
        std::fs::create_dir_all(&recovered_workspace)?;
        state.artifact_paths.workspace_dir = Some(recovered_workspace.clone());

        recover_interrupted_install(&paths.cache_dir, &mut state, &paths)?;

        assert_eq!(state.status, UpdateStatus::Installed);
        assert_eq!(state.candidate_version, None);
        assert_eq!(state.rollback_blocked_candidate_version, None);
        assert_eq!(state.rollback_blocked_dmg_sha256, None);
        assert_eq!(state.artifact_paths.package_path, None);
        assert_eq!(state.artifact_paths.workspace_dir, None);
        assert_eq!(state.error_message, None);
        assert!(!recovered_workspace.exists());
        Ok(())
    }

    #[test]
    fn status_recovers_interrupted_install_before_reporting() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let codex_cli_path = temp.path().join("codex-cli");
        std::fs::write(
            &codex_cli_path,
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'codex-cli v0.42.0'\n  exit 0\nfi\nexit 1\n",
        )?;
        let mut cli_permissions = std::fs::metadata(&codex_cli_path)?.permissions();
        cli_permissions.set_mode(0o755);
        std::fs::set_permissions(&codex_cli_path, cli_permissions)?;

        let config = RuntimeConfig {
            dmg_url: "https://example.com/ChatGPT.dmg".to_string(),
            initial_check_delay_seconds: 1,
            check_interval_hours: 6,
            auto_install_on_app_exit: false,
            notifications: false,
            developer_mode: false,
            workspace_root: paths.cache_dir.clone(),
            builder_bundle_root: temp.path().join("builder"),
            app_executable_path: temp.path().join("chatgpt"),
            cli_path: Some(codex_cli_path.clone()),
            enable_wrapper_updates: false,
            wrapper_remote: String::new(),
            wrapper_branch: "main".to_string(),
            generated_artifact_cleanup: Default::default(),
        };

        let mut state = PersistedState::new(false);
        state.status = UpdateStatus::Installing;
        state.installed_version = "2026.03.24.120000".to_string();
        state.cli_path = Some(codex_cli_path);
        state.cli_installed_version = Some("0.42.0".to_string());
        state.cli_official_latest_version = Some("0.42.0".to_string());
        state.cli_last_check_at = Some(Utc::now());
        state.cli_last_verified_at = Some(Utc::now());
        state.candidate_version = Some("2026.03.27.025604+1086e799".to_string());
        state.artifact_paths.package_path = Some(temp.path().join("dist/missing-chatgpt.deb"));

        run_status(&config, &mut state, &paths, true)?;

        assert_eq!(state.status, UpdateStatus::Failed);
        assert!(state
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("package artifact is missing")));
        Ok(())
    }

    #[tokio::test]
    async fn interrupted_install_returns_to_ready_when_package_still_exists() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let package_path = temp.path().join("dist/chatgpt.deb");
        std::fs::create_dir_all(
            package_path
                .parent()
                .expect("package path should have parent"),
        )?;
        std::fs::write(&package_path, b"deb")?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::Installing;
        state.installed_version = "2026.03.24.120000".to_string();
        state.candidate_version = Some("2026.03.27.025604+1086e799".to_string());
        state.artifact_paths.package_path = Some(package_path);

        recover_interrupted_install(&paths.cache_dir, &mut state, &paths)?;

        assert_eq!(state.status, UpdateStatus::ReadyToInstall);
        assert!(state
            .error_message
            .as_deref()
            .is_some_and(|message| message.contains("interrupted")));
        Ok(())
    }

    #[test]
    fn notification_events_are_deduplicated() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.candidate_version = Some("2026.03.24+abcd1234".to_string());
        maybe_notify(
            &mut state,
            &paths,
            false,
            "ready_to_install",
            "ChatGPT update ready",
            "An update is ready to install.",
        )?;
        let notified_count = state.notified_events.len();
        maybe_notify(
            &mut state,
            &paths,
            false,
            "ready_to_install",
            "ChatGPT update ready",
            "An update is ready to install.",
        )?;

        assert_eq!(state.notified_events.len(), notified_count);
        Ok(())
    }

    #[test]
    fn installed_notifications_are_deduplicated_after_recovery() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.status = UpdateStatus::Installed;
        state.installed_version = "2026.04.16.120000".to_string();

        maybe_notify_installed(&mut state, &paths, false)?;
        let notified_count = state.notified_events.len();
        maybe_notify_installed(&mut state, &paths, false)?;

        assert_eq!(state.notified_events.len(), notified_count);
        assert!(state
            .notified_events
            .contains("installed:2026.04.16.120000"));
        Ok(())
    }

    #[test]
    fn cli_missing_notifications_are_deduplicated() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.cli_status = CliStatus::NotInstalled;
        state.cli_error_message = Some(codex_cli::CLI_NOT_INSTALLED_MESSAGE.to_string());

        maybe_notify_cli_missing(&mut state, &paths, false)?;
        let notified_count = state.notified_events.len();
        maybe_notify_cli_missing(&mut state, &paths, false)?;

        assert_eq!(state.notified_events.len(), notified_count);
        assert!(state.notified_events.contains("cli_missing"));
        Ok(())
    }

    #[test]
    fn cli_missing_notification_marker_is_cleared_after_recovery() -> Result<()> {
        let temp = tempfile::tempdir()?;
        let paths = RuntimePaths {
            config_file: temp.path().join("config/config.toml"),
            state_file: temp.path().join("state/state.json"),
            log_file: temp.path().join("state/service.log"),
            cache_dir: temp.path().join("cache"),
            state_dir: temp.path().join("state"),
            config_dir: temp.path().join("config"),
        };
        paths.ensure_dirs()?;

        let mut state = PersistedState::new(true);
        state.notified_events.insert("cli_missing".to_string());
        state.cli_path = Some(temp.path().join("codex"));
        state.cli_installed_version = Some("0.42.0".to_string());
        state.cli_error_message = None;

        maybe_notify_cli_missing(&mut state, &paths, false)?;

        assert!(!state.notified_events.contains("cli_missing"));
        Ok(())
    }
}
