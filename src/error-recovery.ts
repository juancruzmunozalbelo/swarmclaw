/**
 * Error Recovery — handles post-agent error processing.
 * Extracted from processGroupMessages Phase 5 (Sprint 5).
 *
 * Manages: error notices with cooldown, error streak tracking,
 * auto-heal triggers, and cursor rollback decisions.
 */

import { appendSwarmAction, appendSwarmEvent } from './swarm-events.js';
import { updateRuntimeMetrics } from './runtime-metrics.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ErrorRecoveryDeps {
    groupFolder: string;
    groupName: string;
    chatJid: string;
    taskIds: string[];
    validationViolation: boolean;
    assistantName: string;
    /** Error notice cooldown in ms (default 45s) */
    errorNoticeCooldownMs: number;
    /** Error streak window in ms (default 20m) */
    errorStreakWindowMs: number;
    /** Error streak threshold (default 3) */
    errorStreakThreshold: number;
    /** Send a WhatsApp message */
    sendMessage: (chatJid: string, text: string) => Promise<void>;
    /** closeStdin on the queue */
    closeStdin: (chatJid: string) => void;
    /** sendMessage via queue (returns boolean = piped) */
    queueSendMessage: (chatJid: string, text: string) => boolean;
    /** Logger warn */
    logWarn: (meta: Record<string, unknown>, msg: string) => void;
}

export interface ErrorStreakEntry {
    count: number;
    lastAt: number;
    lastReason: string;
}

export interface ErrorRecoveryResult {
    /** true if error notice was sent to user */
    noticeSent: boolean;
    /** current streak count after this error */
    streakCount: number;
    /** true if auto-heal was triggered */
    autoHealTriggered: boolean;
}

// ── Shared state ───────────────────────────────────────────────────────────

const errorNoticeAt = new Map<string, number>();
const errorStreakByChat = new Map<string, ErrorStreakEntry>();

/** @internal — for testing */
export function _resetErrorRecoveryState(): void {
    errorNoticeAt.clear();
    errorStreakByChat.clear();
}

/** @internal — for testing */
export function _getErrorStreak(chatJid: string): ErrorStreakEntry | undefined {
    return errorStreakByChat.get(chatJid);
}

// ── Error notice ───────────────────────────────────────────────────────────

async function maybeSendErrorNotice(deps: ErrorRecoveryDeps): Promise<boolean> {
    const now = Date.now();
    const last = errorNoticeAt.get(deps.chatJid) || 0;
    if (now - last < deps.errorNoticeCooldownMs) return false;

    const scope = deps.taskIds.length > 0 ? deps.taskIds.slice(0, 1).join(', ') : 'tarea actual';
    const reason = deps.validationViolation ? 'validacion fallida' : 'error de agente';
    await deps.sendMessage(
        deps.chatJid,
        `${deps.assistantName}: ETAPA: TEAMLEAD\nITEM: ${reason}\nSIGUIENTE: retry automatico sobre ${scope}`,
    );
    errorNoticeAt.set(deps.chatJid, now);
    appendSwarmAction(deps.groupFolder, {
        action: 'error_notice_sent',
        stage: 'TEAMLEAD',
        detail: `error notice sent (${reason})`,
        meta: { chatJid: deps.chatJid, taskIds: deps.taskIds, validationViolation: deps.validationViolation },
    });
    return true;
}

// ── Streak tracking ────────────────────────────────────────────────────────

function updateErrorStreak(deps: ErrorRecoveryDeps): { count: number; autoHeal: boolean } {
    const now = Date.now();
    const prev = errorStreakByChat.get(deps.chatJid);
    const nextCount = prev && now - prev.lastAt <= deps.errorStreakWindowMs
        ? prev.count + 1
        : 1;
    errorStreakByChat.set(deps.chatJid, {
        count: nextCount,
        lastAt: now,
        lastReason: deps.validationViolation ? 'validation_violation' : 'agent_error',
    });

    appendSwarmAction(deps.groupFolder, {
        action: 'error_streak_update',
        stage: 'error',
        detail: `error streak ${nextCount}/${deps.errorStreakThreshold} on ${deps.chatJid}`,
        meta: {
            chatJid: deps.chatJid,
            count: nextCount,
            threshold: deps.errorStreakThreshold,
            windowMs: deps.errorStreakWindowMs,
        },
    });

    let autoHeal = false;
    if (nextCount >= deps.errorStreakThreshold) {
        deps.closeStdin(deps.chatJid);
        const nudged = deps.queueSendMessage(
            deps.chatJid,
            `@${deps.assistantName} AUTO-HEAL: detectada racha de errores (${nextCount}). Reiniciar flujo en micro-batch de 1-3 tasks, conservar contrato estricto y continuar sin preguntas intermedias.`,
        );
        appendSwarmEvent(deps.groupFolder, {
            kind: 'error',
            stage: 'TEAMLEAD',
            item: 'auto-heal triggered',
            next: 'retry with micro-batch',
            chatJid: deps.chatJid,
            msg: `auto-heal triggered after ${nextCount} consecutive errors`,
            meta: { chatJid: deps.chatJid, nudged },
        });
        appendSwarmAction(deps.groupFolder, {
            action: 'auto_heal_triggered',
            stage: 'TEAMLEAD',
            detail: `auto-heal triggered after ${nextCount} errors`,
            meta: { chatJid: deps.chatJid, nudged },
        });
        autoHeal = true;
    }

    return { count: nextCount, autoHeal };
}

// ── Main handler ───────────────────────────────────────────────────────────

/**
 * Handle error after agent execution. Sends notice, tracks streak,
 * triggers auto-heal, updates metrics.
 * Returns result for caller to decide on cursor rollback.
 */
export async function handlePostAgentError(deps: ErrorRecoveryDeps): Promise<ErrorRecoveryResult> {
    if (deps.validationViolation) {
        deps.logWarn(
            { group: deps.groupName, taskIds: deps.taskIds },
            'Workflow validation violation detected, forcing retry',
        );
    }

    updateRuntimeMetrics({
        groupFolder: deps.groupFolder,
        increments: { agentErrors: 1 },
        lastStage: 'error',
        lastError: deps.validationViolation ? 'workflow validation violation' : 'agent execution error',
        lastTaskIds: deps.taskIds.length > 0 ? deps.taskIds : undefined,
    });

    let noticeSent = false;
    try {
        noticeSent = await maybeSendErrorNotice(deps);
    } catch {
        // ignore user-notice failures
    }

    let streakCount = 0;
    let autoHealTriggered = false;
    try {
        const streak = updateErrorStreak(deps);
        streakCount = streak.count;
        autoHealTriggered = streak.autoHeal;
    } catch {
        // ignore streak tracking failures
    }

    return { noticeSent, streakCount, autoHealTriggered };
}

/**
 * Clear error streak on success. Call after successful agent execution.
 */
export function clearErrorStreak(groupFolder: string, chatJid: string): void {
    try {
        const streak = errorStreakByChat.get(chatJid);
        if (streak && streak.count > 0) {
            appendSwarmAction(groupFolder, {
                action: 'error_streak_recovered',
                stage: 'TEAMLEAD',
                detail: `error streak recovered after ${streak.count} consecutive errors`,
                meta: { chatJid, recoveredCount: streak.count },
            });
        }
        errorStreakByChat.delete(chatJid);
    } catch {
        // ignore
    }
}
