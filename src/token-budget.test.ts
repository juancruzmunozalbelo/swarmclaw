import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestDatabase, upsertWorkflowTask } from './db.js';
import { checkBudget, recordTokenUsage } from './token-budget.js';

beforeEach(() => {
    _initTestDatabase();
});

describe('checkBudget', () => {
    it('returns ok:true for new tasks', () => {
        upsertWorkflowTask({
            taskId: 'ECOM-001',
            groupFolder: 'main',
            stage: 'DEV',
            status: 'running',
            retries: 0,
            pendingQuestions: [],
            decisions: [],
        });

        const result = checkBudget('main', 'ECOM-001');
        expect(result.ok).toBe(true);
        expect(result.used).toBe(0);
        expect(result.limit).toBeGreaterThan(0);
    });

    it('returns ok:true for missing tasks', () => {
        const result = checkBudget('main', 'NONEXISTENT');
        expect(result.ok).toBe(true);
    });
});

describe('recordTokenUsage', () => {
    it('increments token count', () => {
        upsertWorkflowTask({
            taskId: 'ECOM-001',
            groupFolder: 'main',
            stage: 'DEV',
            status: 'running',
            retries: 0,
            pendingQuestions: [],
            decisions: [],
        });

        const r1 = recordTokenUsage('main', 'ECOM-001', 1000);
        expect(r1.used).toBe(1000);
        expect(r1.ok).toBe(true);

        const r2 = recordTokenUsage('main', 'ECOM-001', 500);
        expect(r2.used).toBe(1500);
        expect(r2.ok).toBe(true);
    });

    it('detects when budget is exceeded', () => {
        upsertWorkflowTask({
            taskId: 'ECOM-002',
            groupFolder: 'main',
            stage: 'DEV',
            status: 'running',
            retries: 0,
            pendingQuestions: [],
            decisions: [],
            tokensUsed: 1_999_000,
        });

        const result = recordTokenUsage('main', 'ECOM-002', 2000);
        expect(result.ok).toBe(false);
        expect(result.used).toBeGreaterThanOrEqual(2_000_000);
    });

    it('returns safe defaults for missing tasks', () => {
        const result = recordTokenUsage('main', 'NONEXISTENT', 1000);
        expect(result.ok).toBe(true);
    });
});
