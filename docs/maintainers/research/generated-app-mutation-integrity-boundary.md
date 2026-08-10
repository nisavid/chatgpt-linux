# Generated-App Mutation Integrity Boundary

Status: Gates 2 and 5 implemented; Gates 3 and 4 planned

Date: 2026-07-31

Updated: 2026-08-10

## Decision

Use one descriptor-relative filesystem capability backed by a small,
standalone Rust broker. The Node patch runner opens the generated-tree root
once, verifies that descriptor, and passes it to the broker as child file
descriptor 3. The broker must never accept or reopen an absolute root path.

The broker uses `openat2(2)` with `RESOLVE_BENEATH`,
`RESOLVE_NO_SYMLINKS`, `RESOLVE_NO_MAGICLINKS`, and `RESOLVE_NO_XDEV` when the
host kernel supports it. It falls back to a component-by-component
`openat(2)` walk only when the installer has proved that the candidate is a
private tree with an enforced exclusive-writer invariant: no hostile process
can rename or mutate the tree, and no hostile actor can alter this process's
mount namespace. Otherwise, lack of `openat2` must fail closed.

Existing-file replacement uses a same-parent temporary regular file and
`renameat2(RENAME_EXCHANGE)`. The broker then validates the displaced object
against the identity and digest returned by the earlier read before unlinking
it. New-file creation remains a later protocol extension. Any path,
identity, protocol, or syscall-integrity failure poisons the whole candidate,
aborts further mutation, and makes promotion impossible regardless of the
individual patch descriptor's optional/required policy.

This choice provides the required Linux primitives without loading native code
into Node, and it keeps the unsafe syscall boundary in a testable process
written in a memory-safe language. Rust's ownership rules are designed to
enforce memory safety
([The Rust Programming Language, ownership](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html)).
The `rustix` crate exposes descriptor-relative `openat2` and `renameat2`
wrappers and the relevant resolve flags directly
([`openat2`](https://docs.rs/rustix/latest/rustix/fs/fn.openat2.html),
[`renameat_with`](https://docs.rs/rustix/latest/rustix/fs/fn.renameat_with.html),
[`ResolveFlags`](https://docs.rs/rustix/latest/rustix/fs/struct.ResolveFlags.html)).

Source and Nix builds compile the broker once. Native packages copy that exact
build-only binary and its generation-bound digest into the update-builder's
`prebuilt-helpers/` lane. Updater rebuilds require the validated prebuilt broker
instead of compiling it or resolving an interpreter through the cleared rebuild
environment. The package staging and updater builder carry regular executable
helpers through that lane
([`scripts/lib/package-common.sh`](../../../scripts/lib/package-common.sh),
[`updater/src/builder.rs`](../../../updater/src/builder.rs)). The broker is not
an app runtime service and is not copied into `/opt/chatgpt` or exposed as a
user command.

## Implemented Boundary And Remaining Scope

Gates 2 and 5 are current behavior:

- The Node patch runner opens and verifies the private generated-tree root once,
  passes it to the broker as file descriptor 3, and runs the trusted broker
  executable through an inherited descriptor with an empty environment.
- Central main-bundle and webview-asset discovery, reads, and replacements use
  the mutation capability. Each read returns identity, SHA-256 digest, and a
  single-use opaque token bound to the original relative path and broker
  process. Replacement revalidates before and after atomic exchange.
- Any broker, protocol, lookup, identity, token, or replacement-integrity
  failure poisons the capability, stops later descriptor and staging work,
  records a generic integrity failure, exits the child build nonzero, and blocks
  promotion even when acceptance override was requested.
- Replacement preserves the source permission mode and nanosecond modification
  time. Targets with extended attributes are rejected rather than silently
  losing metadata.
- `install.sh` creates the sibling candidate as an owned, non-symlink `0700`
  directory before population. The inner build preserves and revalidates that
  root even under `--fresh`. Rejected candidates remain private or are removed.
  After integrity and official-DMG acceptance, the outer transaction revalidates
  the root, changes it to `0755`, and uses the existing recovery journal and
  atomic directory exchange for promotion.

The broker is build-only. Source and Nix builds may compile it; native packages
stage the exact executable and its generation-bound digest under the
update-builder's `prebuilt-helpers/` lane. Packaged updater rebuilds validate
and use only that prebuilt helper. No broker is installed in `/opt/chatgpt` or
exposed as a user command.

Gates 3 and 4 remain planned. Extracted-app descriptor callbacks still receive
the raw extracted-tree path. Declarative resource copies and shell stage/cleanup
hooks still mutate through pathname APIs. The repository therefore claims
capability mediation only for the central main-bundle and webview path, not for
every generated-tree mutation
([`scripts/patches/runner.js`](../../../scripts/patches/runner.js),
[`scripts/patches/lib/assets.js`](../../../scripts/patches/lib/assets.js),
[`scripts/patches/engine.js`](../../../scripts/patches/engine.js),
[`scripts/lib/port-integrations.js`](../../../scripts/lib/port-integrations.js),
[`scripts/lib/port-integrations.sh`](../../../scripts/lib/port-integrations.sh)).

## Required Invariants

### Root acquisition

The Gate-2 Node parent:

1. opens the root with `O_RDONLY | O_DIRECTORY | O_NOFOLLOW`;
2. uses `fstat` to require a directory owned by the build UID;
3. requires a private root with no group or other permission bits;
4. keeps the descriptor open for the central main-bundle and webview phase; and
5. passes it to the broker as `stdio[3]`, never as a pathname.

It also opens and validates the broker as a trusted executable descriptor,
executes it through `/proc/self/fd/5`, sets its working directory to `/`, and
passes an empty environment.

Node 22 exposes `O_DIRECTORY` and `O_NOFOLLOW`, while its documented `fs.open`
shape takes a pathname rather than a directory descriptor
([Node 22 `fs.open`](https://nodejs.org/docs/latest-v22.x/api/fs.html#fsopenpath-flags-mode-callback),
[Node 22 filesystem constants](https://nodejs.org/docs/latest-v22.x/api/fs.html#file-open-constants)).
Node's child-process contract maps each `stdio` array index to the same-numbered
child file descriptor and permits an open parent descriptor to be supplied as
a positive integer, so `stdio[3] = rootFd` gives the broker a stable root at
FD 3
([Node 22 `options.stdio`](https://nodejs.org/docs/latest-v22.x/api/child_process.html#optionsstdio)).

Linux documents a directory FD as a stable reference that is specifically
intended to avoid pathname-prefix races. A relative `openat` path is resolved
from that descriptor rather than the process working directory
([`openat(2)`, rationale and semantics](https://man7.org/linux/man-pages/man2/open.2.html)).

### Relative path grammar

Broker operations accept only a byte-preserving relative component sequence.
They reject:

- absolute paths;
- empty components;
- `.` and `..`;
- embedded NUL bytes;
- a caller-supplied `/proc/self/fd` or other alternate root;
- any symlink, magic link, non-directory intermediate component, or unexpected
  final file type.

`O_NOFOLLOW` protects only the final component. `openat2`'s
`RESOLVE_NO_SYMLINKS` covers every component, `RESOLVE_BENEATH` rejects escape
above the supplied directory FD, and `RESOLVE_NO_XDEV` rejects mount-point
crossing
([`open(2)`, `O_NOFOLLOW`](https://man7.org/linux/man-pages/man2/open.2.html),
[`openat2(2)`, resolve flags](https://man7.org/linux/man-pages/man2/openat2.2.html)).

### Preferred lookup and portable fallback

The preferred lookup is:

```text
openat2(root_fd, relative_path,
        O_RDONLY | O_NOFOLLOW | O_CLOEXEC,
        RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS |
        RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV)
```

`openat2` is Linux-specific and first appeared in Linux 5.6. Glibc does not
provide a wrapper, so direct syscall or a crate wrapper is required
([`openat2(2)`, history and synopsis](https://man7.org/linux/man-pages/man2/openat2.2.html)).
The broker runtime-probes it rather than inferring support from distro name.

The compatibility path duplicates the root descriptor and opens each
intermediate component relative to the previous descriptor with
`O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`. It rejects a device change and
open the final name relative to the held parent descriptor with
`O_NOFOLLOW | O_CLOEXEC`. `openat` has been available since Linux 2.6.16 and is
standardized by POSIX.1-2008
([`open(2)`, history](https://man7.org/linux/man-pages/man2/open.2.html)).

That fallback closes symlink and rename races, but an `st_dev` comparison
cannot distinguish a same-filesystem bind mount. Consequently it is acceptable
only with a verified private candidate, an enforced exclusive-writer invariant
that excludes any hostile writer able to rename or mutate the tree, and no
hostile mount-namespace actor. When those premises are not true, the broker
must report an integrity error rather than silently weaken confinement.
`openat2(RESOLVE_NO_XDEV)` is the enforcement path for that stronger boundary
([`openat2(2)`, `RESOLVE_NO_XDEV`](https://man7.org/linux/man-pages/man2/openat2.2.html)).

### Read identity

Every broker read returns:

- file bytes;
- `st_dev`, `st_ino`, `st_mode`, `st_uid`, `st_gid`, `st_size`, and nanosecond
  modification time;
- a SHA-256 digest of the bytes;
- a broker-generated opaque operation identifier.

The JavaScript descriptor transforms bytes only. It does not receive a writable
path or descriptor. The digest is necessary because inode and timestamp fields
alone do not prove that bytes stayed unchanged.

Directory enumeration also occurs in the broker from an opened directory
FD. The result should be names plus no-follow metadata; each later read must
still reopen and validate the selected name because enumeration is not a lock.

### Atomic replacement

For an existing regular file, the broker does the following:

1. Open the parent directory through the confined lookup.
2. Create a random same-parent temporary file with
   `O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC`.
3. Write the complete replacement, apply the intended mode, and `fsync` it.
4. Atomically exchange the temporary name and target with
   `renameat2(RENAME_EXCHANGE)`.
5. Open the displaced object at the temporary name without following links and
   compare its identity and digest with the read token.
6. If they match, unlink the displaced object and `fsync` the parent directory.
7. If they do not match, leave the candidate poisoned and return an integrity
   failure. Do not treat it as ordinary optional patch drift.

Linux specifies `RENAME_EXCHANGE` as an atomic exchange of two existing names.
It specifies `RENAME_NOREPLACE` as a create-without-overwrite operation, and a
normal same-filesystem rename atomically replaces an existing destination
([`rename(2)` and `renameat2(2)`](https://man7.org/linux/man-pages/man2/rename.2.html)).
`renameat2` has existed since Linux 3.15; filesystem support for individual
flags varies and must be probed, with unsupported operations failing closed
([`rename(2)`, history and flag support](https://man7.org/linux/man-pages/man2/rename.2.html)).

Create, remove, and recursive-copy operations remain future protocol extensions
for Gates 3 and 4. They must retain collision-safe, descriptor-relative
semantics and must never fall back to pathname-based recursive deletion.

An `fsync` on the file does not make the directory entry durable; Linux
requires a separate `fsync` on the containing directory for that guarantee
([`fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html)). The broker
syncs the replacement before exchange and the parent directory after displaced
target validation and removal.

Atomic replacement changes the inode. The current broker preserves the source
permission mode and nanosecond modification time. It rejects extended
attributes rather than silently dropping them. Access time, status-change time,
and inode identity are not preserved.

## Candidate Privacy And Poisoning

The work root uses `mktemp -d`. The outer transaction removes only its bounded
sibling candidate path, recreates it exclusively with mode `0700`, and verifies
that the path is an owned, non-symlink directory with no symlinked components.
The inner build revalidates the root and preserves it under `--fresh` instead of
deleting and recreating it under the process umask. The candidate stays private
through patching and acceptance. Rejection removes it unless diagnostic
retention was requested. Acceptance triggers a final private-root check, then
changes only the root to `0755` before journaled atomic promotion
([`install.sh`](../../../install.sh),
[`scripts/lib/install-helpers.sh`](../../../scripts/lib/install-helpers.sh)).

Privacy is defense in depth, not the mutation authorization mechanism. Mode
`0700` excludes other UIDs, but it does not exclude an active hostile writer
running under the build UID. The manual `openat` fallback is defensible only
when the build also enforces exclusive writer ownership of the candidate and
excludes hostile mount-namespace actors. The inherited root descriptor and
descriptor-relative syscalls remain authoritative.

The patch engine maps ordinary descriptor exceptions through each descriptor's
CI policy. The generated-app integrity error bypasses that fail-soft behavior
([`scripts/patches/engine.js`](../../../scripts/patches/engine.js)). The outer
patch runner:

1. record the integrity operation and generic reason in the out-of-tree patch
   report;
2. stop all later descriptor and staging operations;
3. exit nonzero;
4. keep the transaction's `build_status` at `failure`;
5. ensure the acceptance override cannot promote the candidate.

The transaction permits acceptance override only when the child build status is
`success`, so a broker integrity error blocks that escape hatch
([`install.sh`](../../../install.sh)). The patch report lives in the transaction
report directory outside the candidate, so candidate content cannot clear it.

## Option Comparison

| Option | Integrity primitives | Dependency and isolation | Disposition |
| --- | --- | --- | --- |
| Pure Node `fs` | Can open a root and use `O_NOFOLLOW` on the final component, but the documented Node 22 API has no `dir_fd`, `openat2`, or `renameat2`-flag surface. | No new dependency, but pathname composition remains in the privileged patch process. | Reject as the enforcement primitive. Keep Node as the policy/client layer only. |
| Node native addon | Can call Linux syscalls and Node-API is ABI-stable across Node versions. | Requires native-addon build tooling and loads native memory-unsafe code into the patcher process. Node documents addons as compiled shared objects and documents the additional compiler/tooling requirement ([Node-API](https://nodejs.org/docs/latest-v22.x/api/n-api.html), [C++ addons](https://nodejs.org/docs/latest-v22.x/api/addons.html)). | Reject. The ABI benefit does not outweigh the larger in-process failure domain and addon lifecycle. |
| Python helper | `os.open`, `os.stat`, `os.listdir`, `os.rename`, and `os.replace` support directory descriptors on Unix; `O_NOFOLLOW` is exposed ([Python `os`](https://docs.python.org/3/library/os.html#files-and-directories)). | Python is already a core build prerequisite and a subprocess isolates failures ([build prerequisites](../../usage/build-and-run.md)). Python's standard library does not expose `openat2` resolve flags or `renameat2` exchange/no-replace flags; each invocation also depends on selecting a trusted interpreter. | Viable fallback prototype, not the final boundary. Avoid a security-critical `ctypes` syscall layer and repeated interpreter startup when the Rust workspace can express the same operations directly and package a validated build-time helper. |
| Standalone C helper | Direct access to all required Linux syscalls and can be compiled with the existing C/C++ toolchain. | Small and out of process, but protocol and pathname parsing remain memory-unsafe. | Acceptable emergency fallback only if Rust cannot be made mandatory; require unusually narrow protocol and additional fuzzing. |
| Standalone Rust broker | `rustix` provides owned/borrowed FD types plus `openat2` and `renameat2` wrappers. | Out of process and memory-safe. Rust already exists in the workspace and dependency bootstrap, though making this broker mandatory broadens Rust from updater/optional-helper use into the core app-generation gate ([workspace](../../../Cargo.toml), [build prerequisites](../../usage/build-and-run.md)). | **Chosen and implemented for Gates 1, 2, and 5.** Missing or invalid broker delivery is fatal. |

The broker is a build-time tool, not generated app payload. Building it for the
current host avoids a runtime package ABI promise and keeps Debian, RPM,
pacman, AppImage, and checkout generation on the same source implementation.
Packaged updater rebuilds consume the package-owned prebuilt broker from the
update-builder bundle. That bundle treats `prebuilt-helpers/` as builder-only
payload, copies it into the isolated rebuild workspace, and validates the
broker's regular-file shape, executable mode, ownership boundary, ELF class,
architecture, and exact generated-app digest
([`scripts/lib/package-common.sh`](../../../scripts/lib/package-common.sh),
[`updater/src/builder.rs`](../../../updater/src/builder.rs)). The current build
centralizes package outputs behind app generation and shared staging
([`Makefile`](../../../Makefile),
[`docs/port-architecture.md`](../../port-architecture.md)).

## Broker Contract

The current version-1 protocol is length-prefixed binary stdin/stdout. It
invokes no shell and puts no file content in command-line arguments. Every
request carries:

- protocol version;
- operation (`list`, `read`, or `replace`);
- a verified-private-root fallback flag;
- relative components;
- the single-use read operation ID and replacement bytes for `replace`; and
- bounded payload length.

The destination root is inherited only as file descriptor 3 and is never named
in a request. Every response carries a typed success value or integrity error.
The Node client maps broker infrastructure and integrity errors to the global
poison path; only ordinary descriptor match drift follows `ciPolicy`.

Gate 4 will need an independent inherited source-root descriptor and new
create/remove/copy operations. The current destination capability does not
authorize arbitrary integration source paths.

## Migration Plan

### Gate 1: broker and client — implemented

- The workspace crate and Node client implement the versioned protocol,
  descriptor verification, and inherited-FD plumbing.
- Source and Nix builds compile one build-only broker. Native packages stage the
  same helper and its generation-bound digest; updater rebuilds require that
  validated prebuilt executable. Missing or invalid delivery, protocol mismatch,
  and unsupported required syscall behavior are fatal.
- Clean fixtures retain the existing patch output.

### Gate 2: central patch writes — implemented

- Main-bundle and webview-asset discovery, reads, and replacements use the
  capability.
- Asset helpers return relative components and opaque read tokens rather than
  absolute writable paths.
- Static tests prohibit production `node:fs` mutation in the central patch
  engine and asset helpers.

### Gate 3: extracted-app descriptors — planned

- Replace the raw writable `extractedDir` contract with a frozen capability on
  descriptor context.
- Migrate descriptors in small groups while keeping their match/patch logic
  unchanged.
- Make direct production writes under `scripts/patches/` and Node-based
  `port-integrations/` a repository test failure.

### Gate 4: declarative and package staging — planned

- Give app staging and package staging separate destination-root capabilities.
- Give each integration source directory a separate read-only source-root
  capability.
- Replace recursive `fs.cpSync`/`fs.rmSync` staging with broker operations.
- Migrate shell stage/cleanup hooks to declarative resources or a constrained
  operation manifest before claiming complete coverage.

### Gate 5: candidate enforcement — implemented

- The transaction creates and verifies the private candidate before population,
  and the child preserves and revalidates it under `--fresh`.
- Integrity poison fails the child build and therefore the official-DMG
  acceptance decision and override eligibility.
- Rejection retains mode `0700` or removes the candidate. Accepted candidates
  receive root mode `0755` only after a final private-root check.
- Promotion retains the recovery journal and atomic directory exchange.

## Verification Seams

The implementation has four independent test layers:

1. **Broker tests:** component grammar, link and special-file rejection,
   identity/digest comparison, token binding, mode and modification-time
   preservation, xattr rejection, protocol limits, partial I/O, fallback
   handling, and rename races.
2. **Node tests:** root and executable verification, client poisoning, central
   engine/asset mutation bans, clean-fixture equivalence, and later-stage stop.
3. **Delivery tests:** source freshness, exact digest binding, prebuilt-only
   updater behavior, cross-format update-builder contents, and runtime-payload
   exclusion; Nix evaluates the build-only injection where Nix is available.
4. **Pipeline tests:** broker failure exits the patcher, records a generic
   report entry, produces `build_status=failure`, blocks acceptance override,
   preserves the existing app, and proves candidate population begins at mode
   `0700`.

Filesystem coverage probes `openat2`, `RENAME_EXCHANGE`, and the compatibility
path independently because kernel and filesystem support are separate concerns
([`openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html),
[`rename(2)`](https://man7.org/linux/man-pages/man2/rename.2.html)).

One broker session batches the central operations for a patch run while retaining
the same relative-path and identity-token semantics for each file.

## Residual Risks

- The manual `openat` fallback cannot prove the absence of a same-filesystem
  bind mount. Environments that include a hostile mount-namespace actor need
  `openat2(RESOLVE_NO_XDEV)` and must fail closed without it.
- Replacement preserves mode and nanosecond modification time and rejects
  extended attributes. Access time, status-change time, and inode identity still
  change; targets that require those metadata identities are unsupported.
- An actor that controls the build account or workspace is outside this
  boundary. That actor can alter build inputs, replace the helper before
  execution, or mutate the generated tree, violating the exclusive-writer
  invariant on which the compatibility path depends.
- Extracted-app descriptor callbacks, declarative resource copies, shell hooks,
  and non-Node tools remain alternate mutation paths until Gates 3 and 4 are
  complete.
- `RENAME_EXCHANGE` depends on filesystem support. An unsupported build
  filesystem is a clear compatibility failure, not a reason to fall back to
  check-then-rename. Future create operations will need the same policy for
  `RENAME_NOREPLACE`.
- Candidate privacy does not authenticate the official app input. Signature,
  provenance, and official-DMG acceptance remain separate controls.

## Primary Sources

- Linux man-pages: [`open(2)` and `openat(2)`](https://man7.org/linux/man-pages/man2/open.2.html),
  [`openat2(2)`](https://man7.org/linux/man-pages/man2/openat2.2.html),
  [`rename(2)` and `renameat2(2)`](https://man7.org/linux/man-pages/man2/rename.2.html),
  [`fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html).
- Node.js 22: [`fs`](https://nodejs.org/docs/latest-v22.x/api/fs.html),
  [`child_process`](https://nodejs.org/docs/latest-v22.x/api/child_process.html),
  [Node-API](https://nodejs.org/docs/latest-v22.x/api/n-api.html),
  [C++ addons](https://nodejs.org/docs/latest-v22.x/api/addons.html).
- Python: [`os`](https://docs.python.org/3/library/os.html).
- Rustix: [`openat2`](https://docs.rs/rustix/latest/rustix/fs/fn.openat2.html),
  [`renameat_with`](https://docs.rs/rustix/latest/rustix/fs/fn.renameat_with.html),
  [`ResolveFlags`](https://docs.rs/rustix/latest/rustix/fs/struct.ResolveFlags.html).
- Rust: [ownership and memory safety](https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html).
