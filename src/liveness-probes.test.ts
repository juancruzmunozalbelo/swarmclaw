import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execSync } from 'child_process';
vi.mock('child_process', () => ({ execSync: vi.fn() }));
const mockExecSync = vi.mocked(execSync);

import {
    trackContainer,
    untrackContainer,
    getTrackedContainers,
    runLivenessCheck,
    _resetLivenessState,
} from './liveness-probes.js';

beforeEach(() => {
    _resetLivenessState();
    vi.clearAllMocks();
});

describe('trackContainer / untrackContainer', () => {
    it('tracks and untracks containers', () => {
        trackContainer('nc-dev-1');
        trackContainer('nc-qa-1');
        expect(getTrackedContainers()).toEqual(['nc-dev-1', 'nc-qa-1']);
        untrackContainer('nc-dev-1');
        expect(getTrackedContainers()).toEqual(['nc-qa-1']);
    });
});

describe('runLivenessCheck', () => {
    it('returns empty when nothing tracked', () => {
        const result = runLivenessCheck();
        expect(result).toEqual({ healthy: [], dead: [], stale: [] });
    });

    it('detects healthy containers', () => {
        trackContainer('nc-dev-1');
        mockExecSync.mockReturnValue(JSON.stringify([
            { status: 'running', configuration: { id: 'nc-dev-1' } },
        ]) as any);
        const result = runLivenessCheck();
        expect(result.healthy).toHaveLength(1);
        expect(result.dead).toHaveLength(0);
    });

    it('detects dead containers', () => {
        trackContainer('nc-dev-1');
        trackContainer('nc-dead-1');
        mockExecSync.mockReturnValue(JSON.stringify([
            { status: 'running', configuration: { id: 'nc-dev-1' } },
        ]) as any);
        const result = runLivenessCheck();
        expect(result.healthy).toHaveLength(1);
        expect(result.dead).toHaveLength(1);
        expect(result.dead[0].id).toBe('nc-dead-1');
    });

    it('detects stale containers', () => {
        // Backdate registration by mocking Date.now
        const realNow = Date.now();
        vi.spyOn(Date, 'now').mockReturnValueOnce(realNow - 700_000); // 700s ago
        trackContainer('nc-old-1');
        vi.spyOn(Date, 'now').mockReturnValue(realNow); // restore for check

        mockExecSync.mockReturnValue(JSON.stringify([
            { status: 'running', configuration: { id: 'nc-old-1' } },
        ]) as any);
        const result = runLivenessCheck(600_000); // 10min threshold
        expect(result.stale).toHaveLength(1);
        expect(result.stale[0].id).toBe('nc-old-1');
    });

    it('handles container ls failure gracefully', () => {
        trackContainer('nc-dev-1');
        mockExecSync.mockImplementation(() => { throw new Error('timeout'); });
        const result = runLivenessCheck();
        expect(result).toEqual({ healthy: [], dead: [], stale: [] });
    });
});
