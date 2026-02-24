#!/usr/bin/env npx tsx
/**
 * Best-effort tailer for nanoclaw/logs/nanoclaw.log.
 *
 * Purpose:
 * - Append recent host-side activity into groups/main/swarmdev/events.jsonl
 * - Keep groups/main/swarmdev/metrics.json warm even when the agent doesn't emit ETAPA lines
 *
 * This is a fallback. The primary source of events is the NanoClaw runtime (src/index.ts).
 */

import fs from 'fs';
import path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

interface CollectorState {
    offset: number;
    carry: string;
}

interface Classification {
    kind: string;
    stage: string | undefined;
    item: string;
}

interface LogEvent {
    ts: string;
    groupFolder: string;
    kind: string;
    stage: string | undefined;
    item: string;
    msg: string;
    meta: Record<string, string>;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const projectRoot = path.resolve(new URL(import.meta.url).pathname, '..', '..');

const LOG_PATH = process.env.NANOCLAW_LOG_PATH || path.join(projectRoot, 'logs', 'nanoclaw.log');
const STATE_PATH = process.env.LOGCOLLECTOR_STATE_PATH || path.join(projectRoot, 'store', 'log-collector.json');
const GROUP_FOLDER = process.env.LOGCOLLECTOR_GROUP_FOLDER || 'main';

const SWARMDEV_DIR = path.join(projectRoot, 'groups', GROUP_FOLDER, 'swarmdev');
const EVENTS_PATH = path.join(SWARMDEV_DIR, 'events.jsonl');
const METRICS_PATH = path.join(SWARMDEV_DIR, 'metrics.json');

const MAX_BYTES_PER_RUN = parseInt(process.env.LOGCOLLECTOR_MAX_BYTES || '262144', 10);
const MAX_EVENTS_PER_RUN = parseInt(process.env.LOGCOLLECTOR_MAX_EVENTS || '200', 10);

// ── Utility functions ──────────────────────────────────────────────────────

export function stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return String(s || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function loadState(): CollectorState {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
        if (!raw || typeof raw !== 'object') return { offset: 0, carry: '' };
        return {
            offset: typeof raw.offset === 'number' ? raw.offset : 0,
            carry: typeof raw.carry === 'string' ? raw.carry : '',
        };
    } catch {
        return { offset: 0, carry: '' };
    }
}

function saveState(st: CollectorState): void {
    try {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        const tmp = `${STATE_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmp, STATE_PATH);
    } catch {
        // ignore
    }
}

function rotateIfTooBig(p: string, maxBytes: number): void {
    try {
        const st = fs.statSync(p);
        if (st.size <= maxBytes) return;
    } catch {
        return;
    }
    for (let i = 2; i >= 1; i--) {
        const src = `${p}.${i}`;
        const dst = `${p}.${i + 1}`;
        try {
            if (fs.existsSync(src)) fs.renameSync(src, dst);
        } catch {
            // ignore
        }
    }
    try {
        fs.renameSync(p, `${p}.1`);
    } catch {
        // ignore
    }
}

function appendJsonl(p: string, obj: LogEvent): void {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    rotateIfTooBig(p, 5 * 1024 * 1024);
    fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf-8');
}

function writeMetrics(partial: Record<string, string>): void {
    try {
        fs.mkdirSync(path.dirname(METRICS_PATH), { recursive: true });
        let cur: Record<string, unknown> = {};
        try {
            if (fs.existsSync(METRICS_PATH)) cur = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf-8'));
        } catch {
            cur = {};
        }
        const out = { ...cur, ...partial, updatedAt: new Date().toISOString() };
        const tmp = `${METRICS_PATH}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmp, METRICS_PATH);
    } catch {
        // ignore
    }
}

export function classify(line: string): Classification {
    const lower = line.toLowerCase();

    const level =
        lower.includes(' error ') || lower.includes('error (') ? 'error'
            : lower.includes(' warn ') || lower.includes('warn (') ? 'warn'
                : lower.includes(' info ') || lower.includes('info (') ? 'info'
                    : lower.includes(' debug ') || lower.includes('debug (') ? 'debug'
                        : 'unknown';

    if (lower.includes('timeout in awaitinginitialsync')) {
        return { kind: 'logcollector', stage: 'idle', item: 'wa_initial_sync_timeout' };
    }
    if (
        lower.includes('failed to decrypt message') ||
        lower.includes('transaction failed, rolling back') ||
        lower.includes('received error in ack') ||
        lower.includes('no session found to decrypt message') ||
        lower.includes('messagecountererror') ||
        lower.includes('closing open session in favor of incoming prekey bundle')
    ) {
        return { kind: 'logcollector', stage: undefined, item: 'wa_transport_noise' };
    }

    if (lower.includes('container agent error')) return { kind: 'error', stage: 'error', item: 'container agent error' };
    if (lower.includes('agent error')) return { kind: 'error', stage: 'error', item: 'agent error' };
    if (lower.includes('processing messages')) return { kind: 'logcollector', stage: 'running', item: 'processing messages' };
    if (lower.includes('spawning container agent')) return { kind: 'spawn', stage: 'running', item: 'spawning container agent' };
    if (lower.includes('agent output:')) return { kind: 'agent_output', stage: undefined, item: 'agent output' };
    if (lower.includes('shutdown signal received')) return { kind: 'finish', stage: 'idle', item: 'shutdown' };
    if (level === 'error') return { kind: 'error', stage: 'error', item: 'error' };
    if (level === 'warn') return { kind: 'logcollector', stage: undefined, item: 'warn' };
    return { kind: 'logcollector', stage: undefined, item: 'log' };
}

export function extractAgentOutputMsg(line: string): string {
    const m = line.match(/Agent output:\s*(.*)\s*$/);
    return m ? m[1].trim() : '';
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
    if (!fs.existsSync(LOG_PATH)) return;

    const st = loadState();
    const stat = fs.statSync(LOG_PATH);
    const size = stat.size;

    let offset = st.offset || 0;
    if (size < offset) offset = 0;

    const start = Math.max(0, size - Math.min(size, MAX_BYTES_PER_RUN));
    if (offset < start) offset = start;

    const fd = fs.openSync(LOG_PATH, 'r');
    try {
        const toRead = Math.max(0, size - offset);
        if (toRead <= 0) return;

        const buf = Buffer.allocUnsafe(toRead);
        fs.readSync(fd, buf, 0, toRead, offset);
        offset = size;

        let text = st.carry + buf.toString('utf-8');
        text = stripAnsi(text);
        const lines = text.split('\n');

        const carry = lines.pop() || '';
        saveState({ offset, carry });

        const nowIso = new Date().toISOString();
        let n = 0;
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (!/^\[\d{2}:\d{2}:\d{2}\.\d{3}]\s+/.test(line)) continue;

            const c = classify(line);
            const ev: LogEvent = {
                ts: nowIso,
                groupFolder: GROUP_FOLDER,
                kind: c.kind,
                stage: c.stage,
                item: c.item,
                msg: c.kind === 'agent_output' ? extractAgentOutputMsg(line).slice(0, 500) : line.slice(0, 500),
                meta: { source: 'nanoclaw.log' },
            };
            appendJsonl(EVENTS_PATH, ev);

            if (
                c.item &&
                (c.kind === 'error' || c.kind === 'spawn' || c.kind === 'finish' ||
                    c.item === 'processing messages' || c.item === 'wa_initial_sync_timeout')
            ) {
                writeMetrics({
                    stage: c.stage || (c.kind === 'finish' ? 'idle' : 'running'),
                    item: c.item === 'wa_initial_sync_timeout' ? 'WA initial sync timeout (benigno)' : c.item,
                    next: c.kind === 'error' ? 'check logs/events'
                        : c.kind === 'finish' ? 'awaiting next message'
                            : c.item === 'wa_initial_sync_timeout' ? 'continuing'
                                : 'waiting for agent output',
                });
            }

            n++;
            if (n >= MAX_EVENTS_PER_RUN) break;
        }
    } finally {
        try { fs.closeSync(fd); } catch { /* ignore */ }
    }
}

main();
