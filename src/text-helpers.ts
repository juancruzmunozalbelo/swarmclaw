/**
 * Text Helpers — pure functions for text analysis and transformation.
 * Extracted from index.ts during Sprint 1 decomposition.
 * Zero dependencies on state or I/O.
 */
import type { WorkflowStage } from './swarm-workflow.js';
import type { NewMessage } from './types.js';

// Re-export type alias used widely
export type ExecutionTrack = 'frontend' | 'backend' | 'fullstack';

export function nowIso(): string {
  return new Date().toISOString();
}

export function inferStageHint(text: string): string {
  const t = (text || '').toLowerCase();
  if (/\b(team\s*lead|teamlead|team-lead|andy)\b/.test(t)) return 'TEAMLEAD';
  if (/\b(actua|actúa)\s+como\s+devops\b/.test(t) || /\bdevops\b/.test(t)) return 'DEVOPS';
  if (/\b(actua|actúa)\s+como\s+pm\b/.test(t) || /\bproject\s+manager\b/.test(t)) return 'PM';
  if (/\b(actua|actúa)\s+como\s+arq\b/.test(t) || /\barq\b/.test(t) || /\barquitecto\s+sr\b/.test(t)) return 'ARQ';
  if (/\b(actua|actúa)\s+como\s+ux\b/.test(t) || /\bux\/ui\b/.test(t) || /\bexperiencia\s+de\s+usuario\b/.test(t)) return 'UX';
  if (/\b(actua|actúa)\s+como\s+spec\b/.test(t) || /\barquitecto\b/.test(t) || /\bespecifica(cion|ción)\b/.test(t)) return 'SPEC';
  if (/\b(actua|actúa)\s+como\s+dev2\b/.test(t) || /\bdev-?2\b/.test(t) || /\bsegundo\s+dev\b/.test(t)) return 'DEV2';
  if (/\b(actua|actúa)\s+como\s+dev\b/.test(t) || /\bcodigo\b/.test(t)) return 'DEV';
  // QA first-tier: only explicit role assignment, NOT just mentioning "tests" in requirements
  if (/\b(actua|actúa)\s+como\s+qa\b/.test(t) || /\breporte\s+de\s+(qa|test)\b/.test(t)) return 'QA';
  // Heuristics for common work requests (so the dash moves without explicit stage lines).
  if (/\b(todo\.md|desglos|prioriz|plan|roadmap|tareas)\b/.test(t)) return 'PM';
  if (/\b(spec|requerimientos?|sdd|contrato)\b/.test(t)) return 'SPEC';
  if (/\b(landing|page|frontend|ui|css|html|react|vite|tailwind|pixi|phaser|ux)\b/.test(t)) return 'UX';
  if (/\b(dev2|dev-2|segundo dev)\b/.test(t)) return 'DEV2';
  if (/\b(backend|api rest|api\s+de|implementa|implementar|implementa codigo|refactor|codificar)\b/.test(t)) return 'DEV';
  // QA second-tier: only if the message is primarily about running/reviewing tests, NOT just listing test criteria
  if (/\b(vitest|jest|cypress|playwright|qa)\b/.test(t) || /\bcorre(r)?\s+(los\s+)?tests?\b/.test(t) || /\bregresion\b/.test(t)) return 'QA';
  if (/\b(deploy|deployment|puerto|port|subdominio|cloudflare|tunnel|dns|nginx|traefik|reverse\s*proxy|uptime|healthcheck|watchdog|reconnect|restart|infra|devops)\b/.test(t)) {
    return 'DEVOPS';
  }
  // Generic autopilot/run
  if (/\bswarmdev\b/.test(t) || /\bautopilot\b/.test(t) || /\bcopiloto\b/.test(t)) return 'TEAMLEAD';
  // Default: main should be orchestration-first.
  return 'TEAMLEAD';
}

export function stageFromAgentText(text: string): string | null {
  const t = (text || '').trim();
  if (!t) return null;

  // Prefer explicit machine-readable status lines.
  const m = t.match(/^\s*ETAPA:\s*(.+)\s*$/im);
  if (m) {
    const v = m[1].trim().toLowerCase();
    if (v.startsWith('teamlead') || v.startsWith('team-lead') || v.startsWith('lead')) return 'TEAMLEAD';
    if (v.startsWith('pm')) return 'PM';
    if (v.startsWith('arq') || v.startsWith('arquitect')) return 'ARQ';
    if (v.startsWith('ux')) return 'UX';
    if (v.startsWith('spec')) return 'SPEC';
    if (v.startsWith('dev2') || v.startsWith('dev-2')) return 'DEV2';
    if (v.startsWith('devops')) return 'DEVOPS';
    if (v.startsWith('dev')) return 'DEV';
    if (v.startsWith('qa')) return 'QA';
    if (v.startsWith('error')) return 'error';
    if (v.startsWith('idle')) return 'idle';
    return 'running';
  }

  // Heuristic fallback: look for stage tokens in the message.
  const lower = t.toLowerCase();
  if (/\betapa\s+team\s*lead\b/.test(lower) || /\betapa\s+teamlead\b/.test(lower)) return 'TEAMLEAD';
  if (/\betapa\s+pm\b/.test(lower) || /\bpm\b/.test(lower) && /tareas/.test(lower)) return 'PM';
  if (/\betapa\s+arq\b/.test(lower) || /\betapa\s+arquitect/.test(lower)) return 'ARQ';
  if (/\betapa\s+ux\b/.test(lower) || /\bux\b/.test(lower) && /(flujo|ui|diseno|diseño)/.test(lower)) return 'UX';
  if (/\betapa\s+spec\b/.test(lower) || /\bspec\b/.test(lower) && /espec/.test(lower)) return 'SPEC';
  if (/\betapa\s+dev2\b/.test(lower) || /\betapa\s+dev-2\b/.test(lower)) return 'DEV2';
  if (/\betapa\s+devops\b/.test(lower)) return 'DEVOPS';
  if (/\betapa\s+dev\b/.test(lower) || /\bdev\b/.test(lower) && /(implement|codigo|tests?)/.test(lower)) return 'DEV';
  if (/\betapa\s+qa\b/.test(lower) || /\bqa\b/.test(lower) && /tests?/.test(lower)) return 'QA';
  return null;
}

export function workflowStageFromRuntimeStage(stage: string): WorkflowStage | null {
  const s = (stage || '').trim().toUpperCase();
  if (s === 'TEAMLEAD' || s === 'PM' || s === 'SPEC' || s === 'DEV' || s === 'QA') {
    return s as WorkflowStage;
  }
  if (s === 'ARQ') return 'SPEC';
  if (s === 'UX' || s === 'DEV2') return 'DEV';
  if (s === 'ERROR') return 'BLOCKED';
  if (s === 'IDLE') return null;
  if (s === 'RUNNING') return null;
  return null;
}

export function extractSwarmlogObjects(text: string): Record<string, unknown>[] {
  // Allow multiple lines. Format:
  // SWARMLOG: {"action":"file_write","stage":"DEV","files":["..."],"detail":"..."}
  // (or without the colon)
  const out: Record<string, unknown>[] = [];
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^SWARMLOG\s*:?\s*(\{[\s\S]*\})\s*$/i);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch {
      // ignore malformed
    }
  }
  return out;
}

export function buildSwarmlogFallback(logs: Record<string, unknown>[]): string {
  const last = logs[logs.length - 1] || {};
  const stage = String(last.stage || '').trim().toUpperCase();
  const action = String(last.action || '').trim();
  const detail = String(last.detail || '').trim();
  const files = Array.isArray(last.files) ? last.files.filter(Boolean).map(String) : [];

  const parts: string[] = [];
  if (stage) parts.push(`ETAPA: ${stage}`);
  if (detail) parts.push(detail);
  else if (action) parts.push(`accion: ${action}`);
  if (files.length > 0) parts.push(`archivo: ${files[0]}`);

  if (parts.length === 0) return 'Actualizando estado de la tarea.';
  return parts.join(' | ');
}

export function sanitizeUserFacingText(text: string): { userText: string; logs: Record<string, unknown>[] } {
  const logs = extractSwarmlogObjects(text);
  const cleanedLines = String(text || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => !/^\s*SWARMLOG\s*:?\s*\{[\s\S]*\}\s*$/i.test(l));

  const userText = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { userText, logs };
}

export function stripAnnoyingClosers(text: string): string {
  let out = String(text || '').trim();

  // Remove standalone closers like "¿Algo más?" that add noise.
  const patterns = [
    /(?:^|\n)\s*¿\s*algo\s+m[aá]s\s*\?\s*(?:😊|😄|🙂|😉|🤖)?\s*(?=$|\n)/gi,
    /(?:^|\n)\s*algo\s+mas\s*\?\s*(?:😊|😄|🙂|😉|🤖)?\s*(?=$|\n)/gi,
    /(?:^|\n)\s*anything\s+else\s*\?\s*(?:😊|😄|🙂|😉|🤖)?\s*(?=$|\n)/gi,
    /(?:^|\n)\s*(?:\*{1,2}|_{1,2})?\s*¿\s*contin[uú]o(?:\s+con[\s\S]*?)?\?\s*(?:\*{1,2}|_{1,2})?\s*(?=$|\n)/gi,
    /(?:^|\n)\s*(?:\*{1,2}|_{1,2})?\s*contin[uú]o(?:\s+con[\s\S]*?)?\?\s*(?:\*{1,2}|_{1,2})?\s*(?=$|\n)/gi,
    /(?:^|\n)\s*(?:\*{1,2}|_{1,2})?\s*quer[eé]s\s+que\s+contin[uú]e(?:\s+con[\s\S]*?)?\?\s*(?:\*{1,2}|_{1,2})?\s*(?=$|\n)/gi,
    /(?:^|\n)\s*do\s+you\s+want\s+me\s+to\s+continue(?:\s+with[\s\S]*?)?\?\s*(?=$|\n)/gi,
  ];
  for (const re of patterns) out = out.replace(re, '\n');

  // Normalize extra blank lines after removals.
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

export function looksLikeContinueQuestion(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    /(?:\*{1,2}|_{1,2})?\s*¿\s*contin[uú]o/.test(t) ||
    /\bcontin[uú]o\s*\?/.test(t) ||
    /\b(iniciar|inicio|arranco|arrancar|prosigo|proseguir|seguir|avanzo|avanzar)\b[\s\S]{0,60}\?/.test(t) ||
    /¿\s*(iniciar|arranco|prosigo|avanzo)\b/.test(t) ||
    /\bquer[eé]s\s+que\s+contin[uú]e\b/.test(t) ||
    /\bdo\s+you\s+want\s+me\s+to\s+continue\b/.test(t)
  );
}

export function hasBlockingSignals(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    /\bbloquead|bloqueo|blocker|blocked|impediment|need decision|falta credencial|credencial|missing credential/.test(t)
  );
}

export function stripNonBlockingQuestions(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const l = String(line || '').trim();
    if (!l) {
      kept.push('');
      continue;
    }
    const isQuestion = l.includes('?') || l.includes('¿');
    const hasBlockSignal = hasBlockingSignals(l);
    if (isQuestion && !hasBlockSignal) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeScope(text: string): string {
  const raw = String(text || '');
  let cleaned = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_`>#-]+/g, ' ')
    .replace(/\b(ETAPA|ITEM|ARCHIVOS|SIGUIENTE|STATUS|URL_PUBLIC|CHECK_LOCAL|CHECK_PUBLIC|CHECK_CONTENT|LAST_LOG)\s*[:=]/gi, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/[•·▪◦●]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Keep first meaningful sentence/chunk only.
  const parts = cleaned
    .split(/[.!?;]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 16);
  cleaned = (parts[0] || cleaned).trim();

  // Remove command-like noise and enforce concise functional scope.
  cleaned = cleaned
    .replace(/\b(responder|no expliques|sin markdown|modo contrato|retry automatico)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return 'Tarea operativa del ciclo actual';
  return cleaned.slice(0, 140);
}

export function detectExecutionTrack(messages: NewMessage[], stageHint: string): ExecutionTrack {
  const recent = messages.slice(-10).map((m) => String(m.content || '')).join('\n').toLowerCase();
  const hint = String(stageHint || '').toUpperCase();

  const frontendSignals =
    /\b(front|frontend|ui|ux|landing|html|css|tailwind|react|vite|pixel|canvas|design|disen[oñ])\b/.test(recent) ||
    hint === 'UX';
  const backendSignals =
    /\b(back|backend|api|rest|endpoint|db|database|sql|auth|jwt|token|migration|server|node|express|nestjs)\b/.test(recent) ||
    hint === 'ARQ' ||
    hint === 'SPEC';

  if (frontendSignals && backendSignals) return 'fullstack';
  if (frontendSignals) return 'frontend';
  if (backendSignals) return 'backend';
  return 'fullstack';
}

export function detectPlanningOnlyOverride(messages: NewMessage[]): boolean {
  const recent = messages.slice(-12).map((m) => String(m.content || '')).join('\n').toLowerCase();
  if (!recent) return false;
  return (
    /\bsolo\s+pm\+spec\+arq\b/.test(recent) ||
    /\bpm\+spec\+arq\s+en\s+paralelo\b/.test(recent) ||
    /\bno\s+codear\b/.test(recent) ||
    /\bno\s+codificar\b/.test(recent) ||
    /\bno\s+hacer\s+c[oó]digo\b/.test(recent) ||
    /\bno\s+programar\b/.test(recent)
  );
}

export function detectDevopsOnlyOverride(messages: NewMessage[]): boolean {
  const recent = messages.slice(-12).map((m) => String(m.content || '')).join('\n').toLowerCase();
  if (!recent) return false;
  const devopsSignals =
    /\b(devops|deploy|deployment|puerto|port|subdominio|cloudflare|tunnel|dns|uptime|healthcheck|watchdog|restart|rollback|infra)\b/.test(recent);
  const featureSignals =
    /\b(login|auth|crud|frontend|ui|ux|feature|producto|checkout|carrito|api\s+rest|schema|modelo)\b/.test(recent);
  return devopsSignals && !featureSignals;
}

export function extractContinuationHints(text: string): string[] {
  const src = String(text || '');
  if (!src) return [];
  const out = new Set<string>();

  const sig = src.match(/^\s*SIGUIENTE:\s*(.+)\s*$/im);
  if (sig) {
    const ids = String(sig[1] || '').toUpperCase().match(/[A-Z][A-Z0-9_]*-\d+/g) || [];
    for (const id of ids) out.add(id);
  }
  const cont = src.match(/continuando\s+con\s+([A-Z][A-Z0-9_]*-\d+)/i);
  if (cont?.[1]) out.add(String(cont[1]).toUpperCase());

  return [...out];
}
