#!/usr/bin/env bash
set -euo pipefail

scope="${1:-full project}"
workdir="${CODEX_REVIEW_DIR:-/workspace/project}"
prompt="Use \$project-risk-review to review this project for top risks and gaps. Scope: ${scope}. Return findings sorted by severity with evidence, mitigation, and validation steps."
run_id="$(date +%s)-$RANDOM"
log_root="${CODEX_REVIEW_LOG_DIR:-/workspace/group/swarmdev/codex-runs}"
log_file="${log_root}/run-${run_id}.log"

# Be explicit with PATH inside container tool shells.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"

pick_codex_bin() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  for p in /usr/local/bin/codex /opt/homebrew/bin/codex /usr/bin/codex; do
    if [[ -x "$p" ]]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

codex_bin="$(pick_codex_bin || true)"
if [[ -n "${codex_bin}" ]]; then
  cmd=(
    "${codex_bin}" exec
    --cd "$workdir"
    --sandbox danger-full-access
    --skip-git-repo-check
    "$prompt"
  )
else
  cmd=(
    codex exec
    --cd "$workdir"
    --sandbox danger-full-access
    --skip-git-repo-check
    "$prompt"
  )
fi

if [[ -z "${codex_bin}" ]]; then
  mkdir -p "${log_root}" || true
  echo "STATUS: manual-run-required"
  echo "COMMAND: codex exec --cd ${workdir} \"${prompt}\""
  echo "RUN_ID: ${run_id}"
  echo "LOG_FILE: ${log_file}"
  echo "DETAIL: codex binary not found in PATH or known locations"
  {
    echo "STATUS: manual-run-required"
    echo "COMMAND: codex exec --cd ${workdir} \"${prompt}\""
    echo "RUN_ID: ${run_id}"
    echo "LOG_FILE: ${log_file}"
    echo "DETAIL: codex binary not found in PATH or known locations"
  } >"${log_file}"
  exit 0
fi

# Execute and stream output.
mkdir -p "${log_root}" || true
echo "STATUS: executed"
echo "COMMAND: ${cmd[*]}"
echo "RUN_ID: ${run_id}"
echo "LOG_FILE: ${log_file}"
set +e
out="$("${cmd[@]}" 2>&1)"
rc=$?
set -e

if [[ $rc -ne 0 ]]; then
  echo "STATUS: execution-failed"
  echo "RUN_ID: ${run_id}"
  echo "LOG_FILE: ${log_file}"
  echo "EXIT_CODE: ${rc}"
  echo "DETAIL: codex command failed"
  echo "OUTPUT:"
  printf '%s\n' "$out"
  {
    echo "STATUS: execution-failed"
    echo "COMMAND: ${cmd[*]}"
    echo "RUN_ID: ${run_id}"
    echo "LOG_FILE: ${log_file}"
    echo "EXIT_CODE: ${rc}"
    echo "DETAIL: codex command failed"
    echo "OUTPUT:"
    printf '%s\n' "$out"
  } >"${log_file}"
  exit 0
fi

printf '%s\n' "$out"
{
  echo "STATUS: executed"
  echo "COMMAND: ${cmd[*]}"
  echo "RUN_ID: ${run_id}"
  echo "LOG_FILE: ${log_file}"
  echo "EXIT_CODE: 0"
  printf '%s\n' "$out"
} >"${log_file}"
