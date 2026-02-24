/**
 * Prompt Builder — constructs prompts and role instructions for agent subagents.
 * Extracted from index.ts during Sprint 1 decomposition.
 */
import fs from 'fs';
import path from 'path';

import {
    SUBAGENT_CONTEXT_MESSAGES,
    TASK_MICRO_BATCH_MAX,
} from './config.js';
import { formatMessages } from './router.js';
import type { NewMessage } from './types.js';

export type SubagentRole = 'PM' | 'SPEC' | 'ARQ' | 'UX' | 'DEV' | 'DEV2' | 'DEVOPS' | 'QA';
export type TaskKind = 'planning' | 'frontend' | 'backend' | 'devops' | 'qa' | 'security' | 'general';
type MatrixRoleDef = { required?: string[]; optional?: string[] };
type MatrixTaskKindDef = { routeRoles?: SubagentRole[]; roles?: Record<string, MatrixRoleDef> };
type RouterSkillsMatrix = { version?: number; taskKinds?: Record<string, MatrixTaskKindDef> };

const ROUTER_SKILLS_MATRIX_PATH = path.join(process.cwd(), 'config', 'router-skills-matrix.json');
let routerSkillsMatrixCache: RouterSkillsMatrix | null = null;

function loadRouterSkillsMatrix(): RouterSkillsMatrix {
    if (routerSkillsMatrixCache) return routerSkillsMatrixCache;
    try {
        if (!fs.existsSync(ROUTER_SKILLS_MATRIX_PATH)) {
            routerSkillsMatrixCache = { version: 1, taskKinds: {} };
            return routerSkillsMatrixCache;
        }
        const raw = JSON.parse(fs.readFileSync(ROUTER_SKILLS_MATRIX_PATH, 'utf-8')) as RouterSkillsMatrix;
        if (!raw || typeof raw !== 'object') {
            console.warn('[prompt-builder] router-skills-matrix.json is not a valid object, using empty default');
            routerSkillsMatrixCache = { version: 1, taskKinds: {} };
            return routerSkillsMatrixCache;
        }
        if (!raw.taskKinds || typeof raw.taskKinds !== 'object') {
            console.warn('[prompt-builder] router-skills-matrix.json missing taskKinds, using empty default');
            routerSkillsMatrixCache = { version: 1, taskKinds: {} };
            return routerSkillsMatrixCache;
        }
        routerSkillsMatrixCache = raw;
        return routerSkillsMatrixCache;
    } catch (err) {
        console.warn('[prompt-builder] Failed to parse router-skills-matrix.json:', err);
        routerSkillsMatrixCache = { version: 1, taskKinds: {} };
        return routerSkillsMatrixCache;
    }
}

function matrixTaskKindDef(taskKind: TaskKind): MatrixTaskKindDef | null {
    const matrix = loadRouterSkillsMatrix();
    const map = matrix.taskKinds || {};
    return map[taskKind] || map.general || null;
}

export function strictOutputContractText(stage: string): string {
    const up = String(stage || '').trim().toUpperCase();
    return [
        `Contrato de salida obligatorio (${up}):`,
        'ETAPA: <' + up + '>',
        'ITEM: <tarea concreta en progreso>',
        'ARCHIVOS: <ruta1, ruta2 o n/a>',
        'SIGUIENTE: <siguiente accion tecnica concreta>',
        'TDD_TIPO: <planning|spec|arq|ux|dev|qa|devops>',
        'TDD_RED: <fallo/caso inicial o criterio no cumplido detectado>',
        'TDD_GREEN: <cambio minimo + validacion que pasa>',
        'TDD_REFACTOR: <mejora aplicada sin romper validacion>',
        'JSONPROMPT: {"etapa":"<STAGE>","item":"<item>","archivos":["<ruta1>"],"siguiente":"<next>","tdd":{"tipo":"<tipo>","red":"<red>","green":"<green>","refactor":"<refactor>"},"swarmlog":{"action":"...","stage":"<STAGE>","detail":"...","files":["..."]}}',
        'SWARMLOG: {"action":"...","stage":"' + up + '","detail":"...","files":["..."]}',
    ].join('\n');
}

export function roleSkillName(role: SubagentRole, taskKind: TaskKind): string {
    if (taskKind === 'security' && role === 'QA') {
        return '$codex-risk-bridge';
    }
    if (role === 'PM') return '$swarm-pm-planning';
    if (role === 'SPEC') return '$swarm-spec-contract';
    if (role === 'ARQ') return '$swarm-arq-decisions';
    if (role === 'UX') return '$swarm-dev-implementation';
    if (role === 'DEV') return '$swarm-dev-implementation';
    if (role === 'DEV2') return '$swarm-dev-implementation';
    if (role === 'DEVOPS') return '$swarm-devops-deploy';
    if (role === 'QA') return '$swarm-qa-validation';
    return '$swarm-teamlead-orchestrator';
}

export function normalizeSkillMetricKey(raw: string): string {
    const v = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return v || 'unknown';
}

export function metricSkillForRole(role: SubagentRole, taskKind: TaskKind): string {
    return normalizeSkillMetricKey(roleSkillName(role, taskKind).replace(/^\$/, ''));
}

export function roleSkillsForTask(taskKind: TaskKind, role: SubagentRole): { required: string[]; optional: string[] } {
    const def = matrixTaskKindDef(taskKind);
    const row = def?.roles?.[role] || def?.roles?.[String(role).toUpperCase()] || null;
    const required = Array.isArray(row?.required)
        ? row!.required.map((x) => String(x || '').trim()).filter(Boolean)
        : [roleSkillName(role, taskKind)];
    const optional = Array.isArray(row?.optional)
        ? row!.optional.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
    return {
        required: [...new Set(required)],
        optional: [...new Set(optional)],
    };
}

export function mandatorySkillsForTask(taskKind: TaskKind): string[] {
    const def = matrixTaskKindDef(taskKind);
    const out = new Set<string>();
    const rolesMap = def?.roles || {};
    for (const rowAny of Object.values(rolesMap)) {
        const row = rowAny as MatrixRoleDef;
        for (const s of Array.isArray(row.required) ? row.required : []) {
            const skill = String(s || '').trim();
            if (skill) out.add(skill);
        }
    }
    if (out.size === 0) out.add('$swarm-teamlead-orchestrator');
    return [...out];
}

export function routeRolesForTaskKind(taskKind: TaskKind): SubagentRole[] {
    const def = matrixTaskKindDef(taskKind);
    const route = Array.isArray(def?.routeRoles) ? def!.routeRoles : [];
    return route.filter((x): x is SubagentRole =>
        ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'].includes(String(x)),
    );
}

export function extraMandatorySkillNote(role: SubagentRole, taskKind: TaskKind): string {
    if (role === 'DEVOPS' && taskKind === 'devops') {
        return 'Skill adicional obligatoria: usar $cloudflare-deploy para subdominio estable (no quick tunnel).';
    }
    return '';
}

export function inferTaskKind(params: {
    groupFolder: string;
    taskId: string;
    stageHint: string;
    track: 'frontend' | 'backend' | 'fullstack';
    messages: NewMessage[];
    parseTodoTaskContext: (groupFolder: string, taskId: string) => { owner: string; scope: string; state: string } | null;
}): TaskKind {
    const ctx = params.parseTodoTaskContext(params.groupFolder, params.taskId);
    const latest = params.messages.slice(-12).map((m) => String(m.content || '')).join('\n').toLowerCase();
    const scope = String(ctx?.scope || '').toLowerCase();
    const owner = String(ctx?.owner || '').toLowerCase();
    const stage = String(params.stageHint || '').toUpperCase();
    const joined = `${latest}\n${scope}\n${owner}`;
    const executionSignals =
        /\b(continuar|implementar|desarrollar|codear|fix|resolver|entregar|completar)\b/.test(joined) ||
        /\bmkt-\d{3,}\b/.test(joined);

    if (/\b(security|riesg|vulnerab|cve|owasp|authz|hardening)\b/.test(joined)) return 'security';
    if (/\b(devops|deploy|subdominio|cloudflare|dns|tunnel|uptime|healthcheck|infra|postgres|database_url)\b/.test(joined)) return 'devops';
    if (/\b(qa|test|tests|regresion|bug|falla)\b/.test(joined) || stage === 'QA') return 'qa';
    if (!executionSignals && (/\b(pm|planning|backlog|prioriz|tareas|roadmap)\b/.test(joined) || stage === 'PM')) return 'planning';
    if (/\b(front|frontend|ui|ux|landing|html|css|svelte|react|tailwind)\b/.test(joined)) return 'frontend';
    if (/\b(back|backend|api|rest|db|postgres|sql|jwt|auth)\b/.test(joined)) return 'backend';
    if (executionSignals && params.track === 'frontend') return 'frontend';
    if (executionSignals && params.track === 'backend') return 'backend';
    if (executionSignals && params.track === 'fullstack') return 'frontend';
    if (params.track === 'frontend') return 'frontend';
    if (params.track === 'backend') return 'backend';
    return 'general';
}

// ── Role prompt loading ────────────────────────────────────────────────

const PROMPTS_DIR = path.join(process.cwd(), 'prompts');
const rolePromptCache = new Map<string, string>();

/** @internal — reset cache for testing */
export function _resetRolePromptCache(): void {
    rolePromptCache.clear();
}

function loadRolePrompt(role: SubagentRole): string | null {
    const cached = rolePromptCache.get(role);
    if (cached !== undefined) return cached;
    const filePath = path.join(PROMPTS_DIR, `${role}.md`);
    try {
        if (!fs.existsSync(filePath)) {
            const fallback = _fallbackRolePrompt(role);
            rolePromptCache.set(role, fallback);
            return fallback;
        }
        const text = fs.readFileSync(filePath, 'utf-8').trim();
        if (!text) {
            const fallback = _fallbackRolePrompt(role);
            rolePromptCache.set(role, fallback);
            return fallback;
        }
        rolePromptCache.set(role, text);
        return text;
    } catch {
        const fallback = _fallbackRolePrompt(role);
        rolePromptCache.set(role, fallback);
        return fallback;
    }
}

/** Hardcoded fallback when a role prompt file is missing */
function _fallbackRolePrompt(role: SubagentRole): string {
    return `Eres un agente ${role}. Ejecuta la tarea asignada con rigor. Reporta progreso con formato: ETAPA/ITEM/ARCHIVOS/SIGUIENTE. Responde en JSON estricto.`;
}

const INLINE_FALLBACKS: Record<SubagentRole, string> = {
    PM: 'Actua como PM-SR. Desglosa tareas atomicas priorizadas por impacto/riesgo/dependencias. Calidad obligatoria de todo.md: descripcion concreta, verificable y con contexto funcional. Cada tarea debe incluir outcome de negocio, alcance/no-alcance y criterio de done objetivo. Aplica TDD de planning: RED (gap/riesgo detectado) -> GREEN (card atomica definida) -> REFACTOR (ajuste de dependencias/prioridad). Usa ETAPA: PM + SWARMLOG. Si no hay bloqueos, continua automatico con la siguiente tarea por dependencia.',
    SPEC: 'Actua como ARQUITECTO/SPEC. Define decisiones tecnicas, contratos de API/datos y criterios de aceptacion testeables. Incluye supuestos, riesgos y tradeoffs (opcion elegida + descarte). Aplica TDD de especificacion: RED (caso que hoy falla/no cumple), GREEN (contrato y criterio verificable), REFACTOR (simplificar contrato sin perder cobertura). Solo pregunta si hay bloqueo real; si no, continua automatico con siguiente tarea.',
    ARQ: 'Actua como ARQUITECTO SR. Produce arquitectura evolutiva y decisiones tecnicas con justificacion (performance, seguridad, mantenibilidad, costo). Define boundaries, observabilidad y plan de rollout/rollback. Aplica TDD de arquitectura: RED (riesgo tecnico reproducible), GREEN (decision aplicada + criterio de aceptacion), REFACTOR (optimizacion de diseño). Para contrato usa ETAPA: SPEC + SWARMLOG. No pidas confirmacion para continuar salvo bloqueo.',
    UX: 'Actua como UX/UI senior. Define flujo de usuario end-to-end, estados vacios/error/loading, microcopy claro y accesibilidad (contraste, foco, keyboard, responsive). Aplica TDD UX: RED (problema de usabilidad/accesibilidad detectado), GREEN (solucion implementada + check visual/tecnico), REFACTOR (consistencia y simplificacion). Para contrato usa ETAPA: DEV + SWARMLOG. Continua automatico por dependencias.',
    DEV: 'Actua como DEV-SR. Implementa soluciones simples, robustas y mantenibles segun spec. Prioriza seguridad por defecto, manejo de errores explícito, logs útiles y tests de regresion. Evita deuda tecnica innecesaria y refactors fuera de alcance. TDD obligatorio: RED -> GREEN -> REFACTOR por tarea. Si marcas tareas como done (✅), incluye evidencia por tarea: ARCHIVO + COMANDO + RESULTADO + TDD_TIPO + TDD_RED + TDD_GREEN + TDD_REFACTOR. Continua automatico sin pedir confirmacion entre subtareas.',
    DEV2: 'Actua como DEV-2 (parallel implementer). Toma subtareas independientes de alto valor para reducir tiempo total sin pisar trabajo del DEV principal. Mantene consistencia de estilo/API, agrega pruebas y minimiza conflictos de integracion. TDD obligatorio: RED -> GREEN -> REFACTOR por tarea. Si marcas tareas como done (✅), incluye evidencia por tarea: ARCHIVO + COMANDO + RESULTADO + TDD_TIPO + TDD_RED + TDD_GREEN + TDD_REFACTOR. Para contrato usa ETAPA: DEV + SWARMLOG. Continua automatico por dependencias.',
    DEVOPS: 'Actua como DEVOPS senior. Scope estricto: deploy/runtime/infra/observabilidad/restarts/subdominios/tunnels. No crees features funcionales ni cambies requisitos de producto. Si no hay bloqueo real, continua automatico hasta resolver deploy. Para deploy/subdominio es obligatorio usar $cloudflare-deploy y su script deploy-cloudflare-url.sh. Prohibido quick tunnel *.trycloudflare.com como resultado final. Salida obligatoria en 1 linea para usuario: STATUS=deployed|not_deployed URL_PUBLIC=<url> PORT=<n> PROCESS=<cmd> DB=<ok|error|dsn> CHECK_LOCAL=<ok|fail> CHECK_PUBLIC=<ok|fail> CHECK_CONTENT=<ok|fail> LAST_LOG=<linea>. {{SUFFIX_RULE}} CHECK_PUBLIC=ok y CHECK_CONTENT=ok. DB debe ser ok. CHECK_PUBLIC debe ser literal ok/fail (no usar 200/201). Para contrato usa ETAPA: DEVOPS + SWARMLOG.',
    QA: 'Actua como QA senior. Valida happy path, edge cases y regresion con evidencia reproducible (comando, input, resultado esperado/obtenido). TDD QA obligatorio: RED (falla reproducida) -> GREEN (fix verificado) -> REFACTOR (estabilizacion de suite). Si marcas tareas como done (✅), incluye evidencia por tarea: ARCHIVO + COMANDO + RESULTADO + TDD_TIPO + TDD_RED + TDD_GREEN + TDD_REFACTOR. Reporta severidad, causa probable y criterio claro de pase/no pase. Si pasa QA, continua con siguiente task sin preguntar.',
};

function resolveDevopsSuffixRule(): string {
    const requiredPublicSuffix = String(
        process.env.DEPLOY_REQUIRED_PUBLIC_SUFFIX ||
        process.env.CLOUDFLARE_ZONE_NAME ||
        '',
    ).trim().toLowerCase();
    return requiredPublicSuffix
        ? `Si STATUS=deployed: URL_PUBLIC debe terminar en .${requiredPublicSuffix} (subdominio real).`
        : 'Si STATUS=deployed: URL_PUBLIC debe ser no-local y publico.';
}

export function roleInstruction(role: SubagentRole): string {
    const fromFile = loadRolePrompt(role);
    const raw = fromFile || INLINE_FALLBACKS[role] || INLINE_FALLBACKS.QA;
    // DEVOPS template has {{SUFFIX_RULE}} placeholder
    if (role === 'DEVOPS') {
        return raw.replace('{{SUFFIX_RULE}}', resolveDevopsSuffixRule());
    }
    return raw;
}

export function buildSubagentPrompt(params: {
    role: SubagentRole;
    taskId: string;
    taskKind: TaskKind;
    messages: NewMessage[];
}): string {
    const latest = params.messages.slice(-SUBAGENT_CONTEXT_MESSAGES);
    const context = formatMessages(latest);
    const mandSkills = mandatorySkillsForTask(params.taskKind);
    const roleSkills = roleSkillsForTask(params.taskKind, params.role);
    const pmTodoTemplate = params.role === 'PM'
        ? [
            '',
            'Para PM, en groups/main/todo.md usa este formato por item (sin campos vacios):',
            '- ID: <AREA-###>',
            '  Owner: <pm-sr|arquitecto|dev-sr|dev-2|qa|ux>',
            '  Scope: <1 frase: objetivo funcional + alcance>',
            '  Descripcion: <que se implementa, por que, limite de alcance>',
            '  Criterios: <3-6 checks binarios "Dado/Cuando/Entonces" o "Debe ...">',
            '  Entregable: <archivo(s), endpoint(s) o pantalla(s) exactas>',
            '  Tests: <pruebas concretas: comando + caso>',
            '  TDD: <tipo + RED/GREEN/REFACTOR esperado para cerrar>',
            '  DependsOn: <ID,ID,... o n/a>',
            '  Estado: <planning|todo|doing|blocked|done>',
            '',
            'Reglas PM de calidad:',
            '- No usar "mejorar cosas" ni descripciones vagas.',
            '- Cada task debe poder validarse sin preguntarte que significa.',
            '- Priorizar orden ejecutable por dependencias.',
        ].join('\n')
        : '';
    return [
        `[SUBAGENT:${params.role}] Task ${params.taskId}`,
        `Skill obligatoria: usar ${roleSkillName(params.role, params.taskKind)} antes de ejecutar.`,
        extraMandatorySkillNote(params.role, params.taskKind),
        `Matriz de skills (task_kind=${params.taskKind}): ${mandSkills.join(', ')}.`,
        `Skills requeridas para ${params.role}: ${roleSkills.required.join(', ') || 'n/a'}.`,
        `Skills opcionales para ${params.role}: ${roleSkills.optional.join(', ') || 'n/a'}.`,
        `Router: task_kind=${params.taskKind}.`,
        roleInstruction(params.role),
        strictOutputContractText(params.role === 'ARQ' ? 'SPEC' : params.role),
        // Quality first
        'PRIORIDAD #1: CALIDAD sobre velocidad. Tomarte el tiempo necesario para hacer las cosas bien.',
        'Barra de calidad: nivel elite (estilo equipos top product engineering). Demos deben impresionar — diseño premium, datos realistas, sin errores visibles.',
        'Validacion obligatoria: npm run build NO es suficiente. Verificar que la app CARGA en el browser sin errores antes de declarar done.',
        '',
        // Communication
        'COMUNICACIÓN PROACTIVA: Al recibir tarea, usar send_message INMEDIATAMENTE para: (1) confirmar que la recibiste, (2) listar subtareas, (3) dar tiempo estimado.',
        'Reportar progreso por subtarea via send_message: "✅ 1/3 — [completado]" → "⏳ 2/3 — [en proceso]..."',
        'Si el scope es ambiguo (ej: "haceme un MVP de X"), PREGUNTAR con opciones ANTES de implementar. Formato: OPCION A (recomendada) / OPCION B. Si no hay respuesta en 2min, ir con la recomendada.',
        '',
        // Autonomy rules
        `Micro-batch obligatorio: ejecutar como maximo ${TASK_MICRO_BATCH_MAX} cards por iteracion.`,
        'Politica de autonomia: avanzar sin pedir "continuo?" para trabajo operativo. PERO si hay ambiguedad funcional o de scope, preguntar ANTES de implementar.',
        'Medicion obligatoria: usar Kanban/todo.md como fuente de verdad y reportar progreso done/total + pendientes por prefijo (ej: ECOM, CNT).',
        'Regla de cierre estricto: no declarar "completado/finalizado" si en todo.md quedan IDs relacionados con Estado distinto de done; reporta done/total y pendientes.',
        'Formato obligatorio adicional: incluir siempre linea JSONPROMPT valida (JSON en una sola linea) consistente con ETAPA/ITEM/ARCHIVOS/SIGUIENTE/TDD/SWARMLOG.',
        'Responde breve y accionable. Si modificas archivos, indica rutas exactas y como validar.',
        'Cada salida debe incluir: que hiciste, evidencia de calidad, riesgos remanentes y siguiente paso tecnico.',
        'Inclui bloque ETAPA/ARCHIVOS/SIGUIENTE y SWARMLOG machine-readable.',
        pmTodoTemplate,
        '',
        'Contexto reciente:',
        context,
    ].join('\n');
}

export function buildTeamLeadPrompt(params: {
    messages: NewMessage[];
    taskIds: string[];
    stageHint: string;
}): string {
    const context = formatMessages(params.messages);
    const scoped = params.taskIds.slice(0, TASK_MICRO_BATCH_MAX);
    return [
        '[MODELO-FIRST ORCHESTRATOR]',
        'Skill obligatoria: usar $swarm-teamlead-orchestrator.',
        'Gate obligatorio: ejecutar $swarm-critic-review sobre cada salida de etapa antes de avanzar.',
        'Actua como TeamLead autonomo. Priorizas calidad verificable y entregas pequenas.',
        `Etapa inferida actual: ${String(params.stageHint || 'TEAMLEAD').toUpperCase()}.`,
        `Micro-batch obligatorio: trabajar solo ${TASK_MICRO_BATCH_MAX} tasks por ciclo.`,
        `Scope activo del ciclo: ${scoped.length > 0 ? scoped.join(', ') : 'sin IDs explicitos (inferir y crear REQ)'} .`,
        strictOutputContractText('TEAMLEAD'),
        'Politica dura: no preguntar "continuo?" ni pedir confirmacion intermedia salvo bloqueo real.',
        'Si hay bloqueo real, usar ETAPA: BLOCKED + preguntas concretas maximo 3.',
        'Formato obligatorio adicional: incluir siempre linea JSONPROMPT valida (JSON en una sola linea) consistente con ETAPA/ITEM/ARCHIVOS/SIGUIENTE/TDD/SWARMLOG.',
        'No declarar completado si quedan cards no done del mismo prefijo.',
        '',
        'Contexto reciente:',
        context,
    ].join('\n');
}

export function ownerFromStageHint(stageHint: string): string {
    const s = String(stageHint || '').toUpperCase();
    if (s === 'PM') return 'PM';
    if (s === 'SPEC') return 'arquitecto';
    if (s === 'ARQ') return 'arquitecto-sr';
    if (s === 'UX') return 'ux';
    if (s === 'DEV') return 'dev-sr';
    if (s === 'DEV2') return 'dev-2';
    if (s === 'DEVOPS') return 'devops';
    if (s === 'QA') return 'qa';
    return 'team-lead';
}

export function planningRolesForTrack(track: 'frontend' | 'backend' | 'fullstack'): SubagentRole[] {
    if (track === 'frontend') return ['PM', 'SPEC', 'UX'];
    if (track === 'backend') return ['PM', 'SPEC', 'ARQ'];
    return ['PM', 'SPEC', 'ARQ', 'UX'];
}

export function executionRolesForTrack(track: 'frontend' | 'backend' | 'fullstack'): SubagentRole[] {
    if (track === 'frontend') return ['UX', 'DEV2', 'DEV', 'QA'];
    if (track === 'backend') return ['DEV', 'DEV2', 'QA'];
    return ['UX', 'DEV', 'DEV2', 'QA'];
}

export function isEpicBootstrapTask(taskId: string): boolean {
    const id = String(taskId || '').trim().toUpperCase();
    return /^[A-Z][A-Z0-9_]*-001$/.test(id);
}

/** @internal — reset cache for testing */
export function _resetRouterSkillsMatrixCache(): void {
    routerSkillsMatrixCache = null;
}
