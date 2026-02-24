/**
 * Phase 3: Cursor Advance & Timer Setup
 * Save cursor position, configure idle and dash-idle timers, start heartbeat.
 *
 * Sprint 3 — Extracted from processGroupMessages L817-L952.
 */

import { IDLE_TIMEOUT, DASH_IDLE_GRACE_MS, APP_MODE } from '../config.js';
import { updateSwarmStatus } from '../swarm-status.js';
import { writeSwarmMetrics } from '../metrics.js';
import { appendSwarmAction, appendSwarmEvent } from '../swarm-events.js';
import { maybeSendProcessingAck } from '../processing-ack.js';
import { logger } from '../logger.js';
import type { Channel } from '../types.js';
import type { GroupQueue } from '../group-queue.js';
import type { PhaseContext, PhaseTimers } from './types.js';

const RUNTIME_HEARTBEAT_MS = 60 * 1000;
const IS_DEBUG_MODE = APP_MODE === 'debug';

/**
 * Run timer setup phase: advance cursor, configure timers, send ack, start heartbeat.
 */
export async function timersPhase(
    ctx: PhaseContext,
    deps: {
        channel: Channel;
        queue: GroupQueue;
        lastAgentTimestamp: Record<string, string>;
        saveState: () => void;
    },
): Promise<PhaseTimers> {
    // Save cursor position (for rollback on error)
    ctx.previousCursor = deps.lastAgentTimestamp[ctx.chatJid] || '';
    deps.lastAgentTimestamp[ctx.chatJid] =
        ctx.missedMessages[ctx.missedMessages.length - 1].timestamp;
    deps.saveState();

    logger.info(
        { group: ctx.group.name, messageCount: ctx.missedMessages.length },
        'Processing messages',
    );

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let dashIdleTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            logger.debug({ group: ctx.group.name }, 'Idle timeout, closing container stdin');
            deps.queue.closeStdin(ctx.chatJid);
        }, IDLE_TIMEOUT);
    };

    const scheduleDashIdle = () => {
        if (dashIdleTimer) clearTimeout(dashIdleTimer);
        dashIdleTimer = setTimeout(() => {
            try {
                updateSwarmStatus({
                    groupFolder: ctx.group.folder,
                    stage: 'idle',
                    item: 'awaiting next message',
                    files: [`groups/${ctx.group.folder}/swarmdev/status.md`],
                    next: 'awaiting next message',
                });
                writeSwarmMetrics(ctx.group.folder, {
                    stage: 'idle',
                    item: 'awaiting next message',
                    next: 'awaiting next message',
                    chatJid: ctx.chatJid,
                    note: 'dash_idle_grace',
                });
                appendSwarmEvent(ctx.group.folder, {
                    kind: 'status',
                    stage: 'idle',
                    item: 'awaiting next message',
                    next: 'awaiting next message',
                    chatJid: ctx.chatJid,
                    msg: 'dash idle grace elapsed',
                });
            } catch {
                // ignore
            }
        }, DASH_IDLE_GRACE_MS);
    };

    await deps.channel.setTyping?.(ctx.chatJid, true);

    // Send a fast acknowledgement
    try {
        updateSwarmStatus({
            groupFolder: ctx.group.folder,
            stage: ctx.stageHint,
            item: 'processing messages',
            files: ['groups/main/todo.md', `groups/${ctx.group.folder}/swarmdev/status.md`],
            next: 'waiting for agent output',
        });
        writeSwarmMetrics(ctx.group.folder, {
            stage: ctx.stageHint,
            item: 'processing messages',
            next: 'waiting for agent output',
            chatJid: ctx.chatJid,
            note: 'ack',
        });
        appendSwarmEvent(ctx.group.folder, {
            kind: 'ack',
            stage: ctx.stageHint,
            item: 'processing messages',
            next: 'waiting for agent output',
            chatJid: ctx.chatJid,
        });
        appendSwarmAction(ctx.group.folder, {
            action: 'ack',
            stage: ctx.stageHint,
            detail: 'processing messages',
            meta: { chatJid: ctx.chatJid },
        });
        await maybeSendProcessingAck({
            chatJid: ctx.chatJid,
            isMainGroup: ctx.isMainGroup,
            groupRequiresTrigger: ctx.group.requiresTrigger,
        }, { sendMessage: (jid: string, text: string) => deps.channel.sendMessage(jid, text) });
    } catch {
        // Non-fatal: ack is best-effort.
    }

    heartbeatTimer = setInterval(() => {
        try {
            if (IS_DEBUG_MODE) {
                appendSwarmEvent(ctx.group.folder, {
                    kind: 'status',
                    stage: ctx.stageHint,
                    item: 'still processing',
                    next: 'waiting for agent output',
                    chatJid: ctx.chatJid,
                    msg: 'heartbeat',
                });
                appendSwarmAction(ctx.group.folder, {
                    action: 'still_processing',
                    stage: ctx.stageHint,
                    detail: 'heartbeat: agent still processing',
                    meta: { chatJid: ctx.chatJid },
                });
            }
            updateSwarmStatus({
                groupFolder: ctx.group.folder,
                stage: ctx.stageHint,
                item: 'still processing',
                files: [`groups/${ctx.group.folder}/swarmdev/status.md`],
                next: 'waiting for agent output',
            });
        } catch {
            // ignore heartbeat failures
        }
    }, RUNTIME_HEARTBEAT_MS);

    const timers: PhaseTimers = {
        idleTimer,
        dashIdleTimer,
        heartbeatTimer,
        resetIdleTimer,
        scheduleDashIdle,
    };

    return timers;
}
