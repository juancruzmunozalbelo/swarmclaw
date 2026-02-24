#!/usr/bin/env bash
set -euo pipefail

task_id="${1:-}"
local_url="${2:-http://127.0.0.1:5173}"
local_start_cmd="${3:-${DEPLOY_LOCAL_START_CMD:-}}"
local_start_cwd="${4:-${DEPLOY_LOCAL_START_CWD:-}}"
subdomains_file="${SUBDOMAINS_FILE:-/workspace/project/groups/main/swarmdev/subdomains.md}"
deploy_wait_seconds="${DEPLOY_WAIT_SECONDS:-75}"
deploy_retry_interval="${DEPLOY_RETRY_INTERVAL_SECONDS:-5}"

if [[ -z "${task_id}" ]]; then
  echo "STATUS=not_deployed URL_PUBLIC=n/a PORT=n/a PROCESS=n/a DB=n/a CHECK_LOCAL=fail CHECK_PUBLIC=fail CHECK_CONTENT=fail LAST_LOG=missing task id"
  exit 2
fi

slug="$(printf '%s' "${task_id}" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-')"
slug="${slug#-}"
slug="${slug%-}"

token="${CLOUDFLARE_API_TOKEN:-}"
zone_id="${CLOUDFLARE_ZONE_ID:-}"
zone_name="${CLOUDFLARE_ZONE_NAME:-}"
tunnel_target="${CLOUDFLARE_TUNNEL_TARGET:-}"

if [[ -z "${token}" || -z "${zone_id}" || -z "${zone_name}" || -z "${tunnel_target}" ]]; then
  echo "STATUS=not_deployed URL_PUBLIC=n/a PORT=n/a PROCESS=n/a DB=n/a CHECK_LOCAL=fail CHECK_PUBLIC=fail CHECK_CONTENT=fail LAST_LOG=missing cloudflare env vars"
  exit 3
fi

public_url="https://${slug}.${zone_name}"
local_port="$(printf '%s' "${local_url}" | sed -nE 's#^https?://[^:/]+:([0-9]+).*$#\1#p')"
proc_log="/tmp/nanoclaw-deploy-${slug}.log"

upsert_subdomain_row() {
  local state="$1"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  node - "${subdomains_file}" "${task_id}" "${public_url}" "${local_url}" "${state}" "${ts}" <<'NODE'
const fs = require('fs');
const [file, id, subdomain, deliverable, state, updatedAt] = process.argv.slice(2);
const header = '# Subdomains\n\n| ID | Subdominio | Entregable | Estado | UpdatedAt |\n|---|---|---|---|---|\n';

function ensureDirFor(filePath) {
  const dir = require('path').dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function upsert(md) {
  const lines = md.split('\n');
  const row = `| ${id} | ${subdomain} | ${deliverable} | ${state} | ${updatedAt} |`;
  let found = false;
  const out = [];
  for (const line of lines) {
    if (line.startsWith(`| ${id} |`)) {
      out.push(row);
      found = true;
    } else {
      out.push(line);
    }
  }
  if (!found) out.push(row);
  return out.join('\n').replace(/\n+$/g, '\n') + '\n';
}

let current = header;
if (fs.existsSync(file)) {
  current = fs.readFileSync(file, 'utf8');
  if (!current.includes('| ID | Subdominio | Entregable | Estado | UpdatedAt |')) {
    current = `${header}${current}`;
  }
}
ensureDirFor(file);
fs.writeFileSync(file, upsert(current), 'utf8');
NODE
}

check_local="fail"
local_http_code="$(curl -sS -L --max-time 10 -o /tmp/cloudflare_local_body.$$ -w "%{http_code}" "${local_url}" || true)"
rm -f /tmp/cloudflare_local_body.$$ || true
if [[ "${local_http_code}" != "000" && -n "${local_http_code}" ]]; then
  check_local="ok"
fi

autodetect_start_cmd() {
  if [[ -n "${local_start_cmd}" ]]; then
    return
  fi
  if [[ -z "${local_port}" ]]; then
    return
  fi
  if [[ -f "/workspace/group/ecommerce/package.json" ]]; then
    local_start_cwd="${local_start_cwd:-/workspace/group/ecommerce}"
    local_start_cmd="npm run dev -- --host 127.0.0.1 --port ${local_port}"
    return
  fi
  if [[ -f "/workspace/group/package.json" ]]; then
    local_start_cwd="${local_start_cwd:-/workspace/group}"
    local_start_cmd="npm run dev -- --host 127.0.0.1 --port ${local_port}"
  fi
}

try_start_local_service() {
  autodetect_start_cmd
  if [[ -z "${local_start_cmd}" ]]; then
    return
  fi
  local start_cwd="${local_start_cwd:-/workspace/group}"
  mkdir -p "$(dirname "${proc_log}")" >/dev/null 2>&1 || true
  (
    cd "${start_cwd}" &&
    nohup bash -lc "${local_start_cmd}" >>"${proc_log}" 2>&1 &
  ) >/dev/null 2>&1 || true
}

if [[ "${check_local}" != "ok" ]]; then
  try_start_local_service
  waited=0
  while [[ "${waited}" -lt 40 ]]; do
    local_http_code="$(curl -sS -L --max-time 5 -o /tmp/cloudflare_local_body.$$ -w "%{http_code}" "${local_url}" || true)"
    rm -f /tmp/cloudflare_local_body.$$ || true
    if [[ "${local_http_code}" != "000" && -n "${local_http_code}" ]]; then
      check_local="ok"
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done
  if [[ "${check_local}" != "ok" ]]; then
    upsert_subdomain_row "blocked"
    echo "STATUS=not_deployed URL_PUBLIC=${public_url} PORT=${local_port:-n/a} PROCESS=${local_start_cmd:-n/a} DB=n/a CHECK_LOCAL=fail CHECK_PUBLIC=fail CHECK_CONTENT=fail LAST_LOG=local url not reachable (${local_url})"
    exit 4
  fi
fi

register_script="/home/node/.claude/skills/task-subdomain/scripts/register-cloudflare-subdomain.sh"
if [[ ! -f "${register_script}" ]]; then
  alt_script="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../task-subdomain/scripts" && pwd)/register-cloudflare-subdomain.sh"
  if [[ -f "${alt_script}" ]]; then
    register_script="${alt_script}"
  fi
fi
if [[ ! -f "${register_script}" ]]; then
  upsert_subdomain_row "blocked"
  echo "STATUS=not_deployed URL_PUBLIC=${public_url} PORT=n/a PROCESS=n/a DB=n/a CHECK_LOCAL=ok CHECK_PUBLIC=fail CHECK_CONTENT=fail LAST_LOG=missing register script"
  exit 5
fi

reg_out="$("${register_script}" "${slug}" 2>&1 || true)"
if ! printf '%s' "${reg_out}" | grep -qi '^ok:'; then
  msg="$(printf '%s' "${reg_out}" | tail -n 1 | tr '\n' ' ' | cut -c1-180)"
  upsert_subdomain_row "blocked"
  echo "STATUS=not_deployed URL_PUBLIC=${public_url} PORT=n/a PROCESS=n/a DB=n/a CHECK_LOCAL=ok CHECK_PUBLIC=fail CHECK_CONTENT=fail LAST_LOG=${msg}"
  exit 6
fi

check_public="fail"
check_content="fail"
last_http_code="000"
attempts=$(( deploy_wait_seconds / deploy_retry_interval ))
if [[ "${attempts}" -lt 1 ]]; then attempts=1; fi
for _ in $(seq 1 "${attempts}"); do
  http_code="$(curl -sS -L --max-time 20 -o /tmp/cloudflare_deploy_body.$$ -w "%{http_code}" "${public_url}" || true)"
  body="$(cat /tmp/cloudflare_deploy_body.$$ 2>/dev/null || true)"
  rm -f /tmp/cloudflare_deploy_body.$$ || true
  last_http_code="${http_code}"
  if [[ "${http_code}" =~ ^2[0-9][0-9]$|^3[0-9][0-9]$ ]]; then
    check_public="ok"
    if printf '%s' "${body}" | grep -Eqi '(welcome to sveltekit|svelte\.dev/docs/kit)'; then
      check_content="fail"
    else
      check_content="ok"
      break
    fi
  fi
  sleep "${deploy_retry_interval}"
done

if [[ "${check_public}" == "ok" && "${check_content}" == "ok" ]]; then
  upsert_subdomain_row "done"
  echo "STATUS=deployed URL_PUBLIC=${public_url} PORT=${local_port:-n/a} PROCESS=${local_start_cmd:-cloudflare-dns-cname} DB=n/a CHECK_LOCAL=ok CHECK_PUBLIC=ok CHECK_CONTENT=ok LAST_LOG=dns ready"
  exit 0
fi

upsert_subdomain_row "blocked"
echo "STATUS=not_deployed URL_PUBLIC=${public_url} PORT=${local_port:-n/a} PROCESS=${local_start_cmd:-cloudflare-dns-cname} DB=n/a CHECK_LOCAL=ok CHECK_PUBLIC=${check_public} CHECK_CONTENT=${check_content} LAST_LOG=public check failed (http=${last_http_code})"
exit 7
