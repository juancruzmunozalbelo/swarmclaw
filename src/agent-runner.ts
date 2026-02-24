/**
 * Agent Runner — container invocation with model fallback + session management.
 * Extracted from index.ts during Sprint 2 decomposition.
 */
import {
    MAIN_GROUP_FOLDER,
    MODEL_PRIMARY,
    MODEL_CIRCUIT_BREAKER_ENABLED,
    SESSION_ROTATE_MAX_CYCLES,
    SESSION_ROTATE_MAX_AGE_MS,
} from './config.js';
import {
    ContainerOutput,
    runContainerAgent,
    writeGroupsSnapshot,
    writeTasksSnapshot,
} from './container-runner.js';
import { getAllTasks, clearSession, setSession } from './db.js';
import {
    getModelAttemptPlan,
    onModelAttemptFailure,
    onModelAttemptSuccess,
    isModelFallbackRetryable,
    modelCircuitByName,
} from './model-circuit.js';
import { loadLaneState } from './lane-manager.js';
import { appendSwarmAction, appendSwarmEvent } from './swarm-events.js';
import { checkBudget, recordTokenUsage } from './token-budget.js';
import { logger } from './logger.js';
import type { RegisteredGroup } from './types.js';

/**
 * Dependencies injected from the main orchestrator.
 * This avoids coupling to module-level state.
 */
export type AgentRunnerDeps = {
    sessions: Record<string, string>;
    sessionLifecycleByKey: Map<string, { startedAt: number; cycles: number }>;
    registeredGroups: Record<string, RegisteredGroup>;
    queue: {
        registerProcess: (jid: string, proc: unknown, containerName: string, groupFolder: string) => void;
    };
    getAvailableGroups: () => import('./container-runner.js').AvailableGroup[];
    saveState: () => void;
};

export async function runAgent(
    group: RegisteredGroup,
    prompt: string,
    chatJid: string,
    deps: AgentRunnerDeps,
    onOutput?: (output: ContainerOutput) => Promise<void>,
    sessionKey?: string,
): Promise<'success' | 'error'> {
    const isMain = group.folder === MAIN_GROUP_FOLDER;
    const key = sessionKey || group.folder;
    let sessionId: string | undefined = deps.sessions[key];

    if (!sessionId) {
        deps.sessionLifecycleByKey.delete(key);
    } else {
        const now = Date.now();
        const meta = deps.sessionLifecycleByKey.get(key) || { startedAt: now, cycles: 0 };
        const ageMs = Math.max(0, now - meta.startedAt);
        const rotationTriggered =
            meta.cycles >= SESSION_ROTATE_MAX_CYCLES ||
            ageMs >= SESSION_ROTATE_MAX_AGE_MS;
        // F0.3: Do NOT rotate session if there are active lanes (working/queued/waiting).
        // Rotating mid-task causes the agent to lose context and restart from TEAMLEAD.
        const hasActiveLanes = rotationTriggered && (() => {
            try {
                const ls = loadLaneState(group.folder);
                return Object.values(ls.tasks || {}).some((t) =>
                    Object.values((t as Record<string, unknown>)?.lanes || {}).some((l) =>
                        ['working', 'queued', 'waiting'].includes(String(l?.state || ''))
                    )
                );
            } catch { return false; }
        })();
        const shouldRotate = rotationTriggered && !hasActiveLanes;
        if (shouldRotate) {
            const reason = meta.cycles >= SESSION_ROTATE_MAX_CYCLES
                ? `cycle_limit(${meta.cycles}/${SESSION_ROTATE_MAX_CYCLES})`
                : `age_limit(${Math.round(ageMs / 1000)}s/${Math.round(SESSION_ROTATE_MAX_AGE_MS / 1000)}s)`;
            delete deps.sessions[key];
            clearSession(key);
            deps.sessionLifecycleByKey.delete(key);
            sessionId = undefined;
            appendSwarmAction(group.folder, {
                action: 'session_rotated',
                stage: 'TEAMLEAD',
                detail: `session auto-rotated for ${key}: ${reason}`,
                meta: { key, reason, cycles: meta.cycles, ageMs },
            });
        } else {
            deps.sessionLifecycleByKey.set(key, { ...meta, cycles: meta.cycles + 1 });
        }
    }

    // Update tasks snapshot for container to read (filtered by group)
    const tasks = getAllTasks();
    writeTasksSnapshot(
        group.folder,
        isMain,
        tasks.map((t) => ({
            id: t.id,
            groupFolder: t.group_folder,
            prompt: t.prompt,
            schedule_type: t.schedule_type,
            schedule_value: t.schedule_value,
            status: t.status,
            next_run: t.next_run,
        })),
    );

    // Update available groups snapshot (main group only can see all groups)
    const availableGroups = deps.getAvailableGroups();
    writeGroupsSnapshot(
        group.folder,
        isMain,
        availableGroups,
        new Set(Object.keys(deps.registeredGroups)),
    );

    // Wrap onOutput to track session ID from streamed results
    const wrappedOnOutput = onOutput
        ? async (output: ContainerOutput) => {
            if (output.newSessionId) {
                deps.sessions[key] = output.newSessionId;
                setSession(key, output.newSessionId);
            }
            await onOutput(output);
        }
        : undefined;

    // Budget check: block further calls if task has exceeded token limit
    // Extract task IDs from prompt to check budget
    const taskIdMatch = prompt.match(/\b[A-Z]{2,16}-\d{3,}\b/);
    const budgetTaskId = taskIdMatch?.[0];
    if (budgetTaskId) {
        const budget = checkBudget(group.folder, budgetTaskId);
        if (!budget.ok) {
            appendSwarmAction(group.folder, {
                action: 'budget_exceeded',
                stage: 'TEAMLEAD',
                detail: `Task ${budgetTaskId} exceeded token budget (${budget.used}/${budget.limit})`,
                meta: { taskId: budgetTaskId, used: budget.used, limit: budget.limit },
            });
            logger.warn({ taskId: budgetTaskId, used: budget.used, limit: budget.limit }, 'Token budget exceeded, blocking agent run');
            return 'error';
        }
    }

    try {
        const modelPlan = getModelAttemptPlan();
        const attempts = modelPlan.length > 0 ? modelPlan : [''];
        let output: ContainerOutput | null = null;

        for (let i = 0; i < attempts.length; i++) {
            const model = attempts[i];
            const isFallbackAttempt = i > 0;
            if (isFallbackAttempt) {
                appendSwarmAction(group.folder, {
                    action: 'model_fallback_attempt',
                    stage: 'TEAMLEAD',
                    detail: `retrying with fallback model ${model}`,
                    meta: { key, chatJid, attempt: i + 1, total: attempts.length, model },
                });
            }
            if (model && MODEL_CIRCUIT_BREAKER_ENABLED) {
                const st = modelCircuitByName.get(model);
                if (st && st.openUntil > Date.now()) {
                    appendSwarmAction(group.folder, {
                        action: 'model_circuit_open_skip',
                        stage: 'TEAMLEAD',
                        detail: `skipping model ${model} (circuit open)`,
                        meta: { model, openUntil: new Date(st.openUntil).toISOString(), chatJid },
                    });
                    continue;
                }
            }

            output = await runContainerAgent(
                group,
                {
                    prompt,
                    sessionId: isFallbackAttempt ? undefined : sessionId,
                    modelOverride: model || undefined,
                    groupFolder: group.folder,
                    chatJid,
                    isMain,
                },
                (proc, containerName) => deps.queue.registerProcess(chatJid, proc, containerName, group.folder),
                wrappedOnOutput,
            );

            if (output.newSessionId) {
                deps.sessions[key] = output.newSessionId;
                setSession(key, output.newSessionId);
                if (!deps.sessionLifecycleByKey.has(key)) {
                    deps.sessionLifecycleByKey.set(key, { startedAt: Date.now(), cycles: 0 });
                }
            }

            if (output.status === 'success') {
                onModelAttemptSuccess(model || MODEL_PRIMARY);
                // Record token usage if available
                if (budgetTaskId && (output as unknown as Record<string, unknown>).tokensUsed) {
                    recordTokenUsage(group.folder, budgetTaskId, (output as unknown as Record<string, unknown>).tokensUsed as number);
                }
                return 'success';
            }

            const errText = String(output.error || '');
            onModelAttemptFailure(model || MODEL_PRIMARY, errText);
            const retryable = isModelFallbackRetryable(errText);
            const hasNext = i < attempts.length - 1;
            if (!(retryable && hasNext)) {
                break;
            }
        }

        if (!output) {
            logger.error({ group: group.name }, 'Model fallback plan exhausted without runnable models');
            return 'error';
        }

        if (output.status === 'error') {
            const errText = String(output.error || '');
            const hardSessionFailure = /sigkill|terminated|timed out|code 143|killed/i.test(errText);
            if (hardSessionFailure) {
                // Session can become too heavy/corrupted; force next retry to start fresh.
                delete deps.sessions[key];
                clearSession(key);
                deps.sessionLifecycleByKey.delete(key);
                appendSwarmAction(group.folder, {
                    action: 'session_reset',
                    stage: 'error',
                    detail: `session reset after hard agent failure for ${chatJid}`,
                    meta: { chatJid, key, reason: errText.slice(0, 300) },
                });
            }
            const sigkill = /sigkill/i.test(errText);
            if (sigkill) {
                appendSwarmEvent(group.folder, {
                    kind: 'error',
                    stage: 'error',
                    item: 'agent sigkill',
                    next: 'auto-retry with trimmed context',
                    chatJid,
                    msg: 'agent process terminated by SIGKILL',
                });
                appendSwarmAction(group.folder, {
                    action: 'agent_sigkill',
                    stage: 'error',
                    detail: `agent SIGKILL detected for ${chatJid}`,
                    meta: { chatJid, error: errText.slice(0, 400) },
                });
            }
            logger.error(
                { group: group.name, error: output.error },
                'Container agent error',
            );
            return 'error';
        }
        return 'success';
    } catch (err) {
        logger.error({ group: group.name, err }, 'Agent error');
        return 'error';
    }
}
