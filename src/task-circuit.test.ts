import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
    MODEL_PRIMARY: 'test-model',
    MODEL_FALLBACKS: [],
    MODEL_CIRCUIT_BREAKER_ENABLED: true,
    MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    MODEL_CIRCUIT_BREAKER_OPEN_MS: 60_000,
    TASK_CIRCUIT_BREAKER_ENABLED: true,
    TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    TASK_CIRCUIT_BREAKER_OPEN_MS: 600_000,
}));

import {
    isTaskRoleOpen,
    onTaskRoleFailure,
    onTaskRoleSuccess,
    _resetTaskRoleCircuit,
    _getTaskRoleCircuitState,
} from './model-circuit.js';

describe('Task+Role Circuit Breaker', () => {
    beforeEach(() => {
        _resetTaskRoleCircuit();
    });

    it('circuit is initially closed', () => {
        expect(isTaskRoleOpen('MKT-001', 'DEV')).toBe(false);
    });

    it('stays closed below threshold', () => {
        onTaskRoleFailure('MKT-001', 'DEV', 'error 1');
        expect(isTaskRoleOpen('MKT-001', 'DEV')).toBe(false);
        onTaskRoleFailure('MKT-001', 'DEV', 'error 2');
        // Default threshold is 3, so 2 failures should keep it closed
        expect(isTaskRoleOpen('MKT-001', 'DEV')).toBe(false);
        // State should exist
        const st = _getTaskRoleCircuitState('MKT-001', 'DEV');
        expect(st).toBeDefined();
        expect(st!.failures).toBe(2);
    });

    it('opens circuit at threshold', () => {
        onTaskRoleFailure('MKT-001', 'DEV', 'err1');
        onTaskRoleFailure('MKT-001', 'DEV', 'err2');
        onTaskRoleFailure('MKT-001', 'DEV', 'err3');
        expect(isTaskRoleOpen('MKT-001', 'DEV')).toBe(true);
    });

    it('isolates by task+role', () => {
        onTaskRoleFailure('MKT-001', 'DEV', 'err');
        onTaskRoleFailure('MKT-001', 'DEV', 'err');
        onTaskRoleFailure('MKT-001', 'DEV', 'err');
        expect(isTaskRoleOpen('MKT-001', 'DEV')).toBe(true);
        expect(isTaskRoleOpen('MKT-001', 'QA')).toBe(false);
        expect(isTaskRoleOpen('MKT-002', 'DEV')).toBe(false);
    });

    it('clears on success', () => {
        onTaskRoleFailure('MKT-001', 'DEV', 'err');
        onTaskRoleFailure('MKT-001', 'DEV', 'err');
        onTaskRoleSuccess('MKT-001', 'DEV');
        expect(_getTaskRoleCircuitState('MKT-001', 'DEV')).toBeUndefined();
        expect(isTaskRoleOpen('MKT-001', 'DEV')).toBe(false);
    });

    it('records last error text', () => {
        onTaskRoleFailure('MKT-001', 'DEV', 'timeout error 42');
        const st = _getTaskRoleCircuitState('MKT-001', 'DEV');
        expect(st?.lastError).toBe('timeout error 42');
    });
});
