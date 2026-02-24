import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER } from './config.js';

type TodoState = 'planning' | 'todo' | 'queued' | 'doing' | 'blocked' | 'done';
type Priority = 'P0' | 'P1' | 'P2';

type TodoItem = {
  id: string;
  owner: string;
  scope: string;
  entregable: string;
  tests: string;
  estado: TodoState;
  dependencias: string;
};

function sanitizeScope(raw: string): string {
  let v = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/\b(ETAPA|ITEM|ARCHIVOS|SIGUIENTE|STATUS|URL_PUBLIC|CHECK_LOCAL|CHECK_PUBLIC|CHECK_CONTENT|LAST_LOG)\s*[:=]/gi, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/[•·▪◦●]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = v
    .split(/[.!?;]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 16);
  v = (parts[0] || v).trim();
  if (!v) return 'Tarea operativa del ciclo actual';
  return v.slice(0, 140);
}

const CRITICAL_P0 = new Set([
  'PROD-012',
  'PROD-034',
  'PROD-035',
  'PROD-037',
  'PROD-042',
  'PROD-075',
  'PROD-081',
]);

function normalizeState(raw: string): TodoState {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'in_progress' || v === 'in-progress' || v === 'inprogress') return 'doing';
  if (v === 'pending') return 'todo';
  if (v === 'completed' || v === 'complete') return 'done';
  if (v === 'planning' || v === 'todo' || v === 'queued' || v === 'doing' || v === 'blocked' || v === 'done') {
    return v;
  }
  return 'todo';
}

function itemPriority(id: string): Priority {
  const up = id.toUpperCase();
  if (CRITICAL_P0.has(up)) return 'P0';
  if (/^PROD-(07\d|08\d|09\d)$/.test(up)) return 'P1';
  return 'P2';
}

function stateRank(state: TodoState): number {
  if (state === 'doing') return 0;
  if (state === 'blocked') return 1;
  if (state === 'queued') return 2;
  if (state === 'planning') return 3;
  if (state === 'todo') return 4;
  return 9;
}

function priorityRank(p: Priority): number {
  if (p === 'P0') return 0;
  if (p === 'P1') return 1;
  return 2;
}

function idNumber(id: string): number {
  const m = id.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

function parseItems(text: string): TodoItem[] {
  const lines = String(text || '').split('\n');
  const items: TodoItem[] = [];
  let cur: TodoItem | null = null;

  const flush = () => {
    if (!cur) return;
    items.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
    if (idm) {
      flush();
      cur = {
        id: String(idm[1]).toUpperCase(),
        owner: 'team-lead',
        scope: 'n/a',
        entregable: 'n/a',
        tests: 'n/a',
        estado: 'todo',
        dependencias: 'n/a',
      };
      continue;
    }
    if (!cur) continue;
    const owner = line.match(/^\s*Owner:\s*(.+)\s*$/i);
    if (owner) cur.owner = owner[1].trim();
    const scope = line.match(/^\s*Scope:\s*(.+)\s*$/i);
    if (scope) cur.scope = sanitizeScope(scope[1].trim());
    const entregable = line.match(/^\s*Entregable:\s*(.+)\s*$/i);
    if (entregable) cur.entregable = entregable[1].trim();
    const tests = line.match(/^\s*Tests:\s*(.+)\s*$/i);
    if (tests) cur.tests = tests[1].trim();
    const estado = line.match(/^\s*Estado:\s*(.+)\s*$/i);
    if (estado) cur.estado = normalizeState(estado[1]);
    const deps = line.match(/^\s*Dependencias:\s*(.+)\s*$/i);
    if (deps) cur.dependencias = deps[1].trim();
  }
  flush();
  return items;
}

function renderItem(item: TodoItem, priority: Priority): string {
  return [
    `- ID: ${item.id}`,
    `  Priority: ${priority}`,
    `  Owner: ${item.owner}`,
    `  Scope: ${item.scope || 'n/a'}`,
    `  Entregable: ${item.entregable || 'n/a'}`,
    `  Tests: ${item.tests || 'n/a'}`,
    `  Dependencias: ${item.dependencias || 'n/a'}`,
    `  Estado: ${item.estado}`,
    '',
  ].join('\n');
}

export function normalizeTodoFile(groupFolder: string): { changed: boolean; kept: number; removed: number } {
  const folder = groupFolder || MAIN_GROUP_FOLDER;
  const todoPath = path.join(GROUPS_DIR, folder, 'todo.md');
  if (!fs.existsSync(todoPath)) return { changed: false, kept: 0, removed: 0 };

  const original = fs.readFileSync(todoPath, 'utf-8');
  const parsed = parseItems(original);
  if (parsed.length === 0) return { changed: false, kept: 0, removed: 0 };

  const kept = parsed.filter((x) => /^(PROD|ECOM|REQ|MKT|CNT|EQ|LAND)-\d+$/i.test(x.id));
  const removed = Math.max(0, parsed.length - kept.length);
  const active = kept.filter((x) => x.estado !== 'done');
  const done = kept.filter((x) => x.estado === 'done');

  active.sort((a, b) => {
    const ra = stateRank(a.estado);
    const rb = stateRank(b.estado);
    if (ra !== rb) return ra - rb;
    const pa = priorityRank(itemPriority(a.id));
    const pb = priorityRank(itemPriority(b.id));
    if (pa !== pb) return pa - pb;
    return idNumber(a.id) - idNumber(b.id);
  });
  done.sort((a, b) => idNumber(a.id) - idNumber(b.id));

  const doneIds = done.map((x) => x.id).join(', ') || 'n/a';
  let next = '';
  next += '# TODO (SwarmDev)\n\n';
  next += 'Formato por item:\n';
  next += '- ID:\n- Priority: P0|P1|P2\n- Owner:\n- Scope:\n- Entregable:\n- Tests:\n- Dependencias:\n- Estado: `planning | todo | queued | doing | blocked | done`\n\n';
  next += '## Backlog Activo (Ecommerce)\n';
  for (const item of active) next += renderItem(item, itemPriority(item.id));
  if (active.length === 0) next += '- (sin tareas activas)\n\n';
  next += '## Completadas (Ecommerce)\n';
  next += `- IDs done: ${doneIds}\n\n`;
  next += '## Nota\n';
  next += '- Este archivo se normaliza automáticamente: IDs `ECOM-*`, `PROD-*`, `REQ-*`, `MKT-*`, `CNT-*`, `EQ-*`, `LAND-*`.\n';

  if (next === original) return { changed: false, kept: kept.length, removed };
  const tmp = `${todoPath}.tmp`;
  fs.writeFileSync(tmp, next, 'utf-8');
  fs.renameSync(tmp, todoPath);

  // Garbage-collect old .bak-* files, keeping only the most recent 3
  try {
    const dir = path.dirname(todoPath);
    const base = path.basename(todoPath);
    const bakFiles = fs.readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.bak`))
      .sort()
      .reverse();
    for (const bak of bakFiles.slice(3)) {
      try { fs.unlinkSync(path.join(dir, bak)); } catch { /* ignore */ }
    }
  } catch {
    // ignore cleanup errors
  }

  return { changed: true, kept: kept.length, removed };
}
