/**
 * Model Circuit Breaker — manages fallback logic for LLM model attempts.
 * Extracted from index.ts during Sprint 1 decomposition.
 */
import {
    MODEL_PRIMARY,
    MODEL_FALLBACKS,
    MODEL_CIRCUIT_BREAKER_ENABLED,
    MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    MODEL_CIRCUIT_BREAKER_OPEN_MS,
    TASK_CIRCUIT_BREAKER_ENABLED,
    TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    TASK_CIRCUIT_BREAKER_OPEN_MS,
} from './config.js';
import { getRouterState, setRouterState } from './db.js';
import { logger } from './logger.js';

export type ModelCircuitState = {
    failures: number;
    openUntil: number;
    lastError: string;
    lastFailureAt: number;
};

export const modelCircuitByName = new Map<string, ModelCircuitState>();

export function isModelFallbackRetryable(errorText: string): boolean {
    const t = String(errorText || '').toLowerCase();
    if (!t) return false;
    return /(timeout|timed out|429|rate limit|503|overload|overloaded|unavailable|network|econn|sigkill|code 143|killed|terminated)/i.test(t);
}

export function getModelAttemptPlan(): string[] {
    const ordered = [MODEL_PRIMARY, ...MODEL_FALLBACKS]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i);
    if (!MODEL_CIRCUIT_BREAKER_ENABLED) return ordered;
    const now = Date.now();
    const available = ordered.filter((model) => {
        const st = modelCircuitByName.get(model);
        return !st || st.openUntil <= now;
    });
    if (available.length > 0) return available;
    return ordered.slice(0, 1);
}

export function onModelAttemptFailure(model: string | undefined, errorText: string): void {
    const m = String(model || '').trim();
    if (!m || !MODEL_CIRCUIT_BREAKER_ENABLED) return;
    const now = Date.now();
    const prev = modelCircuitByName.get(m) || {
        failures: 0,
        openUntil: 0,
        lastError: '',
        lastFailureAt: 0,
    };
    const failures = prev.failures + 1;
    const shouldOpen = failures >= MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    modelCircuitByName.set(m, {
        failures: shouldOpen ? 0 : failures,
        openUntil: shouldOpen ? now + MODEL_CIRCUIT_BREAKER_OPEN_MS : prev.openUntil,
        lastError: String(errorText || '').slice(0, 500),
        lastFailureAt: now,
    });
    _persistModelCircuit();
}

export function onModelAttemptSuccess(model: string | undefined): void {
    const m = String(model || '').trim();
    if (!m) return;
    modelCircuitByName.delete(m);
}

/** @internal — for testing only */
export function _resetModelCircuit(): void {
    modelCircuitByName.clear();
}

function _persistModelCircuit(): void {
    try {
        const data: Record<string, ModelCircuitState> = {};
        for (const [k, v] of modelCircuitByName) data[k] = v;
        setRouterState('model_circuit_state', JSON.stringify(data));
    } catch { /* best-effort */ }
}

function _persistTaskRoleCircuit(): void {
    try {
        const data: Record<string, TaskRoleCircuitState> = {};
        for (const [k, v] of taskRoleCircuit) data[k] = v;
        setRouterState('task_role_circuit_state', JSON.stringify(data));
    } catch { /* best-effort */ }
}

/** Load persisted circuit breaker states from SQLite. Call after initDatabase(). */
export function loadCircuitBreakerState(): void {
    try {
        const modelRaw = getRouterState('model_circuit_state');
        if (modelRaw) {
            const data = JSON.parse(modelRaw) as Record<string, ModelCircuitState>;
            for (const [k, v] of Object.entries(data)) modelCircuitByName.set(k, v);
            logger.info({ count: Object.keys(data).length }, 'Loaded model circuit breaker state from DB');
        }
    } catch (err) { logger.warn({ err }, 'Failed to load model circuit state'); }
    try {
        const taskRaw = getRouterState('task_role_circuit_state');
        if (taskRaw) {
            const data = JSON.parse(taskRaw) as Record<string, TaskRoleCircuitState>;
            for (const [k, v] of Object.entries(data)) taskRoleCircuit.set(k, v);
            logger.info({ count: Object.keys(data).length }, 'Loaded task+role circuit breaker state from DB');
        }
    } catch (err) { logger.warn({ err }, 'Failed to load task circuit state'); }
}

/** @internal — for testing only */
export function _getModelCircuitState(model: string): ModelCircuitState | undefined {
    return modelCircuitByName.get(model);
}

// ── Task+Role Circuit Breaker ─────────────────────────────────────────────

export type TaskRoleCircuitState = {
    failures: number;
    openUntil: number;
    lastError: string;
    lastFailureAt: number;
};

const taskRoleCircuit = new Map<string, TaskRoleCircuitState>();

function taskRoleKey(taskId: string, role: string): string {
    return `${String(taskId || '').trim().toUpperCase()}:${String(role || '').trim().toUpperCase()}`;
}

/**
 * Returns true if the circuit for (taskId, role) is currently open (paused).
 */
export function isTaskRoleOpen(taskId: string, role: string): boolean {
    if (!TASK_CIRCUIT_BREAKER_ENABLED) return false;
    const key = taskRoleKey(taskId, role);
    const st = taskRoleCircuit.get(key);
    if (!st) return false;
    if (st.openUntil > 0 && st.openUntil <= Date.now()) {
        taskRoleCircuit.delete(key);
        return false;
    }
    return st.openUntil > 0;
}

/**
 * Record a failure for (taskId, role). Opens the circuit when threshold is reached.
 */
export function onTaskRoleFailure(taskId: string, role: string, errorText: string): void {
    if (!TASK_CIRCUIT_BREAKER_ENABLED) return;
    const key = taskRoleKey(taskId, role);
    const now = Date.now();
    const prev = taskRoleCircuit.get(key) || {
        failures: 0,
        openUntil: 0,
        lastError: '',
        lastFailureAt: 0,
    };
    const failures = prev.failures + 1;
    const shouldOpen = failures >= TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
    taskRoleCircuit.set(key, {
        failures: shouldOpen ? 0 : failures,
        openUntil: shouldOpen ? now + TASK_CIRCUIT_BREAKER_OPEN_MS : prev.openUntil,
        lastError: String(errorText || '').slice(0, 500),
        lastFailureAt: now,
    });
    _persistTaskRoleCircuit();
}

/**
 * Record a success for (taskId, role). Clears accumulated failures.
 */
export function onTaskRoleSuccess(taskId: string, role: string): void {
    const key = taskRoleKey(taskId, role);
    taskRoleCircuit.delete(key);
}

/** @internal — for testing only */
export function _resetTaskRoleCircuit(): void {
    taskRoleCircuit.clear();
}

/** @internal — for testing only */
export function _getTaskRoleCircuitState(taskId: string, role: string): TaskRoleCircuitState | undefined {
    return taskRoleCircuit.get(taskRoleKey(taskId, role));
}
