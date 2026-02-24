/**
 * Circuit Breaker Handler — connects task+role circuit breaker
 * to workflow transitions and user notifications.
 * Extracted as a standalone module during Sprint 8.
 *
 * When a circuit opens (too many failures for a task+role),
 * transitions the task to BLOCKED and notifies the user.
 */

import { isTaskRoleOpen, onTaskRoleFailure, onTaskRoleSuccess, _getTaskRoleCircuitState } from './model-circuit.js';
import { transitionTaskStage } from './swarm-workflow.js';
import { appendSwarmAction, appendSwarmEvent } from './swarm-events.js';
import { ASSISTANT_NAME } from './config.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CircuitBreakerDeps {
    /** Send a notification message to the user */
    sendNotification: (chatJid: string, text: string) => void;
}

export interface CircuitCheckResult {
    blocked: boolean;
    reason?: string;
}

// ── Pre-dispatch check ─────────────────────────────────────────────────────

/**
 * Check if the circuit breaker for (taskId, role) is open.
 * If open → transition to BLOCKED, notify user, log action.
 * Returns { blocked: true } if the task should NOT be dispatched.
 */
export function checkCircuitBeforeDispatch(
    params: {
        taskId: string;
        role: string;
        groupFolder: string;
        chatJid: string;
    },
    deps: CircuitBreakerDeps,
): CircuitCheckResult {
    if (!isTaskRoleOpen(params.taskId, params.role)) {
        return { blocked: false };
    }

    const circuitState = _getTaskRoleCircuitState(params.taskId, params.role);
    const lastError = circuitState?.lastError || 'repeated failures';

    // Transition to BLOCKED
    const transition = transitionTaskStage({
        groupFolder: params.groupFolder,
        taskId: params.taskId,
        to: 'BLOCKED',
        reason: `circuit breaker open for ${params.role}: ${lastError}`,
    });

    // Log action
    appendSwarmAction(params.groupFolder, {
        action: 'circuit_breaker_blocked',
        stage: params.role,
        detail: `Task ${params.taskId} blocked by circuit breaker (${params.role})`,
        files: [],
        meta: {
            taskId: params.taskId,
            role: params.role,
            lastError,
            transitionOk: transition.ok,
        },
    });

    // Notify user
    const msg = [
        `⚠️ ${ASSISTANT_NAME}: CIRCUIT BREAKER ACTIVADO`,
        `Tarea: ${params.taskId}`,
        `Rol: ${params.role}`,
        `Razón: ${lastError}`,
        '',
        'La tarea fue movida a BLOCKED automáticamente.',
        'Responde con instrucciones para desbloquearla.',
    ].join('\n');

    try {
        deps.sendNotification(params.chatJid, msg);
    } catch (err) {
        logger.error({ err, taskId: params.taskId }, 'Failed to send circuit breaker notification');
    }

    return {
        blocked: true,
        reason: `circuit breaker open: ${lastError}`,
    };
}

// ── Post-failure recording ─────────────────────────────────────────────────

/**
 * Record an agent failure for circuit breaker tracking.
 * Call this after an agent execution error.
 */
export function recordAgentFailure(
    taskId: string,
    role: string,
    errorText: string,
    groupFolder: string,
): void {
    onTaskRoleFailure(taskId, role, errorText);

    // Log if circuit just opened
    if (isTaskRoleOpen(taskId, role)) {
        logger.warn(
            { taskId, role },
            `Circuit breaker opened for ${taskId}:${role} — task will be blocked on next dispatch`,
        );
        appendSwarmEvent(groupFolder, { kind: 'error', item: `circuit breaker opened: ${taskId}:${role}` });
    }
}

/**
 * Record an agent success for circuit breaker tracking.
 * Call this after a successful agent execution to reset failure counters.
 */
export function recordAgentSuccess(
    taskId: string,
    role: string,
): void {
    onTaskRoleSuccess(taskId, role);
}
