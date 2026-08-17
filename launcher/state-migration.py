#!/usr/bin/env python3
"""Move wrapper-owned XDG state from the legacy Codex App identity."""

from __future__ import annotations

import argparse
import ctypes
import errno
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import sys
from pathlib import Path
from typing import Any

JOURNAL_VERSION = 1


class MigrationError(RuntimeError):
    """A migration condition that needs user action."""


def xdg_base(env_name: str, fallback: Path) -> Path:
    value = os.environ.get(env_name)
    path = Path(value) if value else fallback
    if not path.is_absolute():
        raise MigrationError(f"{env_name} must be an absolute path: {path}")
    return path


def migration_paths() -> tuple[list[dict[str, Any]], Path]:
    home_value = os.environ.get("HOME")
    if not home_value:
        raise MigrationError("HOME must be set for ChatGPT state migration")
    home = Path(home_value)
    if not home.is_absolute():
        raise MigrationError(f"HOME must be an absolute path: {home}")

    config = xdg_base("XDG_CONFIG_HOME", home / ".config")
    state = xdg_base("XDG_STATE_HOME", home / ".local" / "state")
    cache = xdg_base("XDG_CACHE_HOME", home / ".cache")
    data = xdg_base("XDG_DATA_HOME", home / ".local" / "share")
    roots = (
        ("app-config", config, "codex-app", "chatgpt"),
        ("updater-config", config, "codex-app-updater", "chatgpt-updater"),
        ("app-state", state, "codex-app", "chatgpt"),
        ("updater-state", state, "codex-app-updater", "chatgpt-updater"),
        ("app-cache", cache, "codex-app", "chatgpt"),
        ("updater-cache", cache, "codex-app-updater", "chatgpt-updater"),
        ("app-data", data, "codex-app", "chatgpt"),
        (
            "cli-quarantine",
            home / ".codex-cli-npm" / "lib" / "node_modules" / "@openai",
            ".codex-linux-quarantine",
            ".chatgpt-linux-quarantine",
        ),
    )
    operations = [
        {
            "name": name,
            "legacy": str(base / legacy),
            "canonical": str(base / canonical),
            "kind": "directory",
            "status": "pending",
        }
        for name, base, legacy, canonical in roots
    ]
    permissions = data / "agent-workspace-linux" / "permissions"
    operations.append(
        {
            "name": "agent-workspace-permissions",
            "legacy": str(permissions / "codex-agent-workspace-permissions.json"),
            "canonical": str(permissions / "chatgpt-agent-workspace-permissions.json"),
            "kind": "file",
            "status": "pending",
        }
    )
    return operations, state / ".chatgpt-state-migration.json"


def operation_kind(operation: dict[str, Any]) -> str:
    kind = str(operation.get("kind", "directory"))
    if kind not in ("directory", "file"):
        raise MigrationError(f"unsupported migration operation kind: {kind}")
    return kind


def path_matches_kind(path: Path, kind: str) -> bool:
    return path.is_dir() if kind == "directory" else path.is_file()


def path_kind_description(kind: str) -> str:
    return "real directory" if kind == "directory" else "regular file"


def direction_paths(operation: dict[str, Any], direction: str) -> tuple[Path, Path]:
    if direction == "forward":
        return Path(operation["legacy"]), Path(operation["canonical"])
    return Path(operation["canonical"]), Path(operation["legacy"])


def nearest_existing_parent(path: Path) -> Path:
    current = path
    while not current.exists():
        if current == current.parent:
            raise MigrationError(f"no existing parent for migration path: {path}")
        current = current.parent
    return current


def recovery_command(destination: Path, direction: str) -> str:
    backup = destination.with_name(f"{destination.name}.pre-chatgpt-migration")
    while backup.exists() or backup.is_symlink():
        backup = backup.with_name(f"{backup.name}.next")
    rerun = "chatgpt migrate-state --reverse" if direction == "reverse" else "chatgpt"
    return (
        f"mv -T -- {shlex.quote(str(destination))} {shlex.quote(str(backup))}"
        f" && {rerun}"
    )


def validate_updater_cache_path(root: Path) -> None:
    downloads = root / "downloads"
    if (downloads.exists() or downloads.is_symlink()) and (
        downloads.is_symlink() or not downloads.is_dir()
    ):
        raise MigrationError(f"refusing unsafe updater cache downloads path: {downloads}")


def preflight(operations: list[dict[str, Any]], direction: str) -> None:
    errors: list[str] = []
    for operation in operations:
        source, destination = direction_paths(operation, direction)
        kind = operation_kind(operation)
        expected_description = path_kind_description(kind)
        source_exists = source.exists() or source.is_symlink()
        destination_exists = destination.exists() or destination.is_symlink()
        if source.is_symlink():
            errors.append(f"refusing symlink migration source: {source}")
            continue
        if destination.is_symlink():
            errors.append(f"refusing symlink migration destination: {destination}")
            continue
        if source_exists and not path_matches_kind(source, kind):
            errors.append(
                f"refusing migration source that is not a {expected_description}: {source}"
            )
            continue
        if (
            not source_exists
            and destination_exists
            and not path_matches_kind(destination, kind)
        ):
            errors.append(
                f"refusing migration destination that is not a {expected_description}: "
                f"{destination}"
            )
            continue
        if operation["name"] == "updater-cache":
            try:
                if source_exists:
                    validate_updater_cache_path(source)
                if destination_exists:
                    validate_updater_cache_path(destination)
            except MigrationError as error:
                errors.append(str(error))
                continue
        if source_exists and destination_exists:
            errors.append(
                f"migration collision: both {source} and {destination} exist\n"
                f"Recovery command: {recovery_command(destination, direction)}"
            )
            continue
        if not source_exists:
            operation["status"] = "skipped"
            continue
        destination_parent = nearest_existing_parent(destination.parent)
        if source.stat().st_dev != destination_parent.stat().st_dev:
            errors.append(
                "refusing non-atomic cross-filesystem migration: "
                f"{source} -> {destination}"
            )
    if errors:
        raise MigrationError("\n".join(errors))


VOLATILE_NAMES = {
    "app.pid",
    "webview.pid",
    "check.lock",
    "launch-action.sock",
    "SingletonCookie",
    "SingletonLock",
    "SingletonSocket",
}
VOLATILE_SUFFIXES = (".pid", ".sock", ".socket", ".lock", ".tmp", ".temp", ".part")
TEMP_DIRECTORY_NAMES = {"tmp", "temp", ".tmp", "partials"}
SCHEMA_SUFFIXES = {".conf", ".ini", ".json", ".toml"}
MAX_REWRITE_BYTES = 8 * 1024 * 1024


def discard_volatile_tree_entries(root: Path, operation_name: str) -> None:
    allow_volatile_deletion = operation_name.endswith(("-state", "-cache"))
    if not allow_volatile_deletion or not root.is_dir() or root.is_symlink():
        return
    allow_temp_directories = True
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        kept_directories: list[str] = []
        for name in directories:
            candidate = current_path / name
            if allow_temp_directories and name in TEMP_DIRECTORY_NAMES:
                if candidate.is_symlink():
                    candidate.unlink()
                else:
                    shutil.rmtree(candidate)
                continue
            if candidate.is_symlink():
                kept_directories.append(name)
                continue
            kept_directories.append(name)
        directories[:] = kept_directories
        for name in files:
            if name in VOLATILE_NAMES or name.endswith(VOLATILE_SUFFIXES):
                (current_path / name).unlink(missing_ok=True)


CACHE_DMG_PATTERN = re.compile(r"^(Codex|ChatGPT)-([0-9a-f]{64})\.dmg$")


def sha256_file(path: Path) -> str | None:
    try:
        file_stat = path.lstat()
    except FileNotFoundError:
        return None
    if path.is_symlink() or not stat.S_ISREG(file_stat.st_mode):
        return None
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        return None
    return digest.hexdigest()


def discard_cache_entry(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.is_dir():
        shutil.rmtree(path)


def normalize_updater_cache_directory(root: Path, direction: str) -> None:
    source_prefix, target_prefix = (
        ("Codex", "ChatGPT") if direction == "forward" else ("ChatGPT", "Codex")
    )
    for source in list(root.iterdir()):
        match = CACHE_DMG_PATTERN.fullmatch(source.name)
        if match is None or match.group(1) != source_prefix:
            continue
        expected_digest = match.group(2)
        if sha256_file(source) != expected_digest:
            discard_cache_entry(source)
            continue
        target = root / f"{target_prefix}-{expected_digest}.dmg"
        if target.exists() or target.is_symlink():
            if sha256_file(target) == expected_digest:
                source.unlink()
            else:
                discard_cache_entry(source)
                discard_cache_entry(target)
            continue
        rename_no_replace(source, target)

    for target in list(root.iterdir()):
        match = CACHE_DMG_PATTERN.fullmatch(target.name)
        if match is None or match.group(1) != target_prefix:
            continue
        if sha256_file(target) != match.group(2):
            discard_cache_entry(target)


def normalize_updater_cache_dmgs(root: Path, direction: str) -> None:
    if not root.is_dir() or root.is_symlink():
        raise MigrationError(f"refusing unsafe updater cache root: {root}")
    normalize_updater_cache_directory(root, direction)
    downloads = root / "downloads"
    if downloads.exists() or downloads.is_symlink():
        if downloads.is_symlink() or not downloads.is_dir():
            raise MigrationError(f"refusing unsafe updater cache downloads path: {downloads}")
        normalize_updater_cache_directory(downloads, direction)


def rewrite_pairs(operations: list[dict[str, Any]], direction: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for operation in operations:
        legacy = operation["legacy"]
        canonical = operation["canonical"]
        pairs.append((legacy, canonical) if direction == "forward" else (canonical, legacy))
    fixed = [
        ("/usr/bin/codex-app-updater", "/usr/bin/chatgpt-updater"),
        ("/usr/bin/codex-app", "/usr/bin/chatgpt"),
        ("/usr/lib/codex-app", "/usr/lib/chatgpt"),
        ("/opt/codex-app", "/opt/chatgpt"),
        ("codex-linux-auto-update-on-exit", "chatgpt-linux-auto-update-on-exit"),
        ("codex-linux-wrapper-updates-enabled", "chatgpt-linux-wrapper-updates-enabled"),
        ("codex-linux-integration-picker-on-update", "chatgpt-linux-integration-picker-on-update"),
        ("codex-linux-agent-workspace-command", "chatgpt-linux-agent-workspace-command"),
        (
            "codex-linux-agent-workspace-permissions",
            "chatgpt-linux-agent-workspace-permissions",
        ),
        ("codex-wrapper-updater", "chatgpt-wrapper-updater"),
        ("codex-linux-warm-start-enabled", "chatgpt-linux-warm-start-enabled"),
        (
            "codex-agent-workspace-permissions.json",
            "chatgpt-agent-workspace-permissions.json",
        ),
        (".codex-linux", ".chatgpt-linux"),
    ]
    pairs.extend(fixed if direction == "forward" else [(new, old) for old, new in fixed])
    return sorted(set(pairs), key=lambda pair: len(pair[0]), reverse=True)


def path_rewrite_pairs(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    return [
        (old_value, new_value)
        for old_value, new_value in pairs
        if old_value.startswith(("/", "."))
    ]


def exact_rewrite_map(pairs: list[tuple[str, str]]) -> dict[str, str]:
    return dict(pairs)


def rewrite_path_references(value: str, pairs: list[tuple[str, str]]) -> str:
    rewritten = value
    for old_value, new_value in path_rewrite_pairs(pairs):
        pattern = re.compile(
            rf"(?<![A-Za-z0-9_.-]){re.escape(old_value)}(?![A-Za-z0-9_.-])"
        )
        rewritten = pattern.sub(lambda _match: new_value, rewritten)
    return rewritten


def rewrite_json_value(value: Any, pairs: list[tuple[str, str]], path: Path) -> Any:
    replacements = exact_rewrite_map(pairs)
    if isinstance(value, dict):
        rewritten: dict[str, Any] = {}
        for key, child in value.items():
            rewritten_key = replacements.get(key, key)
            if rewritten_key in rewritten:
                raise MigrationError(
                    f"refusing persisted-key collision while rewriting {path}: {key} -> {rewritten_key}"
                )
            rewritten[rewritten_key] = rewrite_json_value(child, pairs, path)
        return rewritten
    if isinstance(value, list):
        return [rewrite_json_value(child, pairs, path) for child in value]
    if isinstance(value, str):
        if value in replacements:
            return replacements[value]
        return rewrite_path_references(value, pairs)
    return value


def rewrite_json_document(original: str, pairs: list[tuple[str, str]], path: Path) -> str:
    try:
        value = json.loads(original)
    except json.JSONDecodeError:
        return original
    rewritten = rewrite_json_value(value, pairs, path)
    if rewritten == value:
        return original
    suffix = "\n" if original.endswith("\n") else ""
    return json.dumps(rewritten, ensure_ascii=False, indent=2) + suffix


CONFIG_ASSIGNMENT = re.compile(
    r"^(?P<indent>\s*)(?P<key>[A-Za-z0-9_.-]+)(?P<separator>\s*[:=]\s*)"
    r"(?P<value>.*?)(?P<ending>\r?\n)?$"
)


def rewrite_config_scalar(value: str, pairs: list[tuple[str, str]]) -> str:
    rewritten = rewrite_path_references(value, pairs)
    for old_value, new_value in pairs:
        pattern = re.compile(
            rf"^(?P<leading>\s*)(?P<quote>['\"]?){re.escape(old_value)}"
            r"(?P=quote)(?P<trailing>\s*(?:[#;].*)?)$"
        )
        match = pattern.fullmatch(rewritten)
        if match is not None:
            return (
                f"{match.group('leading')}{match.group('quote')}{new_value}"
                f"{match.group('quote')}{match.group('trailing')}"
            )
    return rewritten


def rewrite_config_document(original: str, pairs: list[tuple[str, str]]) -> str:
    replacements = exact_rewrite_map(pairs)
    lines: list[str] = []
    for line in original.splitlines(keepends=True):
        match = CONFIG_ASSIGNMENT.fullmatch(line)
        if match is None:
            lines.append(line)
            continue
        key = match.group("key")
        lines.append(
            f"{match.group('indent')}{replacements.get(key, key)}"
            f"{match.group('separator')}{rewrite_config_scalar(match.group('value'), pairs)}"
            f"{match.group('ending') or ''}"
        )
    return "".join(lines)


def rewrite_known_paths(root: Path, pairs: list[tuple[str, str]]) -> None:
    if not root.is_dir() or root.is_symlink():
        return
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        directories[:] = [
            name for name in directories if not (current_path / name).is_symlink()
        ]
        for name in files:
            path = current_path / name
            suffix = path.suffix.lower()
            if path.is_symlink() or suffix not in SCHEMA_SUFFIXES:
                continue
            file_stat = path.stat()
            if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size > MAX_REWRITE_BYTES:
                continue
            try:
                original = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if suffix == ".json":
                rewritten = rewrite_json_document(original, pairs, path)
            else:
                rewritten = rewrite_config_document(original, pairs)
            if rewritten == original:
                continue
            temporary = path.with_name(f".{path.name}.migration-tmp.{os.getpid()}")
            with temporary.open("w", encoding="utf-8") as stream:
                stream.write(rewritten)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temporary, stat.S_IMODE(file_stat.st_mode))
            os.replace(temporary, path)


def discard_runtime_state(direction: str) -> None:
    runtime_value = os.environ.get("XDG_RUNTIME_DIR")
    if not runtime_value:
        return
    runtime = Path(runtime_value)
    if not runtime.is_absolute():
        raise MigrationError(f"XDG_RUNTIME_DIR must be an absolute path: {runtime}")
    names = ("codex-app", "codex-app-updater") if direction == "forward" else ("chatgpt", "chatgpt-updater")
    for name in names:
        path = runtime / name
        if path.is_symlink():
            raise MigrationError(f"refusing symlink runtime migration source: {path}")
        if path.exists():
            if not path.is_dir():
                raise MigrationError(f"refusing unexpected runtime migration source: {path}")
            shutil.rmtree(path)


AT_FDCWD = -100
RENAME_NOREPLACE = 1


def rename_no_replace(source: Path, destination: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise MigrationError("atomic no-replace rename is unavailable on this host")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        AT_FDCWD,
        os.fsencode(source),
        AT_FDCWD,
        os.fsencode(destination),
        RENAME_NOREPLACE,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number == errno.EEXIST:
        raise FileExistsError(error_number, os.strerror(error_number), destination)
    if error_number == errno.EXDEV:
        raise MigrationError(
            f"refusing non-atomic cross-filesystem migration: {source} -> {destination}"
        )
    raise OSError(error_number, os.strerror(error_number), destination)


def revalidate_and_move_path(
    source: Path,
    destination: Path,
    direction: str,
    kind: str,
) -> None:
    if source.is_symlink() or not path_matches_kind(source, kind):
        raise MigrationError(f"migration source changed before move: {source}")
    if destination.exists() or destination.is_symlink():
        raise MigrationError(
            f"migration collision: both {source} and {destination} exist\n"
            f"Recovery command: {recovery_command(destination, direction)}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.exists() or destination.is_symlink():
        raise MigrationError(
            f"migration collision: both {source} and {destination} exist\n"
            f"Recovery command: {recovery_command(destination, direction)}"
        )
    source_stat = source.stat()
    parent_stat = destination.parent.stat()
    if source_stat.st_dev != parent_stat.st_dev:
        raise MigrationError(
            f"refusing non-atomic cross-filesystem migration: {source} -> {destination}"
        )
    try:
        rename_no_replace(source, destination)
    except FileExistsError as error:
        raise MigrationError(
            f"migration collision: both {source} and {destination} exist\n"
            f"Recovery command: {recovery_command(destination, direction)}"
        ) from error


def write_journal(path: Path, journal: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(journal, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def load_journal(path: Path) -> dict[str, Any] | None:
    if path.is_symlink():
        raise MigrationError(f"refusing symlink migration journal: {path}")
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MigrationError(f"cannot read migration journal {path}: {error}") from error
    if not isinstance(data, dict) or data.get("version") != JOURNAL_VERSION:
        raise MigrationError(f"unsupported migration journal: {path}")
    return data


def run_migration(direction: str) -> None:
    expected_operations, journal_path = migration_paths()
    journal = load_journal(journal_path)
    if journal is None:
        preflight(expected_operations, direction)
        journal = {
            "version": JOURNAL_VERSION,
            "direction": direction,
            "operations": expected_operations,
        }
        write_journal(journal_path, journal)
    else:
        if journal.get("direction") != direction:
            pending_direction = str(journal.get("direction", "forward"))
            pending_command = "chatgpt migrate-state" + (
                " --reverse" if pending_direction == "reverse" else ""
            )
            raise MigrationError(
                f"an incomplete {pending_direction} migration must resume first: "
                f"{pending_command}"
            )
        if journal.get("operations") != expected_operations:
            expected_pairs = [
                (item["name"], item["legacy"], item["canonical"], operation_kind(item))
                for item in expected_operations
            ]
            actual_pairs = [
                (
                    item.get("name"),
                    item.get("legacy"),
                    item.get("canonical"),
                    operation_kind(item),
                )
                for item in journal.get("operations", [])
                if isinstance(item, dict)
            ]
            if actual_pairs != expected_pairs:
                raise MigrationError(f"migration journal paths do not match this user: {journal_path}")

    stop_after_value = os.environ.get("CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER", "")
    try:
        stop_after = int(stop_after_value) if stop_after_value else 0
    except ValueError as error:
        raise MigrationError("CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER must be an integer") from error
    if stop_after < 0:
        raise MigrationError("CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER must not be negative")
    completed_this_run = 0
    operations = journal["operations"]
    replacement_pairs = rewrite_pairs(operations, direction)
    # A journal containing only skipped operations represents an already
    # canonical state. Completed or in-flight operations still mean that a
    # resumed migration may need to rewrite references in skipped roots.
    rewrite_skipped_operations = any(
        operation["status"] != "skipped" for operation in operations
    )
    for operation in operations:
        if operation["status"] == "complete":
            continue
        if operation["status"] == "skipped":
            _, destination = direction_paths(operation, direction)
            if rewrite_skipped_operations:
                rewrite_known_paths(destination, replacement_pairs)
            continue
        source, destination = direction_paths(operation, direction)
        kind = operation_kind(operation)
        operation["status"] = "moving"
        write_journal(journal_path, journal)
        create_destination_for_test = os.environ.get(
            "CHATGPT_STATE_MIGRATION_TEST_CREATE_DESTINATION_BEFORE_MOVE", ""
        )
        if create_destination_for_test == operation["name"] and source.exists():
            destination.mkdir(parents=True, exist_ok=False)
            (destination / "concurrent-state").write_text("concurrent\n", encoding="utf-8")
        moved_now = False
        if source.exists():
            revalidate_and_move_path(source, destination, direction, kind)
            moved_now = True
        else:
            if source.is_symlink():
                raise MigrationError(f"migration source changed to a symlink while resuming: {source}")
            if destination.is_symlink() or not path_matches_kind(destination, kind):
                raise MigrationError(
                    "migration destination is not a "
                    f"{path_kind_description(kind)} while resuming: {destination}"
                )
        stop_after_rename = os.environ.get("CHATGPT_STATE_MIGRATION_TEST_STOP_AFTER_RENAME", "")
        if moved_now and stop_after_rename == operation["name"]:
            raise MigrationError("test interruption requested after migration rename")
        discard_volatile_tree_entries(destination, operation["name"])
        if operation["name"] == "updater-cache":
            normalize_updater_cache_dmgs(destination, direction)
        rewrite_known_paths(destination, replacement_pairs)
        operation["status"] = "complete"
        write_journal(journal_path, journal)
        completed_this_run += 1
        if stop_after and completed_this_run >= stop_after:
            raise MigrationError("test interruption requested after completed migration operation")

    discard_runtime_state(direction)
    journal_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate ChatGPT for Linux XDG state")
    direction = parser.add_mutually_exclusive_group(required=True)
    direction.add_argument("--forward", action="store_true")
    direction.add_argument("--reverse", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    direction = "reverse" if args.reverse else "forward"
    try:
        run_migration(direction)
    except (MigrationError, OSError) as error:
        print(f"ChatGPT state migration failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
