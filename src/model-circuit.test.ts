import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('./config.js', () => ({
    MODEL_PRIMARY: 'claude-sonnet',
    MODEL_FALLBACKS: ['claude-haiku', 'gpt-4o'],
    MODEL_CIRCUIT_BREAKER_ENABLED: true,
    MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    MODEL_CIRCUIT_BREAKER_OPEN_MS: 60_000,
    TASK_CIRCUIT_BREAKER_ENABLED: true,
    TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    TASK_CIRCUIT_BREAKER_OPEN_MS: 600_000,
}));

import {
    isModelFallbackRetryable,
    getModelAttemptPlan,
    onModelAttemptFailure,
    onModelAttemptSuccess,
    _resetModelCircuit,
    _getModelCircuitState,
} from './model-circuit.js';

beforeEach(() => {
    _resetModelCircuit();
});

describe('isModelFallbackRetryable', () => {
    it('returns true for transient errors', () => {
        expect(isModelFallbackRetryable('timeout')).toBe(true);
        expect(isModelFallbackRetryable('429 rate limit exceeded')).toBe(true);
        expect(isModelFallbackRetryable('503 service unavailable')).toBe(true);
        expect(isModelFallbackRetryable('SIGKILL code 143')).toBe(true);
    });
    it('returns false for permanent errors', () => {
        expect(isModelFallbackRetryable('invalid API key')).toBe(false);
        expect(isModelFallbackRetryable('')).toBe(false);
    });
});

describe('getModelAttemptPlan', () => {
    it('returns all models when none are circuit-open', () => {
        const plan = getModelAttemptPlan();
        expect(plan).toEqual(['claude-sonnet', 'claude-haiku', 'gpt-4o']);
    });

    it('excludes circuit-open models', () => {
        // Trip the breaker for claude-sonnet (3 failures = threshold)
        onModelAttemptFailure('claude-sonnet', 'timeout');
        onModelAttemptFailure('claude-sonnet', 'timeout');
        onModelAttemptFailure('claude-sonnet', 'timeout');

        const plan = getModelAttemptPlan();
        expect(plan).not.toContain('claude-sonnet');
        expect(plan).toContain('claude-haiku');
    });

    it('falls back to primary if all models are open', () => {
        // Trip all breakers
        for (const m of ['claude-sonnet', 'claude-haiku', 'gpt-4o']) {
            for (let i = 0; i < 3; i++) onModelAttemptFailure(m, 'timeout');
        }
        const plan = getModelAttemptPlan();
        expect(plan).toEqual(['claude-sonnet']);
    });
});

describe('onModelAttemptSuccess', () => {
    it('clears circuit state', () => {
        onModelAttemptFailure('claude-sonnet', 'timeout');
        onModelAttemptFailure('claude-sonnet', 'timeout');
        expect(_getModelCircuitState('claude-sonnet')).toBeDefined();

        onModelAttemptSuccess('claude-sonnet');
        expect(_getModelCircuitState('claude-sonnet')).toBeUndefined();
    });
});

describe('circuit breaker lifecycle', () => {
    it('opens after threshold failures and auto-closes after timeout', () => {
        // 2 failures — still closed
        onModelAttemptFailure('claude-haiku', 'timeout');
        onModelAttemptFailure('claude-haiku', 'timeout');
        let plan = getModelAttemptPlan();
        expect(plan).toContain('claude-haiku');

        // 3rd failure — opens
        onModelAttemptFailure('claude-haiku', 'timeout');
        plan = getModelAttemptPlan();
        expect(plan).not.toContain('claude-haiku');

        // After openMs passes, model becomes available again
        const state = _getModelCircuitState('claude-haiku');
        expect(state).toBeDefined();
        // Manually expire the circuit
        if (state) state.openUntil = Date.now() - 1;
        plan = getModelAttemptPlan();
        expect(plan).toContain('claude-haiku');
    });
});
