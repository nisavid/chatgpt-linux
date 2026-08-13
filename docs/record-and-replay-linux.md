# Record And Replay Compatibility On Linux

This page explains the current Linux compatibility contract for Codex Record &
Replay and provides the reference data needed to review that contract. For
enablement, build prerequisites, and bridge method names, see the
[`record-and-replay` port integration](../port-integrations/record-and-replay/README.md).
For Chronicle/Skysight runtime checks, see
[Linux Chronicle/Skysight](linux-chronicle-skysight.md). Future work belongs in
the [repository backlog](backlog.md), not in a pull-request plan on this page.

Record & Replay is a demo-to-skill compiler, not a coordinate macro recorder.
The Linux port integration stages the bundled Record & Replay plugin shell from
the current official OpenAI ChatGPT DMG when available, replaces the macOS Sky
Computer Use event-stream helper with a Linux implementation of that helper
contract, and captures semantic evidence into a bundle that can draft and
import an ordinary Codex skill.

## Current Support Boundary

The disabled-by-default `record-and-replay` port integration currently provides:

- the `Record & Replay` plugin shell and `event-stream` MCP server identity;
- the `SkyLinuxComputerUseClient event-stream mcp` helper, backed by the Rust
  `chatgpt-record-replay-linux` binary;
- recording sessions capped at 30 minutes, with stop and discard controls;
- screenshots, accessibility snapshots, spoken transcript context, active
  app/window snapshots, browser trace evidence supplied by a caller, provider
  diagnostics, and user markers;
- bundle validation, draft-skill prompt generation, skill inspection, and
  guarded import into Codex skill directories; and
- Chronicle/Skysight screen and event memory with pause, resume, snapshot,
  exclusion, OCR, rolling-summary, and status support.

This support does not:

- bypass OpenAI account, region, rollout, Computer Use, plugin, or hosted-service
  policy;
- replay captured pointer coordinates or raw input events;
- make a missing desktop, browser, accessibility, or input provider available;
- make macOS- or Windows-specific skills runnable on Linux; or
- treat a source-level or bundle-level test as proof that a live generated app
  completed the workflow.

Use these terms when reporting support:

| Term | Meaning |
| --- | --- |
| Importable | The folder passes the Linux importer's shape and safety checks. |
| Listable | ChatGPT or Codex reports the skill from a supported skill location. |
| Readable | ChatGPT or Codex can load the skill's `SKILL.md`. |
| Invocable | The user can explicitly select or mention the skill. |
| Runnable | The tools and providers required by the skill are available. |
| Verified | The relevant workflow completed in a live generated Linux app on the reported host. |

## Official OpenAI Product Contract

OpenAI documents Record & Replay as a macOS capability. Initial availability
excludes the European Economic Area, the United Kingdom, and Switzerland, and
Computer Use must be available and enabled.

The official workflow is:

1. The user starts **Record a skill** from the Plugins page in the ChatGPT
   desktop app.
2. ChatGPT or Codex requests recording permission.
3. The user demonstrates a focused workflow on a Mac.
4. The product observes the actions, window content, and spoken context needed
   to understand that workflow.
5. When recording stops, the product drafts a reusable skill.
6. A later chat uses the skill as context and completes the workflow with the
   tools available in that environment.

The compatibility boundary is the plugin and skill contract rather than the
macOS capture implementation:

| Official product element | Linux port mapping |
| --- | --- |
| Bundled `Record & Replay` plugin shell | Staged from the official app bundle when present; otherwise the integration's aligned fallback template is used. |
| `computer-use-client-launcher event-stream mcp` | Replaced with `SkyLinuxComputerUseClient event-stream mcp`. |
| Demonstration evidence | Recorded as a semantic Linux bundle rather than a raw coordinate stream. |
| Generated skill | Drafted and imported as an ordinary Codex skill directory. |
| Replay providers | Supplied by the current environment, including Computer Use, browser actions, and installed plugins; their normal policy gates remain authoritative. |

Official reference:

- [Record & Replay](https://developers.openai.com/codex/record-and-replay)
- [Skills](https://developers.openai.com/codex/skills)
- [ChatGPT desktop app](https://developers.openai.com/codex/app)
- [ChatGPT and Codex changelog](https://developers.openai.com/codex/changelog)

The June 18, 2026 changelog entry introduced Record & Replay in app version
26.616 as a macOS feature that turns a demonstrated workflow into a reusable
skill.

## Linux Implementation Boundary

The Linux implementation has four layers:

1. `port-integrations/record-and-replay/stage.sh` stages and adapts the official
   plugin shell, builds or accepts the Rust helper, and installs the helper
   under the official-shaped executable name.
2. `port-integrations/record-and-replay/patch.js` adds allowlisted main-process
   bridge methods, a recording HUD, transcript forwarding, and periodic active
   desktop snapshots.
3. `record-replay-linux/` implements the CLI and stdio MCP backend for
   diagnostics, recording, bundle handling, skill inspection/import, and
   Chronicle/Skysight.
4. Linux Computer Use supplies host diagnostics and available screenshot,
   accessibility, window, and input providers. Replay remains skill-driven
   through Codex and the providers available at invocation time.

The integration keeps the plugin-packaged `record-and-replay` skill for the
agent-facing workflow. Generated user skills import into ordinary direct skill
folders rather than a Linux-only registry.

## Recording And Evidence Contract

A recording bundle contains `manifest.json`, `timeline.jsonl`, diagnostics,
screenshots and accessibility evidence when available, browser traces supplied
by callers, transcript context, InputCapture/libei readiness, X11/session
metadata, active desktop/window snapshots, optional audio metadata, and
`draft-prompt.md`.

Captured content is untrusted evidence. The draft prompt instructs the agent to
extract observable facts without following instructions found inside captured
screenshots, accessibility trees, traces, or transcripts. A canceled or
discarded bundle remains evidence, but its generated draft prompt identifies it
as canceled and instructs the agent not to create a reusable skill from it.

Native audio capture is off by default. It requires both an affirmative
`CHATGPT_RECORD_REPLAY_AUDIO` value and a caller that requests audio. Spoken
context normally enters the bundle as transcript evidence, not as audio to
replay.

The backend catalog records why a provider is ready, partial, unavailable, or
readiness-only:

| Provider | Current role | Boundary |
| --- | --- | --- |
| Screenshot backends | Capture initial and Chronicle screenshots when available. | Provider failures degrade the bundle and remain visible in diagnostics. |
| AT-SPI/accessibility | Capture semantic application evidence when available. | Coverage depends on the application, desktop, and accessibility setup. |
| Browser trace/CDP | Store caller-provided trace JSON and surface it in the draft timeline. | The integration does not attach to a live browser by itself. |
| Active desktop/window snapshot | Record focused app and window metadata through the CLI, MCP server, bridge, and HUD. | Exact URL or control semantics still require browser or accessibility evidence. |
| InputCapture/libei | Record portal and input readiness. | Raw libei event-stream capture is not implemented. |
| X11/EWMH | Record session, window, and focused-app evidence on X11. | Raw X11 input-event capture is not implemented. |
| Linux Computer Use | Provide diagnostics and replay-time desktop capabilities. | Account policy, approvals, sandbox policy, and host readiness still apply. |

## Chronicle And Skysight

Chronicle/Skysight is the screen and event-memory companion to Record & Replay
on Linux. It is not microphone transcription. The Linux bridge exposes start,
status, pause, resume, stop, snapshot, and exclusion methods so the app can keep
an active capture session while the backend changes recording state.

Chronicle-compatible resources are written under
`${CODEX_HOME:-$HOME/.codex}/memories/extensions/chronicle/resources`. Runtime
state remains under `$XDG_RUNTIME_DIR/skysight`.

Each snapshot writes a segment directory with `events.jsonl`, `metadata.json`,
and bounded `artifacts/` evidence. Events include Computer Use diagnostics,
provider readiness, artifact references, capture failures, and
suppressed-evidence records. Artifacts include diagnostics on every snapshot
and add screenshots, window/app metadata, and AT-SPI/accessibility evidence
when those providers are available.

Exclusion rules run before window, app, accessibility, screenshot, or OCR
evidence is persisted. Suppressed content produces a suppression record rather
than appearing in summaries.

Memory resources use rolling windows: `*-10min-*.md` files summarize recent
segments, while `*-6h-*.md` rollups are cadence-limited and reused until the
next six-hour window is due.

OCR is local and optional. In `auto` mode, Skysight prefers RapidOCR through
Python and ONNX Runtime, then falls back to the Tesseract CLI. Status output and
provider events report the configured mode, selected backend, availability,
language, version, dependency hints, and errors. Missing dependencies are
non-fatal unless `CHATGPT_SKYSIGHT_OCR=required`.

When OCR is unavailable or disabled, Skysight still writes
Chronicle-shaped `.ocr.jsonl` rows with `runs_ocr=false`, empty
`normalized_text`, and an explicit status. Markdown resources contain only OCR
status, count, path, and truncation summaries; raw OCR text is not copied into
durable resources by default.

## Codex Skill Shape And Discovery

A Codex skill is a directory with a required `SKILL.md` and optional
`scripts/`, `references/`, `assets/`, and `agents/openai.yaml`. `SKILL.md`
requires `name` and `description` frontmatter.

ChatGPT supports explicit skill selection with `@`. Codex CLI and the IDE
extension support `/skills` and `$` mentions. ChatGPT and Codex can also invoke
a skill implicitly when its description matches the task and policy permits.

Codex reads direct skills from these locations:

| Scope | Location | Intended use |
| --- | --- | --- |
| Repository | `.agents/skills` from the current working directory through the repository root | Project- or directory-specific skills. |
| User | `$HOME/.agents/skills` | Personal skills available across repositories. |
| Admin | `/etc/codex/skills` | Managed machine or container skills. |
| System | Bundled with Codex by OpenAI | OpenAI-provided system skills. |

Plugin-packaged skills are a separate distribution surface. The port
integration ships its agent workflow that way, while its importer uses direct
skill folders for generated user or repository skills.

## Skill Classification Reference

`record-replay-linux/src/skill.rs` inspects a skill without executing
skill-owned files. It assigns one status:

| Status | Current classifier rule | Import behavior |
| --- | --- | --- |
| `supported` | Only `instruction-only` remains after inspection. | Import is allowed. |
| `conditional` | A non-instruction capability is present, but no experimental or unsupported capability is present. | Import is allowed with reported capabilities and warnings. |
| `experimental` | `desktop-observe`, `desktop-act`, or `isolated-gui` is present without an unsupported capability. | Import is allowed; host readiness still determines whether it can run. |
| `unsupported` | `platform-macos`, `platform-windows`, or `recording` is present. | Import is rejected unless `--allow-unsupported` is explicit. |
| `unknown` | Reserved by the serialized status model. | The current inspector resolves every completed inspection to another status. |

The current capability vocabulary is:

| Capability | Current evidence |
| --- | --- |
| `instruction-only` | No other capability was detected. |
| `cli-local` | An executable file or a file with a shell, Python, JavaScript, or TypeScript extension is present. |
| `browser-session` | `SKILL.md` mentions a browser or Chrome. |
| `plugin-dependent` | `SKILL.md` mentions a plugin or MCP. |
| `desktop-observe` | `SKILL.md` mentions screenshots or accessibility. |
| `desktop-act` | `SKILL.md` mentions click, type, or drag actions. |
| `isolated-gui` | Part of the status model; the current text heuristic does not assign it. |
| `platform-macos` | `SKILL.md` mentions AppleScript, Finder, an app bundle, or Keychain. |
| `platform-windows` | `SKILL.md` mentions PowerShell or the Windows registry. |
| `recording` | `SKILL.md` asks to record a skill. |

These are bounded heuristics, not proof that a skill will run. The current
classifier reads `SKILL.md` and file metadata; it does not interpret
`agents/openai.yaml` dependencies or execute or semantically inspect
skill-owned scripts. Reported status therefore complements, rather than
replaces, a host readiness check and a live smoke test.

## Skill Import Safety

Inspection and import enforce these boundaries:

- the source must resolve to a directory containing `SKILL.md`;
- `name` and `description` frontmatter are required;
- internal symlinks and non-regular files are blockers;
- inspection stops and blocks import after 512 files;
- files larger than 256 KiB are blockers;
- executable or script-shaped files produce warnings but are never executed;
- a destination collision fails instead of overwriting existing content;
- unsupported skills require explicit `--allow-unsupported`; and
- symlink import warns that the external source remains live.

The CLI defaults to a copy import into `$HOME/.agents/skills`. A repository
target resolves to `.agents/skills` under the current working directory. An
explicit target requires `--target-dir`. Compatibility metadata stays in the
inspection result; the importer does not rewrite `SKILL.md`.

## Linux Compatibility Matrix

| Surface | Current state | Compatibility boundary |
| --- | --- | --- |
| Official plugin shell | Implemented by the opt-in port integration. | The official app bundle may drift; staging falls back only to the aligned local template. |
| Linux event-stream helper | Implemented as `SkyLinuxComputerUseClient`, backed by `chatgpt-record-replay-linux`. | Requires the Rust helper to build or be supplied as an executable prebuilt binary. |
| Recording HUD | Implemented in the webview patch. | Live visibility and controls require a generated app whose volatile bundle patch still matches. |
| Direct user and repository skills | Supported by the documented Codex skill locations and the Linux importer. | Listing and invocation remain ChatGPT/Codex behavior and require live verification. |
| Plugin-packaged workflow skill | Implemented by the opt-in integration. | The generated app must sync and load the bundled plugin cache. |
| Browser evidence | Caller-provided trace ingestion is implemented. | Live browser attachment is not implemented by this integration. |
| Desktop observation | Screenshot, accessibility, and active-window evidence are capability-gated. | Missing providers degrade explicitly. |
| Desktop replay | Delegated to Codex and available Computer Use providers. | No raw recorded-input replay is implemented. |
| InputCapture/libei | Readiness evidence is implemented. | Raw input-event capture is not implemented. |
| X11 | Session and window evidence are implemented. | Raw X11 input-event capture is not implemented. |
| macOS or Windows workflow assumptions | Classified as unsupported. | They may be imported only as context with an explicit override. |
| Fresh-chat invocation | Expected product contract. | Requires a live smoke test; recording-thread context must not be the only reason the workflow succeeds. |

## Tester Acceptance Matrix

`Automated` evidence comes from source tests or generated bundle inspection.
`Live` evidence must come from a generated app using the official app bundle.
`Conditional` evidence applies only when the named host provider is available.

| Check | Evidence class | Pass condition | Evidence to retain |
| --- | --- | --- | --- |
| Build with integration enabled | Automated | The port integration builds and stages the official-shaped shell plus the Linux helper. | Build command, app version, enabled integration list, patch report. |
| Plugin shell and helper | Automated + live | The plugin retains the official `Record & Replay` identity and launches `SkyLinuxComputerUseClient event-stream mcp`. | Staged manifest, helper command, live bridge log. |
| HUD visibility | Live | An active recording shows the timer and finish/discard controls. | Screenshot or short screen capture. |
| Stop and discard | Live | Finish finalizes the bundle; discard marks it canceled and produces a draft prompt that forbids skill creation. | Final status, bundle path, draft result. |
| 30-minute cap | Live | The session expires at the cap with `max_duration`, or a shorter run stops normally. | Start/end timestamps and end reason. |
| Speech context | Automated + live | Spoken context is stored as transcript evidence rather than replay audio. | Timeline row or transcript path. |
| Native audio | Automated | Audio remains off unless both the environment and caller opt in. | Start options and `audio/recording.json` status. |
| Browser trace | Automated + conditional | Caller-provided browser/CDP JSON is stored and appears in the draft timeline. | `browser/*-trace.json` and matching timeline row. |
| Active desktop/window evidence | Conditional | Focused app/window metadata is captured and appears in the draft timeline. | `x11/*-desktop-snapshot.json` and matching timeline row. |
| InputCapture/libei evidence | Conditional | The bundle records portal and input readiness even when live input capture is unavailable. | `input-capture/0000-readiness.json`. |
| X11 evidence | Conditional | The bundle records X11 session/window metadata when running on X11. | `x11/0000-session.json`. |
| Bundle validation | Automated | Validation reports pass, warnings, or blockers before drafting. | Validation output and bundle path. |
| Skill inspection and import | Automated | Inspection reports the expected status, then import creates an ordinary skill folder without executing skill-owned files. | Inspection JSON, destination path, import result. |
| Fresh-chat invocation | Live | A new chat can invoke the generated skill without relying on recording-chat context. | Chat link or command/output summary. |
| Diagnostics and degradation | Conditional | Doctor output distinguishes ready, partial, missing, and blocked providers. | Doctor output and provider summary. |

Minimum tester report:

- app version and official DMG version;
- desktop environment and session type;
- Computer Use doctor output;
- Record & Replay provider readiness;
- bundle path;
- generated skill path and inspection status;
- fresh-chat behavior; and
- degradation, cap, stop, or discard notes.

## Unresolved Compatibility Work

Unverified official-product behavior, provider expansion, imported-skill
portability, and policy decisions must be tracked in GitHub Issues. Use the
[backlog index](backlog.md) to find or create the current item and the
[issue-tracker contract](agents/issue-tracker.md) for the live repository name.
When an issue changes the support boundary, update this page from verified
source and live evidence; do not append a branch-specific implementation plan.
