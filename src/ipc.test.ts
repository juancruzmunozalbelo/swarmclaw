/**
 * IPC Tests — processTaskIpc command dispatcher + authorization checks.
 *
 * Tests cover:
 *   - schedule_task (cron/interval/once + authorization)
 *   - pause_task / resume_task / cancel_task with ownership checks
 *   - refresh_groups (main-only)
 *   - register_group (main-only + field validation)
 *   - Unknown type handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
    ASSISTANT_NAME: 'TestBot',
    DATA_DIR: '/tmp/ipc-test/data',
    IPC_POLL_INTERVAL: 1000,
    MAIN_GROUP_FOLDER: 'main',
    TIMEZONE: 'America/Argentina/Buenos_Aires',
}));

vi.mock('./db.js', () => ({
    createTask: vi.fn(),
    deleteTask: vi.fn(),
    getTaskById: vi.fn(),
    updateTask: vi.fn(),
}));

vi.mock('./logger.js', () => ({
    logger: {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        debug: vi.fn(), trace: vi.fn(),
    },
}));

import { processTaskIpc, type IpcDeps } from './ipc.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { logger } from './logger.js';

// ── Helpers ───────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<IpcDeps> = {}): IpcDeps {
    return {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        registeredGroups: vi.fn().mockReturnValue({
            'group-a@g.us': { name: 'Group A', folder: 'main', trigger: '', added_at: '2026-01-01' },
            'group-b@g.us': { name: 'Group B', folder: 'project-x', trigger: '', added_at: '2026-01-01' },
        }),
        registerGroup: vi.fn(),
        syncGroupMetadata: vi.fn().mockResolvedValue(undefined),
        getAvailableGroups: vi.fn().mockReturnValue([]),
        writeGroupsSnapshot: vi.fn(),
        ...overrides,
    };
}

// ── schedule_task ─────────────────────────────────────────────────────

describe('processTaskIpc: schedule_task', () => {
    beforeEach(() => vi.clearAllMocks());

    it('creates a task with cron schedule (main group)', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'Run daily backup',
                schedule_type: 'cron',
                schedule_value: '0 3 * * *',
                targetJid: 'group-a@g.us',
            },
            'main', true, deps,
        );
        expect(createTask).toHaveBeenCalledOnce();
        const call = (createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.prompt).toBe('Run daily backup');
        expect(call.schedule_type).toBe('cron');
        expect(call.group_folder).toBe('main');
        expect(call.next_run).toBeTruthy();
    });

    it('creates a task with interval schedule', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'Health check',
                schedule_type: 'interval',
                schedule_value: '60000',
                targetJid: 'group-a@g.us',
            },
            'main', true, deps,
        );
        expect(createTask).toHaveBeenCalledOnce();
        const call = (createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(call.schedule_type).toBe('interval');
    });

    it('creates a task with once schedule', async () => {
        const deps = makeDeps();
        const futureDate = new Date(Date.now() + 86400000).toISOString();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'One-time deploy',
                schedule_type: 'once',
                schedule_value: futureDate,
                targetJid: 'group-a@g.us',
            },
            'main', true, deps,
        );
        expect(createTask).toHaveBeenCalledOnce();
    });

    it('rejects invalid cron expression', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'Bad cron',
                schedule_type: 'cron',
                schedule_value: 'invalid cron !!!',
                targetJid: 'group-a@g.us',
            },
            'main', true, deps,
        );
        expect(createTask).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('rejects invalid interval', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'Bad interval',
                schedule_type: 'interval',
                schedule_value: '-1',
                targetJid: 'group-a@g.us',
            },
            'main', true, deps,
        );
        expect(createTask).not.toHaveBeenCalled();
    });

    it('blocks non-main group from scheduling for another group', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'Cross-group attack',
                schedule_type: 'interval',
                schedule_value: '5000',
                targetJid: 'group-a@g.us', // belongs to folder 'main'
            },
            'project-x', false, deps, // non-main sender
        );
        expect(createTask).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('allows non-main group to schedule for itself', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'schedule_task',
                prompt: 'Self task',
                schedule_type: 'interval',
                schedule_value: '10000',
                targetJid: 'group-b@g.us', // belongs to folder 'project-x'
            },
            'project-x', false, deps,
        );
        expect(createTask).toHaveBeenCalledOnce();
    });

    it('skips if required fields are missing', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'schedule_task', prompt: 'Missing fields' },
            'main', true, deps,
        );
        expect(createTask).not.toHaveBeenCalled();
    });
});

// ── pause/resume/cancel ───────────────────────────────────────────────

describe('processTaskIpc: task lifecycle', () => {
    beforeEach(() => vi.clearAllMocks());

    it('pauses a task owned by the caller', async () => {
        (getTaskById as ReturnType<typeof vi.fn>).mockReturnValue({
            id: 'task-1', group_folder: 'project-x', status: 'active',
        });
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'pause_task', taskId: 'task-1' },
            'project-x', false, deps,
        );
        expect(updateTask).toHaveBeenCalledWith('task-1', { status: 'paused' });
    });

    it('main can pause any group task', async () => {
        (getTaskById as ReturnType<typeof vi.fn>).mockReturnValue({
            id: 'task-1', group_folder: 'project-x', status: 'active',
        });
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'pause_task', taskId: 'task-1' },
            'main', true, deps,
        );
        expect(updateTask).toHaveBeenCalledWith('task-1', { status: 'paused' });
    });

    it('blocks non-owner from pausing task', async () => {
        (getTaskById as ReturnType<typeof vi.fn>).mockReturnValue({
            id: 'task-1', group_folder: 'other-group', status: 'active',
        });
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'pause_task', taskId: 'task-1' },
            'project-x', false, deps,
        );
        expect(updateTask).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('resumes a paused task', async () => {
        (getTaskById as ReturnType<typeof vi.fn>).mockReturnValue({
            id: 'task-2', group_folder: 'main', status: 'paused',
        });
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'resume_task', taskId: 'task-2' },
            'main', true, deps,
        );
        expect(updateTask).toHaveBeenCalledWith('task-2', { status: 'active' });
    });

    it('cancels a task (deletes it)', async () => {
        (getTaskById as ReturnType<typeof vi.fn>).mockReturnValue({
            id: 'task-3', group_folder: 'main', status: 'active',
        });
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'cancel_task', taskId: 'task-3' },
            'main', true, deps,
        );
        expect(deleteTask).toHaveBeenCalledWith('task-3');
    });

    it('blocks cancel from wrong group', async () => {
        (getTaskById as ReturnType<typeof vi.fn>).mockReturnValue({
            id: 'task-4', group_folder: 'other', status: 'active',
        });
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'cancel_task', taskId: 'task-4' },
            'project-x', false, deps,
        );
        expect(deleteTask).not.toHaveBeenCalled();
    });
});

// ── refresh_groups ────────────────────────────────────────────────────

describe('processTaskIpc: refresh_groups', () => {
    beforeEach(() => vi.clearAllMocks());

    it('main can refresh groups', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'refresh_groups' },
            'main', true, deps,
        );
        expect(deps.syncGroupMetadata).toHaveBeenCalledWith(true);
        expect(deps.writeGroupsSnapshot).toHaveBeenCalled();
    });

    it('non-main blocked from refreshing groups', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'refresh_groups' },
            'project-x', false, deps,
        );
        expect(deps.syncGroupMetadata).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });
});

// ── register_group ────────────────────────────────────────────────────

describe('processTaskIpc: register_group', () => {
    beforeEach(() => vi.clearAllMocks());

    it('main can register a new group', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'register_group',
                jid: 'newgroup@g.us',
                name: 'New Project',
                folder: 'new-project',
                trigger: '@bot',
                requiresTrigger: true,
            },
            'main', true, deps,
        );
        expect(deps.registerGroup).toHaveBeenCalledWith('newgroup@g.us', expect.objectContaining({
            name: 'New Project',
            folder: 'new-project',
            trigger: '@bot',
            requiresTrigger: true,
        }));
    });

    it('non-main blocked from registering groups', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            {
                type: 'register_group',
                jid: 'x@g.us', name: 'X', folder: 'x', trigger: '@x',
            },
            'project-x', false, deps,
        );
        expect(deps.registerGroup).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('rejects registration with missing fields', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'register_group', jid: 'x@g.us', name: 'X' },
            'main', true, deps,
        );
        expect(deps.registerGroup).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });
});

// ── Unknown type ──────────────────────────────────────────────────────

describe('processTaskIpc: unknown type', () => {
    it('logs warning for unknown IPC type', async () => {
        const deps = makeDeps();
        await processTaskIpc(
            { type: 'hack_the_planet' },
            'main', true, deps,
        );
        expect(logger.warn).toHaveBeenCalled();
    });
});
