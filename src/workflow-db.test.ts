import { describe, it, expect, beforeEach } from 'vitest';
import {
    _initTestDatabase,
    upsertWorkflowTask,
    getWorkflowTask,
    getWorkflowTasksByGroup,
    getBlockedWorkflowTasks,
    insertWorkflowTransition,
    getWorkflowTransitions,
    deleteWorkflowTask,
} from './db.js';

beforeEach(() => {
    _initTestDatabase();
});

describe('upsertWorkflowTask', () => {
    it('inserts a new task', () => {
        upsertWorkflowTask({
            taskId: 'MKT-001',
            groupFolder: 'main',
            stage: 'DEV',
            status: 'running',
            retries: 0,
            pendingQuestions: [],
            decisions: [],
        });
        const task = getWorkflowTask('MKT-001', 'main');
        expect(task).toBeDefined();
        expect(task!.stage).toBe('DEV');
        expect(task!.status).toBe('running');
        expect(task!.retries).toBe(0);
    });

    it('updates existing task on conflict', () => {
        upsertWorkflowTask({
            taskId: 'MKT-001',
            groupFolder: 'main',
            stage: 'DEV',
            status: 'running',
            retries: 0,
            pendingQuestions: [],
            decisions: [],
        });
        upsertWorkflowTask({
            taskId: 'MKT-001',
            groupFolder: 'main',
            stage: 'QA',
            status: 'running',
            retries: 1,
            pendingQuestions: ['¿Revisar?'],
            decisions: ['aprobado'],
            lastError: 'timeout',
        });
        const task = getWorkflowTask('MKT-001', 'main');
        expect(task!.stage).toBe('QA');
        expect(task!.retries).toBe(1);
        expect(task!.last_error).toBe('timeout');
        expect(JSON.parse(task!.pending_questions)).toEqual(['¿Revisar?']);
    });
});

describe('getWorkflowTasksByGroup', () => {
    it('returns tasks for group', () => {
        upsertWorkflowTask({ taskId: 'A-001', groupFolder: 'main', stage: 'DEV', status: 'running', retries: 0, pendingQuestions: [], decisions: [] });
        upsertWorkflowTask({ taskId: 'A-002', groupFolder: 'main', stage: 'QA', status: 'running', retries: 0, pendingQuestions: [], decisions: [] });
        upsertWorkflowTask({ taskId: 'B-001', groupFolder: 'other', stage: 'PM', status: 'running', retries: 0, pendingQuestions: [], decisions: [] });
        const tasks = getWorkflowTasksByGroup('main');
        expect(tasks).toHaveLength(2);
    });
});

describe('getBlockedWorkflowTasks', () => {
    it('returns only blocked tasks', () => {
        upsertWorkflowTask({ taskId: 'A-001', groupFolder: 'main', stage: 'DEV', status: 'running', retries: 0, pendingQuestions: [], decisions: [] });
        upsertWorkflowTask({ taskId: 'A-002', groupFolder: 'main', stage: 'BLOCKED', status: 'blocked', retries: 3, pendingQuestions: [], decisions: [] });
        const blocked = getBlockedWorkflowTasks('main');
        expect(blocked).toHaveLength(1);
        expect(blocked[0].task_id).toBe('A-002');
    });
});

describe('workflow transitions', () => {
    it('inserts and retrieves transitions', () => {
        insertWorkflowTransition({ taskId: 'MKT-001', groupFolder: 'main', fromStage: 'DEV', toStage: 'QA', reason: 'tests pass' });
        insertWorkflowTransition({ taskId: 'MKT-001', groupFolder: 'main', fromStage: 'QA', toStage: 'DONE' });
        const transitions = getWorkflowTransitions('MKT-001', 'main');
        expect(transitions).toHaveLength(2);
        expect(transitions[0].from_stage).toBe('DEV');
        expect(transitions[0].to_stage).toBe('QA');
        expect(transitions[0].reason).toBe('tests pass');
        expect(transitions[1].reason).toBeNull();
    });
});

describe('deleteWorkflowTask', () => {
    it('removes task and transitions', () => {
        upsertWorkflowTask({ taskId: 'MKT-001', groupFolder: 'main', stage: 'DEV', status: 'running', retries: 0, pendingQuestions: [], decisions: [] });
        insertWorkflowTransition({ taskId: 'MKT-001', groupFolder: 'main', fromStage: 'PM', toStage: 'DEV' });
        deleteWorkflowTask('MKT-001', 'main');
        expect(getWorkflowTask('MKT-001', 'main')).toBeUndefined();
        expect(getWorkflowTransitions('MKT-001', 'main')).toEqual([]);
    });
});
