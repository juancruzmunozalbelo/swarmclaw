/**
 * Phase modules barrel export.
 * Sprint 3 — Monolith decomposition.
 */
export type { PhaseContext, PhaseTimers } from './types.js';
export { setupPhase } from './setup.js';
export { preflightPhase } from './preflight.js';
export { timersPhase } from './timers.js';
export { buildOutputCallback } from './execution.js';
export { cleanupPhase } from './cleanup.js';
