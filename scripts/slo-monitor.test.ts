import { describe, it, expect } from 'vitest';
import {
    checkErrorRate,
    checkValidationFailRate,
    checkMetricsStaleness,
    checkOutputSuccessRate,
    runSloChecks,
    type RuntimeMetrics,
} from './slo-monitor.js';

function makeMetrics(overrides?: Partial<RuntimeMetrics['counters']> & { updatedAt?: string | null }): RuntimeMetrics {
    return {
        updatedAt: overrides?.updatedAt ?? new Date().toISOString(),
        counters: {
            requestsStarted: 20,
            outputsSent: 18,
            agentErrors: 1,
            validationFailures: 1,
            contractFailures: 0,
            artifactFailures: 0,
            devGateFailures: 0,
            ...overrides,
        },
    };
}

describe('checkErrorRate', () => {
    it('returns null when below threshold', () => {
        expect(checkErrorRate(makeMetrics())).toBeNull();
    });

    it('returns breach when error rate exceeds threshold', () => {
        const result = checkErrorRate(makeMetrics({ agentErrors: 10 }));
        expect(result).not.toBeNull();
        expect(result!.slo).toBe('error_rate');
        expect(result!.value).toBe(50);
    });

    it('returns null when too few requests', () => {
        expect(checkErrorRate(makeMetrics({ requestsStarted: 3, agentErrors: 3 }))).toBeNull();
    });
});

describe('checkValidationFailRate', () => {
    it('returns null when below threshold', () => {
        expect(checkValidationFailRate(makeMetrics())).toBeNull();
    });

    it('returns breach when validation rate too high', () => {
        const result = checkValidationFailRate(makeMetrics({ validationFailures: 8 }));
        expect(result).not.toBeNull();
        expect(result!.slo).toBe('validation_fail_rate');
    });
});

describe('checkMetricsStaleness', () => {
    it('returns null when metrics are fresh', () => {
        expect(checkMetricsStaleness(makeMetrics())).toBeNull();
    });

    it('returns breach when metrics are stale', () => {
        const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
        const result = checkMetricsStaleness(makeMetrics({ updatedAt: stale }));
        expect(result).not.toBeNull();
        expect(result!.slo).toBe('metrics_stale');
    });

    it('returns null when updatedAt is null', () => {
        expect(checkMetricsStaleness(makeMetrics({ updatedAt: null }))).toBeNull();
    });
});

describe('checkOutputSuccessRate', () => {
    it('returns null when success rate is good', () => {
        expect(checkOutputSuccessRate(makeMetrics())).toBeNull();
    });

    it('returns breach when success rate below 50%', () => {
        const result = checkOutputSuccessRate(makeMetrics({ outputsSent: 3 }));
        expect(result).not.toBeNull();
        expect(result!.slo).toBe('output_success_rate');
    });
});

describe('runSloChecks', () => {
    it('returns ok when all checks pass', () => {
        const result = runSloChecks(makeMetrics());
        expect(result.ok).toBe(true);
        expect(result.breaches).toEqual([]);
    });

    it('returns all breaches', () => {
        const result = runSloChecks(makeMetrics({
            agentErrors: 10,
            validationFailures: 8,
            outputsSent: 3,
        }));
        expect(result.ok).toBe(false);
        expect(result.breaches.length).toBeGreaterThanOrEqual(3);
        const slos = result.breaches.map((b) => b.slo);
        expect(slos).toContain('error_rate');
        expect(slos).toContain('validation_fail_rate');
        expect(slos).toContain('output_success_rate');
    });
});
