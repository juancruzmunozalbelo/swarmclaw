/**
 * Git Checkpoint — automatic git commits between workflow stages.
 * Provides rollback safety: if DEV/QA fails, the orchestrator can
 * revert to the last known-good commit (post-SPEC or post-PM tag).
 *
 * Sprint 12 — Audit item #12.
 */

import { execSync } from 'child_process';
import path from 'path';
import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CheckpointResult {
    /** Whether the checkpoint was successfully created */
    ok: boolean;
    /** Git commit hash (short), if created */
    commitHash?: string;
    /** Tag name, if created */
    tag?: string;
    /** Error message if failed */
    error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function groupRepoPath(groupFolder: string): string {
    return path.join(GROUPS_DIR, groupFolder);
}

function isGitRepo(repoPath: string): boolean {
    try {
        execSync('git rev-parse --is-inside-work-tree', {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 5000,
        });
        return true;
    } catch {
        return false;
    }
}

function hasChanges(repoPath: string): boolean {
    try {
        const status = execSync('git status --porcelain', {
            cwd: repoPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: 5000,
        });
        return status.trim().length > 0;
    } catch {
        return false;
    }
}

// ── Main checkpoint function ───────────────────────────────────────────────

/**
 * Create a git checkpoint (commit + optional tag) for a task at a stage boundary.
 *
 * Called before stage transitions: PM→SPEC, SPEC→DEV, DEV→QA, QA→DONE.
 * Only commits if there are actual changes in the working tree.
 */
export function createCheckpoint(params: {
    groupFolder: string;
    taskId: string;
    fromStage: string;
    toStage: string;
}): CheckpointResult {
    const repoPath = groupRepoPath(params.groupFolder);

    if (!isGitRepo(repoPath)) {
        return { ok: false, error: 'not a git repo' };
    }

    if (!hasChanges(repoPath)) {
        return { ok: true }; // Nothing to commit — still ok
    }

    const commitMsg = `checkpoint: ${params.taskId} ${params.fromStage} → ${params.toStage}`;
    const tagName = `swarclaw/${params.taskId}/${params.fromStage.toLowerCase()}`;

    try {
        // Stage all changes
        execSync('git add -A', {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 10000,
        });

        // Commit
        execSync(`git commit -m "${commitMsg}" --no-verify`, {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 15000,
        });

        // Get commit hash
        const hash = execSync('git rev-parse --short HEAD', {
            cwd: repoPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();

        // Create tag (force to overwrite existing)
        try {
            execSync(`git tag -f ${tagName}`, {
                cwd: repoPath,
                stdio: 'pipe',
                timeout: 5000,
            });
        } catch {
            // Tag creation is best-effort
        }

        logger.info(
            { groupFolder: params.groupFolder, taskId: params.taskId, from: params.fromStage, to: params.toStage, hash, tag: tagName },
            `Git checkpoint created: ${hash}`,
        );

        return { ok: true, commitHash: hash, tag: tagName };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
            { groupFolder: params.groupFolder, taskId: params.taskId, err: msg },
            'Git checkpoint failed (non-fatal)',
        );
        return { ok: false, error: msg };
    }
}

/**
 * Rollback to a checkpoint tag. Used when circuit breaker fires
 * and the task needs to revert to the last known-good state.
 */
export function rollbackToCheckpoint(params: {
    groupFolder: string;
    taskId: string;
    stage: string;
}): CheckpointResult {
    const repoPath = groupRepoPath(params.groupFolder);
    const tagName = `swarclaw/${params.taskId}/${params.stage.toLowerCase()}`;

    if (!isGitRepo(repoPath)) {
        return { ok: false, error: 'not a git repo' };
    }

    try {
        // Check if tag exists
        execSync(`git rev-parse ${tagName}`, {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 5000,
        });

        // Hard reset to tag
        execSync(`git reset --hard ${tagName}`, {
            cwd: repoPath,
            stdio: 'pipe',
            timeout: 10000,
        });

        const hash = execSync('git rev-parse --short HEAD', {
            cwd: repoPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();

        logger.info(
            { groupFolder: params.groupFolder, taskId: params.taskId, stage: params.stage, hash, tag: tagName },
            `Rolled back to checkpoint: ${tagName} (${hash})`,
        );

        return { ok: true, commitHash: hash, tag: tagName };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
            { groupFolder: params.groupFolder, taskId: params.taskId, tag: tagName, err: msg },
            'Rollback failed',
        );
        return { ok: false, error: msg };
    }
}
