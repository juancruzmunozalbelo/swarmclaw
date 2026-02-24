/**
 * Lane Helpers — pure utility functions for parallel lane management.
 * Extracted from index.ts during Sprint 7 decomposition.
 */

import {
    PARALLEL_SUBAGENT_COOLDOWN_MS,
    PARALLEL_SUBAGENT_RETRY_BASE_MS,
    PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER,
    PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS,
    PARALLEL_LANE_IDLE_TIMEOUT_MS,
    PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
    PARALLEL_ROLE_TIMEOUT_PM_MS,
    PARALLEL_ROLE_TIMEOUT_SPEC_MS,
    PARALLEL_ROLE_TIMEOUT_ARQ_MS,
    PARALLEL_ROLE_TIMEOUT_UX_MS,
    PARALLEL_ROLE_TIMEOUT_DEV_MS,
    PARALLEL_ROLE_TIMEOUT_DEV2_MS,
    PARALLEL_ROLE_TIMEOUT_DEVOPS_MS,
    PARALLEL_ROLE_TIMEOUT_QA_MS,
} from './config.js';
import type { SubagentRole } from './prompt-builder.js';

// ── State ──────────────────────────────────────────────────────────────────

const parallelLaneDispatchAt = new Map<string, number>();

/** @internal — for testing */
export function _resetLaneHelperState(): void {
    parallelLaneDispatchAt.clear();
}

// ── Pure helpers ───────────────────────────────────────────────────────────

export function waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Throttle parallel lane dispatches by key (e.g. chatJid:role).
 * Returns true if dispatch should proceed (cooldown elapsed).
 */
export function shouldDispatchParallelLane(key: string): boolean {
    const now = Date.now();
    const last = parallelLaneDispatchAt.get(key) || 0;
    if (now - last < PARALLEL_SUBAGENT_COOLDOWN_MS) return false;
    parallelLaneDispatchAt.set(key, now);
    return true;
}

/**
 * Exponential backoff delay for parallel lane retries.
 */
export function laneRetryDelayMs(retryAttempt: number): number {
    const exp = Math.max(0, retryAttempt - 1);
    const raw = PARALLEL_SUBAGENT_RETRY_BASE_MS
        * Math.pow(PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER, exp);
    return Math.min(PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS, Math.max(250, Math.round(raw)));
}

/**
 * Per-role timeout for parallel lane execution.
 */
export function laneTimeoutMs(role: SubagentRole): number {
    if (role === 'PM') return PARALLEL_ROLE_TIMEOUT_PM_MS;
    if (role === 'SPEC') return PARALLEL_ROLE_TIMEOUT_SPEC_MS;
    if (role === 'ARQ') return PARALLEL_ROLE_TIMEOUT_ARQ_MS;
    if (role === 'UX') return PARALLEL_ROLE_TIMEOUT_UX_MS;
    if (role === 'DEV') return PARALLEL_ROLE_TIMEOUT_DEV_MS;
    if (role === 'DEV2') return PARALLEL_ROLE_TIMEOUT_DEV2_MS;
    if (role === 'DEVOPS') return PARALLEL_ROLE_TIMEOUT_DEVOPS_MS;
    if (role === 'QA') return PARALLEL_ROLE_TIMEOUT_QA_MS;
    return Math.max(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS, PARALLEL_LANE_IDLE_TIMEOUT_MS);
}
