# SwarmClaw Runbook

Operational guide for NanoClaw + SwarmClaw in local macOS runtime.

## Services

- `com.nanoclaw`: main runtime (`dist/index.js`)
- `com.nanoclaw.stuck-monitor`: lane/todo/tasks reconciler + auto-nudge
- `com.nanoclaw.watchdog`: auto-recovery and restart guardrails

## Quick Commands

From project root:

```bash
bash scripts/bootstrap-launchd.sh install
bash scripts/bootstrap-launchd.sh status
bash scripts/bootstrap-launchd.sh restart
bash scripts/bootstrap-launchd.sh uninstall
```

## Health Checks

1. Runtime API:

```bash
curl http://127.0.0.1:4173/api/state | jq '.appMode,.status,.health'
```

2. launchd services:

```bash
launchctl print gui/$(id -u)/com.nanoclaw
launchctl print gui/$(id -u)/com.nanoclaw.stuck-monitor
launchctl print gui/$(id -u)/com.nanoclaw.watchdog
```

3. Recent actions:

```bash
tail -n 40 groups/main/swarmdev/actions.jsonl
```

## Recovery Playbook

1. UI stale or lanes inconsistent:

```bash
curl -X POST http://127.0.0.1:4173/api/lanes/reconcile
node scripts/stuck-monitor.mjs
```

2. Agent appears stuck:
- Use dashboard: `Run watchdog`
- Or CLI:

```bash
node scripts/watchdog.mjs
```

3. Hard restart all services:

```bash
bash scripts/bootstrap-launchd.sh restart
```

## Task Control (Dashboard/API)

Per task actions (`POST /api/task/action`):

- `retry`: move task to `queued`, reset lanes, clear blocked questions.
- `requeue`: same as retry without semantic difference (manual queue push).
- `block`: force task to `blocked`.
- `clear_stale`: reset stale lanes to `idle` for that task only.

Example:

```bash
curl -X POST http://127.0.0.1:4173/api/task/action \
  -H 'Content-Type: application/json' \
  -d '{"id":"ECOM-001","action":"retry"}'
```

## Runtime Modes

- `APP_MODE=prod`: low chat/log noise, autonomous execution defaults.
- `APP_MODE=debug`: more verbose heartbeat/status traces.

Current mode is visible in dashboard pill: `MODE: PROD|DEBUG`.

## Key Files

- `groups/main/todo.md`
- `groups/main/swarmdev/tasks-state.json`
- `groups/main/swarmdev/lane-state.json`
- `groups/main/swarmdev/workflow-state.json`
- `groups/main/swarmdev/actions.jsonl`
- `groups/main/swarmdev/status.md`

## Escalation Checklist

If issue persists:

1. Capture logs:
```bash
tail -n 200 logs/nanoclaw.log
tail -n 200 logs/watchdog.log
tail -n 200 logs/stuck-monitor.log
```
2. Capture state snapshot:
```bash
curl http://127.0.0.1:4173/api/state > /tmp/swarm-state.json
```
3. Restart services and re-test with one task only.
