#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const HOME = process.env.HOME || '';
const ROOT = process.env.NANOCLAW_ROOT || path.join(HOME, 'nanoclaw');
const GROUP_FOLDER = process.env.STUCK_MONITOR_GROUP || 'main';

const SWARMDEV_DIR = path.join(ROOT, 'groups', GROUP_FOLDER, 'swarmdev');
const ACTIONS_PATH = path.join(SWARMDEV_DIR, 'actions.jsonl');
const LANE_STATE_PATH = path.join(SWARMDEV_DIR, 'lane-state.json');
const TASKS_STATE_PATH = path.join(SWARMDEV_DIR, 'tasks-state.json');
const STATUS_PATH = path.join(SWARMDEV_DIR, 'status.md');
const TODO_PATH = path.join(ROOT, 'groups', GROUP_FOLDER, 'todo.md');
const IPC_INPUT_DIR = path.join(ROOT, 'data', 'ipc', GROUP_FOLDER, 'input');
const STATE_PATH = path.join(ROOT, 'store', 'stuck-monitor.json');

const STUCK_ACTION_GRACE_MS = Number(process.env.STUCK_MONITOR_ACTION_GRACE_MS || 8 * 60 * 1000);
const STUCK_NUDGE_COOLDOWN_MS = Number(process.env.STUCK_MONITOR_NUDGE_COOLDOWN_MS || 5 * 60 * 1000);
const HEARTBEAT_IDLE_AFTER_MS = Number(process.env.STUCK_MONITOR_HEARTBEAT_IDLE_AFTER_MS || 2 * 60 * 1000);
const HEARTBEAT_COOLDOWN_MS = Number(process.env.STUCK_MONITOR_HEARTBEAT_COOLDOWN_MS || 60 * 1000);
const APP_MODE = String(process.env.APP_MODE || process.env.MODE || 'prod').trim().toLowerCase();
const DEBUG_MODE = APP_MODE === 'debug';
const ACTION_RECONCILE_MAX_LINES = Number(process.env.STUCK_MONITOR_ACTION_RECONCILE_MAX_LINES || 600);
const ACTION_RECONCILE_WINDOW_MS = Number(process.env.STUCK_MONITOR_ACTION_RECONCILE_WINDOW_MS || 2 * 60 * 60 * 1000);
const TASKS_RECONCILE_COOLDOWN_MS = Number(process.env.STUCK_MONITOR_TASKS_RECONCILE_COOLDOWN_MS || 20 * 1000);

const ROLES = ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'QA'];

function nowIso() {
  return new Date().toISOString();
}

function parseIsoMs(v) {
  const n = Date.parse(String(v || ''));
  return Number.isFinite(n) ? n : null;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, file);
}

function appendAction(action) {
  fs.mkdirSync(path.dirname(ACTIONS_PATH), { recursive: true });
  fs.appendFileSync(ACTIONS_PATH, `${JSON.stringify(action)}\n`, 'utf-8');
}

function updateStatus(item, next = 'waiting for agent output') {
  const lines = [
    '# SwarmDev Status',
    '',
    'ETAPA: TEAMLEAD',
    `ITEM: ${item}`,
    'ARCHIVOS: groups/main/todo.md, groups/main/swarmdev/lane-state.json',
    `ULTIMO_UPDATE: ${nowIso()}`,
    `SIGUIENTE: ${next}`,
    '',
  ];
  fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
  fs.writeFileSync(STATUS_PATH, lines.join('\n'), 'utf-8');
}

function listRunningNanoContainers() {
  try {
    const out = execFileSync('container', ['ls', '--format', 'json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
    });
    const arr = JSON.parse(out || '[]');
    return arr
      .map((x) => ({
        id: String(x?.configuration?.id || ''),
        status: String(x?.status || ''),
      }))
      .filter((x) => x.id.startsWith('nanoclaw-') && x.status === 'running');
  } catch {
    return [];
  }
}

function lastActionTsMs() {
  try {
    if (!fs.existsSync(ACTIONS_PATH)) return null;
    const lines = fs.readFileSync(ACTIONS_PATH, 'utf-8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const ms = parseIsoMs(obj?.ts);
        if (ms) return ms;
      } catch {
        // ignore malformed line
      }
    }
    return null;
  } catch {
    return null;
  }
}

function enqueueNudge(text) {
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
  const file = path.join(IPC_INPUT_DIR, `${Date.now()}-stuck-monitor.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ type: 'message', text }), 'utf-8');
  fs.renameSync(tmp, file);
}

function normalizeState(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'pending') return 'todo';
  if (v === 'queue' || v === 'queued') return 'queued';
  if (v === 'working') return 'working';
  if (v === 'in_progress' || v === 'in-progress' || v === 'inprogress') return 'doing';
  if (v === 'completed' || v === 'complete') return 'done';
  if (v === 'failed') return 'failed';
  if (
    v === 'planning' ||
    v === 'todo' ||
    v === 'queued' ||
    v === 'doing' ||
    v === 'working' ||
    v === 'blocked' ||
    v === 'done' ||
    v === 'failed'
  ) return v;
  return 'todo';
}

function deriveTodoStateFromLanes(lanes) {
  const values = Object.values(lanes || {}).map((x) => String(x?.state || 'idle').toLowerCase());
  if (values.some((s) => s === 'error')) return 'blocked';
  if ((lanes?.QA?.state || '').toLowerCase() === 'done') return 'done';
  if (values.some((s) => s === 'working' || s === 'queued' || s === 'waiting')) return 'doing';
  if (values.some((s) => s === 'done')) return 'doing';
  return null;
}

function parseTodoBlocks() {
  if (!fs.existsSync(TODO_PATH)) return [];
  const lines = fs.readFileSync(TODO_PATH, 'utf-8').split('\n');
  const items = [];
  let cur = null;
  for (const line of lines) {
    const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
    if (idm) {
      if (cur && cur.id) items.push(cur);
      cur = { id: String(idm[1] || '').toUpperCase(), owner: '', scope: '', state: 'todo' };
      continue;
    }
    if (!cur) continue;
    const own = line.match(/^\s*Owner:\s*(.*)\s*$/);
    if (own) {
      cur.owner = String(own[1] || '').trim();
      continue;
    }
    const scope = line.match(/^\s*Scope:\s*(.*)\s*$/);
    if (scope) {
      cur.scope = String(scope[1] || '').trim();
      continue;
    }
    const st = line.match(/^\s*Estado:\s*(.*)\s*$/);
    if (st) {
      cur.state = normalizeState(st[1]);
      continue;
    }
  }
  if (cur && cur.id) items.push(cur);
  return items;
}

function canonicalFromTodoState(raw) {
  const s = normalizeState(raw);
  if (s === 'planning' || s === 'todo') return 'todo';
  if (s === 'queued') return 'queued';
  if (s === 'doing' || s === 'working') return 'working';
  if (s === 'blocked') return 'blocked';
  if (s === 'failed') return 'failed';
  if (s === 'done') return 'done';
  return 'todo';
}

function canonicalFromLaneStates(lanes) {
  const values = Object.values(lanes || {}).map((x) => String(x?.state || 'idle').toLowerCase());
  if (values.some((s) => s === 'error')) return 'failed';
  if (values.some((s) => s === 'working' || s === 'waiting')) return 'working';
  if (values.some((s) => s === 'queued')) return 'queued';
  if ((lanes?.QA?.state || '').toLowerCase() === 'done') return 'done';
  if (values.some((s) => s === 'done')) return 'working';
  return null;
}

function rankState(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'working') return 0;
  if (s === 'queued') return 1;
  if (s === 'todo') return 2;
  if (s === 'blocked') return 3;
  if (s === 'failed') return 4;
  if (s === 'done') return 5;
  return 9;
}

function readRecentActions(maxLines = ACTION_RECONCILE_MAX_LINES) {
  try {
    if (!fs.existsSync(ACTIONS_PATH)) return [];
    const lines = fs.readFileSync(ACTIONS_PATH, 'utf-8').trim().split('\n');
    const tail = lines.slice(Math.max(0, lines.length - Math.max(50, maxLines)));
    const out = [];
    for (const line of tail) {
      const row = String(line || '').trim();
      if (!row) continue;
      try {
        const obj = JSON.parse(row);
        const tsMs = parseIsoMs(obj?.ts);
        if (!tsMs) continue;
        out.push({ ...obj, tsMs });
      } catch {
        // ignore malformed
      }
    }
    out.sort((a, b) => Number(a.tsMs || 0) - Number(b.tsMs || 0));
    const minTs = Date.now() - ACTION_RECONCILE_WINDOW_MS;
    return out.filter((x) => Number(x.tsMs || 0) >= minTs);
  } catch {
    return [];
  }
}

function blankLaneSnapshot() {
  const out = {};
  for (const role of ROLES) {
    out[role] = { state: 'idle', updatedAt: nowIso() };
  }
  return out;
}

function upsertLaneTask(laneState, taskId) {
  const id = String(taskId || '').trim().toUpperCase();
  if (!id) return null;
  if (!laneState.tasks || typeof laneState.tasks !== 'object') laneState.tasks = {};
  if (!laneState.tasks[id]) {
    laneState.tasks[id] = { taskId: id, lanes: blankLaneSnapshot() };
  } else if (!laneState.tasks[id].lanes || typeof laneState.tasks[id].lanes !== 'object') {
    laneState.tasks[id].lanes = blankLaneSnapshot();
  }
  for (const role of ROLES) {
    if (!laneState.tasks[id].lanes[role]) {
      laneState.tasks[id].lanes[role] = { state: 'idle', updatedAt: nowIso() };
    }
  }
  return laneState.tasks[id];
}

function roleFromAction(row) {
  const direct = String(row?.meta?.role || row?.role || row?.stage || '').trim().toUpperCase();
  if (ROLES.includes(direct)) return direct;
  return null;
}

function taskIdFromAction(row) {
  const direct = String(row?.meta?.taskId || row?.taskId || row?.task || '').trim().toUpperCase();
  if (/^[A-Z]+-\d+$/.test(direct)) return direct;
  const detail = String(row?.detail || '');
  const m = detail.match(/\b([A-Z]+-\d+)\b/);
  return m ? String(m[1] || '').toUpperCase() : '';
}

function parseLaneTransition(row) {
  if (!row || typeof row !== 'object') return null;
  if (String(row.action || '').trim() !== 'lane_transition') return null;
  const taskId = String(row.taskId || '').trim().toUpperCase();
  if (!/^[A-Z]+-\d+$/.test(taskId)) return null;
  const role = String(row.role || '').trim().toUpperCase();
  if (!ROLES.includes(role)) return null;
  const state = String(row.state || '').trim().toLowerCase();
  if (!['idle', 'queued', 'working', 'waiting', 'done', 'error', 'failed'].includes(state)) return null;
  const reason = String(row.reason || '').trim();
  if (!reason) return null;
  const ts = String(row.ts || '').trim();
  const tsMs = parseIsoMs(ts);
  if (!tsMs) return null;
  return { taskId, role, state, reason, ts, tsMs };
}

function reconcileLaneStateFromActions() {
  if (!fs.existsSync(LANE_STATE_PATH)) return { touched: 0, tasksTouched: 0 };
  const laneState = readJson(LANE_STATE_PATH, { version: 1, updatedAt: nowIso(), tasks: {} });
  const recent = readRecentActions();
  let touched = 0;
  const touchedTasks = new Set();

  const setLane = (taskId, role, nextState, detail, ts) => {
    const row = upsertLaneTask(laneState, taskId);
    if (!row) return;
    const lane = row.lanes[role];
    if (!lane) return;
    const prevState = String(lane.state || 'idle').toLowerCase();
    const prevTs = parseIsoMs(lane.updatedAt) || 0;
    const nextTs = parseIsoMs(ts) || Date.now();
    if (nextTs < prevTs) return;
    if (prevState === nextState && String(lane.detail || '') === String(detail || '') && prevTs === nextTs) return;
    row.lanes[role] = {
      ...lane,
      state: nextState,
      updatedAt: ts || nowIso(),
      detail: detail || lane.detail || '',
    };
    touched += 1;
    touchedTasks.add(taskId);
  };

  for (const row of recent) {
    const tr = parseLaneTransition(row);
    if (!tr) continue;
    setLane(tr.taskId, tr.role, tr.state, tr.reason, tr.ts);
  }

  if (touched > 0) {
    laneState.updatedAt = nowIso();
    writeJson(LANE_STATE_PATH, laneState);
  }
  return { touched, tasksTouched: touchedTasks.size };
}

function reconcileTasksStateFromSources() {
  const todoItems = parseTodoBlocks();
  const prevDoc = readJson(TASKS_STATE_PATH, null);
  const prevMap = new Map(
    Array.isArray(prevDoc?.items)
      ? prevDoc.items.map((x) => [String(x?.id || '').toUpperCase(), x])
      : [],
  );
  const recent = readRecentActions();
  const lastActionByTask = new Map();
  for (const row of recent) {
    const taskId = taskIdFromAction(row);
    if (!taskId) continue;
    const prev = lastActionByTask.get(taskId);
    if (!prev || Number(row.tsMs || 0) >= Number(prev.tsMs || 0)) lastActionByTask.set(taskId, row);
  }

  const items = [];
  for (const it of todoItems) {
    const id = String(it.id || '').trim().toUpperCase();
    if (!id) continue;
    const todoCanonical = canonicalFromTodoState(it.state);
    const action = lastActionByTask.get(id);
    const prev = prevMap.get(id) || null;
    items.push({
      id,
      owner: String(it.owner || '').trim() || undefined,
      scope: String(it.scope || '').trim() || undefined,
      // Source of truth: todo.md (avoid workflow/lane drift forcing everything to "doing").
      state: todoCanonical,
      updatedAt: String(action?.ts || prev?.updatedAt || nowIso()),
      source: 'todo.md',
      lastAction: String(action?.action || '').trim() || undefined,
      lastError: String(action?.detail || '').toLowerCase().includes('error') ? String(action?.detail || '').slice(0, 240) : undefined,
    });
  }

  items.sort((a, b) => {
    const ra = rankState(a.state);
    const rb = rankState(b.state);
    if (ra !== rb) return ra - rb;
    return String(a.id).localeCompare(String(b.id));
  });

  const nextDoc = {
    version: 1,
    updatedAt: nowIso(),
    source: 'todo+lane+actions',
    items,
  };
  const prevSig = prevDoc ? JSON.stringify(prevDoc.items || []) : '';
  const nextSig = JSON.stringify(nextDoc.items || []);
  if (prevSig === nextSig) return { touched: 0, total: items.length };
  writeJson(TASKS_STATE_PATH, nextDoc);
  return { touched: 1, total: items.length };
}

function reconcileTodoFromLaneState() {
  if (!fs.existsSync(TODO_PATH) || !fs.existsSync(LANE_STATE_PATH)) return 0;
  const laneState = readJson(LANE_STATE_PATH, { tasks: {} });
  const lines = fs.readFileSync(TODO_PATH, 'utf-8').split('\n');
  const idRe = /^- ID:\s*([A-Z]+-\d+)\s*$/;
  let touched = 0;

  const fmtLanes = (lanes) => {
    const roles = ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'QA'];
    return roles
      .map((role) => {
        const lane = lanes?.[role] || {};
        const st = String(lane.state || 'idle');
        const m = String(lane.updatedAt || '').match(/T(\d{2}:\d{2})/);
        return m ? `${role}=${st}@${m[1]}` : `${role}=${st}`;
      })
      .join(' | ');
  };

  for (let i = 0; i < lines.length; i++) {
    const idm = lines[i].match(idRe);
    if (!idm) continue;
    const taskId = String(idm[1] || '').toUpperCase();
    const row = laneState?.tasks?.[taskId];
    if (!row || !row.lanes) continue;

    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (idRe.test(lines[j])) {
        end = j - 1;
        break;
      }
    }

    const wanted = deriveTodoStateFromLanes(row.lanes);
    let stateLine = -1;
    let current = 'todo';
    let lanesLine = -1;
    for (let j = i + 1; j <= end; j++) {
      const sm = lines[j].match(/^\s*Estado:\s*(.*)\s*$/i);
      if (sm && stateLine === -1) {
        stateLine = j;
        current = normalizeState(sm[1]);
      }
      if (/^\s*Lanes:\s*/.test(lines[j]) && lanesLine === -1) lanesLine = j;
    }

    if (wanted && wanted !== current) {
      if (stateLine >= 0) {
        lines[stateLine] = '  Estado: ' + wanted;
      } else {
        lines.splice(Math.min(end + 1, lines.length), 0, `  Estado: ${wanted}`);
      }
      touched += 1;
    }

    const nextLanes = `  Lanes: ${fmtLanes(row.lanes)}`;
    if (lanesLine >= 0) {
      if (lines[lanesLine].trim() !== nextLanes.trim()) {
        lines[lanesLine] = nextLanes;
        touched += 1;
      }
    } else {
      lines.splice(Math.min(end + 1, lines.length), 0, nextLanes);
      touched += 1;
    }
  }

  if (touched > 0) {
    const tmp = `${TODO_PATH}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
    fs.renameSync(tmp, TODO_PATH);
  }
  return touched;
}

function main() {
  const state = readJson(STATE_PATH, {
    lastNudgeAt: null,
    lastHeartbeatAt: null,
    lastTodoReconcileAt: null,
    lastLaneReconcileAt: null,
    lastTasksReconcileAt: null,
  });
  const now = Date.now();
  const running = listRunningNanoContainers();
  const active = running.length > 0;
  const lastActionMs = lastActionTsMs();
  const ageMs = lastActionMs ? Math.max(0, now - lastActionMs) : Infinity;

  let laneTouched = 0;
  let laneTasksTouched = 0;
  try {
    const laneOut = reconcileLaneStateFromActions();
    laneTouched = Number(laneOut.touched || 0);
    laneTasksTouched = Number(laneOut.tasksTouched || 0);
    if (laneTouched > 0) {
      appendAction({
        ts: nowIso(),
        groupFolder: GROUP_FOLDER,
        action: 'lane_reconciled',
        stage: 'TEAMLEAD',
        detail: `lane reconciled from actions (touched=${laneTouched}, tasks=${laneTasksTouched})`,
        files: ['groups/main/swarmdev/actions.jsonl', 'groups/main/swarmdev/lane-state.json'],
        meta: { touched: laneTouched, tasksTouched: laneTasksTouched },
      });
      state.lastLaneReconcileAt = nowIso();
    }
  } catch {
    // ignore lane reconciliation errors
  }

  const touched = reconcileTodoFromLaneState();
  if (touched > 0) {
    appendAction({
      ts: nowIso(),
      groupFolder: GROUP_FOLDER,
      action: 'todo_reconciled',
      stage: 'TEAMLEAD',
      detail: `todo reconciled from lane-state (touched=${touched})`,
      files: ['groups/main/todo.md', 'groups/main/swarmdev/lane-state.json'],
      meta: { touched },
    });
    state.lastTodoReconcileAt = nowIso();
  }

  const lastTasksMs = parseIsoMs(state.lastTasksReconcileAt);
  if (!lastTasksMs || (now - lastTasksMs) >= TASKS_RECONCILE_COOLDOWN_MS || touched > 0 || laneTouched > 0) {
    try {
      const t = reconcileTasksStateFromSources();
      if (t.touched > 0) {
        appendAction({
          ts: nowIso(),
          groupFolder: GROUP_FOLDER,
          action: 'tasks_state_reconciled',
          stage: 'TEAMLEAD',
          detail: `tasks-state reconciled from todo+lane+actions (items=${t.total})`,
          files: [
            'groups/main/todo.md',
            'groups/main/swarmdev/lane-state.json',
            'groups/main/swarmdev/actions.jsonl',
            'groups/main/swarmdev/tasks-state.json',
          ],
          meta: { items: t.total },
        });
      }
      state.lastTasksReconcileAt = nowIso();
    } catch {
      // ignore tasks-state reconciliation errors
    }
  }

  if (DEBUG_MODE && active && ageMs >= HEARTBEAT_IDLE_AFTER_MS) {
    const lastBeatMs = parseIsoMs(state.lastHeartbeatAt);
    if (!lastBeatMs || (now - lastBeatMs) >= HEARTBEAT_COOLDOWN_MS) {
      appendAction({
        ts: nowIso(),
        groupFolder: GROUP_FOLDER,
        action: 'still_processing',
        stage: 'TEAMLEAD',
        detail: 'heartbeat emitted by stuck-monitor',
        meta: { activeContainers: running.length, actionAgeMs: ageMs },
      });
      updateStatus('still processing', 'waiting for agent output');
      state.lastHeartbeatAt = nowIso();
    }
  }

  if (active && ageMs >= STUCK_ACTION_GRACE_MS) {
    const lastNudgeMs = parseIsoMs(state.lastNudgeAt);
    if (!lastNudgeMs || (now - lastNudgeMs) >= STUCK_NUDGE_COOLDOWN_MS) {
      enqueueNudge(
        '@Andy AUTO-CONTINUAR estricto: detectado silencio operativo. Segui pendientes segun dependencias, no preguntes "continuo?", reporta ETAPA/ITEM/ARCHIVOS/SIGUIENTE cada 60s.',
      );
      appendAction({
        ts: nowIso(),
        groupFolder: GROUP_FOLDER,
        action: 'stuck_nudge',
        stage: 'TEAMLEAD',
        detail: `nudge injected by stuck-monitor (actionAgeMs=${ageMs})`,
        files: ['data/ipc/main/input'],
        meta: { activeContainers: running.length, actionAgeMs: ageMs },
      });
      updateStatus('stuck nudge injected', 'waiting for agent output');
      state.lastNudgeAt = nowIso();
    }
  }

  writeJson(STATE_PATH, state);
}

main();
