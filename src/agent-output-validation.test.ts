import { describe, expect, it } from 'vitest';

import {
  isLocalOnlyUrl,
  validateDoneEvidenceClaims,
  validateRuntimeStatusClaims,
  validateStatusLineContract,
  validateUniversalTddClaims,
} from './agent-output-validation.js';

describe('agent output validation', () => {
  it('detects local-only urls', () => {
    expect(isLocalOnlyUrl('http://127.0.0.1:5173')).toBe(true);
    expect(isLocalOnlyUrl('localhost:3000')).toBe(true);
    expect(isLocalOnlyUrl('https://shop.example.com')).toBe(false);
  });

  it('requires strict status fields', () => {
    const bad = 'STATUS=deployed URL_PUBLIC=https://x.trycloudflare.com PORT=5173';
    const res = validateStatusLineContract(bad);
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(false);
  });

  it('accepts strict status line when all required fields are present', () => {
    const good = [
      'STATUS=deployed',
      'URL_PUBLIC=https://demo.example.com',
      'PORT=5173',
      'PROCESS=npm run dev -- --port 5173',
      'DB=ok',
      'CHECK_LOCAL=ok',
      'CHECK_PUBLIC=200',
      'CHECK_CONTENT=ok',
      'LAST_LOG=ready',
    ].join('\n');
    const res = validateStatusLineContract(good);
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(true);
  });

  it('rejects false DB blockers when DB is configured', () => {
    const txt = 'Pendientes (requieren DB): PROD-012';
    const res = validateRuntimeStatusClaims(txt, true);
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(false);
  });

  it('requires evidence for done task claims', () => {
    const txt = 'PROD-010 tests ✅\nPROD-011 qa ✅';
    const res = validateDoneEvidenceClaims(txt);
    expect(res.checked).toBe(true);
    expect(res.ok).toBe(false);
  });

  it('requires universal TDD cycle for done task claims', () => {
    const bad = [
      'PROD-010 tests ✅',
      'COMANDO: npm run test',
      'RESULTADO: ok',
      'ARCHIVO: groups/main/todo.md',
      'TDD_TIPO: qa',
      'TDD_RED: test de regresion falla sin fix',
      'TDD_GREEN: fix aplicado + test pasa',
    ].join('\n');
    const badRes = validateUniversalTddClaims(bad);
    expect(badRes.checked).toBe(true);
    expect(badRes.ok).toBe(false);

    const good = `${bad}\nTDD_REFACTOR: limpieza de assertions duplicadas`;
    const goodRes = validateUniversalTddClaims(good);
    expect(goodRes.checked).toBe(true);
    expect(goodRes.ok).toBe(true);
  });
});
