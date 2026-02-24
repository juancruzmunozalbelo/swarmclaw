/**
 * Todo Manager — todo.md parsing, task tracking, state updates, and auto-tracking.
 * Extracted from index.ts during Sprint 1 decomposition.
 */
import fs, { promises as fsp } from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { upsertWorkflowTask, getWorkflowTask } from './db.js';
import { ownerFromStageHint } from './prompt-builder.js';
import { normalizeScope } from './text-helpers.js';
import { KeyedMutex } from './mutex.js';

export const todoMutex = new KeyedMutex();

export function parseTodoTaskContext(groupFolder: string, taskId: string): {
    owner: string;
    scope: string;
    state: string;
} | null {
    const needle = String(taskId || '').trim().toUpperCase();
    if (!needle) return null;

    // SQLite-first read
    const row = getWorkflowTask(needle, groupFolder);
    if (row) {
        return {
            owner: '',  // owner not stored in workflow_tasks (file-only field)
            scope: '',  // scope not stored in workflow_tasks (file-only field)
            state: row.status === 'blocked' ? 'blocked' : row.status === 'done' ? 'done' : row.stage.toLowerCase(),
        };
    }

    // Fallback: parse todo.md
    const todoPath = path.join(GROUPS_DIR, groupFolder, 'todo.md');
    if (!fs.existsSync(todoPath)) return null;

    const raw = fs.readFileSync(todoPath, 'utf-8');
    const lines = raw.split('\n');
    let found = false;
    let owner = '';
    let scope = '';
    let state = '';

    for (const line of lines) {
        const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
        if (idm) {
            if (found) break;
            if (String(idm[1]).toUpperCase() === needle) found = true;
            continue;
        }
        if (!found) continue;
        const owm = line.match(/^\s*Owner:\s*(.*)$/i);
        if (owm) { owner = String(owm[1]).trim(); continue; }
        const scm = line.match(/^\s*Scope:\s*(.*)$/i);
        if (scm) { scope = String(scm[1]).trim(); continue; }
        const stm = line.match(/^\s*Estado:\s*(.*)$/i);
        if (stm) { state = String(stm[1]).trim().toLowerCase(); continue; }
    }
    if (!found) return null;
    return { owner, scope, state };
}

export function shouldAutoTrackScope(scope: string): boolean {
    if (!scope) return false;
    const s = scope.toLowerCase();
    if (s.length < 8) return false;
    if (/^(status|ping|ok|dale|si|sí|no|hola|gracias|jaja)\b/.test(s)) return false;
    return true;
}

export async function ensureTodoTracking(params: {
    groupFolder: string;
    stageHint: string;
    taskIds: string[];
    messageScope: string;
}): Promise<string[]> {
    const release = await todoMutex.acquire(params.groupFolder);
    try {
        const todoPath = path.join(GROUPS_DIR, params.groupFolder, 'todo.md');
        const created: string[] = [];
        const owner = ownerFromStageHint(params.stageHint);
        const scope = normalizeScope(params.messageScope);

        let base = '# TODO (SwarmDev)\n\n';
        try { base = await fsp.readFile(todoPath, 'utf-8'); } catch { /* ignore */ }
        const existing = new Set<string>();
        for (const m of base.matchAll(/^- ID:\s*([A-Z]+-\d+)\s*$/gm)) {
            existing.add(String(m[1]).toUpperCase());
        }

        let next = base;
        if (!next.includes('## Auto Inbox')) {
            if (!next.endsWith('\n')) next += '\n';
            next += '\n## Auto Inbox\n';
        }
        if (!next.endsWith('\n')) next += '\n';

        const appendItem = (id: string, itemScope: string) => {
            next +=
                `- ID: ${id}\n` +
                `  Owner: ${owner}\n` +
                `  Scope: ${itemScope || 'n/a'}\n` +
                `  Entregable: n/a\n` +
                `  Tests: n/a\n` +
                `  Estado: planning\n\n`;
            existing.add(id);
            created.push(id);
        };

        for (const raw of params.taskIds) {
            const id = String(raw || '').trim().toUpperCase();
            if (!id || !/^[A-Z]+-\d+$/.test(id)) continue;
            if (existing.has(id)) continue;
            appendItem(id, scope || `Task ${id}`);
        }

        if (params.taskIds.length === 0 && shouldAutoTrackScope(scope)) {
            const duplicatedScope = next.toLowerCase().includes(`scope: ${scope.toLowerCase()}`);
            if (!duplicatedScope) {
                const autoId = `REQ-${Date.now().toString().slice(-6)}`;
                appendItem(autoId, scope);
            }
        }

        if (created.length > 0) {
            await fsp.mkdir(path.dirname(todoPath), { recursive: true });
            const tmp = `${todoPath}.tmp`;
            await fsp.writeFile(tmp, next, 'utf-8');
            await fsp.rename(tmp, todoPath);
        }
        return created;
    } finally {
        release();
    }
}

export function normalizeTodoStateValue(raw: string): 'planning' | 'todo' | 'doing' | 'blocked' | 'done' {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'pending') return 'todo';
    if (v === 'in_progress' || v === 'in-progress' || v === 'inprogress') return 'doing';
    if (v === 'completed' || v === 'complete') return 'done';
    if (v === 'planning' || v === 'todo' || v === 'doing' || v === 'blocked' || v === 'done') return v;
    return 'todo';
}

function depsFromRaw(raw: string): string[] {
    return String(raw || '')
        .split(',')
        .map((x) => x.trim().toUpperCase())
        .filter((x) => /^[A-Z]+-\d+$/.test(x));
}

export function parseTodoMeta(lines: string[]): Array<{
    id: string;
    start: number;
    end: number;
    state: string;
    deps: string[];
    stateLines: number[];
}> {
    const idRe = /^- ID:\s*([A-Z]+-\d+)\s*$/;
    const out: Array<{
        id: string;
        start: number;
        end: number;
        state: string;
        deps: string[];
        stateLines: number[];
    }> = [];
    let cur: (typeof out)[number] | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const idm = line.match(idRe);
        if (idm) {
            if (cur) {
                cur.end = i - 1;
                out.push(cur);
            }
            cur = {
                id: String(idm[1]).toUpperCase(),
                start: i,
                end: i,
                state: 'todo',
                deps: [],
                stateLines: [],
            };
            continue;
        }
        if (!cur) continue;
        const stm = line.match(/^\s*Estado:\s*(.*)\s*$/i);
        if (stm) {
            cur.state = normalizeTodoStateValue(stm[1]);
            cur.stateLines.push(i);
            continue;
        }
        const depm = line.match(/^\s*Dependencias:\s*(.*)\s*$/i);
        if (depm) {
            cur.deps = depsFromRaw(depm[1]);
        }
    }
    if (cur) {
        cur.end = lines.length - 1;
        out.push(cur);
    }
    return out;
}

export async function setTodoState(params: {
    groupFolder: string;
    taskId: string;
    state: 'planning' | 'todo' | 'doing' | 'blocked' | 'done';
    skipAutoAdvance?: boolean;
}): Promise<boolean> {
    const release = await todoMutex.acquire(params.groupFolder);
    try {
        return await _setTodoState(params);
    } finally {
        release();
    }
}
/**
 * INTERNAL — Do NOT call directly outside of this module.
 * This function performs the actual read-modify-write on todo.md WITHOUT acquiring
 * the mutex. It MUST only be called from within `setTodoState()` (which holds the
 * lock) or from itself for auto-advance recursion.
 *
 * Calling this from any other context will bypass the mutex and cause lost updates.
 * @internal
 */
async function _setTodoState(params: {
    groupFolder: string;
    taskId: string;
    state: 'planning' | 'todo' | 'doing' | 'blocked' | 'done';
    skipAutoAdvance?: boolean;
}): Promise<boolean> {
    const todoPath = path.join(GROUPS_DIR, params.groupFolder, 'todo.md');
    let content = '';
    try { content = await fsp.readFile(todoPath, 'utf-8'); } catch { return false; }
    const taskId = String(params.taskId || '').trim().toUpperCase();
    if (!taskId) return false;

    const lines = content.split('\n');
    const items = parseTodoMeta(lines);
    const item = items.find((x) => x.id === taskId);
    if (!item) return false;

    const target = normalizeTodoStateValue(params.state);
    if (item.stateLines.length > 0) {
        const stateLine = item.stateLines[0];
        const cur = lines[stateLine];
        const m = cur.match(/^(\s*)Estado:\s*(.*)$/);
        const indent = m?.[1] || '  ';
        const prev = normalizeTodoStateValue(m?.[2] || '');
        if (prev === target) return false;
        lines[stateLine] = `${indent}Estado: ${target}`;
        // Hygiene: keep a single Estado line per task block.
        if (item.stateLines.length > 1) {
            for (let i = item.stateLines.length - 1; i >= 1; i--) {
                lines.splice(item.stateLines[i], 1);
            }
        }
    } else {
        const insertAt = Math.min(item.end + 1, lines.length);
        lines.splice(insertAt, 0, `  Estado: ${target}`);
    }

    const tmp = `${todoPath}.tmp`;
    await fsp.writeFile(tmp, lines.join('\n'), 'utf-8');
    await fsp.rename(tmp, todoPath);

    // Dual-write: sync state to SQLite
    try {
        const stageMap: Record<string, string> = {
            planning: 'TEAMLEAD',
            todo: 'TEAMLEAD',
            doing: 'DEV',
            blocked: 'BLOCKED',
            done: 'DONE',
        };
        upsertWorkflowTask({
            taskId,
            groupFolder: params.groupFolder,
            stage: stageMap[target] || 'TEAMLEAD',
            status: target === 'blocked' ? 'blocked' : target === 'done' ? 'done' : 'running',
            retries: 0,
            pendingQuestions: [],
            decisions: [],
        });
    } catch {
        // SQLite sync is best-effort in Phase 1
    }

    // Auto-next: when a task is marked done, move first dependency-unlocked task to doing.
    if (target === 'done' && !params.skipAutoAdvance) {
        let freshContent = '';
        try { freshContent = await fsp.readFile(todoPath, 'utf-8'); } catch { return false; }
        const freshLines = freshContent.split('\n');
        const fresh = parseTodoMeta(freshLines);
        const byId = new Map<string, (typeof fresh)[number]>();
        for (const row of fresh) byId.set(row.id, row);
        const completed = taskId;
        let nextId = '';
        for (const row of fresh) {
            if (row.id === completed) continue;
            if (row.state === 'done' || row.state === 'doing' || row.state === 'blocked') continue;
            if (row.deps.length === 0) continue;
            if (!row.deps.includes(completed)) continue;
            const allDepsDone = row.deps.every((d) => (byId.get(d)?.state || 'todo') === 'done');
            if (!allDepsDone) continue;
            nextId = row.id;
            break;
        }
        if (nextId) {
            try {
                await _setTodoState({
                    groupFolder: params.groupFolder,
                    taskId: nextId,
                    state: 'doing',
                    skipAutoAdvance: true,
                });
            } catch {
                // ignore auto-advance failures
            }
        }
    }
    return true;
}

export function pendingTodoIdsForEpic(groupFolder: string, epicTaskId: string): string[] {
    const todoPath = path.join(GROUPS_DIR, groupFolder, 'todo.md');
    if (!fs.existsSync(todoPath)) return [];
    const epic = String(epicTaskId || '').trim().toUpperCase();
    if (!epic) return [];
    const prefix = epic.split('-')[0] || '';
    if (!prefix) return [];

    const lines = fs.readFileSync(todoPath, 'utf-8').split('\n');
    const out: string[] = [];
    let curId = '';
    let curState = '';

    const flush = () => {
        if (!curId) return;
        const upper = curId.toUpperCase();
        if (upper === epic) return;
        if (!upper.startsWith(`${prefix}-`)) return;
        if (curState === 'done') return;
        out.push(upper);
    };

    for (const raw of lines) {
        const idm = raw.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
        if (idm) {
            flush();
            curId = String(idm[1] || '').toUpperCase();
            curState = '';
            continue;
        }
        const stm = raw.match(/^\s*Estado:\s*(.*)\s*$/i);
        if (stm) {
            curState = String(stm[1] || '').trim().toLowerCase();
        }
    }
    flush();
    return out;
}

export function collectPendingRelatedTasks(groupFolder: string, taskIds: string[]): string[] {
    const unique = new Set<string>();
    for (const raw of taskIds) {
        const id = String(raw || '').trim().toUpperCase();
        if (!id) continue;
        for (const p of pendingTodoIdsForEpic(groupFolder, id)) unique.add(p);
    }
    return [...unique];
}

/**
 * Parse todo.md for a group and return DagTask[] for the DAG scheduler.
 * Only includes tasks matching the provided taskIds (plus their transitive deps).
 * Returns empty array if todo.md doesn't exist or has no matching tasks.
 */
export function parseTodoDag(groupFolder: string, taskIds: string[]): import('./task-dag.js').DagTask[] {
    const todoPath = path.join(GROUPS_DIR, groupFolder, 'todo.md');
    if (!fs.existsSync(todoPath)) return [];
    try {
        const content = fs.readFileSync(todoPath, 'utf-8');
        const lines = content.split('\n');
        const meta = parseTodoMeta(lines);
        const metaById = new Map(meta.map((m) => [m.id, m]));
        const relevant = new Set(taskIds.map((t) => t.trim().toUpperCase()));
        // Recursively expand: collect transitive dependencies
        let changed = true;
        while (changed) {
            changed = false;
            for (const id of relevant) {
                const m = metaById.get(id);
                if (!m) continue;
                for (const dep of m.deps) {
                    if (!relevant.has(dep)) {
                        relevant.add(dep);
                        changed = true;
                    }
                }
            }
        }
        return meta
            .filter((m) => relevant.has(m.id))
            .map((m) => ({
                id: m.id,
                state: normalizeTodoStateValue(m.state),
                deps: m.deps,
            }));
    } catch {
        return [];
    }
}
