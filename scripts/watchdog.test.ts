import { describe, it, expect } from 'vitest';
import { shouldAllowRestart } from './watchdog.js';

/** Creates a minimal WatchdogState suitable for shouldAllowRestart */
function emptyState(): {
    lastIncidentAt: string | null;
    lastIncidentKey: string | null;
    lastWaIncidentAt: string | null;
    lastWaIncidentKey: string | null;
    waReconnectSince: string | null;
    lastOrphanCleanupAt: string | null;
    lastCriticalSince: string | null;
    lastCriticalIncidentAt: string | null;
    lastCriticalIncidentKey: string | null;
    lastHardStuckIncidentAt: string | null;
    lastHardStuckIncidentKey: string | null;
    lastRestartAt: string | null;
    lastRestartKind: string | null;
    restartHistory: Array<{ ts: string; kind: string; detail: string }>;
} {
    return {
        lastIncidentAt: null,
        lastIncidentKey: null,
        lastWaIncidentAt: null,
        lastWaIncidentKey: null,
        waReconnectSince: null,
        lastOrphanCleanupAt: null,
        lastCriticalSince: null,
        lastCriticalIncidentAt: null,
        lastCriticalIncidentKey: null,
        lastHardStuckIncidentAt: null,
        lastHardStuckIncidentKey: null,
        lastRestartAt: null,
        lastRestartKind: null,
        restartHistory: [],
    };
}

describe('shouldAllowRestart', () => {
    it('allows restart when state is fresh', () => {
        const gate = shouldAllowRestart(emptyState(), 'test');
        expect(gate.ok).toBe(true);
        expect(gate.recentCount).toBe(0);
    });

    it('blocks restart during global cooldown', () => {
        const state = emptyState();
        // Default cooldown is 4m = 240_000ms
        state.lastRestartAt = new Date(Date.now() - 60_000).toISOString(); // 1m ago → still in cooldown
        const gate = shouldAllowRestart(state, 'test');
        expect(gate.ok).toBe(false);
        expect(gate.reason).toBe('global_cooldown');
        expect(gate.cooldownLeftMs).toBeGreaterThan(0);
    });

    it('allows restart after cooldown expires', () => {
        const state = emptyState();
        // Default cooldown is 4m = 240_000ms
        state.lastRestartAt = new Date(Date.now() - 300_000).toISOString(); // 5m ago → past cooldown
        const gate = shouldAllowRestart(state, 'test');
        expect(gate.ok).toBe(true);
    });

    it('blocks restart when max restarts per window is reached', () => {
        const state = emptyState();
        // Default max is 4, window is 60m
        const now = Date.now();
        state.restartHistory = [
            { ts: new Date(now - 50 * 60_000).toISOString(), kind: 'test', detail: 'r1' },
            { ts: new Date(now - 40 * 60_000).toISOString(), kind: 'test', detail: 'r2' },
            { ts: new Date(now - 30 * 60_000).toISOString(), kind: 'test', detail: 'r3' },
            { ts: new Date(now - 20 * 60_000).toISOString(), kind: 'test', detail: 'r4' },
        ];
        const gate = shouldAllowRestart(state, 'test');
        expect(gate.ok).toBe(false);
        expect(gate.reason).toBe('max_restarts_per_window');
        expect(gate.recentCount).toBe(4);
    });

    it('allows restart when old history entries have expired', () => {
        const state = emptyState();
        // All entries older than the 60m window
        const now = Date.now();
        state.restartHistory = [
            { ts: new Date(now - 90 * 60_000).toISOString(), kind: 'test', detail: 'r1' },
            { ts: new Date(now - 80 * 60_000).toISOString(), kind: 'test', detail: 'r2' },
            { ts: new Date(now - 70 * 60_000).toISOString(), kind: 'test', detail: 'r3' },
            { ts: new Date(now - 65 * 60_000).toISOString(), kind: 'test', detail: 'r4' },
        ];
        const gate = shouldAllowRestart(state, 'test');
        expect(gate.ok).toBe(true);
        expect(gate.recentCount).toBe(0);
    });

    it('prunes stale history entries from state', () => {
        const state = emptyState();
        const now = Date.now();
        state.restartHistory = [
            { ts: new Date(now - 120 * 60_000).toISOString(), kind: 'test', detail: 'old' },
            { ts: new Date(now - 10 * 60_000).toISOString(), kind: 'test', detail: 'recent' },
        ];
        shouldAllowRestart(state, 'test');
        // After call, restartHistory should only contain the recent entry
        expect(state.restartHistory).toHaveLength(1);
        expect(state.restartHistory[0].detail).toBe('recent');
    });
});
