import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
    PARALLEL_SUBAGENT_COOLDOWN_MS: 5000,
    PARALLEL_SUBAGENT_RETRY_BASE_MS: 1000,
    PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER: 2,
    PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS: 30000,
    PARALLEL_LANE_IDLE_TIMEOUT_MS: 120000,
    PARALLEL_ROLE_TIMEOUT_DEFAULT_MS: 180000,
    PARALLEL_ROLE_TIMEOUT_PM_MS: 90000,
    PARALLEL_ROLE_TIMEOUT_SPEC_MS: 90000,
    PARALLEL_ROLE_TIMEOUT_ARQ_MS: 90000,
    PARALLEL_ROLE_TIMEOUT_UX_MS: 90000,
    PARALLEL_ROLE_TIMEOUT_DEV_MS: 300000,
    PARALLEL_ROLE_TIMEOUT_DEV2_MS: 300000,
    PARALLEL_ROLE_TIMEOUT_DEVOPS_MS: 240000,
    PARALLEL_ROLE_TIMEOUT_QA_MS: 180000,
}));

import {
    laneRetryDelayMs,
    laneTimeoutMs,
    shouldDispatchParallelLane,
    _resetLaneHelperState,
} from './lane-helpers.js';

beforeEach(() => {
    _resetLaneHelperState();
});

describe('laneRetryDelayMs', () => {
    it('returns base delay for first retry', () => {
        expect(laneRetryDelayMs(1)).toBe(1000);
    });

    it('doubles on second retry', () => {
        expect(laneRetryDelayMs(2)).toBe(2000);
    });

    it('caps at max delay', () => {
        expect(laneRetryDelayMs(100)).toBe(30000);
    });

    it('returns at least 250ms', () => {
        expect(laneRetryDelayMs(0)).toBeGreaterThanOrEqual(250);
    });
});

describe('laneTimeoutMs', () => {
    it('returns PM timeout', () => {
        expect(laneTimeoutMs('PM')).toBe(90000);
    });

    it('returns DEV timeout', () => {
        expect(laneTimeoutMs('DEV')).toBe(300000);
    });

    it('returns DEVOPS timeout', () => {
        expect(laneTimeoutMs('DEVOPS')).toBe(240000);
    });

    it('returns QA timeout', () => {
        expect(laneTimeoutMs('QA')).toBe(180000);
    });

    it('returns default for unknown role', () => {
        const result = laneTimeoutMs('UNKNOWN' as any);
        expect(result).toBe(Math.max(180000, 120000));
    });
});

describe('shouldDispatchParallelLane', () => {
    it('allows first dispatch', () => {
        expect(shouldDispatchParallelLane('chat:DEV')).toBe(true);
    });

    it('blocks rapid second dispatch (cooldown)', () => {
        shouldDispatchParallelLane('chat:DEV');
        expect(shouldDispatchParallelLane('chat:DEV')).toBe(false);
    });

    it('allows different keys independently', () => {
        shouldDispatchParallelLane('chat:DEV');
        expect(shouldDispatchParallelLane('chat:QA')).toBe(true);
    });
});
