import { describe, it, expect } from 'vitest';
import {
    extractTaskIds,
    extractQuestions,
    parseStageContract,
    validateStageContract,
} from './swarm-workflow.js';

// ── extractTaskIds ─────────────────────────────────────────────────────────

describe('extractTaskIds', () => {
    it('extracts standard task IDs', () => {
        expect(extractTaskIds('Trabajo en MKT-001 y CNT-042')).toEqual(['MKT-001', 'CNT-042']);
    });

    it('extracts IDs with 4+ digit numbers', () => {
        expect(extractTaskIds('REQ-803965 processing')).toEqual(['REQ-803965']);
    });

    it('returns unique IDs only', () => {
        expect(extractTaskIds('MKT-001 duplicado MKT-001')).toEqual(['MKT-001']);
    });

    it('returns empty for no IDs', () => {
        expect(extractTaskIds('no task ids here')).toEqual([]);
    });

    it('returns empty for null/undefined input', () => {
        expect(extractTaskIds('')).toEqual([]);
    });

    it('does not match 2-digit numbers', () => {
        expect(extractTaskIds('AB-12 is too short')).toEqual([]);
    });

    it('requires at least 2 letter prefix', () => {
        expect(extractTaskIds('X-001 is too short prefix')).toEqual([]);
    });

    it('extracts multiple prefixes', () => {
        const ids = extractTaskIds('ECOM-001 AUTH-042 INFRA-100');
        expect(ids).toContain('ECOM-001');
        expect(ids).toContain('AUTH-042');
        expect(ids).toContain('INFRA-100');
        expect(ids).toHaveLength(3);
    });
});

// ── extractQuestions ───────────────────────────────────────────────────────

describe('extractQuestions', () => {
    it('extracts lines with question marks', () => {
        const text = 'Hello\n¿Qué framework usamos?\nOtra linea\n¿Postgre o SQLite?';
        const questions = extractQuestions(text);
        expect(questions).toHaveLength(2);
        expect(questions[0]).toContain('framework');
        expect(questions[1]).toContain('Postgre');
    });

    it('returns at most 3 questions', () => {
        const text = '¿Q1?\n¿Q2?\n¿Q3?\n¿Q4?\n¿Q5?';
        expect(extractQuestions(text)).toHaveLength(3);
    });

    it('returns empty for no questions', () => {
        expect(extractQuestions('No questions here.')).toEqual([]);
    });

    it('handles empty input', () => {
        expect(extractQuestions('')).toEqual([]);
    });
});

// ── parseStageContract ─────────────────────────────────────────────────────

describe('parseStageContract', () => {
    it('parses standard ETAPA/ITEM/ARCHIVOS/SIGUIENTE format', () => {
        const text = [
            'ETAPA: DEV',
            'ITEM: implementar login',
            'ARCHIVOS: src/auth.ts',
            'SIGUIENTE: agregar tests',
        ].join('\n');
        const contract = parseStageContract(text);
        expect(contract).not.toBeNull();
        expect(contract!.stage).toBe('DEV');
        expect(contract!.item).toBe('implementar login');
        expect(contract!.archivos).toBe('src/auth.ts');
        expect(contract!.siguiente).toBe('agregar tests');
    });

    it('returns null when ETAPA is missing', () => {
        expect(parseStageContract('ITEM: foo\nARCHIVOS: bar\nSIGUIENTE: baz')).toBeNull();
    });

    it('returns null when ITEM is missing', () => {
        expect(parseStageContract('ETAPA: DEV\nARCHIVOS: bar\nSIGUIENTE: baz')).toBeNull();
    });

    it('normalizes stage aliases', () => {
        const text = 'ETAPA: TEAMLEAD\nITEM: plan\nARCHIVOS: todo.md\nSIGUIENTE: spec';
        const contract = parseStageContract(text);
        expect(contract!.stage).toBe('TEAMLEAD');
    });

    it('normalizes COMPLETED to DONE', () => {
        const text = 'ETAPA: COMPLETED\nITEM: done\nARCHIVOS: all\nSIGUIENTE: none';
        const contract = parseStageContract(text);
        expect(contract!.stage).toBe('DONE');
    });

    it('parses JSONPROMPT format', () => {
        const text = 'JSONPROMPT: {"etapa":"DEV","item":"login","archivos":["src/auth.ts"],"siguiente":"test"}';
        const contract = parseStageContract(text);
        expect(contract).not.toBeNull();
        expect(contract!.stage).toBe('DEV');
        expect(contract!.item).toBe('login');
        expect(contract!.archivos).toBe('src/auth.ts');
        expect(contract!.siguiente).toBe('test');
    });

    it('returns null for empty text', () => {
        expect(parseStageContract('')).toBeNull();
    });
});

// ── validateStageContract ──────────────────────────────────────────────────

describe('validateStageContract', () => {
    it('returns ok:true when no ETAPA is present (no contract to validate)', () => {
        const result = validateStageContract('just normal text, no stage info');
        expect(result.ok).toBe(true);
        expect(result.missing).toEqual([]);
    });

    it('reports missing fields when ETAPA is present but incomplete', () => {
        const result = validateStageContract('ETAPA: DEV\nsome output text');
        expect(result.ok).toBe(false);
        expect(result.stage).toBe('DEV');
        expect(result.missing.length).toBeGreaterThan(0);
        expect(result.missing).toContain('ITEM');
        expect(result.missing).toContain('ARCHIVOS');
        expect(result.missing).toContain('SIGUIENTE');
    });

    it('validates TDD fields are required for non-BLOCKED stages', () => {
        const result = validateStageContract('ETAPA: DEV\nITEM: x\nARCHIVOS: y\nSIGUIENTE: z');
        expect(result.missing).toContain('TDD_TIPO');
        expect(result.missing).toContain('TDD_RED');
        expect(result.missing).toContain('TDD_GREEN');
        expect(result.missing).toContain('TDD_REFACTOR');
    });

    it('does not require TDD fields for BLOCKED stage', () => {
        const result = validateStageContract('ETAPA: BLOCKED\nITEM: x\nARCHIVOS: y\nSIGUIENTE: z');
        expect(result.missing).not.toContain('TDD_TIPO');
        expect(result.missing).not.toContain('TDD_RED');
    });

    it('requires SWARMLOG and JSONPROMPT', () => {
        const result = validateStageContract('ETAPA: DEV\nITEM: x\nARCHIVOS: y\nSIGUIENTE: z');
        expect(result.missing).toContain('SWARMLOG');
        expect(result.missing).toContain('JSONPROMPT');
    });
});
