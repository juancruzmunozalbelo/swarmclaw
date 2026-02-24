import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NewMessage } from './types.js';
import fs from 'fs';
import path from 'path';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/nanoclaw-test-lane-groups',
    MAIN_CONTEXT_MESSAGES: 40,
}));

vi.mock('./swarm-workflow.js', () => ({
    getTaskWorkflowState: () => ({ stage: 'DEV' }),
}));

vi.mock('./swarm-events.js', () => ({
    appendSwarmAction: vi.fn(),
    appendSwarmTransitionAction: vi.fn(() => true),
}));

import { _initTestDatabase } from './db.js';

import {
    loadLaneState,
    saveLaneState,
    laneTemplate,
    upsertTaskLaneState,
    reconcileLaneStateOnBoot,
    trimMainContextMessages,
} from './lane-manager.js';

import { upsertLaneState, upsertWorkflowTask } from './db.js';

const GROUPS_DIR = '/tmp/nanoclaw-test-lane-groups';

beforeEach(() => {
    _initTestDatabase();
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(GROUPS_DIR, 'main', 'swarmdev'), { recursive: true });
});

afterEach(() => {
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
});

describe('laneTemplate', () => {
    it('creates all 8 roles with idle state', () => {
        const template = laneTemplate();
        const roles = ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'] as const;
        for (const role of roles) {
            expect(template[role].state).toBe('idle');
        }
    });
});

describe('loadLaneState / saveLaneState', () => {
    it('returns empty state when DB is empty', () => {
        const state = loadLaneState('main');
        expect(state.version).toBe(1);
        expect(Object.keys(state.tasks)).toHaveLength(0);
    });

    it('roundtrips state correctly', () => {
        // Write lane to DB directly
        upsertLaneState({
            taskId: 'ECOM-001',
            groupFolder: 'main',
            role: 'PM',
            state: 'done',
        });

        const reloaded = loadLaneState('main');
        expect(reloaded.tasks['ECOM-001'].lanes.PM.state).toBe('done');
    });

    it('saveLaneState writes to DB and can be reloaded', () => {
        const state = loadLaneState('main');
        const task = upsertTaskLaneState(state, 'ECOM-002');
        task.lanes.SPEC.state = 'working';
        saveLaneState('main', state);

        const reloaded = loadLaneState('main');
        expect(reloaded.tasks['ECOM-002'].lanes.SPEC.state).toBe('working');
    });
});

describe('reconcileLaneStateOnBoot', () => {
    it('auto-fails stale working lanes', () => {
        // Seed a workflow_task row so the lane isn't treated as an orphan
        upsertWorkflowTask({
            taskId: 'ECOM-001', groupFolder: 'main', stage: 'DEV',
            status: 'running', retries: 0, pendingQuestions: [], decisions: [],
        });
        // Insert a stale lane directly via DB
        upsertLaneState({
            taskId: 'ECOM-001',
            groupFolder: 'main',
            role: 'DEV',
            state: 'working',
        });
        // Manually backdate the updated_at to 4h ago
        const state = loadLaneState('main');
        state.tasks['ECOM-001'].lanes.DEV.updatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        state.tasks['ECOM-001'].lanes.DEV.state = 'working';
        saveLaneState('main', state);

        const result = reconcileLaneStateOnBoot('main', 3 * 60 * 60 * 1000); // 3h threshold
        expect(result.changed).toBe(true);
        expect(result.staleLanes).toBe(1);
        expect(result.touchedTasks).toContain('ECOM-001');

        const reloaded = loadLaneState('main');
        expect(reloaded.tasks['ECOM-001'].lanes.DEV.state).toBe('failed');
    });

    it('does not touch fresh lanes', () => {
        // Seed a workflow_task row so the lane isn't treated as an orphan
        upsertWorkflowTask({
            taskId: 'ECOM-001', groupFolder: 'main', stage: 'DEV',
            status: 'running', retries: 0, pendingQuestions: [], decisions: [],
        });
        upsertLaneState({
            taskId: 'ECOM-001',
            groupFolder: 'main',
            role: 'DEV',
            state: 'working',
        });

        const result = reconcileLaneStateOnBoot('main', 3 * 60 * 60 * 1000);
        expect(result.changed).toBe(false);
        expect(result.staleLanes).toBe(0);
    });
});

describe('trimMainContextMessages', () => {
    it('trims messages beyond max', () => {
        const msgs = Array.from({ length: 50 }, (_, i) => ({ id: i })) as unknown as NewMessage[];
        const result = trimMainContextMessages(msgs);
        expect(result.messages.length).toBe(40);
        expect(result.dropped).toBe(10);
    });

    it('does not trim when within limit', () => {
        const msgs = Array.from({ length: 10 }, (_, i) => ({ id: i })) as unknown as NewMessage[];
        const result = trimMainContextMessages(msgs);
        expect(result.messages.length).toBe(10);
        expect(result.dropped).toBe(0);
    });
});
