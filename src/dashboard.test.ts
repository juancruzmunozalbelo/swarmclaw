import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'http';

vi.mock('./config.js', () => ({
    GROUPS_DIR: '/tmp/test-groups',
    MAIN_GROUP_FOLDER: 'main',
}));
vi.mock('./logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('./swarm-workflow.js', () => ({
    loadWorkflowState: vi.fn(() => ({ version: 1, updatedAt: '', tasks: {} })),
}));
vi.mock('./runtime-metrics.js', () => ({
    readRuntimeMetrics: vi.fn(() => ({ totalRuns: 5, totalErrors: 1 })),
}));
vi.mock('./lane-state.js', () => ({
    loadLaneState: vi.fn(() => ({})),
}));

import { startDashboard } from './dashboard.js';

function fetch(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        }).on('error', reject);
    });
}

describe('dashboard', () => {
    let server: http.Server;
    const PORT = 19876;

    afterEach(() => {
        if (server) server.close();
    });

    it('serves HTML dashboard on /', async () => {
        server = startDashboard({ port: PORT, registeredGroups: () => ({}) });
        await new Promise((r) => setTimeout(r, 100));
        const res = await fetch(`http://localhost:${PORT}/`);
        expect(res.status).toBe(200);
        expect(res.body).toContain('NanoClaw Dashboard');
    });

    it('returns groups via /api/groups', async () => {
        server = startDashboard({
            port: PORT + 1,
            registeredGroups: () => ({ 'jid1': { name: 'Test Group', folder: 'main' } }),
        });
        await new Promise((r) => setTimeout(r, 100));
        const res = await fetch(`http://localhost:${PORT + 1}/api/groups`);
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.groups).toHaveLength(1);
        expect(data.groups[0].name).toBe('Test Group');
    });

    it('returns health on /health', async () => {
        server = startDashboard({ port: PORT + 2, registeredGroups: () => ({}) });
        await new Promise((r) => setTimeout(r, 100));
        const res = await fetch(`http://localhost:${PORT + 2}/health`);
        const data = JSON.parse(res.body);
        expect(data.ok).toBe(true);
        expect(data.uptime).toBeGreaterThan(0);
    });

    it('returns 404 for unknown routes', async () => {
        server = startDashboard({ port: PORT + 3, registeredGroups: () => ({}) });
        await new Promise((r) => setTimeout(r, 100));
        const res = await fetch(`http://localhost:${PORT + 3}/unknown`);
        expect(res.status).toBe(404);
    });
});
