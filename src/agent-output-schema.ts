/**
 * Agent Output Schema — Zod-based structured validation for agent output.
 * Replaces brittle regex parsing with typed, composable schemas.
 *
 * Sprint 2 — Audit item #3.
 */

import { z } from 'zod';

// ── Stage Contract Schema ──────────────────────────────────────────────────

/** Normalize stage aliases to canonical names. */
function normalizeStage(raw: string): string {
    const upper = String(raw || '').trim().toUpperCase();
    if (upper === 'COMPLETED') return 'DONE';
    if (upper === 'DEVELOPMENT') return 'DEV';
    if (upper === 'TESTING') return 'QA';
    if (upper === 'ARCHITECTURE') return 'ARQ';
    return upper;
}

export const StageContractSchema = z.object({
    etapa: z.string().transform(normalizeStage),
    item: z.string().min(1),
    archivos: z.union([z.string(), z.array(z.string())]).transform((v) =>
        Array.isArray(v) ? v.join(', ') : v,
    ),
    siguiente: z.string().min(1),
    tdd_tipo: z.string().optional(),
    tdd_red: z.string().optional(),
    tdd_green: z.string().optional(),
    tdd_refactor: z.string().optional(),
    swarmlog: z.string().optional(),
}).strict().catch((ctx) => ctx.input as unknown as { etapa: string; item: string; archivos: string; siguiente: string; tdd_tipo?: string; tdd_red?: string; tdd_green?: string; tdd_refactor?: string; swarmlog?: string });

export type StageContract = z.infer<typeof StageContractSchema>;

// ── Full Agent Output Schema ───────────────────────────────────────────────

export const AgentOutputSchema = z.object({
    etapa: z.string().transform(normalizeStage),
    item: z.string().min(1),
    archivos: z.union([z.string(), z.array(z.string())]).transform((v) =>
        Array.isArray(v) ? v.join(', ') : v,
    ),
    siguiente: z.string().min(1),
    tdd_tipo: z.string().optional(),
    tdd_red: z.string().optional(),
    tdd_green: z.string().optional(),
    tdd_refactor: z.string().optional(),
    swarmlog: z.string().optional(),
    // Deploy claims
    status: z.string().optional(),
    url_public: z.string().optional(),
    port: z.string().optional(),
    process: z.string().optional(),
    db: z.string().optional(),
    check_local: z.string().optional(),
    check_public: z.string().optional(),
    check_content: z.string().optional(),
    last_log: z.string().optional(),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// ── Text → Structured Parser ───────────────────────────────────────────────

/**
 * Extract a key=value field from freeform agent text.
 * Returns empty string if not found.
 */
function extractField(text: string, key: string): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
        `(?:^|\\n)\\s*(?:\\*{1,2})?${escaped}(?:\\*{1,2})?\\s*[=:]\\s*([^\\n]+)`,
        'i',
    );
    const m = String(text || '').match(re);
    if (!m?.[1]) return '';
    return String(m[1]).replace(/\*+/g, '').trim();
}

/**
 * Try to extract structured JSON block from agent text.
 * Agents may emit: `JSONPROMPT: {"etapa":"DEV",...}`
 */
function extractJsonBlock(text: string): Record<string, unknown> | null {
    const m = String(text || '').match(/JSONPROMPT\s*:\s*(\{[\s\S]*?\})/);
    if (!m?.[1]) return null;
    try {
        return JSON.parse(m[1]);
    } catch {
        return null;
    }
}

/**
 * Parse agent output text into a structured object.
 * Tries JSON extraction first, falls back to regex field extraction.
 *
 * Returns `{ ok, data, errors }`:
 * - `ok: true` + `data` when Zod validation passes
 * - `ok: false` + `errors` when validation fails (with partial data from regex)
 */
export function parseAgentOutput(text: string): {
    ok: boolean;
    data: Partial<AgentOutput> | null;
    errors: string[];
    source: 'json' | 'regex' | 'none';
} {
    const t = String(text || '');
    if (!t.trim()) {
        return { ok: false, data: null, errors: ['empty input'], source: 'none' };
    }

    // 1. Try JSON extraction
    const jsonBlock = extractJsonBlock(t);
    if (jsonBlock) {
        const result = AgentOutputSchema.safeParse(jsonBlock);
        if (result.success) {
            return { ok: true, data: result.data, errors: [], source: 'json' };
        }
        // JSON found but didn't validate — fall through to regex
    }

    // 2. Regex fallback: extract known fields
    const fields: Record<string, string> = {};
    const keys = [
        'ETAPA', 'ITEM', 'ARCHIVOS', 'SIGUIENTE',
        'TDD_TIPO', 'TDD_RED', 'TDD_GREEN', 'TDD_REFACTOR',
        'SWARMLOG',
        'STATUS', 'URL_PUBLIC', 'PORT', 'PROCESS', 'DB',
        'CHECK_LOCAL', 'CHECK_PUBLIC', 'CHECK_CONTENT', 'LAST_LOG',
    ];

    for (const key of keys) {
        const val = extractField(t, key);
        if (val) fields[key.toLowerCase()] = val;
    }

    if (!fields.etapa) {
        return { ok: false, data: null, errors: ['no ETAPA field found'], source: 'none' };
    }

    const result = AgentOutputSchema.safeParse(fields);
    if (result.success) {
        return { ok: true, data: result.data, errors: [], source: 'regex' };
    }

    // Partial parse — still useful for consumers
    const errors = result.error?.issues?.map((i) => `${i.path.join('.')}: ${i.message}`) || ['unknown validation error'];
    return { ok: false, data: fields as Partial<AgentOutput>, errors, source: 'regex' };
}

// ── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Validate that a parsed agent output has the required TDD fields
 * (only for non-BLOCKED stages with done claims).
 */
export function validateTddFields(data: Partial<AgentOutput>): {
    ok: boolean;
    missing: string[];
} {
    const stage = String(data.etapa || '').toUpperCase();
    if (stage === 'BLOCKED' || stage === 'TEAMLEAD') {
        return { ok: true, missing: [] };
    }

    const missing: string[] = [];
    if (!data.tdd_tipo) missing.push('TDD_TIPO');
    if (!data.tdd_red) missing.push('TDD_RED');
    if (!data.tdd_green) missing.push('TDD_GREEN');
    if (!data.tdd_refactor) missing.push('TDD_REFACTOR');

    return { ok: missing.length === 0, missing };
}

/**
 * Validate deploy-related fields when STATUS is present.
 */
export function validateDeployFields(data: Partial<AgentOutput>): {
    ok: boolean;
    missing: string[];
} {
    if (!data.status) return { ok: true, missing: [] };

    const required = ['url_public', 'port', 'process', 'db', 'check_local', 'check_public', 'check_content', 'last_log'];
    const missing = required.filter((k) => !data[k as keyof AgentOutput]);
    return { ok: missing.length === 0, missing };
}
