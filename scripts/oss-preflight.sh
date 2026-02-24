#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[oss-preflight] checking tracked runtime artifacts..."
if git ls-files | rg -q '^(store/|logs/|data/)'; then
  echo "FAIL: tracked runtime/auth artifacts found under store/, logs/ or data/."
  git ls-files | rg '^(store/|logs/|data/)' || true
  exit 1
fi

echo "[oss-preflight] checking accidental env files..."
if git ls-files | rg -q '^\.env$'; then
  echo "FAIL: .env is tracked."
  exit 1
fi

echo "[oss-preflight] checking placeholder emails..."
if rg -n 'REPLACE_WITH_YOUR_(COMMUNITY|SECURITY)_EMAIL' CODE_OF_CONDUCT.md SECURITY.md .github/ISSUE_TEMPLATE/config.yml >/dev/null 2>&1; then
  echo "FAIL: replace placeholder emails before publishing."
  rg -n 'REPLACE_WITH_YOUR_(COMMUNITY|SECURITY)_EMAIL' CODE_OF_CONDUCT.md SECURITY.md .github/ISSUE_TEMPLATE/config.yml || true
  exit 1
fi

echo "[oss-preflight] checking common secret patterns in tracked files..."
if git grep -nE '(ANTHROPIC_API_KEY=|ANTHROPIC_AUTH_TOKEN=|CLOUDFLARE_API_TOKEN=|CLAUDE_CODE_OAUTH_TOKEN=|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)' -- . >/dev/null 2>&1; then
  echo "FAIL: possible secret material detected in tracked files."
  git grep -nE '(ANTHROPIC_API_KEY=|ANTHROPIC_AUTH_TOKEN=|CLOUDFLARE_API_TOKEN=|CLAUDE_CODE_OAUTH_TOKEN=|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)' -- . || true
  exit 1
fi

echo "[oss-preflight] OK"
