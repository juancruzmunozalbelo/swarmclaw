export function extractStatusField(text: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:\\*{1,2})?${escaped}(?:\\*{1,2})?\\s*=\\s*([^\\n]+)`,
    'i',
  );
  const m = String(text || '').match(re);
  if (!m?.[1]) return '';
  return String(m[1]).replace(/\*+/g, '').trim();
}

export function isLocalOnlyUrl(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return true;
  const normalized = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const u = new URL(normalized);
    const host = String(u.hostname || '').toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
  } catch {
    return /(?:^|\/\/)(127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(raw);
  }
}

export function validateStatusLineContract(text: string): {
  checked: boolean;
  ok: boolean;
  reason?: string;
} {
  const status = extractStatusField(text, 'STATUS').toLowerCase();
  if (!status) return { checked: false, ok: true };

  const required = [
    'URL_PUBLIC',
    'PORT',
    'PROCESS',
    'DB',
    'CHECK_LOCAL',
    'CHECK_PUBLIC',
    'CHECK_CONTENT',
    'LAST_LOG',
  ];
  const missing = required.filter((k) => !extractStatusField(text, k));
  if (missing.length > 0) {
    return {
      checked: true,
      ok: false,
      reason: `missing status fields: ${missing.join(', ')}`,
    };
  }

  const urlPublic = extractStatusField(text, 'URL_PUBLIC');
  if (status === 'deployed' && isLocalOnlyUrl(urlPublic)) {
    return {
      checked: true,
      ok: false,
      reason: `URL_PUBLIC cannot be local-only (${urlPublic})`,
    };
  }
  return { checked: true, ok: true };
}

export function validateRuntimeStatusClaims(
  text: string,
  databaseConfigured: boolean,
): {
  checked: boolean;
  ok: boolean;
  reason?: string;
} {
  const t = String(text || '');
  if (!t.trim()) return { checked: false, ok: true };

  if (
    databaseConfigured &&
    /(?:\b(pendiente|pending)\b[\s\S]{0,140})?(requiere|requieren|requires)\s+db\b/i.test(t)
  ) {
    return {
      checked: true,
      ok: false,
      reason: 'reported "requires DB" but runtime has DATABASE_URL',
    };
  }
  if (/\bserver\s*:\s*✅?\s*https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(t)) {
    return {
      checked: true,
      ok: false,
      reason: 'reported local-only server URL in user-facing status',
    };
  }
  return { checked: false, ok: true };
}

export function validateCloudflareDeployClaims(
  text: string,
  cloudflareConfigured: boolean,
): {
  checked: boolean;
  ok: boolean;
  reason?: string;
} {
  const t = String(text || '');
  if (!t.trim() || !cloudflareConfigured) return { checked: false, ok: true };

  const status = extractStatusField(t, 'STATUS').toLowerCase();
  if (!status) return { checked: false, ok: true };

  const lastLog = extractStatusField(t, 'LAST_LOG').toLowerCase();
  const mentionsQuickTunnel = /quick\s*tunnel|trycloudflare/.test(`${t.toLowerCase()} ${lastLog}`);
  const asksTunnelToken = /tunnel[_\s-]*token|token\s+for\s+named\s+tunnel/.test(`${t.toLowerCase()} ${lastLog}`);

  if (status === 'blocked' && (mentionsQuickTunnel || asksTunnelToken)) {
    return {
      checked: true,
      ok: false,
      reason:
        'invalid deploy diagnosis: quick tunnel/TUNNEL_TOKEN is not allowed when CLOUDFLARE_* env is configured',
    };
  }

  return { checked: false, ok: true };
}

export function validateDoneEvidenceClaims(text: string): {
  checked: boolean;
  ok: boolean;
  reason?: string;
} {
  const t = String(text || '');
  const doneIds = [...t.matchAll(/\b([A-Z]{2,16}-\d{3})\b[^\n]*✅/g)].map((m) => m[1]);
  if (doneIds.length === 0) return { checked: false, ok: true };

  // Require explicit command/result evidence whenever a completion claim is emitted.
  const hasCommand = /\b(COMANDO|COMMAND|CMD)\s*:\s*.+/i.test(t);
  const hasResult = /\b(RESULTADO|RESULT)\s*:\s*.+/i.test(t);
  const hasFileEvidence = /\/workspace\/group\/|groups\/main\//i.test(t);
  if (!hasCommand || !hasResult || !hasFileEvidence) {
    return {
      checked: true,
      ok: false,
      reason: `done claims without required evidence (file+command+result) for ${doneIds.slice(0, 8).join(', ')}`,
    };
  }
  return { checked: true, ok: true };
}

export function validateUniversalTddClaims(text: string): {
  checked: boolean;
  ok: boolean;
  reason?: string;
} {
  const t = String(text || '');
  const doneIds = [...t.matchAll(/\b([A-Z]{2,16}-\d{3})\b[^\n]*✅/g)].map((m) => m[1]);
  if (doneIds.length === 0) return { checked: false, ok: true };

  const hasType = /\b(TDD_TIPO|TDD_TYPE|TDD)\s*:\s*.+/i.test(t);
  const hasRed = /\b(TDD_RED|RED)\s*:\s*.+/i.test(t);
  const hasGreen = /\b(TDD_GREEN|GREEN)\s*:\s*.+/i.test(t);
  const hasRefactor = /\b(TDD_REFACTOR|REFACTOR)\s*:\s*.+/i.test(t);

  const missing: string[] = [];
  if (!hasType) missing.push('TDD_TIPO');
  if (!hasRed) missing.push('TDD_RED');
  if (!hasGreen) missing.push('TDD_GREEN');
  if (!hasRefactor) missing.push('TDD_REFACTOR');

  if (missing.length > 0) {
    return {
      checked: true,
      ok: false,
      reason: `done claims without TDD cycle (${missing.join(', ')}) for ${doneIds.slice(0, 8).join(', ')}`,
    };
  }
  return { checked: true, ok: true };
}
