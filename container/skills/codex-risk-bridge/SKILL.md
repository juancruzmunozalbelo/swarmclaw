---
name: codex-risk-bridge
description: Bridge skill for Claude to invoke Codex non-interactively with $project-risk-review and return a concise risk/gap report.
allowed-tools: Bash
---

# Codex Risk Bridge

Use this skill when the user asks Claude/Andy to:
- run Codex review
- analyze risks/gaps with Codex
- get a second-opinion audit from Codex

## Behavior

1. Build a focused prompt for Codex using `$project-risk-review`.
2. Run the bridge script:
```bash
bash /home/node/.claude/skills/codex-risk-bridge/scripts/invoke-codex-risk-review.sh "<scope_or_goal>"
```
3. Parse stdout from that script and report it faithfully.
4. If execution succeeds, summarize key findings for the user.
5. If Codex CLI is unavailable/fails, return the exact status and command from script output.

## Prompt Template

Use this payload for Codex:

`Use $project-risk-review to review this project for top risks and gaps. Scope: <scope>. Return findings sorted by severity with evidence, mitigation, and validation steps.`

## Output to user

Always include:
- status (`executed` or `manual-run-required`)
- command used (or to run)
- run id + log file
- short summary of top risks/gaps

Hard rule:
- Before any summary, include these lines exactly as returned by the script:
  - `STATUS: ...`
  - `COMMAND: ...`
  - `RUN_ID: ...`
  - `LOG_FILE: ...`
- If you did not run the script, do not claim Codex was executed.
- If you mention sandbox errors, include the exact error line from script `OUTPUT:` and the `RUN_ID`.

Do not send only raw logs.
