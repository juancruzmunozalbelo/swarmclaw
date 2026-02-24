#!/usr/bin/env npx tsx
/**
 * SLO Monitor — reads runtime metrics and checks SLO thresholds.
 * Emits breach events via actions.jsonl.
 *
 * Designed to run periodically (e.g. every 5m via cron/launchctl).
 * Exports pure functions for testability.
 */

import fs from 'fs';
import path from 'path';

// ── Config ─────────────────────────────────────────────────────────────────

const HOME = process.env.HOME || '';
const ROOT = process.env.NANOCLAW_ROOT || path.join(HOME, 'nanoclaw');
const RUNTIME_METRICS_PATH = path.join(ROOT, 'groups', 'main', 'swarmdev', 'runtime-metrics.json');
const ACTIONS_PATH = path.join(ROOT, 'groups', 'main', 'swarmdev', 'actions.jsonl');

const SLO_ERROR_RATE_THRESHOLD = Number(process.env.SLO_ERROR_RATE_THRESHOLD || 0.3);
const SLO_VALIDATION_FAIL_RATE_THRESHOLD = Number(process.env.SLO_VALIDATION_FAIL_RATE_THRESHOLD || 0.25);
const SLO_MIN_REQUESTS = Number(process.env.SLO_MIN_REQUESTS || 10);
const SLO_STALE_METRICS_MS = Number(process.env.SLO_STALE_METRICS_MS || 30 * 60 * 1000); // 30m

// ── Types ──────────────────────────────────────────────────────────────────

export interface RuntimeMetrics {
    updatedAt: string | null;
    counters: {
        requestsStarted: number;
        outputsSent: number;
        agentErrors: number;
        validationFailures: number;
        contractFailures: number;
        artifactFailures: number;
        devGateFailures: number;
    };
}

export interface SloCheckResult {
    ok: boolean;
    breaches: SloBreachEntry[];
}

export interface SloBreachEntry {
    slo: string;
    value: number;
    threshold: number;
    msg: string;
}

// ── Pure functions ─────────────────────────────────────────────────────────

export function checkErrorRate(metrics: RuntimeMetrics): SloBreachEntry | null {
    const req = Math.max(0, metrics.counters.requestsStarted);
    const err = Math.max(0, metrics.counters.agentErrors);
    if (req < SLO_MIN_REQUESTS) return null;
    const rate = err / Math.max(1, req);
    if (rate < SLO_ERROR_RATE_THRESHOLD) return null;
    return {
        slo: 'error_rate',
        value: Math.round(rate * 100),
        threshold: Math.round(SLO_ERROR_RATE_THRESHOLD * 100),
        msg: `Error rate ${Math.round(rate * 100)}% exceeds SLO threshold ${Math.round(SLO_ERROR_RATE_THRESHOLD * 100)}%`,
    };
}

export function checkValidationFailRate(metrics: RuntimeMetrics): SloBreachEntry | null {
    const req = Math.max(0, metrics.counters.requestsStarted);
    const val = Math.max(0, metrics.counters.validationFailures);
    if (req < SLO_MIN_REQUESTS) return null;
    const rate = val / Math.max(1, req);
    if (rate < SLO_VALIDATION_FAIL_RATE_THRESHOLD) return null;
    return {
        slo: 'validation_fail_rate',
        value: Math.round(rate * 100),
        threshold: Math.round(SLO_VALIDATION_FAIL_RATE_THRESHOLD * 100),
        msg: `Validation fail rate ${Math.round(rate * 100)}% exceeds SLO threshold ${Math.round(SLO_VALIDATION_FAIL_RATE_THRESHOLD * 100)}%`,
    };
}

export function checkMetricsStaleness(metrics: RuntimeMetrics): SloBreachEntry | null {
    if (!metrics.updatedAt) return null;
    const updatedMs = Date.parse(metrics.updatedAt);
    if (!Number.isFinite(updatedMs)) return null;
    const ageMs = Date.now() - updatedMs;
    if (ageMs < SLO_STALE_METRICS_MS) return null;
    const ageMin = Math.round(ageMs / 60_000);
    return {
        slo: 'metrics_stale',
        value: ageMin,
        threshold: Math.round(SLO_STALE_METRICS_MS / 60_000),
        msg: `Runtime metrics stale (${ageMin}m old, threshold ${Math.round(SLO_STALE_METRICS_MS / 60_000)}m)`,
    };
}

export function checkOutputSuccessRate(metrics: RuntimeMetrics): SloBreachEntry | null {
    const req = Math.max(0, metrics.counters.requestsStarted);
    const out = Math.max(0, metrics.counters.outputsSent);
    if (req < SLO_MIN_REQUESTS) return null;
    const successRate = out / Math.max(1, req);
    if (successRate >= 0.5) return null;
    return {
        slo: 'output_success_rate',
        value: Math.round(successRate * 100),
        threshold: 50,
        msg: `Output success rate ${Math.round(successRate * 100)}% is below 50% SLO`,
    };
}

export function runSloChecks(metrics: RuntimeMetrics): SloCheckResult {
    const breaches: SloBreachEntry[] = [];
    const checks = [
        checkErrorRate(metrics),
        checkValidationFailRate(metrics),
        checkMetricsStaleness(metrics),
        checkOutputSuccessRate(metrics),
    ];
    for (const result of checks) {
        if (result) breaches.push(result);
    }
    return { ok: breaches.length === 0, breaches };
}

// ── Side-effecting main ────────────────────────────────────────────────────

function safeReadMetrics(): RuntimeMetrics | null {
    try {
        if (!fs.existsSync(RUNTIME_METRICS_PATH)) return null;
        const raw = JSON.parse(fs.readFileSync(RUNTIME_METRICS_PATH, 'utf-8'));
        if (!raw || typeof raw !== 'object') return null;
        const c = raw.counters || {};
        return {
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
            counters: {
                requestsStarted: Number(c.requestsStarted || 0),
                outputsSent: Number(c.outputsSent || 0),
                agentErrors: Number(c.agentErrors || 0),
                validationFailures: Number(c.validationFailures || 0),
                contractFailures: Number(c.contractFailures || 0),
                artifactFailures: Number(c.artifactFailures || 0),
                devGateFailures: Number(c.devGateFailures || 0),
            },
        };
    } catch {
        return null;
    }
}

function appendAction(action: string, detail: string, meta: Record<string, unknown> = {}): void {
    try {
        const row = {
            ts: new Date().toISOString(),
            groupFolder: 'main',
            stage: 'SLO',
            action,
            detail,
            files: ['scripts/slo-monitor.ts'],
            meta,
        };
        fs.mkdirSync(path.dirname(ACTIONS_PATH), { recursive: true });
        fs.appendFileSync(ACTIONS_PATH, `${JSON.stringify(row)}\n`, 'utf-8');
    } catch {
        // ignore
    }
}

function main(): void {
    const metrics = safeReadMetrics();
    if (!metrics) {
        console.log('SLO: no runtime metrics available');
        return;
    }

    const result = runSloChecks(metrics);
    if (result.ok) {
        console.log('SLO: all checks pass');
        return;
    }

    for (const breach of result.breaches) {
        console.warn(`SLO BREACH: ${breach.msg}`);
        appendAction('slo_breach', breach.msg, {
            slo: breach.slo,
            value: breach.value,
            threshold: breach.threshold,
        });
    }
}

// Only run main when executed directly
const isDirectExecution = process.argv[1]?.endsWith('slo-monitor.ts') || process.argv[1]?.endsWith('slo-monitor.js');
if (isDirectExecution) {
    main();
}
