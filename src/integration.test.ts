/**
 * Integration Test — exercises the processGroupMessages orchestrator pipeline.
 *
 * Unlike unit tests, this test exercises REAL phase interactions:
 *   setupPhase → preflightPhase → timersPhase → cleanupPhase
 *
 * External I/O (Docker, WhatsApp) is mocked; phases + state logic are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PhaseContext, PhaseTimers } from './phases/types.js';
import type { RegisteredGroup, NewMessage } from './types.js';

// ── Mock heavy externals BEFORE import ────────────────────────────────

vi.mock('./container-runner.js', () => ({
    runAgentContainer: vi.fn().mockResolvedValue({ status: 'success', text: '', exitCode: 0 }),
    writeGroupsSnapshot: vi.fn(),
}));

vi.mock('./container-boot.js', () => ({
    ensureContainerSystemRunning: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./config.js', () => ({
    STORE_DIR: '/tmp/nanoclaw-inttest/store',
    DATA_DIR: '/tmp/nanoclaw-inttest/data',
    GROUPS_DIR: '/tmp/nanoclaw-inttest/groups',
    MAIN_GROUP_FOLDER: 'main',
    MAIN_GROUP_JID: 'test-group@g.us',
    ASSISTANT_NAME: 'TestBot',
    APP_MODE: 'debug',
    MAX_AGENT_CYCLES: 5,
    AGENT_IDLE_TIMEOUT_MS: 30000,
    DASH_IDLE_TIMEOUT_MS: 60000,
    PARALLEL_SUBAGENTS_ENABLED: false,
    SWARM_STRICT_MODE: false,
    MAX_CONTEXT_MESSAGES: 40,
    MAIN_CONTEXT_MESSAGES: 40,
    MODEL_PRIMARY: 'test-model',
    MODEL_FALLBACK: 'test-model-fallback',
    BASE_SYSTEM_PROMPT: 'Test agent.',
    CONTAINER_DOCKERFILE: 'Dockerfile.agent',
    CONTAINER_IMAGE_NAME: 'nanoclaw-agent',
    MICRO_BATCH_EPIC_PM_ONLY: false,
    SESSION_ROTATE_MAX_CYCLES: 50,
    SESSION_ROTATE_MAX_AGE_MS: 3600000,
    MODEL_CIRCUIT_BREAKER_ENABLED: false,
    BACKLOG_FREEZE_PREFIX: '',
    BACKLOG_FREEZE_ACTIVE_TASK: '',
    TASK_MICRO_BATCH_MAX: 5,
    TRIGGER_PATTERN: /@bot/i,
}));

vi.mock('./db.js', () => ({
    getNewMessages: vi.fn().mockReturnValue([]),
    getMessagesSince: vi.fn().mockReturnValue([]),
    storeMessage: vi.fn(),
    getCursor: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z'),
    setCursor: vi.fn(),
    setSession: vi.fn(),
    updateChatName: vi.fn(),
    getLastGroupSync: vi.fn(),
    setLastGroupSync: vi.fn(),
    getAllScheduledTasks: vi.fn().mockReturnValue([]),
    updateStaleLaneStates: vi.fn(),
    upsertWorkflowTask: vi.fn(),
    getWorkflowTask: vi.fn(),
    getWorkflowTransitions: vi.fn().mockReturnValue([]),
    deleteWorkflowTask: vi.fn(),
    upsertLaneState: vi.fn(),
    getLaneStates: vi.fn().mockReturnValue([]),
}));

vi.mock('./logger.js', () => ({
    logger: {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        debug: vi.fn(), trace: vi.fn(), child: vi.fn().mockReturnThis(),
    },
}));

vi.mock('./swarm-events.js', () => ({
    appendSwarmEvent: vi.fn(),
    appendSwarmAction: vi.fn(),
    appendSwarmTransitionAction: vi.fn(),
}));

vi.mock('./swarm-status.js', () => ({
    updateSwarmStatus: vi.fn(),
}));

vi.mock('./metrics.js', () => ({
    writeSwarmMetrics: vi.fn(),
}));

vi.mock('./runtime-metrics.js', () => ({
    updateRuntimeMetrics: vi.fn(),
    readRuntimeMetrics: vi.fn().mockReturnValue({
        counters: {}, lastStage: '', lastTaskIds: [], skillMetrics: {},
    }),
}));

vi.mock('./processing-ack.js', () => ({
    shouldSendProcessingAck: vi.fn().mockReturnValue(false),
    maybeSendProcessingAck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./swarm-workflow.js', () => ({
    ensureWorkflowTasks: vi.fn(),
    extractTaskIds: vi.fn().mockReturnValue([]),
    getBlockedTasks: vi.fn().mockReturnValue([]),
    getTaskWorkflowState: vi.fn().mockReturnValue({ stage: 'DEV', pendingQuestions: [] }),
    resolveTaskQuestions: vi.fn(),
    shouldAutoTrackScope: vi.fn().mockReturnValue(false),
    parseStageContract: vi.fn().mockReturnValue(null),
    validateStageContract: vi.fn().mockReturnValue({ ok: false, stage: undefined, missing: [] }),
}));

vi.mock('./text-helpers.js', () => ({
    inferStageHint: vi.fn().mockReturnValue('DEV'),
    sanitizeUserFacingText: vi.fn((t: string) => t),
    stripAnnoyingClosers: vi.fn((t: string) => t),
    stripNonBlockingQuestions: vi.fn((t: string) => t),
    strictOutputContractText: vi.fn((t: string) => t),
    extractSwarmlogObjects: vi.fn().mockReturnValue([]),
}));

vi.mock('./todo-manager.js', () => ({
    ensureTodoTracking: vi.fn().mockReturnValue([]),
    parseTodoTaskContext: vi.fn().mockReturnValue(null),
}));

vi.mock('./auto-continue.js', () => ({
    isAutoContinueEnabled: vi.fn().mockReturnValue(false),
    applyBacklogFreeze: vi.fn((ids: string[]) => ids),
    hasBlockingQuestionsInScope: vi.fn().mockReturnValue(false),
    detectPlanningOnlyOverride: vi.fn().mockReturnValue(false),
    detectDevopsOnlyOverride: vi.fn().mockReturnValue(false),
    detectExecutionTrack: vi.fn().mockReturnValue('standard'),
}));

vi.mock('./circuit-breaker-handler.js', () => ({
    checkCircuitBeforeDispatch: vi.fn().mockReturnValue({ allowed: true }),
    recordAgentFailure: vi.fn(),
}));

vi.mock('./error-recovery.js', () => ({
    handlePostAgentError: vi.fn().mockResolvedValue(undefined),
    clearErrorStreak: vi.fn(),
}));

vi.mock('./model-circuit.js', () => ({
    onModelAttemptSuccess: vi.fn(),
    onModelAttemptFailure: vi.fn(),
    getCircuitState: vi.fn().mockReturnValue({ state: 'closed' }),
    pickModelWithFallback: vi.fn().mockReturnValue('test-model'),
}));

vi.mock('./token-budget.js', () => ({
    checkBudget: vi.fn().mockReturnValue({ ok: true, used: 0, limit: 1000000, remaining: 1000000 }),
    recordTokenUsage: vi.fn(),
}));

vi.mock('./todo-normalizer.js', () => ({
    normalizeTodoFile: vi.fn().mockReturnValue({ changed: false, kept: 0, removed: 0 }),
}));

vi.mock('./prompt-builder.js', () => ({
    buildTeamLeadPrompt: vi.fn().mockReturnValue('Test prompt'),
    buildSubagentPrompt: vi.fn().mockReturnValue('Subagent prompt'),
    ownerFromStageHint: vi.fn().mockReturnValue('DEV'),
    planningRolesForTrack: vi.fn().mockReturnValue([]),
    executionRolesForTrack: vi.fn().mockReturnValue([]),
    isEpicBootstrapTask: vi.fn().mockReturnValue(false),
    inferTaskKind: vi.fn().mockReturnValue('feature'),
    routeRolesForTaskKind: vi.fn().mockReturnValue([]),
    mandatorySkillsForTask: vi.fn().mockReturnValue([]),
    parseTodoTaskContext: vi.fn().mockReturnValue(null),
}));

vi.mock('./lane-manager.js', () => ({
    getMessagesSince: vi.fn().mockReturnValue([]),
    trimMainContextMessages: vi.fn().mockReturnValue({ messages: [], dropped: 0 }),
}));

// ── Import after mocks ────────────────────────────────────────────────

import { setupPhase, preflightPhase, timersPhase, cleanupPhase } from './phases/index.js';
import { getMessagesSince } from './db.js';
import { updateSwarmStatus } from './swarm-status.js';
import { handlePostAgentError, clearErrorStreak } from './error-recovery.js';

// ── Helpers ───────────────────────────────────────────────────────────

const TEST_JID = 'test-group@g.us';
const TEST_GROUP: RegisteredGroup = {
    folder: 'main',
    name: 'Test Group',
    trigger: '',
    added_at: '2026-01-01T00:00:00.000Z',
};

function makeChannel() {
    return {
        name: 'test' as const,
        prefixAssistantName: false,
        connect: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        ownsJid: vi.fn().mockReturnValue(true),
        disconnect: vi.fn().mockResolvedValue(undefined),
        setTyping: vi.fn().mockResolvedValue(undefined),
        syncGroupMetadata: vi.fn().mockResolvedValue(undefined),
    };
}

function makeQueue() {
    return {
        closeStdin: vi.fn(),
        sendMessage: vi.fn().mockReturnValue(true),
        enqueue: vi.fn(),
    };
}

function makeDeps() {
    return {
        channel: makeChannel() as unknown as import('./types.js').Channel,
        queue: makeQueue() as unknown as import('./group-queue.js').GroupQueue,
        lastAgentTimestamp: {} as Record<string, string>,
        saveState: vi.fn(),
    };
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
    return {
        chatJid: TEST_JID,
        group: TEST_GROUP,
        isMainGroup: true,
        stageHint: 'DEV',
        taskIds: ['TEST-001'],
        missedMessages: [
            {
                id: 'msg-001',
                chat_jid: TEST_JID,
                sender: 'user@s.whatsapp.net',
                sender_name: 'Test User',
                content: 'Build the login page for TEST-001',
                timestamp: '2026-02-20T12:00:00.000Z',
                is_from_me: false,
            },
        ],
        prompt: 'Test prompt',
        previousCursor: '',
        hadError: false,
        outputSentToUser: false,
        validationViolation: false,
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Integration: Orchestrator Pipeline', () => {
    beforeEach(() => vi.clearAllMocks());

    it('setupPhase returns null when no messages pending', async () => {
        const lastAgentTimestamp: Record<string, string> = {};
        const result = await setupPhase(TEST_JID, TEST_GROUP, lastAgentTimestamp);
        expect(result).toBeNull();
    });

    it('setupPhase returns context when messages exist', async () => {
        const msgs: NewMessage[] = [
            {
                id: 'msg-001', chat_jid: TEST_JID,
                sender: 'user@s.whatsapp.net', sender_name: 'User',
                content: 'Build login for TEST-001',
                timestamp: '2026-02-20T12:00:00.000Z', is_from_me: false,
            },
        ];
        (getMessagesSince as ReturnType<typeof vi.fn>).mockReturnValue(msgs);

        const lastAgentTimestamp: Record<string, string> = {};
        const ctx = await setupPhase(TEST_JID, TEST_GROUP, lastAgentTimestamp);

        expect(ctx).not.toBeNull();
        expect(ctx!.chatJid).toBe(TEST_JID);
        expect(ctx!.group.folder).toBe('main');
        expect(ctx!.isMainGroup).toBe(true);
        expect(ctx!.missedMessages).toHaveLength(1);
    });

    it('preflightPhase executes without errors', () => {
        const ctx = makeCtx();
        expect(() => preflightPhase(ctx)).not.toThrow();
    });

    it('phases compose correctly: setup → preflight → timers → cleanup', async () => {
        const deps = makeDeps();
        const ctx = makeCtx();

        // Phase 2: Preflight
        preflightPhase(ctx);

        // Phase 3: Timers
        const timers = await timersPhase(ctx, deps);
        expect(timers).toBeDefined();
        expect(timers.resetIdleTimer).toBeTypeOf('function');
        expect(timers.scheduleDashIdle).toBeTypeOf('function');

        // Verify cursor was advanced
        expect(deps.lastAgentTimestamp[TEST_JID]).toBe('2026-02-20T12:00:00.000Z');
        expect(deps.saveState).toHaveBeenCalled();

        // Phase 5: Cleanup (success path)
        const result = await cleanupPhase(ctx, timers, 'success', deps);
        expect(result).toBe(true);

        // After cleanup, idle timer should be cleared
        expect(timers.idleTimer).toBeNull();

        // Verify swarm status was updated
        expect(updateSwarmStatus).toHaveBeenCalled();
    });

    it('cleanup rolls back cursor on error', async () => {
        const deps = makeDeps();
        deps.lastAgentTimestamp[TEST_JID] = 'cursor-before';
        const ctx = makeCtx({ hadError: true, previousCursor: 'cursor-before' });

        const timers: PhaseTimers = {
            idleTimer: null, dashIdleTimer: null, heartbeatTimer: null,
            resetIdleTimer: vi.fn(), scheduleDashIdle: vi.fn(),
        };

        const result = await cleanupPhase(ctx, timers, 'error', deps);

        expect(result).toBe(false);
        expect(deps.lastAgentTimestamp[TEST_JID]).toBe('cursor-before');
        expect(deps.saveState).toHaveBeenCalled();
        expect(handlePostAgentError).toHaveBeenCalled();
    });

    it('cleanup skips rollback when output was already sent', async () => {
        const deps = makeDeps();
        deps.lastAgentTimestamp[TEST_JID] = 'cursor-advanced';
        const ctx = makeCtx({
            hadError: true,
            outputSentToUser: true,
            previousCursor: 'cursor-before',
        });

        const timers: PhaseTimers = {
            idleTimer: null, dashIdleTimer: null, heartbeatTimer: null,
            resetIdleTimer: vi.fn(), scheduleDashIdle: vi.fn(),
        };

        const result = await cleanupPhase(ctx, timers, 'error', deps);

        // Should return true (don't retry) and NOT roll back cursor
        expect(result).toBe(true);
        expect(deps.lastAgentTimestamp[TEST_JID]).toBe('cursor-advanced');
        expect(handlePostAgentError).not.toHaveBeenCalled();
    });

    it('full pipeline: message → setup → preflight → timers → cleanup → state updated', async () => {
        // Arrange: messages waiting in lane-manager
        const msgs: NewMessage[] = [
            {
                id: 'msg-full-001', chat_jid: TEST_JID,
                sender: 'user@s.whatsapp.net', sender_name: 'User',
                content: 'Deploy login component for TEST-001',
                timestamp: '2026-02-20T14:00:00.000Z', is_from_me: false,
            },
        ];
        (getMessagesSince as ReturnType<typeof vi.fn>).mockReturnValue(msgs);

        const lastAgentTimestamp: Record<string, string> = {};
        const deps = makeDeps();
        deps.lastAgentTimestamp = lastAgentTimestamp;

        // Phase 1: Setup
        const ctx = await setupPhase(TEST_JID, TEST_GROUP, lastAgentTimestamp);
        expect(ctx).not.toBeNull();

        // Phase 2: Preflight
        preflightPhase(ctx!);

        // Phase 3: Timers
        const timers = await timersPhase(ctx!, deps);
        expect(lastAgentTimestamp[TEST_JID]).toBe('2026-02-20T14:00:00.000Z');

        // Simulate: agent ran and produced output
        ctx!.outputSentToUser = true;

        // Phase 5: Cleanup
        const ok = await cleanupPhase(ctx!, timers, 'success', deps);
        expect(ok).toBe(true);

        // Verify final state: cursor advanced, no error streak
        expect(lastAgentTimestamp[TEST_JID]).toBe('2026-02-20T14:00:00.000Z');
        expect(clearErrorStreak).toHaveBeenCalled();
    });
});
