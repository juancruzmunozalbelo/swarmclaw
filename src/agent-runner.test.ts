import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── All mock variables must be declared via vi.hoisted() so they exist
//    before vi.mock() factories run (factories are hoisted above const).
const {
    mockRunContainerAgent,
    mockGetAllTasks,
    mockClearSession,
    mockSetSession,
    mockGetModelAttemptPlan,
    mockOnModelAttemptFailure,
    mockOnModelAttemptSuccess,
    mockIsModelFallbackRetryable,
    circuitMap,
} = vi.hoisted(() => ({
    mockRunContainerAgent: vi.fn(),
    mockGetAllTasks: vi.fn(() => [] as unknown[]),
    mockClearSession: vi.fn(),
    mockSetSession: vi.fn(),
    mockGetModelAttemptPlan: vi.fn(() => ['claude-sonnet']),
    mockOnModelAttemptFailure: vi.fn(),
    mockOnModelAttemptSuccess: vi.fn(),
    mockIsModelFallbackRetryable: vi.fn(() => false),
    circuitMap: new Map<string, { openUntil: number }>(),
}));

vi.mock('./config.js', () => ({
    MAIN_GROUP_FOLDER: 'main',
    MODEL_PRIMARY: 'claude-sonnet',
    MODEL_CIRCUIT_BREAKER_ENABLED: true,
    SESSION_ROTATE_MAX_CYCLES: 5,
    SESSION_ROTATE_MAX_AGE_MS: 60_000,
}));

vi.mock('./container-runner.js', () => ({
    runContainerAgent: (...args: unknown[]) => mockRunContainerAgent(...args),
    writeGroupsSnapshot: vi.fn(),
    writeTasksSnapshot: vi.fn(),
}));

vi.mock('./db.js', () => ({
    getAllTasks: () => mockGetAllTasks(),
    clearSession: (...args: unknown[]) => mockClearSession(...args),
    setSession: (...args: unknown[]) => mockSetSession(...args),
}));

vi.mock('./model-circuit.js', () => ({
    getModelAttemptPlan: () => mockGetModelAttemptPlan(),
    onModelAttemptFailure: (...args: unknown[]) => mockOnModelAttemptFailure(...args),
    onModelAttemptSuccess: (...args: unknown[]) => mockOnModelAttemptSuccess(...args),
    isModelFallbackRetryable: (err: unknown) => (mockIsModelFallbackRetryable as any)(err),
    modelCircuitByName: circuitMap,
}));

vi.mock('./lane-manager.js', () => ({
    loadLaneState: () => ({ version: 1, updatedAt: '', tasks: {} }),
}));

vi.mock('./swarm-events.js', () => ({
    appendSwarmAction: vi.fn(),
    appendSwarmEvent: vi.fn(),
}));

vi.mock('./logger.js', () => ({
    logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import { runAgent, type AgentRunnerDeps } from './agent-runner.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AgentRunnerDeps> = {}): AgentRunnerDeps {
    return {
        sessions: {},
        sessionLifecycleByKey: new Map(),
        registeredGroups: {},
        queue: { registerProcess: vi.fn() },
        getAvailableGroups: () => [],
        saveState: vi.fn(),
        ...overrides,
    };
}

const testGroup = { folder: 'main', name: 'Main', jid: 'test@g.us' } as any;

function successOutput(sessionId?: string) {
    return { status: 'success', result: 'ok', newSessionId: sessionId } as any;
}

function errorOutput(error: string, sessionId?: string) {
    return { status: 'error', error, newSessionId: sessionId } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    circuitMap.clear();
    mockGetModelAttemptPlan.mockReturnValue(['claude-sonnet']);
    mockIsModelFallbackRetryable.mockReturnValue(false);
    mockRunContainerAgent.mockResolvedValue(successOutput());
});

describe('runAgent', () => {
    it('returns success on successful container run', async () => {
        const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
        expect(result).toBe('success');
        expect(mockRunContainerAgent).toHaveBeenCalledTimes(1);
        expect(mockOnModelAttemptSuccess).toHaveBeenCalledWith('claude-sonnet');
    });

    it('returns error on container failure', async () => {
        mockRunContainerAgent.mockResolvedValue(errorOutput('something broke'));
        const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
        expect(result).toBe('error');
        expect(mockOnModelAttemptFailure).toHaveBeenCalledWith('claude-sonnet', 'something broke');
    });

    it('returns error when exception is thrown', async () => {
        mockRunContainerAgent.mockRejectedValue(new Error('boom'));
        const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
        expect(result).toBe('error');
    });

    describe('session rotation', () => {
        it('increments cycle count on each call', async () => {
            const deps = makeDeps({
                sessions: { main: 'sess-1' },
                sessionLifecycleByKey: new Map([['main', { startedAt: Date.now(), cycles: 0 }]]),
            });
            await runAgent(testGroup, 'hello', 'chat1', deps);
            expect(deps.sessionLifecycleByKey.get('main')?.cycles).toBe(1);
        });

        it('rotates session when cycle limit reached (no active lanes)', async () => {
            const deps = makeDeps({
                sessions: { main: 'sess-old' },
                sessionLifecycleByKey: new Map([['main', { startedAt: Date.now(), cycles: 5 }]]),
            });
            await runAgent(testGroup, 'hello', 'chat1', deps);
            expect(deps.sessions['main']).toBeUndefined();
            expect(mockClearSession).toHaveBeenCalledWith('main');
        });

        it('rotates session when age limit reached', async () => {
            const deps = makeDeps({
                sessions: { main: 'sess-old' },
                sessionLifecycleByKey: new Map([['main', { startedAt: Date.now() - 120_000, cycles: 0 }]]),
            });
            await runAgent(testGroup, 'hello', 'chat1', deps);
            expect(deps.sessions['main']).toBeUndefined();
            expect(mockClearSession).toHaveBeenCalledWith('main');
        });

        it('tracks new session from container output', async () => {
            mockRunContainerAgent.mockResolvedValue(successOutput('new-session-id'));
            const deps = makeDeps();
            await runAgent(testGroup, 'hello', 'chat1', deps);
            expect(deps.sessions['main']).toBe('new-session-id');
            expect(mockSetSession).toHaveBeenCalledWith('main', 'new-session-id');
        });

        it('uses custom sessionKey when provided', async () => {
            const deps = makeDeps({ sessions: { 'main:dev': 'sess-dev' } });
            const lifecycle = new Map([['main:dev', { startedAt: Date.now(), cycles: 0 }]]);
            deps.sessionLifecycleByKey = lifecycle;
            await runAgent(testGroup, 'hello', 'chat1', deps, undefined, 'main:dev');
            expect(lifecycle.get('main:dev')?.cycles).toBe(1);
        });
    });

    describe('model fallback', () => {
        it('tries fallback model on retryable error', async () => {
            mockGetModelAttemptPlan.mockReturnValue(['claude-sonnet', 'claude-haiku']);
            mockIsModelFallbackRetryable.mockReturnValue(true);
            mockRunContainerAgent
                .mockResolvedValueOnce(errorOutput('timeout'))
                .mockResolvedValueOnce(successOutput());

            const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
            expect(result).toBe('success');
            expect(mockRunContainerAgent).toHaveBeenCalledTimes(2);
        });

        it('skips circuit-open models', async () => {
            mockGetModelAttemptPlan.mockReturnValue(['claude-sonnet', 'claude-haiku']);
            circuitMap.set('claude-sonnet', { openUntil: Date.now() + 60_000 });
            mockRunContainerAgent.mockResolvedValue(successOutput());

            const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
            expect(result).toBe('success');
            // Only claude-haiku should have been called (sonnet was skipped)
            expect(mockRunContainerAgent).toHaveBeenCalledTimes(1);
        });

        it('returns error when all models exhausted', async () => {
            mockGetModelAttemptPlan.mockReturnValue(['claude-sonnet']);
            circuitMap.set('claude-sonnet', { openUntil: Date.now() + 60_000 });

            const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
            expect(result).toBe('error');
            expect(mockRunContainerAgent).not.toHaveBeenCalled();
        });

        it('stops retrying on non-retryable error', async () => {
            mockGetModelAttemptPlan.mockReturnValue(['claude-sonnet', 'claude-haiku']);
            mockIsModelFallbackRetryable.mockReturnValue(false);
            mockRunContainerAgent.mockResolvedValue(errorOutput('invalid api key'));

            const result = await runAgent(testGroup, 'hello', 'chat1', makeDeps());
            expect(result).toBe('error');
            expect(mockRunContainerAgent).toHaveBeenCalledTimes(1);
        });
    });

    describe('hard failure handling', () => {
        it('resets session on SIGKILL', async () => {
            mockRunContainerAgent.mockResolvedValue(errorOutput('process received SIGKILL'));
            const deps = makeDeps({
                sessions: { main: 'sess-1' },
                sessionLifecycleByKey: new Map([['main', { startedAt: Date.now(), cycles: 2 }]]),
            });

            const result = await runAgent(testGroup, 'hello', 'chat1', deps);
            expect(result).toBe('error');
            expect(deps.sessions['main']).toBeUndefined();
            expect(mockClearSession).toHaveBeenCalledWith('main');
            expect(deps.sessionLifecycleByKey.has('main')).toBe(false);
        });

        it('resets session on timeout error', async () => {
            mockRunContainerAgent.mockResolvedValue(errorOutput('container timed out'));
            const deps = makeDeps({ sessions: { main: 'sess-1' } });

            await runAgent(testGroup, 'hello', 'chat1', deps);
            expect(deps.sessions['main']).toBeUndefined();
            expect(mockClearSession).toHaveBeenCalledWith('main');
        });
    });

    describe('onOutput callback', () => {
        it('wraps callback to track session from streamed output', async () => {
            const onOutput = vi.fn();
            const outputWithSession = { status: 'success', result: 'data', newSessionId: 'streamed-sess' } as any;
            mockRunContainerAgent.mockImplementation(async (_g: any, _o: any, _r: any, wrappedCb: any) => {
                if (wrappedCb) await wrappedCb(outputWithSession);
                return outputWithSession;
            });

            const deps = makeDeps();
            await runAgent(testGroup, 'hello', 'chat1', deps, onOutput);
            expect(deps.sessions['main']).toBe('streamed-sess');
            expect(onOutput).toHaveBeenCalledWith(outputWithSession);
        });
    });
});
