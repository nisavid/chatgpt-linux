//! Interactive integration picker for the in-app wrapper Update button.
//!
//! When the user clicks the wrapper "Update" button, the renderer shells out to
//! `chatgpt-updater pick-integrations` *while the display is still alive* (the
//! detached `apply-wrapper-update` runs after the app exits → headless, so the
//! dialog must run here, at click time). This subcommand:
//!
//! 1. Locates a wrapper source checkout that ships the integration catalog
//!    (`scripts/lib/port-integrations.js` + the `port-integrations/<id>/integration.json`
//!    set). When an update candidate is recorded, it prepares that candidate
//!    source first so the picker reflects the build that will actually run. A
//!    manual `pick-integrations` invocation without a candidate falls back to the
//!    installed builder bundle.
//! 2. Reads the catalog (`--integrations-json`) and the currently-enabled set
//!    (the saved `port-integrations.json`, else `--enabled`). It offers the X11
//!    Computer Use integration only when the installed builder bundle retains
//!    its trusted executable helper.
//! 3. Shows a zenity/kdialog checklist pre-checked with the enabled set, plus a
//!    sentinel "(Don't ask again …)" row.
//! 4. Validates the chosen set against each manifest's `requires` and
//!    `conflicts`, then updates `enabled` and `disabled` in the user integration
//!    config while preserving the effective config's `settings` object (the
//!    existing user override first, otherwise the packaged snapshot) so the
//!    rebuild uses the selection. If the sentinel row was checked, persists
//!    `chatgpt-linux-integration-picker-on-update=false` so future updates skip the
//!    prompt.
//!
//! Every failure mode (no display, no dialog tool, no catalog, cancelled or
//! invalid selection, or dialog launch failure) is a graceful skip that leaves
//! the current integration set unchanged — the picker must never block or fail
//! the update it precedes.

use anyhow::{Context, Result};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};
use tracing::{info, warn};

use crate::{
    config::{self, RuntimeConfig, RuntimePaths},
    state::PersistedState,
    wrapper_apply,
};

/// Sentinel checklist row id for "don't ask again". Contains underscores so it
/// can never collide with a real integration id (`^[a-z0-9][a-z0-9-]*$`).
const DONT_ASK_SENTINEL: &str = "__dont_ask_again__";
const DONT_ASK_LABEL: &str = "(Don't ask again on future updates)";
const X11_COMPUTER_USE_INTEGRATION_ID: &str = "x11-ewmh-computer-use";
const X11_COMPUTER_USE_HELPER: &str = "chatgpt-computer-use-x11";

/// A catalog integration row read from `--integrations-json`.
struct CatalogEntry {
    id: String,
    title: String,
    default_enabled: bool,
    requires: Vec<String>,
    conflicts: Vec<String>,
}

/// Outcome of `run_pick_integrations`, surfaced as JSON when `--json` is passed.
enum PickOutcome {
    Skipped(&'static str),
    Picked { count: usize, dont_ask: bool },
}

/// Runs the integration picker. Returns `Ok(())` in every non-panic case; a skip
/// (no display, no dialog tool, no catalog, cancelled) leaves integrations unchanged.
pub fn run_pick_integrations(
    config: &RuntimeConfig,
    paths: &RuntimePaths,
    json: bool,
) -> Result<()> {
    let outcome = pick(config, paths)?;
    if json {
        match &outcome {
            PickOutcome::Skipped(reason) => {
                println!("{{\"ok\":true,\"skipped\":\"{reason}\"}}");
            }
            PickOutcome::Picked { count, dont_ask } => {
                println!("{{\"ok\":true,\"picked\":{count},\"dont_ask\":{dont_ask}}}");
            }
        }
    }
    Ok(())
}

fn pick(config: &RuntimeConfig, paths: &RuntimePaths) -> Result<PickOutcome> {
    // Defensive double-gate: the button already checks this, but honor it here
    // too so a stray invocation can't re-prompt after "don't ask again".
    if config::settings_integration_picker_on_update_override() == Some(false) {
        return Ok(PickOutcome::Skipped("disabled"));
    }
    if !has_display() {
        return Ok(PickOutcome::Skipped("no-display"));
    }
    let Some(tool) = dialog_tool() else {
        return Ok(PickOutcome::Skipped("no-dialog-tool"));
    };
    // Try each allowed source in turn; the first that yields a non-empty catalog
    // wins. If a wrapper-update candidate is recorded, candidate_sources()
    // returns only that prepared candidate checkout so the picker cannot fall
    // back to the installed wrapper catalog.
    let mut chosen: Option<(PathBuf, Vec<CatalogEntry>)> = None;
    for source in candidate_sources(config, paths) {
        match read_catalog(config, &source) {
            Ok(catalog) if !catalog.is_empty() => {
                chosen = Some((source, catalog));
                break;
            }
            Ok(_) => continue,
            Err(error) => {
                warn!(?error, source = %source.display(), "integration picker could not read catalog from this source");
                continue;
            }
        }
    }
    let Some((source, catalog)) = chosen else {
        return Ok(PickOutcome::Skipped("no-catalog"));
    };
    let x11_computer_use_available = crate::builder::has_trusted_prebuilt_helper(
        &config.builder_bundle_root,
        X11_COMPUTER_USE_HELPER,
    );
    let x11_computer_use_in_catalog = catalog
        .iter()
        .any(|entry| entry.id == X11_COMPUTER_USE_INTEGRATION_ID);
    let catalog = catalog
        .into_iter()
        .filter(|entry| entry.id != X11_COMPUTER_USE_INTEGRATION_ID || x11_computer_use_available)
        .collect::<Vec<_>>();
    if catalog.is_empty() {
        return Ok(PickOutcome::Skipped("no-catalog"));
    }
    let mut enabled = read_enabled(config, &source, &catalog);
    if !x11_computer_use_available && enabled.remove(X11_COMPUTER_USE_INTEGRATION_ID) {
        warn!(
            integration = X11_COMPUTER_USE_INTEGRATION_ID,
            "integration picker removed an existing selection unavailable in the installed builder bundle"
        );
    }

    match show_picker(&tool, &catalog, &enabled)? {
        None => {
            info!("integration picker cancelled; integration set unchanged");
            Ok(PickOutcome::Skipped("cancelled"))
        }
        Some(selection) => {
            if !x11_computer_use_available
                && selection
                    .iter()
                    .any(|id| id == X11_COMPUTER_USE_INTEGRATION_ID)
            {
                warn!(
                    integration = X11_COMPUTER_USE_INTEGRATION_ID,
                    "integration picker rejected an integration unavailable in the installed builder bundle"
                );
                return Ok(PickOutcome::Skipped("unavailable-integration"));
            }
            let dont_ask = selection.iter().any(|id| id == DONT_ASK_SENTINEL);
            let catalog_ids: std::collections::HashSet<&str> =
                catalog.iter().map(|entry| entry.id.as_str()).collect();
            let mut picked: Vec<String> = selection
                .into_iter()
                .filter(|id| id != DONT_ASK_SENTINEL && catalog_ids.contains(id.as_str()))
                .collect();
            picked.extend(
                enabled
                    .iter()
                    .filter(|id| id.as_str() != DONT_ASK_SENTINEL)
                    .filter(|id| !catalog_ids.contains(id.as_str()))
                    .cloned(),
            );
            picked.sort();
            picked.dedup();

            if let Err(message) = validate_selection(&catalog, &picked) {
                warn!(%message, "integration picker rejected invalid selection");
                show_selection_error(&tool, &message);
                return Ok(PickOutcome::Skipped("invalid-selection"));
            }

            let picked_ids: std::collections::HashSet<&str> =
                picked.iter().map(String::as_str).collect();
            let mut disabled: Vec<String> = catalog
                .iter()
                .filter(|entry| entry.default_enabled && !picked_ids.contains(entry.id.as_str()))
                .map(|entry| entry.id.clone())
                .collect();
            if x11_computer_use_in_catalog && !x11_computer_use_available {
                disabled.push(X11_COMPUTER_USE_INTEGRATION_ID.to_string());
                disabled.sort();
                disabled.dedup();
            }

            write_integration_config(config, &picked, &disabled)?;
            if dont_ask {
                if let Err(error) = config::write_integration_picker_on_update(false) {
                    warn!(?error, "could not persist don't-ask-again preference");
                }
            }
            info!(
                count = picked.len(),
                dont_ask, "integration picker selection saved"
            );
            Ok(PickOutcome::Picked {
                count: picked.len(),
                dont_ask,
            })
        }
    }
}

/// True when an X11 or Wayland display is available for a GUI dialog.
fn has_display() -> bool {
    ["DISPLAY", "WAYLAND_DISPLAY"].iter().any(|var| {
        std::env::var(var)
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    })
}

/// The dialog helper to use, preferring zenity then kdialog (PATH lookup).
fn dialog_tool() -> Option<DialogTool> {
    if which("zenity").is_some() {
        Some(DialogTool::Zenity)
    } else if which("kdialog").is_some() {
        Some(DialogTool::Kdialog)
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DialogTool {
    Zenity,
    Kdialog,
}

/// Candidate wrapper source checkouts that ship the integration catalog. When a
/// wrapper update candidate is recorded, fetch that candidate source first so
/// the picker shows the integrations that will actually be rebuilt. Without a
/// recorded candidate, fall back to the installed builder bundle for manual
/// `pick-integrations` invocations.
fn candidate_sources(config: &RuntimeConfig, paths: &RuntimePaths) -> Vec<PathBuf> {
    let candidate_commit =
        PersistedState::load_or_default(&paths.state_file, config.auto_install_on_app_exit)
            .ok()
            .and_then(|state| state.candidate_wrapper_commit);

    if let Some(candidate_commit) = candidate_commit.as_deref() {
        return match wrapper_apply::ensure_wrapper_source(config, paths, Some(candidate_commit)) {
            Ok(source) if source.join("scripts/lib/port-integrations.js").is_file() => vec![source],
            Ok(_) => Vec::new(),
            Err(error) => {
                warn!(
                    ?error,
                    "integration picker could not prepare candidate wrapper source"
                );
                Vec::new()
            }
        };
    }

    [config.builder_bundle_root.clone()]
        .into_iter()
        .filter(|dir| dir.join("scripts/lib/port-integrations.js").is_file())
        .collect()
}

/// Resolves a node binary: the bundle's managed runtime first, then PATH.
fn node_binary(config: &RuntimeConfig) -> PathBuf {
    let managed = config.builder_bundle_root.join("node-runtime/bin/node");
    if managed.is_file() {
        return managed;
    }
    which("node").unwrap_or_else(|| PathBuf::from("node"))
}

/// Reads the full integration catalog via `port-integrations.js --integrations-json`.
fn read_catalog(config: &RuntimeConfig, source: &Path) -> Result<Vec<CatalogEntry>> {
    let script = source.join("scripts/lib/port-integrations.js");
    let output = Command::new(node_binary(config))
        .arg(&script)
        .arg("--integrations-json")
        .output()
        .with_context(|| format!("Failed to run {}", script.display()))?;
    if !output.status.success() {
        anyhow::bail!(
            "port-integrations.js --integrations-json exited with {}",
            output.status
        );
    }
    let parsed = serde_json::from_slice::<serde_json::Value>(&output.stdout)
        .context("Failed to parse --integrations-json output")?;
    let array = parsed
        .as_array()
        .context("--integrations-json did not return an array")?;
    let mut entries = Vec::new();
    for item in array {
        let Some(id) = item.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        let title = item
            .get("title")
            .and_then(|value| value.as_str())
            .filter(|title| !title.is_empty())
            .unwrap_or(id)
            .to_string();
        entries.push(CatalogEntry {
            id: id.to_string(),
            title: sanitize_label(&title),
            default_enabled: item
                .get("defaultEnabled")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
            requires: read_catalog_id_list(item, "requires", id)?,
            conflicts: read_catalog_id_list(item, "conflicts", id)?,
        });
    }
    Ok(entries)
}

/// Reads a normalized integration-id list from the catalog. The JavaScript catalog
/// generator always emits both fields, but accepting an absent field keeps the
/// updater compatible with older installed builder bundles. A present malformed
/// field is rejected rather than silently dropping a constraint.
fn read_catalog_id_list(
    item: &serde_json::Value,
    field: &str,
    integration_id: &str,
) -> Result<Vec<String>> {
    let Some(value) = item.get(field) else {
        return Ok(Vec::new());
    };
    let array = value.as_array().with_context(|| {
        format!("Port integration '{integration_id}' catalog {field} must be an array")
    })?;
    array
        .iter()
        .map(|value| {
            value.as_str().map(str::to_string).with_context(|| {
                format!(
                    "Port integration '{integration_id}' catalog {field} entries must be strings"
                )
            })
        })
        .collect()
}

/// Mirrors `validateEnabledIntegrationDependencies` from port-integrations.js
/// before the picker persists a selection. Unknown existing ids remain
/// preserved; a known integration may still require or conflict with one of
/// those ids.
fn validate_selection(
    catalog: &[CatalogEntry],
    picked: &[String],
) -> std::result::Result<(), String> {
    let enabled: std::collections::HashSet<&str> = picked.iter().map(String::as_str).collect();
    for entry in catalog {
        if !enabled.contains(entry.id.as_str()) {
            continue;
        }
        for required in &entry.requires {
            if !enabled.contains(required.as_str()) {
                return Err(format!(
                    "Port integration '{}' requires '{}' to be enabled.",
                    entry.id, required
                ));
            }
        }
        for conflict in &entry.conflicts {
            if enabled.contains(conflict.as_str()) {
                return Err(format!(
                    "Port integration '{}' conflicts with '{}'. Select only one of these integrations.",
                    entry.id, conflict
                ));
            }
        }
    }
    Ok(())
}

/// Reads the currently-enabled integration ids. Prefers the saved picker config,
/// then the installed builder bundle's preserved integration config, then
/// `port-integrations.js --enabled` from the selected source. Errors degrade to an
/// empty set.
fn read_enabled(
    config: &RuntimeConfig,
    source: &Path,
    catalog: &[CatalogEntry],
) -> std::collections::HashSet<String> {
    if let Some(path) = config::effective_integration_config_path(config) {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                let disabled: std::collections::HashSet<String> = value
                    .get("disabled")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|item| item.as_str())
                    .map(|s| s.to_string())
                    .collect();
                if value.get("enabled").is_some() || value.get("disabled").is_some() {
                    let mut enabled: std::collections::HashSet<String> = value
                        .get("enabled")
                        .and_then(|v| v.as_array())
                        .into_iter()
                        .flatten()
                        .filter_map(|item| item.as_str())
                        .map(|s| s.to_string())
                        .collect();
                    for entry in catalog {
                        if entry.default_enabled && !disabled.contains(&entry.id) {
                            enabled.insert(entry.id.clone());
                        }
                    }
                    return enabled;
                }
            }
        }
    }

    let script = source.join("scripts/lib/port-integrations.js");
    let Ok(output) = Command::new(node_binary(config))
        .arg(&script)
        .arg("--enabled")
        .output()
    else {
        return std::collections::HashSet::new();
    };
    if !output.status.success() {
        return std::collections::HashSet::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

/// Shows the checklist. Returns `Some(selected ids incl. maybe the sentinel)` on
/// OK, or `None` when the user cancelled (nonzero dialog exit).
fn show_picker(
    tool: &DialogTool,
    catalog: &[CatalogEntry],
    enabled: &std::collections::HashSet<String>,
) -> Result<Option<Vec<String>>> {
    let output = match tool {
        DialogTool::Zenity => {
            let mut cmd = Command::new("zenity");
            cmd.args([
                "--list",
                "--checklist",
                "--title=ChatGPT port integrations",
                "--text=Select the optional port integrations to enable for this update.",
                "--column=Enable",
                "--column=Integration",
                "--column=Description",
                "--print-column=2",
                "--separator=\n",
            ]);
            for entry in catalog {
                cmd.arg(if enabled.contains(&entry.id) {
                    "TRUE"
                } else {
                    "FALSE"
                });
                cmd.arg(&entry.id);
                cmd.arg(&entry.title);
            }
            // Sentinel "don't ask again" row, unchecked by default.
            cmd.arg("FALSE").arg(DONT_ASK_SENTINEL).arg(DONT_ASK_LABEL);
            match cmd.output() {
                Ok(output) => output,
                Err(error) => {
                    warn!(?error, "integration picker could not launch zenity");
                    return Ok(None);
                }
            }
        }
        DialogTool::Kdialog => {
            let mut cmd = Command::new("kdialog");
            cmd.args([
                "--separate-output",
                "--checklist",
                "Select the optional port integrations to enable for this update.",
            ]);
            for entry in catalog {
                cmd.arg(&entry.id);
                cmd.arg(&entry.title);
                cmd.arg(if enabled.contains(&entry.id) {
                    "on"
                } else {
                    "off"
                });
            }
            cmd.arg(DONT_ASK_SENTINEL).arg(DONT_ASK_LABEL).arg("off");
            match cmd.output() {
                Ok(output) => output,
                Err(error) => {
                    warn!(?error, "integration picker could not launch kdialog");
                    return Ok(None);
                }
            }
        }
    };

    if !output.status.success() {
        // Nonzero exit = user cancelled (or dialog error) → treat as cancel.
        return Ok(None);
    }
    let ids = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().trim_matches('"').to_string())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    Ok(Some(ids))
}

/// Best-effort explanation for a rejected selection. Dialog failures are
/// intentionally ignored so invalid picker input still degrades to a skip and
/// never blocks the update.
fn show_selection_error(tool: &DialogTool, message: &str) {
    let result = match tool {
        DialogTool::Zenity => Command::new("zenity")
            .args([
                "--error",
                "--title=Invalid port integration selection",
                &format!("--text={message}"),
            ])
            .status(),
        DialogTool::Kdialog => Command::new("kdialog")
            .args([
                "--error",
                message,
                "--title",
                "Invalid port integration selection",
            ])
            .status(),
    };
    if let Err(error) = result {
        warn!(
            ?error,
            "integration picker could not show invalid-selection dialog"
        );
    }
}

/// Writes the chosen enabled set to the stable integration-config path while
/// preserving the effective config's valid top-level settings object. An
/// existing user config remains the highest-priority source; otherwise the
/// packaged snapshot seeds the first user config.
fn write_integration_config(
    config: &RuntimeConfig,
    enabled: &[String],
    disabled: &[String],
) -> Result<()> {
    let path =
        config::integration_config_path().context("could not resolve integration config path")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .with_context(|| format!("Failed to create {}", dir.display()))?;
    }
    let existing_settings = config::effective_integration_config_path(config).and_then(
        |settings_source| {
            std::fs::read_to_string(&settings_source)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                .and_then(|value| match value.get("settings") {
                    Some(settings) if settings.is_object() => Some(settings.clone()),
                    Some(settings) if !settings.is_null() => {
                        warn!(
                            path = %settings_source.display(),
                            "existing port integration settings must be an object; omitting invalid settings"
                        );
                        None
                    }
                    _ => None,
                })
        },
    );
    let mut value = serde_json::json!({
        "enabled": enabled,
        "disabled": disabled,
    });
    if let Some(settings) = existing_settings {
        value["settings"] = settings;
    }
    let serialized =
        serde_json::to_string_pretty(&value).context("Failed to serialize integration config")?;
    config::atomic_write(&path, format!("{serialized}\n").as_bytes())
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

/// Strips tab/newline from a label so it can't break dialog column parsing.
fn sanitize_label(label: &str) -> String {
    label.replace(['\t', '\n', '\r'], " ").trim().to_string()
}

/// Minimal PATH lookup for an executable (no extra deps).
fn which(tool: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(tool);
        if candidate.is_file()
            && candidate
                .metadata()
                .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
        {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::env_lock;
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    fn base_config(bundle_root: &Path) -> RuntimeConfig {
        let paths = RuntimePaths {
            config_file: bundle_root.join("config.toml"),
            state_file: bundle_root.join("state.json"),
            log_file: bundle_root.join("log"),
            cache_dir: bundle_root.join("cache"),
            state_dir: bundle_root.join("state"),
            config_dir: bundle_root.join("config"),
        };
        let mut config = RuntimeConfig::default_with_paths(&paths);
        config.builder_bundle_root = bundle_root.to_path_buf();
        config
    }

    fn runtime_paths(root: &Path) -> RuntimePaths {
        RuntimePaths {
            config_file: root.join("config.toml"),
            state_file: root.join("state.json"),
            log_file: root.join("log"),
            cache_dir: root.join("cache"),
            state_dir: root.join("state"),
            config_dir: root.join("config"),
        }
    }

    /// Writes a fake `scripts/lib/port-integrations.js` that emits a fixed catalog
    /// for `--integrations-json` and a fixed enabled list for `--enabled`.
    fn write_fake_catalog_script(source: &Path) {
        let script_dir = source.join("scripts/lib");
        std::fs::create_dir_all(&script_dir).unwrap();
        std::fs::write(
            script_dir.join("port-integrations.js"),
            r#"
const arg = process.argv[2];
if (arg === "--integrations-json") {
  process.stdout.write(JSON.stringify([
    {"id":"alpha","title":"Alpha Integration","defaultEnabled":true},
    {"id":"beta","title":"Beta Integration","defaultEnabled":false}
  ]));
} else if (arg === "--enabled") {
  process.stdout.write("alpha\n");
}
"#,
        )
        .unwrap();
    }

    fn write_constrained_catalog_script(source: &Path) {
        let script_dir = source.join("scripts/lib");
        std::fs::create_dir_all(&script_dir).unwrap();
        std::fs::write(
            script_dir.join("port-integrations.js"),
            r#"
const arg = process.argv[2];
if (arg === "--integrations-json") {
  process.stdout.write(JSON.stringify([
    {
      "id":"directory-only-working-tree-watch",
      "title":"Directory-Only Working-Tree Watch",
      "requires":[],
      "conflicts":[]
    },
    {
      "id":"shallow-repository-watches",
      "title":"Shallow Linux Repository Watches",
      "requires":[],
      "conflicts":["directory-only-working-tree-watch"]
    }
  ]));
} else if (arg === "--enabled") {
  process.stdout.write("directory-only-working-tree-watch\n");
}
"#,
        )
        .unwrap();
    }

    fn write_x11_catalog_script(source: &Path) {
        let script_dir = source.join("scripts/lib");
        std::fs::create_dir_all(&script_dir).unwrap();
        std::fs::write(
            script_dir.join("port-integrations.js"),
            r#"
const arg = process.argv[2];
if (arg === "--integrations-json") {
  process.stdout.write(JSON.stringify([
    {"id":"alpha","title":"Alpha Integration","defaultEnabled":true},
    {"id":"x11-ewmh-computer-use","title":"X11/EWMH Computer Use","defaultEnabled":false}
  ]));
} else if (arg === "--enabled") {
  process.stdout.write("alpha\n");
}
"#,
        )
        .unwrap();
    }

    fn write_x11_prebuilt_helper(bundle_root: &Path) {
        let helper = bundle_root
            .join("prebuilt-helpers")
            .join(X11_COMPUTER_USE_HELPER);
        std::fs::create_dir_all(helper.parent().unwrap()).unwrap();
        std::fs::write(&helper, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fn constrained_catalog() -> Vec<CatalogEntry> {
        vec![
            CatalogEntry {
                id: "directory-only-working-tree-watch".to_string(),
                title: "Directory-Only Working-Tree Watch".to_string(),
                default_enabled: false,
                requires: Vec::new(),
                conflicts: Vec::new(),
            },
            CatalogEntry {
                id: "shallow-repository-watches".to_string(),
                title: "Shallow Linux Repository Watches".to_string(),
                default_enabled: false,
                requires: Vec::new(),
                conflicts: vec!["directory-only-working-tree-watch".to_string()],
            },
            CatalogEntry {
                id: "sidebar-watch-consumer".to_string(),
                title: "Sidebar Watch Consumer".to_string(),
                default_enabled: false,
                requires: vec!["shallow-repository-watches".to_string()],
                conflicts: Vec::new(),
            },
        ]
    }

    fn git(repo: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(repo)
            .args(args)
            .status()
            .expect("git should run");
        assert!(status.success(), "git {args:?} failed with {status}");
    }

    fn init_fake_catalog_repo(repo: &Path) -> String {
        git(repo, &["init", "-q", "-b", "main"]);
        git(repo, &["config", "user.email", "chatgpt@example.invalid"]);
        git(repo, &["config", "user.name", "ChatGPT Test"]);
        write_fake_catalog_script(repo);
        git(repo, &["add", "-A"]);
        git(repo, &["commit", "-q", "-m", "catalog"]);
        let output = Command::new("git")
            .current_dir(repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .expect("git rev-parse should run");
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    }

    /// Installs a fake dialog tool on a temp PATH that echoes `stdout_lines` and
    /// exits with `exit_code`. Returns the temp dir (keep alive) and the PATH.
    fn fake_dialog(
        name: &str,
        stdout_lines: &str,
        exit_code: i32,
    ) -> (tempfile::TempDir, std::ffi::OsString) {
        let dir = tempdir().unwrap();
        let bin = dir.path().join(name);
        std::fs::write(
            &bin,
            format!(
                "#!/bin/sh\n[ \"$1\" = \"--error\" ] && exit 0\nif [ -n \"${{CHATGPT_TEST_DIALOG_ARGS_FILE:-}}\" ]; then\n  printf '%s\\n' \"$@\" > \"$CHATGPT_TEST_DIALOG_ARGS_FILE\"\nfi\nprintf '%s' \"{stdout_lines}\"\nexit {exit_code}\n"
            ),
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = dir.path().as_os_str().to_os_string();
        (dir, path)
    }

    #[test]
    fn skips_without_display() {
        let _g = env_lock();
        std::env::remove_var("DISPLAY");
        std::env::remove_var("WAYLAND_DISPLAY");
        let root = tempdir().unwrap();
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());
        // No display -> Ok, no config written.
        run_pick_integrations(&config, &paths, false).unwrap();
        assert!(!root
            .path()
            .join("config/chatgpt/port-integrations.json")
            .exists());
    }

    #[test]
    fn candidate_sources_prefers_bundle_with_catalog_script() {
        let root = tempdir().unwrap();
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());
        assert!(candidate_sources(&config, &paths).is_empty());
        write_fake_catalog_script(root.path());
        assert_eq!(
            candidate_sources(&config, &paths),
            vec![root.path().to_path_buf()]
        );
    }

    #[test]
    fn candidate_sources_uses_recorded_candidate_checkout() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let remote = tempdir().unwrap();
        let paths = runtime_paths(root.path());
        paths.ensure_dirs().unwrap();
        write_fake_catalog_script(root.path());
        let commit = init_fake_catalog_repo(remote.path());

        let mut config = base_config(root.path());
        config.wrapper_remote =
            format!("file://{}", remote.path().canonicalize().unwrap().display());
        let mut state = PersistedState::new(true);
        state.candidate_wrapper_commit = Some(commit);
        state.save(&paths.state_file).unwrap();

        assert_eq!(
            candidate_sources(&config, &paths),
            vec![paths.cache_dir.join("wrapper-src")]
        );
    }

    #[test]
    fn candidate_sources_do_not_fallback_when_recorded_candidate_cannot_be_prepared() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let paths = runtime_paths(root.path());
        paths.ensure_dirs().unwrap();
        write_fake_catalog_script(root.path());

        let config = base_config(root.path());
        let mut state = PersistedState::new(true);
        state.candidate_wrapper_commit = Some("a".repeat(40));
        state.save(&paths.state_file).unwrap();

        let empty_path = tempdir().unwrap();
        let previous_path = std::env::var_os("PATH");
        std::env::set_var("PATH", empty_path.path());

        let sources = candidate_sources(&config, &paths);

        if let Some(previous_path) = previous_path {
            std::env::set_var("PATH", previous_path);
        } else {
            std::env::remove_var("PATH");
        }

        assert!(
            sources.is_empty(),
            "recorded candidate failures must not use the installed catalog"
        );
    }

    #[test]
    fn enabled_reads_builder_integration_config_when_saved_picker_config_is_absent() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_fake_catalog_script(root.path());
        let builder_config = root.path().join("port-integrations/integrations.json");
        std::fs::create_dir_all(builder_config.parent().unwrap()).unwrap();
        std::fs::write(&builder_config, r#"{"enabled":["alpha"]}"#).unwrap();

        let settings_file = settings.path().join("settings.json");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        let config = base_config(root.path());

        assert_eq!(
            read_enabled(
                &config,
                root.path(),
                &[
                    CatalogEntry {
                        id: "alpha".to_string(),
                        title: "Alpha Integration".to_string(),
                        default_enabled: true,
                        requires: Vec::new(),
                        conflicts: Vec::new(),
                    },
                    CatalogEntry {
                        id: "beta".to_string(),
                        title: "Beta Integration".to_string(),
                        default_enabled: false,
                        requires: Vec::new(),
                        conflicts: Vec::new(),
                    },
                ],
            ),
            std::collections::HashSet::from(["alpha".to_string()])
        );

        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
    }

    #[test]
    fn write_integration_config_uses_atomic_write() {
        let _g = env_lock();
        let settings = tempdir().unwrap();
        let settings_file = settings.path().join("settings.json");
        let config = base_config(settings.path());
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);

        write_integration_config(&config, &["alpha".to_string()], &["beta".to_string()]).unwrap();

        let integration_config = settings.path().join("port-integrations.json");
        let content = std::fs::read_to_string(&integration_config).unwrap();
        let value = serde_json::from_str::<serde_json::Value>(&content).unwrap();
        assert_eq!(value["enabled"], serde_json::json!(["alpha"]));
        assert_eq!(value["disabled"], serde_json::json!(["beta"]));
        let temp_entries = std::fs::read_dir(settings.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".port-integrations.json.tmp.")
            })
            .count();
        assert_eq!(temp_entries, 0);

        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
    }

    #[test]
    fn write_integration_config_preserves_existing_settings_object() {
        let _g = env_lock();
        let settings = tempdir().unwrap();
        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        let config = base_config(settings.path());
        let packaged_config = settings
            .path()
            .join(".chatgpt-linux/port-integrations.json");
        std::fs::create_dir_all(packaged_config.parent().unwrap()).unwrap();
        std::fs::write(
            &packaged_config,
            r#"{
  "enabled": ["alpha"],
  "settings": {
    "pet-overlay": {
      "petOverlay": {
        "gravity": "top-left"
      }
    }
  }
}
"#,
        )
        .unwrap();
        std::fs::write(
            &integration_config,
            r#"{
  "enabled": ["alpha"],
  "disabled": [],
  "settings": {
    "pet-overlay": {
      "petOverlay": {
        "gravity": "bottom-right"
      }
    }
  }
}
"#,
        )
        .unwrap();
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);

        write_integration_config(&config, &["beta".to_string()], &["alpha".to_string()]).unwrap();

        let content = std::fs::read_to_string(&integration_config).unwrap();
        let value = serde_json::from_str::<serde_json::Value>(&content).unwrap();
        assert_eq!(value["enabled"], serde_json::json!(["beta"]));
        assert_eq!(value["disabled"], serde_json::json!(["alpha"]));
        assert_eq!(
            value["settings"],
            serde_json::json!({
                "pet-overlay": {
                    "petOverlay": {
                        "gravity": "bottom-right"
                    }
                }
            })
        );

        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
    }

    #[test]
    fn write_integration_config_omits_non_object_settings() {
        let _g = env_lock();
        let settings = tempdir().unwrap();
        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        let config = base_config(settings.path());
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);

        for invalid_settings in [
            serde_json::Value::Null,
            serde_json::json!(["pet-overlay"]),
            serde_json::json!("pet-overlay"),
        ] {
            std::fs::write(
                &integration_config,
                format!(
                    "{}\n",
                    serde_json::json!({
                        "enabled": ["alpha"],
                        "disabled": [],
                        "settings": invalid_settings,
                    })
                ),
            )
            .unwrap();

            write_integration_config(&config, &["beta".to_string()], &["alpha".to_string()])
                .unwrap();

            let content = std::fs::read_to_string(&integration_config).unwrap();
            let value = serde_json::from_str::<serde_json::Value>(&content).unwrap();
            assert_eq!(value["enabled"], serde_json::json!(["beta"]));
            assert_eq!(value["disabled"], serde_json::json!(["alpha"]));
            assert!(value.get("settings").is_none());
        }

        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
    }

    #[test]
    fn enabled_config_honors_disabled_default_integrations() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        std::fs::write(
            &integration_config,
            r#"{
  "enabled": ["beta"],
  "disabled": ["alpha"]
}
"#,
        )
        .unwrap();
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        let config = base_config(root.path());

        assert_eq!(
            read_enabled(
                &config,
                root.path(),
                &[
                    CatalogEntry {
                        id: "alpha".to_string(),
                        title: "Alpha Integration".to_string(),
                        default_enabled: true,
                        requires: Vec::new(),
                        conflicts: Vec::new(),
                    },
                    CatalogEntry {
                        id: "beta".to_string(),
                        title: "Beta Integration".to_string(),
                        default_enabled: false,
                        requires: Vec::new(),
                        conflicts: Vec::new(),
                    },
                ],
            ),
            std::collections::HashSet::from(["beta".to_string()])
        );

        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
    }

    #[test]
    fn selection_validation_honors_manifest_requires_and_conflicts() {
        let catalog = constrained_catalog();

        let incompatible = vec![
            "directory-only-working-tree-watch".to_string(),
            "shallow-repository-watches".to_string(),
        ];
        assert_eq!(
            validate_selection(&catalog, &incompatible),
            Err("Port integration 'shallow-repository-watches' conflicts with 'directory-only-working-tree-watch'. Select only one of these integrations.".to_string())
        );

        let missing_requirement = vec!["sidebar-watch-consumer".to_string()];
        assert_eq!(
            validate_selection(&catalog, &missing_requirement),
            Err("Port integration 'sidebar-watch-consumer' requires 'shallow-repository-watches' to be enabled.".to_string())
        );

        let valid = vec![
            "shallow-repository-watches".to_string(),
            "sidebar-watch-consumer".to_string(),
        ];
        assert_eq!(validate_selection(&catalog, &valid), Ok(()));
    }

    #[test]
    fn incompatible_watch_selection_is_not_saved() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_constrained_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        let original_config = "{\n  \"enabled\": [\"directory-only-working-tree-watch\"]\n}\n";
        std::fs::write(&integration_config, original_config).unwrap();
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        let selection = concat!(
            "directory-only-working-tree-watch\n",
            "shallow-repository-watches\n",
            "__dont_ask_again__"
        );
        let (_d, fake_path) = fake_dialog("zenity", selection, 0);
        let prev_path = std::env::var_os("PATH");
        let mut joined = fake_path.clone();
        if let Some(prev) = &prev_path {
            joined.push(":");
            joined.push(prev);
        }
        std::env::set_var("PATH", &joined);

        run_pick_integrations(&config, &paths, false).unwrap();

        assert_eq!(
            std::fs::read_to_string(&integration_config).unwrap(),
            original_config,
            "an invalid selection must leave the previous integration config unchanged"
        );
        assert!(
            !settings_file.exists(),
            "an invalid selection must not persist the don't-ask setting"
        );

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn unavailable_x11_integration_is_not_offered_or_accepted() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_x11_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        let dialog_args = settings.path().join("dialog-args");
        let original_config = "{\n  \"enabled\": [\"alpha\"],\n  \"disabled\": []\n}\n";
        std::fs::write(&integration_config, original_config).unwrap();
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("CHATGPT_TEST_DIALOG_ARGS_FILE", &dialog_args);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        let (_dialog, fake_path) =
            fake_dialog("zenity", "x11-ewmh-computer-use\n__dont_ask_again__", 0);
        let previous_path = std::env::var_os("PATH");
        let mut joined_path = fake_path.clone();
        if let Some(path) = &previous_path {
            joined_path.push(":");
            joined_path.push(path);
        }
        std::env::set_var("PATH", &joined_path);

        run_pick_integrations(&config, &paths, false).unwrap();

        assert_eq!(
            std::fs::read_to_string(&integration_config).unwrap(),
            original_config,
            "an unavailable X11 selection must leave the previous integration config unchanged"
        );
        assert!(
            !std::fs::read_to_string(&dialog_args)
                .unwrap()
                .contains("x11-ewmh-computer-use"),
            "an unavailable X11 integration must not be offered"
        );
        assert!(
            !settings_file.exists(),
            "an unavailable selection must not persist the don't-ask setting"
        );

        if let Some(path) = previous_path {
            std::env::set_var("PATH", path);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("CHATGPT_TEST_DIALOG_ARGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn unavailable_existing_x11_selection_is_repaired_by_successful_picker() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_x11_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        let dialog_args = settings.path().join("dialog-args");
        let original_config = concat!(
            "{\n",
            "  \"enabled\": [\"alpha\", \"x11-ewmh-computer-use\"],\n",
            "  \"disabled\": [],\n",
            "  \"settings\": {\"ui-tweaks\": {\"dockIcon\": {\"enabled\": false}}}\n",
            "}\n"
        );
        std::fs::write(&integration_config, original_config).unwrap();
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("CHATGPT_TEST_DIALOG_ARGS_FILE", &dialog_args);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        let (_dialog, fake_path) = fake_dialog("zenity", "alpha", 0);
        let previous_path = std::env::var_os("PATH");
        let mut joined_path = fake_path.clone();
        if let Some(path) = &previous_path {
            joined_path.push(":");
            joined_path.push(path);
        }
        std::env::set_var("PATH", &joined_path);

        run_pick_integrations(&config, &paths, false).unwrap();

        assert!(
            !std::fs::read_to_string(&dialog_args)
                .unwrap()
                .contains("x11-ewmh-computer-use"),
            "the picker must not offer an unavailable X11 integration"
        );
        let repaired: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&integration_config).unwrap()).unwrap();
        assert_eq!(repaired["enabled"], serde_json::json!(["alpha"]));
        assert_eq!(
            repaired["disabled"],
            serde_json::json!(["x11-ewmh-computer-use"])
        );
        assert_eq!(
            repaired["settings"],
            serde_json::json!({"ui-tweaks": {"dockIcon": {"enabled": false}}})
        );

        if let Some(path) = previous_path {
            std::env::set_var("PATH", path);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("CHATGPT_TEST_DIALOG_ARGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn retained_x11_helper_makes_integration_available_to_picker() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_x11_catalog_script(root.path());
        write_x11_prebuilt_helper(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        let dialog_args = settings.path().join("dialog-args");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("CHATGPT_TEST_DIALOG_ARGS_FILE", &dialog_args);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        let (_dialog, fake_path) = fake_dialog("zenity", "x11-ewmh-computer-use", 0);
        let previous_path = std::env::var_os("PATH");
        let mut joined_path = fake_path.clone();
        if let Some(path) = &previous_path {
            joined_path.push(":");
            joined_path.push(path);
        }
        std::env::set_var("PATH", &joined_path);

        run_pick_integrations(&config, &paths, false).unwrap();

        assert!(
            std::fs::read_to_string(&dialog_args)
                .unwrap()
                .contains("x11-ewmh-computer-use"),
            "a retained trusted X11 helper must make the integration available"
        );
        let saved = serde_json::from_str::<serde_json::Value>(
            &std::fs::read_to_string(settings.path().join("port-integrations.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            saved["enabled"],
            serde_json::json!(["x11-ewmh-computer-use"])
        );

        if let Some(path) = previous_path {
            std::env::set_var("PATH", path);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("CHATGPT_TEST_DIALOG_ARGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn selection_writes_integration_config_outside_wrapper_src() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_fake_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        // Pin settings.json (and thus integration_config_path) into a temp dir.
        let settings_file = settings.path().join("settings.json");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        // zenity selects beta + alpha (no sentinel).
        let (_d, fake_path) = fake_dialog("zenity", "beta\nalpha", 0);
        let prev_path = std::env::var_os("PATH");
        let mut joined = fake_path.clone();
        if let Some(prev) = &prev_path {
            joined.push(":");
            joined.push(prev);
        }
        std::env::set_var("PATH", &joined);

        run_pick_integrations(&config, &paths, false).unwrap();

        // integration_config_path is alongside settings.json, NOT under wrapper-src.
        let written = settings.path().join("port-integrations.json");
        assert!(written.is_file(), "integration config must be written");
        assert!(!root.path().join("port-integrations.json").exists());
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&written).unwrap()).unwrap();
        let enabled: Vec<String> = value["enabled"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(enabled, vec!["alpha".to_string(), "beta".to_string()]);
        assert_eq!(
            value["disabled"].as_array().unwrap(),
            &Vec::<serde_json::Value>::new()
        );
        // Picker-on-update setting untouched (no sentinel selected).
        let settings_json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings_file).unwrap_or_default())
                .unwrap_or(serde_json::json!({}));
        assert!(settings_json
            .get("chatgpt-linux-integration-picker-on-update")
            .is_none());

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn first_picker_write_preserves_packaged_settings() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_fake_catalog_script(root.path());
        let packaged_config = root.path().join(".chatgpt-linux/port-integrations.json");
        std::fs::create_dir_all(packaged_config.parent().unwrap()).unwrap();
        std::fs::write(
            &packaged_config,
            r#"{
  "enabled": ["alpha"],
  "disabled": [],
  "settings": {
    "pet-overlay": {
      "petOverlay": {
        "gravity": "bottom-right"
      }
    }
  }
}
"#,
        )
        .unwrap();
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        let user_config = settings.path().join("port-integrations.json");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        let (_d, fake_path) = fake_dialog("zenity", "beta\nalpha", 0);
        let prev_path = std::env::var_os("PATH");
        let mut joined = fake_path.clone();
        if let Some(prev) = &prev_path {
            joined.push(":");
            joined.push(prev);
        }
        std::env::set_var("PATH", &joined);

        run_pick_integrations(&config, &paths, false).unwrap();

        let value = serde_json::from_str::<serde_json::Value>(
            &std::fs::read_to_string(&user_config).unwrap(),
        )
        .unwrap();
        assert_eq!(
            value["settings"],
            serde_json::json!({
                "pet-overlay": {
                    "petOverlay": {
                        "gravity": "bottom-right"
                    }
                }
            })
        );

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn selection_preserves_unknown_existing_integration_ids() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_fake_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        let integration_config = settings.path().join("port-integrations.json");
        std::fs::write(
            &integration_config,
            r#"{
  "enabled": ["alpha", "private-local-integration"]
}
"#,
        )
        .unwrap();
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        let (_d, fake_path) = fake_dialog("zenity", "beta", 0);
        let prev_path = std::env::var_os("PATH");
        let mut joined = fake_path.clone();
        if let Some(prev) = &prev_path {
            joined.push(":");
            joined.push(prev);
        }
        std::env::set_var("PATH", &joined);

        run_pick_integrations(&config, &paths, false).unwrap();

        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&integration_config).unwrap()).unwrap();
        let enabled: Vec<String> = value["enabled"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            enabled,
            vec!["beta".to_string(), "private-local-integration".to_string()]
        );
        let disabled: Vec<String> = value["disabled"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        assert_eq!(disabled, vec!["alpha".to_string()]);

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn dont_ask_sentinel_writes_setting() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_fake_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        // Selection includes the sentinel + alpha.
        let (_d, fake_path) = fake_dialog("zenity", "alpha\n__dont_ask_again__", 0);
        let prev_path = std::env::var_os("PATH");
        let mut joined = fake_path.clone();
        if let Some(prev) = &prev_path {
            joined.push(":");
            joined.push(prev);
        }
        std::env::set_var("PATH", &joined);

        run_pick_integrations(&config, &paths, false).unwrap();

        let written = settings.path().join("port-integrations.json");
        let value: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&written).unwrap()).unwrap();
        let enabled: Vec<String> = value["enabled"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();
        // Sentinel stripped, only real integration id remains.
        assert_eq!(enabled, vec!["alpha".to_string()]);
        assert_eq!(
            value["disabled"].as_array().unwrap(),
            &Vec::<serde_json::Value>::new()
        );
        let settings_json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings_file).unwrap()).unwrap();
        assert_eq!(
            settings_json["chatgpt-linux-integration-picker-on-update"],
            serde_json::Value::Bool(false)
        );

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn cancel_leaves_config_unchanged() {
        let _g = env_lock();
        let root = tempdir().unwrap();
        let settings = tempdir().unwrap();
        write_fake_catalog_script(root.path());
        let config = base_config(root.path());
        let paths = runtime_paths(root.path());

        let settings_file = settings.path().join("settings.json");
        std::env::set_var("CHATGPT_LINUX_SETTINGS_FILE", &settings_file);
        std::env::set_var("DISPLAY", ":99");
        std::env::remove_var("WAYLAND_DISPLAY");

        // Nonzero exit = cancel.
        let (_d, fake_path) = fake_dialog("zenity", "", 1);
        let prev_path = std::env::var_os("PATH");
        let mut joined = fake_path.clone();
        if let Some(prev) = &prev_path {
            joined.push(":");
            joined.push(prev);
        }
        std::env::set_var("PATH", &joined);

        run_pick_integrations(&config, &paths, false).unwrap();
        assert!(
            !settings.path().join("port-integrations.json").exists(),
            "cancel must not write a integration config"
        );

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
        std::env::remove_var("CHATGPT_LINUX_SETTINGS_FILE");
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn dialog_tool_requires_executable_file() {
        let _g = env_lock();
        let dir = tempdir().unwrap();
        let zenity = dir.path().join("zenity");
        std::fs::write(&zenity, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&zenity, std::fs::Permissions::from_mode(0o644)).unwrap();
        let prev_path = std::env::var_os("PATH");
        std::env::set_var("PATH", dir.path());

        assert_eq!(dialog_tool(), None);

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
    }

    #[test]
    fn dialog_launch_error_is_a_cancelled_picker() {
        let _g = env_lock();
        let dir = tempdir().unwrap();
        let zenity = dir.path().join("zenity");
        std::fs::write(&zenity, "#!/missing/interpreter\n").unwrap();
        std::fs::set_permissions(&zenity, std::fs::Permissions::from_mode(0o755)).unwrap();
        let prev_path = std::env::var_os("PATH");
        std::env::set_var("PATH", dir.path());

        let catalog = vec![CatalogEntry {
            id: "alpha".to_string(),
            title: "Alpha".to_string(),
            default_enabled: false,
            requires: Vec::new(),
            conflicts: Vec::new(),
        }];
        let enabled = std::collections::HashSet::new();
        let result = show_picker(&DialogTool::Zenity, &catalog, &enabled).unwrap();
        assert_eq!(result, None);

        if let Some(prev) = prev_path {
            std::env::set_var("PATH", prev);
        }
    }
}
