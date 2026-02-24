import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./config.js', () => ({
    ASSISTANT_NAME: 'swarclaw',
    TASK_CIRCUIT_BREAKER_ENABLED: true,
    TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    TASK_CIRCUIT_BREAKER_OPEN_MS: 600_000,
    MODEL_CIRCUIT_BREAKER_ENABLED: true,
    MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
    MODEL_CIRCUIT_BREAKER_OPEN_MS: 60_000,
    MODEL_PRIMARY: 'claude',
    MODEL_FALLBACKS: [],
}));
vi.mock('./swarm-workflow.js', () => ({
    transitionTaskStage: vi.fn(() => ({ ok: true, state: {} })),
}));
vi.mock('./swarm-events.js', () => ({
    appendSwarmAction: vi.fn(),
    appendSwarmEvent: vi.fn(),
}));
vi.mock('./logger.js', () => ({
    logger: { warn: vi.fn(), error: vi.fn() },
}));

import { checkCircuitBeforeDispatch, recordAgentFailure } from './circuit-breaker-handler.js';
import { _resetTaskRoleCircuit, onTaskRoleFailure } from './model-circuit.js';
import { transitionTaskStage } from './swarm-workflow.js';

beforeEach(() => {
    _resetTaskRoleCircuit();
    vi.clearAllMocks();
});

describe('checkCircuitBeforeDispatch', () => {
    const deps = { sendNotification: vi.fn() };

    it('returns blocked:false when circuit is closed', () => {
        const result = checkCircuitBeforeDispatch({
            taskId: 'MKT-001', role: 'DEV', groupFolder: 'main', chatJid: 'chat@g.us',
        }, deps);
        expect(result.blocked).toBe(false);
        expect(deps.sendNotification).not.toHaveBeenCalled();
    });

    it('returns blocked:true when circuit is open', () => {
        // Open the circuit by triggering threshold failures
        onTaskRoleFailure('MKT-001', 'DEV', 'timeout');
        onTaskRoleFailure('MKT-001', 'DEV', 'timeout');
        onTaskRoleFailure('MKT-001', 'DEV', 'timeout');

        const result = checkCircuitBeforeDispatch({
            taskId: 'MKT-001', role: 'DEV', groupFolder: 'main', chatJid: 'chat@g.us',
        }, deps);
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('circuit breaker open');
        expect(deps.sendNotification).toHaveBeenCalled();
        expect(vi.mocked(transitionTaskStage)).toHaveBeenCalledWith(
            expect.objectContaining({ taskId: 'MKT-001', to: 'BLOCKED' }),
        );
    });

    it('includes CIRCUIT BREAKER in notification message', () => {
        onTaskRoleFailure('MKT-001', 'DEV', 'error xyz');
        onTaskRoleFailure('MKT-001', 'DEV', 'error xyz');
        onTaskRoleFailure('MKT-001', 'DEV', 'error xyz');

        checkCircuitBeforeDispatch({
            taskId: 'MKT-001', role: 'DEV', groupFolder: 'main', chatJid: 'chat@g.us',
        }, deps);

        const msg = deps.sendNotification.mock.calls[0][1];
        expect(msg).toContain('CIRCUIT BREAKER');
        expect(msg).toContain('MKT-001');
        expect(msg).toContain('DEV');
    });
});

describe('recordAgentFailure', () => {
    it('records failure without opening circuit below threshold', () => {
        recordAgentFailure('MKT-001', 'DEV', 'error 1', 'main');
        const result = checkCircuitBeforeDispatch({
            taskId: 'MKT-001', role: 'DEV', groupFolder: 'main', chatJid: 'chat@g.us',
        }, { sendNotification: vi.fn() });
        expect(result.blocked).toBe(false);
    });

    it('opens circuit after threshold failures via recordAgentFailure', () => {
        recordAgentFailure('MKT-001', 'DEV', 'err', 'main');
        recordAgentFailure('MKT-001', 'DEV', 'err', 'main');
        recordAgentFailure('MKT-001', 'DEV', 'err', 'main');

        const result = checkCircuitBeforeDispatch({
            taskId: 'MKT-001', role: 'DEV', groupFolder: 'main', chatJid: 'chat@g.us',
        }, { sendNotification: vi.fn() });
        expect(result.blocked).toBe(true);
    });
});
