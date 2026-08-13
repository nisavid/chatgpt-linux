#!/usr/bin/env bash
set -Eeo pipefail

if [ -z "${CHATGPT_ELECTRON_DISABLE_GPU_COMPOSITING+x}" ]; then
    printf '%s\n' 'env CHATGPT_ELECTRON_DISABLE_GPU_COMPOSITING=0'
fi
