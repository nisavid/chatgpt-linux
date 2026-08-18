# Rollback Evidence Retention Boundary

Checked: 2026-08-18

## Scope

This note inventories the rollback and historical value that remains after the
accepted switch from the tagged ChatGPT for Linux fallback to CachyOS's
validated native repackage. It distinguishes unique recovery data from compact
evidence and records release milestones for the accepted staged sunsetting
contract. It does not authorize deletion, package changes, service changes, or
repository archival.

The mechanical switch is accepted: the validated native repackage is the only
accepted native ChatGPT producer, while the separately installed Nativefier
wrapper remains a redundant cleanup target. The preserved profile and account
state were accepted, the canonical desktop launcher relaunched successfully,
pacman is the only package-update authority, and the independent Codex CLI
continued through the switch. The accepted host evidence is recorded in the
[`arch-pkgs` switch report](https://github.com/nisavid/arch-pkgs/issues/32#issuecomment-5315670607).

Host inventory below is deliberately sanitized. It records categories, sizes,
and digests without local account names, machine-specific storage paths, task
identifiers, credentials, or profile contents.

## Release milestones

- **M0 — mechanical acceptance:** the two-transaction switch, profile reuse,
  launcher relaunch, package ownership, update authority, and Codex CLI
  continuity are accepted. This milestone is complete.
- **M1 — essential parity:**
  [the parity audit](https://github.com/nisavid/chatgpt-linux/issues/146) finds no
  essential product, security, privacy, state-integrity, launch, URI, browser,
  Computer Use, update, or recovery blocker.
- **M2 — settled producer:**
  [the disposition decision](https://github.com/nisavid/chatgpt-linux/issues/148)
  selects the validated native repackage as the settled producer.
- **M3 — routine package lifecycle:** the first normal signed CachyOS package
  upgrade beyond `26.810.52044-1` completes through an ordinary unpinned system
  upgrade. After that upgrade, one reboot plus launcher and pinned-entry launch,
  profile/history/settings, URI handoff, and Codex CLI continuity checks pass
  without unexplained state loss or corruption. This gate is tracked by the
  downstream
  [`arch-pkgs` M3 ticket](https://github.com/nisavid/arch-pkgs/issues/76).
  The recipe advanced repeatedly during the days before this review, so this
  should be observable without an artificial hold
  ([package history through `a09deb2`](https://github.com/CachyOS/cachyos-aur-derived/commits/a09deb22c33c5be84ce42e9fb2299e4f57326d68/chatgpt-desktop-bin),
  retrieved 2026-08-18).
- **M4 — explicit evidence release and fork-state cleanup:** after M3, execute
  the downstream
  [`arch-pkgs` cleanup ticket](https://github.com/nisavid/arch-pkgs/issues/77)
  with freshly verified targets and deletion authority. The
  [sunsetting decision](https://github.com/nisavid/chatgpt-linux/issues/149#issuecomment-5325243686)
  already establishes this staged boundary; nothing in this research note
  substitutes for the later target-specific cleanup gate.

An elapsed-time soak is not an equivalent substitute for M3: the normal package
upgrade is the remaining lifecycle transition that mechanical acceptance has
not exercised. If no newer package arrives, M3 remains open; the fallback does
not expire automatically after an arbitrary number of days. The large recovery
snapshot is on an encrypted filesystem, but capacity pressure alone does not
release contract-held rollback evidence or weaken this gate.

The [current Wayfinder contract](https://github.com/nisavid/chatgpt-linux/issues/145)
expressly removed the persistent `IgnorePkg` hold and permits routine CachyOS
upgrades. [`CONTEXT.md`](../../../CONTEXT.md) and the
[package-runtime maintenance procedure](../package-runtime-maintenance.md) now
carry the same steady-state policy, so no conflicting pinned-candidate operator
guidance remains.

## Retention matrix

| Item | Capability or historical value | Independently reproducible? | Earliest safe disposition |
| --- | --- | --- | --- |
| Exact fallback package | Reinstalls the one binary whose source, archive bytes, payload, and host behavior passed the complete fallback gate. It is the only accepted native producer rollback that does not depend on rebuilding or selecting by version. | No. The source tag and public tuple are inspectable, but the accepted package is not a public binary release and cannot be reconstructed from Git or a matching version alone. | Keep one exact copy through M3. Delete executable copies only during M4 through their owning storage and package-repository workflows. |
| Fallback verification sidecars | Preserve the payload manifest, verification record, generation decision, and build information that authenticate and explain the accepted package. The four files total about 6.2 MiB. | The public tag, baseline tuple, and CI are independently inspectable; the fuller private audit record is not wholly public. Sidecars cannot restore deleted package bytes. | Keep with the package through M3. During M4, retain the sanitized provenance and, if their contents remain appropriate for private archival, the four small sidecars indefinitely. |
| Staged and published copies of the exact fallback | Make the same accepted bytes installable from the local package repository. | They are byte-identical duplicates, not independent evidence. | One authoritative exact package plus its verification set is sufficient while rollback is supported. Remove redundant repository copies only through a reviewed repository update so indexes and retention policy remain coherent. |
| Accepted previous whole pacman repository | Enables reversal of a repository publication as a unit. Its older ChatGPT producer is superseded by both the exact fallback and the validated native repackage. | Package files may not be reproducible, but this whole-repository snapshot no longer provides the designated ChatGPT rollback. | Eligible for disposal now: [publisher policy](https://github.com/nisavid/arch-pkgs/blob/4950ea1f7531cf9485516e96473c7ab804ece706/docs/usage/local-repo.md#L103-L109) retains the previous repository only until the new installation is accepted, and M0 is complete. This does not release the exact fallback set. |
| Pre-official recovery snapshot | Restores selected pre-switch shared profile and Codex state, fallback state/configuration, package inventory, and migration evidence if the switch caused demonstrated corruption. It is not an automatic package rollback image. | No. Manifests authenticate captured bytes, but evolving user state cannot be reconstructed. | Keep through M3. Delete the archive during M4; retain only a compact non-sensitive record of its digest, purpose, creation date, and disposition. Any later producer switch must capture newer live state first. |
| Shared ChatGPT profile and durable Codex state | Supplies the live profile, account continuity, and Codex tasks used by both producers. | No. This is current user data, not fallback evidence. | Retain normally. Never delete or archive it as part of fallback sunsetting. |
| Small fork settings, migration state, updater state, masks, and service override | Supports diagnosis and a controlled fallback reinstall. Masks prevent an obsolete updater from becoming a second update authority; the temporary service override works around the accepted fallback's launch defect. | Updater binaries and units are reproducible from the tag. User settings and operational state are not. | Keep while exact fallback return remains supported. After the fallback package and unit are gone under M4, preserve only any deliberately chosen settings export or compact journal, then remove fork-only runtime state in dependency order. |
| Generated scratch, caches, and logs | Avoids regeneration cost only. The switch contract excludes caches, temporary data, IPC, locks, generated worktrees, and scratch from recovery. | Yes, or disposable by definition. | May be removed whenever no build, updater, app, or task writer uses it. This needs no Wayfinder milestone and belongs to the separate host-capacity task. |
| Open fallback defect and repair PR | [Issue 143](https://github.com/nisavid/chatgpt-linux/issues/143) records the accepted baseline's repeated scan, launch latency, updater timeout, and workaround. [PR 144](https://github.com/nisavid/chatgpt-linux/pull/144) supplies a reviewed source repair. | The defect and repair are reproducible in source. Merging the repair does not change the already retained package. | The owner selected retirement rather than another fallback build. Close the issue and PR transparently with contributor credit during pre-archive tracker disposition, and carry removal of the temporary workaround into M4. |
| Nativefier ChatGPT package | Provides a third ChatGPT web wrapper and desktop entry, but no accepted package rollback, native/Codex capability, or unique shared state. | The public AUR recipe is rebuildable. The installed unsigned package is not attested, and its separate wrapper profile is user data. | It is not rollback evidence and may be uninstalled now. Preserve its profile briefly unless deletion of that user data is separately authorized. |
| Public source repository, fallback tag, issues, and compact provenance | Preserves implementation and review history, exact source identity, hashes, validation links, known defect, and the retirement rationale. | Yes, subject to continued availability of GitHub and linked Actions metadata. | Retain indefinitely. Archive after the active downstream package lane is withdrawn, the retirement notice is published, and the remaining issues and pull requests are dispositioned. Keep delayed M3/M4 ownership live in `arch-pkgs`; do not wait for those milestones or delete the repository or tag. |

## Exact fallback: operational bytes versus compact evidence

The annotated but unsigned
[`fallback-baseline-2026-08-16`](https://github.com/nisavid/chatgpt-linux/tree/fallback-baseline-2026-08-16)
tag targets commit `dd3d1397f544752ea1170af8393cd59379373f52`.
The accepted Arch record binds that source to:

- `chatgpt 26.810.52044-1`, 444,280,902 bytes;
- package SHA-256
  `678cb85152895eeed112428df110bd85b5b713fc26db03c12d9e2e120985340b`;
- a 21,400-entry payload manifest with file SHA-256
  `aacc65bd3837f2d9eef5c21205a197292bad3b05a3d0e80b50f627a8b09736ef`;
- verification-record SHA-256
  `b7761927b93f4164cf34c40d5e789d16e8b2b2325a83a9a77565bdcdbd64e923`;
  and
- successful
  [exact-main CI](https://github.com/nisavid/chatgpt-linux/actions/runs/31972793550)
  and
  [scheduled official-DMG validation](https://github.com/nisavid/chatgpt-linux/actions/runs/31973993376).

Those facts are recorded in the path-free
[`arch-pkgs` baseline](https://github.com/nisavid/arch-pkgs/blob/4950ea1f7531cf9485516e96473c7ab804ece706/packages/chatgpt/fallback-baseline-2026-08-16.json)
and its
[ingest contract](https://github.com/nisavid/arch-pkgs/blob/4950ea1f7531cf9485516e96473c7ab804ece706/packages/chatgpt/README.md).
The ingest contract rejects a rebuild or version-only selection: verification
starts from the retained package and record, snapshots them, recomputes the
stream manifest, and compares the complete tuple. The source project does not
redistribute the official bundle, and the tag expressly is not a public binary
release. Public hashes can reject a wrong archive but cannot recreate the right
one. Deleting every exact copy therefore ends immediate rollback permanently.

The authoritative transition-retention package, checkout staging copy, and
published local-repository copy rehash to the accepted digest. The latter two
are distribution conveniences, not independent evidence. One exact package
with the four sidecars is sufficient while rollback remains supported.

After M3 and M4, historical value no longer requires the 424 MiB package or its
duplicates. Keep the public tag, path-free baseline JSON, sanitized package
provenance, this note, CI links, and tracker history. The four private sidecars
are only about 6.2 MiB and preserve a fuller audit trail, so retaining them is
reasonable if a final content review finds no sensitive material. Their
retention documents the former package; it does not preserve reinstallability.

Remove binary copies through each owning package-repository or transition
workflow. Do not manually unlink an indexed package.

## Recovery snapshot: unique but intentionally temporary

The accepted
[switch contract](https://github.com/nisavid/chatgpt-linux/issues/137#issuecomment-5304506396)
requires the initial pre-official snapshot to remain until the sunsetting
decision. It also says rollback preserves newer shared state in a fresh
snapshot and restores the old snapshot only to repair demonstrated corruption
or incompatibility. The durable
[maintenance procedure](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/docs/maintainers/package-runtime-maintenance.md#official-app-evaluation-switch)
implements the same boundary.

The host snapshot is a 6,344,478,750-byte compressed archive with SHA-256
`e9ba0fe20beeac03265c09843ba8fa7b8645f1e4ee34747449b5e155f23b1788`.
Current mount and allocation inspection places it on the encrypted home
filesystem, not the separately mounted `/var/tmp` filesystem. Deleting it would
free about 6 GiB from home, but the accepted sunsetting contract reserves it
through M3; capacity pressure alone does not authorize deletion.
The archive contains filtered shared profile data, selected durable Codex state,
online database backups, fallback state/configuration, fallback and official
package material, and systemd state. Volatile caches, temporary files, locks,
and generated worktrees are excluded. The private state directories are mode
`0700`, and the snapshot and sidecars are mode `0600`. This preserves the switch
contract's access envelope. Its detailed manifest and session-prefix inventory
should remain private.

After M3 passes, the snapshot's sole remaining use would be restoring a stale
point in time after the selected producer has survived its normal update
lifecycle. That is weaker than preserving current state and conflicts with the
rule to snapshot newer state before any later package return. M4 may then delete
the archive and any sidecars that expose sensitive paths or contents. Retain
only the already public archive digest, purpose, creation date, and disposition
record.

## Fork-only state and scratch

The repository's
[state contract](https://github.com/nisavid/chatgpt-linux/blob/dd3d1397f544752ea1170af8393cd59379373f52/CONTEXT.md#shared-operational-state)
distinguishes the shared `Codex` profile and Codex home from port-owned state.
The shared state continues to evolve under the official producer and is not a
cleanup target.

The sanitized host inventory found four classes of port-owned material:

1. Small user-authored settings for port integration modules, Electron flags,
   and local feature configuration. These are cheap to retain until M4 and are the
   only fork settings worth an optional encrypted personal export.
2. A fork-created remote-control device-key file. It is sensitive and unique,
   but it is not historical evidence. Revoke any corresponding enrollment and
   delete the key when the owning integration is retired; never publish or place
   it in a general research archive.
3. About 542 MiB of updater state, caches, logs, the completed migration journal,
   service masks, and the temporary `ExecStartPre` override from issue 143.
   The masks and override matter only while exact fallback return remains
   supported; caches and logs can be cleaned independently when writers are
   quiescent.
4. About 19 GiB of task and build scratch in the fork's temporary tree. It is
   excluded from the recovery snapshot and is not rollback evidence. The
   separately authorized capacity task must clean it writer-aware rather than
   treating fallback sunset as blanket deletion authority.

The masks deserve ordering even though they are tiny: removing them before the
fallback package and unit are retired could allow a stale updater to become a
second authority. Remove the fallback package/repository entry first, prove no
unit or binary remains, remove the override and stale enablement, then remove
the masks and reload the user manager.

## Nativefier is not a retained toolchain

The host carries the explicitly installed `openai-chatgpt-nativefier
37.2.6-1` package, about 283 MiB installed. It owns a second desktop entry named
`ChatGPT` and an executable that opens `https://chatgpt.com/`. It is not the
generic Nativefier command-line tool and keeping this package does not preserve
the ability to wrap arbitrary sites.

The
[reviewed AUR recipe at `a98a1b0`](https://aur.archlinux.org/cgit/aur.git/tree/PKGBUILD?h=openai-chatgpt-nativefier&id=a98a1b0805053616cba223f11f4fd41b4c89aeb7)
builds one ChatGPT-specific wrapper with Electron `37.2.6`, a JavaScript
injection, and no conflict with the canonical `chatgpt` package. The installed
package has no dependents, no recorded repository, no validating packager, and
no attested bytes. Its separate wrapper profile and cache occupy about 1.07 GiB.
Nativefier's own [repository](https://github.com/nativefier/nativefier) is
archived, and its
[last release](https://github.com/nativefier/nativefier/releases/tag/v52.0.0)
was published in August 2023.

The wrapper therefore supplies neither the accepted fallback package nor a
maintained general-purpose toolchain. An ordinary browser remains an equivalent
web-only fallback. Its AUR recipe is sufficient compact historical and
reproducibility evidence. The package may be uninstalled now; preserve its
profile briefly unless deleting that user data is separately authorized.

## Defect disposition and repository closeout

The accepted fallback retains the repeated-scan defect and temporary updater
startup workaround recorded in issue 143. The open repair PR 144 currently
targets commit
[`a2ef27d143a00d67a220a7266a97fd254518ca29`](https://github.com/nisavid/chatgpt-linux/commit/a2ef27d143a00d67a220a7266a97fd254518ca29)
and has clean automated review evidence. Merging it would improve source main
but would not change the retained `dd3d1397…` package.

The owner selected retirement rather than another maintained fallback. Do not
mint a replacement merely to close the defect. Close issue 143 and PR 144
transparently as superseded by the retirement decision, credit the contributor,
and retain the temporary workaround-removal handoff for M4.

Repository archival is a broader closeout than binary retirement. Withdraw the
active downstream fallback lane through the reviewed
[`arch-pkgs` closeout](https://github.com/nisavid/arch-pkgs/issues/75), publish a
retirement notice, and triage the remaining open issues and pull requests. Then
complete the
[archive ticket](https://github.com/nisavid/chatgpt-linux/issues/161) while
retaining this repository's tag, history, research, issue resolutions, and CI
links. M3 and M4 remain live downstream work in `arch-pkgs`; archival
intentionally does not wait for them.

## Recommended boundary

1. Retire the active fallback ingest lane, transactionally withdraw its live and
   redundant repository copies, and uninstall the Nativefier wrapper while
   preserving its profile. These actions use the downstream package and
   publisher workflows; they do not release the designated private fallback
   set or recovery snapshot.
2. Publish the retirement notice, close the remaining tracker transparently,
   and archive this repository while preserving its public history. Keep M3 and
   M4 live in `arch-pkgs`.
3. Keep one exact fallback package with its verification set, the pre-official
   recovery snapshot, and the small fork rollback configuration until M3 passes.
4. After M3, execute the category-by-category M4 cleanup with freshly verified
   targets and explicit deletion authority. Delete the private executable
   fallback bytes and large snapshot, then remove fork-only updater, migration,
   override, stale enablement, mask, credential, and operational residue in
   dependency order.
   Preserve all shared profile and Codex state.
5. Retain compact evidence indefinitely: the archived repository and annotated tag,
   path-free baseline JSON, sanitized provenance, issue resolutions, CI links,
   this note, and—after a content review—the roughly 6.2 MiB verification
   sidecars. These records document the accepted fallback but cannot reinstall
   it.
