#!/bin/bash
set -Eeuo pipefail

if [ -n "${CHATGPT_EXAMPLE_INTEGRATION_STAGE_MARKER:-}" ]; then
    printf 'example-stage:%s:%s\n' "${ARCH:-unknown}" "${INSTALL_DIR:-unknown}" > "$CHATGPT_EXAMPLE_INTEGRATION_STAGE_MARKER"
fi

echo "Example port integration stage hook: no-op" >&2
