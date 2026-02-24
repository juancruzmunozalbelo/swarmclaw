/**
 * Validation Chain — unified runner for output claim validators.
 * Extracted from the output handler in processGroupMessages (Sprint 4).
 *
 * Each "claim validator" returns { checked, ok, reason? }.  When a claim
 * fails, the chain emits identical side-effects: swarm event, action,
 * runtime metrics increment, and per-task validation failure marks.
 */

import { appendSwarmAction, appendSwarmEvent } from './swarm-events.js';
import { updateRuntimeMetrics } from './runtime-metrics.js';
import { markTaskValidationFailure } from './swarm-workflow.js';
import {
    validateStatusLineContract,
    validateRuntimeStatusClaims,
    validateCloudflareDeployClaims,
    validateDoneEvidenceClaims,
    validateUniversalTddClaims,
} from './agent-output-validation.js';
import { isDatabaseConfigured, isCloudflareConfigured } from './output-processor.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClaimResult {
    checked: boolean;
    ok: boolean;
    reason?: string;
}

export interface ValidationContext {
    groupFolder: string;
    chatJid: string;
    stage: string;          // resolvedStage = contract.stage || stageFromAgentText || stageHint
    taskIds: string[];
    /** Extra metrics increments beyond the default `validationFailures: 1` */
    metricsIncrements?: Record<string, number>;
}

interface ClaimSpec {
    name: string;
    action: string;
    item: string;
    run: (text: string) => ClaimResult;
    /** Additional metric increments when this specific claim fails */
    extraIncrements?: Record<string, number>;
    /** Auto-continue reason when the claim fails */
    nudgeReason?: 'deploy_validation_failed' | 'status_line_contract_failed';
}

export interface ClaimValidationResult {
    hadError: boolean;
    validationViolation: boolean;
    failedClaims: string[];
}

// ── Claim Definitions ──────────────────────────────────────────────────────

function buildClaimSpecs(text: string): ClaimSpec[] {
    return [
        {
            name: 'statusLine',
            action: 'status_line_contract_failed',
            item: 'status line contract failed',
            run: () => validateStatusLineContract(text),
            extraIncrements: { contractFailures: 1, statusValidationFailures: 1 },
            nudgeReason: 'status_line_contract_failed',
        },
        {
            name: 'runtimeStatus',
            action: 'status_validation_failed',
            item: 'status validation failed',
            run: () => validateRuntimeStatusClaims(text, isDatabaseConfigured()),
            extraIncrements: { contractFailures: 1, statusValidationFailures: 1 },
        },
        {
            name: 'cloudflare',
            action: 'cloudflare_deploy_validation_failed',
            item: 'cloudflare deploy validation failed',
            run: () => validateCloudflareDeployClaims(text, isCloudflareConfigured()),
            extraIncrements: { contractFailures: 1, statusValidationFailures: 1 },
            nudgeReason: 'deploy_validation_failed',
        },
        {
            name: 'doneEvidence',
            action: 'done_evidence_validation_failed',
            item: 'done evidence validation failed',
            run: () => validateDoneEvidenceClaims(text),
            extraIncrements: { evidenceValidationFailures: 1 },
        },
        {
            name: 'universalTdd',
            action: 'universal_tdd_validation_failed',
            item: 'universal tdd validation failed',
            run: () => validateUniversalTddClaims(text),
            extraIncrements: { evidenceValidationFailures: 1 },
        },
    ];
}

// ── Runner ─────────────────────────────────────────────────────────────────

/**
 * Run all 5 claim validators against `text`.  On failure, each emits
 * swarm event + action + metrics + per-task failure marks.
 *
 * Returns whether any claim failed so the caller can set hadError /
 * validationViolation flags and optionally schedule auto-continue nudges.
 */
export function runClaimValidations(
    ctx: ValidationContext,
    text: string,
    nudgeFn?: (reason: 'deploy_validation_failed' | 'status_line_contract_failed') => void,
): ClaimValidationResult {
    const specs = buildClaimSpecs(text);
    const failedClaims: string[] = [];
    let hadError = false;
    let validationViolation = false;

    for (const spec of specs) {
        const claim = spec.run(text);
        if (!claim.checked || claim.ok) continue;

        hadError = true;
        validationViolation = true;
        failedClaims.push(spec.name);

        const reason = `${spec.item}: ${claim.reason || 'unknown reason'}`;

        appendSwarmEvent(ctx.groupFolder, {
            kind: 'error',
            stage: ctx.stage,
            item: spec.item,
            chatJid: ctx.chatJid,
            msg: reason,
        });

        appendSwarmAction(ctx.groupFolder, {
            action: spec.action,
            stage: ctx.stage,
            detail: reason,
        });

        updateRuntimeMetrics({
            groupFolder: ctx.groupFolder,
            increments: { validationFailures: 1, ...spec.extraIncrements },
            skillIncrements: { 'swarm-teamlead-orchestrator': { validationFails: 1 } },
            lastStage: ctx.stage || 'unknown',
            lastError: reason,
            lastTaskIds: ctx.taskIds.length > 0 ? ctx.taskIds : undefined,
        });

        for (const taskId of ctx.taskIds) {
            markTaskValidationFailure({
                groupFolder: ctx.groupFolder,
                taskId,
                error: reason,
            });
        }

        if (spec.nudgeReason && nudgeFn) {
            nudgeFn(spec.nudgeReason);
        }
    }

    return { hadError, validationViolation, failedClaims };
}
