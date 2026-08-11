#!/usr/bin/env python3
"""Canonical package payload manifests, snapshots, and release provenance."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tarfile
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any


SCHEMA_VERSION = 1
COPY_CHUNK_SIZE = 1024 * 1024


class ProvenanceError(RuntimeError):
    """A package provenance contract was not satisfied."""


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True) + "\n").encode(
        "utf-8"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(COPY_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stat_identity(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_uid,
        metadata.st_gid,
        metadata.st_nlink,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def sorted_directory_names(directory_descriptor: int) -> list[str]:
    with os.scandir(directory_descriptor) as children:
        return sorted((child.name for child in children), key=os.fsencode)


def open_directory_at(parent_descriptor: int, name: str) -> int:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    return os.open(name, flags, dir_fd=parent_descriptor)


def open_regular_file_at(parent_descriptor: int, name: str) -> int:
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    return os.open(name, flags, dir_fd=parent_descriptor)


def stable_file_digest(
    directory_descriptor: int,
    name: str,
    listed_metadata: os.stat_result,
) -> tuple[os.stat_result, str, int]:
    descriptor = open_regular_file_at(directory_descriptor, name)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ProvenanceError(f"manifest entry changed type while opening: {name}")
        if stat_identity(before) != stat_identity(listed_metadata):
            raise ProvenanceError(f"manifest entry changed while opening: {name}")
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(descriptor, COPY_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
        after = os.fstat(descriptor)
        current = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
        if stat_identity(before) != stat_identity(after) or stat_identity(before) != stat_identity(current):
            raise ProvenanceError(f"manifest entry changed while reading: {name}")
        if size != before.st_size:
            raise ProvenanceError(f"manifest entry size changed while reading: {name}")
        return before, digest.hexdigest(), size
    finally:
        os.close(descriptor)


def relative_name(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def manifest_entries(root: Path) -> list[dict[str, Any]]:
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        root_descriptor = os.open(root, flags)
    except OSError as error:
        raise ProvenanceError(f"manifest root must be a non-symlink directory: {root}: {error}") from error

    entries: list[dict[str, Any]] = []

    def visit(directory_descriptor: int, parts: tuple[str, ...]) -> None:
        before = os.fstat(directory_descriptor)
        names = sorted_directory_names(directory_descriptor)
        for name in names:
            metadata = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
            relative = PurePosixPath(*parts, name).as_posix()
            entry: dict[str, Any] = {
                "mode": f"{stat.S_IMODE(metadata.st_mode):04o}",
                "path": relative,
            }
            if stat.S_ISDIR(metadata.st_mode):
                child_descriptor = open_directory_at(directory_descriptor, name)
                try:
                    opened = os.fstat(child_descriptor)
                    if stat_identity(opened) != stat_identity(metadata):
                        raise ProvenanceError(f"manifest directory changed while opening: {relative}")
                    entry["type"] = "directory"
                    entries.append(entry)
                    visit(child_descriptor, (*parts, name))
                    current = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
                    if stat_identity(opened) != stat_identity(current):
                        raise ProvenanceError(f"manifest directory changed while reading: {relative}")
                finally:
                    os.close(child_descriptor)
            elif stat.S_ISREG(metadata.st_mode):
                opened, digest, size = stable_file_digest(directory_descriptor, name, metadata)
                entry.update({"sha256": digest, "size": size, "type": "file"})
                entries.append(entry)
                if opened.st_nlink != 1:
                    raise ProvenanceError(f"hard-linked files are not allowed in package payloads: {relative}")
            elif stat.S_ISLNK(metadata.st_mode):
                target = os.readlink(name, dir_fd=directory_descriptor)
                current = os.stat(name, dir_fd=directory_descriptor, follow_symlinks=False)
                if stat_identity(metadata) != stat_identity(current):
                    raise ProvenanceError(f"manifest symlink changed while reading: {relative}")
                entry.update({"target": target, "type": "symlink"})
                entries.append(entry)
            else:
                raise ProvenanceError(f"special files are not allowed in package payloads: {relative}")
        after_names = sorted_directory_names(directory_descriptor)
        after = os.fstat(directory_descriptor)
        if names != after_names or stat_identity(before) != stat_identity(after):
            label = PurePosixPath(*parts).as_posix() if parts else "."
            raise ProvenanceError(f"manifest directory changed while reading: {label}")

    try:
        visit(root_descriptor, ())
    finally:
        os.close(root_descriptor)
    entries.sort(key=lambda entry: os.fsencode(entry["path"]))
    return entries


def build_manifest(root: Path) -> dict[str, Any]:
    content = {"entries": manifest_entries(root), "schemaVersion": SCHEMA_VERSION}
    return {**content, "manifestSha256": sha256_bytes(canonical_bytes(content))}


def normalized_tar_path(name: str) -> str:
    while name.startswith("./"):
        name = name[2:]
    if name in ("", "."):
        return "."
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", "..") for part in path.parts):
        raise ProvenanceError(f"unsafe package archive path: {name!r}")
    return path.as_posix()


def tar_stream_manifest(ignored_content: set[str]) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    observed_paths: set[str] = set()
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|*") as archive:
        for member in archive:
            path = normalized_tar_path(member.name)
            if path in observed_paths:
                raise ProvenanceError(f"duplicate package archive path: {path}")
            observed_paths.add(path)
            entry: dict[str, Any] = {
                "gid": member.gid,
                "gname": member.gname,
                "mode": f"{member.mode:04o}",
                "mtime": str(member.mtime),
                "path": path,
                "paxHeaders": dict(sorted(member.pax_headers.items())),
                "uid": member.uid,
                "uname": member.uname,
            }
            if member.isfile():
                entry["type"] = "file"
                if path not in ignored_content:
                    source = archive.extractfile(member)
                    if source is None:
                        raise ProvenanceError(f"could not read package archive file: {path}")
                    digest = hashlib.sha256()
                    size = 0
                    for chunk in iter(lambda: source.read(COPY_CHUNK_SIZE), b""):
                        digest.update(chunk)
                        size += len(chunk)
                    if size != member.size:
                        raise ProvenanceError(f"package archive file size changed while reading: {path}")
                    entry.update({"sha256": digest.hexdigest(), "size": size})
            elif member.isdir():
                entry["type"] = "directory"
            elif member.issym():
                entry.update({"target": member.linkname, "type": "symlink"})
            elif member.islnk():
                entry.update({"target": normalized_tar_path(member.linkname), "type": "hardlink"})
            else:
                raise ProvenanceError(f"special files are not allowed in package archives: {path}")
            if member.sparse is not None:
                entry["sparse"] = member.sparse
            if member.ischr() or member.isblk():
                entry.update({"deviceMajor": member.devmajor, "deviceMinor": member.devminor})
            entries.append(entry)
    entries.sort(key=lambda entry: os.fsencode(entry["path"]))
    content = {"entries": entries, "schemaVersion": SCHEMA_VERSION}
    return {**content, "manifestSha256": sha256_bytes(canonical_bytes(content))}


def write_exclusive(path: Path, payload: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, mode)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as destination:
            destination.write(payload)
            destination.flush()
            os.fsync(destination.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally:
        os.close(descriptor)


def replace_with_canonical_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.tmp.{os.getpid()}"
    temporary.unlink(missing_ok=True)
    try:
        write_exclusive(temporary, canonical_bytes(value))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def read_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProvenanceError(f"could not read manifest {path}: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise ProvenanceError(f"unsupported manifest schema: {path}")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ProvenanceError(f"manifest entries must be an array: {path}")
    content = {"entries": entries, "schemaVersion": SCHEMA_VERSION}
    expected_digest = sha256_bytes(canonical_bytes(content))
    if manifest.get("manifestSha256") != expected_digest:
        raise ProvenanceError(f"manifest digest does not match its contents: {path}")
    return manifest


def describe_manifest_difference(expected: dict[str, Any], actual: dict[str, Any]) -> str:
    expected_by_path = {entry.get("path"): entry for entry in expected["entries"]}
    actual_by_path = {entry.get("path"): entry for entry in actual["entries"]}
    descriptions: list[str] = []
    for path in sorted(expected_by_path.keys() - actual_by_path.keys()):
        descriptions.append(f"removed {path}")
    for path in sorted(actual_by_path.keys() - expected_by_path.keys()):
        descriptions.append(f"added {path}")
    for path in sorted(expected_by_path.keys() & actual_by_path.keys()):
        if expected_by_path[path] != actual_by_path[path]:
            expected_entry = expected_by_path[path]
            actual_entry = actual_by_path[path]
            fields = sorted(set(expected_entry) | set(actual_entry))
            differences = [
                f"{field} {expected_entry.get(field)!r} != {actual_entry.get(field)!r}"
                for field in fields
                if expected_entry.get(field) != actual_entry.get(field)
            ]
            descriptions.append(f"changed {path} ({', '.join(differences)})")
    if not descriptions:
        descriptions.append("manifest digest changed")
    return "; ".join(descriptions[:20])


def compare_manifests(expected_path: Path, actual_path: Path) -> None:
    expected = read_manifest(expected_path)
    actual = read_manifest(actual_path)
    if expected != actual:
        raise ProvenanceError(
            "package manifest differs from the reviewed reference: "
            + describe_manifest_difference(expected, actual)
        )


def snapshot_regular_file(source_path: Path, destination_path: Path) -> dict[str, Any]:
    parent_metadata = destination_path.parent.stat(follow_symlinks=False)
    if not stat.S_ISDIR(parent_metadata.st_mode) or stat.S_IMODE(parent_metadata.st_mode) & 0o077:
        raise ProvenanceError(f"snapshot directory must be private (mode 0700 or stricter): {destination_path.parent}")

    source_flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        source_flags |= os.O_NOFOLLOW
    try:
        source_descriptor = os.open(source_path, source_flags)
    except OSError as error:
        raise ProvenanceError(f"could not open package without following symlinks: {source_path}: {error}") from error

    destination_descriptor: int | None = None
    try:
        before = os.fstat(source_descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ProvenanceError(f"package must be a regular file: {source_path}")
        destination_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            destination_flags |= os.O_NOFOLLOW
        destination_descriptor = os.open(destination_path, destination_flags, 0o600)
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(source_descriptor, COPY_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(destination_descriptor, view)
                view = view[written:]
        os.fsync(destination_descriptor)
        after = os.fstat(source_descriptor)
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        if identity_before != identity_after or size != before.st_size:
            raise ProvenanceError(f"package changed while it was being snapshotted: {source_path}")
        return {"filename": source_path.name, "sha256": digest.hexdigest(), "size": size}
    except BaseException:
        if destination_descriptor is not None:
            destination_path.unlink(missing_ok=True)
        raise
    finally:
        os.close(source_descriptor)
        if destination_descriptor is not None:
            os.close(destination_descriptor)


def snapshot_tree(source_path: Path, destination_path: Path) -> dict[str, Any]:
    try:
        parent_metadata = destination_path.parent.lstat()
    except OSError as error:
        raise ProvenanceError(f"could not inspect tree snapshot parent: {error}") from error
    if not stat.S_ISDIR(parent_metadata.st_mode) or stat.S_IMODE(parent_metadata.st_mode) & 0o077:
        raise ProvenanceError(
            f"tree snapshot parent must be a private non-symlink directory: {destination_path.parent}"
        )

    source_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        source_flags |= os.O_NOFOLLOW
    try:
        source_descriptor = os.open(source_path, source_flags)
    except OSError as error:
        raise ProvenanceError(f"could not open tree snapshot source without following symlinks: {error}") from error

    try:
        os.mkdir(destination_path, 0o700)
    except BaseException:
        os.close(source_descriptor)
        raise
    destination_descriptor = os.open(destination_path, source_flags)

    def copy_file(
        source_directory: int,
        destination_directory: int,
        name: str,
        relative: str,
        listed_metadata: os.stat_result,
    ) -> None:
        source_file = open_regular_file_at(source_directory, name)
        destination_file: int | None = None
        try:
            before = os.fstat(source_file)
            if stat_identity(before) != stat_identity(listed_metadata):
                raise ProvenanceError(f"tree snapshot file changed while opening: {relative}")
            if before.st_nlink != 1:
                raise ProvenanceError(f"hard-linked files are not allowed in tree snapshots: {relative}")
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            destination_file = os.open(name, flags, 0o600, dir_fd=destination_directory)
            size = 0
            while True:
                chunk = os.read(source_file, COPY_CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                view = memoryview(chunk)
                while view:
                    written = os.write(destination_file, view)
                    view = view[written:]
            os.fchmod(destination_file, stat.S_IMODE(before.st_mode))
            os.utime(destination_file, ns=(before.st_atime_ns, before.st_mtime_ns))
            os.fsync(destination_file)
            after = os.fstat(source_file)
            current = os.stat(name, dir_fd=source_directory, follow_symlinks=False)
            if stat_identity(before) != stat_identity(after) or stat_identity(before) != stat_identity(current):
                raise ProvenanceError(f"tree snapshot file changed while copying: {relative}")
            if size != before.st_size:
                raise ProvenanceError(f"tree snapshot file size changed while copying: {relative}")
        finally:
            os.close(source_file)
            if destination_file is not None:
                os.close(destination_file)

    def copy_directory(
        source_directory: int,
        destination_directory: int,
        parts: tuple[str, ...],
    ) -> None:
        before = os.fstat(source_directory)
        names = sorted_directory_names(source_directory)
        for name in names:
            relative = PurePosixPath(*parts, name).as_posix()
            metadata = os.stat(name, dir_fd=source_directory, follow_symlinks=False)
            if stat.S_ISDIR(metadata.st_mode):
                source_child = open_directory_at(source_directory, name)
                destination_child: int | None = None
                try:
                    opened = os.fstat(source_child)
                    if stat_identity(opened) != stat_identity(metadata):
                        raise ProvenanceError(f"tree snapshot directory changed while opening: {relative}")
                    os.mkdir(name, 0o700, dir_fd=destination_directory)
                    destination_child = open_directory_at(destination_directory, name)
                    copy_directory(source_child, destination_child, (*parts, name))
                    os.fchmod(destination_child, stat.S_IMODE(opened.st_mode))
                    os.utime(destination_child, ns=(opened.st_atime_ns, opened.st_mtime_ns))
                    current = os.stat(name, dir_fd=source_directory, follow_symlinks=False)
                    if stat_identity(opened) != stat_identity(current):
                        raise ProvenanceError(f"tree snapshot directory changed while copying: {relative}")
                finally:
                    os.close(source_child)
                    if destination_child is not None:
                        os.close(destination_child)
            elif stat.S_ISREG(metadata.st_mode):
                copy_file(source_directory, destination_directory, name, relative, metadata)
            elif stat.S_ISLNK(metadata.st_mode):
                target = os.readlink(name, dir_fd=source_directory)
                current = os.stat(name, dir_fd=source_directory, follow_symlinks=False)
                if stat_identity(metadata) != stat_identity(current):
                    raise ProvenanceError(f"tree snapshot symlink changed while reading: {relative}")
                os.symlink(target, name, dir_fd=destination_directory)
                os.utime(
                    name,
                    ns=(metadata.st_atime_ns, metadata.st_mtime_ns),
                    dir_fd=destination_directory,
                    follow_symlinks=False,
                )
            else:
                raise ProvenanceError(f"special files are not allowed in tree snapshots: {relative}")
        after_names = sorted_directory_names(source_directory)
        after = os.fstat(source_directory)
        if names != after_names or stat_identity(before) != stat_identity(after):
            label = PurePosixPath(*parts).as_posix() if parts else "."
            raise ProvenanceError(f"tree snapshot directory changed while copying: {label}")

    try:
        copy_directory(source_descriptor, destination_descriptor, ())
        os.fchmod(destination_descriptor, 0o700)
        os.fsync(destination_descriptor)
    finally:
        os.close(source_descriptor)
        os.close(destination_descriptor)

    manifest = build_manifest(destination_path)
    return {
        "manifestSha256": manifest["manifestSha256"],
        "source": source_path.name,
    }


def validate_digest(value: Any, label: str) -> None:
    if not isinstance(value, str) or len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ProvenanceError(f"{label} must be a lowercase hexadecimal SHA-256 digest")


def validate_signing_fingerprint(value: Any, label: str) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[0-9A-F]{40}(?:[0-9A-F]{24})?", value) is None:
        raise ProvenanceError(f"{label} must be an uppercase primary OpenPGP fingerprint")


def validate_provenance(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ProvenanceError("provenance input must be an object")
    required_objects = ("officialDmg", "generatedApp", "source", "config")
    for key in required_objects:
        if not isinstance(payload.get(key), dict):
            raise ProvenanceError(f"provenance {key} must be an object")
    validate_digest(payload["officialDmg"].get("sha256"), "officialDmg.sha256")
    validate_digest(payload["generatedApp"].get("manifestSha256"), "generatedApp.manifestSha256")
    validate_digest(payload["generatedApp"].get("buildInfoSha256"), "generatedApp.buildInfoSha256")
    validate_digest(payload["config"].get("sha256"), "config.sha256")
    package_build = payload["config"].get("packageBuild")
    if not isinstance(package_build, dict):
        raise ProvenanceError("config.packageBuild must be an object")
    if package_build.get("withUpdater") is True:
        validate_digest(package_build.get("updaterSha256"), "config.packageBuild.updaterSha256")
    elif "updaterSha256" in package_build:
        raise ProvenanceError("config.packageBuild.updaterSha256 requires withUpdater=true")
    packages = payload.get("packages")
    if not isinstance(packages, list) or not packages:
        raise ProvenanceError("provenance packages must be a non-empty array")
    for index, package in enumerate(packages):
        if not isinstance(package, dict):
            raise ProvenanceError(f"packages[{index}] must be an object")
        for key in ("format", "name", "version", "arch", "filename"):
            if not isinstance(package.get(key), str) or not package[key]:
                raise ProvenanceError(f"packages[{index}].{key} must be a non-empty string")
        validate_digest(package.get("payloadManifestSha256"), f"packages[{index}].payloadManifestSha256")
        validate_digest(package.get("controlManifestSha256"), f"packages[{index}].controlManifestSha256")
        validate_digest(package.get("sha256"), f"packages[{index}].sha256")
    if payload.get("releaseMode") not in ("public", "rehearsal"):
        raise ProvenanceError("releaseMode must be public or rehearsal")
    if not isinstance(payload.get("publicReleaseEligible"), bool):
        raise ProvenanceError("publicReleaseEligible must be a boolean")
    expected_eligibility = payload["releaseMode"] == "public"
    if payload["publicReleaseEligible"] is not expected_eligibility:
        raise ProvenanceError("publicReleaseEligible must exactly match releaseMode")
    signing = payload.get("signing")
    if signing is not None:
        if not isinstance(signing, dict):
            raise ProvenanceError("provenance signing must be an object")
        validate_signing_fingerprint(signing.get("primaryFingerprint"), "signing.primaryFingerprint")
    elif expected_eligibility:
        raise ProvenanceError("public release provenance requires the reviewed signing fingerprint")
    return {
        **payload,
        "packages": sorted(packages, key=lambda package: (package["filename"], package["format"])),
        "schemaVersion": SCHEMA_VERSION,
    }


def read_json_object(path: Path, label: str) -> dict[str, Any]:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ProvenanceError(f"could not inspect {label}: {error}") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise ProvenanceError(f"{label} must be a regular non-symlink file: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProvenanceError(f"could not read {label}: {error}") from error
    if not isinstance(value, dict):
        raise ProvenanceError(f"{label} must contain a JSON object")
    return value


def validate_build_info(
    build_info_path: Path,
    dmg_sha256: str,
    dmg_app_version: str,
    source_commit: str,
    resolved_config_path: Path,
    integration_inputs_path: Path,
    public_release: bool,
) -> None:
    validate_digest(dmg_sha256, "verified DMG SHA-256")
    build_info = read_json_object(build_info_path, "generated-app build info")
    config = read_json_object(resolved_config_path, "resolved port integration config")
    integration_inputs = read_json_object(integration_inputs_path, "port integration build inputs")
    if build_info.get("schemaVersion") != 1:
        raise ProvenanceError("generated-app build info has an unsupported schema")
    if build_info.get("officialDmg", {}).get("sha256") != dmg_sha256:
        raise ProvenanceError("generated app was not built from the verified official DMG")
    if public_release:
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2,3}", dmg_app_version):
            raise ProvenanceError("verified DMG app version is invalid")
        if build_info.get("officialDmg", {}).get("appVersion") != dmg_app_version:
            raise ProvenanceError("generated app version does not match the verified official DMG")
    if build_info.get("source", {}).get("commit") != source_commit:
        raise ProvenanceError("generated app was not built from the reviewed source commit")
    build_enabled = build_info.get("portIntegrations", {}).get("enabled")
    config_enabled = config.get("enabled")
    if not isinstance(build_enabled, list) or not all(isinstance(value, str) for value in build_enabled):
        raise ProvenanceError("generated-app build info has an invalid enabled integration list")
    if not isinstance(config_enabled, list) or not all(isinstance(value, str) for value in config_enabled):
        raise ProvenanceError("resolved port integration config has an invalid enabled integration list")
    if sorted(build_enabled) != sorted(config_enabled):
        raise ProvenanceError("generated app does not match the currently resolved port integration config")
    build_integrations = build_info.get("portIntegrations", {})
    if build_integrations.get("resolved") != config:
        raise ProvenanceError("generated app does not match the full resolved port integration config")
    input_digest = integration_inputs.get("sha256")
    validate_digest(input_digest, "port integration build input SHA-256")
    if build_integrations.get("inputsSha256") != input_digest:
        raise ProvenanceError("generated app does not match the reviewed port integration implementation bytes")
    if build_integrations.get("rootKind") != integration_inputs.get("rootKind"):
        raise ProvenanceError("generated app port integration root identity does not match the reviewed inputs")
    if public_release:
        if integration_inputs.get("rootKind") != "checkout":
            raise ProvenanceError("public release port integrations must come from the reviewed checkout")
        integrations = integration_inputs.get("integrations")
        if not isinstance(integrations, list) or any(
            not isinstance(integration, dict) or integration.get("origin") != "repo"
            for integration in integrations
        ):
            raise ProvenanceError("public release port integrations must not include local integration origins")
    if public_release and build_info.get("source", {}).get("dirty") is not False:
        raise ProvenanceError("public release app build info must record a clean source tree")


def read_json_lines(path: Path, label: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise ProvenanceError(f"could not read {label}: {error}") from error
    for line_number, line in enumerate(lines, 1):
        if not line:
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ProvenanceError(f"invalid {label} JSON on line {line_number}: {error}") from error
        if not isinstance(value, dict):
            raise ProvenanceError(f"{label} line {line_number} must be an object")
        records.append(value)
    return records


def command_manifest(arguments: argparse.Namespace) -> None:
    replace_with_canonical_json(Path(arguments.output), build_manifest(Path(arguments.root)))


def command_tar_manifest(arguments: argparse.Namespace) -> None:
    ignored = {normalized_tar_path(name) for name in arguments.ignore_content}
    replace_with_canonical_json(Path(arguments.output), tar_stream_manifest(ignored))


def command_compare(arguments: argparse.Namespace) -> None:
    compare_manifests(Path(arguments.expected), Path(arguments.actual))


def command_snapshot(arguments: argparse.Namespace) -> None:
    record = snapshot_regular_file(Path(arguments.source), Path(arguments.destination))
    sys.stdout.buffer.write(canonical_bytes(record))


def command_snapshot_tree(arguments: argparse.Namespace) -> None:
    record = snapshot_tree(Path(arguments.source), Path(arguments.destination))
    sys.stdout.buffer.write(canonical_bytes(record))


def command_provenance(arguments: argparse.Namespace) -> None:
    try:
        payload = json.loads(Path(arguments.input).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProvenanceError(f"could not read provenance input: {error}") from error
    replace_with_canonical_json(Path(arguments.output), validate_provenance(payload))


def command_validate_build_info(arguments: argparse.Namespace) -> None:
    validate_build_info(
        Path(arguments.build_info),
        arguments.dmg_sha256,
        arguments.dmg_app_version,
        arguments.source_commit,
        Path(arguments.resolved_config),
        Path(arguments.integration_inputs),
        arguments.public_release,
    )


def command_assemble_provenance(arguments: argparse.Namespace) -> None:
    app_manifest = read_manifest(Path(arguments.app_manifest))
    build_info_path = Path(arguments.build_info)
    build_info = read_json_object(build_info_path, "generated-app build info")
    config_path = Path(arguments.resolved_config)
    resolved_config = read_json_object(config_path, "resolved port integration config")
    packages = read_json_lines(Path(arguments.packages_jsonl), "package records")
    source_dirty = arguments.source_dirty == "1"
    package_build = {
        "sourceDateEpoch": int(arguments.source_date_epoch),
        "withUpdater": arguments.package_with_updater == "1",
    }
    if arguments.package_with_updater == "1":
        validate_digest(arguments.updater_sha256, "updater SHA-256")
        package_build["updaterSha256"] = arguments.updater_sha256
    official_dmg = {"sha256": arguments.dmg_sha256}
    if arguments.dmg_app_version:
        if not re.fullmatch(r"[0-9]+(?:\.[0-9]+){2,3}", arguments.dmg_app_version):
            raise ProvenanceError("verified DMG app version is invalid")
        official_dmg["appVersion"] = arguments.dmg_app_version
    payload = {
        "releaseMode": arguments.release_mode,
        "publicReleaseEligible": arguments.release_mode == "public",
        "officialDmg": official_dmg,
        "generatedApp": {
            "buildInfo": build_info,
            "buildInfoSha256": sha256_file(build_info_path),
            "manifestSha256": app_manifest["manifestSha256"],
        },
        "source": {"commit": arguments.source_commit, "dirty": source_dirty},
        "config": {
            "packageBuild": package_build,
            "resolved": resolved_config,
            "sha256": sha256_file(config_path),
        },
        "packages": packages,
    }
    if arguments.release_signing_fingerprint:
        validate_signing_fingerprint(
            arguments.release_signing_fingerprint,
            "release signing fingerprint",
        )
        payload["signing"] = {"primaryFingerprint": arguments.release_signing_fingerprint}
    replace_with_canonical_json(Path(arguments.output), validate_provenance(payload))


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    subparsers = argument_parser.add_subparsers(dest="command", required=True)

    manifest_parser = subparsers.add_parser("manifest")
    manifest_parser.add_argument("root")
    manifest_parser.add_argument("output")
    manifest_parser.set_defaults(handler=command_manifest)

    tar_manifest_parser = subparsers.add_parser("tar-manifest")
    tar_manifest_parser.add_argument("--ignore-content", action="append", default=[])
    tar_manifest_parser.add_argument("output")
    tar_manifest_parser.set_defaults(handler=command_tar_manifest)

    compare_parser = subparsers.add_parser("compare")
    compare_parser.add_argument("expected")
    compare_parser.add_argument("actual")
    compare_parser.set_defaults(handler=command_compare)

    snapshot_parser = subparsers.add_parser("snapshot")
    snapshot_parser.add_argument("source")
    snapshot_parser.add_argument("destination")
    snapshot_parser.set_defaults(handler=command_snapshot)

    snapshot_tree_parser = subparsers.add_parser("snapshot-tree")
    snapshot_tree_parser.add_argument("source")
    snapshot_tree_parser.add_argument("destination")
    snapshot_tree_parser.set_defaults(handler=command_snapshot_tree)

    provenance_parser = subparsers.add_parser("provenance")
    provenance_parser.add_argument("input")
    provenance_parser.add_argument("output")
    provenance_parser.set_defaults(handler=command_provenance)

    validate_parser = subparsers.add_parser("validate-build-info")
    validate_parser.add_argument("--build-info", required=True)
    validate_parser.add_argument("--dmg-sha256", required=True)
    validate_parser.add_argument("--dmg-app-version", default="")
    validate_parser.add_argument("--source-commit", required=True)
    validate_parser.add_argument("--resolved-config", required=True)
    validate_parser.add_argument("--integration-inputs", required=True)
    validate_parser.add_argument("--public-release", action="store_true")
    validate_parser.set_defaults(handler=command_validate_build_info)

    assemble_parser = subparsers.add_parser("assemble-provenance")
    assemble_parser.add_argument("--release-mode", choices=("public", "rehearsal"), required=True)
    assemble_parser.add_argument("--dmg-sha256", required=True)
    assemble_parser.add_argument("--dmg-app-version", default="")
    assemble_parser.add_argument("--app-manifest", required=True)
    assemble_parser.add_argument("--build-info", required=True)
    assemble_parser.add_argument("--source-commit", required=True)
    assemble_parser.add_argument("--source-dirty", choices=("0", "1"), required=True)
    assemble_parser.add_argument("--resolved-config", required=True)
    assemble_parser.add_argument("--package-with-updater", choices=("0", "1"), required=True)
    assemble_parser.add_argument("--source-date-epoch", required=True, type=int)
    assemble_parser.add_argument("--release-signing-fingerprint", default="")
    assemble_parser.add_argument("--updater-sha256")
    assemble_parser.add_argument("--packages-jsonl", required=True)
    assemble_parser.add_argument("--output", required=True)
    assemble_parser.set_defaults(handler=command_assemble_provenance)
    return argument_parser


def main() -> int:
    arguments = parser().parse_args()
    try:
        arguments.handler(arguments)
    except (OSError, ProvenanceError) as error:
        print(f"package provenance error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
