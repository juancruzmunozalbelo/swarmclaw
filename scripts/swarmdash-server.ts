import http from 'http';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const dashDir = path.join(projectRoot, 'swarmdash');

const statusPath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'status.md',
);
const metricsPath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'metrics.json',
);
const eventsPath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'events.jsonl',
);
const actionsPath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'actions.jsonl',
);
const runtimeMetricsPath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'runtime-metrics.json',
);
const workflowStatePath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'workflow-state.json',
);
const runtimeAlertHistoryPath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'runtime-alerts.jsonl',
);
const laneStatePath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'lane-state.json',
);
const tasksStatePath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'tasks-state.json',
);
const runtimeAlertStatePath = path.join(
  projectRoot,
  'groups',
  'main',
  'swarmdev',
  'runtime-alert-state.json',
);
const todoPath = path.join(projectRoot, 'groups', 'main', 'todo.md');
const DASH_AUTH_USER = (process.env.SWARMDASH_AUTH_USER || '').trim();
const DASH_AUTH_PASS = (process.env.SWARMDASH_AUTH_PASS || '').trim();
const DASH_AUTH_ENABLED = DASH_AUTH_USER.length > 0 && DASH_AUTH_PASS.length > 0;
const ALERT_MIN_REQUESTS = Number(process.env.SWARMDASH_ALERT_MIN_REQUESTS || 12);
const ALERT_AGENT_ERROR_RATE_WARN = Number(process.env.SWARMDASH_ALERT_AGENT_ERROR_RATE_WARN || 0.35);
const ALERT_AGENT_ERROR_RATE_CRIT = Number(process.env.SWARMDASH_ALERT_AGENT_ERROR_RATE_CRIT || 0.6);
const ALERT_VALIDATION_FAIL_RATE_WARN = Number(process.env.SWARMDASH_ALERT_VALIDATION_FAIL_RATE_WARN || 0.2);
const ALERT_VALIDATION_FAIL_RATE_CRIT = Number(process.env.SWARMDASH_ALERT_VALIDATION_FAIL_RATE_CRIT || 0.4);
const ALERT_RUNTIME_STALE_MS = Number(process.env.SWARMDASH_ALERT_RUNTIME_STALE_MS || 10 * 60 * 1000);
const APP_MODE = String(process.env.APP_MODE || process.env.MODE || 'prod').trim().toLowerCase() === 'debug'
  ? 'debug'
  : 'prod';

type Status = {
  stage: string;
  item: string;
  files: string[];
  next: string;
  updatedAt: string;
};

type AgentState = 'working' | 'idle' | 'error';
type TransportState = 'connected' | 'reconnecting' | 'logged_out' | 'unknown';

type DerivedHealth = {
  agentState: AgentState;
  transportState: TransportState;
  waConnected: boolean;
  activeContainers: number;
  activeContainerIds: string[];
  staleContainers: number;
  staleContainerIds: string[];
  orphanContainers: number;
  orphanContainerIds: string[];
  oldestContainerAgeMs: number | null;
  lastAgentOutputAt: string | null;
  lastEventAt: string | null;
  statusAgeMs: number | null;
  ok: boolean;
};

type RuntimeCounters = {
  requestsStarted: number;
  outputsSent: number;
  agentErrors: number;
  validationFailures: number;
  contractFailures: number;
  artifactFailures: number;
  devGateFailures: number;
  blockedQuestionsSet: number;
  blockedQuestionsResolved: number;
  statusValidationFailures: number;
  evidenceValidationFailures: number;
  devPrereqFailures: number;
  teamleadOnlyCycles: number;
};

type RuntimeMetrics = {
  updatedAt: string;
  counters: RuntimeCounters;
  skillMetrics?: Record<string, {
    dispatched: number;
    completed: number;
    failed: number;
    retries: number;
    timeouts: number;
    validationFails: number;
  }>;
  lastStage?: string;
  lastError?: string;
  lastTaskIds?: string[];
};

type RuntimeAlerts = {
  level: 'ok' | 'warn' | 'critical';
  items: string[];
  thresholds: {
    minRequests: number;
    agentErrorRateWarn: number;
    agentErrorRateCritical: number;
    validationRateWarn: number;
    validationRateCritical: number;
    runtimeStaleMs: number;
  };
};
type RetryAlertSummary = {
  level: 'ok' | 'warn' | 'critical';
  items: string[];
  retries: number;
  exhausted: number;
  roles: string[];
  tasks: string[];
};
type RoleName = 'TEAMLEAD' | 'PM' | 'ARQ' | 'SPEC' | 'UX' | 'DEV' | 'DEV2' | 'DEVOPS' | 'QA';
type RoleState = {
  role: RoleName;
  state: 'working' | 'idle' | 'stuck';
  lastSeenAt: string | null;
  lastSeenAgoMs: number | null;
  source: 'events' | 'actions' | 'none';
};
type BlockedQueueItem = {
  taskId: string;
  stage: string;
  status: string;
  questions: string[];
  updatedAt: string;
};
type RuntimeAlertHistoryItem = {
  ts: string;
  level: 'ok' | 'warn' | 'critical';
  items: string[];
  stage?: string;
  agentState?: string;
  transportState?: string;
};
type RunbookItem = {
  ts: string;
  kind: string;
  detail: string;
};
type RuntimeRunbook = {
  generatedAt: string;
  summary: string[];
  incidents: RunbookItem[];
  report: string;
};
type LaneRole = 'PM' | 'ARQ' | 'SPEC' | 'UX' | 'DEV' | 'DEV2' | 'DEVOPS' | 'QA';
type LaneCard = {
  role: LaneRole;
  state: string;
  updatedAt: string;
  detail?: string;
  dependency?: string;
};
type ActiveLaneTask = {
  taskId: string;
  lanes: LaneCard[];
  teamleadSummary?: {
    updatedAt: string;
    file: string;
    summary: string;
  };
};

const ORPHAN_AGE_MS = Number(process.env.SWARMDASH_ORPHAN_AGE_MS || 45 * 60 * 1000);
const ROLE_STUCK_MS = Number(process.env.SWARMDASH_ROLE_STUCK_MS || 8 * 60 * 1000);
const ACTIVE_LANE_MAX_AGE_MS = Number(process.env.SWARMDASH_ACTIVE_LANE_MAX_AGE_MS || 2 * 60 * 1000);
const ROLE_ACTIVE_NO_CONTAINER_GRACE_MS = Number(
  process.env.SWARMDASH_ROLE_ACTIVE_NO_CONTAINER_GRACE_MS || 2 * 60 * 1000,
);
const KANBAN_RUNTIME_MAX_AGE_MS = Number(
  process.env.SWARMDASH_KANBAN_RUNTIME_MAX_AGE_MS || 2 * 60 * 60 * 1000,
);
const RETRY_ALERT_WINDOW_MS = Number(process.env.SWARMDASH_RETRY_ALERT_WINDOW_MS || 15 * 60 * 1000);
const DEFAULT_RUNTIME_COUNTERS: RuntimeCounters = {
  requestsStarted: 0,
  outputsSent: 0,
  agentErrors: 0,
  validationFailures: 0,
  contractFailures: 0,
  artifactFailures: 0,
  devGateFailures: 0,
  blockedQuestionsSet: 0,
  blockedQuestionsResolved: 0,
  statusValidationFailures: 0,
  evidenceValidationFailures: 0,
  devPrereqFailures: 0,
  teamleadOnlyCycles: 0,
};

function readText(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

function parseStatus(md: string): Status {
  const pick = (k: string): string => {
    const m = md.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'));
    return (m?.[1] || '').trim() || 'n/a';
  };

  const filesRaw = pick('ARCHIVOS');
  const files = filesRaw === 'n/a'
    ? []
    : filesRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    stage: pick('ETAPA'),
    item: pick('ITEM'),
    files,
    next: pick('SIGUIENTE'),
    updatedAt: pick('ULTIMO_UPDATE'),
  };
}

function readMetrics(): Status | null {
  try {
    if (!fs.existsSync(metricsPath)) return null;
    const raw = JSON.parse(readText(metricsPath));
    if (!raw || typeof raw !== 'object') return null;
    return {
      stage: String(raw.stage || 'idle'),
      item: String(raw.item || 'n/a'),
      files: Array.isArray(raw.files) ? raw.files.map((x: any) => String(x)) : [],
      next: String(raw.next || 'n/a'),
      updatedAt: String(raw.updatedAt || 'n/a'),
    };
  } catch {
    return null;
  }
}

function readRuntimeMetrics(): RuntimeMetrics | null {
  try {
    if (!fs.existsSync(runtimeMetricsPath)) return null;
    const raw = JSON.parse(readText(runtimeMetricsPath));
    if (!raw || typeof raw !== 'object') return null;
    const countersRaw = (raw as any).counters || {};
    const skillRaw = (raw as any).skillMetrics || {};
    const skillMetrics: RuntimeMetrics['skillMetrics'] = {};
    if (skillRaw && typeof skillRaw === 'object') {
      for (const [skillKey, rowAny] of Object.entries(skillRaw)) {
        const row = rowAny as any;
        const k = String(skillKey || '').trim().toLowerCase();
        if (!k) continue;
        skillMetrics[k] = {
          dispatched: Number(row?.dispatched || 0),
          completed: Number(row?.completed || 0),
          failed: Number(row?.failed || 0),
          retries: Number(row?.retries || 0),
          timeouts: Number(row?.timeouts || 0),
          validationFails: Number(row?.validationFails || 0),
        };
      }
    }
    const counters: RuntimeCounters = {
      requestsStarted: Number(countersRaw.requestsStarted || 0),
      outputsSent: Number(countersRaw.outputsSent || 0),
      agentErrors: Number(countersRaw.agentErrors || 0),
      validationFailures: Number(countersRaw.validationFailures || 0),
      contractFailures: Number(countersRaw.contractFailures || 0),
      artifactFailures: Number(countersRaw.artifactFailures || 0),
      devGateFailures: Number(countersRaw.devGateFailures || 0),
      blockedQuestionsSet: Number(countersRaw.blockedQuestionsSet || 0),
      blockedQuestionsResolved: Number(countersRaw.blockedQuestionsResolved || 0),
      statusValidationFailures: Number(countersRaw.statusValidationFailures || 0),
      evidenceValidationFailures: Number(countersRaw.evidenceValidationFailures || 0),
      devPrereqFailures: Number(countersRaw.devPrereqFailures || 0),
      teamleadOnlyCycles: Number(countersRaw.teamleadOnlyCycles || 0),
    };
    return {
      updatedAt: String((raw as any).updatedAt || 'n/a'),
      counters,
      skillMetrics,
      lastStage: (raw as any).lastStage ? String((raw as any).lastStage) : undefined,
      lastError: (raw as any).lastError ? String((raw as any).lastError) : undefined,
      lastTaskIds: Array.isArray((raw as any).lastTaskIds)
        ? (raw as any).lastTaskIds.map((x: any) => String(x))
        : undefined,
    };
  } catch {
    return null;
  }
}

function deriveRuntimeAlerts(runtime: RuntimeMetrics | null): RuntimeAlerts {
  const thresholds = {
    minRequests: ALERT_MIN_REQUESTS,
    agentErrorRateWarn: ALERT_AGENT_ERROR_RATE_WARN,
    agentErrorRateCritical: ALERT_AGENT_ERROR_RATE_CRIT,
    validationRateWarn: ALERT_VALIDATION_FAIL_RATE_WARN,
    validationRateCritical: ALERT_VALIDATION_FAIL_RATE_CRIT,
    runtimeStaleMs: ALERT_RUNTIME_STALE_MS,
  };
  if (!runtime) {
    return {
      level: 'warn',
      items: ['runtime-metrics.json ausente'],
      thresholds,
    };
  }

  const c = runtime.counters;
  const requests = Math.max(0, Number(c.requestsStarted || 0));
  const outputs = Math.max(0, Number(c.outputsSent || 0));
  const agentErrors = Math.max(0, Number(c.agentErrors || 0));
  const validationFailures = Math.max(0, Number(c.validationFailures || 0));
  const blockedOpen = Math.max(
    0,
    Number(c.blockedQuestionsSet || 0) - Number(c.blockedQuestionsResolved || 0),
  );

  const items: string[] = [];
  let level: RuntimeAlerts['level'] = 'ok';

  const setWarn = (msg: string) => {
    if (level !== 'critical') level = 'warn';
    items.push(msg);
  };
  const setCritical = (msg: string) => {
    level = 'critical';
    items.push(msg);
  };

  const updatedMs = parseIsoMs(runtime.updatedAt);
  const runtimeAgeMs = updatedMs ? (Date.now() - updatedMs) : null;
  const runtimeFresh = runtimeAgeMs !== null && runtimeAgeMs < ALERT_RUNTIME_STALE_MS;
  if (!runtimeFresh) {
    if (runtimeAgeMs !== null) {
      setWarn(`runtime-metrics stale (${Math.round(runtimeAgeMs / 1000)}s)`);
    } else {
      setWarn('runtime-metrics timestamp inválido');
    }
    // Do not compute error/validation rates over stale cumulative counters.
    return { level, items, thresholds };
  }

  if (requests >= ALERT_MIN_REQUESTS) {
    const agentErrorRate = agentErrors / Math.max(1, requests);
    if (agentErrorRate >= ALERT_AGENT_ERROR_RATE_CRIT) {
      setCritical(`error-rate alto: ${Math.round(agentErrorRate * 100)}%`);
    } else if (agentErrorRate >= ALERT_AGENT_ERROR_RATE_WARN) {
      setWarn(`error-rate elevado: ${Math.round(agentErrorRate * 100)}%`);
    }

    const validationRate = validationFailures / Math.max(1, requests);
    if (validationRate >= ALERT_VALIDATION_FAIL_RATE_CRIT) {
      setCritical(`validation-fail alto: ${Math.round(validationRate * 100)}%`);
    } else if (validationRate >= ALERT_VALIDATION_FAIL_RATE_WARN) {
      setWarn(`validation-fail elevado: ${Math.round(validationRate * 100)}%`);
    }
  }

  if (outputs === 0 && requests >= ALERT_MIN_REQUESTS) {
    setWarn('sin salidas enviadas');
  }

  if (blockedOpen > 0) {
    setWarn(`preguntas bloqueadas abiertas: ${blockedOpen}`);
  }

  if (Number(c.devGateFailures || 0) > 0) {
    setWarn(`fallos en quality gates DEV: ${Number(c.devGateFailures || 0)}`);
  }
  if (Number(c.statusValidationFailures || 0) > 0) {
    setWarn(`rechazos por contrato/status: ${Number(c.statusValidationFailures || 0)}`);
  }
  if (Number(c.evidenceValidationFailures || 0) > 0) {
    setWarn(`claims sin evidencia: ${Number(c.evidenceValidationFailures || 0)}`);
  }
  const topSkillFail = (() => {
    const rows = Object.entries(runtime.skillMetrics || {});
    if (rows.length === 0) return null;
    let best: { skill: string; failRate: number; dispatched: number; failed: number } | null = null;
    for (const [skill, rowAny] of rows) {
      const row = rowAny as any;
      const dispatched = Math.max(0, Number(row?.dispatched || 0));
      const failed = Math.max(0, Number(row?.failed || 0));
      if (dispatched < 3) continue;
      const failRate = failed / Math.max(1, dispatched);
      if (!best || failRate > best.failRate) best = { skill, failRate, dispatched, failed };
    }
    return best;
  })();
  if (topSkillFail && topSkillFail.failRate >= 0.5) {
    setWarn(
      `skill error-rate alto: ${topSkillFail.skill} ${Math.round(topSkillFail.failRate * 100)}% (${topSkillFail.failed}/${topSkillFail.dispatched})`,
    );
  }
  if (Number(c.devPrereqFailures || 0) > 0) {
    setWarn(`bloqueos DEV por prerequisitos PM/SPEC: ${Number(c.devPrereqFailures || 0)}`);
  }

  return { level, items, thresholds };
}

function deriveRetryAlerts(actions: any[], activeTaskIds?: Set<string>): RetryAlertSummary {
  const now = Date.now();
  const recent = (actions || []).filter((a) => {
    const ts = parseIsoMs(a?.ts);
    if (!ts) return false;
    return (now - ts) <= RETRY_ALERT_WINDOW_MS;
  });
  const retries = recent.filter((a) => String(a?.action || '') === 'subagent_retry_scheduled');
  const exhausted = recent.filter((a) => String(a?.action || '') === 'subagent_retry_exhausted');
  const activeExhausted = exhausted.filter((row) => {
    if (!activeTaskIds || activeTaskIds.size === 0) return true;
    const taskId = String(row?.meta?.taskId || '').toUpperCase();
    if (!taskId) return true;
    return activeTaskIds.has(taskId);
  });
  const inactiveExhaustedCount = Math.max(0, exhausted.length - activeExhausted.length);
  const roles = new Set<string>();
  const tasks = new Set<string>();
  for (const row of [...retries, ...activeExhausted]) {
    const role = String(row?.meta?.role || row?.stage || '').toUpperCase();
    const taskId = String(row?.meta?.taskId || '').toUpperCase();
    if (role) roles.add(role);
    if (taskId) tasks.add(taskId);
  }
  const items: string[] = [];
  let level: RetryAlertSummary['level'] = 'ok';
  if (retries.length > 0) {
    level = 'warn';
    items.push(`subagent retries: ${retries.length} (ventana ${Math.round(RETRY_ALERT_WINDOW_MS / 60000)}m)`);
  }
  if (activeExhausted.length > 0) {
    level = 'critical';
    items.push(`retry exhausted: ${activeExhausted.length}`);
  } else if (inactiveExhaustedCount > 0) {
    if (level === 'ok') level = 'warn';
    items.push(`retry exhausted (resueltos/inactivos): ${inactiveExhaustedCount}`);
  }
  if (roles.size > 0) items.push(`roles: ${Array.from(roles).join(', ')}`);
  if (tasks.size > 0) items.push(`tasks: ${Array.from(tasks).slice(0, 5).join(', ')}`);
  return {
    level,
    items,
    retries: retries.length,
    exhausted: activeExhausted.length,
    roles: Array.from(roles),
    tasks: Array.from(tasks),
  };
}

function getActiveTaskIds(todo: TodoItem[]): Set<string> {
  const out = new Set<string>();
  for (const row of todo || []) {
    const id = String((row as any)?.id || '').trim().toUpperCase();
    const state = normalizeState(String((row as any)?.state || 'todo'));
    if (!id) continue;
    if (state === 'queued' || state === 'planning' || state === 'doing' || state === 'working') {
      out.add(id);
    }
  }
  return out;
}

function mergeAlertLevels(
  a: RuntimeAlerts['level'],
  b: RuntimeAlerts['level'],
): RuntimeAlerts['level'] {
  if (a === 'critical' || b === 'critical') return 'critical';
  if (a === 'warn' || b === 'warn') return 'warn';
  return 'ok';
}

function mergeRuntimeAndRetryAlerts(
  runtime: RuntimeAlerts,
  retry: RetryAlertSummary,
): RuntimeAlerts {
  if (retry.level === 'ok') return runtime;
  return {
    ...runtime,
    level: mergeAlertLevels(runtime.level, retry.level),
    items: [...runtime.items, ...retry.items],
  };
}

function writeRuntimeMetrics(metrics: RuntimeMetrics): void {
  fs.mkdirSync(path.dirname(runtimeMetricsPath), { recursive: true });
  const tmp = `${runtimeMetricsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(metrics, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, runtimeMetricsPath);
}

function resetRuntimeMetrics(actor: string): { ok: boolean; message: string } {
  try {
    const cur = readRuntimeMetrics();
    const prevCounters = cur?.counters || { ...DEFAULT_RUNTIME_COUNTERS };
    const next: RuntimeMetrics = {
      updatedAt: new Date().toISOString(),
      counters: { ...DEFAULT_RUNTIME_COUNTERS },
    };
    // Preserve helpful metadata for context after reset.
    if (cur?.lastStage) next.lastStage = cur.lastStage;
    if (cur?.lastTaskIds) next.lastTaskIds = cur.lastTaskIds;
    writeRuntimeMetrics(next);
    appendDashboardAction({
      action: 'runtime_reset',
      detail: 'runtime metrics reset from dashboard',
      files: ['groups/main/swarmdev/runtime-metrics.json'],
      meta: { actor, prevCounters },
    });
    return { ok: true, message: 'runtime metrics reseteadas' };
  } catch {
    return { ok: false, message: 'no se pudo resetear runtime metrics' };
  }
}

type TodoItem = {
  id: string;
  owner?: string;
  scope?: string;
  state?: string;
  source?: string;
  updatedAt?: string;
};
type TasksStateDocument = {
  version: number;
  updatedAt: string;
  source?: string;
  items: TodoItem[];
};

type TodoItemDetailed = TodoItem & {
  lineStart: number;
  lineEnd: number;
  stateLine: number; // -1 if missing
  ownerLine: number; // -1 if missing
};

function parseTodo(md: string): TodoItem[] {
  const lines = md.split('\n');
  const items: TodoItem[] = [];

  let cur: TodoItem | null = null;
  const flush = () => {
    if (!cur) return;
    if (cur.id) items.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
    if (idm) {
      flush();
      cur = { id: idm[1] };
      continue;
    }

    if (!cur) continue;

    const own = line.match(/^\s*Owner:\s*(.*)\s*$/);
    if (own) {
      cur.owner = own[1].trim();
      continue;
    }

    const scope = line.match(/^\s*Scope:\s*(.*)\s*$/);
    if (scope) {
      cur.scope = scope[1].trim();
      continue;
    }

    const st = line.match(/^\s*Estado:\s*(.*)\s*$/);
    if (st) {
      cur.state = normalizeState(st[1].trim());
      continue;
    }
  }

  flush();

  // Support compact summary generated by todo-normalizer:
  // "- IDs done: ECOM-001, ECOM-002"
  const doneSummary = md.match(/^\s*-\s*IDs\s+done:\s*(.+)\s*$/im);
  if (doneSummary?.[1]) {
    const ids = doneSummary[1]
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean)
      .filter((x) => x !== 'N/A' && /^[A-Z]+-\d+$/.test(x));
    const existing = new Set(items.map((x) => x.id));
    for (const id of ids) {
      if (existing.has(id)) continue;
      items.push({
        id,
        owner: 'teamlead',
        scope: 'Completada (resumen normalizado)',
        state: 'done',
      });
    }
  }

  return sortTodoItems(items);
}

function parseTodoDetailed(md: string): TodoItemDetailed[] {
  const lines = md.split('\n');
  const items: TodoItemDetailed[] = [];
  let cur: TodoItemDetailed | null = null;
  let curStart = -1;

  const flush = (endLine: number) => {
    if (!cur) return;
    cur.lineStart = curStart;
    cur.lineEnd = endLine;
    items.push(cur);
    cur = null;
    curStart = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
    if (idm) {
      if (cur) flush(i - 1);
      cur = {
        id: idm[1],
        lineStart: i,
        lineEnd: i,
        stateLine: -1,
        ownerLine: -1,
      };
      curStart = i;
      continue;
    }
    if (!cur) continue;

    const own = line.match(/^\s*Owner:\s*(.*)\s*$/);
    if (own) {
      cur.owner = own[1].trim();
      cur.ownerLine = i;
      continue;
    }
    const scope = line.match(/^\s*Scope:\s*(.*)\s*$/);
    if (scope) {
      cur.scope = scope[1].trim();
      continue;
    }
    const st = line.match(/^\s*Estado:\s*(.*)\s*$/);
    if (st) {
      cur.state = normalizeState(st[1].trim());
      cur.stateLine = i;
      continue;
    }
  }
  if (cur) flush(lines.length - 1);
  return items;
}

function backupPathForTodo(): string {
  return `${todoPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function writeTodoWithBackup(next: string): void {
  const cur = fs.existsSync(todoPath) ? readText(todoPath) : '';
  fs.mkdirSync(path.dirname(todoPath), { recursive: true });
  try {
    fs.writeFileSync(backupPathForTodo(), cur, 'utf-8');
  } catch {
    // ignore backup failures
  }
  const tmp = `${todoPath}.tmp`;
  fs.writeFileSync(tmp, next, 'utf-8');
  fs.renameSync(tmp, todoPath);
  syncTasksStateFromTodo(true);
}

function normalizeState(raw: string): string {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'pending') return 'todo';
  if (v === 'queue') return 'queued';
  if (v === 'queued') return 'queued';
  if (v === 'in_progress') return 'doing';
  if (v === 'in-progress') return 'doing';
  if (v === 'inprogress') return 'doing';
  if (v === 'working') return 'working';
  if (v === 'completed') return 'done';
  if (v === 'complete') return 'done';
  if (v === 'failed') return 'failed';
  if (v === 'todo' || v === 'queued' || v === 'planning' || v === 'doing' || v === 'working' || v === 'blocked' || v === 'done' || v === 'failed') return v;
  return 'todo';
}

function sortTodoItems(items: TodoItem[]): TodoItem[] {
  const now = Date.now();
  const rank = (s: string | undefined): number => {
    const v = (s || '').toLowerCase();
    if (v.includes('planning')) return 0;
    if (v.includes('doing')) return 1;
    if (v.includes('blocked') || v.includes('failed')) return 2;
    if (v.includes('todo') || v.includes('queued')) return 3;
    if (v.includes('done')) return 4;
    return 9;
  };
  return [...items].sort((a, b) => {
    const ra = rank(a.state);
    const rb = rank(b.state);
    if (ra !== rb) return ra - rb;
    const ams = parseIsoMs(a.updatedAt) || 0;
    const bms = parseIsoMs(b.updatedAt) || 0;
    const aAge = ams > 0 ? now - ams : Number.MAX_SAFE_INTEGER;
    const bAge = bms > 0 ? now - bms : Number.MAX_SAFE_INTEGER;
    if (aAge !== bAge) return aAge - bAge;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function sanitizeTodoItem(input: TodoItem): TodoItem | null {
  const id = String(input.id || '').trim().toUpperCase();
  if (!id || !/^[A-Z]+-\d+$/.test(id)) return null;
  const owner = String(input.owner || '').trim();
  const scope = String(input.scope || '').trim();
  return {
    id,
    owner: owner || undefined,
    scope: scope || undefined,
    state: normalizeState(String(input.state || 'todo')),
    source: input.source ? String(input.source) : undefined,
    updatedAt: input.updatedAt ? String(input.updatedAt) : undefined,
  };
}

function readTasksState(): TasksStateDocument | null {
  try {
    if (!fs.existsSync(tasksStatePath)) return null;
    const raw = JSON.parse(readText(tasksStatePath));
    if (!raw || typeof raw !== 'object') return null;
    const itemsRaw = Array.isArray((raw as any).items) ? (raw as any).items : [];
    const items: TodoItem[] = [];
    for (const row of itemsRaw) {
      const normalized = sanitizeTodoItem({
        id: String((row as any)?.id || ''),
        owner: String((row as any)?.owner || ''),
        scope: String((row as any)?.scope || ''),
        state: String((row as any)?.state || ''),
        source: String((row as any)?.source || ''),
        updatedAt: String((row as any)?.updatedAt || ''),
      });
      if (normalized) items.push(normalized);
    }
    return {
      version: Number((raw as any).version || 1),
      updatedAt: String((raw as any).updatedAt || ''),
      source: String((raw as any).source || ''),
      items: sortTodoItems(items),
    };
  } catch {
    return null;
  }
}

function writeTasksState(doc: TasksStateDocument): void {
  fs.mkdirSync(path.dirname(tasksStatePath), { recursive: true });
  const tmp = `${tasksStatePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, tasksStatePath);
}

function syncTasksStateFromTodo(force: boolean): TodoItem[] | null {
  try {
    if (!fs.existsSync(todoPath)) return null;
    const todoStat = fs.statSync(todoPath);
    const tasksExists = fs.existsSync(tasksStatePath);
    if (!force && tasksExists) {
      const tasksStat = fs.statSync(tasksStatePath);
      if (tasksStat.mtimeMs >= todoStat.mtimeMs) {
        const fromState = readTasksState();
        // Prefer todo.md as source of truth for Kanban rendering.
        // If tasks-state was synthesized from lanes/actions, it can drift
        // and hide "done" cards compacted by todo-normalizer.
        if (fromState && String(fromState.source || '').toLowerCase() === 'todo.md') {
          return fromState.items;
        }
      }
    }
    const md = readText(todoPath);
    const parsed = parseTodo(md);
    const doc: TasksStateDocument = {
      version: 1,
      updatedAt: new Date().toISOString(),
      source: 'todo.md',
      items: parsed,
    };
    writeTasksState(doc);
    return parsed;
  } catch {
    return null;
  }
}

function readCanonicalTodo(): TodoItem[] {
  const synced = syncTasksStateFromTodo(false);
  if (synced) {
    try {
      const running = getNanoContainers().running;
      const hasWorking = synced.some((x) => {
        const s = normalizeState(String(x.state || ''));
        return s === 'doing' || s === 'working' || s === 'queued';
      });
      if (running === 0 && hasWorking && fs.existsSync(todoPath)) {
        return mergeRuntimeIntoTodo(parseTodo(readText(todoPath)));
      }
    } catch {
      // ignore; keep synced snapshot
    }
    return mergeRuntimeIntoTodo(synced);
  }
  const fromState = readTasksState();
  if (fromState) {
    try {
      const running = getNanoContainers().running;
      const hasWorking = fromState.items.some((x) => {
        const s = normalizeState(String(x.state || ''));
        return s === 'doing' || s === 'working' || s === 'queued';
      });
      if (running === 0 && hasWorking && fs.existsSync(todoPath)) {
        return mergeRuntimeIntoTodo(parseTodo(readText(todoPath)));
      }
    } catch {
      // ignore
    }
    return mergeRuntimeIntoTodo(fromState.items);
  }
  if (fs.existsSync(todoPath)) return mergeRuntimeIntoTodo(parseTodo(readText(todoPath)));
  return mergeRuntimeIntoTodo([]);
}

function laneStateToTodoState(raw: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'working' || s === 'doing') return 'doing';
  if (s === 'queued' || s === 'planning') return 'planning';
  if (s === 'blocked' || s === 'failed') return 'blocked';
  if (s === 'done') return 'done';
  if (s === 'idle') return 'todo';
  return normalizeState(s || 'todo');
}

function roleToOwner(raw: string): string {
  const role = String(raw || '').trim().toUpperCase();
  if (!role) return 'teamlead';
  if (role === 'TEAMLEAD') return 'teamlead';
  return role.toLowerCase();
}

function stateWeight(raw: string): number {
  const s = normalizeState(raw || '');
  if (s === 'doing' || s === 'working') return 5;
  if (s === 'blocked' || s === 'failed') return 4;
  if (s === 'planning' || s === 'queued') return 3;
  if (s === 'todo') return 2;
  if (s === 'done') return 1;
  return 0;
}

function readRuntimeTodoFromWorkflow(): TodoItem[] {
  try {
    if (!fs.existsSync(workflowStatePath)) return [];
    const raw = JSON.parse(readText(workflowStatePath));
    const tasks = raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
    const out: TodoItem[] = [];
    for (const [taskIdRaw, rowAny] of Object.entries(tasks)) {
      const taskId = String(taskIdRaw || '').trim().toUpperCase();
      if (!taskId || !/^[A-Z]+-\d+$/.test(taskId)) continue;
      const row = rowAny as any;
      const updatedAt = String(row?.updatedAt || raw?.updatedAt || '').trim();
      const ms = parseIsoMs(updatedAt);
      if (ms && (Date.now() - ms) > KANBAN_RUNTIME_MAX_AGE_MS) continue;

      const pending = Array.isArray(row?.pendingQuestions)
        ? row.pendingQuestions.map((x: any) => String(x)).filter(Boolean)
        : [];
      const status = String(row?.status || '').toLowerCase();
      const stage = String(row?.stage || 'TEAMLEAD').toUpperCase();
      const result = String(row?.result || '').trim();
      const rawLastError = String(row?.lastError || '').trim();
      const lastError = /invalid transition\s+TEAMLEAD\s*->\s*TEAMLEAD/i.test(rawLastError)
        ? ''
        : rawLastError;

      let state = 'todo';
      if (pending.length > 0 || status === 'blocked') state = 'blocked';
      else if (status === 'completed' || stage === 'DONE') state = 'done';
      else if (status === 'running') state = 'doing';

      const scopeParts: string[] = [];
      if (result) scopeParts.push(result.slice(0, 140));
      if (lastError) scopeParts.push(`error: ${lastError.slice(0, 120)}`);
      if (scopeParts.length === 0) scopeParts.push(`runtime:${stage.toLowerCase()}`);

      out.push({
        id: taskId,
        owner: roleToOwner(stage),
        scope: scopeParts.join(' | '),
        state,
        source: 'workflow-state',
        updatedAt: updatedAt || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function readRuntimeTodoFromLanes(): TodoItem[] {
  try {
    if (!fs.existsSync(laneStatePath)) return [];
    const raw = JSON.parse(readText(laneStatePath));
    const tasks = raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
    const now = Date.now();
    const out: TodoItem[] = [];
    for (const [taskIdRaw, rowAny] of Object.entries(tasks)) {
      const taskId = String(taskIdRaw || '').trim().toUpperCase();
      if (!taskId || !/^[A-Z]+-\d+$/.test(taskId)) continue;
      const lanes = (rowAny as any)?.lanes;
      if (!lanes || typeof lanes !== 'object') continue;

      let bestRole = '';
      let bestState = '';
      let bestDetail = '';
      let bestUpdatedAt = '';
      let bestMs = 0;
      let bestWeight = 0;

      for (const [roleRaw, laneAny] of Object.entries(lanes)) {
        const lane = laneAny as any;
        if (!lane || typeof lane !== 'object') continue;
        const updatedAt = String(lane.updatedAt || '').trim();
        const ms = parseIsoMs(updatedAt);
        if (!ms) continue;
        if ((now - ms) > KANBAN_RUNTIME_MAX_AGE_MS) continue;

        const todoState = laneStateToTodoState(String(lane.state || 'idle'));
        const weight = stateWeight(todoState);
        if (weight <= 1) continue;
        const better = weight > bestWeight || (weight === bestWeight && ms > bestMs);
        if (!better) continue;
        bestRole = String(roleRaw || '').toUpperCase();
        bestState = todoState;
        bestDetail = String(lane.detail || '').trim();
        bestUpdatedAt = updatedAt;
        bestMs = ms;
        bestWeight = weight;
      }

      if (!bestState) continue;
      out.push({
        id: taskId,
        owner: roleToOwner(bestRole),
        scope: bestDetail ? `lane:${bestRole} ${bestDetail.slice(0, 120)}` : `lane:${bestRole}`,
        state: bestState,
        source: 'lane-state',
        updatedAt: bestUpdatedAt || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mergeRuntimeIntoTodo(baseTodo: TodoItem[]): TodoItem[] {
  const map = new Map<string, TodoItem>();
  for (const row of baseTodo || []) {
    const normalized = sanitizeTodoItem(row);
    if (!normalized) continue;
    normalized.source = normalized.source || 'todo.md';
    map.set(normalized.id, normalized);
  }

  // Apply lane hints first, then let workflow-state (orchestrator truth) win on conflicts.
  const runtimeRows = [...readRuntimeTodoFromLanes(), ...readRuntimeTodoFromWorkflow()];
  for (const row of runtimeRows) {
    const normalized = sanitizeTodoItem(row);
    if (!normalized) continue;
    const existing = map.get(normalized.id);
    if (!existing) {
      // Keep todo.md as source of truth; avoid ghost cards injected only by
      // stale lane/workflow snapshots.
      continue;
    }
    const prevState = normalizeState(existing.state || '');
    const nextState = normalizeState(normalized.state || '');
    const prevWeight = stateWeight(prevState);
    const nextWeight = stateWeight(nextState);
    const prevMs = parseIsoMs(existing.updatedAt) || 0;
    const nextMs = parseIsoMs(normalized.updatedAt) || 0;
    const workflowOverridesLane =
      normalized.source === 'workflow-state' &&
      existing.source === 'lane-state' &&
      nextMs >= (prevMs - 5 * 60 * 1000);
    const todoSourceGuard =
      existing.source === 'todo.md' &&
      !(
        normalized.source === 'lane-state' &&
        (prevState === 'todo' || prevState === 'queued' || prevState === 'planning') &&
        (nextState === 'doing' || nextState === 'blocked')
      );
    if (todoSourceGuard) continue;
    const workflowShouldNotOverrideTodoTerminal =
      normalized.source === 'workflow-state' &&
      existing.source === 'todo.md' &&
      (prevState === 'done' || prevState === 'blocked');
    if (workflowShouldNotOverrideTodoTerminal) continue;
    const hasInvalidTransitionNoise =
      normalized.source === 'workflow-state' &&
      /invalid transition\s+TEAMLEAD\s*->\s*TEAMLEAD/i.test(String(normalized.scope || ''));
    if (hasInvalidTransitionNoise) continue;
    const shouldPromote =
      workflowOverridesLane ||
      nextWeight > prevWeight ||
      (nextWeight === prevWeight && nextMs > prevMs) ||
      (prevState === 'todo' && (nextState === 'planning' || nextState === 'doing' || nextState === 'blocked'));
    if (!shouldPromote) continue;

    map.set(normalized.id, {
      ...existing,
      owner: normalized.owner || existing.owner,
      scope: normalized.scope || existing.scope,
      state: nextState,
      source: normalized.source || existing.source,
      updatedAt: normalized.updatedAt || existing.updatedAt,
    });
  }

  return sortTodoItems(Array.from(map.values()));
}

function toCanonicalPhase(stateRaw: string | undefined): 'todo' | 'queued' | 'working' | 'done' | 'blocked' | 'failed' {
  const s = normalizeState(stateRaw || '');
  if (s === 'todo' || s === 'planning') return 'todo';
  if (s === 'queued') return 'queued';
  if (s === 'doing' || s === 'working') return 'working';
  if (s === 'done') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'blocked') return 'blocked';
  return 'todo';
}

function isValidTransition(
  from: 'todo' | 'queued' | 'working' | 'done' | 'blocked' | 'failed',
  to: 'todo' | 'queued' | 'working' | 'done' | 'blocked' | 'failed',
): boolean {
  if (from === to) return true;
  const allowed: Record<string, Array<'todo' | 'queued' | 'working' | 'done' | 'blocked' | 'failed'>> = {
    todo: ['queued'],
    queued: ['working', 'blocked'],
    working: ['done', 'blocked', 'failed'],
    blocked: ['queued'],
    failed: ['queued'],
    done: [],
  };
  return (allowed[from] || []).includes(to);
}

function appendTodoItem(input: {
  id: string;
  owner?: string;
  scope: string;
  state?: string;
  entregable?: string;
  tests?: string;
}): { ok: boolean; message: string } {
  const current = fs.existsSync(todoPath) ? readText(todoPath) : '# TODO (SwarmDev)\n\n';
  const items = parseTodoDetailed(current);

  let id = String(input.id || '').trim().toUpperCase();
  if (!id) {
    // Autogenerate if user leaves ID empty from dashboard.
    const seed = Date.now().toString().slice(-6);
    id = `DASH-${seed}`;
  }
  if (!/^[A-Z]+-\d+$/.test(id)) {
    return { ok: false, message: 'ID invalido (usar formato ABC-123 o vacio para autogenerar)' };
  }
  const scope = String(input.scope || '').trim();
  if (!scope) return { ok: false, message: 'Scope requerido' };

  const owner = String(input.owner || 'PM').trim() || 'PM';
  const state = normalizeState(String(input.state || 'todo'));
  const entregable = String(input.entregable || 'n/a').trim() || 'n/a';
  const tests = String(input.tests || 'n/a').trim() || 'n/a';

  if (items.some((x) => x.id === id)) {
    return { ok: false, message: `ID ${id} ya existe` };
  }

  const sectionTitle = '## Dashboard Inbox';
  let next = current;
  if (!next.includes(sectionTitle)) {
    if (!next.endsWith('\n')) next += '\n';
    next += `\n${sectionTitle}\n`;
  }
  if (!next.endsWith('\n')) next += '\n';
  next +=
    `- ID: ${id}\n` +
    `  Owner: ${owner}\n` +
    `  Scope: ${scope}\n` +
    `  Entregable: ${entregable}\n` +
    `  Tests: ${tests}\n` +
    `  Estado: ${state}\n\n`;

  writeTodoWithBackup(next);
  return { ok: true, message: `Tarea ${id} creada` };
}

function updateTodoState(id: string, state: string): { ok: boolean; message: string } {
  if (!fs.existsSync(todoPath)) return { ok: false, message: 'todo.md no existe' };
  const md = readText(todoPath);
  const lines = md.split('\n');
  const items = parseTodoDetailed(md);
  const target = items.find((x) => x.id === id);
  if (!target) return { ok: false, message: `No existe ID ${id}` };

  const st = normalizeState(state);
  const fromPhase = toCanonicalPhase(target.state || 'todo');
  const toPhase = toCanonicalPhase(st);
  if (!isValidTransition(fromPhase, toPhase)) {
    return {
      ok: false,
      message: `Transicion invalida ${fromPhase} -> ${toPhase}. Permitidas: todo->queued, queued->working|blocked, working->done|blocked|failed, blocked/failed->queued`,
    };
  }
  if (target.stateLine >= 0) {
    const line = lines[target.stateLine];
    const m = line.match(/^(\s*)Estado:\s*(.*)$/);
    const indent = m ? m[1] : '  ';
    lines[target.stateLine] = `${indent}Estado: ${st}`;
  } else {
    const insertAt = Math.min(lines.length, target.lineEnd + 1);
    lines.splice(insertAt, 0, `  Estado: ${st}`);
  }

  writeTodoWithBackup(lines.join('\n'));
  return { ok: true, message: `Estado de ${id} -> ${st} (${fromPhase} -> ${toPhase})` };
}

function sendTodoToAll(id: string): { ok: boolean; message: string } {
  if (!fs.existsSync(todoPath)) return { ok: false, message: 'todo.md no existe' };
  const md = readText(todoPath);
  const lines = md.split('\n');
  const items = parseTodoDetailed(md);
  const target = items.find((x) => x.id === id);
  if (!target) return { ok: false, message: `No existe ID ${id}` };

  const teamOwner = 'pm-sr, arquitecto, dev-sr, qa';
  if (target.ownerLine >= 0) {
    const line = lines[target.ownerLine];
    const m = line.match(/^(\s*)Owner:\s*(.*)$/);
    const indent = m ? m[1] : '  ';
    lines[target.ownerLine] = `${indent}Owner: ${teamOwner}`;
  } else {
    lines.splice(Math.min(lines.length, target.lineStart + 1), 0, `  Owner: ${teamOwner}`);
  }

  // Force planning stage when broadcasting to all.
  if (target.stateLine >= 0) {
    const line = lines[target.stateLine];
    const m = line.match(/^(\s*)Estado:\s*(.*)$/);
    const indent = m ? m[1] : '  ';
    lines[target.stateLine] = `${indent}Estado: planning`;
  } else {
    lines.splice(Math.min(lines.length, target.lineEnd + 1), 0, '  Estado: planning');
  }

  writeTodoWithBackup(lines.join('\n'));
  return { ok: true, message: `Tarea ${id} enviada a todo el equipo` };
}

function clearTodo(mode: 'completed' | 'all'): { ok: boolean; removed: number } {
  if (!fs.existsSync(todoPath)) return { ok: false, removed: 0 };
  const md = readText(todoPath);
  const lines = md.split('\n');
  const items = parseTodoDetailed(md);

  let toRemove = items;
  if (mode === 'completed') {
    toRemove = items.filter((x) => String(x.state || '').toLowerCase().includes('done'));
  }
  if (toRemove.length === 0) return { ok: true, removed: 0 };

  // Remove from bottom to top to keep indices stable.
  const ranges = toRemove
    .map((x) => ({ a: x.lineStart, b: x.lineEnd }))
    .sort((r1, r2) => r2.a - r1.a);

  for (const r of ranges) {
    // Also remove one trailing blank separator if present.
    let end = r.b;
    if (end + 1 < lines.length && lines[end + 1].trim() === '') end += 1;
    lines.splice(r.a, end - r.a + 1);
  }

  writeTodoWithBackup(lines.join('\n'));
  return { ok: true, removed: toRemove.length };
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getRequestActor(req: http.IncomingMessage): string {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Basic ')) return 'dashboard';
  const b64 = h.slice('Basic '.length).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return 'dashboard';
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return 'dashboard';
  const user = decoded.slice(0, idx).trim();
  return user || 'dashboard';
}

function appendDashboardAction(input: {
  action: string;
  detail?: string;
  files?: string[];
  meta?: Record<string, unknown>;
}): void {
  try {
    const row = {
      ts: new Date().toISOString(),
      groupFolder: 'main',
      stage: 'DASH',
      action: input.action,
      detail: input.detail || '',
      files: input.files || [],
      meta: input.meta || {},
    };
    fs.mkdirSync(path.dirname(actionsPath), { recursive: true });
    fs.appendFileSync(actionsPath, JSON.stringify(row) + '\n', 'utf-8');
  } catch {
    // ignore dashboard action failures
  }
}

function readRuntimeAlertState(): { level: string; itemsSig: string } | null {
  try {
    if (!fs.existsSync(runtimeAlertStatePath)) return null;
    const raw = JSON.parse(readText(runtimeAlertStatePath));
    if (!raw || typeof raw !== 'object') return null;
    return {
      level: String((raw as any).level || ''),
      itemsSig: String((raw as any).itemsSig || ''),
    };
  } catch {
    return null;
  }
}

function writeRuntimeAlertState(next: { level: string; itemsSig: string }): void {
  fs.mkdirSync(path.dirname(runtimeAlertStatePath), { recursive: true });
  const tmp = `${runtimeAlertStatePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, runtimeAlertStatePath);
}

function appendRuntimeAlertHistory(row: RuntimeAlertHistoryItem): void {
  try {
    fs.mkdirSync(path.dirname(runtimeAlertHistoryPath), { recursive: true });
    fs.appendFileSync(runtimeAlertHistoryPath, JSON.stringify(row) + '\n', 'utf-8');
  } catch {
    // ignore alert history write failures
  }
}

function readRuntimeAlertHistoryTail(maxLines: number): RuntimeAlertHistoryItem[] {
  return readJsonlTail(runtimeAlertHistoryPath, maxLines) as RuntimeAlertHistoryItem[];
}

function syncRuntimeAlertHistory(params: {
  runtimeAlerts: RuntimeAlerts;
  status: Status;
  health: DerivedHealth;
}): void {
  const level = String(params.runtimeAlerts.level || 'ok');
  const items = Array.isArray(params.runtimeAlerts.items)
    ? params.runtimeAlerts.items.map(String)
    : [];
  const itemsSig = items.join('|').slice(0, 500);
  const prev = readRuntimeAlertState();
  if (prev && prev.level === level && prev.itemsSig === itemsSig) return;

  appendRuntimeAlertHistory({
    ts: new Date().toISOString(),
    level: level as RuntimeAlertHistoryItem['level'],
    items,
    stage: params.status.stage,
    agentState: params.health.agentState,
    transportState: params.health.transportState,
  });
  writeRuntimeAlertState({ level, itemsSig });
}

function runWatchdogNow(actor: string): { ok: boolean; message: string; output: string } {
  const watchdogPath = path.join(projectRoot, 'scripts', 'watchdog.mjs');
  try {
    const output = execFileSync('node', [watchdogPath], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 45_000,
      env: process.env,
    }).trim();
    appendDashboardAction({
      action: 'watchdog_run_manual',
      detail: 'watchdog executed from dashboard',
      files: ['scripts/watchdog.mjs', 'store/watchdog.json'],
      meta: { actor, ok: true, output: output.slice(0, 500) },
    });
    return { ok: true, message: 'watchdog ejecutado', output };
  } catch (err: any) {
    const stdout = String(err?.stdout || '').trim();
    const stderr = String(err?.stderr || '').trim();
    const merged = [stdout, stderr].filter(Boolean).join('\n').trim();
    appendDashboardAction({
      action: 'watchdog_run_manual',
      detail: 'watchdog execution failed from dashboard',
      files: ['scripts/watchdog.mjs', 'store/watchdog.json'],
      meta: { actor, ok: false, output: merged.slice(0, 500) },
    });
    return {
      ok: false,
      message: 'watchdog fallo',
      output: merged || String(err?.message || 'unknown watchdog error'),
    };
  }
}

function readWorkflowStateRaw(): any {
  try {
    if (!fs.existsSync(workflowStatePath)) return { version: 1, updatedAt: new Date().toISOString(), tasks: {} };
    const raw = JSON.parse(readText(workflowStatePath));
    if (!raw || typeof raw !== 'object' || typeof raw.tasks !== 'object') {
      return { version: 1, updatedAt: new Date().toISOString(), tasks: {} };
    }
    return raw;
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), tasks: {} };
  }
}

function writeWorkflowStateRaw(state: any): void {
  fs.mkdirSync(path.dirname(workflowStatePath), { recursive: true });
  const next = {
    ...state,
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks: typeof state?.tasks === 'object' ? state.tasks : {},
  };
  const tmp = `${workflowStatePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, workflowStatePath);
}

function getBlockedQueue(): BlockedQueueItem[] {
  const st = readWorkflowStateRaw();
  const tasks = Object.entries(st.tasks || {});
  const out: BlockedQueueItem[] = [];
  for (const [taskId, rowAny] of tasks) {
    const row = rowAny as any;
    const questions = Array.isArray(row?.pendingQuestions)
      ? row.pendingQuestions.map((x: any) => String(x)).filter(Boolean)
      : [];
    if (questions.length === 0) continue;
    out.push({
      taskId: String(taskId).toUpperCase(),
      stage: String(row?.stage || 'BLOCKED'),
      status: String(row?.status || 'blocked'),
      questions,
      updatedAt: String(row?.updatedAt || st.updatedAt || 'n/a'),
    });
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getActiveTaskLanes(): ActiveLaneTask[] {
  try {
    if (!fs.existsSync(laneStatePath)) return [];
    const raw = JSON.parse(readText(laneStatePath));
    const tasks = raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
    const out: ActiveLaneTask[] = [];
    const now = Date.now();
    const laneRoles: LaneRole[] = ['PM', 'ARQ', 'SPEC', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'];
    for (const [taskIdRaw, row] of Object.entries(tasks)) {
      const taskId = String(taskIdRaw || '').trim().toUpperCase();
      if (!taskId) continue;
      const lanesAny = (row as any)?.lanes || {};
      const lanes: LaneCard[] = [];
      for (const role of laneRoles) {
        const lane = lanesAny?.[role];
        if (!lane || typeof lane !== 'object') continue;
        const state = String((lane as any).state || 'idle');
        if (state === 'idle') continue;
        lanes.push({
          role,
          state,
          updatedAt: String((lane as any).updatedAt || 'n/a'),
          detail: (lane as any).detail ? String((lane as any).detail) : undefined,
          dependency: (lane as any).dependency ? String((lane as any).dependency) : undefined,
        });
      }
      if (lanes.length === 0) continue;
      const laneFresh = lanes.some((lane) => {
        const ms = parseIsoMs(lane.updatedAt);
        return !!ms && (now - ms) <= ACTIVE_LANE_MAX_AGE_MS;
      });
      if (!laneFresh) continue;
      lanes.sort((a, b) => a.role.localeCompare(b.role));
      const teamleadSummary = (row as any)?.teamleadSummary && typeof (row as any).teamleadSummary === 'object'
        ? {
          updatedAt: String((row as any).teamleadSummary.updatedAt || 'n/a'),
          file: String((row as any).teamleadSummary.file || ''),
          summary: String((row as any).teamleadSummary.summary || ''),
        }
        : undefined;
      out.push({
        taskId,
        lanes,
        teamleadSummary,
      });
    }
    const laneUpdatedMs = (item: ActiveLaneTask): number => {
      let max = 0;
      for (const lane of item.lanes) {
        const ms = parseIsoMs(lane.updatedAt) || 0;
        if (ms > max) max = ms;
      }
      return max;
    };
    return out.sort((a, b) => laneUpdatedMs(b) - laneUpdatedMs(a));
  } catch {
    return [];
  }
}

function reconcileLaneState(actor: string, taskIdFilter?: string): { ok: boolean; message: string; touched: number } {
  try {
    if (!fs.existsSync(laneStatePath)) {
      return { ok: true, message: 'lane-state inexistente (nada para sync)', touched: 0 };
    }
    const filter = String(taskIdFilter || '').trim().toUpperCase();
    const raw = JSON.parse(readText(laneStatePath));
    const tasks = raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
    const now = Date.now();
    let touched = 0;

    for (const [taskIdRaw, taskAny] of Object.entries(tasks)) {
      const taskId = String(taskIdRaw || '').trim().toUpperCase();
      if (filter && taskId !== filter) continue;
      const task = taskAny as any;
      const lanes = task?.lanes && typeof task.lanes === 'object' ? task.lanes : {};
      for (const [role, laneAny] of Object.entries(lanes)) {
        const lane = laneAny as any;
        if (!lane || typeof lane !== 'object') continue;
        const state = String(lane.state || '').toLowerCase();
        if (state !== 'working' && state !== 'queued') continue;
        const ms = parseIsoMs(lane.updatedAt);
        const stale = !ms || (now - ms) > ACTIVE_LANE_MAX_AGE_MS;
        if (!stale) continue;
        lane.state = 'idle';
        lane.detail = `auto-sync: stale lane ${role}`;
        lane.updatedAt = new Date().toISOString();
        touched++;
      }
    }

    raw.tasks = tasks;
    raw.version = 1;
    raw.updatedAt = new Date().toISOString();
    const tmp = `${laneStatePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, laneStatePath);

    appendDashboardAction({
      action: 'lane_sync_manual',
      detail: `lane-state sync ejecutado desde dashboard${filter ? ` (${filter})` : ''} (touched=${touched})`,
      files: ['groups/main/swarmdev/lane-state.json'],
      meta: { actor, touched, maxAgeMs: ACTIVE_LANE_MAX_AGE_MS, taskId: filter || undefined },
    });
    return { ok: true, message: `sync lanes ok (${touched} lanes corregidos)`, touched };
  } catch {
    return { ok: false, message: 'fallo sync lanes', touched: 0 };
  }
}

function forceTodoState(id: string, state: string): { ok: boolean; message: string } {
  if (!fs.existsSync(todoPath)) return { ok: false, message: 'todo.md no existe' };
  const md = readText(todoPath);
  const lines = md.split('\n');
  const items = parseTodoDetailed(md);
  const target = items.find((x) => x.id === id);
  if (!target) return { ok: false, message: `No existe ID ${id}` };
  const st = normalizeState(state);
  if (target.stateLine >= 0) {
    const line = lines[target.stateLine];
    const m = line.match(/^(\s*)Estado:\s*(.*)$/);
    const indent = m ? m[1] : '  ';
    lines[target.stateLine] = `${indent}Estado: ${st}`;
  } else {
    lines.splice(Math.min(lines.length, target.lineEnd + 1), 0, `  Estado: ${st}`);
  }
  writeTodoWithBackup(lines.join('\n'));
  return { ok: true, message: `Estado forzado ${id} -> ${st}` };
}

function clearWorkflowBlockedQuestions(taskId: string): void {
  try {
    const st = readWorkflowStateRaw();
    const id = String(taskId || '').trim().toUpperCase();
    const row = (st?.tasks || {})[id];
    if (!row || typeof row !== 'object') return;
    if (Array.isArray((row as any).pendingQuestions) && (row as any).pendingQuestions.length > 0) {
      (row as any).pendingQuestions = [];
      (row as any).updatedAt = new Date().toISOString();
      if (String((row as any).status || '').toLowerCase() === 'blocked') (row as any).status = 'active';
      if (String((row as any).stage || '').toUpperCase() === 'BLOCKED') (row as any).stage = 'DEV';
      st.tasks[id] = row;
      writeWorkflowStateRaw(st);
    }
  } catch {
    // ignore workflow cleanup failures
  }
}

function resetTaskLanes(taskId: string, actor: string, markQueued: boolean): { ok: boolean; touched: number } {
  try {
    if (!fs.existsSync(laneStatePath)) return { ok: true, touched: 0 };
    const raw = JSON.parse(readText(laneStatePath));
    const tasks = raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {};
    const id = String(taskId || '').trim().toUpperCase();
    const row = tasks[id];
    if (!row || typeof row !== 'object' || typeof (row as any).lanes !== 'object') return { ok: true, touched: 0 };
    const lanes = (row as any).lanes;
    let touched = 0;
    const now = new Date().toISOString();
    for (const laneAny of Object.values(lanes)) {
      const lane = laneAny as any;
      if (!lane || typeof lane !== 'object') continue;
      const prevState = String(lane.state || 'idle').toLowerCase();
      if (prevState === 'done') continue;
      const nextState = markQueued ? 'queued' : 'idle';
      if (prevState === nextState && String(lane.detail || '').includes('manual action')) continue;
      lane.state = nextState;
      lane.updatedAt = now;
      lane.detail = `manual action by ${actor}`;
      touched++;
    }
    raw.tasks = tasks;
    raw.version = 1;
    raw.updatedAt = now;
    const tmp = `${laneStatePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, laneStatePath);
    return { ok: true, touched };
  } catch {
    return { ok: false, touched: 0 };
  }
}

function taskControlAction(params: {
  actor: string;
  taskId: string;
  action: 'retry' | 'requeue' | 'block' | 'clear_stale';
}): { ok: boolean; message: string; touched?: number } {
  const taskId = String(params.taskId || '').trim().toUpperCase();
  if (!taskId) return { ok: false, message: 'task id requerido' };

  if (params.action === 'clear_stale') {
    const out = reconcileLaneState(params.actor, taskId);
    if (!out.ok) return { ok: false, message: out.message };
    appendDashboardAction({
      action: 'task_control',
      detail: `clear stale lanes on ${taskId}`,
      files: ['groups/main/swarmdev/lane-state.json'],
      meta: { actor: params.actor, taskId, taskAction: 'clear_stale', touched: out.touched },
    });
    return { ok: true, message: `clear stale ${taskId}: ${out.touched} lanes`, touched: out.touched };
  }

  if (params.action === 'block') {
    const out = forceTodoState(taskId, 'blocked');
    if (!out.ok) return { ok: false, message: out.message };
    appendDashboardAction({
      action: 'task_control',
      detail: `task ${taskId} moved to blocked`,
      files: ['groups/main/todo.md'],
      meta: { actor: params.actor, taskId, taskAction: 'block' },
    });
    return { ok: true, message: `task ${taskId} -> blocked` };
  }

  const out = forceTodoState(taskId, 'queued');
  if (!out.ok) return { ok: false, message: out.message };
  clearWorkflowBlockedQuestions(taskId);
  const laneOut = resetTaskLanes(taskId, params.actor, true);
  appendDashboardAction({
    action: 'task_control',
    detail: `task ${taskId} ${params.action}`,
    files: ['groups/main/todo.md', 'groups/main/swarmdev/lane-state.json', 'groups/main/swarmdev/workflow-state.json'],
    meta: { actor: params.actor, taskId, taskAction: params.action, laneTouched: laneOut.touched },
  });
  return {
    ok: true,
    message: `task ${taskId} -> queued (${params.action})`,
    touched: laneOut.touched,
  };
}

function resolveBlockedTask(params: {
  actor: string;
  taskId: string;
  decision: string;
}): { ok: boolean; message: string } {
  try {
    const taskId = params.taskId.trim().toUpperCase();
    if (!taskId) return { ok: false, message: 'taskId requerido' };
    const decision = params.decision.trim();
    if (!decision) return { ok: false, message: 'decision requerida' };

    const st = readWorkflowStateRaw();
    const row = st.tasks?.[taskId];
    if (!row || typeof row !== 'object') return { ok: false, message: `task ${taskId} no existe` };
    const pending = Array.isArray(row.pendingQuestions) ? row.pendingQuestions.filter(Boolean) : [];
    if (pending.length === 0) return { ok: false, message: `task ${taskId} sin preguntas pendientes` };

    const prevStage = String(row.stage || 'BLOCKED');
    row.pendingQuestions = [];
    row.decisions = Array.isArray(row.decisions) ? row.decisions : [];
    row.decisions.push(decision);
    row.stage = 'TEAMLEAD';
    row.status = 'running';
    row.updatedAt = new Date().toISOString();
    row.transitions = Array.isArray(row.transitions) ? row.transitions : [];
    row.transitions.push({
      ts: row.updatedAt,
      from: prevStage,
      to: 'TEAMLEAD',
      reason: 'dashboard decision',
    });

    st.tasks[taskId] = row;
    writeWorkflowStateRaw(st);

    appendDashboardAction({
      action: 'blocked_resolved',
      detail: `resolved blocked task ${taskId} from dashboard`,
      files: ['groups/main/swarmdev/workflow-state.json'],
      meta: { actor: params.actor, taskId, decision, previousStage: prevStage },
    });
    return { ok: true, message: `task ${taskId} desbloqueada` };
  } catch {
    return { ok: false, message: 'no se pudo resolver el bloqueo' };
  }
}

function unauthorized(res: http.ServerResponse): void {
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SwarmClaw — Enter the Olympus</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:"Georgia","Cinzel","Times New Roman",serif;
background:linear-gradient(135deg,#eef2f5 0%,#d4e8f9 50%,#f0e6d3 100%)}
.login{background:rgba(255,255,255,0.92);border:2px solid rgba(212,175,55,0.5);
border-radius:20px;padding:48px 40px;max-width:380px;width:90%;
box-shadow:0 20px 60px rgba(180,150,80,0.15),0 0 0 1px rgba(255,255,255,0.8) inset;
text-align:center}
.login h1{font-size:28px;color:#2a2a2a;margin-bottom:6px;letter-spacing:1px}
.login .sub{font-size:13px;color:#888;margin-bottom:28px}
.login .icon{font-size:52px;margin-bottom:16px;display:block}
.field{width:100%;border:2px solid rgba(212,175,55,0.35);border-radius:12px;
padding:12px 16px;font-size:15px;font-family:inherit;color:#333;
background:rgba(255,255,255,0.8);margin-bottom:14px;outline:none;transition:border 0.2s}
.field:focus{border-color:rgba(212,175,55,0.8)}
.btn{width:100%;padding:14px;border:none;border-radius:12px;font-size:15px;
font-weight:700;font-family:inherit;letter-spacing:0.5px;cursor:pointer;
background:linear-gradient(135deg,#f9d976,#d4af37);color:#2a2a2a;
box-shadow:0 4px 16px rgba(212,175,55,0.3);transition:transform 0.15s,box-shadow 0.15s}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(212,175,55,0.4)}
.btn:active{transform:translateY(0)}
.err{color:#c0392b;font-size:12px;margin-top:10px;min-height:18px}
</style>
</head>
<body>
<form class="login" onsubmit="return doLogin(event)">
<span class="icon">\u26A1</span>
<h1>SwarmClaw</h1>
<p class="sub">Enter the Olympus Control Room</p>
<input class="field" id="user" type="text" placeholder="Username" autocomplete="username" autofocus>
<input class="field" id="pass" type="password" placeholder="Password" autocomplete="current-password">
<button class="btn" type="submit">Enter \u26A1</button>
<p class="err" id="err"></p>
</form>
<script>
function doLogin(e){
e.preventDefault();
var u=document.getElementById('user').value;
var p=document.getElementById('pass').value;
var h='Basic '+btoa(u+':'+p);
fetch('/api/state',{headers:{Authorization:h}}).then(function(r){
if(r.ok){document.cookie='swarmauth='+encodeURIComponent(h)+';path=/;max-age=86400';location.reload()}
else{document.getElementById('err').textContent='Invalid credentials'}
}).catch(function(){document.getElementById('err').textContent='Connection error'});
return false;
}
</script>
</body>
</html>`);
}

function isAuthorized(req: http.IncomingMessage): boolean {
  if (!DASH_AUTH_ENABLED) return true;
  // Check Basic Auth header
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Basic ')) {
    return checkBasicAuth(h);
  }
  // Check cookie fallback (set by custom login page)
  const cookies = String(req.headers.cookie || '');
  const match = cookies.match(/swarmauth=([^;]+)/);
  if (match) {
    const cookieAuth = decodeURIComponent(match[1]);
    if (cookieAuth.startsWith('Basic ')) {
      return checkBasicAuth(cookieAuth);
    }
  }
  return false;
}

function checkBasicAuth(header: string): boolean {
  const b64 = header.slice('Basic '.length).trim();
  let decoded = '';
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return user === DASH_AUTH_USER && pass === DASH_AUTH_PASS;
}

function serveFile(res: http.ServerResponse, p: string, contentType: string): void {
  try {
    const buf = fs.readFileSync(p);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

function json(res: http.ServerResponse, obj: unknown): void {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj, null, 2));
}

function readJsonlTail(p: string, maxLines: number): any[] {
  try {
    if (!fs.existsSync(p)) return [];
    const raw = readText(p);
    const lines = raw.split('\n').filter(Boolean);
    const tail = lines.slice(Math.max(0, lines.length - maxLines));
    const out: any[] = [];
    for (const line of tail) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // ignore
      }
    }
    return out;
  } catch {
    return [];
  }
}

function parseIsoMs(s: unknown): number | null {
  if (typeof s !== 'string' || !s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeRoleName(v: unknown): RoleName | null {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'TEAMLEAD' || s === 'TEAM-LEAD' || s === 'LEAD') return 'TEAMLEAD';
  if (s === 'PM') return 'PM';
  if (s === 'ARQ' || s === 'ARCH' || s === 'ARQUITECTO') return 'ARQ';
  if (s === 'SPEC') return 'SPEC';
  if (s === 'UX' || s === 'UX/UI') return 'UX';
  if (s === 'DEV2' || s === 'DEV-2') return 'DEV2';
  if (s === 'DEVOPS' || s === 'DEV-OPS') return 'DEVOPS';
  if (s === 'DEV') return 'DEV';
  if (s === 'QA') return 'QA';
  return null;
}

function inferActiveRole(status: Status, runtimeMetrics: RuntimeMetrics | null): RoleName | null {
  const stageRaw = String(status.stage || '').toLowerCase();
  const itemRaw = String(status.item || '').toLowerCase();
  const statusLooksIdle =
    (stageRaw.includes('idle') || stageRaw === 'n/a') &&
    !itemRaw.includes('processing') &&
    !itemRaw.includes('spawning') &&
    !itemRaw.includes('running') &&
    !itemRaw.includes('piped');
  if (statusLooksIdle) return null;

  const fromStatus = normalizeRoleName(status.stage);
  if (fromStatus) return fromStatus;
  const fromRuntime = normalizeRoleName(runtimeMetrics?.lastStage);
  if (fromRuntime) return fromRuntime;
  return null;
}

function deriveRoleStatus(
  status: Status,
  runtimeMetrics: RuntimeMetrics | null,
  events: any[],
  actions: any[],
  activeTaskLanes: ActiveLaneTask[] = [],
  activeContainers: number | null = null,
): RoleState[] {
  const roles: RoleName[] = ['TEAMLEAD', 'PM', 'ARQ', 'SPEC', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'];
  const now = Date.now();
  const activeRole = inferActiveRole(status, runtimeMetrics);
  const statusAgeMs = parseIsoMs(status.updatedAt);

  const lastByRole: Record<RoleName, { ts: string | null; ms: number | null; source: 'events' | 'actions' | 'none' }> = {
    TEAMLEAD: { ts: null, ms: null, source: 'none' },
    PM: { ts: null, ms: null, source: 'none' },
    ARQ: { ts: null, ms: null, source: 'none' },
    SPEC: { ts: null, ms: null, source: 'none' },
    UX: { ts: null, ms: null, source: 'none' },
    DEV: { ts: null, ms: null, source: 'none' },
    DEV2: { ts: null, ms: null, source: 'none' },
    DEVOPS: { ts: null, ms: null, source: 'none' },
    QA: { ts: null, ms: null, source: 'none' },
  };

  for (const ev of events || []) {
    const role = normalizeRoleName(ev?.stage);
    if (!role) continue;
    const ts = typeof ev?.ts === 'string' ? ev.ts : null;
    const ms = parseIsoMs(ts);
    if (!ms) continue;
    const prev = lastByRole[role].ms || 0;
    if (ms > prev) lastByRole[role] = { ts, ms, source: 'events' };
  }
  for (const ac of actions || []) {
    const role = normalizeRoleName(ac?.stage);
    if (!role) continue;
    const ts = typeof ac?.ts === 'string' ? ac.ts : null;
    const ms = parseIsoMs(ts);
    if (!ms) continue;
    const prev = lastByRole[role].ms || 0;
    if (ms > prev) lastByRole[role] = { ts, ms, source: 'actions' };
  }
  const roleFromLane = (role: string): RoleName | null => {
    const r = String(role || '').toUpperCase();
    if (r === 'PM') return 'PM';
    if (r === 'ARQ') return 'ARQ';
    if (r === 'SPEC') return 'SPEC';
    if (r === 'UX') return 'UX';
    if (r === 'DEV') return 'DEV';
    if (r === 'DEV2') return 'DEV2';
    if (r === 'DEVOPS') return 'DEVOPS';
    if (r === 'QA') return 'QA';
    return null;
  };
  const laneWorkingRoles = new Set<RoleName>();
  for (const task of activeTaskLanes || []) {
    for (const lane of task.lanes || []) {
      const role = roleFromLane(lane.role);
      if (!role) continue;
      const laneState = String(lane.state || '').toLowerCase();
      const ms = parseIsoMs(lane.updatedAt);
      const laneAgeMs = ms ? Math.max(0, now - ms) : null;
      const noActiveContainers = (activeContainers ?? 0) <= 0;
      const laneFreshWithoutContainer =
        laneAgeMs !== null && laneAgeMs <= ROLE_ACTIVE_NO_CONTAINER_GRACE_MS;
      if (laneState === 'working' || laneState === 'queued') {
        if (!noActiveContainers || laneFreshWithoutContainer) {
          laneWorkingRoles.add(role);
        }
      }
      if (!ms) continue;
      const prev = lastByRole[role].ms || 0;
      if (ms > prev) {
        lastByRole[role] = { ts: lane.updatedAt, ms, source: 'actions' };
      }
    }
  }

  return roles.map((role) => {
    const row = lastByRole[role];
    const age = row.ms ? Math.max(0, now - row.ms) : null;
    const laneActive = laneWorkingRoles.has(role);
    const isActive = laneActive || activeRole === role;

    let state: RoleState['state'] = 'idle';
    if (isActive) {
      const ageBasis = laneActive
        ? (age ?? 0)
        : (statusAgeMs ? Math.max(0, now - statusAgeMs) : (age ?? 0));
      state = ageBasis >= ROLE_STUCK_MS ? 'stuck' : 'working';
    } else {
      state = 'idle';
    }

    return {
      role,
      state,
      lastSeenAt: row.ts,
      lastSeenAgoMs: age,
      source: row.source,
    };
  });
}

function toIsoOrNa(v: unknown): string {
  return typeof v === 'string' && v ? v : 'n/a';
}

function buildRunbook(params: {
  now: string;
  status: Status;
  health: DerivedHealth;
  runtimeAlerts: RuntimeAlerts;
  runtimeMetrics: RuntimeMetrics | null;
  roleStatus: RoleState[];
  blockedQueue: BlockedQueueItem[];
  events: any[];
  actions: any[];
}): RuntimeRunbook {
  const incidents: RunbookItem[] = [];
  const pushIncident = (ts: string, kind: string, detail: string) => {
    incidents.push({ ts: toIsoOrNa(ts), kind, detail: String(detail || '').slice(0, 220) });
  };

  const actionTail = (params.actions || []).slice(-80);
  for (const a of actionTail) {
    const act = String(a?.action || '');
    if (act === 'finish_error' || act === 'watchdog_run_manual' || act === 'runtime_reset' || act === 'blocked_resolved') {
      pushIncident(a?.ts, `action:${act}`, String(a?.detail || ''));
    }
  }
  const eventTail = (params.events || []).slice(-80);
  for (const e of eventTail) {
    const kind = String(e?.kind || '');
    const msg = String(e?.msg || e?.item || '');
    if (kind === 'error' || kind === 'watchdog' || /watchdog|logged out|reconnecting|timeout/i.test(msg)) {
      pushIncident(e?.ts, `event:${kind || 'log'}`, msg);
    }
  }
  incidents.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  const inc = incidents.slice(0, 10);

  const blockedCount = (params.blockedQueue || []).length;
  const activeLaneCount = getActiveTaskLanes().length;
  const stuckRoles = (params.roleStatus || []).filter((r) => r.state === 'stuck').map((r) => r.role);
  const summary = [
    `Estado: ${params.status.stage} | Item: ${params.status.item}`,
    `Agent=${params.health.agentState} WA=${params.health.transportState} Containers=${params.health.activeContainers} stale=${params.health.staleContainers}`,
    `Alerts=${params.runtimeAlerts.level.toUpperCase()} (${(params.runtimeAlerts.items || []).join(' | ') || 'sin alertas'})`,
    `Blocked queue=${blockedCount} | Active lanes=${activeLaneCount} | Roles stuck=${stuckRoles.join(', ') || 'none'}`,
  ];

  const reportLines = [
    `Runbook Report @ ${params.now}`,
    `status.stage=${params.status.stage}`,
    `status.item=${params.status.item}`,
    `status.next=${params.status.next}`,
    `status.updatedAt=${params.status.updatedAt}`,
    `health.agentState=${params.health.agentState}`,
    `health.transportState=${params.health.transportState}`,
    `health.activeContainers=${params.health.activeContainers}`,
    `health.staleContainers=${params.health.staleContainers}`,
    `health.orphanContainers=${params.health.orphanContainers}`,
    `runtime.alertLevel=${params.runtimeAlerts.level}`,
    `runtime.alertItems=${(params.runtimeAlerts.items || []).join(' | ') || 'none'}`,
    `runtime.requests=${params.runtimeMetrics?.counters?.requestsStarted ?? 0}`,
    `runtime.outputs=${params.runtimeMetrics?.counters?.outputsSent ?? 0}`,
    `runtime.agentErrors=${params.runtimeMetrics?.counters?.agentErrors ?? 0}`,
    `runtime.validationFailures=${params.runtimeMetrics?.counters?.validationFailures ?? 0}`,
    `blocked.queue=${blockedCount}`,
    `lanes.active.tasks=${activeLaneCount}`,
    `roles.stuck=${stuckRoles.join(',') || 'none'}`,
    '',
    'Recent incidents:',
    ...inc.map((x) => `- ${x.ts} [${x.kind}] ${x.detail}`),
  ];

  return {
    generatedAt: params.now,
    summary,
    incidents: inc,
    report: reportLines.join('\n'),
  };
}

function appleStartedDateToEpochMs(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  // Apple CFAbsoluteTime seconds since 2001-01-01.
  const APPLE_EPOCH_UNIX_SEC = 978307200;
  return Math.round((v + APPLE_EPOCH_UNIX_SEC) * 1000);
}

function getNanoContainers(): { ids: string[]; running: number; agesMs: Record<string, number> } {
  try {
    const out = execFileSync('container', ['ls', '--format', 'json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
    }).trim();
    const arr = JSON.parse(out || '[]');
    const ids: string[] = [];
    const agesMs: Record<string, number> = {};
    const now = Date.now();
    const isWorkloadContainer = (id: string): boolean => {
      // Exclude infra/shared services (postgres, etc.) from runtime health.
      // Health should reflect active swarm workloads only.
      if (id === 'nanoclaw-postgres') return false;
      return id.startsWith('nanoclaw-main-');
    };
    for (const c of arr) {
      const id = c?.configuration?.id;
      const status = c?.status;
      if (typeof id === 'string' && isWorkloadContainer(id) && status === 'running') {
        ids.push(id);
        const startedMs = appleStartedDateToEpochMs(c?.startedDate);
        if (startedMs) agesMs[id] = Math.max(0, now - startedMs);
      }
    }
    return { ids, running: ids.length, agesMs };
  } catch {
    return { ids: [], running: 0, agesMs: {} };
  }
}

function deriveHealth(status: Status, events: any[]): DerivedHealth {
  const now = Date.now();
  const statusMs = parseIsoMs(status.updatedAt);
  const statusAgeMs = statusMs ? Math.max(0, now - statusMs) : null;

  // Agent state from stage/item.
  const stage = String(status.stage || '').toLowerCase();
  const item = String(status.item || '').toLowerCase();
  let agentState: AgentState = 'idle';
  if (stage.includes('error') || item.includes('error')) agentState = 'error';
  else if (
    stage.includes('teamlead') ||
    stage.includes('team-lead') ||
    stage.includes('lead') ||
    stage.includes('pm') ||
    stage.includes('spec') ||
    stage.includes('dev') ||
    stage.includes('qa') ||
    stage.includes('running') ||
    item.includes('processing') ||
    item.includes('spawning') ||
    item.includes('piped')
  ) {
    agentState = 'working';
  }

  let transportState: TransportState = 'unknown';
  let lastAgentOutputAt: string | null = null;
  let lastEventAt: string | null = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const ts = typeof ev?.ts === 'string' ? ev.ts : null;
    if (!lastEventAt && ts) lastEventAt = ts;
    if (!lastAgentOutputAt && ev?.kind === 'agent_output' && ts) lastAgentOutputAt = ts;

    const msg = String(ev?.msg || '').toLowerCase();
    if (transportState === 'unknown') {
      if (msg.includes('connected to whatsapp')) transportState = 'connected';
      else if (msg.includes('reconnecting')) transportState = 'reconnecting';
      else if (msg.includes('logged out')) transportState = 'logged_out';
    }

    if (transportState !== 'unknown' && lastAgentOutputAt) break;
  }

  const c = getNanoContainers();
  const oldestContainerAgeMs = c.ids.length
    ? Math.max(...c.ids.map((id) => c.agesMs[id] || 0))
    : null;
  const staleContainerIds = c.ids.filter((id) => (c.agesMs[id] || 0) >= ORPHAN_AGE_MS);
  const likelyIdle = agentState !== 'working';
  const orphanContainerIds = staleContainerIds.filter(() => likelyIdle);
  const waConnected = transportState === 'connected';
  const ok = transportState !== 'logged_out' && agentState !== 'error' && orphanContainerIds.length === 0;

  return {
    agentState,
    transportState,
    waConnected,
    activeContainers: c.running,
    activeContainerIds: c.ids,
    staleContainers: staleContainerIds.length,
    staleContainerIds,
    orphanContainers: orphanContainerIds.length,
    orphanContainerIds,
    oldestContainerAgeMs,
    lastAgentOutputAt,
    lastEventAt,
    statusAgeMs,
    ok,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // Public health endpoint so external monitors can check process status.
  if (pathname !== '/healthz' && !isAuthorized(req)) {
    return unauthorized(res);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(dashDir, 'index.html'), 'text/html; charset=utf-8');
  }
  if (pathname === '/style.css') {
    return serveFile(res, path.join(dashDir, 'style.css'), 'text/css; charset=utf-8');
  }
  if (pathname === '/app.js') {
    return serveFile(res, path.join(dashDir, 'app.js'), 'text/javascript; charset=utf-8');
  }
  if (pathname === '/api/state') {
    let status: Status = {
      stage: 'idle',
      item: 'n/a',
      files: [],
      next: 'n/a',
      updatedAt: 'n/a',
    };
    let todo: TodoItem[] = [];
    let events: any[] = [];
    let actions: any[] = [];
    let runtimeMetrics: RuntimeMetrics | null = null;
    let blockedQueue: BlockedQueueItem[] = [];
    let activeTaskLanes: ActiveLaneTask[] = [];
    let runtimeAlertHistory: RuntimeAlertHistoryItem[] = [];

    try {
      // Prefer JSON metrics if present; fallback to parsing status.md.
      const m = readMetrics();
      if (m) status = m;
      else if (fs.existsSync(statusPath)) status = parseStatus(readText(statusPath));
    } catch {
      // ignore
    }
    try {
      todo = readCanonicalTodo();
    } catch {
      // ignore
    }
    try {
      events = readJsonlTail(eventsPath, 60);
    } catch {
      // ignore
    }
    try {
      actions = readJsonlTail(actionsPath, 60);
    } catch {
      // ignore
    }
    try {
      runtimeMetrics = readRuntimeMetrics();
    } catch {
      // ignore
    }
    try {
      blockedQueue = getBlockedQueue();
    } catch {
      // ignore
    }
    try {
      activeTaskLanes = getActiveTaskLanes();
    } catch {
      // ignore
    }

    const health = deriveHealth(status, events);
    const runtimeAlertsBase = deriveRuntimeAlerts(runtimeMetrics);
    const retryAlerts = deriveRetryAlerts(actions, getActiveTaskIds(todo));
    const runtimeAlerts = mergeRuntimeAndRetryAlerts(runtimeAlertsBase, retryAlerts);
    const roleStatus = deriveRoleStatus(
      status,
      runtimeMetrics,
      events,
      actions,
      activeTaskLanes,
      health.activeContainers,
    );
    const now = new Date().toISOString();
    const runbook = buildRunbook({
      now,
      status,
      health,
      runtimeAlerts,
      runtimeMetrics,
      roleStatus,
      blockedQueue,
      events,
      actions,
    });
    syncRuntimeAlertHistory({ runtimeAlerts, status, health });
    try {
      runtimeAlertHistory = readRuntimeAlertHistoryTail(60);
    } catch {
      // ignore
    }
    return json(res, {
      now,
      appMode: APP_MODE,
      status,
      health,
      runtimeMetrics,
      runtimeAlerts,
      retryAlerts,
      runtimeAlertHistory,
      runbook,
      roleStatus,
      blockedQueue,
      activeTaskLanes,
      todo,
      events,
      actions,
    });
  }
  if (pathname === '/api/todo/update-state' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const id = String(body?.id || '').trim().toUpperCase();
      const state = String(body?.state || '').trim().toLowerCase();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'missing id' }));
      }
      const out = updateTodoState(id, state);
      if (!out.ok) {
        const statusCode = out.message.startsWith('No existe ID') ? 404 : 409;
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: out.message }));
      }
      return json(res, { ok: true, message: out.message });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    }
  }
  if (pathname === '/api/todo/send-all' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const id = String(body?.id || '').trim().toUpperCase();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'missing id' }));
      }
      const out = sendTodoToAll(id);
      if (!out.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: out.message }));
      }
      return json(res, { ok: true, message: out.message });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    }
  }
  if (pathname === '/api/task/action' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const taskId = String(body?.id || body?.taskId || '').trim().toUpperCase();
      const actionRaw = String(body?.action || '').trim().toLowerCase();
      const action = (actionRaw === 'retry' || actionRaw === 'requeue' || actionRaw === 'block' || actionRaw === 'clear_stale')
        ? actionRaw
        : '';
      if (!taskId) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'missing taskId' }));
      }
      if (!action) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'invalid action' }));
      }
      const out = taskControlAction({
        actor: getRequestActor(req),
        taskId,
        action: action as 'retry' | 'requeue' | 'block' | 'clear_stale',
      });
      if (!out.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: out.message }));
      }
      return json(res, { ok: true, message: out.message, touched: out.touched || 0 });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    }
  }
  if (pathname === '/api/todo/create' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const out = appendTodoItem({
        id: String(body?.id || ''),
        owner: String(body?.owner || ''),
        scope: String(body?.scope || ''),
        state: String(body?.state || 'todo'),
        entregable: String(body?.entregable || ''),
        tests: String(body?.tests || ''),
      });
      if (!out.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: out.message }));
      }
      return json(res, { ok: true, message: out.message });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    }
  }
  if (pathname === '/api/todo/clear' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const mode = String(body?.mode || 'completed') === 'all' ? 'all' : 'completed';
      const out = clearTodo(mode);
      if (!out.ok) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'clear failed' }));
      }
      return json(res, { ok: true, removed: out.removed, mode });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    }
  }
  if (pathname === '/api/runtime/reset' && method === 'POST') {
    const actor = getRequestActor(req);
    const out = resetRuntimeMetrics(actor);
    if (!out.ok) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: out.message }));
    }
    return json(res, { ok: true, message: out.message });
  }
  if (pathname === '/api/watchdog/run' && method === 'POST') {
    const out = runWatchdogNow(getRequestActor(req));
    if (!out.ok) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: out.message, output: out.output }));
    }
    return json(res, { ok: true, message: out.message, output: out.output });
  }
  if (pathname === '/api/lanes/reconcile' && method === 'POST') {
    const out = reconcileLaneState(getRequestActor(req));
    if (!out.ok) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: out.message }));
    }
    return json(res, { ok: true, message: out.message, touched: out.touched });
  }
  if (pathname === '/api/workflow/resolve-question' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const taskId = String(body?.taskId || '').trim().toUpperCase();
      const decision = String(body?.decision || '').trim();
      const out = resolveBlockedTask({
        actor: getRequestActor(req),
        taskId,
        decision,
      });
      if (!out.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: out.message }));
      }
      return json(res, { ok: true, message: out.message });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    }
  }
  if (pathname === '/healthz') {
    let status: Status = {
      stage: 'idle',
      item: 'n/a',
      files: [],
      next: 'n/a',
      updatedAt: 'n/a',
    };
    let events: any[] = [];
    let actions: any[] = [];
    let runtimeMetrics: RuntimeMetrics | null = null;
    try {
      const m = readMetrics();
      if (m) status = m;
      else if (fs.existsSync(statusPath)) status = parseStatus(readText(statusPath));
    } catch {
      // ignore
    }
    try {
      events = readJsonlTail(eventsPath, 120);
    } catch {
      // ignore
    }
    try {
      actions = readJsonlTail(actionsPath, 120);
    } catch {
      // ignore
    }
    try {
      runtimeMetrics = readRuntimeMetrics();
    } catch {
      // ignore
    }

    let todoForRetry: TodoItem[] = [];
    try {
      todoForRetry = readCanonicalTodo();
    } catch {
      // ignore
    }
    const health = deriveHealth(status, events);
    const runtimeAlertsBase = deriveRuntimeAlerts(runtimeMetrics);
    const retryAlerts = deriveRetryAlerts(actions, getActiveTaskIds(todoForRetry));
    const runtimeAlerts = mergeRuntimeAndRetryAlerts(runtimeAlertsBase, retryAlerts);
    const activeTaskLanes = getActiveTaskLanes();
    const roleStatus = deriveRoleStatus(
      status,
      runtimeMetrics,
      events,
      actions,
      activeTaskLanes,
      health.activeContainers,
    );
    syncRuntimeAlertHistory({ runtimeAlerts, status, health });
    const runtimeOk = runtimeAlerts.level !== 'critical';
    res.writeHead(health.ok && runtimeOk ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return res.end(
      JSON.stringify(
        {
          now: new Date().toISOString(),
          status,
          health,
          runtimeMetrics,
          runtimeAlerts,
          retryAlerts,
          roleStatus,
          ok: health.ok && runtimeOk,
        },
        null,
        2,
      ),
    );
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

const host = process.env.SWARMDASH_HOST || '127.0.0.1';
const port = parseInt(process.env.SWARMDASH_PORT || '4173', 10);

server.listen(port, host, () => {
  // Intentionally minimal: user can open http://127.0.0.1:4173/
  console.log(`swarmdash listening on http://${host}:${port}/`);
});
