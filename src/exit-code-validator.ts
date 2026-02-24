/**
 * Exit Code Validator — verify agent work by running real commands
 * and checking exit codes, instead of trusting LLM text output.
 *
 * Sprint 15 — Audit item #15 (Definition of Done).
 *
 * Runs validation commands (tsc, test, lint) inside the group's
 * working directory and returns structured pass/fail results.
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ValidationCommand {
    /** Human-readable name for the check */
    name: string;
    /** Shell command to run */
    command: string;
    /** Timeout in ms (default: 30s) */
    timeoutMs?: number;
    /** Whether this check is required for "done" status */
    required: boolean;
}

export interface ValidationResult {
    name: string;
    command: string;
    passed: boolean;
    exitCode: number | null;
    output: string;
    durationMs: number;
}

export interface ValidationSummary {
    allPassed: boolean;
    results: ValidationResult[];
    requiredFailed: string[];
}

// ── Default validation commands ────────────────────────────────────────────

export function defaultValidationCommands(workDir: string): ValidationCommand[] {
    const cmds: ValidationCommand[] = [];

    // TypeScript check
    if (fs.existsSync(path.join(workDir, 'tsconfig.json'))) {
        cmds.push({ name: 'typecheck', command: 'npx tsc --noEmit', timeoutMs: 60000, required: true });
    }

    // Package.json test script
    const pkgPath = path.join(workDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.scripts?.test) {
                cmds.push({ name: 'test', command: 'npm test', timeoutMs: 120000, required: true });
            }
            if (pkg.scripts?.lint) {
                cmds.push({ name: 'lint', command: 'npm run lint', timeoutMs: 30000, required: false });
            }
            if (pkg.scripts?.build) {
                cmds.push({ name: 'build', command: 'npm run build', timeoutMs: 60000, required: false });
            }
        } catch {
            // ignore malformed package.json
        }
    }

    return cmds;
}

// ── Validation runner ──────────────────────────────────────────────────────

/**
 * Run a single validation command and return the result.
 */
export function runValidationCommand(
    cmd: ValidationCommand,
    workDir: string,
): ValidationResult {
    const start = Date.now();
    try {
        const output = execSync(cmd.command, {
            cwd: workDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: cmd.timeoutMs ?? 30000,
        });
        return {
            name: cmd.name,
            command: cmd.command,
            passed: true,
            exitCode: 0,
            output: (output || '').slice(-500),
            durationMs: Date.now() - start,
        };
    } catch (err: unknown) {
        const execErr = err as Record<string, unknown>;
        const exitCode = (typeof execErr?.status === 'number' ? execErr.status : null) as number | null;
        const stderr = String(execErr?.stderr || execErr?.stdout || (err instanceof Error ? err.message : '') || '').slice(-500);
        return {
            name: cmd.name,
            command: cmd.command,
            passed: false,
            exitCode,
            output: stderr,
            durationMs: Date.now() - start,
        };
    }
}

/**
 * Run all validation commands for a group's working directory.
 * Returns a summary with pass/fail for each command.
 */
export function validateTaskCompletion(
    groupFolder: string,
    commands?: ValidationCommand[],
): ValidationSummary {
    const workDir = path.join(GROUPS_DIR, groupFolder);
    const cmds = commands ?? defaultValidationCommands(workDir);

    if (cmds.length === 0) {
        return { allPassed: true, results: [], requiredFailed: [] };
    }

    const results: ValidationResult[] = [];
    for (const cmd of cmds) {
        const result = runValidationCommand(cmd, workDir);
        results.push(result);
        logger.info(
            { name: cmd.name, passed: result.passed, exitCode: result.exitCode, durationMs: result.durationMs },
            `Validation ${result.passed ? '✅' : '❌'}: ${cmd.name}`,
        );
    }

    const requiredFailed = results
        .filter((r) => !r.passed && cmds.find((c) => c.name === r.name)?.required)
        .map((r) => r.name);

    return {
        allPassed: requiredFailed.length === 0,
        results,
        requiredFailed,
    };
}
