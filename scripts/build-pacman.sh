#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
. "$REPO_DIR/scripts/lib/package-common.sh"
APP_DIR="${APP_DIR_OVERRIDE:-$REPO_DIR/chatgpt}"
DIST_DIR="${DIST_DIR_OVERRIDE:-$REPO_DIR/dist}"
PKGBUILD_TEMPLATE="$REPO_DIR/packaging/linux/PKGBUILD.template"
INSTALL_HOOKS="$REPO_DIR/packaging/linux/chatgpt.install"
DESKTOP_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt.desktop"
SERVICE_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater.service"
USER_SERVICE_HELPER_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-updater-user-service.sh"
PACKAGED_RUNTIME_TEMPLATE="$REPO_DIR/packaging/linux/chatgpt-packaged-runtime.sh"

PACKAGE_NAME="${PACKAGE_NAME:-chatgpt}"
PACKAGE_VERSION="${PACKAGE_VERSION:-$(default_package_version)}"
ICON_SOURCE="$(resolve_package_icon_source)"
MAX_BUILD_THREADS="${MAX_BUILD_THREADS:-0}"
UPDATER_BINARY_SOURCE="${UPDATER_BINARY_SOURCE:-$REPO_DIR/target/release/chatgpt-updater}"
UPDATER_SERVICE_SOURCE="${UPDATER_SERVICE_SOURCE:-$SERVICE_TEMPLATE}"
PACKAGED_RUNTIME_SOURCE="${PACKAGED_RUNTIME_SOURCE:-$PACKAGED_RUNTIME_TEMPLATE}"

validate_max_build_threads() {
	case "$MAX_BUILD_THREADS" in
	""|*[!0-9]*)
		error "MAX_BUILD_THREADS must be 0 or a positive integer"
		;;
	esac
}

map_arch() {
	case "$(uname -m)" in
	x86_64) echo "x86_64" ;;
	aarch64) echo "aarch64" ;;
	*) error "Unsupported architecture: $(uname -m)" ;;
	esac
}

pacman_version_parts() {
	PACMAN_PKGVER="${PACKAGE_VERSION//+/_}"
	PACMAN_PKGREL="1"
}

write_threaded_makepkg_config() {
	local target="$1"
	local home_dir="${HOME:-}"
	local xdg_config_home="${XDG_CONFIG_HOME:-}"
	local user_makepkg_conf=""

	if [ -z "$xdg_config_home" ] && [ -n "$home_dir" ]; then
		xdg_config_home="$home_dir/.config"
	fi
	if [ -n "$xdg_config_home" ] && [ -r "$xdg_config_home/pacman/makepkg.conf" ]; then
		user_makepkg_conf="$xdg_config_home/pacman/makepkg.conf"
	elif [ -n "$home_dir" ] && [ -r "$home_dir/.makepkg.conf" ]; then
		user_makepkg_conf="$home_dir/.makepkg.conf"
	fi

	{
		if [ -n "${MAKEPKG_CONF:-}" ]; then
			[ -r "$MAKEPKG_CONF" ] || error "MAKEPKG_CONF is not readable: $MAKEPKG_CONF"
			printf '. %q\n' "$MAKEPKG_CONF"
		else
			[ -r /etc/makepkg.conf ] && printf '. %q\n' /etc/makepkg.conf
			local system_makepkg_conf
			for system_makepkg_conf in /etc/makepkg.conf.d/*.conf; do
				[ -r "$system_makepkg_conf" ] && printf '. %q\n' "$system_makepkg_conf"
			done
			[ -n "$user_makepkg_conf" ] && printf '. %q\n' "$user_makepkg_conf"
		fi
		# The generated makepkg configuration expands MAKEFLAGS when sourced.
		# shellcheck disable=SC2016
		printf 'MAKEFLAGS="${MAKEFLAGS:+$MAKEFLAGS }-j%s"\n' "$MAX_BUILD_THREADS"
		printf 'COMPRESSZST=(zstd -c -z -T%s -)\n' "$MAX_BUILD_THREADS"
	} >"$target"
}

main() {
	validate_max_build_threads

	ensure_app_layout
	ensure_file_exists "$PKGBUILD_TEMPLATE" "PKGBUILD template"
	ensure_file_exists "$INSTALL_HOOKS" "install hooks"
	ensure_file_exists "$DESKTOP_TEMPLATE" "desktop template"
	ensure_file_exists "$ICON_SOURCE" "icon"
	ensure_file_exists "$PACKAGED_RUNTIME_SOURCE" "packaged launcher runtime helper"
	if package_with_updater_enabled; then
		ensure_file_exists "$UPDATER_SERVICE_SOURCE" "updater service template"
		ensure_file_exists "$USER_SERVICE_HELPER_TEMPLATE" "updater user service helper"
	else
		info "Building package without chatgpt-updater (PACKAGE_WITH_UPDATER=0)"
	fi
	command -v makepkg >/dev/null 2>&1 || error "makepkg is required (part of pacman)"

	if [ "$(id -u)" -eq 0 ]; then
		error "makepkg cannot run as root. Run this script as a regular user."
	fi

	if package_with_updater_enabled; then
		ensure_updater_binary
	fi

	local arch
	arch="$(map_arch)"
	pacman_version_parts

	local build_root
	build_root="$(mktemp -d)"
	# shellcheck disable=SC2064
	trap "rm -rf '$build_root'" EXIT

	local staging_root="$build_root/staging"
	# Pin PKGEXT so Debian/Ubuntu makepkg (defaults to .pkg.tar.gz) produces .zst for the collector
	local -a makepkg_env=("PKGDEST=$DIST_DIR" "PKGEXT=.pkg.tar.zst")

	if [ "$MAX_BUILD_THREADS" != "0" ]; then
		local makepkg_config="$build_root/makepkg.conf"
		write_threaded_makepkg_config "$makepkg_config"
		makepkg_env+=("MAKEPKG_CONF=$makepkg_config")
		info "Pacman package build/compression threads: $MAX_BUILD_THREADS"
	fi

	stage_native_package_payload "$staging_root" "pacman"

	local package_name
	local pacman_pkgver
	local pacman_pkgrel
	local staging_dir
	local arch_replacement
	package_name="$(sed_escape_replacement "$PACKAGE_NAME")"
	pacman_pkgver="$(sed_escape_replacement "$PACMAN_PKGVER")"
	pacman_pkgrel="$(sed_escape_replacement "$PACMAN_PKGREL")"
	staging_dir="$(sed_escape_replacement "$staging_root")"
	arch_replacement="$(sed_escape_replacement "$arch")"

	local pacman_updater_depends=""
	if package_with_updater_enabled; then
		pacman_updater_depends="    'p7zip'
    'polkit'
    'curl'
    'unzip'
    'gcc'
    'make'"
	fi
	sed \
		-e "s/__PACKAGE_NAME__/$package_name/g" \
		-e "s/__PKGVER__/$pacman_pkgver/g" \
		-e "s/__PKGREL__/$pacman_pkgrel/g" \
		-e "s|__STAGING_DIR__|$staging_dir|g" \
		-e "s/__ARCH__/$arch_replacement/g" \
		"$PKGBUILD_TEMPLATE" | \
	AWK_PACMAN_UPDATER_DEPENDS="$pacman_updater_depends" \
	awk '
		function emit_env(name) {
			if (ENVIRON[name] != "") {
				print ENVIRON[name]
			}
		}
		{
			if ($0 == "__PACMAN_UPDATER_DEPENDS__") { emit_env("AWK_PACMAN_UPDATER_DEPENDS"); next }
			print
		}
	' >"$build_root/PKGBUILD"

	local integration_dependency_lines=""
	local integration_dependencies
	local integration_dependency
	if ! integration_dependencies="$(
		port_integration_package_dependencies pacman "$staging_root/opt/$PACKAGE_NAME"
	)"; then
		error "Failed to render port integration dependencies for pacman"
	fi
	while IFS= read -r integration_dependency; do
		[ -n "$integration_dependency" ] || continue
		integration_dependency_lines+="    '$integration_dependency'"$'\n'
	done <<<"$integration_dependencies"
	replace_literal_file_token \
		"$build_root/PKGBUILD" \
		"__PORT_INTEGRATION_DEPENDENCIES__" \
		"$integration_dependency_lines"

	local updater_service_preamble=""
	local updater_post_install=""
	local updater_pre_remove="    :"
	local updater_post_remove="    :"
	if package_with_updater_enabled; then
		updater_service_preamble="SERVICE_HELPER=\"/usr/lib/$PACKAGE_NAME/update-builder/packaging/linux/chatgpt-updater-user-service.sh\"
if [ -f \"\$SERVICE_HELPER\" ]; then
    # shellcheck source=/usr/lib/$PACKAGE_NAME/update-builder/packaging/linux/chatgpt-updater-user-service.sh
    . \"\$SERVICE_HELPER\"
fi"
		updater_post_install="    if [ -f \"\$SERVICE_HELPER\" ]; then
        chatgpt_ensure_user_service_running || true
    fi"
		updater_pre_remove="    if [ -f \"\$SERVICE_HELPER\" ]; then
        chatgpt_cleanup_user_service stop || true
        chatgpt_cleanup_user_service disable || true
    fi"
		updater_post_remove="    if [ -f \"\$SERVICE_HELPER\" ]; then
        chatgpt_reload_user_managers || true
    fi"
		AWK_PACKAGE_NAME="$PACKAGE_NAME" \
		AWK_UPDATER_SERVICE_PREAMBLE="$updater_service_preamble" \
		AWK_UPDATER_POST_INSTALL="$updater_post_install" \
		AWK_UPDATER_PRE_REMOVE="$updater_pre_remove" \
		AWK_UPDATER_POST_REMOVE="$updater_post_remove" \
		awk '
			function emit_env(name) {
				if (ENVIRON[name] != "") {
					print ENVIRON[name]
				}
			}
			{
				if ($0 == "__UPDATER_SERVICE_PREAMBLE__") { emit_env("AWK_UPDATER_SERVICE_PREAMBLE"); next }
				if ($0 == "__UPDATER_POST_INSTALL__") { emit_env("AWK_UPDATER_POST_INSTALL"); next }
				if ($0 == "__UPDATER_PRE_REMOVE__") { emit_env("AWK_UPDATER_PRE_REMOVE"); next }
				if ($0 == "__UPDATER_POST_REMOVE__") { emit_env("AWK_UPDATER_POST_REMOVE"); next }
				gsub(/__PACKAGE_NAME__/, ENVIRON["AWK_PACKAGE_NAME"])
				gsub(/\/opt\/chatgpt/, "/opt/" ENVIRON["AWK_PACKAGE_NAME"])
				gsub(/\/usr\/lib\/chatgpt/, "/usr/lib/" ENVIRON["AWK_PACKAGE_NAME"])
				print
			}
		' "$INSTALL_HOOKS" >"$build_root/${PACKAGE_NAME}.install"
	else
		write_no_updater_pacman_install_hooks "$build_root/${PACKAGE_NAME}.install"
	fi

	mkdir -p "$DIST_DIR"
	info "Building ${PACKAGE_NAME}-${PACMAN_PKGVER}-${PACMAN_PKGREL}-${arch}.pkg.tar.zst"

	# Build the package; --nodeps skips dependency checks at build time (they
	# are enforced by pacman at install time), and --skipinteg is needed
	# because we have no remote sources to verify.
	(cd "$build_root" && env "${makepkg_env[@]}" makepkg -f --nodeps --skipinteg 2>&1) >&2

	local pkg_file=""
	pkg_file="$(find "$DIST_DIR" \( -name "${PACKAGE_NAME}-${PACMAN_PKGVER}-*.pkg.tar.zst" \
		-o -name "${PACKAGE_NAME}-${PACMAN_PKGVER}-*.pkg.tar.xz" \) \
		-print -quit 2>/dev/null || true)"
	[ -f "$pkg_file" ] || error "makepkg did not produce a package"

	if command -v pacman >/dev/null 2>&1; then
		info "Inspecting package metadata"
		pacman -Qip "$pkg_file" >&2
		info "Inspecting package contents"
		pacman -Qlp "$pkg_file" >&2
	fi

	local pkg_basename
	local latest_suffix
	pkg_basename="$(basename "$pkg_file")"
	latest_suffix="${pkg_basename#"${PACKAGE_NAME}"-"${PACMAN_PKGVER}"-"${PACMAN_PKGREL}"-"${arch}"}"
	[ -n "$latest_suffix" ] || latest_suffix=".pkg.tar.zst"
	ln -sfn "$pkg_basename" "$DIST_DIR/${PACKAGE_NAME}-latest${latest_suffix}"

	info "Built package: $pkg_file"
	printf '%s\n' "$pkg_file"
}

main "$@"
