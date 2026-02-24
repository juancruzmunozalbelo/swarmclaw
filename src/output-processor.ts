/**
 * Output Processor — agent output validation, deploy claim checks, and critic review.
 * Extracted from index.ts during Sprint 1 decomposition.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, SWARM_STRICT_MODE } from './config.js';
import { parseStageContract } from './swarm-workflow.js';

export function isDatabaseConfigured(): boolean {
    try {
        if (String(process.env.DATABASE_URL || '').trim()) return true;
        const envPath = path.join(process.cwd(), '.env');
        if (!fs.existsSync(envPath)) return false;
        const raw = fs.readFileSync(envPath, 'utf-8');
        return /^\s*DATABASE_URL\s*=\s*.+$/m.test(raw);
    } catch {
        return false;
    }
}

export function isCloudflareConfigured(): boolean {
    return Boolean(
        String(process.env.CLOUDFLARE_API_TOKEN || '').trim() &&
        String(process.env.CLOUDFLARE_ZONE_ID || '').trim() &&
        String(process.env.CLOUDFLARE_ZONE_NAME || '').trim() &&
        String(process.env.CLOUDFLARE_TUNNEL_TARGET || '').trim(),
    );
}

export function resolveContainerPath(p: string, groupFolder: string): string {
    // Map container-internal paths to host paths
    // /workspace/group/src/api.ts → groups/main/src/api.ts
    if (p.startsWith('/workspace/group/')) {
        return path.join(GROUPS_DIR, groupFolder, p.slice('/workspace/group/'.length));
    }
    // /workspace/project/src/api.ts → <cwd>/src/api.ts
    if (p.startsWith('/workspace/project/')) {
        return path.join(process.cwd(), p.slice('/workspace/project/'.length));
    }
    // /workspace/ generic fallback
    if (p.startsWith('/workspace/')) {
        return path.join(GROUPS_DIR, groupFolder, p.slice('/workspace/'.length));
    }
    return p;
}

export function parseContractFileHints(groupFolder: string, archivosText: string): string[] {
    const raw = String(archivosText || '').trim();
    if (!raw || raw.toLowerCase() === 'n/a') return [];
    const parts = raw
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 20);
    const out: string[] = [];
    for (const p of parts) {
        // First try to resolve container-internal paths
        const resolved = resolveContainerPath(p, groupFolder);
        if (resolved !== p) {
            // Was a container path — only add the resolved host path
            out.push(resolved);
            continue;
        }
        if (path.isAbsolute(p)) {
            out.push(p);
            continue;
        }
        out.push(path.join(process.cwd(), p));
        out.push(path.join(GROUPS_DIR, groupFolder, p));
    }
    return [...new Set(out)];
}

export function runCriticReview(params: {
    groupFolder: string;
    stage: string;
    taskIds: string[];
    parsedContract: ReturnType<typeof parseStageContract> | null;
    rawText: string;
    pendingTodoIdsForEpic: (groupFolder: string, taskId: string) => string[];
}): { ok: boolean; findings: string[]; evidenceFiles: string[] } {
    const findings: string[] = [];
    const stage = String(params.stage || '').toUpperCase();
    const parsed = params.parsedContract;
    const evidenceCandidates = parseContractFileHints(
        params.groupFolder,
        parsed?.archivos || 'n/a',
    );
    const evidenceFiles = evidenceCandidates.filter((p) => {
        try {
            return fs.existsSync(p);
        } catch {
            return false;
        }
    });

    if ((stage === 'DEV' || stage === 'QA' || stage === 'DONE') && evidenceFiles.length === 0) {
        findings.push('no artifact files found from ARCHIVOS');
    }
    const text = String(params.rawText || '');
    const hasTestEvidence =
        /(npm run test|vitest|jest|playwright|cypress|build ok|qa passed|http 200|curl\s+-s)/i.test(text);
    if (stage === 'QA' && !hasTestEvidence) {
        findings.push('QA output missing reproducible test evidence');
    }
    if (params.taskIds.length > 0 && stage === 'DONE') {
        for (const taskId of params.taskIds) {
            const pending = params.pendingTodoIdsForEpic(params.groupFolder, taskId);
            if (pending.length > 0) {
                findings.push(`DONE declared with pending subtasks for ${taskId}`);
                break;
            }
        }
    }
    return { ok: findings.length === 0, findings, evidenceFiles };
}

export async function validateDeployClaim(text: string): Promise<{
    checked: boolean;
    ok: boolean;
    reason?: string;
}> {
    const { extractStatusField, isLocalOnlyUrl } = await import('./agent-output-validation.js');
    const status = extractStatusField(text, 'STATUS').toLowerCase();
    if (status !== 'deployed') return { checked: false, ok: true };

    const urlPublic = extractStatusField(text, 'URL_PUBLIC');
    const url = extractStatusField(text, 'URL');
    if (!urlPublic) {
        return { checked: true, ok: false, reason: 'missing URL_PUBLIC in deployed status' };
    }
    if (isLocalOnlyUrl(urlPublic)) {
        return { checked: true, ok: false, reason: `local-only URL_PUBLIC is not valid (${urlPublic})` };
    }
    if (url && isLocalOnlyUrl(url)) {
        return { checked: true, ok: false, reason: `local-only URL is not valid in deployed status (${url})` };
    }
    const requiredPublicSuffix = String(
        process.env.DEPLOY_REQUIRED_PUBLIC_SUFFIX ||
        process.env.CLOUDFLARE_ZONE_NAME ||
        '',
    )
        .trim()
        .toLowerCase();
    if (requiredPublicSuffix && SWARM_STRICT_MODE) {
        let host = '';
        try {
            const normalized = /^https?:\/\//i.test(urlPublic) ? urlPublic : `https://${urlPublic}`;
            host = String(new URL(normalized).hostname || '').toLowerCase();
        } catch {
            host = '';
        }
        if (!host || (!host.endsWith(`.${requiredPublicSuffix}`) && host !== requiredPublicSuffix)) {
            return {
                checked: true,
                ok: false,
                reason: `URL_PUBLIC must be subdomain of ${requiredPublicSuffix} (got: ${urlPublic})`,
            };
        }
    }

    const db = extractStatusField(text, 'DB').toLowerCase();
    if (db) {
        if (/(degrad|none|sin postgresql|no postgresql|db=none|unavailable|not available|error)/i.test(db)) {
            return { checked: true, ok: false, reason: `database reported degraded state (${db})` };
        }
        if (/@localhost\b|localhost:5432/.test(db)) {
            return { checked: true, ok: false, reason: `database host is localhost inside runtime (${db})` };
        }
    }

    const checkPublic = extractStatusField(text, 'CHECK_PUBLIC').toLowerCase();
    const checkPublicOk = checkPublic === 'ok' || (!SWARM_STRICT_MODE && /^2\d\d$/.test(checkPublic));
    if (!checkPublicOk) {
        return { checked: true, ok: false, reason: `CHECK_PUBLIC must be ok (got: ${checkPublic || 'missing'})` };
    }
    const checkContent = extractStatusField(text, 'CHECK_CONTENT').toLowerCase();
    if (checkContent !== 'ok') {
        return { checked: true, ok: false, reason: `CHECK_CONTENT must be ok (got: ${checkContent || 'missing'})` };
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(urlPublic, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': 'nanoclaw-runtime/1.0' },
        });
        clearTimeout(timer);
        if (!resp.ok) {
            return { checked: true, ok: false, reason: `public URL check failed: HTTP ${resp.status}` };
        }
        const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html')) {
            const body = await resp.text();
            if (/(welcome to sveltekit|svelte\.dev\/docs\/kit)/i.test(body)) {
                return { checked: true, ok: false, reason: 'public URL serves SvelteKit starter template' };
            }
        }
    } catch (err: unknown) {
        return {
            checked: true,
            ok: false,
            reason: `URL_PUBLIC is not reachable (${err instanceof Error ? err.message : String(err)})`,
        };
    }

    return { checked: true, ok: true };
}
