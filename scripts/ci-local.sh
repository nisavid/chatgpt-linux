#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

CI_PACKAGE_VERSION="${CI_PACKAGE_VERSION:-}"
CI_CACHE_DIR="${CI_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/chatgpt-linux-ci}"
CI_WORKSPACE_ROOTS=()
CI_BASE_PROTECTED_PATHS=()
CI_PROTECTED_PATHS=()
CI_PROTECTED_PATHS_INITIALIZED=0
CI_ACTIVE_CHILD_PID=""

IMAGE_UBUNTU_24="${CI_IMAGE_UBUNTU_24:-docker.io/library/ubuntu:24.04@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b}"
IMAGE_UBUNTU_22="${CI_IMAGE_UBUNTU_22:-docker.io/library/ubuntu:22.04@sha256:962f6cadeae0ea6284001009daa4cc9a8c37e75d1f5191cf0eb83fe565b63dd7}"
IMAGE_DEBIAN_12="${CI_IMAGE_DEBIAN_12:-docker.io/library/debian:12@sha256:8a8cd02c5912770b4980228a54d4aff9e4f986f1eb2525d2d371dec5232cefcc}"
IMAGE_FEDORA_42="${CI_IMAGE_FEDORA_42:-docker.io/library/fedora:42@sha256:99e203b80b1c3d8f7e161ec10a68fd02b081ef83a3963553e513c82846b97814}"
IMAGE_ARCH_BASE_DEVEL="${CI_IMAGE_ARCH_BASE_DEVEL:-docker.io/library/archlinux:base-devel@sha256:fdff15f24df062598faebf380430955a9bd2109736e179ebb354f1208f725774}"
IMAGE_NIX="${CI_IMAGE_NIX:-docker.io/nixos/nix:latest@sha256:bf1d938835ab96312f098fa6c2e9cab367728e0aad0646ee3e02a787c80d8fb8}"

usage() {
    cat <<'HELP'
Usage: ./scripts/ci-local.sh [target...]

Targets:
  pr                         Run the standard pull-request suite: core, deb, rpm, pacman
  all                        Run pr plus install-deps, nix, and official DMG build
  core                       Run shell, Rust, Node patcher, and smoke tests
  deb                        Build and inspect the Debian package
  rpm                        Build and inspect the RPM package
  pacman                     Build and inspect the pacman package
  install-deps               Test install-deps on Ubuntu 22.04, Ubuntu 24.04, Debian 12, and Fedora 42
  install-deps:ubuntu-22.04  Test install-deps on one apt image
  install-deps:ubuntu-24.04  Test install-deps on one apt image
  install-deps:debian-12     Test install-deps on one apt image
  install-deps:fedora-42     Test install-deps on one dnf5 image
  nix                        Run the heavy Nix flake build checks
  official-dmg               Build the app against the official OpenAI DMG
  upstream                   Legacy alias for official-dmg

Environment:
  CI_CONTAINER_ENGINE=docker|podman
  CI_PACKAGE_VERSION=<opt-in override; normally read from the DMG CFBundleShortVersionString>
  CI_DMG_PATH=/path/to/ChatGPT.dmg
  CI_SKIP_PULL=1
  CI_CACHE_DIR=/path/to/cache

Note: every target runs in a disposable current-source snapshot, like an isolated GitHub CI job.
HELP
}

info() {
    echo "[ci-local] $*" >&2
}

error() {
    echo "[ci-local][ERROR] $*" >&2
    exit 1
}

cleanup_ci_workspace_path() {
    local workspace_root="${1:-}"

    [ -n "$workspace_root" ] || return 0
    case "${workspace_root##*/}" in
        chatgpt-ci-workspace.*) ;;
        *) return 0 ;;
    esac
    if [ -d "$workspace_root" ] && [ ! -L "$workspace_root" ]; then
        rm -rf -- "$workspace_root"
    fi
}

cleanup_ci_workspaces() {
    local workspace_root

    for workspace_root in "${CI_WORKSPACE_ROOTS[@]}"; do
        cleanup_ci_workspace_path "$workspace_root"
    done
}

stop_active_ci_child() {
    local signal="$1"
    local child_pid="${CI_ACTIVE_CHILD_PID:-}"
    local attempt

    [ -n "$child_pid" ] || return 0
    if kill -0 "$child_pid" 2>/dev/null; then
        kill -s "$signal" "$child_pid" 2>/dev/null || true
        for attempt in {1..20}; do
            kill -0 "$child_pid" 2>/dev/null || break
            sleep 0.05
        done
        if kill -0 "$child_pid" 2>/dev/null; then
            kill -KILL "$child_pid" 2>/dev/null || true
        fi
    fi
    wait "$child_pid" 2>/dev/null || true
    CI_ACTIVE_CHILD_PID=""
}

run_tracked_ci_child() {
    local status

    "$@" &
    CI_ACTIVE_CHILD_PID=$!
    if wait "$CI_ACTIVE_CHILD_PID"; then
        status=0
    else
        status=$?
    fi
    CI_ACTIVE_CHILD_PID=""
    return "$status"
}

exit_after_ci_cleanup() {
    local status="$1"
    local signal="$2"

    trap - EXIT HUP INT TERM
    stop_active_ci_child "$signal"
    cleanup_ci_workspaces
    exit "$status"
}

isolated_ci_git() {
    local git_bin="$1"
    local isolated_home="$2"
    shift 2

    env -i \
        HOME="$isolated_home" \
        XDG_CONFIG_HOME="$isolated_home/config" \
        GIT_CONFIG_NOSYSTEM=1 \
        LC_ALL=C \
        PATH=/usr/bin:/bin \
        "$git_bin" "$@"
}

paths_overlap() {
    local first="$1"
    local second="$2"

    [ "$first" = "/" ] ||
        [ "$second" = "/" ] ||
        [ "$first" = "$second" ] ||
        [[ "$first" == "$second"/* ]] ||
        [[ "$second" == "$first"/* ]]
}

initialize_ci_protected_paths() {
    local git_bin
    local git_dir
    local git_common_dir

    [ "$CI_PROTECTED_PATHS_INITIALIZED" = "0" ] || return 0
    git_bin="$(type -P git)"
    [ -n "$git_bin" ] || error "Git is required to validate local CI paths"
    git_dir="$(isolated_ci_git "$git_bin" /nonexistent \
        -C "$REPO_DIR" -c core.fsmonitor=false rev-parse --absolute-git-dir)"
    git_common_dir="$(isolated_ci_git "$git_bin" /nonexistent \
        -C "$REPO_DIR" -c core.fsmonitor=false rev-parse --path-format=absolute --git-common-dir)"

    CI_BASE_PROTECTED_PATHS=(
        "$(realpath -e -- "$REPO_DIR")"
        "$(realpath -e -- "$git_dir")"
        "$(realpath -e -- "$git_common_dir")"
    )
    CI_PROTECTED_PATHS=("${CI_BASE_PROTECTED_PATHS[@]}")
    CI_PROTECTED_PATHS_INITIALIZED=1
}

assert_ci_path_isolated() {
    local canonical_path="$1"
    local label="$2"
    local protected_path

    initialize_ci_protected_paths
    for protected_path in "${CI_PROTECTED_PATHS[@]}"; do
        if paths_overlap "$canonical_path" "$protected_path"; then
            error "$label mount overlaps protected source or Git metadata or CI paths: $canonical_path"
        fi
    done
}

assert_ci_creation_parent_isolated() {
    local parent_path="$1"
    local label="$2"
    local canonical_parent
    local protected_path

    canonical_parent="$(realpath -e -- "$parent_path")" \
        || error "Could not resolve $label parent: $parent_path"
    [ -d "$canonical_parent" ] || error "$label parent is not a directory: $parent_path"
    initialize_ci_protected_paths
    for protected_path in "${CI_PROTECTED_PATHS[@]}"; do
        if [ "$canonical_parent" = "$protected_path" ] || [[ "$canonical_parent" == "$protected_path"/* ]]; then
            error "$label parent is inside protected source or Git metadata: $canonical_parent"
        fi
    done
}

assert_existing_ancestor_directory() {
    local intended_path="$1"
    local label="$2"
    local existing_ancestor="$intended_path"

    while [ ! -e "$existing_ancestor" ] && [ ! -L "$existing_ancestor" ]; do
        [ "$existing_ancestor" != "/" ] || break
        existing_ancestor="${existing_ancestor%/*}"
        [ -n "$existing_ancestor" ] || existing_ancestor="/"
    done
    [ -d "$existing_ancestor" ] || error "$label path has a non-directory ancestor: $existing_ancestor"
    realpath -e -- "$existing_ancestor" >/dev/null \
        || error "Could not resolve existing $label ancestor: $existing_ancestor"
}

assert_path_can_be_created() {
    local requested_path="$1"
    local label="$2"
    local intended_path

    intended_path="$(realpath -m -- "$requested_path")" \
        || error "Could not resolve requested $label path: $requested_path"
    assert_ci_path_isolated "$intended_path" "$label"
    assert_existing_ancestor_directory "$intended_path" "$label"
}

prepare_ci_mount_directory() {
    local requested_dir="$1"
    local label="$2"
    local -n _canonical_dir="$3"
    local canonical_dir

    assert_path_can_be_created "$requested_dir" "$label"
    mkdir -p -- "$requested_dir"
    canonical_dir="$(realpath -e -- "$requested_dir")" \
        || error "Could not resolve $label mount after creation: $requested_dir"
    [ -d "$canonical_dir" ] && [ ! -L "$requested_dir" ] \
        || error "$label mount is not a real directory: $requested_dir"
    assert_ci_path_isolated "$canonical_dir" "$label"
    CI_PROTECTED_PATHS+=("$canonical_dir")
    _canonical_dir="$canonical_dir"
}

prepare_ci_mount_file() {
    local requested_file="$1"
    local label="$2"
    local create_file="$3"
    local -n _canonical_file="$4"
    local intended_file
    local parent_dir
    local canonical_file

    intended_file="$(realpath -m -- "$requested_file")" \
        || error "Could not resolve requested $label path: $requested_file"
    assert_ci_path_isolated "$intended_file" "$label"
    parent_dir="${intended_file%/*}"
    [ -n "$parent_dir" ] || parent_dir="/"
    assert_existing_ancestor_directory "$parent_dir" "$label"

    if [ "$create_file" = "1" ]; then
        mkdir -p -- "$parent_dir"
        [ -e "$intended_file" ] || : > "$intended_file"
    fi

    [ -f "$intended_file" ] && [ ! -L "$intended_file" ] \
        || error "$label mount must be an existing regular file: $requested_file"
    canonical_file="$(realpath -e -- "$intended_file")" \
        || error "Could not resolve $label mount: $requested_file"
    assert_ci_path_isolated "$canonical_file" "$label"
    CI_PROTECTED_PATHS+=("$canonical_file")
    _canonical_file="$canonical_file"
}

assert_ci_source_path_safe() {
    local relative_path="$1"
    local remainder="$relative_path"
    local component
    local prefix=""
    local candidate

    case "/$relative_path/" in
        //*|*/../*|*/./*) error "Unsafe tracked source path: $relative_path" ;;
    esac

    # Bash cannot bind these checks to directory descriptors. This rejects
    # static symlink substitution, but a same-UID process could still race a
    # component replacement before the snapshot copy reads the file below.
    while [[ "$remainder" == */* ]]; do
        component="${remainder%%/*}"
        remainder="${remainder#*/}"
        prefix="${prefix:+$prefix/}$component"
        candidate="$REPO_DIR/$prefix"

        [ ! -L "$candidate" ] || error "Refusing tracked path through symlink ancestor: $relative_path"
        if [ -e "$candidate" ] && [ ! -d "$candidate" ]; then
            error "Refusing tracked path through non-directory ancestor: $relative_path"
        fi
    done

    candidate="$REPO_DIR/$relative_path"
    if [ -L "$candidate" ] || [ -f "$candidate" ]; then
        return 0
    fi
    if [ ! -e "$candidate" ]; then
        return 1
    fi
    error "Refusing non-regular tracked source path: $relative_path"
}

prepare_ci_workspace() {
    local -n _workspace_root="$1"
    local -n _workspace="$2"
    local git_bin
    local workspace_root
    local workspace
    local isolated_home
    local empty_template
    local index_entries
    local source_paths
    local entry
    local metadata
    local relative_path
    local mode
    local stage
    local source_path
    local destination_path
    local destination_parent
    local link_target

    git_bin="$(type -P git)"
    [ -n "$git_bin" ] || error "Git is required to prepare the local CI source snapshot"
    initialize_ci_protected_paths
    assert_ci_creation_parent_isolated "${TMPDIR:-/tmp}" "CI workspace"

    workspace_root="$(mktemp -d "${TMPDIR:-/tmp}/chatgpt-ci-workspace.XXXXXX")"
    workspace="$workspace_root/work"
    isolated_home="$workspace_root/home"
    empty_template="$workspace_root/empty-template"
    index_entries="$workspace_root/index-entries"
    source_paths="$workspace_root/source-paths"
    CI_WORKSPACE_ROOTS+=("$workspace_root")
    CI_PROTECTED_PATHS+=("$(realpath -e -- "$workspace_root")")

    mkdir -p "$workspace" "$isolated_home/config" "$empty_template"
    chmod 700 "$workspace_root" "$workspace" "$isolated_home" "$isolated_home/config" "$empty_template"
    : > "$source_paths"

    isolated_ci_git "$git_bin" "$isolated_home" \
        -C "$REPO_DIR" -c core.fsmonitor=false ls-files --stage -z > "$index_entries"
    while IFS= read -r -d '' entry; do
        metadata="${entry%%$'\t'*}"
        relative_path="${entry#*$'\t'}"
        [ "$metadata" != "$entry" ] || error "Could not parse a tracked source entry"
        IFS=' ' read -r mode _ stage <<< "$metadata"

        [ "$stage" = "0" ] || error "Refusing unmerged tracked source path: $relative_path"
        [ "$mode" != "160000" ] || error "Refusing unsupported Git submodule path: $relative_path"
        case "$mode" in
            100644|100755|120000) ;;
            *) error "Refusing unsupported Git mode $mode for path: $relative_path" ;;
        esac

        if assert_ci_source_path_safe "$relative_path"; then
            source_path="$REPO_DIR/$relative_path"
            destination_path="$workspace/$relative_path"
            destination_parent="${destination_path%/*}"
            mkdir -p -- "$destination_parent"
            if [ -L "$source_path" ]; then
                link_target="$(readlink -- "$source_path")"
                ln -s -- "$link_target" "$destination_path"
            else
                cp --preserve=mode -- "$source_path" "$destination_path"
            fi
            printf '%s\0' "$relative_path" >> "$source_paths"
        fi
    done < "$index_entries"

    [ -s "$source_paths" ] || error "The local CI source snapshot has no materialized tracked files"

    isolated_ci_git "$git_bin" "$isolated_home" \
        init -q --initial-branch=ci-snapshot --template="$empty_template" "$workspace"
    isolated_ci_git "$git_bin" "$isolated_home" -C "$workspace" config core.autocrlf false
    isolated_ci_git "$git_bin" "$isolated_home" -C "$workspace" config core.filemode true
    isolated_ci_git "$git_bin" "$isolated_home" -C "$workspace" config core.logAllRefUpdates false
    isolated_ci_git "$git_bin" "$isolated_home" -C "$workspace" config core.symlinks true
    isolated_ci_git "$git_bin" "$isolated_home" \
        --literal-pathspecs \
        -C "$workspace" \
        add --force --pathspec-from-file="$source_paths" --pathspec-file-nul
    isolated_ci_git "$git_bin" "$isolated_home" \
        -C "$workspace" \
        -c user.name=local-ci \
        -c user.email=local-ci.invalid \
        commit -qm "local CI snapshot" --no-verify --no-gpg-sign

    _workspace_root="$workspace_root"
    _workspace="$workspace"
}

trap cleanup_ci_workspaces EXIT
trap 'exit_after_ci_cleanup 129 HUP' HUP
trap 'exit_after_ci_cleanup 130 INT' INT
trap 'exit_after_ci_cleanup 143 TERM' TERM

container_engine() {
    if [ -n "${CI_CONTAINER_ENGINE:-}" ]; then
        command -v "$CI_CONTAINER_ENGINE" >/dev/null 2>&1 || error "CI_CONTAINER_ENGINE is not available: $CI_CONTAINER_ENGINE"
        echo "$CI_CONTAINER_ENGINE"
        return
    fi

    if command -v docker >/dev/null 2>&1; then
        echo docker
        return
    fi
    if command -v podman >/dev/null 2>&1; then
        echo podman
        return
    fi

    error "Docker or Podman is required. Install one, or set CI_CONTAINER_ENGINE explicitly."
}

image_for_key() {
    case "$1" in
        ubuntu-24.04) echo "$IMAGE_UBUNTU_24" ;;
        ubuntu-22.04) echo "$IMAGE_UBUNTU_22" ;;
        debian-12) echo "$IMAGE_DEBIAN_12" ;;
        fedora-42) echo "$IMAGE_FEDORA_42" ;;
        archlinux-base-devel) echo "$IMAGE_ARCH_BASE_DEVEL" ;;
        nix) echo "$IMAGE_NIX" ;;
        *) error "Unknown CI image key: $1" ;;
    esac
}

image_key_for_job() {
    case "$1" in
        core|deb|official-dmg|upstream) echo "ubuntu-24.04" ;;
        rpm) echo "fedora-42" ;;
        pacman) echo "archlinux-base-devel" ;;
        nix) echo "nix" ;;
        *) error "No default image for job: $1" ;;
    esac
}

mount_github_summary_args() {
    local -n _args="$1"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        local summary_file
        prepare_ci_mount_file "$GITHUB_STEP_SUMMARY" "GitHub summary" 1 summary_file
        _args+=(
            -e "GITHUB_STEP_SUMMARY=/tmp/chatgpt-ci-github-step-summary"
            -v "$summary_file:/tmp/chatgpt-ci-github-step-summary:rw"
        )
    fi
}

mount_official_dmg_args() {
    local -n _args="$1"
    if [ -n "${CI_DMG_PATH:-}" ]; then
        if [ "${CI_DMG_PATH#/}" = "$CI_DMG_PATH" ]; then
            _args+=(-e "CI_DMG_PATH=$CI_DMG_PATH")
            return
        fi

        local dmg_file
        prepare_ci_mount_file "$CI_DMG_PATH" "official DMG input" 0 dmg_file
        _args+=(
            -e "CI_DMG_PATH=/tmp/chatgpt-ci-input.dmg"
            -v "$dmg_file:/tmp/chatgpt-ci-input.dmg:ro"
        )
    fi
}

run_container_job() {
    local job="$1"
    local image_key="$2"
    local engine
    local image
    local ci_workspace_root
    local ci_workspace
    local ci_cache_dir
    local status
    engine="$(container_engine)"
    image="$(image_for_key "$image_key")"

    if [ "${CI_SKIP_PULL:-0}" != "1" ]; then
        info "Pulling $image_key image"
        run_tracked_ci_child "$engine" pull "$image" >/dev/null
    fi

    initialize_ci_protected_paths
    CI_PROTECTED_PATHS=("${CI_BASE_PROTECTED_PATHS[@]}")
    prepare_ci_workspace ci_workspace_root ci_workspace
    prepare_ci_mount_directory "$CI_CACHE_DIR" "CI cache" ci_cache_dir

    local -a args=(
        run
        --rm
        -e "CI_JOB=$job"
        -e "CI_IMAGE_KEY=$image_key"
        -e "CI_HOST_UID=$(id -u)"
        -e "CI_HOST_GID=$(id -g)"
        -e "CARGO_TERM_COLOR=${CARGO_TERM_COLOR:-always}"
        -e "OFFICIAL_DMG_URL=${OFFICIAL_DMG_URL:-${UPSTREAM_DMG_URL:-https://persistent.oaistatic.com/codex-app-prod/ChatGPT.dmg}}"
        -e "OFFICIAL_DMG_PATH=${OFFICIAL_DMG_PATH:-${UPSTREAM_DMG_PATH:-/ci-cache/official-dmg/ChatGPT.dmg}}"
        -v "$ci_workspace:/work"
        -v "$ci_cache_dir:/ci-cache"
        -w /work
    )
    if [ -n "$CI_PACKAGE_VERSION" ]; then
        args+=(
            -e "CI_PACKAGE_VERSION=$CI_PACKAGE_VERSION"
            -e "PACKAGE_VERSION=$CI_PACKAGE_VERSION"
        )
    fi

    if [ -n "${OFFICIAL_DMG_CACHE_HIT:-${UPSTREAM_DMG_CACHE_HIT:-}}" ]; then
        args+=(-e "OFFICIAL_DMG_CACHE_HIT=${OFFICIAL_DMG_CACHE_HIT:-${UPSTREAM_DMG_CACHE_HIT:-}}")
    fi

    mount_github_summary_args args
    if [ "$job" = "official-dmg" ] || [ "$job" = "upstream" ]; then
        mount_official_dmg_args args
    elif [ -n "${CI_DMG_PATH:-}" ]; then
        args+=(-e "CI_DMG_PATH=$CI_DMG_PATH")
    fi

    info "Running $job in $image_key"
    if run_tracked_ci_child \
        "$engine" "${args[@]}" "$image" bash /work/scripts/ci/container-entrypoint.sh "$job"; then
        status=0
    else
        status=$?
    fi
    cleanup_ci_workspace_path "$ci_workspace_root"
    return "$status"
}

run_target() {
    local target="$1"

    case "$target" in
        -h|--help|help)
            usage
            ;;
        pr)
            run_target core
            run_target deb
            run_target rpm
            run_target pacman
            ;;
        all)
            run_target pr
            run_target install-deps
            run_target nix
            run_target official-dmg
            ;;
        core|deb|rpm|pacman|nix|official-dmg|upstream)
            run_container_job "$target" "$(image_key_for_job "$target")"
            ;;
        install-deps)
            run_target install-deps:ubuntu-22.04
            run_target install-deps:ubuntu-24.04
            run_target install-deps:debian-12
            run_target install-deps:fedora-42
            ;;
        install-deps:ubuntu-22.04)
            run_container_job install-deps ubuntu-22.04
            ;;
        install-deps:ubuntu-24.04)
            run_container_job install-deps ubuntu-24.04
            ;;
        install-deps:debian-12)
            run_container_job install-deps debian-12
            ;;
        install-deps:fedora-42)
            run_container_job install-deps fedora-42
            ;;
        *)
            usage >&2
            error "Unknown target: $target"
            ;;
    esac
}

if [ "$#" -eq 0 ]; then
    set -- pr
fi

for target in "$@"; do
    run_target "$target"
done
