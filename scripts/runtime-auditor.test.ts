import { describe, it, expect } from 'vitest';
import {
    normalizeState,
    parseTodo,
    inferCardType,
    isGenericScope,
    isMissingEvidenceField,
    enhanceTodoCards,
} from './runtime-auditor.js';

describe('normalizeState', () => {
    it('maps known aliases to canonical states', () => {
        expect(normalizeState('pending')).toBe('todo');
        expect(normalizeState('queue')).toBe('queued');
        expect(normalizeState('queued')).toBe('queued');
        expect(normalizeState('working')).toBe('doing');
        expect(normalizeState('in_progress')).toBe('doing');
        expect(normalizeState('in-progress')).toBe('doing');
        expect(normalizeState('inprogress')).toBe('doing');
        expect(normalizeState('completed')).toBe('done');
        expect(normalizeState('complete')).toBe('done');
        expect(normalizeState('failed')).toBe('failed');
    });
    it('passes through canonical states unchanged', () => {
        expect(normalizeState('todo')).toBe('todo');
        expect(normalizeState('doing')).toBe('doing');
        expect(normalizeState('done')).toBe('done');
        expect(normalizeState('blocked')).toBe('blocked');
        expect(normalizeState('planning')).toBe('planning');
    });
    it('defaults unknown to todo', () => {
        expect(normalizeState('')).toBe('todo');
        expect(normalizeState('GARBAGE')).toBe('todo');
    });
});

describe('parseTodo', () => {
    it('parses cards from markdown', () => {
        const md = `
- ID: MKT-001
  Owner: dev
  Scope: build landing page
  Entregable: landing.html
  Tests: npm run build
  Estado: doing

- ID: CNT-002
  Owner: pm
  Scope: create API
  Estado: done
`;
        const cards = parseTodo(md);
        expect(cards).toHaveLength(2);
        expect(cards[0].id).toBe('MKT-001');
        expect(cards[0].owner).toBe('dev');
        expect(cards[0].scope).toBe('build landing page');
        expect(cards[0].state).toBe('doing');
        expect(cards[1].id).toBe('CNT-002');
        expect(cards[1].state).toBe('done');
    });

    it('returns empty array for empty input', () => {
        expect(parseTodo('')).toEqual([]);
    });
});

describe('inferCardType', () => {
    it('detects frontend from scope keywords', () => {
        expect(inferCardType('X-001', 'build UI component with svelte')).toBe('frontend');
    });
    it('detects backend from scope keywords', () => {
        expect(inferCardType('X-001', 'create API endpoint with postgres')).toBe('backend');
    });
    it('detects devops from scope keywords', () => {
        expect(inferCardType('X-001', 'deploy cloudflare tunnel')).toBe('devops');
    });
    it('detects qa from scope keywords', () => {
        expect(inferCardType('X-001', 'run regression tests')).toBe('qa');
    });
    it('detects frontend from task ID prefix', () => {
        expect(inferCardType('MKT-001', '')).toBe('frontend');
        expect(inferCardType('ECOM-001', '')).toBe('frontend');
    });
    it('detects backend from task ID prefix', () => {
        expect(inferCardType('CNT-001', '')).toBe('backend');
        expect(inferCardType('EQ-001', '')).toBe('backend');
    });
    it('defaults to software', () => {
        expect(inferCardType('X-001', '')).toBe('software');
    });
});

describe('isGenericScope', () => {
    it('returns true for empty/placeholder values', () => {
        expect(isGenericScope('')).toBe(true);
        expect(isGenericScope('n/a')).toBe(true);
        expect(isGenericScope('tbd')).toBe(true);
        expect(isGenericScope('-')).toBe(true);
        expect(isGenericScope('none')).toBe(true);
    });
    it('returns true for known generic phrases', () => {
        expect(isGenericScope('analizar estado')).toBe(true);
        expect(isGenericScope('por definir')).toBe(true);
    });
    it('returns false for real scopes', () => {
        expect(isGenericScope('build landing page with Svelte')).toBe(false);
        expect(isGenericScope('create API endpoint')).toBe(false);
    });
});

describe('isMissingEvidenceField', () => {
    it('returns true for empty/placeholder values', () => {
        expect(isMissingEvidenceField('')).toBe(true);
        expect(isMissingEvidenceField('n/a')).toBe(true);
        expect(isMissingEvidenceField('-')).toBe(true);
    });
    it('returns false for real values', () => {
        expect(isMissingEvidenceField('npm run build && npm run test')).toBe(false);
    });
});

describe('enhanceTodoCards', () => {
    it('fills missing fields for incomplete cards', () => {
        const md = `- ID: REQ-001
  Scope: implement feature
  Estado: todo`;
        const result = enhanceTodoCards(md);
        expect(result.fixed).toBeGreaterThan(0);
        expect(result.tasks).toContain('REQ-001');
        expect(result.md).toContain('Descripcion:');
        expect(result.md).toContain('Criterios:');
        expect(result.md).toContain('TDD:');
    });

    it('does not modify done tasks scope/entregable/tests', () => {
        const md = `- ID: REQ-002
  Scope: n/a
  Entregable: n/a
  Tests: n/a
  Estado: done`;
        const result = enhanceTodoCards(md);
        // Should add Descripcion/Criterios/TDD but not modify Scope/Entregable/Tests for done tasks
        expect(result.md).toContain('Scope: n/a');
    });

    it('returns unchanged for empty input', () => {
        const result = enhanceTodoCards('no cards here');
        expect(result.fixed).toBe(0);
        expect(result.tasks).toEqual([]);
    });
});
