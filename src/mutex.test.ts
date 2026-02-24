/**
 * Mutex Contention Tests
 *
 * Validates that the Mutex and KeyedMutex classes correctly serialize
 * concurrent async operations — the core guarantee that prevents
 * dirty writes and lost updates in todo.md and IPC files.
 */
import { describe, it, expect } from 'vitest';
import { Mutex, KeyedMutex } from './mutex.js';

describe('Mutex', () => {
    it('serializes two concurrent acquires (no interleaving)', async () => {
        const mutex = new Mutex();
        const order: string[] = [];

        const task1 = (async () => {
            const release = await mutex.acquire();
            order.push('T1:enter');
            // Simulate async I/O (readFile → modify → writeFile)
            await new Promise((r) => setTimeout(r, 30));
            order.push('T1:exit');
            release();
        })();

        const task2 = (async () => {
            const release = await mutex.acquire();
            order.push('T2:enter');
            await new Promise((r) => setTimeout(r, 10));
            order.push('T2:exit');
            release();
        })();

        await Promise.all([task1, task2]);

        // T1 must fully complete before T2 starts (no interleaving)
        expect(order).toEqual(['T1:enter', 'T1:exit', 'T2:enter', 'T2:exit']);
    });

    it('serializes N concurrent acquires in FIFO order', async () => {
        const mutex = new Mutex();
        const order: number[] = [];
        const N = 10;

        const tasks = Array.from({ length: N }, (_, i) =>
            (async () => {
                const release = await mutex.acquire();
                order.push(i);
                await new Promise((r) => setTimeout(r, 5));
                release();
            })(),
        );

        await Promise.all(tasks);

        // All N tasks ran exactly once, in FIFO acquire order
        expect(order).toHaveLength(N);
        expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('does not deadlock on immediate sequential acquires', async () => {
        const mutex = new Mutex();

        const r1 = await mutex.acquire();
        r1();
        const r2 = await mutex.acquire();
        r2();
        const r3 = await mutex.acquire();
        r3();

        // If we got here without hanging, no deadlock
        expect(true).toBe(true);
    });

    it('release in finally block always frees the lock', async () => {
        const mutex = new Mutex();
        const order: string[] = [];

        // Task 1: throws after acquiring the lock
        const task1 = (async () => {
            const release = await mutex.acquire();
            try {
                order.push('T1:enter');
                throw new Error('simulated crash');
            } finally {
                order.push('T1:finally');
                release();
            }
        })().catch(() => { });

        // Task 2: should still be able to acquire after T1 fails
        const task2 = (async () => {
            const release = await mutex.acquire();
            order.push('T2:enter');
            release();
        })();

        await Promise.all([task1, task2]);

        expect(order).toEqual(['T1:enter', 'T1:finally', 'T2:enter']);
    });
});

describe('KeyedMutex', () => {
    it('different keys do NOT block each other', async () => {
        const km = new KeyedMutex();
        const order: string[] = [];

        const taskA = (async () => {
            const release = await km.acquire('group-A');
            order.push('A:enter');
            await new Promise((r) => setTimeout(r, 40));
            order.push('A:exit');
            release();
        })();

        const taskB = (async () => {
            const release = await km.acquire('group-B');
            order.push('B:enter');
            await new Promise((r) => setTimeout(r, 10));
            order.push('B:exit');
            release();
        })();

        await Promise.all([taskA, taskB]);

        // Both should enter immediately (different keys → independent locks)
        // B finishes first because it sleeps less
        expect(order).toEqual(['A:enter', 'B:enter', 'B:exit', 'A:exit']);
    });

    it('same key serializes concurrent operations', async () => {
        const km = new KeyedMutex();
        const order: string[] = [];
        const KEY = 'shared-group';

        const task1 = (async () => {
            const release = await km.acquire(KEY);
            order.push('T1:enter');
            await new Promise((r) => setTimeout(r, 20));
            order.push('T1:exit');
            release();
        })();

        const task2 = (async () => {
            const release = await km.acquire(KEY);
            order.push('T2:enter');
            await new Promise((r) => setTimeout(r, 5));
            order.push('T2:exit');
            release();
        })();

        await Promise.all([task1, task2]);

        expect(order).toEqual(['T1:enter', 'T1:exit', 'T2:enter', 'T2:exit']);
    });

    it('simulates the todo.md race condition scenario', async () => {
        const km = new KeyedMutex();
        // Simulate a shared todo.md file as a simple string variable
        let todoContent = 'TASK-001: todo\nTASK-002: todo\n';

        const setTaskState = async (taskId: string, newState: string) => {
            const release = await km.acquire('main');
            try {
                // Read
                const lines = todoContent.split('\n');
                // Simulate async I/O latency
                await new Promise((r) => setTimeout(r, 10));
                // Modify
                const idx = lines.findIndex((l) => l.startsWith(taskId));
                if (idx >= 0) lines[idx] = `${taskId}: ${newState}`;
                // Write
                todoContent = lines.join('\n');
            } finally {
                release();
            }
        };

        // Two concurrent updates to different tasks — WITHOUT mutex, one would clobber the other
        await Promise.all([
            setTaskState('TASK-001', 'done'),
            setTaskState('TASK-002', 'doing'),
        ]);

        // Both updates should be preserved (no lost update)
        expect(todoContent).toContain('TASK-001: done');
        expect(todoContent).toContain('TASK-002: doing');
    });
});
