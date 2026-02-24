import { describe, it, expect } from 'vitest';
import {
    parseAgentOutput,
    validateTddFields,
    validateDeployFields,
} from './agent-output-schema.js';

describe('parseAgentOutput', () => {
    it('parses JSON block successfully', () => {
        const text = 'Some output\nJSONPROMPT: {"etapa":"DEV","item":"login","archivos":["src/auth.ts"],"siguiente":"test"}';
        const result = parseAgentOutput(text);
        expect(result.ok).toBe(true);
        expect(result.source).toBe('json');
        expect(result.data?.etapa).toBe('DEV');
        expect(result.data?.item).toBe('login');
        expect(result.data?.archivos).toBe('src/auth.ts');
    });

    it('falls back to regex when no JSON block', () => {
        const text = 'ETAPA: DEV\nITEM: implementar login\nARCHIVOS: src/auth.ts\nSIGUIENTE: agregar tests';
        const result = parseAgentOutput(text);
        expect(result.ok).toBe(true);
        expect(result.source).toBe('regex');
        expect(result.data?.etapa).toBe('DEV');
        expect(result.data?.item).toBe('implementar login');
    });

    it('normalizes COMPLETED to DONE', () => {
        const text = 'ETAPA: COMPLETED\nITEM: done\nARCHIVOS: all\nSIGUIENTE: none';
        const result = parseAgentOutput(text);
        expect(result.ok).toBe(true);
        expect(result.data?.etapa).toBe('DONE');
    });

    it('returns ok:false for empty text', () => {
        const result = parseAgentOutput('');
        expect(result.ok).toBe(false);
        expect(result.source).toBe('none');
    });

    it('returns ok:false when no ETAPA found', () => {
        const result = parseAgentOutput('just normal text without any markers');
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('no ETAPA field found');
    });

    it('parses deploy fields from regex', () => {
        const text = [
            'ETAPA: DEV',
            'ITEM: deploy',
            'ARCHIVOS: dist/',
            'SIGUIENTE: verify',
            'STATUS: deployed',
            'URL_PUBLIC: https://example.com',
            'PORT: 3000',
        ].join('\n');
        const result = parseAgentOutput(text);
        expect(result.ok).toBe(true);
        expect(result.data?.status).toBe('deployed');
        expect(result.data?.url_public).toBe('https://example.com');
    });
});

describe('validateTddFields', () => {
    it('requires TDD fields for non-BLOCKED stages', () => {
        const result = validateTddFields({ etapa: 'DEV' });
        expect(result.ok).toBe(false);
        expect(result.missing).toContain('TDD_TIPO');
    });

    it('skips TDD check for BLOCKED stage', () => {
        const result = validateTddFields({ etapa: 'BLOCKED' });
        expect(result.ok).toBe(true);
    });

    it('passes when all TDD fields present', () => {
        const result = validateTddFields({
            etapa: 'DEV',
            tdd_tipo: 'unit',
            tdd_red: 'test fails',
            tdd_green: 'test passes',
            tdd_refactor: 'cleaned up',
        });
        expect(result.ok).toBe(true);
    });
});

describe('validateDeployFields', () => {
    it('skips when no STATUS present', () => {
        const result = validateDeployFields({});
        expect(result.ok).toBe(true);
    });

    it('reports missing deploy fields', () => {
        const result = validateDeployFields({ status: 'deployed' });
        expect(result.ok).toBe(false);
        expect(result.missing.length).toBeGreaterThan(0);
        expect(result.missing).toContain('url_public');
    });

    it('passes with all deploy fields', () => {
        const result = validateDeployFields({
            status: 'deployed',
            url_public: 'https://example.com',
            port: '3000',
            process: 'running',
            db: 'connected',
            check_local: 'ok',
            check_public: 'ok',
            check_content: 'ok',
            last_log: 'no errors',
        });
        expect(result.ok).toBe(true);
    });
});
