#!/usr/bin/env npx tsx
import fs from 'fs';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

interface TodoItem {
    id: string;
    owner: string;
    scope: string;
    state: string;
}

interface TasksState {
    version: number;
    updatedAt: string;
    source: string;
    items: TodoItem[];
}

interface ActionRow {
    ts: string;
    action: string;
    stage: string;
    detail: string;
    files?: string[];
    meta?: Record<string, unknown>;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || '';
const ROOT = process.env.NANOCLAW_ROOT || path.join(HOME, 'nanoclaw');
const GROUP = process.env.KANBAN_RENDER_GROUP || 'main';

const TODO_PATH = path.join(ROOT, 'groups', GROUP, 'todo.md');
const TASKS_STATE_PATH = path.join(ROOT, 'groups', GROUP, 'swarmdev', 'tasks-state.json');
const ACTIONS_PATH = path.join(ROOT, 'groups', GROUP, 'swarmdev', 'actions.jsonl');

// ── Utility functions ──────────────────────────────────────────────────────

function nowIso(): string {
    return new Date().toISOString();
}

export function normalizeState(raw: string): string {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'pending') return 'todo';
    if (v === 'queue' || v === 'queued') return 'queued';
    if (v === 'working') return 'doing';
    if (v === 'in_progress' || v === 'in-progress' || v === 'inprogress') return 'doing';
    if (v === 'completed' || v === 'complete') return 'done';
    if (v === 'failed') return 'failed';
    if (['planning', 'todo', 'queued', 'doing', 'blocked', 'done', 'failed'].includes(v)) return v;
    return 'todo';
}

export function parseTodo(md: string): TodoItem[] {
    const lines = String(md || '').split('\n');
    const out: TodoItem[] = [];
    let cur: TodoItem | null = null;
    for (const line of lines) {
        const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
        if (idm) {
            if (cur?.id) out.push(cur);
            cur = { id: String(idm[1] || '').toUpperCase(), owner: 'team-lead', scope: '', state: 'todo' };
            continue;
        }
        if (!cur) continue;
        const owner = line.match(/^\s*Owner:\s*(.*)\s*$/);
        if (owner) { const o = String(owner[1] || '').trim(); if (o) cur.owner = o; continue; }
        const scope = line.match(/^\s*Scope:\s*(.*)\s*$/);
        if (scope) { cur.scope = String(scope[1] || '').trim(); continue; }
        const st = line.match(/^\s*Estado:\s*(.*)\s*$/);
        if (st) { cur.state = normalizeState(st[1]); continue; }
    }
    if (cur?.id) out.push(cur);
    return out;
}

function safeReadJson<T>(p: string, fallback: T): T {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
    } catch {
        return fallback;
    }
}

function writeJsonAtomic(p: string, obj: unknown): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, p);
}

function appendAction(row: ActionRow): void {
    fs.mkdirSync(path.dirname(ACTIONS_PATH), { recursive: true });
    fs.appendFileSync(ACTIONS_PATH, `${JSON.stringify(row)}\n`, 'utf-8');
}

function sameItems(a: unknown, b: unknown): boolean {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

// ── Main ───────────────────────────────────────────────────────────────────

function run(): void {
    if (!fs.existsSync(TODO_PATH)) return;
    const todo = parseTodo(fs.readFileSync(TODO_PATH, 'utf-8'));
    const next: TasksState = { version: 1, updatedAt: nowIso(), source: 'todo.md', items: todo };
    const prev = safeReadJson<TasksState | null>(TASKS_STATE_PATH, null);
    const prevItems = Array.isArray(prev?.items) ? prev!.items : [];
    if (sameItems(prevItems, next.items)) return;

    writeJsonAtomic(TASKS_STATE_PATH, next);
    appendAction({
        ts: nowIso(),
        action: 'kanban_render',
        stage: 'DASH',
        detail: `kanban re-render from todo.md (${todo.length} items)`,
        files: [`groups/${GROUP}/todo.md`, `groups/${GROUP}/swarmdev/tasks-state.json`],
        meta: { items: todo.length },
    });
}

run();
