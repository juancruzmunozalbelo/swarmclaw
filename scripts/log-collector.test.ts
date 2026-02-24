import { describe, it, expect } from 'vitest';
import { classify, extractAgentOutputMsg, stripAnsi } from './log-collector.js';

describe('stripAnsi', () => {
    it('removes ANSI escape codes', () => {
        expect(stripAnsi('\x1B[31merror\x1B[0m')).toBe('error');
    });
    it('handles empty/null input', () => {
        expect(stripAnsi('')).toBe('');
    });
});

describe('classify', () => {
    it('detects container agent error', () => {
        const c = classify('[12:00:00.000] INFO Container agent error occurred');
        expect(c.kind).toBe('error');
        expect(c.item).toBe('container agent error');
    });
    it('detects agent error', () => {
        const c = classify('[12:00:00.000] ERROR Agent error in processing');
        expect(c.kind).toBe('error');
        expect(c.item).toBe('agent error');
    });
    it('detects processing messages', () => {
        const c = classify('[12:00:00.000] INFO Processing messages for group');
        expect(c.kind).toBe('logcollector');
        expect(c.item).toBe('processing messages');
    });
    it('detects spawning container agent', () => {
        const c = classify('[12:00:00.000] INFO Spawning container agent nanoclaw-main');
        expect(c.kind).toBe('spawn');
        expect(c.item).toBe('spawning container agent');
    });
    it('detects agent output', () => {
        const c = classify('[12:00:00.000] INFO Agent output: ETAPA: DEV');
        expect(c.kind).toBe('agent_output');
        expect(c.item).toBe('agent output');
    });
    it('detects shutdown', () => {
        const c = classify('[12:00:00.000] INFO Shutdown signal received');
        expect(c.kind).toBe('finish');
        expect(c.item).toBe('shutdown');
    });
    it('detects WA transport noise', () => {
        const c = classify('[12:00:00.000] WARN Failed to decrypt message from user');
        expect(c.kind).toBe('logcollector');
        expect(c.item).toBe('wa_transport_noise');
    });
    it('detects WA sync timeout', () => {
        const c = classify('[12:00:00.000] WARN timeout in AwaitingInitialSync');
        expect(c.kind).toBe('logcollector');
        expect(c.item).toBe('wa_initial_sync_timeout');
    });
    it('defaults to logcollector for unknown lines', () => {
        const c = classify('[12:00:00.000] INFO Some unrecognized log line');
        expect(c.kind).toBe('logcollector');
        expect(c.item).toBe('log');
    });
});

describe('extractAgentOutputMsg', () => {
    it('extracts the message after "Agent output:"', () => {
        expect(extractAgentOutputMsg('Agent output: ETAPA: DEV'))
            .toBe('ETAPA: DEV');
    });
    it('returns empty for non-matching lines', () => {
        expect(extractAgentOutputMsg('some random line')).toBe('');
    });
});
