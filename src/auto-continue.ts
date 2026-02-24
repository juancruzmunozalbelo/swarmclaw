/**
 * Auto-Continue Logic — orchestrates automatic continuation nudges.
 * Extracted from index.ts during Sprint 7 decomposition.
 *
 * Manages: backlog freeze filtering, blocking questions check,
 * auto-continue nudge injection, deploy validation loop detection.
 */

import {
    AUTO_CONTINUE,
    APP_MODE,
    SWARM_EXEC_MODE,
    SWARM_AUTONOMOUS_MODE,
    BACKLOG_FREEZE_PREFIX,
    BACKLOG_FREEZE_ACTIVE_TASK,
    ASSISTANT_NAME,
} from './config.js';
import { getBlockedTasks, type TaskWorkflowState } from './swarm-workflow.js';
import { readRuntimeMetrics } from './runtime-metrics.js';
import { appendSwarmAction } from './swarm-events.js';
import { collectPendingRelatedTasks } from './todo-manager.js';

// ── State ──────────────────────────────────────────────────────────────────

const AUTO_CONTINUE_NUDGE_COOLDOWN_MS = 20 * 1000;
const AUTO_CONTINUE_MAX_NUDGES_PER_SESSION = 50;
export const DEPLOY_VALIDATION_LOOP_WINDOW_MS = 15 * 60 * 1000;
export const DEPLOY_VALIDATION_LOOP_THRESHOLD = 3;

const autoContinueNudgeAt = new Map<string, number>();
const autoContinueNudgeCount = new Map<string, number>();
const deployValidationStreakByTask = new Map<string, { count: number; lastAt: number }>();

/** @internal — for testing */
export function _resetAutoContinueState(): void {
    autoContinueNudgeAt.clear();
    autoContinueNudgeCount.clear();
    deployValidationStreakByTask.clear();
}

// ── Pure helpers ───────────────────────────────────────────────────────────

export function isAutoContinueEnabled(): boolean {
    if (SWARM_AUTONOMOUS_MODE) return true;
    return AUTO_CONTINUE || APP_MODE === 'prod';
}

export function applyBacklogFreeze(taskIds: string[]): string[] {
    if (!BACKLOG_FREEZE_PREFIX) return taskIds;
    const active = String(BACKLOG_FREEZE_ACTIVE_TASK || '').trim().toUpperCase();
    const normalized = (taskIds || []).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    if (normalized.length === 0) return normalized;
    return normalized.filter((id) => {
        if (!id.startsWith(`${BACKLOG_FREEZE_PREFIX}-`)) return true;
        if (!active) return false;
        return id === active;
    });
}

export function hasBlockingQuestionsInScope(groupFolder: string, taskIds: string[]): boolean {
    try {
        const blocked = getBlockedTasks(groupFolder);
        if (blocked.length === 0) return false;
        const normalized = taskIds.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
        if (normalized.length === 0) return blocked.length > 0;
        const prefixes = new Set<string>();
        for (const id of normalized) {
            const p = id.split('-')[0];
            if (p) prefixes.add(p);
        }
        return blocked.some((row: TaskWorkflowState) => {
            const bid = String(row.taskId || '').trim().toUpperCase();
            if (!bid) return false;
            if (normalized.includes(bid)) return true;
            const bp = bid.split('-')[0];
            return !!bp && prefixes.has(bp);
        });
    } catch {
        return false;
    }
}

export function deployValidationLoopTriggered(taskId: string): boolean {
    const id = String(taskId || '').trim().toUpperCase();
    if (!id) return false;
    const now = Date.now();
    const prev = deployValidationStreakByTask.get(id);
    const withinWindow = !!prev && (now - prev.lastAt) <= DEPLOY_VALIDATION_LOOP_WINDOW_MS;
    const count = withinWindow ? (prev!.count + 1) : 1;
    deployValidationStreakByTask.set(id, { count, lastAt: now });
    return count >= DEPLOY_VALIDATION_LOOP_THRESHOLD;
}

// ── Auto-continue nudge ────────────────────────────────────────────────────

export type AutoContinueReason =
    | 'asked_continue'
    | 'post_output'
    | 'deploy_validation_failed'
    | 'status_line_contract_failed';

export interface AutoContinueDeps {
    /** queue.sendMessage(chatJid, text) → boolean */
    queueSendMessage: (chatJid: string, text: string) => boolean;
}

export function maybeQueueAutoContinueNudge(
    params: {
        groupFolder: string;
        chatJid: string;
        taskIds: string[];
        hintTaskIds?: string[];
        reason: AutoContinueReason;
    },
    deps: AutoContinueDeps,
): boolean {
    if (!isAutoContinueEnabled()) return false;
    const strictSingleTaskReason =
        params.reason === 'deploy_validation_failed' ||
        params.reason === 'status_line_contract_failed';
    let scope = [
        ...params.taskIds.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean),
        ...(params.hintTaskIds || []).map((x) => String(x || '').trim().toUpperCase()).filter(Boolean),
    ];
    if (scope.length === 0) {
        const rm = readRuntimeMetrics(params.groupFolder);
        const fromRuntime = Array.isArray(rm?.lastTaskIds)
            ? rm.lastTaskIds.map((x: string) => String(x || '').trim().toUpperCase()).filter(Boolean)
            : [];
        scope = fromRuntime;
    }
    let uniqueScope = [...new Set(scope)];
    if (strictSingleTaskReason && uniqueScope.length > 1) {
        uniqueScope = uniqueScope.slice(0, 1);
    }
    if (uniqueScope.length === 0) return false;
    if (hasBlockingQuestionsInScope(params.groupFolder, uniqueScope)) return false;
    let pending = strictSingleTaskReason
        ? uniqueScope.slice(0, 1)
        : collectPendingRelatedTasks(params.groupFolder, uniqueScope);
    if (pending.length === 0) {
        pending = uniqueScope.slice(0, strictSingleTaskReason ? 1 : 8);
    }

    const now = Date.now();
    const last = autoContinueNudgeAt.get(params.chatJid) || 0;
    if (now - last < AUTO_CONTINUE_NUDGE_COOLDOWN_MS) return false;

    // Fix 15: cap max nudges per session to prevent infinite retry loops
    const prevCount = autoContinueNudgeCount.get(params.chatJid) || 0;
    if (prevCount >= AUTO_CONTINUE_MAX_NUDGES_PER_SESSION) {
        appendSwarmAction(params.groupFolder, {
            action: 'autocontinue_cap_reached',
            stage: 'TEAMLEAD',
            detail: `auto-continue capped at ${AUTO_CONTINUE_MAX_NUDGES_PER_SESSION} nudges for session`,
            meta: { chatJid: params.chatJid, count: prevCount },
        });
        return false;
    }

    const nudgeText = (
        params.reason === 'deploy_validation_failed' ||
        params.reason === 'status_line_contract_failed'
    )
        ? (() => {
            const requiredPublicSuffix = String(
                process.env.DEPLOY_REQUIRED_PUBLIC_SUFFIX ||
                process.env.CLOUDFLARE_ZONE_NAME ||
                '',
            )
                .trim()
                .toLowerCase();
            const suffixRule = requiredPublicSuffix
                ? `Si STATUS=deployed: URL_PUBLIC debe terminar en .${requiredPublicSuffix} (no trycloudflare).`
                : 'Si STATUS=deployed: URL_PUBLIC no puede ser local ni trycloudflare.';
            return [
                `@${ASSISTANT_NAME} CONTRATO ESTRICTO: salida invalida por status/deploy.`,
                'Rehacer SOLO la tarea pendiente con $cloudflare-deploy (subdominio real).',
                'Reponder EXACTAMENTE con estas lineas:',
                'STATUS=<deployed|not_deployed|blocked>',
                'URL_PUBLIC=<url o n/a>',
                'PORT=<numero o n/a>',
                'PROCESS=<cmd o n/a>',
                'DB=<ok|none|blocked>',
                'CHECK_LOCAL=<ok|fail|n/a>',
                'CHECK_PUBLIC=<ok|fail|n/a>',
                'CHECK_CONTENT=<ok|fail|n/a>',
                'LAST_LOG=<texto corto>',
                `${suffixRule} DB debe ser ok, CHECK_PUBLIC=ok, CHECK_CONTENT=ok.`,
                'CHECK_PUBLIC debe ser literal ok/fail (no 200).',
                'Sin tablas, sin markdown, sin texto extra.',
            ].join('\n');
        })()
        : `@${ASSISTANT_NAME} AUTO-CONTINUAR estricto (${APP_MODE}/${SWARM_EXEC_MODE}): no pedir confirmacion intermedia. Segui backlog pendiente ${pending.slice(0, 25).join(', ')} por dependencias y reporta ETAPA/ITEM/ARCHIVOS/SIGUIENTE cada 60s.`;

    const nudged = deps.queueSendMessage(params.chatJid, nudgeText);
    if (!nudged) return false;

    autoContinueNudgeAt.set(params.chatJid, now);
    autoContinueNudgeCount.set(params.chatJid, (autoContinueNudgeCount.get(params.chatJid) || 0) + 1);
    appendSwarmAction(params.groupFolder, {
        action: 'autocontinue_nudge',
        stage: 'TEAMLEAD',
        detail: `auto-continue nudge injected (${params.reason})`,
        files: [`data/ipc/${params.groupFolder}/input`],
        meta: {
            chatJid: params.chatJid,
            scope: uniqueScope,
            pending: pending.slice(0, 25),
            reason: params.reason,
            mode: APP_MODE,
        },
    });
    return true;
}
