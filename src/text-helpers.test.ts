import { describe, it, expect } from 'vitest';

import {
    inferStageHint,
    stageFromAgentText,
    workflowStageFromRuntimeStage,
    extractSwarmlogObjects,
    buildSwarmlogFallback,
    sanitizeUserFacingText,
    stripAnnoyingClosers,
    looksLikeContinueQuestion,
    hasBlockingSignals,
    stripNonBlockingQuestions,
    normalizeScope,
    detectExecutionTrack,
    detectPlanningOnlyOverride,
    detectDevopsOnlyOverride,
    extractContinuationHints,
    nowIso,
} from './text-helpers.js';

describe('inferStageHint', () => {
    it('returns TEAMLEAD for teamlead mentions', () => {
        expect(inferStageHint('habla con el teamlead')).toBe('TEAMLEAD');
        expect(inferStageHint('Andy hacé algo')).toBe('TEAMLEAD');
    });
    it('returns PM for planning mentions', () => {
        expect(inferStageHint('actua como pm')).toBe('PM');
        expect(inferStageHint('desglosá las tareas')).toBe('PM');
    });
    it('returns DEV for implementation mentions', () => {
        expect(inferStageHint('actua como dev')).toBe('DEV');
        expect(inferStageHint('implementa el login')).toBe('DEV');
    });
    it('returns QA for test mentions', () => {
        expect(inferStageHint('actua como qa')).toBe('QA');
        expect(inferStageHint('corré los tests')).toBe('QA');
    });
    it('returns DEVOPS for infra mentions', () => {
        expect(inferStageHint('deploy a cloudflare')).toBe('DEVOPS');
    });
    it('defaults to TEAMLEAD for unknown input', () => {
        expect(inferStageHint('hola')).toBe('TEAMLEAD');
        expect(inferStageHint('')).toBe('TEAMLEAD');
    });
});

describe('stageFromAgentText', () => {
    it('parses ETAPA: line', () => {
        expect(stageFromAgentText('ETAPA: DEV')).toBe('DEV');
        expect(stageFromAgentText('ETAPA: teamlead')).toBe('TEAMLEAD');
        expect(stageFromAgentText('ETAPA: qa')).toBe('QA');
    });
    it('returns null for empty', () => {
        expect(stageFromAgentText('')).toBeNull();
    });
    it('detects heuristic fallback', () => {
        expect(stageFromAgentText('etapa pm con tareas')).toBe('PM');
    });
});

describe('workflowStageFromRuntimeStage', () => {
    it('maps known stages', () => {
        expect(workflowStageFromRuntimeStage('TEAMLEAD')).toBe('TEAMLEAD');
        expect(workflowStageFromRuntimeStage('ARQ')).toBe('SPEC');
        expect(workflowStageFromRuntimeStage('UX')).toBe('DEV');
        expect(workflowStageFromRuntimeStage('ERROR')).toBe('BLOCKED');
    });
    it('returns null for idle/running', () => {
        expect(workflowStageFromRuntimeStage('IDLE')).toBeNull();
        expect(workflowStageFromRuntimeStage('RUNNING')).toBeNull();
    });
});

describe('extractSwarmlogObjects', () => {
    it('parses SWARMLOG JSON', () => {
        const text = 'SWARMLOG: {"action":"write","stage":"DEV"}';
        const logs = extractSwarmlogObjects(text);
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('write');
    });
    it('ignores malformed JSON', () => {
        expect(extractSwarmlogObjects('SWARMLOG: {bad}')).toHaveLength(0);
    });
    it('handles multiple lines', () => {
        const text = 'SWARMLOG: {"a":1}\nSWARMLOG: {"b":2}';
        expect(extractSwarmlogObjects(text)).toHaveLength(2);
    });
});

describe('buildSwarmlogFallback', () => {
    it('builds from last log entry', () => {
        const result = buildSwarmlogFallback([{ stage: 'DEV', detail: 'wrote file' }]);
        expect(result).toContain('ETAPA: DEV');
        expect(result).toContain('wrote file');
    });
    it('returns default for empty logs', () => {
        expect(buildSwarmlogFallback([])).toBe('Actualizando estado de la tarea.');
    });
});

describe('sanitizeUserFacingText', () => {
    it('strips SWARMLOG lines', () => {
        const text = 'hello\nSWARMLOG: {"a":1}\nworld';
        const { userText, logs } = sanitizeUserFacingText(text);
        expect(userText).toBe('hello\nworld');
        expect(logs).toHaveLength(1);
    });
});

describe('stripAnnoyingClosers', () => {
    it('removes algo más questions', () => {
        expect(stripAnnoyingClosers('done\n¿Algo más?')).toBe('done');
    });
    it('removes continuo questions', () => {
        expect(stripAnnoyingClosers('ready\n¿Continúo con lo siguiente?')).toBe('ready');
    });
});

describe('looksLikeContinueQuestion', () => {
    it('detects Spanish continue phrasing', () => {
        expect(looksLikeContinueQuestion('¿Continúo con la tarea?')).toBe(true);
        expect(looksLikeContinueQuestion('¿arranco con la implementacion?')).toBe(true);
    });
    it('detects English continue phrasing', () => {
        expect(looksLikeContinueQuestion('do you want me to continue with the next task?')).toBe(true);
    });
    it('rejects non-questions', () => {
        expect(looksLikeContinueQuestion('el resultado es correcto')).toBe(false);
    });
});

describe('hasBlockingSignals', () => {
    it('detects block keywords', () => {
        expect(hasBlockingSignals('está bloqueado por credenciales')).toBe(true);
        expect(hasBlockingSignals('need decision from team')).toBe(true);
    });
    it('returns false for normal text', () => {
        expect(hasBlockingSignals('todo listo')).toBe(false);
    });
});

describe('stripNonBlockingQuestions', () => {
    it('keeps blocking questions', () => {
        const text = 'info\n¿Está bloqueado por algo?\nfin';
        expect(stripNonBlockingQuestions(text)).toContain('bloqueado');
    });
    it('strips non-blocking questions', () => {
        const text = 'info\n¿Seguimos?\nfin';
        const result = stripNonBlockingQuestions(text);
        expect(result).not.toContain('Seguimos');
        expect(result).toContain('info');
        expect(result).toContain('fin');
    });
});

describe('normalizeScope', () => {
    it('cleans markdown and URLs', () => {
        const result = normalizeScope('**Implementar** el login con https://example.com/api');
        expect(result).not.toContain('**');
        expect(result).not.toContain('https://');
    });
    it('returns default for empty', () => {
        expect(normalizeScope('')).toBe('Tarea operativa del ciclo actual');
    });
    it('truncates to 140 chars', () => {
        const long = 'a'.repeat(200);
        expect(normalizeScope(long).length).toBeLessThanOrEqual(140);
    });
});

describe('detectExecutionTrack', () => {
    it('detects frontend from messages', () => {
        const msgs = [{ content: 'implementar landing page con tailwind' }] as any[];
        expect(detectExecutionTrack(msgs, '')).toBe('frontend');
    });
    it('detects backend from messages', () => {
        const msgs = [{ content: 'crear endpoint REST con auth JWT' }] as any[];
        expect(detectExecutionTrack(msgs, '')).toBe('backend');
    });
    it('defaults to fullstack', () => {
        const msgs = [{ content: 'hola' }] as any[];
        expect(detectExecutionTrack(msgs, '')).toBe('fullstack');
    });
});

describe('detectPlanningOnlyOverride', () => {
    it('detects no-code signals', () => {
        const msgs = [{ content: 'solo pm+spec+arq en paralelo' }] as any[];
        expect(detectPlanningOnlyOverride(msgs)).toBe(true);
    });
    it('returns false normally', () => {
        expect(detectPlanningOnlyOverride([{ content: 'implementa' }] as any[])).toBe(false);
    });
});

describe('extractContinuationHints', () => {
    it('extracts SIGUIENTE IDs', () => {
        const result = extractContinuationHints('SIGUIENTE: ECOM-003, ECOM-004');
        expect(result).toContain('ECOM-003');
        expect(result).toContain('ECOM-004');
    });
    it('extracts continuando con ID', () => {
        const result = extractContinuationHints('continuando con MKT-012');
        expect(result).toContain('MKT-012');
    });
    it('returns empty for no hints', () => {
        expect(extractContinuationHints('all done')).toEqual([]);
    });
});

describe('nowIso', () => {
    it('returns valid ISO string', () => {
        const iso = nowIso();
        expect(new Date(iso).toISOString()).toBe(iso);
    });
});
