/**
 * Todo Sync — boot-time ingestion of existing todo.md files into SQLite.
 * Phase 1 of the todo.md → SQLite migration.
 */

import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { upsertWorkflowTask, getWorkflowTask } from './db.js';
import { parseTodoMeta, normalizeTodoStateValue } from './todo-manager.js';
import { logger } from './logger.js';

const STAGE_MAP: Record<string, string> = {
    planning: 'TEAMLEAD',
    todo: 'TEAMLEAD',
    doing: 'DEV',
    blocked: 'BLOCKED',
    done: 'DONE',
};

/**
 * Read todo.md for a group and upsert all tasks into SQLite.
 * Only inserts tasks that don't already exist in the database
 * (avoids overwriting runtime state).
 */
export function syncTodoFileToSqlite(groupFolder: string): number {
    const todoPath = path.join(GROUPS_DIR, groupFolder, 'todo.md');
    if (!fs.existsSync(todoPath)) return 0;

    const content = fs.readFileSync(todoPath, 'utf-8');
    const lines = content.split('\n');
    const items = parseTodoMeta(lines);

    let synced = 0;
    for (const item of items) {
        // Skip if already in SQLite (don't overwrite runtime state)
        const existing = getWorkflowTask(item.id, groupFolder);
        if (existing) continue;

        const state = normalizeTodoStateValue(item.state);
        try {
            upsertWorkflowTask({
                taskId: item.id,
                groupFolder,
                stage: STAGE_MAP[state] || 'TEAMLEAD',
                status: state === 'blocked' ? 'blocked' : state === 'done' ? 'done' : 'running',
                retries: 0,
                pendingQuestions: [],
                decisions: [],
            });
            synced++;
        } catch {
            // best-effort
        }
    }

    if (synced > 0) {
        logger.info({ groupFolder, synced, total: items.length }, 'Synced todo.md tasks to SQLite');
    }
    return synced;
}


