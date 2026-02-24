/**
 * Phase 4: Agent Execution & Output Processing
 * Build the streaming output callback passed to `runAgent()`.
 *
 * Sprint 4 — Extracted from processGroupMessages L953-L1612.
 *
 * The callback is split into three logical sub-handlers:
 *  1. handleTextExtraction — sanitize text, extract task IDs, sync todo
 *  2. handleValidation — contract, deploy, claim, critic, dev gates, artifacts
 *  3. handleDelivery — stage transitions, auto-continue, message delivery
 */

import { ASSISTANT_NAME } from '../config.js';
import {
    extractTaskIds,
    parseStageContract,
    validateStageContract,
    ensureStageArtifacts,
    validateStageArtifacts,
    markTaskValidationFailure,
    setBlockedQuestions,
    transitionTaskStage,
    extractQuestions,
    canEnterDev,
    canEnterDevByPlanningHistory,
} from '../swarm-workflow.js';
import type { WorkflowStage } from '../swarm-workflow.js';
import { updateRuntimeMetrics, readRuntimeMetrics } from '../runtime-metrics.js';
import { updateSwarmStatus } from '../swarm-status.js';
import { writeSwarmMetrics } from '../metrics.js';
import { appendSwarmAction, appendSwarmEvent } from '../swarm-events.js';
import {
    isAutoContinueEnabled,
    maybeQueueAutoContinueNudge,
    deployValidationLoopTriggered,
    DEPLOY_VALIDATION_LOOP_THRESHOLD,
    DEPLOY_VALIDATION_LOOP_WINDOW_MS,
} from '../auto-continue.js';
import type { AutoContinueReason } from '../auto-continue.js';
import {
    sanitizeUserFacingText,
    stageFromAgentText,
    normalizeScope,
    stripAnnoyingClosers,
    buildSwarmlogFallback,
    workflowStageFromRuntimeStage,
    hasBlockingSignals,
    stripNonBlockingQuestions,
    extractContinuationHints,
    looksLikeContinueQuestion,
} from '../text-helpers.js';
import {
    runCriticReview,
    validateDeployClaim,
} from '../output-processor.js';
import { runClaimValidations } from '../validation-chain.js';
import {
    runDevQualityGates,
    writeDevGateEvidence,
} from '../quality-gates.js';
import { ensureTodoTracking, setTodoState, pendingTodoIdsForEpic } from '../todo-manager.js';
import { logger } from '../logger.js';
import type { Channel } from '../types.js';
import type { GroupQueue } from '../group-queue.js';
import type { PhaseContext, PhaseTimers } from './types.js';
import type { ContainerOutput } from '../container-runner.js';

// ── Sub-handler 1: Text Extraction ─────────────────────────────────────

async function handleTextExtraction(
    ctx: PhaseContext,
    raw: string,
): Promise<{ text: string; userText: string; logs: Record<string, unknown>[]; outputTaskIds: string[] } | null> {
    const text = stripAnnoyingClosers(
        raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim(),
    );
    logger.info({ group: ctx.group.name }, `Agent output: ${raw.slice(0, 200)}`);
    if (!text) return null;

    const { userText, logs } = sanitizeUserFacingText(text);
    const outputTaskIds = [
        ...new Set(
            extractTaskIds(text)
                .map((x: string | number) => String(x || '').trim().toUpperCase())
                .filter(Boolean),
        ),
    ] as string[];

    if (outputTaskIds.length > 0) {
        ctx.taskIds = [...new Set([...ctx.taskIds, ...outputTaskIds])];
        try {
            const createdFromOutput = await ensureTodoTracking({
                groupFolder: ctx.group.folder,
                stageHint: stageFromAgentText(text) || ctx.stageHint,
                taskIds: outputTaskIds,
                messageScope: normalizeScope(userText || text),
            });
            if (createdFromOutput.length > 0) {
                appendSwarmAction(ctx.group.folder, {
                    action: 'todo_auto_track',
                    stage: stageFromAgentText(text) || ctx.stageHint,
                    detail: `auto-tracked from agent output: ${createdFromOutput.join(', ')}`,
                    files: [`groups/${ctx.group.folder}/todo.md`],
                    meta: { created: createdFromOutput, source: 'agent_output' },
                });
            }
            for (const id of outputTaskIds) {
                const reDone = new RegExp(`${id}[^\\n]*✅`, 'i');
                if (reDone.test(text)) {
                    await setTodoState({ groupFolder: ctx.group.folder, taskId: id, state: 'done', skipAutoAdvance: true });
                }
            }
        } catch {
            // ignore output->todo sync failures
        }
    }

    return { text, userText, logs, outputTaskIds };
}

// ── Sub-handler 2: Validation ──────────────────────────────────────────

async function handleValidation(
    ctx: PhaseContext,
    text: string,
    outputTaskIds: string[],
    queueSendMessage: (jid: string, text: string) => boolean,
): Promise<{ contract: { ok: boolean; stage?: WorkflowStage; missing: string[] }; parsedContract: ReturnType<typeof parseStageContract> }> {
    const parsedContract = parseStageContract(text);
    const contract = validateStageContract(text);

    // Contract validation
    if (!contract.ok) {
        ctx.hadError = true;
        ctx.validationViolation = true;
        const reason = `invalid stage contract: missing ${contract.missing.join(', ')}`;
        appendSwarmEvent(ctx.group.folder, {
            kind: 'error',
            stage: contract.stage || undefined,
            item: 'stage contract validation failed',
            chatJid: ctx.chatJid,
            msg: reason,
        });
        appendSwarmAction(ctx.group.folder, {
            action: 'contract_validation_failed',
            stage: contract.stage || undefined,
            detail: reason,
            meta: { missing: contract.missing },
        });
        updateRuntimeMetrics({
            groupFolder: ctx.group.folder,
            increments: { validationFailures: 1, contractFailures: 1 },
            skillIncrements: { 'swarm-teamlead-orchestrator': { validationFails: 1 } },
            lastStage: String(contract.stage || 'unknown'),
            lastError: reason,
            lastTaskIds: ctx.taskIds.length > 0 ? ctx.taskIds : undefined,
        });
        for (const taskId of ctx.taskIds) {
            markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
        }
    }

    // Deploy validation
    validateDeployClaim(text).then(async (deployClaim) => {
        if (deployClaim.checked && !deployClaim.ok) {
            ctx.hadError = true;
            ctx.validationViolation = true;
            const reason = `deploy validation failed: ${deployClaim.reason || 'unknown reason'}`;
            appendSwarmEvent(ctx.group.folder, {
                kind: 'error',
                stage: contract.stage || stageFromAgentText(text) || ctx.stageHint,
                item: 'deploy validation failed',
                chatJid: ctx.chatJid,
                msg: reason,
            });
            appendSwarmAction(ctx.group.folder, {
                action: 'deploy_validation_failed',
                stage: contract.stage || stageFromAgentText(text) || ctx.stageHint,
                detail: reason,
            });
            updateRuntimeMetrics({
                groupFolder: ctx.group.folder,
                increments: { validationFailures: 1, contractFailures: 1 },
                skillIncrements: { 'swarm-teamlead-orchestrator': { validationFails: 1 } },
                lastStage: String(contract.stage || stageFromAgentText(text) || ctx.stageHint || 'unknown'),
                lastError: reason,
                lastTaskIds: ctx.taskIds.length > 0 ? ctx.taskIds : undefined,
            });
            for (const taskId of ctx.taskIds) {
                markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
            }
            // Deploy validation loop detection
            const loopBlockedTaskIds: string[] = [];
            for (const taskId of ctx.taskIds) {
                if (!deployValidationLoopTriggered(taskId)) continue;
                loopBlockedTaskIds.push(taskId);
                try {
                    transitionTaskStage({
                        groupFolder: ctx.group.folder,
                        taskId,
                        to: 'BLOCKED',
                        reason: `auto-block: repeated deploy validation failures (${DEPLOY_VALIDATION_LOOP_THRESHOLD}+ in ${Math.round(DEPLOY_VALIDATION_LOOP_WINDOW_MS / 60000)}m)`,
                    });
                } catch { /* ignore */ }
                try {
                    await setTodoState({ groupFolder: ctx.group.folder, taskId, state: 'blocked' });
                } catch { /* ignore */ }
            }
            if (loopBlockedTaskIds.length > 0) {
                appendSwarmAction(ctx.group.folder, {
                    action: 'deploy_validation_loop_blocked',
                    stage: contract.stage || stageFromAgentText(text) || ctx.stageHint,
                    detail: `auto-blocked by deploy-validation loop: ${loopBlockedTaskIds.join(', ')}`,
                    meta: {
                        taskIds: loopBlockedTaskIds,
                        threshold: DEPLOY_VALIDATION_LOOP_THRESHOLD,
                        windowMs: DEPLOY_VALIDATION_LOOP_WINDOW_MS,
                    },
                });
            } else {
                maybeQueueAutoContinueNudge({
                    groupFolder: ctx.group.folder,
                    chatJid: ctx.chatJid,
                    taskIds: ctx.taskIds,
                    hintTaskIds: outputTaskIds,
                    reason: 'deploy_validation_failed' as AutoContinueReason,
                }, { queueSendMessage });
            }
        }
    }).catch(() => { /* ignore */ });

    // Claim validations
    const claimResult = runClaimValidations(
        {
            groupFolder: ctx.group.folder,
            chatJid: ctx.chatJid,
            stage: contract.stage || stageFromAgentText(text) || ctx.stageHint,
            taskIds: ctx.taskIds,
        },
        text,
        (reason: string) => {
            maybeQueueAutoContinueNudge({
                groupFolder: ctx.group.folder,
                chatJid: ctx.chatJid,
                taskIds: ctx.taskIds,
                hintTaskIds: outputTaskIds,
                reason: reason as AutoContinueReason,
            }, { queueSendMessage });
        },
    );
    if (claimResult.hadError) {
        ctx.hadError = true;
        ctx.validationViolation = true;
    }

    // Contract-dependent validations (critic, blocked questions, dev gates, artifacts)
    if (contract.ok && contract.stage) {
        await handleContractValidations(ctx, text, { ...contract, stage: contract.stage }, parsedContract, outputTaskIds, queueSendMessage);
    }

    return { contract, parsedContract };
}

async function handleContractValidations(
    ctx: PhaseContext,
    text: string,
    contract: { ok: boolean; stage: WorkflowStage; missing: string[] },
    parsedContract: ReturnType<typeof parseStageContract>,
    _outputTaskIds: string[],
    _queueSendMessage: (jid: string, text: string) => boolean,
): Promise<void> {
    const ids = ctx.taskIds.length > 0 ? ctx.taskIds : ['GEN-000'];

    // TEAMLEAD cycle tracking
    if (contract.stage === 'TEAMLEAD') {
        updateRuntimeMetrics({
            groupFolder: ctx.group.folder,
            increments: { teamleadOnlyCycles: 1 },
            lastStage: 'TEAMLEAD',
            lastTaskIds: ctx.taskIds.length > 0 ? ctx.taskIds : undefined,
        });
    }

    // Critic review
    const critic = runCriticReview({
        groupFolder: ctx.group.folder,
        stage: contract.stage,
        taskIds: ids,
        parsedContract,
        rawText: text,
        pendingTodoIdsForEpic,
    });
    appendSwarmAction(ctx.group.folder, {
        action: critic.ok ? 'critic_review_passed' : 'critic_review_failed',
        stage: contract.stage,
        detail: critic.ok
            ? `critic review passed for ${ids.join(', ')}`
            : `critic review failed: ${critic.findings.join('; ')}`,
        files: critic.evidenceFiles.slice(0, 8),
        meta: { taskIds: ids, findings: critic.findings, evidenceCount: critic.evidenceFiles.length },
    });
    if (!critic.ok) {
        ctx.hadError = true;
        ctx.validationViolation = true;
        const reason = `critic review failed: ${critic.findings.join('; ')}`;
        appendSwarmEvent(ctx.group.folder, {
            kind: 'error',
            stage: contract.stage,
            item: 'critic review failed',
            chatJid: ctx.chatJid,
            msg: reason,
            files: critic.evidenceFiles.slice(0, 8),
        });
        updateRuntimeMetrics({
            groupFolder: ctx.group.folder,
            increments: { validationFailures: 1, artifactFailures: 1 },
            lastStage: contract.stage,
            lastError: reason,
            lastTaskIds: ids,
        });
        for (const taskId of ids) {
            markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
        }
    }

    // Blocked question detection
    const qs = extractQuestions(text);
    const explicitBlockedStage = contract.stage === 'BLOCKED';
    const implicitBlockedByQuestions = qs.length >= 2;
    if (explicitBlockedStage || implicitBlockedByQuestions) {
        let blockedTargets = ctx.taskIds.map((x) => x.trim().toUpperCase()).filter(Boolean);
        if (blockedTargets.length === 0) {
            const rm = readRuntimeMetrics(ctx.group.folder);
            blockedTargets = Array.isArray(rm.lastTaskIds)
                ? (rm.lastTaskIds as string[]).map((x: string) => String(x).trim().toUpperCase()).filter(Boolean)
                : [];
        }
        if (blockedTargets.length === 0) {
            blockedTargets = [`ASK-${Date.now().toString().slice(-6)}`];
        }
        for (const taskId of blockedTargets) {
            setBlockedQuestions({ groupFolder: ctx.group.folder, taskId, questions: qs });
            transitionTaskStage({
                groupFolder: ctx.group.folder,
                taskId,
                to: 'BLOCKED',
                reason: explicitBlockedStage ? 'agent emitted BLOCKED stage' : 'agent asked clarification questions',
            });
            appendSwarmAction(ctx.group.folder, {
                action: explicitBlockedStage ? 'blocked_questions_set' : 'blocked_questions_auto_detected',
                stage: 'BLOCKED',
                detail: `registered ${qs.length} pending questions for ${taskId}`,
                meta: { taskId, questionCount: qs.length, source: explicitBlockedStage ? 'stage_blocked' : 'question_fallback' },
            });
        }
        updateRuntimeMetrics({
            groupFolder: ctx.group.folder,
            increments: { blockedQuestionsSet: blockedTargets.length },
            lastStage: 'BLOCKED',
            lastTaskIds: blockedTargets,
        });
    }

    // Dev quality gates
    if (contract.stage === 'DEV' && ctx.taskIds.length > 0) {
        const gateResult = runDevQualityGates({
            groupFolder: ctx.group.folder,
            archivosText: parsedContract?.archivos || 'n/a',
        });
        const evidenceFiles: string[] = [];
        for (const taskId of ctx.taskIds) {
            const p = writeDevGateEvidence({ groupFolder: ctx.group.folder, taskId, result: gateResult });
            evidenceFiles.push(p);
        }
        appendSwarmEvent(ctx.group.folder, {
            kind: gateResult.ok ? 'status' : 'error',
            stage: 'DEV',
            item: 'dev quality gates executed',
            chatJid: ctx.chatJid,
            files: evidenceFiles,
            msg: gateResult.summary,
            meta: { runs: gateResult.runs },
        });
        appendSwarmAction(ctx.group.folder, {
            action: gateResult.ok ? 'dev_quality_gates_passed' : 'dev_quality_gates_failed',
            stage: 'DEV',
            detail: gateResult.summary,
            files: evidenceFiles,
            meta: { runs: gateResult.runs },
        });
        if (!gateResult.ok) {
            ctx.hadError = true;
            ctx.validationViolation = true;
            const reason = `DEV quality gates failed: ${gateResult.summary}`;
            updateRuntimeMetrics({
                groupFolder: ctx.group.folder,
                increments: { validationFailures: 1, devGateFailures: 1 },
                lastStage: 'DEV',
                lastError: reason,
                lastTaskIds: ctx.taskIds,
            });
            for (const taskId of ctx.taskIds) {
                markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
            }
        }
        // Dev entry gates
        for (const taskId of ctx.taskIds) {
            const gate = canEnterDev(ctx.group.folder, taskId);
            if (!gate.ok) {
                ctx.hadError = true;
                ctx.validationViolation = true;
                const reason = `DEV blocked: unanswered SPEC questions for ${taskId}`;
                appendSwarmEvent(ctx.group.folder, {
                    kind: 'error', stage: 'DEV', item: 'dev gate blocked by pending questions',
                    chatJid: ctx.chatJid, msg: reason, meta: { taskId, pendingQuestions: gate.pendingQuestions },
                });
                appendSwarmAction(ctx.group.folder, {
                    action: 'dev_gate_blocked', stage: 'DEV', detail: reason,
                    meta: { taskId, pendingQuestions: gate.pendingQuestions },
                });
                updateRuntimeMetrics({
                    groupFolder: ctx.group.folder,
                    increments: { validationFailures: 1, devGateFailures: 1 },
                    lastStage: 'DEV', lastError: reason, lastTaskIds: [taskId],
                });
                markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
            }
            const planningGate = canEnterDevByPlanningHistory(ctx.group.folder, taskId);
            if (!planningGate.ok) {
                ctx.hadError = true;
                ctx.validationViolation = true;
                const reason = `DEV blocked: missing planning stages for ${taskId} (${planningGate.missing.join('+')})`;
                appendSwarmEvent(ctx.group.folder, {
                    kind: 'error', stage: 'DEV', item: 'dev gate blocked by missing planning stages',
                    chatJid: ctx.chatJid, msg: reason, meta: { taskId, missing: planningGate.missing },
                });
                appendSwarmAction(ctx.group.folder, {
                    action: 'dev_prereq_blocked', stage: 'DEV', detail: reason,
                    meta: { taskId, missing: planningGate.missing },
                });
                updateRuntimeMetrics({
                    groupFolder: ctx.group.folder,
                    increments: { validationFailures: 1, devGateFailures: 1, devPrereqFailures: 1 },
                    lastStage: 'DEV', lastError: reason, lastTaskIds: [taskId],
                });
                markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
            }
        }
    }

    // Stage artifacts
    for (const taskId of ids) {
        const ensured = ensureStageArtifacts({ groupFolder: ctx.group.folder, stage: contract.stage, taskId });
        if (ensured.created.length > 0) {
            appendSwarmEvent(ctx.group.folder, {
                kind: 'status', stage: contract.stage, item: 'auto-created stage artifacts',
                chatJid: ctx.chatJid, files: ensured.created, msg: `created ${ensured.created.join(', ')}`,
            });
            appendSwarmAction(ctx.group.folder, {
                action: 'artifact_auto_created', stage: contract.stage,
                detail: `created stage placeholders for ${taskId}`, files: ensured.created, meta: { taskId },
            });
        }
        const artifactCheck = validateStageArtifacts({ groupFolder: ctx.group.folder, stage: contract.stage, taskId, text });
        if (!artifactCheck.ok) {
            ctx.hadError = true;
            ctx.validationViolation = true;
            const reason = `missing stage artifacts (${contract.stage}): ${artifactCheck.missing.join(', ')}`;
            appendSwarmEvent(ctx.group.folder, {
                kind: 'error', stage: contract.stage, item: 'stage artifact validation failed',
                chatJid: ctx.chatJid, msg: reason,
            });
            appendSwarmAction(ctx.group.folder, {
                action: 'artifact_validation_failed', stage: contract.stage,
                detail: reason, meta: { missing: artifactCheck.missing, taskId },
            });
            updateRuntimeMetrics({
                groupFolder: ctx.group.folder,
                increments: { validationFailures: 1, artifactFailures: 1 },
                lastStage: contract.stage, lastError: reason, lastTaskIds: [taskId],
            });
            if (ctx.taskIds.length > 0) {
                markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
            }
        }
    }
}

// ── Sub-handler 3: Delivery ────────────────────────────────────────────

async function handleDelivery(
    ctx: PhaseContext,
    text: string,
    userText: string,
    logs: Record<string, unknown>[],
    outputTaskIds: string[],
    timers: PhaseTimers,
    deps: { channel: Channel; queueSendMessage: (jid: string, text: string) => boolean },
): Promise<void> {
    // Capture structured action logs
    try {
        for (const obj of logs) {
            appendSwarmEvent(ctx.group.folder, {
                kind: 'agent_log',
                stage: String(obj.stage || '') || undefined,
                item: String(obj.action || 'agent_log'),
                chatJid: ctx.chatJid,
                meta: obj,
                msg: String(obj.detail || ''),
            });
            appendSwarmAction(ctx.group.folder, {
                action: String(obj.action || 'agent_log'),
                stage: String(obj.stage || '') || undefined,
                detail: String(obj.detail || ''),
                files: Array.isArray(obj.files) ? (obj.files as unknown[]).map((x) => String(x)) : undefined,
                meta: obj,
            });
        }
    } catch { /* ignore */ }

    // Epic close guard
    try {
        for (const obj of logs) {
            if (String(obj?.action || '').toLowerCase() !== 'task_complete') continue;
            const epicTaskId = String(obj?.task || obj?.taskId || '').trim().toUpperCase();
            if (!epicTaskId) continue;
            const pending = pendingTodoIdsForEpic(ctx.group.folder, epicTaskId);
            if (pending.length === 0) continue;
            ctx.hadError = true;
            ctx.validationViolation = true;
            const reason = `epic ${epicTaskId} cannot close: pending subtasks in todo (${pending.slice(0, 8).join(', ')})`;
            appendSwarmEvent(ctx.group.folder, {
                kind: 'error', stage: 'TEAMLEAD', item: 'epic close blocked by pending todo',
                chatJid: ctx.chatJid, msg: reason,
                meta: { epicTaskId, pendingCount: pending.length, pending: pending.slice(0, 25) },
            });
            appendSwarmAction(ctx.group.folder, {
                action: 'epic_close_blocked', stage: 'TEAMLEAD', detail: reason,
                meta: { epicTaskId, pendingCount: pending.length, pending: pending.slice(0, 25) },
            });
            updateRuntimeMetrics({
                groupFolder: ctx.group.folder,
                increments: { validationFailures: 1 },
                lastStage: 'TEAMLEAD', lastError: reason, lastTaskIds: [epicTaskId],
            });
            markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId: epicTaskId, error: reason });
        }
    } catch { /* ignore */ }

    // Stage mirroring
    try {
        const s = stageFromAgentText(text);
        if (s) {
            if (ctx.taskIds.length > 0) {
                const wfStage = workflowStageFromRuntimeStage(s);
                if (wfStage) {
                    for (const taskId of ctx.taskIds) {
                        transitionTaskStage({ groupFolder: ctx.group.folder, taskId, to: wfStage, reason: 'agent stage update' });
                    }
                }
            }
            updateSwarmStatus({
                groupFolder: ctx.group.folder, stage: s, item: 'agent stage update',
                files: [`groups/${ctx.group.folder}/swarmdev/status.md`], next: 'continuing',
            });
            writeSwarmMetrics(ctx.group.folder, {
                stage: s, item: 'agent stage update', next: 'continuing',
                chatJid: ctx.chatJid, note: 'agent_output_stage',
            });
            appendSwarmEvent(ctx.group.folder, {
                kind: 'agent_stage', stage: s, item: 'agent stage update', next: 'continuing', chatJid: ctx.chatJid,
            });
            appendSwarmAction(ctx.group.folder, {
                action: 'stage_update', stage: s, detail: 'agent stage update',
            });
        }
    } catch { /* ignore */ }

    appendSwarmEvent(ctx.group.folder, {
        kind: 'agent_output', stage: stageFromAgentText(text) || undefined,
        item: 'agent output', chatJid: ctx.chatJid, msg: text.slice(0, 500),
    });

    // Auto-continue and message delivery
    const rawFinalText = userText || (logs.length > 0 ? buildSwarmlogFallback(logs) : '');
    const continuationHints = extractContinuationHints(rawFinalText);
    const askedContinueQuestion = looksLikeContinueQuestion(rawFinalText);
    const autoContinueEligible =
        isAutoContinueEnabled() && !!rawFinalText && !hasBlockingSignals(rawFinalText) && ctx.taskIds.length > 0;
    const hadQuestionBeforeSanitize = autoContinueEligible && askedContinueQuestion;
    const finalText = autoContinueEligible ? stripNonBlockingQuestions(rawFinalText) : rawFinalText;
    const autoContinueQuestion = !!hadQuestionBeforeSanitize;

    if (askedContinueQuestion) {
        ctx.hadError = true;
        ctx.validationViolation = true;
        const reason = 'autonomy policy violation: asked continue confirmation';
        appendSwarmAction(ctx.group.folder, {
            action: 'autonomy_policy_violation', stage: 'TEAMLEAD', detail: reason,
            meta: { taskIds: ctx.taskIds, chatJid: ctx.chatJid },
        });
        for (const taskId of ctx.taskIds) {
            markTaskValidationFailure({ groupFolder: ctx.group.folder, taskId, error: reason });
        }
    }

    if (finalText && !ctx.validationViolation && !autoContinueQuestion) {
        await deps.channel.sendMessage(ctx.chatJid, `${ASSISTANT_NAME}: ${finalText}`);
        ctx.outputSentToUser = true;
        updateRuntimeMetrics({
            groupFolder: ctx.group.folder,
            increments: { outputsSent: 1 },
            lastStage: stageFromAgentText(text) || undefined,
            lastTaskIds: ctx.taskIds.length > 0 ? ctx.taskIds : undefined,
        });
    }

    if (autoContinueQuestion) {
        maybeQueueAutoContinueNudge({
            groupFolder: ctx.group.folder, chatJid: ctx.chatJid,
            taskIds: ctx.taskIds, hintTaskIds: continuationHints, reason: 'asked_continue' as AutoContinueReason,
        }, { queueSendMessage: deps.queueSendMessage });
    } else {
        maybeQueueAutoContinueNudge({
            groupFolder: ctx.group.folder, chatJid: ctx.chatJid,
            taskIds: ctx.taskIds, hintTaskIds: continuationHints, reason: 'post_output' as AutoContinueReason,
        }, { queueSendMessage: deps.queueSendMessage });
    }

    // UI update
    timers.scheduleDashIdle();
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Build the streaming output callback for `runAgent()`.
 * Receives PhaseContext (mutable) and PhaseTimers.
 * The returned callback is called for each agent result chunk.
 */
export function buildOutputCallback(
    ctx: PhaseContext,
    timers: PhaseTimers,
    deps: { channel: Channel; queue: GroupQueue },
) {
    return async (result: ContainerOutput) => {
        if (result.result) {
            const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
            const extracted = await handleTextExtraction(ctx, raw);
            if (extracted) {
                const { text, userText, logs, outputTaskIds } = extracted;
                await handleValidation(ctx, text, outputTaskIds, (jid, msg) => deps.queue.sendMessage(jid, msg));
                await handleDelivery(ctx, text, userText, logs, outputTaskIds, timers, {
                    channel: deps.channel,
                    queueSendMessage: (jid, msg) => deps.queue.sendMessage(jid, msg),
                });
            }
            // Only reset idle timer on actual results
            timers.resetIdleTimer();
        }

        if (result.status === 'error') {
            ctx.hadError = true;
        }
    };
}
