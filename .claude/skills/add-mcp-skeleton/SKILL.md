---
name: add-mcp-skeleton
description: Scaffold a new MCP server for NanoClaw and wire it into the agent runner. Use when user asks to "add MCP", "integrate a tool", "connect to API", "FastMCP", or wants new tools available inside the container.
---

# Add MCP Skeleton

Goal: create a minimal MCP server (TypeScript) and expose it to Claude Agent SDK inside the container.

## 0) Ask 3 things

1. MCP server name (id): e.g. `accounting`
2. What tools (read-only vs read-write)
3. Which groups should have access (main only vs all vs specific group)

## 1) Create MCP package

Create `container/mcp/<id>/`:
- `package.json` (type=module)
- `tsconfig.json`
- `src/index.ts` (stdio server)

Prefer `@modelcontextprotocol/sdk` with `StdioServerTransport`.

## 2) Wire into agent runner

Edit `container/agent-runner/src/index.ts` where `mcpServers` is configured.

Pattern:
- Keep existing `nanoclaw` server.
- Add `<id>` server:
  - `command: 'node'`
  - `args: ['/workspace/project/container/mcp/<id>/dist/index.js']` if project is mounted
  - Or vendor it into the image (preferred for non-main groups)

If you need per-group enablement:
- gate it by an env var like `NANOCLAW_ENABLE_MCP_<ID>=1` that you set via per-group `settings.json` env.

## 3) Build and test

Rebuild:
```bash
npm test
npm run build
./container/build.sh
```

Smoke test tool discovery by asking the agent to call the tool once.

## Notes

- Don’t mount secrets as files. Pass secrets via NanoClaw `secrets` plumbing or host env.
- Keep tools narrow: validate inputs with `zod` and return structured errors.

