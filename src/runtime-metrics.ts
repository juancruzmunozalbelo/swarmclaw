import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER } from './config.js';

type RuntimeCounters = {
  requestsStarted: number;
  outputsSent: number;
  agentErrors: number;
  validationFailures: number;
  contractFailures: number;
  artifactFailures: number;
  devGateFailures: number;
  blockedQuestionsSet: number;
  blockedQuestionsResolved: number;
  statusValidationFailures: number;
  evidenceValidationFailures: number;
  devPrereqFailures: number;
  teamleadOnlyCycles: number;
};

type SkillCounters = {
  dispatched: number;
  completed: number;
  failed: number;
  retries: number;
  timeouts: number;
  validationFails: number;
};

type RuntimeMetrics = {
  updatedAt: string;
  counters: RuntimeCounters;
  skillMetrics?: Record<string, SkillCounters>;
  lastStage?: string;
  lastError?: string;
  lastTaskIds?: string[];
};

const DEFAULT_COUNTERS: RuntimeCounters = {
  requestsStarted: 0,
  outputsSent: 0,
  agentErrors: 0,
  validationFailures: 0,
  contractFailures: 0,
  artifactFailures: 0,
  devGateFailures: 0,
  blockedQuestionsSet: 0,
  blockedQuestionsResolved: 0,
  statusValidationFailures: 0,
  evidenceValidationFailures: 0,
  devPrereqFailures: 0,
  teamleadOnlyCycles: 0,
};

const DEFAULT_SKILL_COUNTERS: SkillCounters = {
  dispatched: 0,
  completed: 0,
  failed: 0,
  retries: 0,
  timeouts: 0,
  validationFails: 0,
};
const RESET_AFTER_MS = Number(
  process.env.RUNTIME_METRICS_RESET_AFTER_MS || 45 * 60 * 1000,
);

function normalizeSkillName(raw: string): string {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return v || 'unknown';
}

function mergeSkillCounters(raw: unknown): Record<string, SkillCounters> {
  const out: Record<string, SkillCounters> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [skillRaw, rowAny] of Object.entries(raw)) {
    const skill = normalizeSkillName(skillRaw);
    const row = rowAny as Record<string, unknown>;
    out[skill] = {
      dispatched: Number(row?.dispatched || 0),
      completed: Number(row?.completed || 0),
      failed: Number(row?.failed || 0),
      retries: Number(row?.retries || 0),
      timeouts: Number(row?.timeouts || 0),
      validationFails: Number(row?.validationFails || 0),
    };
  }
  return out;
}

function filePath(groupFolder: string): string {
  return path.join(
    GROUPS_DIR,
    groupFolder || MAIN_GROUP_FOLDER,
    'swarmdev',
    'runtime-metrics.json',
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export function readRuntimeMetrics(groupFolder: string): RuntimeMetrics {
  const p = filePath(groupFolder);
  if (!fs.existsSync(p)) {
    return {
      updatedAt: nowIso(),
      counters: { ...DEFAULT_COUNTERS },
    };
  }
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RuntimeMetrics>;
    const updatedAt = parsed.updatedAt || nowIso();
    const updatedMs = Date.parse(String(updatedAt || ''));
    const isStale = Number.isFinite(updatedMs)
      ? (Date.now() - Number(updatedMs)) > RESET_AFTER_MS
      : false;
    if (isStale) {
      return {
        updatedAt: nowIso(),
        counters: { ...DEFAULT_COUNTERS },
        skillMetrics: {},
      };
    }
    return {
      updatedAt,
      counters: { ...DEFAULT_COUNTERS, ...(parsed.counters || {}) },
      skillMetrics: mergeSkillCounters((parsed as Record<string, unknown>).skillMetrics),
      lastStage: parsed.lastStage,
      lastError: parsed.lastError,
      lastTaskIds: Array.isArray(parsed.lastTaskIds)
        ? parsed.lastTaskIds.map(String)
        : undefined,
    };
  } catch {
    return {
      updatedAt: nowIso(),
      counters: { ...DEFAULT_COUNTERS },
    };
  }
}

export function updateRuntimeMetrics(params: {
  groupFolder: string;
  increments?: Partial<RuntimeCounters>;
  skillIncrements?: Record<string, Partial<SkillCounters>>;
  lastStage?: string;
  lastError?: string;
  lastTaskIds?: string[];
}): RuntimeMetrics {
  try {
    const current = readRuntimeMetrics(params.groupFolder);
    const next: RuntimeMetrics = {
      ...current,
      updatedAt: nowIso(),
      counters: { ...current.counters },
      skillMetrics: { ...(current.skillMetrics || {}) },
    };

    if (params.increments) {
      for (const [k, v] of Object.entries(params.increments)) {
        const key = k as keyof RuntimeCounters;
        const delta = Number(v || 0);
        if (!Number.isFinite(delta)) continue;
        next.counters[key] = Math.max(0, (next.counters[key] || 0) + delta);
      }
    }

    if (params.skillIncrements) {
      for (const [skillRaw, partial] of Object.entries(params.skillIncrements)) {
        const skill = normalizeSkillName(skillRaw);
        const currentSkill = {
          ...DEFAULT_SKILL_COUNTERS,
          ...(next.skillMetrics?.[skill] || {}),
        };
        for (const [k, v] of Object.entries(partial || {})) {
          const key = k as keyof SkillCounters;
          const delta = Number(v || 0);
          if (!Number.isFinite(delta)) continue;
          currentSkill[key] = Math.max(0, (currentSkill[key] || 0) + delta);
        }
        next.skillMetrics = next.skillMetrics || {};
        next.skillMetrics[skill] = currentSkill;
      }
    }

    if (params.lastStage !== undefined) next.lastStage = params.lastStage;
    if (params.lastError !== undefined) next.lastError = params.lastError;
    if (params.lastTaskIds !== undefined) next.lastTaskIds = params.lastTaskIds;

    const p = filePath(params.groupFolder);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, p);
    return next;
  } catch {
    return readRuntimeMetrics(params.groupFolder);
  }
}
