import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('./swarm-events.js', () => ({
    appendSwarmEvent: vi.fn(),
    appendSwarmAction: vi.fn(),
}));
vi.mock('./runtime-metrics.js', () => ({
    updateRuntimeMetrics: vi.fn(),
}));

import {
    handlePostAgentError,
    clearErrorStreak,
    _resetErrorRecoveryState,
    _getErrorStreak,
    type ErrorRecoveryDeps,
} from './error-recovery.js';
import { appendSwarmAction } from './swarm-events.js';
import { updateRuntimeMetrics } from './runtime-metrics.js';

function makeDeps(overrides?: Partial<ErrorRecoveryDeps>): ErrorRecoveryDeps {
    return {
        groupFolder: 'main',
        groupName: 'TestGroup',
        chatJid: 'test@jid',
        taskIds: ['MKT-001'],
        validationViolation: false,
        assistantName: 'Andy',
        errorNoticeCooldownMs: 45_000,
        errorStreakWindowMs: 20 * 60_000,
        errorStreakThreshold: 3,
        sendMessage: vi.fn().mockResolvedValue(undefined),
        closeStdin: vi.fn(),
        queueSendMessage: vi.fn().mockReturnValue(false),
        logWarn: vi.fn(),
        ...overrides,
    };
}

describe('handlePostAgentError', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetErrorRecoveryState();
    });

    it('sends error notice on first error', async () => {
        const deps = makeDeps();
        const result = await handlePostAgentError(deps);

        expect(result.noticeSent).toBe(true);
        expect(deps.sendMessage).toHaveBeenCalled();
        expect(updateRuntimeMetrics).toHaveBeenCalledWith(
            expect.objectContaining({ increments: { agentErrors: 1 } }),
        );
    });

    it('respects notice cooldown', async () => {
        const deps = makeDeps();
        await handlePostAgentError(deps);

        // Second call within cooldown
        const result2 = await handlePostAgentError(deps);
        expect(result2.noticeSent).toBe(false);
        expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('tracks error streak correctly', async () => {
        const deps = makeDeps({ errorNoticeCooldownMs: 0 });

        const r1 = await handlePostAgentError(deps);
        expect(r1.streakCount).toBe(1);
        expect(r1.autoHealTriggered).toBe(false);

        const r2 = await handlePostAgentError(deps);
        expect(r2.streakCount).toBe(2);
        expect(r2.autoHealTriggered).toBe(false);

        const r3 = await handlePostAgentError(deps);
        expect(r3.streakCount).toBe(3);
        expect(r3.autoHealTriggered).toBe(true);
        expect(deps.closeStdin).toHaveBeenCalledWith('test@jid');
        expect(deps.queueSendMessage).toHaveBeenCalled();
    });

    it('logs validation violation', async () => {
        const deps = makeDeps({ validationViolation: true });
        await handlePostAgentError(deps);
        expect(deps.logWarn).toHaveBeenCalledWith(
            expect.objectContaining({ taskIds: ['MKT-001'] }),
            expect.stringContaining('validation violation'),
        );
    });
});

describe('clearErrorStreak', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetErrorRecoveryState();
    });

    it('emits recovery action when streak existed', async () => {
        const deps = makeDeps({ errorNoticeCooldownMs: 0 });
        await handlePostAgentError(deps);
        await handlePostAgentError(deps);

        expect(_getErrorStreak('test@jid')?.count).toBe(2);

        clearErrorStreak('main', 'test@jid');
        expect(_getErrorStreak('test@jid')).toBeUndefined();
        expect(appendSwarmAction).toHaveBeenCalledWith('main', expect.objectContaining({
            action: 'error_streak_recovered',
        }));
    });

    it('is no-op when no streak exists', () => {
        clearErrorStreak('main', 'test@jid');
        // Should not throw and should not emit action for recovery
        // (only error_streak_update actions should exist, not recovery)
    });
});
