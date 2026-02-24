import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/nanoclaw-test-output-groups',
    SWARM_STRICT_MODE: true,
}));

vi.mock('./swarm-workflow.js', () => ({
    parseStageContract: () => null,
}));

import {
    isDatabaseConfigured,
    isCloudflareConfigured,
    resolveContainerPath,
    parseContractFileHints,
    runCriticReview,
} from './output-processor.js';

describe('resolveContainerPath', () => {
    it('maps /workspace/group/ to host groups dir', () => {
        const result = resolveContainerPath('/workspace/group/src/api.ts', 'main');
        expect(result).toContain('groups');
        expect(result).toContain('main');
        expect(result).toContain('src/api.ts');
    });

    it('maps /workspace/project/ to cwd', () => {
        const result = resolveContainerPath('/workspace/project/package.json', 'main');
        expect(result).toContain('package.json');
        expect(result).not.toContain('/workspace/');
    });

    it('passes through absolute paths', () => {
        expect(resolveContainerPath('/usr/local/bin/node', 'main')).toBe('/usr/local/bin/node');
    });
});

describe('parseContractFileHints', () => {
    it('parses comma-separated paths', () => {
        const result = parseContractFileHints('main', 'src/a.ts, src/b.ts');
        expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty for n/a', () => {
        expect(parseContractFileHints('main', 'n/a')).toEqual([]);
        expect(parseContractFileHints('main', '')).toEqual([]);
    });
});

describe('runCriticReview', () => {
    it('reports missing artifacts for DEV stage', () => {
        const result = runCriticReview({
            groupFolder: 'main',
            stage: 'DEV',
            taskIds: ['ECOM-001'],
            parsedContract: { stage: 'DEV', item: 'test', archivos: 'nonexistent/file.ts', siguiente: 'next' },
            rawText: 'implemented',
            pendingTodoIdsForEpic: () => [],
        });
        expect(result.ok).toBe(false);
        expect(result.findings).toContain('no artifact files found from ARCHIVOS');
    });

    it('reports missing QA evidence', () => {
        const result = runCriticReview({
            groupFolder: 'main',
            stage: 'QA',
            taskIds: [],
            parsedContract: null,
            rawText: 'looks good to me',
            pendingTodoIdsForEpic: () => [],
        });
        expect(result.ok).toBe(false);
        expect(result.findings.some(f => f.includes('QA output missing'))).toBe(true);
    });

    it('passes when evidence is present for QA', () => {
        const result = runCriticReview({
            groupFolder: 'main',
            stage: 'QA',
            taskIds: [],
            parsedContract: null,
            rawText: 'npm run test passed, all 10 tests ok',
            pendingTodoIdsForEpic: () => [],
        });
        expect(result.findings.some(f => f.includes('QA output missing'))).toBe(false);
    });
});

describe('isDatabaseConfigured', () => {
    it('detects DATABASE_URL env var', () => {
        const orig = process.env.DATABASE_URL;
        process.env.DATABASE_URL = 'postgres://localhost/test';
        expect(isDatabaseConfigured()).toBe(true);
        if (orig === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = orig;
    });
});
