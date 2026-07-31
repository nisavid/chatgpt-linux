#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="${APP_DIR_OVERRIDE:-$REPO_DIR/chatgpt}"
DIST_DIR="${DIST_DIR_OVERRIDE:-$REPO_DIR/dist}"
SPEC_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt.spec"
DESKTOP_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt.desktop"
SERVICE_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater.service"
USER_SERVICE_HELPER_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
PACKAGED_RUNTIME_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-packaged-runtime.sh"

# Keep the installed update-builder payload aligned with the other package formats.
# shellcheck source=scripts/lib/package-common.sh
. "$REPO_DIR/scripts/lib/package-common.sh"

PACKAGE_NAME="${PACKAGE_NAME:-chatgpt}"
PACKAGE_VERSION="${PACKAGE_VERSION:-$(default_package_version)}"
MAX_BUILD_THREADS="${MAX_BUILD_THREADS:-0}"
RPM_BINARY_PAYLOAD="${RPM_BINARY_PAYLOAD:-}"
UPDATER_BINARY_SOURCE="${UPDATER_BINARY_SOURCE:-$REPO_DIR/target/release/chatgpt-updater}"
UPDATER_SERVICE_SOURCE="${UPDATER_SERVICE_SOURCE:-$SERVICE_TEMPLATE}"
PACKAGED_RUNTIME_SOURCE="${PACKAGED_RUNTIME_SOURCE:-$PACKAGED_RUNTIME_TEMPLATE}"
ICON_SOURCE="$(resolve_package_icon_source)"

validate_max_build_threads() {
    case "$MAX_BUILD_THREADS" in
        ""|*[!0-9]*)
            error "MAX_BUILD_THREADS must be 0 or a positive integer"
            ;;
    esac
}

map_arch() {
    case "$(uname -m)" in
        x86_64)  echo "x86_64" ;;
        aarch64) echo "aarch64" ;;
        armv7l)  echo "armv7hl" ;;
        *)       error "Unsupported architecture: $(uname -m)" ;;
    esac
}

# RPM version must not contain '+'; split PACKAGE_VERSION on '+' into version and release
rpm_version_parts() {
    local base
    base="${PACKAGE_VERSION%%+*}"
    local hash
    hash="${PACKAGE_VERSION#*+}"
    if [ "$base" = "$PACKAGE_VERSION" ]; then
        hash="1"
    fi
    RPM_VERSION="$base"
    RPM_RELEASE="$hash"
}

main() {
    validate_max_build_threads
    if [ -z "$RPM_BINARY_PAYLOAD" ] && [ "$MAX_BUILD_THREADS" != "0" ]; then
        RPM_BINARY_PAYLOAD="w19T${MAX_BUILD_THREADS}.zstdio"
    fi

    ensure_app_layout
    [ -f "$SPEC_TEMPLATE" ] || error "Missing spec template: $SPEC_TEMPLATE"
    [ -f "$DESKTOP_TEMPLATE" ] || error "Missing desktop template: $DESKTOP_TEMPLATE"
    [ -f "$ICON_SOURCE" ] || error "Missing icon: $ICON_SOURCE"
    [ -f "$PACKAGED_RUNTIME_SOURCE" ] || error "Missing packaged launcher runtime helper: $PACKAGED_RUNTIME_SOURCE"
    if package_with_updater_enabled; then
        [ -f "$UPDATER_SERVICE_SOURCE" ] || error "Missing updater service template: $UPDATER_SERVICE_SOURCE"
        [ -f "$USER_SERVICE_HELPER_TEMPLATE" ] || error "Missing updater user service helper: $USER_SERVICE_HELPER_TEMPLATE"
    else
        info "Building package without chatgpt-updater (PACKAGE_WITH_UPDATER=0)"
    fi
    command -v rpmbuild >/dev/null 2>&1 || error "rpmbuild is required (install rpm-build)"

    if package_with_updater_enabled; then
        ensure_updater_binary
    fi

    local arch
    arch="$(map_arch)"
    rpm_version_parts
    local rpm_ver="$RPM_VERSION"
    local rpm_rel="$RPM_RELEASE"

    local build_root
    build_root="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$build_root'" EXIT

    local staging_root="$build_root/STAGING"

    stage_common_package_files "$staging_root"
    stage_optional_update_builder_bundle "$staging_root"

    cat > "$staging_root/usr/bin/$PACKAGE_NAME" <<SCRIPT
#!/usr/bin/env bash
exec /opt/$PACKAGE_NAME/start.sh "\$@"
SCRIPT
    chmod 0755 "$staging_root/usr/bin/$PACKAGE_NAME"
    stage_port_integration_package_resources "$staging_root" "rpm"
    run_port_integration_package_hooks "$staging_root" "rpm"
    normalize_package_payload_permissions "$staging_root"
    restore_port_integration_payload_permissions "$staging_root"
    restore_port_integration_package_resource_permissions "$staging_root" "rpm"

    local spec_file="$build_root/chatgpt.spec"
    local integration_dependency_suffix
    local integration_files
    local updater_requires=""
    local updater_description=""
    local updater_files=""
    local updater_post=""
    local updater_preun=""
    local updater_postun=""
    if package_with_updater_enabled; then
        updater_requires="Requires:       /usr/bin/7z, polkit, curl, unzip, gcc-c++, make"
        updater_description="Local auto-updates rebuild a Linux package from the official OpenAI ChatGPT.dmg and therefore
use the bundled managed Node.js runtime plus the local packaging toolchain listed in Requires."
        updater_files="/usr/bin/chatgpt-updater
/usr/lib/systemd/user/chatgpt-updater.service
/usr/share/polkit-1/actions/com.github.nisavid.chatgpt.update.policy"
        updater_post="SERVICE_HELPER=/usr/lib/$PACKAGE_NAME/update-builder/packaging/linux/chatgpt-updater-user-service.sh
if [ -f \"\$SERVICE_HELPER\" ]; then
    . \"\$SERVICE_HELPER\"
    if [ \${1:-0} -eq 1 ]; then
        chatgpt_ensure_user_service_running || true
    else
        chatgpt_start_enabled_user_service || true
    fi
fi"
        updater_preun="SERVICE_HELPER=/usr/lib/$PACKAGE_NAME/update-builder/packaging/linux/chatgpt-updater-user-service.sh
[ -f \"\$SERVICE_HELPER\" ] && . \"\$SERVICE_HELPER\"
if [ \$1 -eq 0 ] && [ -f \"\$SERVICE_HELPER\" ]; then
    chatgpt_cleanup_user_service stop || true
    chatgpt_cleanup_user_service disable || true
fi"
        updater_postun="SERVICE_HELPER=/usr/lib/$PACKAGE_NAME/update-builder/packaging/linux/chatgpt-updater-user-service.sh
if [ -f \"\$SERVICE_HELPER\" ]; then
    . \"\$SERVICE_HELPER\"
    chatgpt_reload_user_managers || true
fi"
    else
        updater_description="This package was built without chatgpt-updater. Update manually from a trusted checkout."
        updater_post="CLEANUP_HELPER=/usr/lib/$PACKAGE_NAME/no-updater-transition-cleanup.sh
if [ -f \"\$CLEANUP_HELPER\" ]; then
    . \"\$CLEANUP_HELPER\"
    chatgpt_no_updater_cleanup_update_manager_service || true
fi"
        updater_preun="$updater_post"
    fi
    if ! integration_dependency_suffix="$(
        port_integration_package_dependency_suffix rpm "$staging_root/opt/$PACKAGE_NAME"
    )"; then
        error "Failed to render port integration dependencies for rpm"
    fi
    if ! integration_files="$(
        port_integration_package_files rpm "$staging_root/opt/$PACKAGE_NAME"
    )"; then
        error "Failed to render port integration files for rpm"
    fi
    AWK_PACKAGE_NAME="$PACKAGE_NAME" \
    AWK_RPM_VERSION="$rpm_ver" \
    AWK_RPM_RELEASE="$rpm_rel" \
    AWK_RPM_STAGING_DIR="$staging_root" \
    AWK_ARCH="$arch" \
    AWK_UPDATER_REQUIRES="$updater_requires" \
    AWK_UPDATER_DESCRIPTION="$updater_description" \
    AWK_UPDATER_FILES="$updater_files" \
    AWK_UPDATER_POST="$updater_post" \
    AWK_UPDATER_PREUN="$updater_preun" \
    AWK_UPDATER_POSTUN="$updater_postun" \
    awk '
        function emit_env(name) {
            if (ENVIRON[name] != "") {
                print ENVIRON[name]
            }
        }
        {
            if ($0 == "__UPDATER_REQUIRES__") { emit_env("AWK_UPDATER_REQUIRES"); next }
            if ($0 == "__UPDATER_DESCRIPTION__") { emit_env("AWK_UPDATER_DESCRIPTION"); next }
            if ($0 == "__UPDATER_FILES__") { emit_env("AWK_UPDATER_FILES"); next }
            if ($0 == "__UPDATER_POST__") { emit_env("AWK_UPDATER_POST"); next }
            if ($0 == "__UPDATER_PREUN__") { emit_env("AWK_UPDATER_PREUN"); next }
            if ($0 == "__UPDATER_POSTUN__") { emit_env("AWK_UPDATER_POSTUN"); next }
            gsub(/__PACKAGE_NAME__/, ENVIRON["AWK_PACKAGE_NAME"])
            gsub(/__RPM_VERSION__/, ENVIRON["AWK_RPM_VERSION"])
            gsub(/__RPM_RELEASE__/, ENVIRON["AWK_RPM_RELEASE"])
            gsub(/__RPM_STAGING_DIR__/, ENVIRON["AWK_RPM_STAGING_DIR"])
            gsub(/__ARCH__/, ENVIRON["AWK_ARCH"])
            print
        }
    ' "$SPEC_TEMPLATE" > "$spec_file"
    replace_literal_file_token \
        "$spec_file" \
        "__PORT_INTEGRATION_DEPENDENCIES__" \
        "$integration_dependency_suffix"
    replace_literal_file_token \
        "$spec_file" \
        "__PORT_INTEGRATION_FILES__" \
        "$integration_files"

    local rpmbuild_dir="$build_root/rpmbuild"
    mkdir -p \
        "$rpmbuild_dir/RPMS" \
        "$rpmbuild_dir/SRPMS" \
        "$rpmbuild_dir/BUILD" \
        "$rpmbuild_dir/SOURCES" \
        "$rpmbuild_dir/SPECS"

    mkdir -p "$DIST_DIR"
    info "Building $PACKAGE_NAME-${rpm_ver}-${rpm_rel}.${arch}.rpm"
    local -a rpmbuild_args=(
        -bb
        --define "_rpmdir $rpmbuild_dir/RPMS" \
        --define "_srcrpmdir $rpmbuild_dir/SRPMS" \
        --define "_builddir $rpmbuild_dir/BUILD" \
        --define "_sourcedir $rpmbuild_dir/SOURCES" \
        --define "_specdir $build_root" \
        --define "_build_name_fmt %%{NAME}-%%{VERSION}-%%{RELEASE}.%%{ARCH}.rpm" \
    )
    if [ -n "$RPM_BINARY_PAYLOAD" ]; then
        info "RPM binary payload compression: $RPM_BINARY_PAYLOAD"
        rpmbuild_args+=(--define "_binary_payload $RPM_BINARY_PAYLOAD")
    else
        info "RPM binary payload compression: tool default"
    fi
    rpmbuild_args+=("$spec_file")
    rpmbuild "${rpmbuild_args[@]}" >&2

    local rpm_file
    rpm_file="$(find "$rpmbuild_dir/RPMS" -name "*.rpm" | head -n 1)"
    [ -f "$rpm_file" ] || error "rpmbuild did not produce an RPM"

    local output_file="$DIST_DIR/${PACKAGE_NAME}-${rpm_ver}-${rpm_rel}.${arch}.rpm"
    cp "$rpm_file" "$output_file"
    info "Built package: $output_file"
}

main "$@"
