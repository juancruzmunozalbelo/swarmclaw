/**
 * Mount Security Tests — validateMount, validateAdditionalMounts, loadMountAllowlist.
 *
 * Tests cover:
 *   - Blocked patterns (SSH, credentials, secrets)
 *   - Container path validation (traversal, absolute, empty)
 *   - Allowed roots + readonly enforcement
 *   - Non-main group read-only forcing
 *   - Missing allowlist blocks all mounts
 *   - Invalid allowlist structure detection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('./config.js', () => ({
    MOUNT_ALLOWLIST_PATH: '/tmp/mount-test/mount-allowlist.json',
}));

import { loadMountAllowlist, validateMount, validateAdditionalMounts } from './mount-security.js';

// ── Helpers ───────────────────────────────────────────────────────────

const ALLOWLIST_PATH = '/tmp/mount-test/mount-allowlist.json';
const TEST_DIR = '/tmp/mount-test';
const PROJECTS_DIR = path.join(TEST_DIR, 'projects');
const SECRET_DIR = path.join(TEST_DIR, '.ssh');

function writeAllowlist(allowlist: {
    allowedRoots: Array<{ path: string; allowReadWrite: boolean; description?: string }>;
    blockedPatterns: string[];
    nonMainReadOnly: boolean;
}) {
    fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
    fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(allowlist));
}

function setupTestDirs() {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    fs.mkdirSync(SECRET_DIR, { recursive: true });
    fs.mkdirSync(path.join(PROJECTS_DIR, 'my-app'), { recursive: true });
}

function cleanTestDirs() {
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('mount-security', () => {
    beforeEach(async () => {
        cleanTestDirs();
        setupTestDirs();
        // Reset the cached allowlist between tests by re-importing the module
        vi.resetModules();
    });

    describe('loadMountAllowlist', () => {
        it('returns null when no allowlist file exists', async () => {
            const mod = await import('./mount-security.js');
            const result = mod.loadMountAllowlist();
            expect(result).toBeNull();
        });

        it('loads valid allowlist', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: ['custom-secret'],
                nonMainReadOnly: true,
            });
            const mod = await import('./mount-security.js');
            const result = mod.loadMountAllowlist();
            expect(result).not.toBeNull();
            expect(result!.allowedRoots).toHaveLength(1);
            // Should merge with default blocked patterns
            expect(result!.blockedPatterns).toContain('.ssh');
            expect(result!.blockedPatterns).toContain('custom-secret');
        });

        it('returns null for invalid JSON', async () => {
            fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
            fs.writeFileSync(ALLOWLIST_PATH, 'not valid json!!!');
            const mod = await import('./mount-security.js');
            const result = mod.loadMountAllowlist();
            expect(result).toBeNull();
        });

        it('returns null for missing required fields', async () => {
            fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true });
            fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify({ allowedRoots: 'not-array' }));
            const mod = await import('./mount-security.js');
            const result = mod.loadMountAllowlist();
            expect(result).toBeNull();
        });
    });

    describe('validateMount', () => {
        it('blocks all mounts when no allowlist exists', async () => {
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: PROJECTS_DIR, readonly: true },
                true,
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('No mount allowlist');
        });

        it('allows a mount under an allowed root', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: path.join(PROJECTS_DIR, 'my-app'), containerPath: 'my-app', readonly: true },
                true,
            );
            expect(result.allowed).toBe(true);
            expect(result.effectiveReadonly).toBe(true);
        });

        it('blocks mount with path traversal in container path', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: PROJECTS_DIR, containerPath: '../../../etc', readonly: true },
                true,
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('..');
        });

        it('blocks mount with absolute container path', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: PROJECTS_DIR, containerPath: '/etc/passwd', readonly: true },
                true,
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('Invalid container path');
        });

        it('blocks .ssh directory via default blocked patterns', async () => {
            writeAllowlist({
                allowedRoots: [{ path: TEST_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: SECRET_DIR, containerPath: 'ssh', readonly: true },
                true,
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('.ssh');
        });

        it('blocks path not under any allowed root', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: '/tmp', containerPath: 'tmp', readonly: true },
                true,
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('not under any allowed root');
        });

        it('blocks non-existent host path', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: '/nonexistent/path/xyz', containerPath: 'xyz', readonly: true },
                true,
            );
            expect(result.allowed).toBe(false);
            expect(result.reason).toContain('does not exist');
        });

        it('forces non-main group to read-only when nonMainReadOnly=true', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: true,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: path.join(PROJECTS_DIR, 'my-app'), containerPath: 'my-app', readonly: false },
                false, // non-main
            );
            expect(result.allowed).toBe(true);
            expect(result.effectiveReadonly).toBe(true);
        });

        it('allows main group read-write when root allows it', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: true,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: path.join(PROJECTS_DIR, 'my-app'), containerPath: 'my-app', readonly: false },
                true, // main
            );
            expect(result.allowed).toBe(true);
            expect(result.effectiveReadonly).toBe(false);
        });

        it('forces readonly when root has allowReadWrite=false', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: false }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const result = mod.validateMount(
                { hostPath: path.join(PROJECTS_DIR, 'my-app'), containerPath: 'my-app', readonly: false },
                true,
            );
            expect(result.allowed).toBe(true);
            expect(result.effectiveReadonly).toBe(true);
        });
    });

    describe('validateAdditionalMounts', () => {
        it('filters out rejected mounts and returns only valid ones', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const results = mod.validateAdditionalMounts(
                [
                    { hostPath: path.join(PROJECTS_DIR, 'my-app'), containerPath: 'my-app', readonly: true },
                    { hostPath: '/nonexistent', containerPath: 'bad', readonly: true },
                    { hostPath: SECRET_DIR, containerPath: 'ssh', readonly: true },
                ],
                'test-group',
                true,
            );
            expect(results).toHaveLength(1);
            expect(results[0].containerPath).toBe('/workspace/extra/my-app');
        });

        it('returns empty array when all mounts rejected', async () => {
            writeAllowlist({
                allowedRoots: [{ path: PROJECTS_DIR, allowReadWrite: true }],
                blockedPatterns: [],
                nonMainReadOnly: false,
            });
            const mod = await import('./mount-security.js');
            const results = mod.validateAdditionalMounts(
                [
                    { hostPath: '/nonexistent1', containerPath: 'a', readonly: true },
                    { hostPath: '/nonexistent2', containerPath: 'b', readonly: true },
                ],
                'test-group',
                true,
            );
            expect(results).toHaveLength(0);
        });
    });
});
