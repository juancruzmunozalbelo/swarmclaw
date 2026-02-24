/**
 * Phase 2: Pre-flight & Parallel Dispatch
 * Ensure workflow tasks, update metrics, resolve blocked questions.
 *
 * Sprint 3 — Extracted from processGroupMessages L389-L815.
 *
 * NOTE: `maybeDispatchParallelSubagents` (362 lines) remains in index.ts
 * because it captures too many closure variables and config-level imports.
 * This module handles the non-dispatch preflight logic.
 */

import {
    ensureWorkflowTasks,
    getBlockedTasks,
    getTaskWorkflowState,
    resolveTaskQuestions,
} from '../swarm-workflow.js';
import { updateRuntimeMetrics } from '../runtime-metrics.js';
import { appendSwarmAction } from '../swarm-events.js';
import type { PhaseContext } from './types.js';

/**
 * Run pre-flight phase: ensure workflow tasks, update metrics, resolve blocked questions.
 * The `maybeDispatchParallelSubagents` call is made by the orchestrator separately.
 */
export function preflightPhase(ctx: PhaseContext): void {
    if (ctx.taskIds.length > 0) {
        try {
            ensureWorkflowTasks(ctx.group.folder, ctx.taskIds);
            appendSwarmAction(ctx.group.folder, {
                action: 'task_detected',
                stage: ctx.stageHint,
                detail: `detected task ids: ${ctx.taskIds.join(', ')}`,
                meta: { taskIds: ctx.taskIds },
            });
        } catch {
            // ignore
        }
    }
    try {
        updateRuntimeMetrics({
            groupFolder: ctx.group.folder,
            increments: { requestsStarted: 1 },
            lastStage: ctx.stageHint,
            lastTaskIds: ctx.taskIds.length > 0 ? ctx.taskIds : undefined,
            lastError: undefined,
        });
    } catch {
        // ignore
    }

    // Resolve blocked questions
    try {
        const blocked = getBlockedTasks(ctx.group.folder);
        const decisionTargets = new Set<string>(ctx.taskIds);
        if (decisionTargets.size === 0 && blocked.length === 1) {
            decisionTargets.add(blocked[0].taskId);
        }
        if (decisionTargets.size > 0) {
            const decisionNote = ctx.missedMessages
                .map((m) => (m.content || '').trim())
                .filter(Boolean)
                .join(' | ')
                .slice(0, 500);
            for (const taskId of decisionTargets) {
                const wf = getTaskWorkflowState(ctx.group.folder, taskId);
                if (wf.pendingQuestions.length === 0) continue;
                resolveTaskQuestions({
                    groupFolder: ctx.group.folder,
                    taskId,
                    decision: decisionNote,
                });
                updateRuntimeMetrics({
                    groupFolder: ctx.group.folder,
                    increments: { blockedQuestionsResolved: 1 },
                    lastStage: 'TEAMLEAD',
                    lastTaskIds: [taskId],
                    lastError: undefined,
                });
                appendSwarmAction(ctx.group.folder, {
                    action: 'blocked_questions_resolved',
                    stage: 'TEAMLEAD',
                    detail: `resolved pending questions for ${taskId}`,
                    meta: { taskId },
                });
            }
        }
    } catch {
        // ignore
    }
}
