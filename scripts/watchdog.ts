import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// ── Paths ──────────────────────────────────────────────────────────────────
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

// ── Config ─────────────────────────────────────────────────────────────────
const STUCK_GRACE_MS = Number(process.env.WATCHDOG_STUCK_GRACE_MS || 10 * 60 * 1000);
const WA_GRACE_MS = Number(process.env.WATCHDOG_WA_GRACE_MS || 3 * 60 * 1000);
const ORPHAN_AGE_MS = Number(process.env.WATCHDOG_ORPHAN_AGE_MS || 60 * 60 * 1000);
const ORPHAN_MAX_CLEANUP_PER_RUN = Number(process.env.WATCHDOG_ORPHAN_MAX_CLEANUP_PER_RUN || 3);
const ORPHAN_NOTIFY_COOLDOWN_MS = Number(process.env.WATCHDOG_ORPHAN_NOTIFY_COOLDOWN_MS || 15 * 60 * 1000);
const INFLIGHT_CONTAINER_AGE_MS = Number(process.env.WATCHDOG_INFLIGHT_CONTAINER_AGE_MS || 20 * 60 * 1000);
const CONTAINER_HARD_STUCK_ENABLED = (process.env.WATCHDOG_CONTAINER_HARD_STUCK_ENABLED || '1').trim() !== '0';
const CONTAINER_HARD_STUCK_MS = Number(process.env.WATCHDOG_CONTAINER_HARD_STUCK_MS || 35 * 60 * 1000);
const CRITICAL_POLICY_ENABLED = (process.env.WATCHDOG_CRITICAL_POLICY_ENABLED || '1').trim() !== '0';
const CRITICAL_PERSIST_MS = Number(process.env.WATCHDOG_CRITICAL_PERSIST_MS || 5 * 60 * 1000);
const CRITICAL_COOLDOWN_MS = Number(process.env.WATCHDOG_CRITICAL_COOLDOWN_MS || 15 * 60 * 1000);
const CRITICAL_MIN_REQUESTS = Number(process.env.WATCHDOG_CRITICAL_MIN_REQUESTS || 5);
const CRITICAL_AGENT_ERROR_RATE = Number(process.env.WATCHDOG_CRITICAL_AGENT_ERROR_RATE || 0.5);
const CRITICAL_VALIDATION_FAIL_RATE = Number(process.env.WATCHDOG_CRITICAL_VALIDATION_FAIL_RATE || 0.4);
const STUCK_HARD_ENABLED = (process.env.WATCHDOG_STUCK_HARD_ENABLED || '1').trim() !== '0';
const STUCK_HARD_WINDOW_MS = Number(process.env.WATCHDOG_STUCK_HARD_WINDOW_MS || 15 * 60 * 1000);
const STUCK_HARD_MIN_HEARTBEATS = Number(process.env.WATCHDOG_STUCK_HARD_MIN_HEARTBEATS || 4);
const STUCK_HARD_MAX_AGE_SPREAD_MS = Number(process.env.WATCHDOG_STUCK_HARD_MAX_AGE_SPREAD_MS || 60 * 1000);
const STUCK_HARD_COOLDOWN_MS = Number(process.env.WATCHDOG_STUCK_HARD_COOLDOWN_MS || 15 * 60 * 1000);
const RESTART_COOLDOWN_MS = Number(process.env.WATCHDOG_RESTART_COOLDOWN_MS || 4 * 60 * 1000);
const RESTART_WINDOW_MS = Number(process.env.WATCHDOG_RESTART_WINDOW_MS || 60 * 60 * 1000);
const RESTART_MAX_PER_WINDOW = Number(process.env.WATCHDOG_RESTART_MAX_PER_WINDOW || 4);
const ENABLED = (process.env.WATCHDOG_ENABLED || '1').trim() !== '0';
const VERBOSE = (process.env.WATCHDOG_VERBOSE || '0').trim() === '1';

// ── Types ──────────────────────────────────────────────────────────────────

interface RestartHistoryEntry {
    ts: string;
    kind: string;
    detail: string;
}

interface WatchdogState {
    lastIncidentAt: string | null;
    lastIncidentKey: string | null;
    lastWaIncidentAt: string | null;
    lastWaIncidentKey: string | null;
    waReconnectSince: string | null;
    lastOrphanCleanupAt: string | null;
    lastCriticalSince: string | null;
    lastCriticalIncidentAt: string | null;
    lastCriticalIncidentKey: string | null;
    lastHardStuckIncidentAt: string | null;
    lastHardStuckIncidentKey: string | null;
    lastRestartAt: string | null;
    lastRestartKind: string | null;
    lastMaxRestartAlertAt?: string | null;
    restartHistory: RestartHistoryEntry[];
}

interface RuntimeMetrics {
    updatedAt: string | null;
    counters: {
        requestsStarted: number;
        outputsSent: number;
        agentErrors: number;
        validationFailures: number;
        contractFailures: number;
        artifactFailures: number;
        devGateFailures: number;
    };
}

interface ContainerInfo {
    id: string;
    status: string;
    ageMs: number | null;
}

interface ActiveContainerOwner {
    groupJid: string;
    groupFolder: string | null;
    containerName: string;
}

interface RestartGate {
    ok: boolean;
    reason: string;
    cooldownLeftMs: number;
    recentCount: number;
}

interface CriticalResult {
    critical: boolean;
    reasons: string[];
    signature: string;
}

interface HardStuckResult {
    stuck: boolean;
    signature: string;
    reason: string;
    latestAgeMs?: number;
    heartbeatCount?: number;
    activeContainers?: number;
}

interface WaStuckResult {
    stuck: boolean;
    reason: string;
}

// ── Utility functions ──────────────────────────────────────────────────────

function sh(cmd: string, args: string[], opts: Record<string, unknown> = {}): string {
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function nowIso(): string {
    return new Date().toISOString();
}

function safeReadJson<T>(p: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
    } catch {
        return fallback;
    }
}

function safeReadText(p: string, fallback = ''): string {
    try {
        return fs.readFileSync(p, 'utf-8');
    } catch {
        return fallback;
    }
}

export function safeReadRuntimeMetrics(): RuntimeMetrics | null {
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

export function safeReadActiveContainerOwners(): ActiveContainerOwner[] {
    try {
        if (!fs.existsSync(ACTIVE_CONTAINERS_PATH)) return [];
        const raw = JSON.parse(fs.readFileSync(ACTIVE_CONTAINERS_PATH, 'utf-8'));
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.active)) return [];
        return raw.active
            .map((x: Record<string, unknown>) => ({
                groupJid: String(x?.groupJid || ''),
                groupFolder: x?.groupFolder ? String(x.groupFolder) : null,
                containerName: String(x?.containerName || ''),
            }))
            .filter((x: ActiveContainerOwner) => x.containerName.startsWith('nanoclaw-'));
    } catch {
        return [];
    }
}

export function detectRuntimeCritical(): CriticalResult {
    const rm = safeReadRuntimeMetrics();
    if (!rm) return { critical: false, reasons: [], signature: 'none' };
    const req = Math.max(0, Number(rm.counters.requestsStarted || 0));
    const err = Math.max(0, Number(rm.counters.agentErrors || 0));
    const val = Math.max(0, Number(rm.counters.validationFailures || 0));
    const reasons: string[] = [];

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

    return { critical: reasons.length > 0, reasons, signature };
}

function parseIso(ts: string | undefined | null): number | null {
    const ms = Date.parse(String(ts || ''));
    return Number.isFinite(ms) ? ms : null;
}

function stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return String(s || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function tailLines(p: string, maxLines: number): string[] {
    const raw = safeReadText(p, '');
    if (!raw) return [];
    const lines = stripAnsi(raw).split('\n').filter(Boolean);
    return lines.slice(Math.max(0, lines.length - maxLines));
}

function parseJsonLinesFromTail(p: string, maxLines: number): Record<string, unknown>[] {
    const lines = tailLines(p, maxLines);
    const out: Record<string, unknown>[] = [];
    for (const line of lines) {
        try {
            out.push(JSON.parse(line));
        } catch {
            // ignore malformed lines
        }
    }
    return out;
}

export function detectHardStuckByActions(): HardStuckResult {
    if (!STUCK_HARD_ENABLED) return { stuck: false, signature: 'disabled', reason: 'disabled' };
    if (!fs.existsSync(ACTIONS_PATH)) return { stuck: false, signature: 'missing-actions', reason: 'missing-actions' };

    const now = Date.now();
    const windowStart = now - STUCK_HARD_WINDOW_MS;
    const rows = parseJsonLinesFromTail(ACTIONS_PATH, 500);
    const recent = rows.filter((r) => {
        const ms = parseIso(r?.ts as string);
        return !!(ms && ms >= windowStart);
    });
    if (recent.length === 0) return { stuck: false, signature: 'no-recent-actions', reason: 'no-recent-actions' };

    const heartbeats = recent.filter((r) => r?.action === 'still_processing');
    if (heartbeats.length < STUCK_HARD_MIN_HEARTBEATS) {
        return { stuck: false, signature: `hb:${heartbeats.length}`, reason: 'few-heartbeats' };
    }

    const firstHbTs = parseIso(heartbeats[0]?.ts as string) || windowStart;
    const hasProgressAfterHeartbeat = recent.some((r) => {
        const ts = parseIso(r?.ts as string);
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
        .map((r) => Number((r?.meta as Record<string, unknown>)?.actionAgeMs))
        .filter((n) => Number.isFinite(n));
    if (ages.length < STUCK_HARD_MIN_HEARTBEATS) {
        return { stuck: false, signature: 'no-action-age', reason: 'no-action-age' };
    }

    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);
    const latestAge = ages[ages.length - 1];
    const latestHbTs = parseIso(heartbeats[heartbeats.length - 1]?.ts as string);
    const activeContainers = Math.max(
        0,
        ...heartbeats.map((r) => Number((r?.meta as Record<string, unknown>)?.activeContainers || 0)).filter((n) => Number.isFinite(n)),
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

function safeWriteJson(p: string, obj: unknown): void {
    const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    try {
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
        fs.renameSync(tmp, p);
    } catch {
        try {
            fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
        } catch { /* ignore */ }
        try {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        } catch { /* ignore */ }
    }
}

function sqliteScalar(sql: string): string {
    try {
        return sh('sqlite3', [DB, sql]);
    } catch {
        return '';
    }
}

function getMainChatJid(): string {
    const jid = sqliteScalar("select jid from registered_groups where folder='main' limit 1;");
    return jid || (process.env.WATCHDOG_CHAT_JID || '');
}

function getRouterState(key: string): string {
    return sqliteScalar(`select value from router_state where key='${key.replace(/'/g, "''")}';`);
}

function ensureDirs(): void {
    fs.mkdirSync(IPC_MESSAGES_DIR, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
}

function enqueueMessage(chatJid: string, text: string): void {
    if (!chatJid) return;
    ensureDirs();
    const payload = { type: 'message', chatJid, text };
    const fn = `watchdog_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    const fp = path.join(IPC_MESSAGES_DIR, fn);
    const tmp = `${fp}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, fp);
}

function appendAction(action: string, detail: string, meta: Record<string, unknown> = {}): void {
    try {
        const row = {
            ts: nowIso(),
            groupFolder: 'main',
            stage: 'WATCHDOG',
            action,
            detail,
            files: ['scripts/watchdog.ts', 'store/watchdog.json'],
            meta,
        };
        fs.mkdirSync(path.dirname(ACTIONS_PATH), { recursive: true });
        fs.appendFileSync(ACTIONS_PATH, `${JSON.stringify(row)}\n`, 'utf-8');
    } catch {
        // ignore action write failures
    }
}

export function shouldAllowRestart(state: WatchdogState, _kind: string): RestartGate {
    const now = Date.now();
    const history = Array.isArray(state.restartHistory) ? state.restartHistory : [];
    const recent = history.filter((x) => {
        const ms = parseIso(x?.ts);
        return !!(ms && (now - ms) <= RESTART_WINDOW_MS);
    });
    state.restartHistory = recent;

    const lastMs = parseIso(state.lastRestartAt);
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

function maybeAlertMaxRestarts(state: WatchdogState, gate: RestartGate, kind: string, chatJid: string): void {
    if (!gate || gate.ok || gate.reason !== 'max_restarts_per_window') return;
    const now = Date.now();
    const lastAlertMs = parseIso(state.lastMaxRestartAlertAt);
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

function markRestart(state: WatchdogState, kind: string, detail: string): void {
    const ts = nowIso();
    const history = Array.isArray(state.restartHistory) ? state.restartHistory : [];
    history.push({ ts, kind, detail: String(detail || '').slice(0, 180) });
    state.restartHistory = history;
    state.lastRestartAt = ts;
    state.lastRestartKind = kind;
}

function appleStartedDateToEpochMs(v: unknown): number | null {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const APPLE_EPOCH_UNIX_SEC = 978307200;
    return Math.round((v + APPLE_EPOCH_UNIX_SEC) * 1000);
}

export function listNanoContainersDetailed(): ContainerInfo[] {
    try {
        const json = sh('container', ['ls', '--format', 'json']);
        const arr = JSON.parse(json || '[]') as Record<string, unknown>[];
        const now = Date.now();
        const out: ContainerInfo[] = [];
        for (const c of arr) {
            const config = c?.configuration as Record<string, unknown> | undefined;
            const id = config?.id;
            const status = c?.status;
            const image = config?.image as Record<string, unknown> | undefined;
            const imageRef = String(image?.reference || '');
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

function listRunningNanoContainersDetailed(): ContainerInfo[] {
    return listNanoContainersDetailed().filter((x) => x.status === 'running');
}

function listRunningNanoContainers(): string[] {
    return listRunningNanoContainersDetailed().map((x) => x.id);
}

function stopContainer(id: string): string {
    try { sh('container', ['stop', id], { timeout: 30_000 }); return 'stopped'; } catch { /* */ }
    try { sh('container', ['kill', id], { timeout: 15_000 }); return 'killed'; } catch { /* */ }
    return 'failed';
}

function stopContainerHard(id: string): string {
    try { sh('container', ['kill', id], { timeout: 10_000 }); return 'killed'; } catch { /* */ }
    try { sh('container', ['stop', id], { timeout: 10_000 }); return 'stopped'; } catch { /* */ }
    return 'failed';
}

function removeContainer(id: string): string {
    try { sh('container', ['rm', id], { timeout: 10_000 }); return 'removed'; } catch { /* */ }
    try { sh('container', ['delete', id], { timeout: 10_000 }); return 'deleted'; } catch { /* */ }
    return 'failed';
}

function terminateContainerProcessById(id: string): string {
    try { sh('pkill', ['-f', id], { timeout: 5_000 }); return 'pkill'; } catch { /* */ }
    return 'no-pkill';
}

function kickstartNanoClaw(): void {
    const uid = String(process.getuid?.() ?? '');
    if (!uid) return;
    try {
        sh('launchctl', ['kickstart', '-k', `gui/${uid}/com.nanoclaw`], { timeout: 15_000 });
        return;
    } catch {
        try {
            if (fs.existsSync(NANO_PLIST)) {
                sh('launchctl', ['bootstrap', `gui/${uid}`, NANO_PLIST], { timeout: 15_000 });
            }
        } catch { /* ignore */ }
        try {
            sh('launchctl', ['kickstart', '-k', `gui/${uid}/com.nanoclaw`], { timeout: 15_000 });
        } catch { /* ignore */ }
    }
}

export function detectWhatsAppReconnectLoop(): WaStuckResult {
    try {
        if (!fs.existsSync(NANO_LOG)) return { stuck: false, reason: '' };
        const lines = tailLines(NANO_LOG, 400);
        const lastConnected = lines.map((l, i) => [l, i] as const).filter(([l]) => String(l).includes('Connected to WhatsApp')).pop()?.[1];
        const lastReconnecting = lines.map((l, i) => [l, i] as const).filter(([l]) => String(l).includes('Reconnecting...')).pop()?.[1];
        const loggedOut = lines.some((l) => String(l).includes('Logged out.'));

        if (loggedOut) return { stuck: true, reason: 'logged_out' };
        if (typeof lastReconnecting !== 'number') return { stuck: false, reason: '' };
        if (typeof lastConnected !== 'number') {
            return { stuck: true, reason: 'never_connected' };
        }
        if (lastReconnecting <= lastConnected) return { stuck: false, reason: '' };

        return { stuck: true, reason: 'reconnect_loop' };
    } catch {
        return { stuck: false, reason: '' };
    }
}

// ── Layer 1: WhatsApp Health ────────────────────────────────────────────────

export function checkWhatsAppLayer(state: WatchdogState, chatJid: string): void {
    const wa = detectWhatsAppReconnectLoop();
    if (!wa.stuck) {
        state.waReconnectSince = null;
        return;
    }

    if (!state.waReconnectSince) state.waReconnectSince = nowIso();
    const sinceMs = parseIso(state.waReconnectSince);
    const ageMs = sinceMs ? (Date.now() - sinceMs) : WA_GRACE_MS + 1;
    if (ageMs < WA_GRACE_MS) return;

    const lastMs = state.lastWaIncidentAt ? parseIso(state.lastWaIncidentAt) : null;
    if (lastMs && (Date.now() - lastMs) < WA_GRACE_MS) return;

    const gate = shouldAllowRestart(state, 'wa_stuck');
    if (!gate.ok) {
        maybeAlertMaxRestarts(state, gate, 'wa_stuck', chatJid);
        appendAction('watchdog_restart_throttled', `restart throttled (${gate.reason}) for wa`, {
            kind: 'wa_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount, waReason: wa.reason,
        });
        return;
    }
    const runningNow = listRunningNanoContainers();
    const actions: string[] = [];
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
    appendAction('watchdog_restart', 'restart by whatsapp reconnect policy', {
        kind: 'wa_stuck', reason: wa.reason, actions,
    });
    markRestart(state, 'wa_stuck', wa.reason);
    state.lastWaIncidentAt = nowIso();
    state.lastWaIncidentKey = `${chatJid}|wa|${wa.reason}`;
    state.waReconnectSince = nowIso();
}

// ── Layer 2: Container Health ───────────────────────────────────────────────

export function checkContainerLayer(
    state: WatchdogState,
    chatJid: string,
    lastAgentMs: number | null,
    lastTsMs: number | null,
): void {
    const runningDetailed = listRunningNanoContainersDetailed();
    const running = runningDetailed.map((x) => x.id);
    const oldestRunningAgeMs = runningDetailed.reduce((max, x) => {
        const age = typeof x.ageMs === 'number' ? x.ageMs : 0;
        return Math.max(max, age);
    }, 0);

    // Policy: Container hard-timeout
    if (CONTAINER_HARD_STUCK_ENABLED && running.length > 0 && oldestRunningAgeMs >= CONTAINER_HARD_STUCK_MS) {
        const nowMs = Date.now();
        const lastProgressMs = lastAgentMs || lastTsMs || null;
        const noProgressMs = lastProgressMs ? Math.max(0, nowMs - lastProgressMs) : null;
        const progressLooksStale = !lastProgressMs || (noProgressMs !== null && noProgressMs >= STUCK_GRACE_MS);
        if (progressLooksStale) {
            const gate = shouldAllowRestart(state, 'container_hard_stuck');
            if (!gate.ok) {
                maybeAlertMaxRestarts(state, gate, 'container_hard_stuck', chatJid);
                appendAction('watchdog_restart_throttled', `restart throttled (${gate.reason}) for container hard stuck`, {
                    kind: 'container_hard_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs,
                    recentCount: gate.recentCount, runningCount: running.length, oldestRunningAgeMs, noProgressMs,
                });
                return;
            }

            const actions: string[] = [];
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
            enqueueMessage(chatJid, `WATCHDOG: container hard-timeout (${Math.round(oldestRunningAgeMs / 60000)}m sin progreso util). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`);
            appendAction('watchdog_restart', 'restart by container hard-timeout policy', {
                kind: 'container_hard_stuck', runningCount: running.length, oldestRunningAgeMs, noProgressMs, actions,
            });
            markRestart(state, 'container_hard_stuck', `oldest=${Math.round(oldestRunningAgeMs / 60000)}m`);
            return;
        }
    }

    // Policy: Hard-stuck detection
    if (STUCK_HARD_ENABLED) {
        const hardStuck = detectHardStuckByActions();
        if (hardStuck.stuck) {
            const lastMs = state.lastHardStuckIncidentAt ? parseIso(state.lastHardStuckIncidentAt) : null;
            const sameKey = state.lastHardStuckIncidentKey === hardStuck.signature;
            const inCooldown = !!(lastMs && (Date.now() - lastMs) < STUCK_HARD_COOLDOWN_MS);
            if (!(sameKey && inCooldown)) {
                const gate = shouldAllowRestart(state, 'hard_stuck');
                if (!gate.ok) {
                    maybeAlertMaxRestarts(state, gate, 'hard_stuck', chatJid);
                    appendAction('watchdog_restart_throttled', `restart throttled (${gate.reason}) for hard_stuck`, {
                        kind: 'hard_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount,
                    });
                    return;
                }
                const runningNow = listRunningNanoContainers();
                const actions: string[] = [];
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
                enqueueMessage(chatJid, `WATCHDOG: detecte loop de heartbeat sin progreso real (${hardStuck.heartbeatCount} heartbeats, age=${Math.round((hardStuck.latestAgeMs || 0) / 1000)}s). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`);
                appendAction('watchdog_restart', 'restart by hard_stuck policy', {
                    kind: 'hard_stuck', heartbeatCount: hardStuck.heartbeatCount, latestAgeMs: hardStuck.latestAgeMs, actions,
                });
                markRestart(state, 'hard_stuck', `hb=${hardStuck.heartbeatCount}`);
                state.lastHardStuckIncidentAt = nowIso();
                state.lastHardStuckIncidentKey = hardStuck.signature;
                return;
            }
        }
    }

    // Policy: Orphan container cleanup
    try {
        const ownerRows = safeReadActiveContainerOwners();
        const ownedIds = new Set(ownerRows.map((x) => x.containerName));
        const runningNow = listRunningNanoContainersDetailed().slice().sort((a, b) => (a.ageMs || 0) - (b.ageMs || 0));
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
            const cleaned: string[] = [];
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
        }
    } catch {
        // ignore orphan cleanup failures
    }
}

// ── Layer 3: Runtime Health ─────────────────────────────────────────────────

export function checkRuntimeLayer(
    state: WatchdogState,
    chatJid: string,
    lastTsMs: number | null,
    lastAgentMs: number | null,
    inFlight: boolean,
): void {
    // Policy: Critical runtime
    if (CRITICAL_POLICY_ENABLED) {
        const crit = detectRuntimeCritical();
        if (!crit.critical) {
            if (state.lastCriticalSince) {
                state.lastCriticalSince = null;
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
                        maybeAlertMaxRestarts(state, gate, 'critical_runtime', chatJid);
                        appendAction('watchdog_restart_throttled', `restart throttled (${gate.reason}) for critical runtime`, {
                            kind: 'critical_runtime', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount,
                        });
                        return;
                    }
                    const runningNow = listRunningNanoContainers();
                    const actions: string[] = [];
                    for (const id of runningNow) {
                        const res = stopContainer(id);
                        actions.push(`${id}:${res}`);
                    }
                    kickstartNanoClaw();
                    enqueueMessage(chatJid, `WATCHDOG: runtime critical persistente (${Math.round(ageMs / 1000)}s). Razones: ${crit.reasons.join(', ') || 'n/a'}. Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`);
                    appendAction('watchdog_restart', 'restart by critical runtime policy', {
                        kind: 'critical_runtime', reasons: crit.reasons, ageMs, actions,
                    });
                    markRestart(state, 'critical_runtime', crit.reasons.join(', '));
                    state.lastCriticalIncidentAt = nowIso();
                    state.lastCriticalIncidentKey = crit.signature;
                    state.lastCriticalSince = nowIso();
                    return;
                }
            }
        }
    }

    // Policy: Cursor stuck → restart
    let stuck = false;
    if (lastTsMs && lastAgentMs) {
        const delta = lastTsMs - lastAgentMs;
        if (delta >= STUCK_GRACE_MS) stuck = true;
    }
    if (!stuck || inFlight) return;

    const incidentKey = `${chatJid}|${lastTsMs}`;
    if (state.lastIncidentKey === incidentKey) return;

    const gate = shouldAllowRestart(state, 'cursor_stuck');
    if (!gate.ok) {
        maybeAlertMaxRestarts(state, gate, 'cursor_stuck', chatJid);
        appendAction('watchdog_restart_throttled', `restart throttled (${gate.reason}) for cursor stuck`, {
            kind: 'cursor_stuck', reason: gate.reason, cooldownLeftMs: gate.cooldownLeftMs, recentCount: gate.recentCount,
        });
        return;
    }

    const running = listRunningNanoContainers();
    const actions: string[] = [];
    for (const id of running) {
        const res = stopContainer(id);
        actions.push(`${id}:${res}`);
    }

    kickstartNanoClaw();
    const lastTs = lastTsMs ? new Date(lastTsMs).toISOString() : 'n/a';
    enqueueMessage(chatJid, `WATCHDOG: detecte bloqueo (mensajes vistos ${lastTs} pero agent cursor viejo). Acciones: ${actions.join(', ') || 'n/a'}. Reinicie com.nanoclaw.`);
    appendAction('watchdog_restart', 'restart by cursor stuck policy', { kind: 'cursor_stuck', lastTs, actions });
    markRestart(state, 'cursor_stuck', String(lastTs || 'n/a'));

    state.lastIncidentAt = nowIso();
    state.lastIncidentKey = incidentKey;
}

// ── Main Orchestrator ──────────────────────────────────────────────────────

function main(): void {
    if (!ENABLED) return;

    ensureDirs();
    const state = safeReadJson<WatchdogState>(STATE_PATH, {
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
        try { sh('container', ['system', 'start'], { timeout: 30_000 }); } catch { /* */ }
    }

    const lastTs = getRouterState('last_timestamp');
    const lastAgentRaw = getRouterState('last_agent_timestamp');
    const lastTsMs = parseIso(lastTs);
    let lastAgentMs: number | null = null;
    try {
        const m = JSON.parse(lastAgentRaw || '{}');
        const v = chatJid ? m?.[chatJid] : null;
        if (typeof v === 'string') lastAgentMs = parseIso(v);
    } catch { /* ignore */ }

    const runningDetailed = listRunningNanoContainersDetailed();
    const inFlight = runningDetailed.some((x) => typeof x.ageMs === 'number' && x.ageMs < INFLIGHT_CONTAINER_AGE_MS);

    if (VERBOSE) {
        const running = runningDetailed.map((x) => x.id);
        fs.appendFileSync(
            path.join(LOG_DIR, 'watchdog.log'),
            `[${nowIso()}] chat=${chatJid || '(none)'} running=${running.length} last=${lastTs || 'n/a'} agent=${lastAgentMs ? new Date(lastAgentMs).toISOString() : 'n/a'} inFlight=${inFlight}\n`,
        );
    }

    // Run each layer independently
    // Layer 1: WhatsApp health (only when not in-flight)
    if (!inFlight) {
        checkWhatsAppLayer(state, chatJid);
    }

    // Layer 2: Container health
    checkContainerLayer(state, chatJid, lastAgentMs, lastTsMs);

    // Layer 3: Runtime health
    checkRuntimeLayer(state, chatJid, lastTsMs, lastAgentMs, inFlight);

    // Persist state
    safeWriteJson(STATE_PATH, state);
}

main();
