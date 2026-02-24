/**
 * Secrets Vault — safe secret loading and redaction.
 * Prevents API keys and tokens from leaking into logs, agent output,
 * or error messages.
 *
 * Sprint 16 — Audit item #10.
 */

import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SecretEntry {
    name: string;
    value: string;
    /** Redacted form shown in logs */
    redacted: string;
}

// ── State ──────────────────────────────────────────────────────────────────

const vault = new Map<string, SecretEntry>();

/** @internal — for testing */
export function _resetVault(): void {
    vault.clear();
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Redact a secret value for safe display.
 * Shows first 4 chars + "***" or "***" if too short.
 */
export function redactValue(value: string): string {
    if (!value || value.length < 6) return '***';
    return `${value.slice(0, 4)}***`;
}

/**
 * Load a secret from environment variables.
 * Returns the value or undefined if not set.
 */
export function loadSecret(name: string): string | undefined {
    const value = (process.env[name] || '').trim();
    if (!value) return undefined;

    vault.set(name, {
        name,
        value,
        redacted: redactValue(value),
    });

    return value;
}

/**
 * Load multiple secrets from environment.
 * Returns a map of name → value. Logs which secrets are present/missing.
 */
export function loadSecrets(names: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    const present: string[] = [];
    const missing: string[] = [];

    for (const name of names) {
        const value = loadSecret(name);
        if (value) {
            result[name] = value;
            present.push(name);
        } else {
            missing.push(name);
        }
    }

    if (present.length > 0) {
        const safe = present.map((n) => `${n}=${vault.get(n)?.redacted}`).join(', ');
        logger.info({ count: present.length }, `Secrets loaded: ${safe}`);
    }
    if (missing.length > 0) {
        logger.warn({ missing }, `Missing secrets: ${missing.join(', ')}`);
    }

    return result;
}

/**
 * Get a secret value by name. Returns undefined if not loaded.
 */
export function getSecret(name: string): string | undefined {
    return vault.get(name)?.value;
}

/**
 * Check if a secret is loaded.
 */
export function hasSecret(name: string): boolean {
    return vault.has(name);
}

/**
 * Redact all known secret values from a text string.
 * Replaces any occurrence of a secret value with its redacted form.
 * Use this to sanitize agent output, error messages, and log data.
 */
export function redactSecrets(text: string): string {
    if (!text || vault.size === 0) return text;

    let result = text;
    for (const entry of vault.values()) {
        if (entry.value.length < 6) continue; // Skip tiny values (may cause false positives)
        // Use split+join for safety (no regex escaping needed)
        result = result.split(entry.value).join(entry.redacted);
    }
    return result;
}

/**
 * Get a summary of loaded secrets (names + redacted values).
 * Safe for logging.
 */
export function getVaultSummary(): Array<{ name: string; redacted: string }> {
    return [...vault.values()].map(({ name, redacted }) => ({ name, redacted }));
}

// ── Well-known secret names ────────────────────────────────────────────────

/** Common secret env var names used by the system */
export const KNOWN_SECRETS = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ZONE_ID',
    'GITHUB_TOKEN',
    'WHATSAPP_SESSION_TOKEN',
    'TELEGRAM_BOT_TOKEN',
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
] as const;
