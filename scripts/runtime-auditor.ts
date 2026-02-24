#!/usr/bin/env npx tsx
import fs from 'fs';
import path from 'path';

// ── Paths ──────────────────────────────────────────────────────────────────
const HOME = process.env.HOME || '';
const ROOT = process.env.NANOCLAW_ROOT || path.join(HOME, 'nanoclaw');
const GROUP = process.env.RUNTIME_AUDITOR_GROUP || 'main';
const AUDIT_INTERVAL_COOLDOWN_MS = Number(process.env.RUNTIME_AUDITOR_NUDGE_COOLDOWN_MS || 5 * 60 * 1000);
const AUTOFIX_CARDS = String(process.env.RUNTIME_AUDITOR_AUTOFIX_CARDS || '1').trim() !== '0';

const TODO_PATH = path.join(ROOT, 'groups', GROUP, 'todo.md');
const SWARMDEV_DIR = path.join(ROOT, 'groups', GROUP, 'swarmdev');
const TASKS_STATE_PATH = path.join(SWARMDEV_DIR, 'tasks-state.json');
const ACTIONS_PATH = path.join(SWARMDEV_DIR, 'actions.jsonl');
const AUDIT_PATH = path.join(SWARMDEV_DIR, 'runtime-audit.json');
const IPC_INPUT_DIR = path.join(ROOT, 'data', 'ipc', GROUP, 'input');
const STATE_PATH = path.join(ROOT, 'store', 'runtime-auditor.json');

// ── Types ──────────────────────────────────────────────────────────────────

interface TodoCard {
    id: string;
    owner: string;
    scope: string;
    entregable: string;
    tests: string;
    state: string;
}

interface CardTemplate {
    scope: string;
    entregable: string;
    tests: string;
    descripcion: string;
    criterios: string;
    tdd: string;
}

interface AuditIssue {
    severity: 'critical' | 'warn';
    type: string;
    taskId: string;
    detail: string;
}

interface ActionRow {
    ts: string;
    action: string;
    stage: string;
    detail: string;
    files?: string[];
    meta?: Record<string, unknown>;
}

interface EnhanceResult {
    md: string;
    fixed: number;
    tasks: string[];
}

interface AuditReport {
    generatedAt: string;
    group: string;
    summary: { totalTasks: number; issues: number; critical: number; warn: number };
    issues: AuditIssue[];
}

// ── Utility functions ──────────────────────────────────────────────────────

function nowIso(): string {
    return new Date().toISOString();
}

function parseIsoMs(v: string | undefined | null): number | null {
    const ms = Date.parse(String(v || ''));
    return Number.isFinite(ms) ? ms : null;
}

function readJson<T>(p: string, fallback: T): T {
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

function enqueueNudge(text: string): void {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const file = path.join(IPC_INPUT_DIR, `${Date.now()}-runtime-auditor.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ type: 'message', text }), 'utf-8');
    fs.renameSync(tmp, file);
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

export function parseTodo(md: string): TodoCard[] {
    const lines = String(md || '').split('\n');
    const out: TodoCard[] = [];
    let cur: TodoCard | null = null;
    for (const line of lines) {
        const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
        if (idm) {
            if (cur?.id) out.push(cur);
            cur = { id: String(idm[1] || '').toUpperCase(), owner: '', scope: '', entregable: '', tests: '', state: 'todo' };
            continue;
        }
        if (!cur) continue;
        const own = line.match(/^\s*Owner:\s*(.*)\s*$/);
        if (own) { cur.owner = String(own[1] || '').trim(); continue; }
        const scope = line.match(/^\s*Scope:\s*(.*)\s*$/);
        if (scope) { cur.scope = String(scope[1] || '').trim(); continue; }
        const ent = line.match(/^\s*Entregable:\s*(.*)\s*$/);
        if (ent) { cur.entregable = String(ent[1] || '').trim(); continue; }
        const tests = line.match(/^\s*Tests:\s*(.*)\s*$/);
        if (tests) { cur.tests = String(tests[1] || '').trim(); continue; }
        const st = line.match(/^\s*Estado:\s*(.*)\s*$/);
        if (st) { cur.state = normalizeState(st[1]); continue; }
    }
    if (cur?.id) out.push(cur);
    return out;
}

export function inferCardType(taskId: string, scope: string): string {
    const id = String(taskId || '').toUpperCase();
    const s = String(scope || '').toLowerCase();
    if (/\bdeploy|cloudflare|subdominio|tunnel|infra|runtime|watchdog|health\b/.test(s)) return 'devops';
    if (/\bapi|backend|db|postgres|auth|jwt|endpoint|server\b/.test(s)) return 'backend';
    if (/\bqa|test|tests|regresion|bug\b/.test(s)) return 'qa';
    if (/\bui|ux|front|svelte|page|pantalla|kanban|dashboard\b/.test(s)) return 'frontend';
    if (/^MKT-\d+$/i.test(id) || /^ECOM-\d+$/i.test(id) || /^LAND-\d+$/i.test(id)) return 'frontend';
    if (/^CNT-\d+$/i.test(id) || /^EQ-\d+$/i.test(id)) return 'backend';
    if (/^REQ-\d+$/i.test(id)) return 'software';
    return 'software';
}

export function templateForType(type: string, taskId: string): CardTemplate {
    if (type === 'frontend') {
        return {
            scope: `Implementar ${taskId} en frontend con alcance verificable y sin mocks en flujo principal`,
            entregable: `Ruta/componente actualizado para ${taskId} con estados loading/error/empty`,
            tests: `npm run build && npm run test -- ${taskId}`,
            descripcion: `Cambio de interfaz y flujo de usuario para ${taskId}, con comportamiento consistente y medible.`,
            criterios: `Debe renderizar datos reales; Debe manejar loading/error; Debe actualizar estado en kanban`,
            tdd: `frontend: RED=flujo incompleto; GREEN=flujo visible y funcional; REFACTOR=mejora UX/accesibilidad`,
        };
    }
    if (type === 'backend') {
        return {
            scope: `Implementar ${taskId} en backend con contrato de datos y validaciones`,
            entregable: `Endpoint/servicio para ${taskId} con contrato y manejo de errores`,
            tests: `npm run build && npm run test -- ${taskId}`,
            descripcion: `Implementacion de logica de negocio para ${taskId} con contrato reproducible.`,
            criterios: `Debe validar input; Debe devolver contrato estable; Debe registrar errores de forma trazable`,
            tdd: `backend: RED=caso falla reproducible; GREEN=caso pasa con test; REFACTOR=simplificar sin romper contrato`,
        };
    }
    if (type === 'devops') {
        return {
            scope: `Resolver ${taskId} de deploy/infra con verificacion local y publica`,
            entregable: `Servicio operativo con URL publica estable y healthchecks en verde`,
            tests: `curl local + curl URL_PUBLIC + verificacion de contenido`,
            descripcion: `Ajuste de runtime/deploy para ${taskId} con trazabilidad de estado.`,
            criterios: `CHECK_LOCAL=ok; CHECK_PUBLIC=ok; CHECK_CONTENT=ok`,
            tdd: `devops: RED=servicio caido/no publico; GREEN=servicio estable; REFACTOR=hardening de monitoreo`,
        };
    }
    if (type === 'qa') {
        return {
            scope: `Validar ${taskId} con pruebas funcionales y de regresion`,
            entregable: `Reporte QA con casos ejecutados y evidencias`,
            tests: `npm run test && checklist de regresion de ${taskId}`,
            descripcion: `Validacion sistematica de ${taskId} para prevenir regresiones.`,
            criterios: `Debe cubrir happy path; Debe cubrir edge cases; Debe reportar severidad`,
            tdd: `qa: RED=falla reproducida; GREEN=fix validado; REFACTOR=estabilizar suite`,
        };
    }
    return {
        scope: `Implementar ${taskId} como tarea de software con alcance verificable`,
        entregable: `Cambio de codigo y evidencia reproducible para ${taskId}`,
        tests: `npm run build && npm run test`,
        descripcion: `Ejecucion tecnica de ${taskId} con criterio de done objetivo.`,
        criterios: `Debe tener entregable verificable; Debe incluir test reproducible; Debe actualizar estado real`,
        tdd: `software: RED=gap inicial; GREEN=resultado validado; REFACTOR=mejora sin romper`,
    };
}

export function isGenericScope(scope: string): boolean {
    const s = String(scope || '').trim().toLowerCase();
    if (!s || s === 'n/a' || s === 'na' || s === '-' || s === 'tbd' || s === 'none') return true;
    if (/[a-z]{3,}/i.test(s)) {
        return /^(analizar estado|verificando estado|task pendiente|tarea pendiente|scope generico|por definir)$/.test(s);
    }
    return true;
}

export function isMissingEvidenceField(v: string): boolean {
    const s = String(v || '').trim().toLowerCase();
    return !s || s === 'n/a' || s === 'na' || s === '-' || s === 'none';
}

export function enhanceTodoCards(md: string): EnhanceResult {
    const lines = String(md || '').split('\n');
    interface Block { id: string; start: number; end: number }
    const blocks: Block[] = [];
    let cur: Block | null = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const idm = line.match(/^- ID:\s*([A-Z]+-\d+)\s*$/);
        if (idm) {
            if (cur) cur.end = i - 1;
            cur = { id: String(idm[1] || '').toUpperCase(), start: i, end: lines.length - 1 };
            blocks.push(cur);
        }
    }
    if (blocks.length === 0) return { md, fixed: 0, tasks: [] };

    let fixed = 0;
    const touchedTasks = new Set<string>();
    for (const b of blocks.reverse()) {
        const section = lines.slice(b.start, b.end + 1);
        const find = (k: string): number => section.findIndex((x) => new RegExp(`^\\s*${k}:\\s*`, 'i').test(x));
        const stateIdx = find('Estado');
        const scopeIdx = find('Scope');
        const entregableIdx = find('Entregable');
        const testsIdx = find('Tests');
        const descripcionIdx = find('Descripcion');
        const criteriosIdx = find('Criterios');
        const tddIdx = find('TDD');
        const state = stateIdx >= 0 ? normalizeState(section[stateIdx].replace(/^\s*Estado:\s*/i, '')) : 'todo';
        const scope = scopeIdx >= 0 ? section[scopeIdx].replace(/^\s*Scope:\s*/i, '').trim() : '';
        const type = inferCardType(b.id, scope);
        const tpl = templateForType(type, b.id);

        if (state !== 'done') {
            if (scopeIdx >= 0 && isGenericScope(scope)) {
                section[scopeIdx] = `  Scope: ${tpl.scope}`;
                fixed++;
                touchedTasks.add(b.id);
            }
            if (entregableIdx >= 0 && isMissingEvidenceField(section[entregableIdx].replace(/^\s*Entregable:\s*/i, ''))) {
                section[entregableIdx] = `  Entregable: ${tpl.entregable}`;
                fixed++;
                touchedTasks.add(b.id);
            }
            if (testsIdx >= 0 && isMissingEvidenceField(section[testsIdx].replace(/^\s*Tests:\s*/i, ''))) {
                section[testsIdx] = `  Tests: ${tpl.tests}`;
                fixed++;
                touchedTasks.add(b.id);
            }
        }

        if (descripcionIdx < 0) {
            const at = scopeIdx >= 0 ? scopeIdx + 1 : Math.max(1, section.length - 1);
            section.splice(at, 0, `  Descripcion: ${tpl.descripcion}`);
            fixed++;
            touchedTasks.add(b.id);
        }
        if (criteriosIdx < 0) {
            const at = Math.min(section.length, (find('Descripcion') >= 0 ? find('Descripcion') + 1 : 2));
            section.splice(at, 0, `  Criterios: ${tpl.criterios}`);
            fixed++;
            touchedTasks.add(b.id);
        }
        if (tddIdx < 0) {
            const at = Math.min(section.length, (find('Tests') >= 0 ? find('Tests') + 1 : section.length));
            section.splice(at, 0, `  TDD: ${tpl.tdd}`);
            fixed++;
            touchedTasks.add(b.id);
        }

        lines.splice(b.start, b.end - b.start + 1, ...section);
    }

    return { md: lines.join('\n'), fixed, tasks: [...touchedTasks].sort() };
}

function buildTasksStateMap(): Map<string, string> {
    const raw = readJson<Record<string, unknown>>(TASKS_STATE_PATH, {});
    const arr = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as Record<string, unknown>)?.tasks)
            ? (raw as Record<string, unknown>).tasks as Record<string, unknown>[]
            : [];
    const map = new Map<string, string>();
    for (const row of arr) {
        const r = row as Record<string, unknown>;
        const id = String(r?.id || r?.taskId || '').trim().toUpperCase();
        if (!id) continue;
        map.set(id, normalizeState(String(r?.state || r?.status || 'todo')));
    }
    return map;
}

// ── Main ───────────────────────────────────────────────────────────────────

function run(): void {
    if (!fs.existsSync(TODO_PATH)) return;
    let todoRaw = fs.readFileSync(TODO_PATH, 'utf-8');
    if (AUTOFIX_CARDS) {
        const enhanced = enhanceTodoCards(todoRaw);
        if (enhanced.fixed > 0) {
            const tmp = `${TODO_PATH}.tmp`;
            fs.writeFileSync(tmp, enhanced.md, 'utf-8');
            fs.renameSync(tmp, TODO_PATH);
            todoRaw = enhanced.md;
            appendAction({
                ts: nowIso(),
                action: 'runtime_cards_autofix',
                stage: 'DASH',
                detail: `runtime-auditor mejoro cards software (fixes=${enhanced.fixed})`,
                files: [`groups/${GROUP}/todo.md`],
                meta: { fixes: enhanced.fixed, tasks: enhanced.tasks.slice(0, 20) },
            });
        }
    }
    const todo = parseTodo(todoRaw);
    const tasksState = buildTasksStateMap();
    const issues: AuditIssue[] = [];

    for (const t of todo) {
        if (isGenericScope(t.scope)) {
            issues.push({ severity: 'warn', type: 'generic_scope', taskId: t.id, detail: `scope generico: "${t.scope}"` });
        }
        if (t.state === 'done' && (isMissingEvidenceField(t.entregable) || isMissingEvidenceField(t.tests))) {
            issues.push({ severity: 'critical', type: 'done_without_evidence', taskId: t.id, detail: `done sin evidencia en todo.md (entregable/tests)` });
        }
        const stateInTasks = tasksState.get(t.id);
        if (stateInTasks && stateInTasks !== t.state) {
            issues.push({ severity: 'warn', type: 'state_drift', taskId: t.id, detail: `drift todo=${t.state} tasks-state=${stateInTasks}` });
        }
    }

    const critical = issues.filter((x) => x.severity === 'critical');
    const warn = issues.filter((x) => x.severity === 'warn');
    const report: AuditReport = {
        generatedAt: nowIso(),
        group: GROUP,
        summary: { totalTasks: todo.length, issues: issues.length, critical: critical.length, warn: warn.length },
        issues: issues.slice(0, 200),
    };
    writeJsonAtomic(AUDIT_PATH, report);

    appendAction({
        ts: nowIso(),
        action: issues.length > 0 ? 'runtime_audit_warn' : 'runtime_audit_ok',
        stage: 'DASH',
        detail: issues.length > 0
            ? `runtime-audit detecto issues: critical=${critical.length} warn=${warn.length}`
            : 'runtime-audit ok',
        files: [`groups/${GROUP}/todo.md`, `groups/${GROUP}/swarmdev/tasks-state.json`, `groups/${GROUP}/swarmdev/runtime-audit.json`],
        meta: { issues: issues.length, critical: critical.length, warn: warn.length },
    });

    if (critical.length === 0) return;
    const state = readJson<{ lastNudgeAt: string | null }>(STATE_PATH, { lastNudgeAt: null });
    const lastNudgeMs = parseIsoMs(state?.lastNudgeAt);
    const nowMs = Date.now();
    if (lastNudgeMs && (nowMs - lastNudgeMs) < AUDIT_INTERVAL_COOLDOWN_MS) return;

    const byTask = new Map<string, string[]>();
    for (const it of issues) {
        const id = String(it.taskId || '').toUpperCase();
        if (!id) continue;
        if (!byTask.has(id)) byTask.set(id, []);
        byTask.get(id)!.push(it.type);
    }
    const priority = [...byTask.entries()]
        .map(([id, types]) => ({
            id,
            score: (types.includes('done_without_evidence') ? 10 : 0) + (types.includes('state_drift') ? 5 : 0) + (types.includes('generic_scope') ? 3 : 0),
            types,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

    const priorityText = priority.map((x, i) => `${i + 1}) ${x.id} [${x.types.join('+')}]`).join(' | ');

    enqueueNudge(
        `@Andy ETAPA: TEAMLEAD\n` +
        `ITEM: runtime-audit enforcement (${critical.length} criticos)\n` +
        `ARCHIVOS: groups/main/todo.md, groups/main/swarmdev/tasks-state.json, groups/main/swarmdev/runtime-audit.json\n` +
        `SIGUIENTE: reconciliar tasks priorizadas\n\n` +
        `Orden obligatorio: ${priorityText}\n` +
        `Reglas: 1) done sin evidencia -> doing/blocked. 2) scope generico -> reescribir scope verificable. ` +
        `3) state drift -> unificar todo/tasks-state/lane/workflow.\n` +
        `Salida requerida: tabla TASK|ANTES|DESPUES|EVIDENCIA + done/total real + JSONPROMPT + SWARMLOG.`,
    );
    writeJsonAtomic(STATE_PATH, { lastNudgeAt: nowIso() });
}

run();
