/**
 * Parallel Dispatch — extracted from index.ts maybeDispatchParallelSubagents.
 * Wires up: DAG evaluation, Circuit Breaker checks, and lane management.
 *
 * Sprint 20 — Integration wiring improvement.
 */
import {
    PARALLEL_SUBAGENTS_ENABLED,
    PARALLEL_SUBAGENT_RETRY_MAX,
    SWARM_EXEC_MODE,
    SWARM_STRICT_MODE,
    MICRO_BATCH_EPIC_PM_ONLY,
} from './config.js';
import { shouldDispatchParallelLane, waitMs, laneRetryDelayMs, laneTimeoutMs } from './lane-helpers.js';
import {
    loadLaneState,
    upsertTaskLaneState,
    syncTodoLaneProgressFromLaneState,
    setLaneState,
    maybeWriteTeamleadSummary,
    trimMainContextMessages,
} from './lane-manager.js';
import {
    mandatorySkillsForTask,
    routeRolesForTaskKind,
    inferTaskKind,
    buildSubagentPrompt,
    planningRolesForTrack,
    executionRolesForTrack,
    isEpicBootstrapTask,
} from './prompt-builder.js';
import type { SubagentRole } from './prompt-builder.js';
import {
    detectExecutionTrack,
    detectPlanningOnlyOverride,
    detectDevopsOnlyOverride,
} from './text-helpers.js';
import { appendSwarmAction, appendSwarmEvent } from './swarm-events.js';
import { parseTodoTaskContext, parseTodoDag } from './todo-manager.js';
import { evaluateDag } from './task-dag.js';
import { checkCircuitBeforeDispatch, recordAgentFailure, recordAgentSuccess } from './circuit-breaker-handler.js';
import { runAgent, type AgentRunnerDeps } from './agent-runner.js';
import { getTaskWorkflowState } from './swarm-workflow.js';
import type { RegisteredGroup, NewMessage } from './types.js';
import type { ContainerOutput } from './container-runner.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ParallelDispatchDeps {
    buildAgentRunnerDeps: () => AgentRunnerDeps;
    sessionLifecycleByKey: Map<string, { startedAt: number; cycles: number }>;
    sendNotification: (chatJid: string, text: string) => void;
}

// ── Main dispatch function ─────────────────────────────────────────────────

export function dispatchParallelLanes(params: {
    group: RegisteredGroup;
    taskIds: string[];
    stageHint: string;
    missedMessages: NewMessage[];
    chatJid: string;
    isMainGroup: boolean;
    deps: ParallelDispatchDeps;
}): void {
    const { group, taskIds, stageHint, missedMessages, chatJid, isMainGroup, deps } = params;

    if (!PARALLEL_SUBAGENTS_ENABLED) return;
    if (!isMainGroup) return;
    if (taskIds.length === 0) return;

    const track = detectExecutionTrack(missedMessages, stageHint);
    const planningOnly = detectPlanningOnlyOverride(missedMessages);
    const devopsOnly = detectDevopsOnlyOverride(missedMessages);

    let roles: SubagentRole[] =
        stageHint === 'DEV' || stageHint === 'QA' || stageHint === 'UX'
            ? executionRolesForTrack(track)
            : planningRolesForTrack(track);
    if (devopsOnly) {
        roles = ['DEVOPS'];
    } else if (planningOnly && !(stageHint === 'DEV' || stageHint === 'QA' || stageHint === 'UX')) {
        roles = ['PM', 'SPEC', 'ARQ'];
    }

    // ── DAG Evaluation: only dispatch tasks whose dependencies are met ──
    const dagTasks = parseTodoDag(group.folder, taskIds);
    let readyTaskIds = taskIds; // fallback: dispatch all if no DAG info
    if (dagTasks.length > 0) {
        const dagEval = evaluateDag(dagTasks);
        if (dagEval.ready.length > 0) {
            readyTaskIds = dagEval.ready;
        }
        appendSwarmAction(group.folder, {
            action: 'dag_evaluation',
            stage: stageHint,
            detail: `DAG: ${dagEval.ready.length} ready, ${dagEval.waiting.length} waiting, ${dagEval.completed.length} done, ${dagEval.cycles.length} cycles`,
            meta: {
                ready: dagEval.ready,
                waiting: dagEval.waiting,
                completed: dagEval.completed,
                cycles: dagEval.cycles,
                active: dagEval.active,
            },
        });
    }

    for (const rawTaskId of readyTaskIds) {
        const taskId = String(rawTaskId || '').trim().toUpperCase();
        if (!taskId) continue;
        const taskKind = inferTaskKind({
            groupFolder: group.folder,
            taskId,
            stageHint,
            track,
            messages: missedMessages,
            parseTodoTaskContext,
        });
        const microBatchEpic = MICRO_BATCH_EPIC_PM_ONLY && isEpicBootstrapTask(taskId);
        let routedRoles = roles;
        if (SWARM_STRICT_MODE) {
            const matrixRoute = routeRolesForTaskKind(taskKind);
            if (matrixRoute.length > 0) routedRoles = matrixRoute;
        }
        const effectiveRoles = microBatchEpic ? (['PM'] as SubagentRole[]) : routedRoles;
        appendSwarmAction(group.folder, {
            action: 'subagent_skill_route',
            stage: stageHint,
            detail: `task ${taskId} kind=${taskKind} roles=${effectiveRoles.join(', ')}`,
            meta: { taskId, taskKind, roles: effectiveRoles, mandatorySkills: mandatorySkillsForTask(taskKind) },
        });
        appendSwarmAction(group.folder, {
            action: 'subagent_route_strategy',
            stage: stageHint,
            detail: `task ${taskId} routed as ${track}${devopsOnly ? ' (devops-only override)' : ''}${planningOnly ? ' (planning-only override)' : ''}${microBatchEpic ? ' (micro-epic PM-first)' : ''}: ${effectiveRoles.join(', ')}`,
            meta: {
                taskId,
                track,
                roles: effectiveRoles,
                planningOnly,
                devopsOnly,
                microBatchEpic,
                execMode: SWARM_EXEC_MODE,
                strictMode: SWARM_STRICT_MODE,
            },
        });

        // ── Workflow Stage Gate: prevent execution roles from firing during planning ──
        const PLANNING_STAGES = new Set(['TEAMLEAD', 'PM', 'SPEC']);
        const EXECUTION_ONLY_ROLES: SubagentRole[] = ['DEV', 'DEV2', 'QA', 'DEVOPS'];
        const wfState = getTaskWorkflowState(group.folder, taskId);
        if (PLANNING_STAGES.has(wfState.stage)) {
            const gatedRoles = effectiveRoles.filter(r => !EXECUTION_ONLY_ROLES.includes(r));
            if (gatedRoles.length < effectiveRoles.length) {
                const blocked = effectiveRoles.filter(r => EXECUTION_ONLY_ROLES.includes(r));
                appendSwarmAction(group.folder, {
                    action: 'subagent_stage_gate',
                    stage: stageHint,
                    detail: `stage gate: blocked ${blocked.join(', ')} — workflow is still in ${wfState.stage}`,
                    meta: { taskId, workflowStage: wfState.stage, blockedRoles: blocked, allowedRoles: gatedRoles },
                });
            }
            if (gatedRoles.length === 0) continue; // skip this task entirely
            // Replace effectiveRoles with gated subset for remaining loop
            effectiveRoles.length = 0;
            effectiveRoles.push(...gatedRoles);
        }

        for (const role of effectiveRoles) {
            const laneKey = `${taskId}::${role}`;
            const laneState = loadLaneState(group.folder);
            const existing = laneState.tasks?.[taskId]?.lanes?.[role];
            if (existing && (['running', 'queued', 'working'] as string[]).includes(existing.state)) {
                appendSwarmAction(group.folder, {
                    action: 'subagent_lane_skip',
                    stage: stageHint,
                    detail: `lane ${laneKey} already ${existing.state}, skipping`,
                    meta: { taskId, role, status: existing.state },
                });
                continue;
            }
            if (!shouldDispatchParallelLane(laneKey)) {
                appendSwarmAction(group.folder, {
                    action: 'subagent_lane_not_ready',
                    stage: stageHint,
                    detail: `lane ${laneKey} not ready for dispatch`,
                    meta: { taskId, role },
                });
                continue;
            }

            // ── Circuit Breaker check: skip if circuit is open ──
            const cbCheck = checkCircuitBeforeDispatch(
                { taskId, role, groupFolder: group.folder, chatJid },
                { sendNotification: deps.sendNotification },
            );
            if (cbCheck.blocked) {
                setLaneState({ groupFolder: group.folder, taskId, role, next: 'failed' });
                appendSwarmAction(group.folder, {
                    action: 'subagent_lane_circuit_blocked',
                    stage: stageHint,
                    detail: `lane ${laneKey} blocked by circuit breaker: ${cbCheck.reason}`,
                    meta: { taskId, role, reason: cbCheck.reason },
                });
                continue;
            }

            setLaneState({ groupFolder: group.folder, taskId, role, next: 'queued' });
            appendSwarmAction(group.folder, {
                action: 'subagent_lane_queued',
                stage: stageHint,
                detail: `queued lane ${laneKey}`,
                meta: { taskId, role },
            });
            const subPrompt = buildSubagentPrompt({
                taskId,
                role,
                taskKind,
                messages: trimMainContextMessages(missedMessages).messages,
            });
            const maxAttempts = PARALLEL_SUBAGENT_RETRY_MAX;
            let attempt = 0;
            const laneStart = Date.now();
            const resetLaneIdleTimer = (attemptNumber: number) => {
                const key = `${chatJid}::${taskId}::${role}::${attemptNumber}`;
                if (deps.sessionLifecycleByKey.has(key)) return;
                deps.sessionLifecycleByKey.set(key, { startedAt: Date.now(), cycles: 0 });
                const laneTimeout = laneTimeoutMs(role);
                setTimeout(() => {
                    const entry = deps.sessionLifecycleByKey.get(key);
                    if (!entry) return;
                    deps.sessionLifecycleByKey.delete(key);
                    const elapsedMs = Date.now() - entry.startedAt;
                    if (elapsedMs >= laneTimeout) {
                        appendSwarmAction(group.folder, {
                            action: 'subagent_lane_idle_timeout',
                            stage: stageHint,
                            detail: `lane ${laneKey} attempt ${attemptNumber} idle timeout after ${Math.round(elapsedMs / 1000)}s`,
                            meta: { taskId, role, attempt: attemptNumber, elapsedMs, timeoutMs: laneTimeout },
                        });
                        try {
                            const ls = loadLaneState(group.folder);
                            if (ls.tasks?.[taskId]?.lanes?.[role]?.state === 'working') {
                                setLaneState({ groupFolder: group.folder, taskId, role, next: 'idle' });
                            }
                        } catch (err) { logger.warn({ err, taskId, role }, 'idle timeout lane state check failed'); }
                    }
                }, laneTimeout);
            };
            (async () => {
                try {
                    while (attempt < maxAttempts) {
                        attempt++;
                        setLaneState({ groupFolder: group.folder, taskId, role, next: 'working' });
                        appendSwarmAction(group.folder, {
                            action: 'subagent_lane_running',
                            stage: stageHint,
                            detail: `running lane ${laneKey} attempt ${attempt}/${maxAttempts}`,
                            meta: { taskId, role, attempt, maxAttempts },
                        });
                        resetLaneIdleTimer(attempt);
                        const laneOutput = await runAgent(
                            { ...group, name: `${group.name}::${role}` },
                            subPrompt,
                            chatJid,
                            deps.buildAgentRunnerDeps(),
                            async (result: ContainerOutput) => {
                                if (result.result) {
                                    const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
                                    const laneText = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
                                    if (laneText) {
                                        appendSwarmEvent(group.folder, {
                                            kind: 'agent_output',
                                            stage: stageHint,
                                            item: `${role} output`,
                                            chatJid,
                                            msg: laneText.slice(0, 300),
                                            meta: { taskId, role, attempt },
                                        });
                                        const lsFile = loadLaneState(group.folder);
                                        upsertTaskLaneState(lsFile, taskId);
                                    }
                                }
                                if (result.status === 'error') {
                                    appendSwarmEvent(group.folder, {
                                        kind: 'error',
                                        stage: stageHint,
                                        item: `${role} error`,
                                        chatJid,
                                        msg: `lane ${laneKey} error on attempt ${attempt}`,
                                        meta: { taskId, role, attempt },
                                    });
                                }
                            },
                        );
                        if (laneOutput !== 'error') {
                            setLaneState({ groupFolder: group.folder, taskId, role, next: 'done' });
                            recordAgentSuccess(taskId, role);
                            appendSwarmAction(group.folder, {
                                action: 'subagent_lane_done',
                                stage: stageHint,
                                detail: `lane ${laneKey} completed on attempt ${attempt}`,
                                meta: { taskId, role, attempt, durationMs: Date.now() - laneStart },
                            });
                            try {
                                syncTodoLaneProgressFromLaneState(group.folder);
                                maybeWriteTeamleadSummary({
                                    groupFolder: group.folder,
                                    taskId,
                                });
                            } catch (err) { logger.warn({ err, taskId, role }, 'post-lane sync/summary failed'); }
                            break;
                        }
                        // ── Record failure for circuit breaker tracking ──
                        recordAgentFailure(taskId, role, `lane ${laneKey} failed attempt ${attempt}`, group.folder);
                        appendSwarmAction(group.folder, {
                            action: 'subagent_lane_retry',
                            stage: stageHint,
                            detail: `lane ${laneKey} failed attempt ${attempt}/${maxAttempts}`,
                            meta: { taskId, role, attempt, maxAttempts },
                        });
                        if (attempt < maxAttempts) {
                            const delay = laneRetryDelayMs(attempt);
                            await waitMs(delay);
                        }
                    }
                    if (attempt >= maxAttempts) {
                        setLaneState({ groupFolder: group.folder, taskId, role, next: 'failed' });
                        recordAgentFailure(taskId, role, `lane ${laneKey} exhausted ${maxAttempts} attempts`, group.folder);
                        appendSwarmAction(group.folder, {
                            action: 'subagent_lane_failed',
                            stage: stageHint,
                            detail: `lane ${laneKey} exhausted ${maxAttempts} attempts`,
                            meta: { taskId, role, maxAttempts, durationMs: Date.now() - laneStart },
                        });
                    }
                } catch (err) {
                    setLaneState({ groupFolder: group.folder, taskId, role, next: 'failed' });
                    recordAgentFailure(taskId, role, String(err), group.folder);
                    appendSwarmAction(group.folder, {
                        action: 'subagent_lane_crash',
                        stage: stageHint,
                        detail: `lane ${laneKey} crashed: ${String(err)}`,
                        meta: { taskId, role },
                    });
                }
            })();
        }
    }
}
