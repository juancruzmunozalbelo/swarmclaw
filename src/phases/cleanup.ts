/**
 * Phase 5: Cleanup & Error Recovery
 * Stop timers, update final status, handle errors (cursor rollback,
 * error notices, streak tracking, auto-heal).
 *
 * Sprint 3 — Extracted from processGroupMessages L1615-L1687.
 */

import { ASSISTANT_NAME } from '../config.js';
import { updateSwarmStatus } from '../swarm-status.js';
import { writeSwarmMetrics } from '../metrics.js';
import { appendSwarmAction, appendSwarmEvent } from '../swarm-events.js';
import { handlePostAgentError, clearErrorStreak } from '../error-recovery.js';
import { logger } from '../logger.js';
import type { Channel } from '../types.js';
import type { GroupQueue } from '../group-queue.js';
import type { PhaseContext, PhaseTimers } from './types.js';

const ERROR_NOTICE_COOLDOWN_MS = 45 * 1000;
const ERROR_STREAK_WINDOW_MS = 20 * 60 * 1000;
const ERROR_STREAK_THRESHOLD = 3;

/**
 * Run cleanup phase: stop timers, update final status, handle errors,
 * rollback cursor on failure.
 */
export async function cleanupPhase(
    ctx: PhaseContext,
    timers: PhaseTimers,
    output: string,
    deps: {
        channel: Channel;
        queue: GroupQueue;
        lastAgentTimestamp: Record<string, string>;
        saveState: () => void;
    },
): Promise<boolean> {
    await deps.channel.setTyping?.(ctx.chatJid, false);
    if (timers.idleTimer) clearTimeout(timers.idleTimer);
    if (timers.dashIdleTimer) clearTimeout(timers.dashIdleTimer);
    if (timers.heartbeatTimer) clearInterval(timers.heartbeatTimer);

    const isError = output === 'error' || ctx.hadError;
    try {
        updateSwarmStatus({
            groupFolder: ctx.group.folder,
            stage: isError ? 'error' : 'idle',
            item: isError ? 'agent error' : 'done',
            files: ['groups/main/todo.md', `groups/${ctx.group.folder}/swarmdev/`],
            next: 'awaiting next message',
        });
        writeSwarmMetrics(ctx.group.folder, {
            stage: isError ? 'error' : 'idle',
            item: isError ? 'agent error' : 'done',
            next: 'awaiting next message',
            chatJid: ctx.chatJid,
            note: 'finish',
        });
        appendSwarmEvent(ctx.group.folder, {
            kind: 'finish',
            stage: isError ? 'error' : 'idle',
            item: isError ? 'agent error' : 'done',
            next: 'awaiting next message',
            chatJid: ctx.chatJid,
        });
        appendSwarmAction(ctx.group.folder, {
            action: isError ? 'finish_error' : 'finish',
            stage: isError ? 'error' : 'idle',
            detail: isError ? 'agent error' : 'done',
        });
    } catch {
        // ignore
    }

    if (isError) {
        // If we already sent output to the user, don't roll back the cursor —
        // the user got their response and re-processing would send duplicates.
        if (ctx.outputSentToUser) {
            logger.warn({ group: ctx.group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
            return true;
        }
        await handlePostAgentError({
            groupFolder: ctx.group.folder,
            groupName: ctx.group.name,
            chatJid: ctx.chatJid,
            taskIds: ctx.taskIds,
            validationViolation: ctx.validationViolation,
            assistantName: ASSISTANT_NAME,
            errorNoticeCooldownMs: ERROR_NOTICE_COOLDOWN_MS,
            errorStreakWindowMs: ERROR_STREAK_WINDOW_MS,
            errorStreakThreshold: ERROR_STREAK_THRESHOLD,
            sendMessage: (jid, text) => deps.channel.sendMessage(jid, text),
            closeStdin: (jid) => deps.queue.closeStdin(jid),
            queueSendMessage: (jid, text) => deps.queue.sendMessage(jid, text),
            logWarn: (meta, msg) => logger.warn(meta, msg),
        });
        // Roll back cursor so retries can re-process these messages
        deps.lastAgentTimestamp[ctx.chatJid] = ctx.previousCursor;
        deps.saveState();
        logger.warn({ group: ctx.group.name }, 'Agent error, rolled back message cursor for retry');
        return false;
    }

    clearErrorStreak(ctx.group.folder, ctx.chatJid);
    return true;
}
