#!/usr/bin/env python3
"""Resolve and launch a canonical Codex CLI with stable invocation identity."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import sys


class LaunchPathError(RuntimeError):
    pass


EXEC_TARGET_ENV = "CHATGPT_CLI_EXEC_TARGET"


def resolve_cli_launch_path(raw_path: str) -> Path:
    if os.sep not in raw_path:
        discovered = shutil.which(raw_path)
        if discovered is None:
            raise LaunchPathError(f"Codex CLI command {raw_path!r} was not found in PATH")
        selected_path = Path(discovered)
    else:
        selected_path = Path(raw_path)

    try:
        canonical_cli = selected_path.resolve(strict=True)
        metadata = canonical_cli.stat()
    except OSError as error:
        raise LaunchPathError(f"Failed to resolve Codex CLI path {selected_path}: {error}") from error

    if not stat.S_ISREG(metadata.st_mode) or not os.access(canonical_cli, os.X_OK):
        raise LaunchPathError(f"Selected Codex CLI target {canonical_cli} is not an executable file")
    return canonical_cli


def launch_cli(raw_target: str, arguments: list[str]) -> None:
    target = resolve_cli_launch_path(raw_target)
    environment = os.environ.copy()
    environment.pop(EXEC_TARGET_ENV, None)
    os.execve(target, ["codex", *arguments], environment)


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--resolve" and sys.argv[2]:
        try:
            print(resolve_cli_launch_path(sys.argv[2]))
        except (OSError, LaunchPathError) as error:
            print(error, file=sys.stderr)
            return 1
        return 0

    exec_target = os.environ.get(EXEC_TARGET_ENV)
    if exec_target:
        try:
            launch_cli(exec_target, sys.argv[1:])
        except (OSError, LaunchPathError) as error:
            print(error, file=sys.stderr)
            return 1
        raise AssertionError("os.execve returned unexpectedly")

    if len(sys.argv) != 2 or not sys.argv[1]:
        print(
            f"usage: {Path(sys.argv[0]).name} --resolve CLI_PATH",
            file=sys.stderr,
        )
        return 64
    print(f"{EXEC_TARGET_ENV} is required for proxy launch", file=sys.stderr)
    return 64


if __name__ == "__main__":
    raise SystemExit(main())
