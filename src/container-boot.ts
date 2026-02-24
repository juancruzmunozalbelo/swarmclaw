/**
 * Container Boot — ensures Apple Container system is running
 * and cleans up orphaned containers from previous runs.
 * Extracted from index.ts during Sprint 10 decomposition.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

/**
 * Ensure Apple Container system is running.
 * Starts it if needed, and cleans up orphaned NanoClaw agent containers.
 * Throws if the container system cannot start.
 */
export function ensureContainerSystemRunning(): void {
    try {
        execSync('container system status', { stdio: 'pipe' });
        logger.debug('Apple Container system already running');
    } catch {
        logger.info('Starting Apple Container system...');
        try {
            execSync('container system start', { stdio: 'pipe', timeout: 30000 });
            logger.info('Apple Container system started');
        } catch (err) {
            logger.error({ err }, 'Failed to start Apple Container system');
            console.error(
                '\n╔════════════════════════════════════════════════════════════════╗',
            );
            console.error(
                '║  FATAL: Apple Container system failed to start                 ║',
            );
            console.error(
                '║                                                                ║',
            );
            console.error(
                '║  Agents cannot run without Apple Container. To fix:           ║',
            );
            console.error(
                '║  1. Install from: https://github.com/apple/container/releases ║',
            );
            console.error(
                '║  2. Run: container system start                               ║',
            );
            console.error(
                '║  3. Restart NanoClaw                                          ║',
            );
            console.error(
                '╚════════════════════════════════════════════════════════════════╝\n',
            );
            throw new Error('Apple Container system is required but failed to start');
        }
    }

    // Kill and clean up orphaned NanoClaw containers from previous runs
    try {
        const output = execSync('container ls --format json', {
            stdio: ['pipe', 'pipe', 'pipe'],
            encoding: 'utf-8',
        });
        const containers: {
            status: string;
            configuration: { id: string; image?: { reference?: string } };
        }[] = JSON.parse(output || '[]');
        const orphans = containers
            .filter((c) => {
                if (c.status !== 'running') return false;
                const id = c?.configuration?.id || '';
                const imageRef = c?.configuration?.image?.reference || '';
                return id.startsWith('nanoclaw-') && imageRef.includes('nanoclaw-agent');
            })
            .map((c) => c.configuration.id);
        for (const name of orphans) {
            try {
                execSync(`container stop ${name}`, { stdio: 'pipe', timeout: 8000 });
            } catch {
                try {
                    execSync(`container kill ${name}`, { stdio: 'pipe', timeout: 5000 });
                } catch {
                    // ignore
                }
            }
        }
        if (orphans.length > 0) {
            logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers');
        }
    } catch (err) {
        logger.warn({ err }, 'Failed to clean up orphaned containers');
    }
}
