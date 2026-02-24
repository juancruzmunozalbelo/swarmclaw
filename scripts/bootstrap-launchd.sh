#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
UID_NUM="$(id -u)"
NODE_PATH_BIN="${NODE_PATH_BIN:-$(command -v node)}"

if [[ -z "${NODE_PATH_BIN:-}" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

TEMPLATES=(
  "com.nanoclaw.plist"
  "com.nanoclaw.stuck-monitor.plist"
  "com.nanoclaw.watchdog.plist"
  "com.nanoclaw.runtime-auditor.plist"
  "com.nanoclaw.kanban-renderer.plist"
  "com.nanoclaw.ecommerce-5173.plist"
)

SERVICES=(
  "com.nanoclaw"
  "com.nanoclaw.stuck-monitor"
  "com.nanoclaw.watchdog"
  "com.nanoclaw.runtime-auditor"
  "com.nanoclaw.kanban-renderer"
  "com.nanoclaw.ecommerce-5173"
)

usage() {
  cat <<'EOF'
Usage:
  bash scripts/bootstrap-launchd.sh install
  bash scripts/bootstrap-launchd.sh restart
  bash scripts/bootstrap-launchd.sh status
  bash scripts/bootstrap-launchd.sh uninstall
EOF
}

render_template() {
  local src="$1"
  local dst="$2"
  mkdir -p "$(dirname "$dst")"
  sed \
    -e "s#{{NODE_PATH}}#${NODE_PATH_BIN}#g" \
    -e "s#{{PROJECT_ROOT}}#${ROOT_DIR}#g" \
    -e "s#{{HOME}}#${HOME}#g" \
    "$src" > "$dst"
  plutil -lint "$dst" >/dev/null
}

install_one() {
  local svc="$1"
  local plist="$2"
  launchctl bootout "gui/${UID_NUM}/${svc}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/${UID_NUM}" "$plist"
  launchctl kickstart -k "gui/${UID_NUM}/${svc}" || true
}

uninstall_one() {
  local svc="$1"
  launchctl bootout "gui/${UID_NUM}/${svc}" >/dev/null 2>&1 || true
}

status_one() {
  local svc="$1"
  echo "== ${svc} =="
  launchctl print "gui/${UID_NUM}/${svc}" 2>/dev/null | sed -n '1,36p' || echo "not loaded"
}

cmd="${1:-status}"
case "$cmd" in
  install)
    for t in "${TEMPLATES[@]}"; do
      render_template "${ROOT_DIR}/launchd/${t}" "${LAUNCHD_DIR}/${t}"
    done
    for i in "${!SERVICES[@]}"; do
      install_one "${SERVICES[$i]}" "${LAUNCHD_DIR}/${TEMPLATES[$i]}"
    done
    echo "launchd services installed/updated."
    ;;
  restart)
    for i in "${!SERVICES[@]}"; do
      install_one "${SERVICES[$i]}" "${LAUNCHD_DIR}/${TEMPLATES[$i]}"
    done
    echo "launchd services restarted."
    ;;
  status)
    for svc in "${SERVICES[@]}"; do
      status_one "$svc"
    done
    ;;
  uninstall)
    for svc in "${SERVICES[@]}"; do
      uninstall_one "$svc"
    done
    echo "launchd services unloaded."
    ;;
  *)
    usage
    exit 1
    ;;
esac
