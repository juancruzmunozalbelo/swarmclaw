/**
 * Phase context and types shared across processGroupMessages phases.
 * Sprint 3 — Monolith decomposition.
 */

import type { NewMessage, RegisteredGroup } from '../types.js';

/**
 * Shared mutable context threaded through all phases.
 * This replaces the closure-captured variables from the original monolithic function.
 */
export interface PhaseContext {
    chatJid: string;
    group: RegisteredGroup;
    isMainGroup: boolean;
    stageHint: string;
    taskIds: string[];
    missedMessages: NewMessage[];
    prompt: string;

    // Mutable state set by Phase 3+
    previousCursor: string;
    hadError: boolean;
    outputSentToUser: boolean;
    validationViolation: boolean;
}

/**
 * Timer handles created in Phase 3, cleaned up in Phase 5.
 */
export interface PhaseTimers {
    idleTimer: ReturnType<typeof setTimeout> | null;
    dashIdleTimer: ReturnType<typeof setTimeout> | null;
    heartbeatTimer: ReturnType<typeof setInterval> | null;
    resetIdleTimer: () => void;
    scheduleDashIdle: () => void;
}
