/**
 * Container Liveness Probes — detect dead/stale containers at runtime.
 * Runs periodic health checks on registered containers and notifies
 * the orchestrator when a container dies unexpectedly.
 *
 * Sprint 14 — Audit item #9.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContainerStatus {
    id: string;
    running: boolean;
    stale: boolean;
}

export interface LivenessResult {
    healthy: ContainerStatus[];
    dead: ContainerStatus[];
    stale: ContainerStatus[];
}

export interface LivenessProbeOpts {
    /** Interval between probe runs (ms) */
    intervalMs: number;
    /** Max age before considering a running container stale (ms) */
    staleThresholdMs: number;
    /** Callback when a container is found dead */
    onDead?: (containerId: string) => void;
    /** Callback when a container is found stale */
    onStale?: (containerId: string) => void;
}

// ── State ──────────────────────────────────────────────────────────────────

const trackedContainers = new Map<string, { registeredAt: number }>();
let probeTimer: ReturnType<typeof setInterval> | null = null;

/** @internal — for testing */
export function _resetLivenessState(): void {
    trackedContainers.clear();
    if (probeTimer) {
        clearInterval(probeTimer);
        probeTimer = null;
    }
}

// ── Container tracking ─────────────────────────────────────────────────────

/** Register a container for liveness monitoring */
export function trackContainer(containerId: string): void {
    trackedContainers.set(containerId, { registeredAt: Date.now() });
}

/** Remove a container from liveness monitoring */
export function untrackContainer(containerId: string): void {
    trackedContainers.delete(containerId);
}

/** Get all tracked container IDs */
export function getTrackedContainers(): string[] {
    return [...trackedContainers.keys()];
}

// ── Probe execution ────────────────────────────────────────────────────────

/** Check which tracked containers are alive via `container ls` */
export function runLivenessCheck(staleThresholdMs = 600_000): LivenessResult {
    const healthy: ContainerStatus[] = [];
    const dead: ContainerStatus[] = [];
    const stale: ContainerStatus[] = [];

    if (trackedContainers.size === 0) return { healthy, dead, stale };

    // Get running container IDs
    let runningIds: Set<string>;
    try {
        const output = execSync('container ls --format json', {
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
            timeout: 10000,
        });
        const containers: { status: string; configuration: { id: string } }[] =
            JSON.parse(output || '[]');
        runningIds = new Set(
            containers
                .filter((c) => c.status === 'running')
                .map((c) => c.configuration.id),
        );
    } catch (err) {
        logger.warn({ err }, 'Liveness probe: failed to list containers');
        return { healthy, dead, stale };
    }

    const now = Date.now();
    for (const [id, meta] of trackedContainers.entries()) {
        const ageSinceRegistered = now - meta.registeredAt;
        if (!runningIds.has(id)) {
            dead.push({ id, running: false, stale: false });
        } else if (ageSinceRegistered > staleThresholdMs) {
            stale.push({ id, running: true, stale: true });
        } else {
            healthy.push({ id, running: true, stale: false });
        }
    }

    return { healthy, dead, stale };
}

// ── Probe loop ─────────────────────────────────────────────────────────────

/**
 * Start the periodic liveness probe loop.
 * Checks container health at the specified interval and invokes
 * callbacks when dead or stale containers are detected.
 */
export function startLivenessProbeLoop(opts: LivenessProbeOpts): void {
    if (probeTimer) {
        logger.warn('Liveness probe loop already running, skipping duplicate start');
        return;
    }

    logger.info(
        { intervalMs: opts.intervalMs, staleThresholdMs: opts.staleThresholdMs },
        'Starting liveness probe loop',
    );

    probeTimer = setInterval(() => {
        if (trackedContainers.size === 0) return;
        try {
            const result = runLivenessCheck(opts.staleThresholdMs);
            for (const container of result.dead) {
                logger.warn({ containerId: container.id }, 'Liveness probe: container is dead');
                untrackContainer(container.id);
                opts.onDead?.(container.id);
            }
            for (const container of result.stale) {
                logger.warn({ containerId: container.id }, 'Liveness probe: container is stale');
                opts.onStale?.(container.id);
            }
        } catch (err) {
            logger.debug({ err }, 'Liveness probe loop iteration failed');
        }
    }, opts.intervalMs);

    // Don't prevent process exit
    if (probeTimer && typeof probeTimer === 'object' && 'unref' in probeTimer) {
        (probeTimer as NodeJS.Timeout).unref();
    }
}
