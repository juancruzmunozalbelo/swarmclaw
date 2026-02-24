import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const HOME = process.env.HOME || '';
const ROOT = process.env.NANOCLAW_ROOT || path.join(HOME, 'nanoclaw');
const DB = path.join(ROOT, 'store', 'messages.db');
const IPC_MESSAGES_DIR = path.join(ROOT, 'data', 'ipc', 'main', 'messages');
const LOG_DIR = path.join(ROOT, 'logs');
const STATE_PATH = path.join(ROOT, 'store', 'watchdog.json');
const ACTIVE_CONTAINERS_PATH = path.join(ROOT, 'store', 'active-containers.json');
const RUNTIME_METRICS_PATH = path.join(ROOT, 'groups', 'main', 'swarmdev', 'runtime-metrics.json');
const ACTIONS_PATH = path.join(ROOT, 'groups', 'main', 'swarmdev', 'actions.jsonl');
const NANO_LOG = path.join(LOG_DIR, 'nanoclaw.log');
const NANO_PLIST = path.join(HOME, 'Library', 'LaunchAgents', 'com.nanoclaw.plist');

const STUCK_GRACE_MS = Number(process.env.WATCHDOG_STUCK_GRACE_MS || 10 * 60 * 1000); // 10m
const WA_GRACE_MS = Number(process.env.WATCHDOG_WA_GRACE_MS || 3 * 60 * 1000); // 3m
const ORPHAN_AGE_MS = Number(process.env.WATCHDOG_ORPHAN_AGE_MS || 60 * 60 * 1000); // 1h
const ORPHAN_MAX_CLEANUP_PER_RUN = Number(process.env.WATCHDOG_ORPHAN_MAX_CLEANUP_PER_RUN || 3);
const ORPHAN_NOTIFY_COOLDOWN_MS = Number(process.env.WATCHDOG_ORPHAN_NOTIFY_COOLDOWN_MS || 15 * 60 * 1000); // 15m
const INFLIGHT_CONTAINER_AGE_MS = Number(process.env.WATCHDOG_INFLIGHT_CONTAINER_AGE_MS || 20 * 60 * 1000); // 20m
const CONTAINER_HARD_STUCK_ENABLED = (process.env.WATCHDOG_CONTAINER_HARD_STUCK_ENABLED || '1').trim() !== '0';
const CONTAINER_HARD_STUCK_MS = Number(process.env.WATCHDOG_CONTAINER_HARD_STUCK_MS || 35 * 60 * 1000); // 35m
const CRITICAL_POLICY_ENABLED = (process.env.WATCHDOG_CRITICAL_POLICY_ENABLED || '1').trim() !== '0';
const CRITICAL_PERSIST_MS = Number(process.env.WATCHDOG_CRITICAL_PERSIST_MS || 5 * 60 * 1000); // 5m
const CRITICAL_COOLDOWN_MS = Number(process.env.WATCHDOG_CRITICAL_COOLDOWN_MS || 15 * 60 * 1000); // 15m
const CRITICAL_MIN_REQUESTS = Number(process.env.WATCHDOG_CRITICAL_MIN_REQUESTS || 5);
const CRITICAL_AGENT_ERROR_RATE = Number(process.env.WATCHDOG_CRITICAL_AGENT_ERROR_RATE || 0.5);
const CRITICAL_VALIDATION_FAIL_RATE = Number(process.env.WATCHDOG_CRITICAL_VALIDATION_FAIL_RATE || 0.4);
const STUCK_HARD_ENABLED = (process.env.WATCHDOG_STUCK_HARD_ENABLED || '1').trim() !== '0';
const STUCK_HARD_WINDOW_MS = Number(process.env.WATCHDOG_STUCK_HARD_WINDOW_MS || 15 * 60 * 1000); // 15m
const STUCK_HARD_MIN_HEARTBEATS = Number(process.env.WATCHDOG_STUCK_HARD_MIN_HEARTBEATS || 4);
const STUCK_HARD_MAX_AGE_SPREAD_MS = Number(process.env.WATCHDOG_STUCK_HARD_MAX_AGE_SPREAD_MS || 60 * 1000); // 60s
const STUCK_HARD_COOLDOWN_MS = Number(process.env.WATCHDOG_STUCK_HARD_COOLDOWN_MS || 15 * 60 * 1000); // 15m
const RESTART_COOLDOWN_MS = Number(process.env.WATCHDOG_RESTART_COOLDOWN_MS || 4 * 60 * 1000); // 4m global anti-loop
const RESTART_WINDOW_MS = Number(process.env.WATCHDOG_RESTART_WINDOW_MS || 60 * 60 * 1000); // 1h
const RESTART_MAX_PER_WINDOW = Number(process.env.WATCHDOG_RESTART_MAX_PER_WINDOW || 4);
const ENABLED = (process.env.WATCHDOG_ENABLED || '1').trim() !== '0';
const VERBOSE = (process.env.WATCHDOG_VERBOSE || '0').trim() === '1';

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function nowIso() {
  return new Date().toISOString();
}

function safeReadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function safeReadText(p, fallback = '') {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return fallback;
  }
}

function safeReadRuntimeMetrics() {
  try {
    if (!fs.existsSync(RUNTIME_METRICS_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(RUNTIME_METRICS_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    const c = raw.counters || {};
    return {
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      counters: {
        requestsStarted: Number(c.requestsStarted || 0),
        outputsSent: Number(c.outputsSent || 0),
        agentErrors: Number(c.agentErrors || 0),
        validationFailures: Number(c.validationFailures || 0),
        contractFailures: Number(c.contractFailures || 0),
        artifactFailures: Number(c.artifactFailures || 0),
        devGateFailures: Number(c.devGateFailures || 0),
      },
    };
  } catch {
    return null;
  }
}

function safeReadActiveContainerOwners() {
  try {
    if (!fs.existsSync(ACTIVE_CONTAINERS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(ACTIVE_CONTAINERS_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.active)) return [];
    return raw.active
      .map((x) => ({
        groupJid: String(x?.groupJid || ''),
        groupFolder: x?.groupFolder ? String(x.groupFolder) : null,
        containerName: String(x?.containerName || ''),
      }))
      .filter((x) => x.containerName.startsWith('nanoclaw-'));
  } catch {
    return [];
  }
}

function detectRuntimeCritical() {
  const rm = safeReadRuntimeMetrics();
  if (!rm) return { critical: false, reasons: [], signature: 'none' };
  const req = Math.max(0, Number(rm.counters.requestsStarted || 0));
  const err = Math.max(0, Number(rm.counters.agentErrors || 0));
  const val = Math.max(0, Number(rm.counters.validationFailures || 0));
  const reasons = [];

  if (req >= CRITICAL_MIN_REQUESTS) {
    const errRate = err / Math.max(1, req);
    const valRate = val / Math.max(1, req);
    if (errRate >= CRITICAL_AGENT_ERROR_RATE) {
      reasons.push(`error-rate=${Math.round(errRate * 100)}%`);
    }
    if (valRate >= CRITICAL_VALIDATION_FAIL_RATE) {
      reasons.push(`validation-rate=${Math.round(valRate * 100)}%`);
    }
  }

  const signature = [
    rm.updatedAt || 'n/a',
    String(req),
    String(err),
    String(val),
    reasons.join(','),
  ].join('|');

  return {
    critical: reasons.length > 0,
    reasons,
    signature,
  };
}

function parseJsonLinesFromTail(p, maxLines) {
  const lines = tailLines(p, maxLines);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

function detectHardStuckByActions() {
  if (!STUCK_HARD_ENABLED) return { stuck: false, signature: 'disabled', reason: 'disabled' };
  if (!fs.existsSync(ACTIONS_PATH)) return { stuck: false, signature: 'missing-actions', reason: 'missing-actions' };

  const now = Date.now();
  const windowStart = now - STUCK_HARD_WINDOW_MS;
  const rows = parseJsonLinesFromTail(ACTIONS_PATH, 500);
  const recent = rows.filter((r) => {
    const ms = parseIso(r?.ts);
    return !!(ms && ms >= windowStart);
  });
  if (recent.length === 0) return { stuck: false, signature: 'no-recent-actions', reason: 'no-recent-actions' };

  const heartbeats = recent.filter((r) => r?.action === 'still_processing');
  if (heartbeats.length < STUCK_HARD_MIN_HEARTBEATS) {
    return { stuck: false, signature: `hb:${heartbeats.length}`, reason: 'few-heartbeats' };
  }

  const firstHbTs = parseIso(heartbeats[0]?.ts) || windowStart;
  const hasProgressAfterHeartbeat = recent.some((r) => {
    const ts = parseIso(r?.ts);
    if (!ts || ts < firstHbTs) return false;
    if (r?.action === 'still_processing') return false;
    if (String(r?.stage || '').toUpperCase() === 'DASH') return false;
    if (String(r?.action || '').startsWith('watchdog_')) return false;
    return true;
  });
  if (hasProgressAfterHeartbeat) {
    return { stuck: false, signature: 'progress-seen', reason: 'progress-seen' };
  }

  const ages = heartbeats
    .map((r) => Number(r?.meta?.actionAgeMs))
    .filter((n) => Number.isFinite(n));
  if (ages.length < STUCK_HARD_MIN_HEARTBEATS) {
    return { stuck: false, signature: 'no-action-age', reason: 'no-action-age' };
  }

  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);
  const latestAge = ages[ages.length - 1];
  const latestHbTs = parseIso(heartbeats[heartbeats.length - 1]?.ts);
  const activeContainers = Math.max(
    0,
    ...heartbeats.map((r) => Number(r?.meta?.activeContainers || 0)).filter((n) => Number.isFinite(n)),
  );

  if (latestAge < STUCK_GRACE_MS) {
    return { stuck: false, signature: `age-low:${Math.round(latestAge / 1000)}`, reason: 'age-too-low' };
  }
  if ((maxAge - minAge) > STUCK_HARD_MAX_AGE_SPREAD_MS) {
    return { stuck: false, signature: `age-spread:${Math.round((maxAge - minAge) / 1000)}`, reason: 'age-not-stable' };
  }
  if (activeContainers <= 0) {
    return { stuck: false, signature: 'no-active-containers', reason: 'no-active-containers' };
  }

  const signature = [
    'hard-stuck',
    String(Math.round(latestAge / 1000)),
    String(heartbeats.length),
    String(activeContainers),
    latestHbTs ? new Date(latestHbTs).toISOString() : 'n/a',
  ].join('|');
  return {
    stuck: true,
    signature,
    reason: 'heartbeat-without-progress',
    latestAgeMs: latestAge,
    heartbeatCount: heartbeats.length,
    activeContainers,
  };
}

function safeWriteJson(p, obj) {
  // Use a unique tmp to avoid collisions between overlapping watchdog runs.
  const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
    fs.renameSync(tmp, p);
  } catch {
    // Last-resort: best effort non-atomic write.
    try {
      fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function sqliteScalar(sql) {
  try {
    return sh('sqlite3', [DB, sql]);
  } catch {
    return '';
  }
}

function getMainChatJid() {
  const jid = sqliteScalar("select jid from registered_groups where folder='main' limit 1;");
  return jid || (process.env.WATCHDOG_CHAT_JID || '');
}

function getRouterState(key) {
  return sqliteScalar(`select value from router_state where key='${key.replace(/'/g, "''")}';`);
}

function parseIso(ts) {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function ensureDirs() {
  fs.mkdirSync(IPC_MESSAGES_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function tailLines(p, maxLines) {
  const raw = safeReadText(p, '');
  if (!raw) return [];
  const lines = stripAnsi(raw).split('\n').filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines));
}

function enqueueMessage(chatJid, text) {
  if (!chatJid) return;
  ensureDirs();
  const payload = { type: 'message', chatJid, text };
  const fn = `watchdog_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
  const fp = path.join(IPC_MESSAGES_DIR, fn);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, fp);
}

function appendAction(action, detail, meta = {}) {
  try {
    const row = {
      ts: nowIso(),
      groupFolder: 'main',
      stage: 'WATCHDOG',
      action,
      detail,
      files: ['scripts/watchdog.mjs', 'store/watchdog.json'],
      meta,
    };
    fs.mkdirSync(path.dirname(ACTIONS_PATH), { recursive: true });
    fs.appendFileSync(ACTIONS_PATH, `${JSON.stringify(row)}\n`, 'utf-8');
  } catch {
    // ignore action write failures
  }
}

function parseIsoSafe(ts) {
  const n = Date.parse(String(ts || ''));
  return Number.isFinite(n) ? n : null;
}

function shouldAllowRestart(state, kind) {
  const now = Date.now();
  const history = Array.isArray(state.restartHistory) ? state.restartHistory : [];
  const recent = history.filter((x) => {
    const ms = parseIsoSafe(x?.ts);
    return !!(ms && (now - ms) <= RESTART_WINDOW_MS);
  });
  state.restartHistory = recent;

  const lastMs = parseIsoSafe(state.lastRestartAt);
  if (lastMs && (now - lastMs) < RESTART_COOLDOWN_MS) {
    return {
      ok: false,
      reason: 'global_cooldown',
      cooldownLeftMs: RESTART_COOLDOWN_MS - (now - lastMs),
      recentCount: recent.length,
    };
  }

  if (recent.length >= RESTART_MAX_PER_WINDOW) {
    return {
      ok: false,
      reason: 'max_restarts_per_window',
      cooldownLeftMs: 0,
      recentCount: recent.length,
    };
  }
  return { ok: true, reason: '', cooldownLeftMs: 0, recentCount: recent.length };
}

/**
 * F0.5: Send a chat alert when the watchdog silences itself due to max restarts.
 * Uses state.lastMaxRestartAlertAt to avoid spamming (once per RESTART_WINDOW_MS).
 */
function maybeAlertMaxRestarts(state, gate, kind) {
  if (!gate || gate.ok || gate.reason !== 'max_restarts_per_window') return;
  const now = Date.now();
  const lastAlertMs = parseIsoSafe(state.lastMaxRestartAlertAt);
  // Only alert once per restart window to avoid spam
  if (lastAlertMs && (now - lastAlertMs) < RESTART_WINDOW_MS) return;
  if (!chatJid) return;
  const windowMin = Math.round(RESTART_WINDOW_MS / 60000);
  enqueueMessage(
    chatJid,
    `⚠️ WATCHDOG PARADO: alcancé ${RESTART_MAX_PER_WINDOW} reinicios en ${windowMin}min (tipo: ${kind}). ` +
    `El sistema puede estar degradado. Requiere revisión manual. ` +
    `Próximo intento en ~${windowMin}min o reiniciá el servicio manualmente.`,
  );
  appendAction(
    'watchdog_max_restarts_alert',
    `max restarts alerted: ${RESTART_MAX_PER_WINDOW} in ${windowMin}min (kind=${kind})`,
    { kind, recentCount: gate.recentCount, windowMin },
  );
  state.lastMaxRestartAlertAt = nowIso();
}

function markRestart(state, kind, detail) {
  const ts = nowIso();
  const history = Array.isArray(state.restartHistory) ? state.restartHistory : [];
  history.push({ ts, kind, detail: String(detail || '').slice(0, 180) });
  state.restartHistory = history;
  state.lastRestartAt = ts;
  state.lastRestartKind = kind;
}

function appleStartedDateToEpochMs(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  // Apple CFAbsoluteTime seconds since 2001-01-01.
  const APPLE_EPOCH_UNIX_SEC = 978307200;
  return Math.round((v + APPLE_EPOCH_UNIX_SEC) * 1000);
}

function listNanoContainersDetailed() {
  try {
    const json = sh('container', ['ls', '--format', 'json']);
    const arr = JSON.parse(json || '[]');
    const now = Date.now();
    const out = [];
    for (const c of arr) {
      const id = c?.configuration?.id;
      const status = c?.status;
      const imageRef = String(c?.configuration?.image?.reference || '');
      if (
        typeof id === 'string' &&
        id.startsWith('nanoclaw-') &&
        imageRef.includes('nanoclaw-agent')
      ) {
        const startedMs = appleStartedDateToEpochMs(c?.startedDate);
        out.push({
          id,
          status: typeof status === 'string' ? status : 'unknown',
          ageMs: startedMs ? Math.max(0, now - startedMs) : null,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function listRunningNanoContainersDetailed() {
  return listNanoContainersDetailed().filter((x) => x.status === 'running');
}

function listRunningNanoContainers() {
  return listRunningNanoContainersDetailed().map((x) => x.id);
}

function stopContainer(id) {
  try { sh('container', ['stop', id], { timeout: 30_000 }); return 'stopped'; } catch { }
  try { sh('container', ['kill', id], { timeout: 15_000 }); return 'killed'; } catch { }
  return 'failed';
}

function stopContainerHard(id) {
  // For stale/orphan cleanup, prefer kill-first because "container stop" can hang.
  try { sh('container', ['kill', id], { timeout: 10_000 }); return 'killed'; } catch { }
  try { sh('container', ['stop', id], { timeout: 10_000 }); return 'stopped'; } catch { }
  return 'failed';
}

function removeContainer(id) {
  try { sh('container', ['rm', id], { timeout: 10_000 }); return 'removed'; } catch { }
  try { sh('container', ['delete', id], { timeout: 10_000 }); return 'deleted'; } catch { }
  return 'failed';
}

function terminateContainerProcessById(id) {
  // Last-resort fallback for XPC-hung container commands: kill runtime processes matching the ID.
  try { sh('pkill', ['-f', id], { timeout: 5_000 }); return 'pkill'; } catch { }
  return 'no-pkill';
}

function kickstartNanoClaw() {
  const uid = String(process.getuid?.() ?? '');
  if (!uid) return;
  try {
    sh('launchctl', ['kickstart', '-k', `gui/${uid}/com.nanoclaw`], { timeout: 15_000 });
    return;
  } catch {
    // If the service isn't loaded, bootstrap it then kickstart.
    try {
      if (fs.existsSync(NANO_PLIST)) {
        sh('launchctl', ['bootstrap', `gui/${uid}`, NANO_PLIST], { timeout: 15_000 });
      }
    } catch {
      // ignore
    }
    try {
      sh('launchctl', ['kickstart', '-k', `gui/${uid}/com.nanoclaw`], { timeout: 15_000 });
    } catch {
      // ignore
    }
  }
}

function detectWhatsAppReconnectLoop() {
  // Heuristic: if the last "Reconnecting..." appears after the last "Connected to WhatsApp"
  // and persists beyond WA_GRACE_MS, restart. We don't rely solely on log mtime because
  // some reconnect loops still produce log noise.
  try {
    if (!fs.existsSync(NANO_LOG)) return { stuck: false, reason: '' };
    const lines = tailLines(NANO_LOG, 400);
    const lastConnected = lines.map((l, i) => [l, i]).filter(([l]) => String(l).includes('Connected to WhatsApp')).pop()?.[1];
    const lastReconnecting = lines.map((l, i) => [l, i]).filter(([l]) => String(l).includes('Reconnecting...')).pop()?.[1];
    const loggedOut = lines.some((l) => String(l).includes('Logged out.'));

    if (loggedOut) return { stuck: true, reason: 'logged_out' };
    if (typeof lastReconnecting !== 'number') return { stuck: false, reason: '' };
    if (typeof lastConnected !== 'number') {
      // Never connected yet; leave decision to stateful timer.
      return { stuck: true, reason: 'never_connected' };
    }
    if (lastReconnecting <= lastConnected) return { stuck: false, reason: '' };

    return { stuck: true, reason: 'reconnect_loop' };
  } catch {
    return { stuck: false, reason: '' };
  }
}

function main() {
  if (!ENABLED) return;

  ensureDirs();
  const state = safeReadJson(STATE_PATH, {
    lastIncidentAt: null,
    lastIncidentKey: null,
    lastWaIncidentAt: null,
    lastWaIncidentKey: null,
    waReconnectSince: null,
    lastOrphanCleanupAt: null,
    lastCriticalSince: null,
    lastCriticalIncidentAt: null,
    lastCriticalIncidentKey: null,
    lastHardStuckIncidentAt: null,
    lastHardStuckIncidentKey: null,
    lastRestartAt: null,
    lastRestartKind: null,
    restartHistory: [],
  });

  const chatJid = getMainChatJid();

  // Health: if container system is down, try to start it.
  try {
    sh('container', ['system', 'status'], { timeout: 8_000 });
  } catch {
    try { sh('container', ['system', 'start'], { timeout: 30_000 }); } catch { }
  }

  const lastTs = getRouterState('last_timestamp');
  const lastAgentRaw = getRouterState('last_agent_timestamp');
  const lastTsMs = parseIso(lastTs);
  let lastAgentMs = null;
  try {
    const m = JSON.parse(lastAgentRaw || '{}');
    const v = chatJid ? m?.[chatJid] : null;
    if (typeof v === 'string') lastAgentMs = parseIso(v);
  } catch {
    // ignore
  }

  const runningDetailed = listRunningNanoContainersDetailed();
  const running = runningDetailed.map((x) => x.id);
  const inFlight = runningDetailed.some((x) => typeof x.ageMs === 'number' && x.ageMs < INFLIGHT_CONTAINER_AGE_MS);
  const oldestRunningAgeMs = runningDetailed.reduce((max, x) => {
    const age = typeof x.ageMs === 'number' ? x.ageMs : 0;
    return Math.max(max, age);
  }, 0);

  // Container hard-timeout policy:
  // if containers keep running for too long with no fresh agent progress, force recycle.
  if (CONTAINER_HARD_STUCK_ENABLED && running.length > 0 && oldestRunningAgeMs >= CONTAINER_HARD_STUCK_MS) {
    const nowMs = Date.now();
    const lastProgressMs = lastAgentMs || lastTsMs || null;
    const noProgressMs = lastProgressMs ? Math.max(0, nowMs - lastProgressMs) : null;
    const progressLooksStale = !lastProgressMs || (noProgressMs !== null && noProgressMs >= STUCK_GRACE_MS);
    if (progressLooksStale) {
      const gate = shouldAllowRestart(state, 'container_hard_stuck');
      if (!gate.ok) {
        maybeAlertMaxRestarts(state, gate, 'container_hard_stuck');
        appendAction(
          'watchdog_restart_throttled',
          `restart throttled (${gate.reason}) for container hard stuck`,
          {
            kind: 'container_hard_stuck',
            reason: gate.reason,
            cooldownLeftMs: gate.cooldownLeftMs,
            recentCount: gate.recentCount,
            runningCount: running.length,
            oldestRunningAgeMs,
            noProgressMs,
          },
        );
        safeWriteJson(STATE_PATH, state);
        return;
      }

      const actions = [];
      for (const id of running) {
        const stopped = stopContainerHard(id);
        if (stopped === 'failed') {
          const term = terminateContainerProcessById(id);
          actions.push(`${id}:${stopped}/${term}`);
        } else {
          actions.push(`${id}:${stopped}`);
        }
      }
      kickstartNanoClaw();
      enqueueMessage(
        chatJid,
        `WATCHDOG: container hard-timeout (${Math.round(oldestRunningAgeMs / 60000)}m sin progreso util). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`,
      );
      appendAction(
        'watchdog_restart',
        'restart by container hard-timeout policy',
        {
          kind: 'container_hard_stuck',
          runningCount: running.length,
          oldestRunningAgeMs,
          noProgressMs,
          actions,
        },
      );
      markRestart(state, 'container_hard_stuck', `oldest=${Math.round(oldestRunningAgeMs / 60000)}m`);
      safeWriteJson(STATE_PATH, state);
      return;
    }
  }

  // Hard-stuck detection must run even when containers are "young".
  // A heartbeat loop with no progress is a valid stuck signal regardless of container age.
  if (STUCK_HARD_ENABLED) {
    const hardStuck = detectHardStuckByActions();
    if (hardStuck.stuck) {
      const lastMs = state.lastHardStuckIncidentAt ? parseIso(state.lastHardStuckIncidentAt) : null;
      const sameKey = state.lastHardStuckIncidentKey === hardStuck.signature;
      const inCooldown = !!(lastMs && (Date.now() - lastMs) < STUCK_HARD_COOLDOWN_MS);
      if (!(sameKey && inCooldown)) {
        const gate = shouldAllowRestart(state, 'hard_stuck');
        if (!gate.ok) {
          maybeAlertMaxRestarts(state, gate, 'hard_stuck');
          appendAction(
            'watchdog_restart_throttled',
            `restart throttled (${gate.reason}) for hard_stuck`,
            { kind: 'hard_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount },
          );
          safeWriteJson(STATE_PATH, state);
          return;
        }
        const runningNow = listRunningNanoContainers();
        const actions = [];
        for (const id of runningNow) {
          const stopped = stopContainerHard(id);
          if (stopped === 'failed') {
            const term = terminateContainerProcessById(id);
            actions.push(`${id}:${stopped}/${term}`);
          } else {
            actions.push(`${id}:${stopped}`);
          }
        }
        kickstartNanoClaw();
        enqueueMessage(
          chatJid,
          `WATCHDOG: detecte loop de heartbeat sin progreso real (${hardStuck.heartbeatCount} heartbeats, age=${Math.round((hardStuck.latestAgeMs || 0) / 1000)}s). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`,
        );
        appendAction(
          'watchdog_restart',
          'restart by hard_stuck policy',
          {
            kind: 'hard_stuck',
            heartbeatCount: hardStuck.heartbeatCount,
            latestAgeMs: hardStuck.latestAgeMs,
            actions,
          },
        );
        markRestart(state, 'hard_stuck', `hb=${hardStuck.heartbeatCount}`);
        state.lastHardStuckIncidentAt = nowIso();
        state.lastHardStuckIncidentKey = hardStuck.signature;
        safeWriteJson(STATE_PATH, state);
        return;
      }
    }
  }

  // Always perform lightweight orphan cleanup first (independent from "stuck" detection).
  try {
    const ownerRows = safeReadActiveContainerOwners();
    const ownedIds = new Set(ownerRows.map((x) => x.containerName));
    const runningNow = listRunningNanoContainersDetailed().slice().sort((a, b) => (a.ageMs || 0) - (b.ageMs || 0));
    // Ownership guardrail:
    // 1) never cleanup containers currently marked active by the runtime
    // 2) if ownership file is stale/missing, only keep very recent containers (likely in-flight)
    if (ownedIds.size === 0) {
      for (const c of runningNow) {
        if (typeof c.ageMs === 'number' && c.ageMs < INFLIGHT_CONTAINER_AGE_MS) {
          ownedIds.add(c.id);
        }
      }
    }

    const runningCandidates = runningNow
      .filter((x) => typeof x.ageMs === 'number' && x.ageMs >= ORPHAN_AGE_MS)
      .filter((x) => !ownedIds.has(x.id))
      .sort((a, b) => (b.ageMs || 0) - (a.ageMs || 0))
      .slice(0, Math.max(0, ORPHAN_MAX_CLEANUP_PER_RUN));
    const staleNonRunning = listNanoContainersDetailed()
      .filter((x) => x.status !== 'running')
      .sort((a, b) => (b.ageMs || 0) - (a.ageMs || 0))
      .slice(0, Math.max(0, ORPHAN_MAX_CLEANUP_PER_RUN));
    const candidates = [...staleNonRunning, ...runningCandidates]
      .slice(0, Math.max(0, ORPHAN_MAX_CLEANUP_PER_RUN));
    if (candidates.length > 0) {
      const cleaned = [];
      for (const c of candidates) {
        let res = 'failed';
        if (c.status === 'running') {
          const stopped = stopContainerHard(c.id);
          const fallback = stopped === 'failed' ? terminateContainerProcessById(c.id) : null;
          const rm = removeContainer(c.id);
          res = fallback ? `${stopped}/${fallback}/${rm}` : `${stopped}/${rm}`;
        } else {
          res = removeContainer(c.id);
        }
        const age = typeof c.ageMs === 'number' ? `${Math.round(c.ageMs / 60000)}m` : 'n/a';
        cleaned.push(`${c.id}:${c.status}:${res}:${age}`);
      }
      const lastNotifyMs = state.lastOrphanCleanupAt ? parseIso(state.lastOrphanCleanupAt) : null;
      const canNotify = !lastNotifyMs || (Date.now() - lastNotifyMs) >= ORPHAN_NOTIFY_COOLDOWN_MS;
      if (canNotify) {
        enqueueMessage(chatJid, `WATCHDOG: limpie containers huérfanos viejos. Acciones: ${cleaned.join(', ')}`);
        state.lastOrphanCleanupAt = nowIso();
      }
      safeWriteJson(STATE_PATH, state);
    }
  } catch {
    // ignore orphan cleanup failures
  }

  // Detect: message cursor advanced but agent cursor didn't move for too long.
  let stuck = false;
  if (lastTsMs && lastAgentMs) {
    const delta = lastTsMs - lastAgentMs;
    if (delta >= STUCK_GRACE_MS) stuck = true;
  }

  // Critical runtime policy (autonomous): restart if critical persists for long enough.
  // Never restart while recent active containers are still running.
  if (CRITICAL_POLICY_ENABLED) {
    const crit = detectRuntimeCritical();
    if (!crit.critical) {
      if (state.lastCriticalSince) {
        state.lastCriticalSince = null;
        safeWriteJson(STATE_PATH, state);
      }
    } else {
      if (!state.lastCriticalSince) state.lastCriticalSince = nowIso();
      const sinceMs = parseIso(state.lastCriticalSince);
      const ageMs = sinceMs ? (Date.now() - sinceMs) : CRITICAL_PERSIST_MS + 1;

      if (ageMs >= CRITICAL_PERSIST_MS && !inFlight) {
        const lastMs = state.lastCriticalIncidentAt ? parseIso(state.lastCriticalIncidentAt) : null;
        const sameKey = state.lastCriticalIncidentKey === crit.signature;
        const inCooldown = !!(lastMs && (Date.now() - lastMs) < CRITICAL_COOLDOWN_MS);
        if (!(sameKey && inCooldown)) {
          const gate = shouldAllowRestart(state, 'critical_runtime');
          if (!gate.ok) {
            maybeAlertMaxRestarts(state, gate, 'critical_runtime');
            appendAction(
              'watchdog_restart_throttled',
              `restart throttled (${gate.reason}) for critical runtime`,
              { kind: 'critical_runtime', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount },
            );
            safeWriteJson(STATE_PATH, state);
            return;
          }
          const runningNow = listRunningNanoContainers();
          const actions = [];
          for (const id of runningNow) {
            const res = stopContainer(id);
            actions.push(`${id}:${res}`);
          }
          kickstartNanoClaw();
          enqueueMessage(
            chatJid,
            `WATCHDOG: runtime critical persistente (${Math.round(ageMs / 1000)}s). Razones: ${crit.reasons.join(', ') || 'n/a'}. Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`,
          );
          appendAction(
            'watchdog_restart',
            'restart by critical runtime policy',
            { kind: 'critical_runtime', reasons: crit.reasons, ageMs, actions },
          );
          markRestart(state, 'critical_runtime', crit.reasons.join(', '));
          state.lastCriticalIncidentAt = nowIso();
          state.lastCriticalIncidentKey = crit.signature;
          state.lastCriticalSince = nowIso();
          safeWriteJson(STATE_PATH, state);
          return;
        }
      }
      safeWriteJson(STATE_PATH, state);
    }
  }

  if (VERBOSE) {
    fs.appendFileSync(
      path.join(LOG_DIR, 'watchdog.log'),
      `[${nowIso()}] chat=${chatJid || '(none)'} running=${running.length} last=${lastTs || 'n/a'} agent=${lastAgentMs ? new Date(lastAgentMs).toISOString() : 'n/a'} stuck=${stuck}\n`,
    );
  }

  if (!stuck || inFlight) {
    // Separate WA liveness check (reconnect loops, logged-out).
    if (inFlight) {
      // Avoid restarting NanoClaw while agents are actively working.
      safeWriteJson(STATE_PATH, state);
      return;
    }
    const wa = detectWhatsAppReconnectLoop();
    if (!wa.stuck) {
      // Clear any in-progress reconnect timer.
      state.waReconnectSince = null;
      safeWriteJson(STATE_PATH, state);
      return;
    }

    // Stateful timer: only restart if the condition persists beyond WA_GRACE_MS.
    if (!state.waReconnectSince) state.waReconnectSince = nowIso();
    const sinceMs = parseIso(state.waReconnectSince);
    const ageMs = sinceMs ? (Date.now() - sinceMs) : WA_GRACE_MS + 1;
    if (ageMs < WA_GRACE_MS) {
      safeWriteJson(STATE_PATH, state);
      return;
    }

    // Allow repeated attempts, but not more frequently than WA_GRACE_MS.
    const lastMs = state.lastWaIncidentAt ? parseIso(state.lastWaIncidentAt) : null;
    if (lastMs && (Date.now() - lastMs) < WA_GRACE_MS) {
      safeWriteJson(STATE_PATH, state);
      return;
    }

    // If WA is stuck, also stop any running nanoclaw containers to avoid leaking detached agents.
    const gate = shouldAllowRestart(state, 'wa_stuck');
    if (!gate.ok) {
      maybeAlertMaxRestarts(state, gate, 'wa_stuck');
      appendAction(
        'watchdog_restart_throttled',
        `restart throttled (${gate.reason}) for wa`,
        { kind: 'wa_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount, waReason: wa.reason },
      );
      safeWriteJson(STATE_PATH, state);
      return;
    }
    const runningNow = listRunningNanoContainers();
    const actions = [];
    for (const id of runningNow) {
      const res = stopContainer(id);
      actions.push(`${id}:${res}`);
    }

    kickstartNanoClaw();
    if (wa.reason === 'logged_out') {
      enqueueMessage(chatJid, 'WATCHDOG: WhatsApp esta deslogueado. Corre /setup para reautenticar y luego reintenta.');
    } else {
      enqueueMessage(chatJid, `WATCHDOG: WhatsApp parece trabado (${wa.reason}). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`);
    }
    appendAction(
      'watchdog_restart',
      'restart by whatsapp reconnect policy',
      { kind: 'wa_stuck', reason: wa.reason, actions },
    );
    markRestart(state, 'wa_stuck', wa.reason);
    state.lastWaIncidentAt = nowIso();
    state.lastWaIncidentKey = `${chatJid}|wa|${wa.reason}`;
    state.waReconnectSince = nowIso(); // reset timer so we don't rapid-fire
    safeWriteJson(STATE_PATH, state);
    return;
  }

  // Dedup incidents per last_timestamp so we don't spam.
  const incidentKey = `${chatJid}|${lastTs}`;
  if (state.lastIncidentKey === incidentKey) return;

  const gate = shouldAllowRestart(state, 'cursor_stuck');
  if (!gate.ok) {
    maybeAlertMaxRestarts(state, gate, 'cursor_stuck');
    appendAction(
      'watchdog_restart_throttled',
      `restart throttled (${gate.reason}) for cursor stuck`,
      { kind: 'cursor_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount },
    );
    safeWriteJson(STATE_PATH, state);
    return;
  }

  const actions = [];
  for (const id of running) {
    const res = stopContainer(id);
    actions.push(`${id}:${res}`);
  }

  // Restart NanoClaw host process too (to clear any stuck waits).
  kickstartNanoClaw();

  enqueueMessage(
    chatJid,
    `WATCHDOG: detecte bloqueo (mensajes vistos ${lastTs} pero agent cursor viejo). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`,
  );
  appendAction(
    'watchdog_restart',
    'restart by cursor stuck policy',
    { kind: 'cursor_stuck', lastTs, actions },
  );
  markRestart(state, 'cursor_stuck', String(lastTs || 'n/a'));

  state.lastIncidentAt = nowIso();
  state.lastIncidentKey = incidentKey;
  safeWriteJson(STATE_PATH, state);
}

main();
