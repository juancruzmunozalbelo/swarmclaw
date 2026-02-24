import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/test-groups',
}));
vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execSync } from 'child_process';
import { createCheckpoint, rollbackToCheckpoint } from './git-checkpoint.js';

vi.mock('child_process', () => ({
    execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createCheckpoint', () => {
    it('returns error when not a git repo', () => {
        mockExecSync.mockImplementation(() => { throw new Error('not a repo'); });
        const result = createCheckpoint({
            groupFolder: 'main', taskId: 'MKT-001', fromStage: 'SPEC', toStage: 'DEV',
        });
        expect(result.ok).toBe(false);
        expect(result.error).toBe('not a git repo');
    });

    it('returns ok when no changes', () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (typeof cmd === 'string' && cmd.includes('status --porcelain')) return '' as any;
            return Buffer.from('');
        });
        const result = createCheckpoint({
            groupFolder: 'main', taskId: 'MKT-001', fromStage: 'SPEC', toStage: 'DEV',
        });
        expect(result.ok).toBe(true);
        expect(result.commitHash).toBeUndefined();
    });

    it('commits and tags when changes exist', () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (typeof cmd === 'string' && cmd.includes('status --porcelain')) return 'M file.ts\n' as any;
            if (typeof cmd === 'string' && cmd.includes('rev-parse --short')) return 'abc1234\n' as any;
            return Buffer.from('');
        });
        const result = createCheckpoint({
            groupFolder: 'main', taskId: 'MKT-001', fromStage: 'SPEC', toStage: 'DEV',
        });
        expect(result.ok).toBe(true);
        expect(result.commitHash).toBe('abc1234');
        expect(result.tag).toBe('swarclaw/MKT-001/spec');
    });
});

describe('rollbackToCheckpoint', () => {
    it('returns error when not a git repo', () => {
        mockExecSync.mockImplementation(() => { throw new Error('not a repo'); });
        const result = rollbackToCheckpoint({
            groupFolder: 'main', taskId: 'MKT-001', stage: 'SPEC',
        });
        expect(result.ok).toBe(false);
    });

    it('resets to tag when it exists', () => {
        mockExecSync.mockImplementation((cmd: string) => {
            if (typeof cmd === 'string' && cmd.includes('rev-parse --short')) return 'def5678\n' as any;
            return Buffer.from('');
        });
        const result = rollbackToCheckpoint({
            groupFolder: 'main', taskId: 'MKT-001', stage: 'SPEC',
        });
        expect(result.ok).toBe(true);
        expect(result.commitHash).toBe('def5678');
        expect(result.tag).toBe('swarclaw/MKT-001/spec');
    });
});
