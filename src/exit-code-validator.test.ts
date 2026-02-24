import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/test-groups',
}));
vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execSync } from 'child_process';
vi.mock('child_process', () => ({ execSync: vi.fn() }));
const mockExecSync = vi.mocked(execSync);

import {
    runValidationCommand,
    validateTaskCompletion,
    defaultValidationCommands,
} from './exit-code-validator.js';

beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('runValidationCommand', () => {
    it('returns passed on exit 0', () => {
        mockExecSync.mockReturnValue('OK\n' as any);
        const result = runValidationCommand(
            { name: 'test', command: 'npm test', required: true },
            '/tmp/work',
        );
        expect(result.passed).toBe(true);
        expect(result.exitCode).toBe(0);
    });

    it('returns failed on non-zero exit', () => {
        mockExecSync.mockImplementation(() => {
            const err = new Error('fail') as any;
            err.status = 1;
            err.stderr = 'Error: test failed';
            throw err;
        });
        const result = runValidationCommand(
            { name: 'test', command: 'npm test', required: true },
            '/tmp/work',
        );
        expect(result.passed).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.output).toContain('test failed');
    });
});

describe('defaultValidationCommands', () => {
    it('includes typecheck when tsconfig exists', () => {
        vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => String(p).includes('tsconfig'));
        const cmds = defaultValidationCommands('/tmp/work');
        expect(cmds.some((c) => c.name === 'typecheck')).toBe(true);
    });

    it('includes test when package.json has test script', () => {
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ scripts: { test: 'vitest' } }));
        const cmds = defaultValidationCommands('/tmp/work');
        expect(cmds.some((c) => c.name === 'test')).toBe(true);
    });
});

describe('validateTaskCompletion', () => {
    it('returns allPassed when all required pass', () => {
        mockExecSync.mockReturnValue('OK\n' as any);
        const result = validateTaskCompletion('main', [
            { name: 'check1', command: 'echo ok', required: true },
            { name: 'check2', command: 'echo ok', required: false },
        ]);
        expect(result.allPassed).toBe(true);
        expect(result.requiredFailed).toEqual([]);
    });

    it('returns allPassed false when required fails', () => {
        let callCount = 0;
        mockExecSync.mockImplementation(() => {
            callCount++;
            if (callCount === 1) return 'OK\n' as any;
            const err = new Error('fail') as any;
            err.status = 1;
            throw err;
        });
        const result = validateTaskCompletion('main', [
            { name: 'pass', command: 'echo ok', required: false },
            { name: 'fail', command: 'false', required: true },
        ]);
        expect(result.allPassed).toBe(false);
        expect(result.requiredFailed).toEqual(['fail']);
    });
});
