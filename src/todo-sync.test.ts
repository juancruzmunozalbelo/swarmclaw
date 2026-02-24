import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/test-groups',
}));
vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import fs from 'fs';
import {
    _initTestDatabase,
    upsertWorkflowTask,
    getWorkflowTask,
} from './db.js';
import { syncTodoFileToSqlite } from './todo-sync.js';

beforeEach(() => {
    _initTestDatabase();
    vi.restoreAllMocks();
});

describe('syncTodoFileToSqlite', () => {
    it('returns 0 when todo.md does not exist', () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        expect(syncTodoFileToSqlite('main')).toBe(0);
    });

    it('syncs tasks from todo.md', () => {
        const todoContent = [
            '# Todo',
            '- ID: MKT-001',
            '  Scope: marketing',
            '  Estado: doing',
            '- ID: MKT-002',
            '  Scope: auth',
            '  Estado: done',
        ].join('\n');
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(todoContent);

        const synced = syncTodoFileToSqlite('main');
        expect(synced).toBe(2);

        const task1 = getWorkflowTask('MKT-001', 'main');
        expect(task1).toBeDefined();
        expect(task1!.stage).toBe('DEV');
        expect(task1!.status).toBe('running');

        const task2 = getWorkflowTask('MKT-002', 'main');
        expect(task2).toBeDefined();
        expect(task2!.stage).toBe('DONE');
        expect(task2!.status).toBe('done');
    });

    it('skips tasks already in SQLite', () => {
        upsertWorkflowTask({
            taskId: 'MKT-001',
            groupFolder: 'main',
            stage: 'QA',
            status: 'running',
            retries: 2,
            pendingQuestions: [],
            decisions: [],
        });

        const todoContent = [
            '- ID: MKT-001',
            '  Estado: doing',
            '- ID: MKT-002',
            '  Estado: todo',
        ].join('\n');
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(todoContent);

        const synced = syncTodoFileToSqlite('main');
        expect(synced).toBe(1); // Only MKT-002 synced

        // MKT-001 should retain its original runtime state
        const task1 = getWorkflowTask('MKT-001', 'main');
        expect(task1!.stage).toBe('QA');
        expect(task1!.retries).toBe(2);
    });
});
