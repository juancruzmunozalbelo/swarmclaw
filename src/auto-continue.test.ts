import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
    AUTO_CONTINUE: true,
    APP_MODE: 'prod',
    SWARM_EXEC_MODE: 'strict',
    SWARM_AUTONOMOUS_MODE: false,
    BACKLOG_FREEZE_PREFIX: 'MKT',
    BACKLOG_FREEZE_ACTIVE_TASK: 'MKT-002',
    ASSISTANT_NAME: 'swarclaw',
}));
vi.mock('./swarm-workflow.js', () => ({
    getBlockedTasks: vi.fn(() => []),
}));
vi.mock('./runtime-metrics.js', () => ({
    readRuntimeMetrics: vi.fn(() => null),
}));
vi.mock('./swarm-events.js', () => ({
    appendSwarmAction: vi.fn(),
}));
vi.mock('./todo-manager.js', () => ({
    collectPendingRelatedTasks: vi.fn(() => ['MKT-002', 'MKT-003']),
}));

import {
    isAutoContinueEnabled,
    applyBacklogFreeze,
    hasBlockingQuestionsInScope,
    deployValidationLoopTriggered,
    maybeQueueAutoContinueNudge,
    _resetAutoContinueState,
} from './auto-continue.js';
import { getBlockedTasks } from './swarm-workflow.js';

beforeEach(() => {
    _resetAutoContinueState();
    vi.clearAllMocks();
});

describe('isAutoContinueEnabled', () => {
    it('returns true in prod mode with AUTO_CONTINUE', () => {
        expect(isAutoContinueEnabled()).toBe(true);
    });
});

describe('applyBacklogFreeze', () => {
    it('filters frozen tasks, keeps active', () => {
        const result = applyBacklogFreeze(['MKT-001', 'MKT-002', 'MKT-003', 'AUTH-001']);
        expect(result).toContain('MKT-002');
        expect(result).toContain('AUTH-001');
        expect(result).not.toContain('MKT-001');
        expect(result).not.toContain('MKT-003');
    });

    it('passes through non-prefixed tasks', () => {
        const result = applyBacklogFreeze(['AUTH-001', 'INFRA-002']);
        expect(result).toEqual(['AUTH-001', 'INFRA-002']);
    });

    it('handles empty input', () => {
        expect(applyBacklogFreeze([])).toEqual([]);
    });
});

describe('hasBlockingQuestionsInScope', () => {
    it('returns false when no blocked tasks', () => {
        expect(hasBlockingQuestionsInScope('main', ['MKT-001'])).toBe(false);
    });

    it('returns true when blocked task matches scope', () => {
        vi.mocked(getBlockedTasks).mockReturnValueOnce([
            { taskId: 'MKT-001', stage: 'BLOCKED', status: 'blocked', retries: 0, pendingQuestions: ['?'], decisions: [], createdAt: '', updatedAt: '', transitions: [] },
        ] as any);
        expect(hasBlockingQuestionsInScope('main', ['MKT-001'])).toBe(true);
    });

    it('returns true when blocked task shares prefix', () => {
        vi.mocked(getBlockedTasks).mockReturnValueOnce([
            { taskId: 'MKT-099', stage: 'BLOCKED', status: 'blocked', retries: 0, pendingQuestions: ['?'], decisions: [], createdAt: '', updatedAt: '', transitions: [] },
        ] as any);
        expect(hasBlockingQuestionsInScope('main', ['MKT-001'])).toBe(true);
    });
});

describe('deployValidationLoopTriggered', () => {
    it('returns false below threshold', () => {
        expect(deployValidationLoopTriggered('MKT-001')).toBe(false);
        expect(deployValidationLoopTriggered('MKT-001')).toBe(false);
    });

    it('returns true at threshold', () => {
        deployValidationLoopTriggered('MKT-001');
        deployValidationLoopTriggered('MKT-001');
        expect(deployValidationLoopTriggered('MKT-001')).toBe(true);
    });

    it('isolates by task ID', () => {
        deployValidationLoopTriggered('MKT-001');
        deployValidationLoopTriggered('MKT-001');
        expect(deployValidationLoopTriggered('MKT-002')).toBe(false);
    });
});

describe('maybeQueueAutoContinueNudge', () => {
    const mockDeps = { queueSendMessage: vi.fn(() => true) };

    it('sends nudge when enabled', () => {
        const result = maybeQueueAutoContinueNudge({
            groupFolder: 'main',
            chatJid: 'chat@g.us',
            taskIds: ['MKT-002'],
            reason: 'post_output',
        }, mockDeps);
        expect(result).toBe(true);
        expect(mockDeps.queueSendMessage).toHaveBeenCalled();
    });

    it('respects cooldown', () => {
        maybeQueueAutoContinueNudge({
            groupFolder: 'main',
            chatJid: 'chat@g.us',
            taskIds: ['MKT-002'],
            reason: 'post_output',
        }, mockDeps);
        const result = maybeQueueAutoContinueNudge({
            groupFolder: 'main',
            chatJid: 'chat@g.us',
            taskIds: ['MKT-002'],
            reason: 'post_output',
        }, mockDeps);
        expect(result).toBe(false);
    });

    it('returns false when queue rejects', () => {
        const rejectDeps = { queueSendMessage: vi.fn(() => false) };
        const result = maybeQueueAutoContinueNudge({
            groupFolder: 'main',
            chatJid: 'chat@g.us',
            taskIds: ['MKT-002'],
            reason: 'post_output',
        }, rejectDeps);
        expect(result).toBe(false);
    });
});
