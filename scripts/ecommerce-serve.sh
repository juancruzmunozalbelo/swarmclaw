#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/groups/main/ecommerce"

cd "${APP_DIR}"
exec ./node_modules/.bin/vite dev --host 127.0.0.1 --port 5173 --strictPort
