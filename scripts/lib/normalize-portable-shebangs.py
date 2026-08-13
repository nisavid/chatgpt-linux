#!/usr/bin/env python3
"""Restore portable shebangs after Nix build hooks patch package scripts."""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path


NIX_INTERPRETER = re.compile(
    rb"/nix/store/[0-9a-z]{32}-[^/\r\n]+/(?:s?bin)/([A-Za-z0-9._+-]+)"
)


def portable_shebang(line: bytes) -> bytes | None:
    if not line.startswith(b"#!"):
        return None

    invocation = line[2:].strip()
    if not invocation.startswith(b"/nix/store/"):
        return None

    parts = invocation.split(maxsplit=1)
    match = NIX_INTERPRETER.fullmatch(parts[0])
    if match is None:
        raise ValueError(f"unsupported Nix-store shebang: {line!r}")

    interpreter = match.group(1)
    if len(parts) == 1:
        return b"#!/usr/bin/env " + interpreter
    return b"#!/usr/bin/env -S " + interpreter + b" " + parts[1]


def normalize_file(path: Path) -> bool:
    with path.open("rb") as source:
        first_line = source.readline()
        if not first_line.startswith(b"#!"):
            return False
        remainder = source.read()

    newline = b"\r\n" if first_line.endswith(b"\r\n") else b"\n"
    line = first_line.rstrip(b"\r\n")
    replacement = portable_shebang(line)
    if replacement is None:
        return False

    path.write_bytes(replacement + newline + remainder)
    return True


def normalize_tree(root: Path) -> int:
    if not root.is_dir():
        raise ValueError(f"portable shebang root is not a directory: {root}")

    normalized = 0
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_names.sort()
        file_names.sort()
        for file_name in file_names:
            path = Path(directory, file_name)
            if path.is_symlink() or not path.is_file():
                continue
            normalized += int(normalize_file(path))
    return normalized


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    normalized = normalize_tree(args.root)
    print(f"normalized {normalized} Nix-store shebang(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
