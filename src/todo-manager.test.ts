import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/nanoclaw-test-todo-groups',
}));

vi.mock('./prompt-builder.js', () => ({
    ownerFromStageHint: (s: string) => s === 'PM' ? 'PM' : 'team-lead',
}));

vi.mock('./text-helpers.js', () => ({
    normalizeScope: (s: string) => s.slice(0, 140),
}));

vi.mock('./db.js', () => ({
    getWorkflowTask: vi.fn(() => undefined),
    upsertWorkflowTask: vi.fn(),
}));

import {
    parseTodoTaskContext,
    shouldAutoTrackScope,
    ensureTodoTracking,
    setTodoState,
    pendingTodoIdsForEpic,
    collectPendingRelatedTasks,
} from './todo-manager.js';

const GROUPS_DIR = '/tmp/nanoclaw-test-todo-groups';

function setupTodo(groupFolder: string, content: string) {
    const dir = path.join(GROUPS_DIR, groupFolder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'todo.md'), content, 'utf-8');
}

function readTodo(groupFolder: string): string {
    return fs.readFileSync(path.join(GROUPS_DIR, groupFolder, 'todo.md'), 'utf-8');
}

beforeEach(() => {
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
    fs.mkdirSync(GROUPS_DIR, { recursive: true });
});

afterEach(() => {
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
});

describe('parseTodoTaskContext', () => {
    it('parses task owner, scope, state', () => {
        setupTodo('main', [
            '# TODO',
            '- ID: ECOM-001',
            '  Owner: dev-sr',
            '  Scope: Implement login',
            '  Estado: doing',
        ].join('\n'));
        const ctx = parseTodoTaskContext('main', 'ECOM-001');
        expect(ctx).toEqual({ owner: 'dev-sr', scope: 'Implement login', state: 'doing' });
    });

    it('returns null for missing task', () => {
        setupTodo('main', '# TODO\n- ID: ECOM-001\n  Owner: dev\n');
        expect(parseTodoTaskContext('main', 'ECOM-999')).toBeNull();
    });

    it('returns null for missing file', () => {
        expect(parseTodoTaskContext('nonexistent', 'ECOM-001')).toBeNull();
    });
});

describe('shouldAutoTrackScope', () => {
    it('rejects short or noise scopes', () => {
        expect(shouldAutoTrackScope('')).toBe(false);
        expect(shouldAutoTrackScope('ok')).toBe(false);
        expect(shouldAutoTrackScope('dale')).toBe(false);
        expect(shouldAutoTrackScope('hola que tal')).toBe(false);
    });
    it('accepts meaningful scopes', () => {
        expect(shouldAutoTrackScope('Implementar sistema de login con JWT')).toBe(true);
    });
});

describe('setTodoState', () => {
    it('changes task state', () => {
        setupTodo('main', [
            '- ID: ECOM-001',
            '  Owner: dev',
            '  Estado: todo',
        ].join('\n'));
        const changed = setTodoState({ groupFolder: 'main', taskId: 'ECOM-001', state: 'doing' });
        expect(changed).toBe(true);
        expect(readTodo('main')).toContain('Estado: doing');
    });

    it('returns false for no change', () => {
        setupTodo('main', '- ID: ECOM-001\n  Estado: done\n');
        expect(setTodoState({ groupFolder: 'main', taskId: 'ECOM-001', state: 'done' })).toBe(false);
    });

    it('auto-advances dependent task when done', () => {
        setupTodo('main', [
            '- ID: ECOM-001',
            '  Estado: doing',
            '- ID: ECOM-002',
            '  Dependencias: ECOM-001',
            '  Estado: todo',
        ].join('\n'));
        setTodoState({ groupFolder: 'main', taskId: 'ECOM-001', state: 'done' });
        const content = readTodo('main');
        expect(content).toMatch(/ECOM-001[\s\S]*Estado: done/);
        expect(content).toMatch(/ECOM-002[\s\S]*Estado: doing/);
    });

    it('skips auto-advance when skipAutoAdvance is true', () => {
        setupTodo('main', [
            '- ID: ECOM-001',
            '  Estado: doing',
            '- ID: ECOM-002',
            '  Dependencias: ECOM-001',
            '  Estado: todo',
        ].join('\n'));
        setTodoState({ groupFolder: 'main', taskId: 'ECOM-001', state: 'done', skipAutoAdvance: true });
        const content = readTodo('main');
        expect(content).toMatch(/ECOM-002[\s\S]*Estado: todo/);
    });
});

describe('pendingTodoIdsForEpic', () => {
    it('returns non-done tasks with same prefix', () => {
        setupTodo('main', [
            '- ID: ECOM-001',
            '  Estado: done',
            '- ID: ECOM-002',
            '  Estado: todo',
            '- ID: ECOM-003',
            '  Estado: doing',
            '- ID: MKT-001',
            '  Estado: todo',
        ].join('\n'));
        const pending = pendingTodoIdsForEpic('main', 'ECOM-001');
        expect(pending).toContain('ECOM-002');
        expect(pending).toContain('ECOM-003');
        expect(pending).not.toContain('ECOM-001'); // self excluded
        expect(pending).not.toContain('MKT-001'); // different prefix
    });
});

describe('collectPendingRelatedTasks', () => {
    it('collects from multiple task IDs', () => {
        setupTodo('main', [
            '- ID: ECOM-001',
            '  Estado: done',
            '- ID: ECOM-002',
            '  Estado: todo',
            '- ID: MKT-001',
            '  Estado: done',
            '- ID: MKT-002',
            '  Estado: doing',
        ].join('\n'));
        const related = collectPendingRelatedTasks('main', ['ECOM-001', 'MKT-001']);
        expect(related).toContain('ECOM-002');
        expect(related).toContain('MKT-002');
    });
});

describe('ensureTodoTracking', () => {
    it('creates new task entries', () => {
        setupTodo('main', '# TODO\n\n## Auto Inbox\n');
        const created = ensureTodoTracking({
            groupFolder: 'main',
            stageHint: 'PM',
            taskIds: ['ECOM-010'],
            messageScope: 'New feature X',
        });
        expect(created).toContain('ECOM-010');
        expect(readTodo('main')).toContain('- ID: ECOM-010');
    });

    it('does not duplicate existing IDs', () => {
        setupTodo('main', '# TODO\n- ID: ECOM-010\n  Owner: dev\n\n## Auto Inbox\n');
        const created = ensureTodoTracking({
            groupFolder: 'main',
            stageHint: 'PM',
            taskIds: ['ECOM-010'],
            messageScope: 'feature',
        });
        expect(created).toHaveLength(0);
    });
});
