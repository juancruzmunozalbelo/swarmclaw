/**
 * Phase 1: Setup & Message Fetch
 * Normalize todo, fetch pending messages, infer stage, extract task IDs,
 * apply backlog freeze, build prompt.
 *
 * Sprint 3 — Extracted from processGroupMessages L289-L388.
 */

import {
    MAIN_GROUP_FOLDER,
    TASK_MICRO_BATCH_MAX,
    TRIGGER_PATTERN,
    ASSISTANT_NAME,
    BACKLOG_FREEZE_PREFIX,
    BACKLOG_FREEZE_ACTIVE_TASK,
} from '../config.js';
import { getMessagesSince } from '../db.js';
import { inferStageHint } from '../text-helpers.js';
import { normalizeTodoFile } from '../todo-normalizer.js';
import { extractTaskIds } from '../swarm-workflow.js';
import { buildTeamLeadPrompt } from '../prompt-builder.js';
import { ensureTodoTracking } from '../todo-manager.js';
import { applyBacklogFreeze } from '../auto-continue.js';
import { appendSwarmAction } from '../swarm-events.js';
import type { NewMessage, RegisteredGroup } from '../types.js';
import type { PhaseContext } from './types.js';

/**
 * Run setup phase: normalize todo, fetch messages, extract task IDs, build prompt.
 * Returns null if there's nothing to process (no messages, trigger required but absent).
 */
export async function setupPhase(
    chatJid: string,
    group: RegisteredGroup,
    lastAgentTimestamp: Record<string, string>,
): Promise<PhaseContext | null> {
    const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

    // Keep todo source-of-truth normalized automatically on each cycle.
    try {
        const normalized = normalizeTodoFile(group.folder);
        if (normalized.changed) {
            appendSwarmAction(group.folder, {
                action: 'todo_normalized',
                stage: 'TEAMLEAD',
                detail: `todo normalized automatically (kept=${normalized.kept}, removed=${normalized.removed})`,
                files: [`groups/${group.folder}/todo.md`],
                meta: { kept: normalized.kept, removed: normalized.removed },
            });
        }
    } catch {
        // ignore todo normalization errors
    }

    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const missedMessages: NewMessage[] = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME) as NewMessage[];

    if (missedMessages.length === 0) return null;

    // For non-main groups, check if trigger is required and present
    if (!isMainGroup && group.requiresTrigger !== false) {
        const hasTrigger = missedMessages.some((m: NewMessage) =>
            TRIGGER_PATTERN.test(m.content.trim()),
        );
        if (!hasTrigger) return null;
    }

    const stageHint = inferStageHint(missedMessages[missedMessages.length - 1]?.content || '');
    let taskIds: string[] = [
        ...new Set(
            missedMessages.flatMap((m: NewMessage) => extractTaskIds(m.content || '')),
        ),
    ] as string[];
    try {
        const latestScope = missedMessages[missedMessages.length - 1]?.content || '';
        const created = await ensureTodoTracking({
            groupFolder: group.folder,
            stageHint,
            taskIds,
            messageScope: latestScope,
        });
        if (created.length > 0) {
            taskIds = [...new Set([...taskIds, ...created])];
            appendSwarmAction(group.folder, {
                action: 'todo_auto_track',
                stage: stageHint,
                detail: `auto-tracked tasks in todo: ${created.join(', ')}`,
                files: [`groups/${group.folder}/todo.md`],
                meta: { created },
            });
        }
    } catch {
        // ignore todo auto-tracking failures
    }
    if (taskIds.length > TASK_MICRO_BATCH_MAX) {
        const deferred = taskIds.slice(TASK_MICRO_BATCH_MAX);
        const active = taskIds.slice(0, TASK_MICRO_BATCH_MAX);
        appendSwarmAction(group.folder, {
            action: 'micro_batch_enforced',
            stage: stageHint,
            detail: `micro-batch capped to ${TASK_MICRO_BATCH_MAX} tasks`,
            meta: { active, deferred, max: TASK_MICRO_BATCH_MAX },
        });
        taskIds = active;
    }
    const frozenTaskIds = applyBacklogFreeze(taskIds);
    if (frozenTaskIds.length !== taskIds.length) {
        const dropped = taskIds.filter((id) => !frozenTaskIds.includes(id));
        appendSwarmAction(group.folder, {
            action: 'backlog_freeze_applied',
            stage: stageHint,
            detail: `backlog freeze filtered tasks (${taskIds.length} -> ${frozenTaskIds.length})`,
            meta: {
                prefix: BACKLOG_FREEZE_PREFIX,
                activeTask: BACKLOG_FREEZE_ACTIVE_TASK || null,
                kept: frozenTaskIds,
                dropped,
            },
        });
        taskIds = frozenTaskIds;
    }
    const prompt = buildTeamLeadPrompt({
        messages: missedMessages,
        taskIds,
        stageHint,
    });

    return {
        chatJid,
        group,
        isMainGroup,
        stageHint,
        taskIds,
        missedMessages,
        prompt,
        previousCursor: '',
        hadError: false,
        outputSentToUser: false,
        validationViolation: false,
    };
}
