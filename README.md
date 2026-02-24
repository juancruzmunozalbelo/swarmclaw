<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="SwarmClaw" width="400">
</p>

<h1 align="center">🐾 SwarmClaw</h1>

<p align="center">
  <strong>Autonomous Multi-Agent Swarm Control Plane</strong><br>
  <em>Orchestrate teams of AI agents that collaborate autonomously — built on NanoClaw.</em>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/juancruzmunozalbelo/swarmclaw/stargazers"><img src="https://img.shields.io/github/stars/juancruzmunozalbelo/swarmclaw?style=social" alt="Stars"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Claude_Code-Agent_SDK-A78BFA" alt="Claude Code">
</p>

<p align="center">
  <a href="README_zh.md">中文</a> ·
  <a href="https://discord.gg/VGWXrf8x"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord"></a>
</p>

---

## What is SwarmClaw?

**SwarmClaw** is an autonomous multi-agent orchestration layer built on top of [NanoClaw](https://github.com/gavrielc/nanoclaw). It turns a single personal AI assistant into a **team of specialized agents** that collaborate in parallel to build entire features — from spec to deployment.

You send one message. SwarmClaw dispatches a team of agents, each with a defined role, executing in isolated containers. A TeamLead agent coordinates, a Kanban board tracks progress, and a real-time dashboard ([SwarmDash](https://github.com/juancruzmunozalbelo/swarmdash)) shows everything.

### NanoClaw vs SwarmClaw

| Aspect | NanoClaw (core) | SwarmClaw (layer on top) |
|---|---|---|
| Primary role | Personal assistant runtime | Multi-agent orchestration + control room |
| Agent model | Single assistant flow | TeamLead + 8 specialized parallel lanes |
| Visibility | Logs + status | Live dashboard (Kanban, runtime, lanes, alerts) |
| Reliability | Core retries | Watchdog, circuit breakers, lane reconciliation, SLOs |
| Process | Flexible prompts | Structured autonomous workflow with stage contracts |

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │              SwarmDash (UI)                  │
                    │   Real-time dashboard · Kanban · Alerts      │
                    └─────────────────┬───────────────────────────┘
                                      │ polls /api/state
                    ┌─────────────────▼───────────────────────────┐
                    │            SwarmClaw Runtime                  │
                    │                                              │
                    │  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
                    │  │ Watchdog │  │  Stuck    │  │ SLO      │  │
                    │  │ Recovery │  │  Monitor  │  │ Monitor  │  │
                    │  └──────────┘  └───────────┘  └──────────┘  │
                    │                                              │
                    │  ┌──────────────────────────────────────┐   │
                    │  │         Lane Manager                  │   │
                    │  │  Parallel dispatch · Retry · Timeout  │   │
                    │  └──────────────┬───────────────────────┘   │
                    │                 │                             │
                    └─────────────────┼─────────────────────────────┘
                                      │ spawns containers
              ┌───────────┬───────────┼───────────┬────────────┐
              ▼           ▼           ▼           ▼            ▼
         ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
         │   PM   │  │  SPEC  │  │  DEV   │  │  QA    │  │ DEVOPS │
         │ Agent  │  │ Agent  │  │ Agent  │  │ Agent  │  │ Agent  │
         └────────┘  └────────┘  └────────┘  └────────┘  └────────┘
              Container isolation (Apple Container / Docker)
```

### The 8 Agent Roles

| Role | God | Responsibility |
|---|---|---|
| **PM** | Athena | Project management, task breakdown, resource planning |
| **SPEC** | Apollo | Technical specifications, interface contracts |
| **ARQ** | Hephaestus | Architecture decisions, system design |
| **UX** | Aphrodite | UI/UX design, user flows, accessibility |
| **DEV** | Ares | Primary development, feature implementation |
| **DEV2** | Hermes | Secondary development, supporting features |
| **QA** | Artemis | Testing, quality assurance, E2E validation |
| **DEVOPS** | Poseidon | CI/CD, deployment, infrastructure |
| **TeamLead** | Zeus | Orchestrates all roles, merges outputs, resolves conflicts |

### Workflow Stages

```
PM → SPEC → ARQ → UX → DEV/DEV2 (parallel) → QA → DEVOPS → Done
```

Each stage has explicit contracts. The next stage only starts when the previous stage's output passes validation.

---

## Features

| Feature | Description |
|---|---|
| 🤖 **Autonomous Execution** | Full pipeline from task to deployment without human intervention |
| 🏗️ **Parallel Lanes** | DEV + DEV2 + QA can run simultaneously in isolated containers |
| 🔄 **Circuit Breakers** | Per-model failure detection with fallback chains |
| 🐕 **Watchdog** | Auto-recovers stuck containers, stale processes, orphan lanes |
| 📊 **SLO Monitoring** | Error budgets, alert escalation (ok → warn → critical) |
| 📋 **Kanban Integration** | `todo.md` synced with workflow state, auto-advancing |
| 🔒 **Container Isolation** | Each agent runs in Apple Container (macOS) or Docker |
| 📡 **WhatsApp I/O** | Send a message, get a full feature built |
| ⏰ **Scheduled Tasks** | Cron-based recurring jobs with agent context |
| 🧪 **Exit Code Validation** | Real `tsc`, `vitest`, `eslint` validation, not LLM assertions |
| 🔐 **Secrets Vault** | Env vars never leak into agent prompts |
| 📝 **Incident Runbook** | Automated incident tracking and report generation |

---

## Quick Start

### Prerequisites

| Requirement | Notes |
|---|---|
| **macOS** or **Linux** | Windows via WSL2 + Docker |
| **Node.js 20+** | `brew install node` or [nodejs.org](https://nodejs.org/) |
| **Claude Code** | [claude.ai/download](https://claude.ai/download) |
| **Container Runtime** | [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/) |

### Step 1: Clone and Install

```bash
git clone https://github.com/juancruzmunozalbelo/swarmclaw.git
cd swarmclaw
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# REQUIRED — Choose ONE auth method:

# Option A: Claude subscription (Pro/Max) — recommended
CLAUDE_CODE_OAUTH_TOKEN=your_token_here

# Option B: Anthropic-compatible API (e.g. MiniMax)
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic

# Trigger word for WhatsApp
ASSISTANT_NAME=Andy
```

### Step 3: Setup with Claude Code

```bash
claude
```

Then run `/setup`. Claude Code handles:
- WhatsApp QR authentication
- Container runtime detection and setup
- Database initialization
- Group registration

### Step 4: Build and Run

```bash
# Build
npm run build

# Run
npm start

# Or development mode (hot reload)
npm run dev
```

### Step 5: Start SwarmDash (Optional)

```bash
npm run swarmdash
```

Opens the real-time dashboard at `http://localhost:3001`.

---

## Configuration Reference

The `.env.example` file documents every configuration option. Key sections:

### Authentication

```bash
CLAUDE_CODE_OAUTH_TOKEN=        # Claude subscription token (recommended)
ANTHROPIC_API_KEY=              # API key (alternative)
ANTHROPIC_BASE_URL=             # Custom API endpoint
```

### Runtime Autonomy

```bash
APP_MODE=prod                   # prod enables strict autonomous defaults
SWARM_EXEC_MODE=strict          # soft | strict | autonomous
AUTO_CONTINUE=1                 # Enable auto-continue between stages
MAIN_CONTEXT_MESSAGES=20        # Max messages in context window
SUBAGENT_CONTEXT_MESSAGES=4     # Context for sub-agents
TASK_MICRO_BATCH_MAX=2          # Max tasks in a micro-batch
SESSION_ROTATE_MAX_CYCLES=6     # Max cycles before session rotation
SESSION_ROTATE_MAX_AGE_MS=1800000  # 30 min max session age
```

### Model Configuration

```bash
ANTHROPIC_MODEL=MiniMax-M2.5            # Primary model
ANTHROPIC_MODEL_FALLBACKS=              # Comma-separated fallback chain
MODEL_CIRCUIT_BREAKER_ENABLED=1         # Enable circuit breaker
MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD=3  # Failures before open
MODEL_CIRCUIT_BREAKER_OPEN_MS=600000    # 10 min open state
```

### Parallel Lanes (Per-Role Timeouts)

```bash
PARALLEL_SUBAGENT_RETRY_MAX=2          # Max retries per lane
PARALLEL_ROLE_TIMEOUT_DEV_MS=180000    # 3 min timeout for DEV role
PARALLEL_ROLE_TIMEOUT_QA_MS=120000     # 2 min timeout for QA role
PARALLEL_ROLE_TIMEOUT_SPEC_MS=120000   # 2 min timeout for SPEC
```

### Watchdog (Auto-Recovery)

```bash
WATCHDOG_ENABLED=1
WATCHDOG_STUCK_GRACE_MS=600000         # 10 min grace before recovery
WATCHDOG_RESTART_MAX_PER_WINDOW=4      # Max restarts per window
WATCHDOG_RESTART_WINDOW_MS=3600000     # 1 hour window
```

### Dashboard Alerts

```bash
SWARMDASH_RETRY_ALERT_WINDOW_MS=900000     # 15 min alert window
SWARMDASH_ALERT_AGENT_ERROR_RATE_WARN=0.35 # 35% error → warning
SWARMDASH_ALERT_AGENT_ERROR_RATE_CRIT=0.6  # 60% error → critical
```

### Stuck Monitor

```bash
STUCK_MONITOR_ACTION_GRACE_MS=480000       # 8 min before nudge
STUCK_MONITOR_NUDGE_COOLDOWN_MS=300000     # 5 min between nudges
STUCK_MONITOR_HEARTBEAT_IDLE_AFTER_MS=120000  # 2 min idle threshold
```

---

## Project Structure

```
swarmclaw/
├── src/                          # Core runtime (88+ files)
│   ├── index.ts                  # Main orchestrator
│   ├── agent-runner.ts           # Spawns Claude agents in containers
│   ├── container-runner.ts       # Container lifecycle management
│   ├── container-boot.ts         # Container system initialization
│   ├── lane-manager.ts           # Parallel lane orchestration
│   ├── lane-helpers.ts           # Lane state utilities
│   ├── parallel-dispatch.ts      # Dispatches roles in parallel
│   ├── swarm-workflow.ts         # Stage-based workflow engine
│   ├── todo-manager.ts           # Kanban/todo.md sync
│   ├── prompt-builder.ts         # Per-role prompt generation
│   ├── model-circuit.ts          # Circuit breaker for API calls
│   ├── error-recovery.ts         # Retry and recovery logic
│   ├── exit-code-validator.ts    # Real shell command validation
│   ├── auto-continue.ts          # Auto-advance between stages
│   ├── liveness-probes.ts        # Health checks
│   ├── secrets-vault.ts          # Env var protection
│   ├── channels/whatsapp.ts      # WhatsApp connection (Baileys)
│   ├── db.ts                     # SQLite operations
│   ├── ipc.ts                    # Filesystem-based IPC
│   ├── router.ts                 # Message routing
│   ├── group-queue.ts            # Per-group concurrency queue
│   ├── task-scheduler.ts         # Scheduled/cron tasks
│   ├── metrics.ts                # Runtime metrics writer
│   ├── dashboard.ts              # Dashboard API server
│   └── phases/                   # Execution phases (setup, preflight, etc.)
│
├── prompts/                      # Agent role system prompts
│   ├── PM.md                     # Project Manager (Athena)
│   ├── SPEC.md                   # Specifications (Apollo)
│   ├── ARQ.md                    # Architecture (Hephaestus)
│   ├── UX.md                     # UX Design (Aphrodite)
│   ├── DEV.md                    # Developer (Ares)
│   ├── DEV2.md                   # Developer 2 (Hermes)
│   ├── QA.md                     # Quality Assurance (Artemis)
│   └── DEVOPS.md                 # DevOps (Poseidon)
│
├── scripts/                      # Operational scripts
│   ├── swarmdash-server.ts       # Dashboard HTTP server
│   ├── watchdog.ts               # Container watchdog
│   ├── stuck-monitor.ts          # Stuck task detection
│   ├── slo-monitor.ts            # SLO budget tracking
│   ├── runtime-auditor.ts        # Runtime state auditor
│   ├── log-collector.ts          # Log aggregation
│   ├── bootstrap-launchd.sh      # macOS service installer
│   └── setup-cloudflare-ingress.ts  # Cloudflare tunnel setup
│
├── container/                    # Container configuration
│   ├── Dockerfile                # Agent container image
│   ├── build.sh                  # Container build script
│   └── skills/                   # Container-level skills
│       ├── swarm-pm-planning/
│       ├── swarm-spec-contract/
│       ├── swarm-arq-decisions/
│       ├── swarm-dev-implementation/
│       ├── swarm-qa-validation/
│       ├── swarm-devops-deploy/
│       ├── swarm-teamlead-orchestrator/
│       └── swarm-critic-review/
│
├── swarmdash/                    # Dashboard UI (embedded)
├── config/                       # Router skills matrix
├── docs/                         # Technical documentation
│   ├── SWARM_EXECUTION_PHASES.md
│   ├── SECURITY.md
│   ├── RUNBOOK.md
│   ├── SPEC.md
│   └── SDK_DEEP_DIVE.md
│
├── .env.example                  # Full config template (111 options)
├── .github/                      # CI/CD workflows, issue templates
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Usage

### Talk to your assistant

Send a message via WhatsApp with the trigger word (default: `@Andy`):

```
@Andy build a user authentication system with JWT, roles, and tests
```

SwarmClaw will:
1. **PM** breaks down the task into subtasks on the Kanban board
2. **SPEC** writes technical specifications for each component
3. **ARQ** designs the architecture and data models
4. **UX** creates UI/UX wireframes (if applicable)
5. **DEV + DEV2** implement in parallel containers
6. **QA** runs tests, validates exit codes, checks contracts
7. **DEVOPS** deploys and verifies
8. **TeamLead** merges everything and reports back

### Admin commands (from main channel)

```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy show the current workflow state
```

### Customizing

```
# Change trigger word
"Change the trigger word to @Bob"

# Modify agent behavior
"Make the QA agent run linting before tests"

# Add integrations
/add-gmail
/add-telegram
```

---

## Running as a Service (macOS)

```bash
# Install as launchd service
bash scripts/bootstrap-launchd.sh install

# Check status
bash scripts/bootstrap-launchd.sh status

# View logs
tail -f logs/nanoclaw.log
```

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Type check
npm run typecheck

# Lint
npx eslint .
```

---

## API Endpoints (Dashboard)

| Endpoint | Method | Description |
|---|---|---|
| `/api/state` | GET | Full swarm state (agents, tasks, lanes, metrics) |
| `/api/lanes/reconcile` | POST | Sync and reconcile agent lanes |
| `/api/watchdog/run` | POST | Trigger manual watchdog check |
| `/api/runtime/reset` | POST | Reset runtime metric counters |
| `/api/todo/create` | POST | Create a new Kanban task |
| `/api/todo/clear` | POST | Clear completed or all tasks |
| `/api/workflow/resolve-question` | POST | Unblock a stuck task |

---

## Security

- **Container isolation** — agents run in Apple Container (macOS) or Docker, not on your host
- **Secrets vault** — env vars are filtered before injection into agent prompts
- **Mount security** — only explicitly declared directories are mounted
- **Per-group isolation** — each WhatsApp group has its own filesystem and `CLAUDE.md`

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

---

## Contributing

**Don't add features. Add skills.**

Instead of creating a PR that adds Telegram alongside WhatsApp, contribute a skill file that teaches Claude Code how to transform the installation. Users run `/add-telegram` and get clean code.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Request for Skills (RFS)

- `/add-telegram` — Telegram channel support
- `/add-slack` — Slack integration
- `/add-discord` — Discord bot
- `/setup-windows` — Windows via WSL2 + Docker
- `/add-clear` — Conversation compaction

---

## FAQ

<details>
<summary><strong>How is this different from NanoClaw?</strong></summary>
NanoClaw is a single-agent personal assistant. SwarmClaw adds multi-agent orchestration with parallel lanes, watchdog recovery, circuit breakers, and a real-time dashboard. NanoClaw is the engine; SwarmClaw is the cockpit.
</details>

<details>
<summary><strong>Why WhatsApp?</strong></summary>
Because the author uses WhatsApp. Fork it and run <code>/add-telegram</code> to change it.
</details>

<details>
<summary><strong>Can I run this on Linux?</strong></summary>
Yes. Run <code>/setup</code> and it will configure Docker as the container runtime automatically.
</details>

<details>
<summary><strong>Is this secure?</strong></summary>
Agents run in containers with filesystem isolation. Secrets are vault-protected. See <a href="docs/SECURITY.md">SECURITY.md</a> for details.
</details>

<details>
<summary><strong>How do I debug issues?</strong></summary>
Run <code>claude</code>, then <code>/debug</code>. Or check <code>logs/nanoclaw.log</code>, the SwarmDash dashboard, or ask Claude what's happening.
</details>

---

## 🌐 Ecosystem

| Project | Description |
|---|---|
| [🐾 SwarmClaw](https://github.com/juancruzmunozalbelo/swarmclaw) | Autonomous multi-agent swarm control plane (you are here) |
| [🏛️ SwarmDash](https://github.com/juancruzmunozalbelo/swarmdash) | Real-time AI agent dashboard |
| [🖥️ KaizenTerm](https://github.com/juancruzmunozalbelo/kaizen-term) | Multi-agent terminal orchestrator |

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VGWXrf8x).

## License

MIT — see [LICENSE](LICENSE).

## Author

**Juan Cruz Muñoz Albelo**
- GitHub: [@juancruzmunozalbelo](https://github.com/juancruzmunozalbelo)
- LinkedIn: [juan-cruz-albelo-](https://linkedin.com/in/juan-cruz-albelo-/)

Built on [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc).

---

<p align="center">
  <em>One message. A full team of AI agents. Autonomous delivery.</em>
</p>
