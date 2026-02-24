import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing the module under test
vi.mock('./swarm-events.js', () => ({
    appendSwarmEvent: vi.fn(),
    appendSwarmAction: vi.fn(),
}));
vi.mock('./runtime-metrics.js', () => ({
    updateRuntimeMetrics: vi.fn(),
}));
vi.mock('./swarm-workflow.js', () => ({
    markTaskValidationFailure: vi.fn(),
}));
vi.mock('./agent-output-validation.js', () => ({
    validateStatusLineContract: vi.fn(() => ({ checked: false, ok: true })),
    validateRuntimeStatusClaims: vi.fn(() => ({ checked: false, ok: true })),
    validateCloudflareDeployClaims: vi.fn(() => ({ checked: false, ok: true })),
    validateDoneEvidenceClaims: vi.fn(() => ({ checked: false, ok: true })),
    validateUniversalTddClaims: vi.fn(() => ({ checked: false, ok: true })),
}));
vi.mock('./output-processor.js', () => ({
    isDatabaseConfigured: vi.fn(() => true),
    isCloudflareConfigured: vi.fn(() => false),
}));

import { runClaimValidations, type ValidationContext } from './validation-chain.js';
import { validateStatusLineContract, validateDoneEvidenceClaims } from './agent-output-validation.js';
import { appendSwarmEvent, appendSwarmAction } from './swarm-events.js';
import { updateRuntimeMetrics } from './runtime-metrics.js';
import { markTaskValidationFailure } from './swarm-workflow.js';

function makeCtx(overrides?: Partial<ValidationContext>): ValidationContext {
    return {
        groupFolder: 'main',
        chatJid: 'test@jid',
        stage: 'DEV',
        taskIds: ['MKT-001'],
        ...overrides,
    };
}

describe('runClaimValidations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns no errors when all claims pass', () => {
        const result = runClaimValidations(makeCtx(), 'some output text');
        expect(result.hadError).toBe(false);
        expect(result.validationViolation).toBe(false);
        expect(result.failedClaims).toEqual([]);
    });

    it('detects statusLine failure and emits events', () => {
        vi.mocked(validateStatusLineContract).mockReturnValueOnce({
            checked: true,
            ok: false,
            reason: 'missing status fields: URL_PUBLIC',
        });

        const nudgeFn = vi.fn();
        const result = runClaimValidations(makeCtx(), 'bad output', nudgeFn);

        expect(result.hadError).toBe(true);
        expect(result.validationViolation).toBe(true);
        expect(result.failedClaims).toContain('statusLine');
        expect(appendSwarmEvent).toHaveBeenCalledWith('main', expect.objectContaining({ kind: 'error' }));
        expect(appendSwarmAction).toHaveBeenCalledWith('main', expect.objectContaining({ action: 'status_line_contract_failed' }));
        expect(updateRuntimeMetrics).toHaveBeenCalledWith(expect.objectContaining({
            increments: expect.objectContaining({ validationFailures: 1, contractFailures: 1 }),
        }));
        expect(markTaskValidationFailure).toHaveBeenCalledWith(expect.objectContaining({
            groupFolder: 'main',
            taskId: 'MKT-001',
        }));
        // statusLine has a nudge
        expect(nudgeFn).toHaveBeenCalledWith('status_line_contract_failed');
    });

    it('detects doneEvidence failure without nudge', () => {
        vi.mocked(validateDoneEvidenceClaims).mockReturnValueOnce({
            checked: true,
            ok: false,
            reason: 'done claims without evidence',
        });

        const nudgeFn = vi.fn();
        const result = runClaimValidations(makeCtx(), 'bad output', nudgeFn);

        expect(result.hadError).toBe(true);
        expect(result.failedClaims).toContain('doneEvidence');
        // doneEvidence has no nudge defined
        expect(nudgeFn).not.toHaveBeenCalled();
    });

    it('marks all task IDs on failure', () => {
        vi.mocked(validateStatusLineContract).mockReturnValueOnce({
            checked: true, ok: false, reason: 'test',
        });

        runClaimValidations(makeCtx({ taskIds: ['A-001', 'B-002', 'C-003'] }), 'text');

        expect(markTaskValidationFailure).toHaveBeenCalledTimes(3);
    });

    it('skips claims that were not checked', () => {
        // All mocks return checked: false by default
        const result = runClaimValidations(makeCtx(), 'text');
        expect(result.hadError).toBe(false);
        expect(appendSwarmEvent).not.toHaveBeenCalled();
    });
});
