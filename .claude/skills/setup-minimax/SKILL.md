---
name: setup-minimax
description: Configure NanoClaw + Claude Code to use MiniMax via the Anthropic-compatible endpoint. Use when user says "minimax", "MiniMax-M2.5", "anthropic compatible", "base url", or wants cheaper tokens with Claude Code.
---

# Setup MiniMax (Anthropic-Compatible)

Goal: make NanoClaw containers call MiniMax (not Anthropic) using the Anthropic-compatible API.

## 1) Preconditions (macOS)

Check runtime:

```bash
uname -s
which container && container system status || true
which docker && docker info >/dev/null 2>&1 && echo "docker ok" || true
```

NanoClaw can run on Apple Container or Docker. Prefer Apple Container on Apple silicon if already installed.

## 2) Configure Host Environment Variables

Do NOT commit secrets to git.

Required:
- `MINIMAX_API_KEY` (your MiniMax key)

Recommended:
- `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic`
- `ANTHROPIC_MODEL=MiniMax-M2.5`
- `ANTHROPIC_SMALL_FAST_MODEL=MiniMax-M2.5`
- `ANTHROPIC_SMALL_MODEL=MiniMax-M2.5`
- `ANTHROPIC_SMALL_REASONING_MODEL=MiniMax-M2.5`
- `ANTHROPIC_SONNET_MODEL=MiniMax-M2.5`

Optional:
- `API_TIMEOUT_MS=3000000`
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`

Sanity check (should print without errors, but never print the key):

```bash
echo "${MINIMAX_API_KEY:+MINIMAX_API_KEY set}"
echo "${ANTHROPIC_BASE_URL:-missing}"
echo "${ANTHROPIC_MODEL:-missing}"
```

## 3) Configure NanoClaw Auth

NanoClaw passes secrets to the agent container via stdin. It can read:
- `.env` in the project root (keys: `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`)
- host env vars as a fallback (recommended for MiniMax)

If you want to use a `.env`, keep it minimal and gitignored:

```bash
cat > .env <<'EOF'
# Secrets (optional). Prefer host env vars.
# ANTHROPIC_API_KEY=...
EOF
```

## 4) Build Agent Image

```bash
./container/build.sh
```

## 5) Verify in Practice

Run NanoClaw and trigger an agent run. If the key is wrong you will see an auth error.

If Apple Container is used:
```bash
container system status
```

If Docker is used:
```bash
docker info >/dev/null
```

