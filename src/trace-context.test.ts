import { describe, it, expect } from 'vitest';
import {
    generateTraceId,
    runWithTrace,
    currentTrace,
    traceElapsedMs,
    createProcessingTrace,
} from './trace-context.js';

describe('generateTraceId', () => {
    it('returns 8 hex chars', () => {
        const id = generateTraceId();
        expect(id).toMatch(/^[a-f0-9]{8}$/);
    });

    it('generates unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
        expect(ids.size).toBe(100);
    });
});

describe('runWithTrace', () => {
    it('makes trace context available inside callback', () => {
        let captured: ReturnType<typeof currentTrace>;
        runWithTrace({ traceId: 'abc12345', taskId: 'MKT-001', groupFolder: 'main' }, () => {
            captured = currentTrace();
        });
        expect(captured!).toBeDefined();
        expect(captured!.traceId).toBe('abc12345');
        expect(captured!.taskId).toBe('MKT-001');
        expect(captured!.groupFolder).toBe('main');
    });

    it('context is undefined outside runWithTrace', () => {
        expect(currentTrace()).toBeUndefined();
    });

    it('returns the callback result', () => {
        const result = runWithTrace({ traceId: 'x' }, () => 42);
        expect(result).toBe(42);
    });
});

describe('traceElapsedMs', () => {
    it('returns 0 outside trace', () => {
        expect(traceElapsedMs()).toBe(0);
    });

    it('returns elapsed time inside trace', () => {
        runWithTrace({ traceId: 'x', startedAt: Date.now() - 100 }, () => {
            const elapsed = traceElapsedMs();
            expect(elapsed).toBeGreaterThanOrEqual(90);
            expect(elapsed).toBeLessThan(500);
        });
    });
});

describe('createProcessingTrace', () => {
    it('generates trace with traceId', () => {
        const trace = createProcessingTrace({ groupFolder: 'main', taskId: 'MKT-001' });
        expect(trace.traceId).toMatch(/^[a-f0-9]{8}$/);
        expect(trace.taskId).toBe('MKT-001');
        expect(trace.groupFolder).toBe('main');
    });
});
