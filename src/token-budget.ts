/**
 * Token Budget — per-task token usage tracking and enforcement.
 * Prevents runaway costs by blocking agent calls when a task exceeds its budget.
 *
 * Sprint 2 — Audit item #9.
 */

import {
    getWorkflowTask,
    upsertWorkflowTask,
} from './db.js';
import { MAIN_GROUP_FOLDER } from './config.js';
import { logger } from './logger.js';

// Default: 2M tokens per task. Override via TASK_TOKEN_BUDGET env.
const DEFAULT_BUDGET = Number(process.env.TASK_TOKEN_BUDGET || 2_000_000);

export interface BudgetStatus {
    ok: boolean;
    used: number;
    limit: number;
    remaining: number;
}

/**
 * Check if a task is within its token budget.
 */
export function checkBudget(groupFolder: string, taskId: string): BudgetStatus {
    const gf = groupFolder || MAIN_GROUP_FOLDER;
    const row = getWorkflowTask(taskId, gf);
    const used = Number((row as unknown as Record<string, unknown>)?.tokens_used ?? 0);
    const limit = DEFAULT_BUDGET;
    const remaining = Math.max(0, limit - used);
    return { ok: used < limit, used, limit, remaining };
}

/**
 * Record token usage for a task. Increments the running total.
 * Returns the updated budget status.
 */
export function recordTokenUsage(
    groupFolder: string,
    taskId: string,
    tokens: number,
): BudgetStatus {
    const gf = groupFolder || MAIN_GROUP_FOLDER;
    const row = getWorkflowTask(taskId, gf);
    if (!row) {
        logger.warn({ taskId, groupFolder: gf }, 'recordTokenUsage: task not found in DB');
        return { ok: true, used: 0, limit: DEFAULT_BUDGET, remaining: DEFAULT_BUDGET };
    }

    const current = Number((row as unknown as Record<string, unknown>)?.tokens_used ?? 0);
    const updated = current + Math.max(0, Math.round(tokens));

    // Update the task row with new token count
    upsertWorkflowTask({
        taskId: row.task_id,
        groupFolder: gf,
        stage: row.stage,
        status: row.status,
        retries: row.retries,
        pendingQuestions: JSON.parse(row.pending_questions || '[]'),
        decisions: JSON.parse(row.decisions || '[]'),
        lastError: row.last_error,
        tokensUsed: updated,
    });

    const limit = DEFAULT_BUDGET;
    const remaining = Math.max(0, limit - updated);

    if (updated >= limit) {
        logger.warn(
            { taskId, groupFolder: gf, used: updated, limit },
            'Task exceeded token budget',
        );
    }

    return { ok: updated < limit, used: updated, limit, remaining };
}
