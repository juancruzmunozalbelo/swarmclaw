import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
    SUBAGENT_CONTEXT_MESSAGES: 10,
    TASK_MICRO_BATCH_MAX: 5,
    SWARM_STRICT_MODE: true,
}));
vi.mock('./router.js', () => ({
    formatMessages: vi.fn(() => ''),
}));

import {
    roleInstruction,
    roleSkillName,
    normalizeSkillMetricKey,
    inferTaskKind,
    ownerFromStageHint,
    isEpicBootstrapTask,
    strictOutputContractText,
    _resetRolePromptCache,
    _resetRouterSkillsMatrixCache,
} from './prompt-builder.js';

beforeEach(() => {
    _resetRolePromptCache();
    _resetRouterSkillsMatrixCache();
});

// ── roleInstruction ────────────────────────────────────────────────────────

describe('roleInstruction', () => {
    it('returns PM instruction text', () => {
        const text = roleInstruction('PM');
        expect(text).toContain('PM-SR');
        expect(text).toContain('todo.md');
    });

    it('returns DEV instruction text', () => {
        const text = roleInstruction('DEV');
        expect(text).toContain('DEV-SR');
        expect(text).toContain('TDD');
    });

    it('returns DEVOPS instruction with suffix rule', () => {
        const text = roleInstruction('DEVOPS');
        expect(text).toContain('DEVOPS senior');
        expect(text).toContain('STATUS=deployed');
        // Dynamic suffix rule resolved at runtime
        expect(text).not.toContain('{{SUFFIX_RULE}}');
    });

    it('returns QA instruction text', () => {
        const text = roleInstruction('QA');
        expect(text).toContain('QA senior');
        expect(text).toContain('evidencia');
    });

    it('returns text for all 8 roles', () => {
        const roles = ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'] as const;
        for (const role of roles) {
            const text = roleInstruction(role);
            expect(text.length).toBeGreaterThan(50);
        }
    });
});

// ── roleSkillName ──────────────────────────────────────────────────────────

describe('roleSkillName', () => {
    it('maps PM to planning skill', () => {
        expect(roleSkillName('PM', 'general')).toBe('$swarm-pm-planning');
    });

    it('maps DEV to implementation skill', () => {
        expect(roleSkillName('DEV', 'frontend')).toBe('$swarm-dev-implementation');
    });

    it('maps QA+security to codex-risk-bridge', () => {
        expect(roleSkillName('QA', 'security')).toBe('$codex-risk-bridge');
    });

    it('maps QA for non-security to qa-validation', () => {
        expect(roleSkillName('QA', 'general')).toBe('$swarm-qa-validation');
    });

    it('maps DEVOPS to devops-deploy', () => {
        expect(roleSkillName('DEVOPS', 'devops')).toBe('$swarm-devops-deploy');
    });
});

// ── normalizeSkillMetricKey ────────────────────────────────────────────────

describe('normalizeSkillMetricKey', () => {
    it('normalizes $-prefixed skill names', () => {
        expect(normalizeSkillMetricKey('$swarm-pm-planning')).toBe('swarm-pm-planning');
    });

    it('lowercases and strips special chars', () => {
        expect(normalizeSkillMetricKey('Foo Bar!@#')).toBe('foo-bar');
    });

    it('returns unknown for empty', () => {
        expect(normalizeSkillMetricKey('')).toBe('unknown');
    });
});

// ── ownerFromStageHint ─────────────────────────────────────────────────────

describe('ownerFromStageHint', () => {
    it('maps PM to PM', () => {
        expect(ownerFromStageHint('PM')).toBe('PM');
    });

    it('maps DEV to dev-sr', () => {
        expect(ownerFromStageHint('DEV')).toBe('dev-sr');
    });

    it('maps QA to qa', () => {
        expect(ownerFromStageHint('QA')).toBe('qa');
    });

    it('defaults to team-lead', () => {
        expect(ownerFromStageHint('UNKNOWN')).toBe('team-lead');
        expect(ownerFromStageHint('')).toBe('team-lead');
    });
});

// ── isEpicBootstrapTask ────────────────────────────────────────────────────

describe('isEpicBootstrapTask', () => {
    it('matches -001 suffix', () => {
        expect(isEpicBootstrapTask('MKT-001')).toBe(true);
        expect(isEpicBootstrapTask('ECOM-001')).toBe(true);
    });

    it('does not match other suffixes', () => {
        expect(isEpicBootstrapTask('MKT-002')).toBe(false);
        expect(isEpicBootstrapTask('MKT-100')).toBe(false);
    });

    it('matches lowercase (normalizes to uppercase)', () => {
        expect(isEpicBootstrapTask('mkt-001')).toBe(true);
    });
});

// ── strictOutputContractText ───────────────────────────────────────────────

describe('strictOutputContractText', () => {
    it('includes stage in output', () => {
        const text = strictOutputContractText('DEV');
        expect(text).toContain('ETAPA: <DEV>');
        expect(text).toContain('JSONPROMPT');
        expect(text).toContain('SWARMLOG');
    });

    it('uppercases stage', () => {
        const text = strictOutputContractText('pm');
        expect(text).toContain('ETAPA: <PM>');
    });
});

// ── inferTaskKind ──────────────────────────────────────────────────────────

describe('inferTaskKind', () => {
    const mockParseTodo = () => null;

    it('detects security keywords', () => {
        const kind = inferTaskKind({
            groupFolder: 'main',
            taskId: 'SEC-001',
            stageHint: '',
            track: 'fullstack',
            messages: [{ content: 'vulnerabilidad OWASP detectada', id: '1', timestamp: '2024-01-01', sender: 'u', chat_jid: 'j', sender_name: 'u' }],
            parseTodoTaskContext: mockParseTodo,
        });
        expect(kind).toBe('security');
    });

    it('detects devops keywords', () => {
        const kind = inferTaskKind({
            groupFolder: 'main',
            taskId: 'INFRA-001',
            stageHint: '',
            track: 'fullstack',
            messages: [{ content: 'deploy cloudflare subdominio', id: '1', timestamp: '2024-01-01', sender: 'u', chat_jid: 'j', sender_name: 'u' }],
            parseTodoTaskContext: mockParseTodo,
        });
        expect(kind).toBe('devops');
    });

    it('detects frontend keywords', () => {
        const kind = inferTaskKind({
            groupFolder: 'main',
            taskId: 'UI-001',
            stageHint: '',
            track: 'fullstack',
            messages: [{ content: 'landing page HTML CSS', id: '1', timestamp: '2024-01-01', sender: 'u', chat_jid: 'j', sender_name: 'u' }],
            parseTodoTaskContext: mockParseTodo,
        });
        expect(kind).toBe('frontend');
    });

    it('defaults to general for unknown content', () => {
        const kind = inferTaskKind({
            groupFolder: 'main',
            taskId: 'X-001',
            stageHint: '',
            track: 'fullstack',
            messages: [{ content: 'something generic', id: '1', timestamp: '2024-01-01', sender: 'u', chat_jid: 'j', sender_name: 'u' }],
            parseTodoTaskContext: mockParseTodo,
        });
        expect(kind).toBe('general');
    });

    it('uses track as fallback for execution signals', () => {
        const kind = inferTaskKind({
            groupFolder: 'main',
            taskId: 'X-001',
            stageHint: '',
            track: 'backend',
            messages: [{ content: 'implementar este fix ahora', id: '1', timestamp: '2024-01-01', sender: 'u', chat_jid: 'j', sender_name: 'u' }],
            parseTodoTaskContext: mockParseTodo,
        });
        expect(kind).toBe('backend');
    });
});
