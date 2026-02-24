import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER } from './config.js';
import { createCheckpoint, rollbackToCheckpoint } from './git-checkpoint.js';
import {
  upsertWorkflowTask,
  getWorkflowTask,
  getWorkflowTasksByGroup,
  insertWorkflowTransition,
  getWorkflowTransitions,
  type WorkflowTaskRow,
} from './db.js';

export type WorkflowStage =
  | 'TEAMLEAD'
  | 'PM'
  | 'SPEC'
  | 'DEV'
  | 'QA'
  | 'DONE'
  | 'BLOCKED';

type TaskLifecycleStatus = 'running' | 'done' | 'blocked';

type TaskTransition = {
  ts: string;
  from: WorkflowStage;
  to: WorkflowStage;
  reason?: string;
};

export type TaskWorkflowState = {
  taskId: string;
  stage: WorkflowStage;
  status: TaskLifecycleStatus;
  retries: number;
  pendingQuestions: string[];
  decisions: string[];
  createdAt: string;
  updatedAt: string;
  transitions: TaskTransition[];
  lastError?: string;
};

type WorkflowStateFile = {
  version: 1;
  updatedAt: string;
  tasks: Record<string, TaskWorkflowState>;
};

type StageContract = {
  stage: WorkflowStage;
  item: string;
  archivos: string;
  siguiente: string;
};

type StageArtifactValidation = {
  ok: boolean;
  missing: string[];
};

type StageArtifactEnsureResult = {
  created: string[];
};

const WORKFLOW_FILE = 'workflow-state.json';
// Accept task IDs with 3+ digits (e.g. REQ-803965), not only exactly 3.
const TASK_ID_RE = /\b[A-Z]{2,16}-\d{3,}\b/g;

const NEXT_STAGES: Record<WorkflowStage, WorkflowStage[]> = {
  TEAMLEAD: ['PM', 'BLOCKED'],
  // Allow PM -> DEV bridge in strict-parallel mode when SPEC/ARQ happened in lanes
  // but stage markers arrived out-of-order in the merged agent output.
  PM: ['SPEC', 'DEV', 'BLOCKED', 'DONE'],
  SPEC: ['DEV', 'BLOCKED', 'DONE'],
  DEV: ['QA', 'BLOCKED', 'DONE'],
  QA: ['DONE', 'DEV', 'BLOCKED'],
  DONE: ['DONE'],
  BLOCKED: ['TEAMLEAD', 'PM', 'SPEC', 'DEV', 'QA', 'BLOCKED'],
};

function statePath(groupFolder: string): string {
  return path.join(
    GROUPS_DIR,
    groupFolder || MAIN_GROUP_FOLDER,
    'swarmdev',
    WORKFLOW_FILE,
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function newTask(taskId: string): TaskWorkflowState {
  const now = nowIso();
  return {
    taskId,
    stage: 'TEAMLEAD',
    status: 'running',
    retries: 0,
    pendingQuestions: [],
    decisions: [],
    createdAt: now,
    updatedAt: now,
    transitions: [],
  };
}

/** Convert a DB row + transitions into the in-memory TaskWorkflowState shape. */
function rowToState(row: WorkflowTaskRow, transitions: Array<{ ts: string; from_stage: string; to_stage: string; reason: string | null }>): TaskWorkflowState {
  return {
    taskId: row.task_id,
    stage: row.stage as WorkflowStage,
    status: row.status as TaskLifecycleStatus,
    retries: row.retries,
    pendingQuestions: JSON.parse(row.pending_questions || '[]'),
    decisions: JSON.parse(row.decisions || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transitions: transitions.map(t => ({
      ts: t.ts,
      from: t.from_stage as WorkflowStage,
      to: t.to_stage as WorkflowStage,
      reason: t.reason || undefined,
    })),
    lastError: row.last_error || undefined,
  };
}

/** Persist a TaskWorkflowState to SQLite (upsert task + insert new transitions). Returns true on success, false on OCC conflict. */
function persistState(groupFolder: string, task: TaskWorkflowState, expectedStage?: string): boolean {
  return upsertWorkflowTask({
    taskId: task.taskId,
    groupFolder,
    stage: task.stage,
    status: task.status,
    retries: task.retries,
    pendingQuestions: task.pendingQuestions,
    decisions: task.decisions,
    lastError: task.lastError ?? null,
    expectedStage,
  });
}

/** Write JSON file as read-only cache for external scripts (watchdog, stuck-monitor). */
function writeJsonCache(groupFolder: string, state: WorkflowStateFile): void {
  const p = statePath(groupFolder);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    state.updatedAt = nowIso();
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, p);
  } catch {
    // Cache write is best-effort
  }
}

export function loadWorkflowState(groupFolder: string): WorkflowStateFile {
  const gf = groupFolder || MAIN_GROUP_FOLDER;
  const rows = getWorkflowTasksByGroup(gf);
  const tasks: Record<string, TaskWorkflowState> = {};
  for (const row of rows) {
    const transitions = getWorkflowTransitions(row.task_id, gf);
    tasks[row.task_id] = rowToState(row, transitions);
  }
  return { version: 1, updatedAt: nowIso(), tasks };
}



export function extractTaskIds(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || '').matchAll(TASK_ID_RE)) out.add(m[0]);
  return [...out];
}

export function ensureWorkflowTasks(
  groupFolder: string,
  taskIds: string[],
): TaskWorkflowState[] {
  const gf = groupFolder || MAIN_GROUP_FOLDER;
  const touched: TaskWorkflowState[] = [];
  for (const taskId of taskIds) {
    const existing = getWorkflowTask(taskId, gf);
    if (!existing) {
      const task = newTask(taskId);
      persistState(gf, task);
      touched.push(task);
    } else {
      const transitions = getWorkflowTransitions(taskId, gf);
      touched.push(rowToState(existing, transitions));
    }
  }
  // Update JSON cache
  writeJsonCache(gf, loadWorkflowState(gf));
  return touched;
}

export function transitionTaskStage(params: {
  groupFolder: string;
  taskId: string;
  to: WorkflowStage;
  reason?: string;
}): { ok: boolean; state: TaskWorkflowState; error?: string } {
  const gf = params.groupFolder || MAIN_GROUP_FOLDER;
  const existingRow = getWorkflowTask(params.taskId, gf);
  let task: TaskWorkflowState;
  if (existingRow) {
    const transitions = getWorkflowTransitions(params.taskId, gf);
    task = rowToState(existingRow, transitions);
  } else {
    task = newTask(params.taskId);
  }

  const from = task.stage;
  // Idempotent transition: keep state stable
  if (from === params.to) {
    task.updatedAt = nowIso();
    task.lastError = undefined;
    const ok = persistState(gf, task, from);
    if (ok) writeJsonCache(gf, loadWorkflowState(gf));
    return { ok: true, state: task };
  }
  if (!NEXT_STAGES[from].includes(params.to)) {
    const err = `invalid transition ${from} -> ${params.to}`;
    task.lastError = err;
    task.retries += 1;
    task.updatedAt = nowIso();
    // Auto-escalate to BLOCKED after too many real failures
    const MAX_REAL_RETRIES = 5;
    if (task.retries >= MAX_REAL_RETRIES && task.stage !== 'BLOCKED' && task.stage !== 'DONE') {
      task.stage = 'BLOCKED';
      task.status = 'blocked';
      task.lastError = `auto-escalated to BLOCKED after ${task.retries} invalid transitions (last: ${err})`;
      task.transitions.push({
        ts: task.updatedAt,
        from,
        to: 'BLOCKED',
        reason: `auto-escalate: max retries (${task.retries})`,
      });
      insertWorkflowTransition({
        taskId: params.taskId,
        groupFolder: gf,
        fromStage: from,
        toStage: 'BLOCKED',
        reason: `auto-escalate: max retries (${task.retries})`,
      });
    }
    const ok = persistState(gf, task, from);
    if (!ok) return { ok: false, state: task, error: `OCC conflict: task stage changed from ${from} concurrently` };
    writeJsonCache(gf, loadWorkflowState(gf));
    return { ok: false, state: task, error: err };
  }

  task.stage = params.to;
  task.updatedAt = nowIso();
  task.lastError = undefined;
  task.transitions.push({
    ts: task.updatedAt,
    from,
    to: params.to,
    reason: params.reason,
  });
  if (params.to === 'DONE') task.status = 'done';
  else if (params.to === 'BLOCKED') task.status = 'blocked';
  else task.status = 'running';

  // Record transition in DB
  insertWorkflowTransition({
    taskId: params.taskId,
    groupFolder: gf,
    fromStage: from,
    toStage: params.to,
    reason: params.reason,
  });

  // Git checkpoint before stage transition (best-effort)
  try {
    createCheckpoint({
      groupFolder: gf,
      taskId: params.taskId,
      fromStage: from,
      toStage: params.to,
    });
  } catch {
    // Non-fatal
  }

  // Auto-rollback on QA/DEV → BLOCKED: revert to last known-good checkpoint
  if (params.to === 'BLOCKED' && (from === 'QA' || from === 'DEV')) {
    const rollbackTarget = from === 'QA' ? 'dev' : 'spec';
    try {
      rollbackToCheckpoint({
        groupFolder: gf,
        taskId: params.taskId,
        stage: rollbackTarget,
      });
    } catch {
      // Rollback is best-effort
    }
  }

  const ok = persistState(gf, task, from);
  if (!ok) return { ok: false, state: task, error: `OCC conflict: task stage changed from ${from} concurrently` };

  writeJsonCache(gf, loadWorkflowState(gf));
  return { ok: true, state: task };
}

export function markTaskValidationFailure(params: {
  groupFolder: string;
  taskId: string;
  error: string;
}): TaskWorkflowState {
  const gf = params.groupFolder || MAIN_GROUP_FOLDER;
  const existingRow = getWorkflowTask(params.taskId, gf);
  let task: TaskWorkflowState;
  if (existingRow) {
    const transitions = getWorkflowTransitions(params.taskId, gf);
    task = rowToState(existingRow, transitions);
  } else {
    task = newTask(params.taskId);
  }
  task.retries += 1;
  task.lastError = params.error;
  task.updatedAt = nowIso();
  persistState(gf, task);
  writeJsonCache(gf, loadWorkflowState(gf));
  return task;
}

export function getTaskWorkflowState(
  groupFolder: string,
  taskId: string,
): TaskWorkflowState {
  const gf = groupFolder || MAIN_GROUP_FOLDER;
  const row = getWorkflowTask(taskId, gf);
  if (!row) {
    const task = newTask(taskId);
    persistState(gf, task);
    writeJsonCache(gf, loadWorkflowState(gf));
    return task;
  }
  const transitions = getWorkflowTransitions(taskId, gf);
  return rowToState(row, transitions);
}

export function getBlockedTasks(groupFolder: string): TaskWorkflowState[] {
  const gf = groupFolder || MAIN_GROUP_FOLDER;
  const rows = getWorkflowTasksByGroup(gf);
  const result: TaskWorkflowState[] = [];
  for (const row of rows) {
    const pq = JSON.parse(row.pending_questions || '[]') as string[];
    if (pq.length > 0) {
      const transitions = getWorkflowTransitions(row.task_id, gf);
      result.push(rowToState(row, transitions));
    }
  }
  return result;
}

export function extractQuestions(text: string): string[] {
  const lines = String(text || '').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.includes('?')) out.push(line);
    if (out.length >= 3) break;
  }
  return out;
}

export function setBlockedQuestions(params: {
  groupFolder: string;
  taskId: string;
  questions: string[];
}): TaskWorkflowState {
  const gf = params.groupFolder || MAIN_GROUP_FOLDER;
  const existingRow = getWorkflowTask(params.taskId, gf);
  let task: TaskWorkflowState;
  if (existingRow) {
    const transitions = getWorkflowTransitions(params.taskId, gf);
    task = rowToState(existingRow, transitions);
  } else {
    task = newTask(params.taskId);
  }
  const uniq = [...new Set(params.questions.map((q) => q.trim()).filter(Boolean))];
  task.pendingQuestions = uniq.slice(0, 3);
  task.updatedAt = nowIso();
  task.stage = 'BLOCKED';
  task.status = 'blocked';
  persistState(gf, task);
  writeJsonCache(gf, loadWorkflowState(gf));
  return task;
}

export function resolveTaskQuestions(params: {
  groupFolder: string;
  taskId: string;
  decision: string;
}): TaskWorkflowState {
  const gf = params.groupFolder || MAIN_GROUP_FOLDER;
  const existingRow = getWorkflowTask(params.taskId, gf);
  let task: TaskWorkflowState;
  if (existingRow) {
    const transitions = getWorkflowTransitions(params.taskId, gf);
    task = rowToState(existingRow, transitions);
  } else {
    task = newTask(params.taskId);
  }
  const note = params.decision.trim();
  if (note) task.decisions.push(note);
  task.pendingQuestions = [];
  task.stage = 'TEAMLEAD';
  task.status = 'running';
  task.updatedAt = nowIso();
  persistState(gf, task);
  writeJsonCache(gf, loadWorkflowState(gf));
  return task;
}

export function reconcileWorkflowOnBoot(params: {
  groupFolder: string;
  staleMs: number;
  maxRunning: number;
}): {
  changed: boolean;
  staleBlocked: number;
  overflowBlocked: number;
  keptRunning: number;
  blockedTaskIds: string[];
} {
  const gf = params.groupFolder || MAIN_GROUP_FOLDER;
  const now = Date.now();
  const staleMs = Math.max(60_000, Number(params.staleMs) || (3 * 60 * 60 * 1000));
  const maxRunning = Math.max(1, Number(params.maxRunning) || 1);
  const allRows = getWorkflowTasksByGroup(gf);
  const running = allRows
    .filter((r) => r.status === 'running' && r.stage !== 'DONE' && r.stage !== 'BLOCKED')
    .sort((a, b) => {
      const ta = Date.parse(a.updated_at || '');
      const tb = Date.parse(b.updated_at || '');
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

  let changed = false;
  let staleBlocked = 0;
  let overflowBlocked = 0;
  let keptRunning = 0;
  const blockedTaskIds: string[] = [];
  const keep = new Set(running.slice(0, maxRunning).map((r) => r.task_id));

  for (const row of running) {
    const transitions = getWorkflowTransitions(row.task_id, gf);
    const task = rowToState(row, transitions);
    const updatedAtMs = Date.parse(task.updatedAt || '');
    const ageMs = Number.isFinite(updatedAtMs) ? Math.max(0, now - updatedAtMs) : Number.MAX_SAFE_INTEGER;
    const blockByAge = ageMs >= staleMs;
    const blockByOverflow = !keep.has(task.taskId);
    if (!blockByAge && !blockByOverflow) {
      keptRunning += 1;
      continue;
    }
    const from = task.stage;
    task.stage = 'BLOCKED';
    task.status = 'blocked';
    task.updatedAt = nowIso();
    task.retries += 1;
    task.lastError = blockByAge
      ? `stale running task recovered at boot (ageMs=${ageMs})`
      : `extra running task recovered at boot (maxRunning=${maxRunning})`;
    const reason = blockByAge ? 'boot stale recovery' : 'boot running-overflow recovery';
    insertWorkflowTransition({
      taskId: task.taskId,
      groupFolder: gf,
      fromStage: from,
      toStage: 'BLOCKED',
      reason,
    });
    persistState(gf, task);
    changed = true;
    blockedTaskIds.push(task.taskId);
    if (blockByAge) staleBlocked += 1;
    else overflowBlocked += 1;
  }

  if (changed) writeJsonCache(gf, loadWorkflowState(gf));
  return { changed, staleBlocked, overflowBlocked, keptRunning, blockedTaskIds };
}

export function canEnterDev(groupFolder: string, taskId: string): {
  ok: boolean;
  pendingQuestions: string[];
} {
  const t = getTaskWorkflowState(groupFolder, taskId);
  return { ok: t.pendingQuestions.length === 0, pendingQuestions: t.pendingQuestions };
}

export function canEnterDevByPlanningHistory(groupFolder: string, taskId: string): {
  ok: boolean;
  missing: Array<'PM' | 'SPEC'>;
} {
  const gf = groupFolder || MAIN_GROUP_FOLDER;
  const row = getWorkflowTask(taskId, gf);
  if (!row) return { ok: false, missing: ['PM', 'SPEC'] };
  const transitions = getWorkflowTransitions(taskId, gf);
  const seen = new Set<string>([row.stage]);
  for (const tr of transitions) {
    if (tr.from_stage) seen.add(tr.from_stage);
    if (tr.to_stage) seen.add(tr.to_stage);
  }
  const missing: Array<'PM' | 'SPEC'> = [];
  if (!seen.has('PM')) missing.push('PM');
  if (!seen.has('SPEC')) missing.push('SPEC');
  return { ok: missing.length === 0, missing };
}

function normalizeStage(raw: string): WorkflowStage | null {
  const x = raw.trim().toUpperCase();
  if (x.startsWith('TEAMLEAD') || x.startsWith('TEAM-LEAD')) return 'TEAMLEAD';
  if (x.startsWith('PM')) return 'PM';
  if (x.startsWith('SPEC')) return 'SPEC';
  if (x.startsWith('DEV')) return 'DEV';
  if (x.startsWith('QA')) return 'QA';
  if (x.startsWith('DONE') || x.startsWith('COMPLETED')) return 'DONE';
  if (x.startsWith('BLOCKED') || x.startsWith('BLOQUE')) return 'BLOCKED';
  return null;
}

function parseJsonPromptLine(text: string): Record<string, unknown> | null {
  const t = String(text || '');
  const m = t.match(/^\s*JSONPROMPT\s*:\s*(\{.+\})\s*$/im);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function parseStageContract(text: string): StageContract | null {
  const t = String(text || '');
  const jp = parseJsonPromptLine(t);
  if (jp) {
    const jsonStage = normalizeStage(String(jp.etapa || jp.stage || ''));
    const item = String(jp.item || '').trim();
    const siguiente = String(jp.siguiente || jp.next || '').trim();
    const archivosRaw = jp.archivos;
    const archivos = Array.isArray(archivosRaw)
      ? archivosRaw.map((x) => String(x || '').trim()).filter(Boolean).join(', ')
      : String(archivosRaw || '').trim();
    if (jsonStage && item && siguiente && archivos) {
      return {
        stage: jsonStage,
        item,
        archivos,
        siguiente,
      };
    }
  }

  const mStage = t.match(/^\s*ETAPA:\s*(.+)\s*$/im);
  if (!mStage) return null;
  const stage = normalizeStage(mStage[1]);
  if (!stage) return null;

  const mItem = t.match(/^\s*ITEM:\s*(.+)\s*$/im);
  const mArchivos = t.match(/^\s*ARCHIVOS:\s*(.+)\s*$/im);
  const mSiguiente = t.match(/^\s*SIGUIENTE:\s*(.+)\s*$/im);
  if (!mItem || !mArchivos || !mSiguiente) return null;

  return {
    stage,
    item: mItem[1].trim(),
    archivos: mArchivos[1].trim(),
    siguiente: mSiguiente[1].trim(),
  };
}

export function validateStageContract(text: string): {
  ok: boolean;
  stage?: WorkflowStage;
  missing: string[];
} {
  const t = String(text || '');
  const mStage = t.match(/^\s*ETAPA:\s*(.+)\s*$/im);
  if (!mStage) return { ok: true, missing: [] };

  const stage = normalizeStage(mStage[1]);
  const missing: string[] = [];
  const hasJsonPrompt = /^\s*JSONPROMPT\s*:\s*\{.+\}\s*$/im.test(t);
  const jsonPrompt = parseJsonPromptLine(t);
  if (!stage) missing.push('ETAPA(valid)');
  if (!hasJsonPrompt) {
    missing.push('JSONPROMPT');
  } else if (!jsonPrompt) {
    missing.push('JSONPROMPT(valid-json)');
  } else {
    if (!String(jsonPrompt.etapa || jsonPrompt.stage || '').trim()) missing.push('JSONPROMPT.etapa');
    if (!String(jsonPrompt.item || '').trim()) missing.push('JSONPROMPT.item');
    const archivos = jsonPrompt.archivos;
    const hasArchivos = Array.isArray(archivos)
      ? archivos.some((x) => String(x || '').trim().length > 0)
      : String(archivos || '').trim().length > 0;
    if (!hasArchivos) missing.push('JSONPROMPT.archivos');
    if (!String(jsonPrompt.siguiente || jsonPrompt.next || '').trim()) missing.push('JSONPROMPT.siguiente');
  }
  if (!/^\s*ITEM:\s*.+$/im.test(t)) missing.push('ITEM');
  if (!/^\s*ARCHIVOS:\s*.+$/im.test(t)) missing.push('ARCHIVOS');
  if (!/^\s*SIGUIENTE:\s*.+$/im.test(t)) missing.push('SIGUIENTE');
  if (stage && stage !== 'BLOCKED') {
    if (!/^\s*TDD_(TIPO|TYPE|TDD)\s*:\s*.+$/im.test(t)) missing.push('TDD_TIPO');
    if (!/^\s*(TDD_)?RED\s*:\s*.+$/im.test(t)) missing.push('TDD_RED');
    if (!/^\s*(TDD_)?GREEN\s*:\s*.+$/im.test(t)) missing.push('TDD_GREEN');
    if (!/^\s*(TDD_)?REFACTOR\s*:\s*.+$/im.test(t)) missing.push('TDD_REFACTOR');
  }
  const swarmlogLines = t
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => /^SWARMLOG\s*:?\s*\{[\s\S]*\}\s*$/i.test(x));
  if (swarmlogLines.length === 0) {
    missing.push('SWARMLOG');
  } else {
    const valid = swarmlogLines.some((line) => {
      const m = line.match(/^SWARMLOG\s*:?\s*(\{[\s\S]*\})\s*$/i);
      if (!m) return false;
      try {
        const parsed = JSON.parse(m[1]);
        return !!parsed && typeof parsed === 'object';
      } catch {
        return false;
      }
    });
    if (!valid) missing.push('SWARMLOG(valid-json)');
  }
  return { ok: missing.length === 0, stage: stage || undefined, missing };
}

function taskIdVariants(taskId: string): string[] {
  const up = taskId.trim().toUpperCase();
  const low = up.toLowerCase();
  return [up, low];
}

function ensureFileWithTemplate(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
  return true;
}

export function ensureStageArtifacts(params: {
  groupFolder: string;
  stage: WorkflowStage;
  taskId: string;
}): StageArtifactEnsureResult {
  const created: string[] = [];
  const groupFolder = params.groupFolder || MAIN_GROUP_FOLDER;
  const baseGroupDir = path.join(GROUPS_DIR, groupFolder);
  const taskId = params.taskId.trim().toUpperCase();

  if (params.stage === 'PM') {
    const p = path.join(baseGroupDir, 'todo.md');
    const ok = ensureFileWithTemplate(
      p,
      `# TODO\n\n- [ ] ${taskId}: definir tareas atomicas\n`,
    );
    if (ok) created.push(`groups/${groupFolder}/todo.md`);
  }

  if (params.stage === 'SPEC') {
    const p = path.join(baseGroupDir, 'swarmdev', `spec_${taskId}.md`);
    const ok = ensureFileWithTemplate(
      p,
      `# Spec ${taskId}\n\n## Objetivo\n\n## Alcance\n\n## Criterios de aceptacion\n`,
    );
    if (ok) created.push(`groups/${groupFolder}/swarmdev/spec_${taskId}.md`);
  }

  if (params.stage === 'QA') {
    const p = path.join(baseGroupDir, 'swarmdev', `qa_${taskId}.md`);
    const ok = ensureFileWithTemplate(
      p,
      `# QA ${taskId}\n\n## Comandos\n\n## Resultados\n\n## Riesgos\n`,
    );
    if (ok) created.push(`groups/${groupFolder}/swarmdev/qa_${taskId}.md`);
  }

  return { created };
}

function hasAnyQuestion(text: string): boolean {
  return /\?/.test(String(text || ''));
}

export function validateStageArtifacts(params: {
  groupFolder: string;
  stage: WorkflowStage;
  taskId: string;
  text?: string;
}): StageArtifactValidation {
  const missing: string[] = [];
  const groupFolder = params.groupFolder || MAIN_GROUP_FOLDER;
  const baseGroupDir = path.join(GROUPS_DIR, groupFolder);
  const variants = taskIdVariants(params.taskId);

  if (params.stage === 'PM') {
    const todoPath = path.join(baseGroupDir, 'todo.md');
    if (!fs.existsSync(todoPath)) missing.push(`groups/${groupFolder}/todo.md`);
  }

  if (params.stage === 'SPEC') {
    const matches = variants.some((v) =>
      fs.existsSync(path.join(baseGroupDir, 'swarmdev', `spec_${v}.md`)),
    );
    if (!matches) missing.push(`groups/${groupFolder}/swarmdev/spec_${variants[0]}.md`);
  }

  if (params.stage === 'QA') {
    const matches = variants.some((v) =>
      fs.existsSync(path.join(baseGroupDir, 'swarmdev', `qa_${v}.md`)),
    );
    if (!matches) missing.push(`groups/${groupFolder}/swarmdev/qa_${variants[0]}.md`);
  }

  if (params.stage === 'BLOCKED') {
    if (!hasAnyQuestion(params.text || '')) {
      missing.push('blocked_requires_question');
    }
  }

  return { ok: missing.length === 0, missing };
}
