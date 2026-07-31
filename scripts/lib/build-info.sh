#!/bin/bash
# Build provenance metadata written into generated Linux app directories.
#
# Sourced by install.sh. Do not run directly.
# shellcheck shell=bash

write_build_info() {
    local dmg_path="$1"
    local app_dir="$2"

    mkdir -p "$INSTALL_DIR/resources" "$INSTALL_DIR/.chatgpt-linux"
    node "$SCRIPT_DIR/scripts/lib/build-info.js" \
        "$SCRIPT_DIR" \
        "$INSTALL_DIR" \
        "$dmg_path" \
        "$app_dir" \
        "$ELECTRON_VERSION" \
        "$CHATGPT_APP_ID" \
        "$CHATGPT_APP_DISPLAY_NAME"
    info "Build info written"
}
