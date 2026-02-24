/**
 * Trace Context — task-scoped TraceIDs for distributed tracing.
 * Uses AsyncLocalStorage to propagate trace context through async call chains.
 *
 * Sprint 13 — Audit item #11 (Observability).
 *
 * Usage:
 *   runWithTrace({ traceId, taskId, groupFolder }, async () => {
 *     traceLogger().info('this log includes traceId automatically');
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TraceContext {
    /** Unique trace ID for this execution span */
    traceId: string;
    /** Task ID being processed */
    taskId?: string;
    /** Group folder context */
    groupFolder?: string;
    /** Role/stage being executed */
    role?: string;
    /** Timestamp when the trace started */
    startedAt: number;
}

// ── Storage ────────────────────────────────────────────────────────────────

const traceStore = new AsyncLocalStorage<TraceContext>();

/** Generate a short trace ID (8 hex chars) */
export function generateTraceId(): string {
    return crypto.randomBytes(4).toString('hex');
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Run a function within a trace context.
 * All logs inside the callback will automatically include trace metadata.
 */
export function runWithTrace<T>(
    ctx: Omit<TraceContext, 'startedAt'> & { startedAt?: number },
    fn: () => T,
): T {
    const full: TraceContext = {
        ...ctx,
        startedAt: ctx.startedAt ?? Date.now(),
    };
    return traceStore.run(full, fn);
}

/** Get the current trace context, or undefined if not in a traced scope */
export function currentTrace(): TraceContext | undefined {
    return traceStore.getStore();
}

/** Get a child logger that includes trace context fields */
export function traceLogger() {
    const ctx = traceStore.getStore();
    if (!ctx) return logger;
    return logger.child({
        traceId: ctx.traceId,
        ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
        ...(ctx.groupFolder ? { groupFolder: ctx.groupFolder } : {}),
        ...(ctx.role ? { role: ctx.role } : {}),
    });
}

/**
 * Create a trace context for a message processing cycle.
 * Helper that generates a traceId and sets common fields.
 */
export function createProcessingTrace(params: {
    taskId?: string;
    groupFolder: string;
    role?: string;
}): Omit<TraceContext, 'startedAt'> {
    return {
        traceId: generateTraceId(),
        taskId: params.taskId,
        groupFolder: params.groupFolder,
        role: params.role,
    };
}

/**
 * Measure elapsed time since trace start.
 * Returns 0 if not in a traced scope.
 */
export function traceElapsedMs(): number {
    const ctx = traceStore.getStore();
    if (!ctx) return 0;
    return Date.now() - ctx.startedAt;
}
