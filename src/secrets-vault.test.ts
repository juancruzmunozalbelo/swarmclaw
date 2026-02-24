import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
    redactValue,
    loadSecret,
    loadSecrets,
    getSecret,
    hasSecret,
    redactSecrets,
    getVaultSummary,
    _resetVault,
} from './secrets-vault.js';

beforeEach(() => {
    _resetVault();
    vi.restoreAllMocks();
});

describe('redactValue', () => {
    it('returns *** for short values', () => {
        expect(redactValue('')).toBe('***');
        expect(redactValue('abc')).toBe('***');
        expect(redactValue('12345')).toBe('***');
    });

    it('shows first 4 chars for longer values', () => {
        expect(redactValue('sk-ant-1234567890')).toBe('sk-a***');
        expect(redactValue('ghp_abcdef123')).toBe('ghp_***');
    });
});

describe('loadSecret / getSecret / hasSecret', () => {
    it('loads from process.env', () => {
        process.env.TEST_SECRET_XYZ = 'my-secret-value-123';
        const value = loadSecret('TEST_SECRET_XYZ');
        expect(value).toBe('my-secret-value-123');
        expect(getSecret('TEST_SECRET_XYZ')).toBe('my-secret-value-123');
        expect(hasSecret('TEST_SECRET_XYZ')).toBe(true);
        delete process.env.TEST_SECRET_XYZ;
    });

    it('returns undefined for missing env var', () => {
        const value = loadSecret('NONEXISTENT_SECRET_ABC');
        expect(value).toBeUndefined();
        expect(hasSecret('NONEXISTENT_SECRET_ABC')).toBe(false);
    });
});

describe('loadSecrets', () => {
    it('loads multiple secrets and reports status', () => {
        process.env.TEST_A = 'value-a-long-enough';
        process.env.TEST_B = 'value-b-long-enough';
        const result = loadSecrets(['TEST_A', 'TEST_B', 'TEST_MISSING']);
        expect(result.TEST_A).toBe('value-a-long-enough');
        expect(result.TEST_B).toBe('value-b-long-enough');
        expect(result.TEST_MISSING).toBeUndefined();
        delete process.env.TEST_A;
        delete process.env.TEST_B;
    });
});

describe('redactSecrets', () => {
    it('replaces all occurrences of secret values', () => {
        process.env.TEST_KEY_R = 'super-secret-api-key';
        loadSecret('TEST_KEY_R');
        const text = 'Authorization: Bearer super-secret-api-key sent to api.example.com with super-secret-api-key';
        const safe = redactSecrets(text);
        expect(safe).not.toContain('super-secret-api-key');
        expect(safe).toContain('supe***');
        delete process.env.TEST_KEY_R;
    });

    it('returns original text when vault is empty', () => {
        expect(redactSecrets('hello world')).toBe('hello world');
    });
});

describe('getVaultSummary', () => {
    it('returns safe summary', () => {
        process.env.TEST_SUMMARY_S = 'long-secret-value-here';
        loadSecret('TEST_SUMMARY_S');
        const summary = getVaultSummary();
        expect(summary).toHaveLength(1);
        expect(summary[0].name).toBe('TEST_SUMMARY_S');
        expect(summary[0].redacted).toBe('long***');
        delete process.env.TEST_SUMMARY_S;
    });
});
