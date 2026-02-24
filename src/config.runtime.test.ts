import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ConfigModule = typeof import('./config.js');

const ENV_KEYS = [
  'APP_MODE',
  'MODE',
  'AUTO_CONTINUE',
  'SWARM_EXEC_MODE',
  'PARALLEL_LANE_IDLE_TIMEOUT_MS',
  'PARALLEL_ROLE_TIMEOUT_DEFAULT_MS',
  'PARALLEL_ROLE_TIMEOUT_PM_MS',
  'PARALLEL_ROLE_TIMEOUT_SPEC_MS',
  'PARALLEL_ROLE_TIMEOUT_ARQ_MS',
  'PARALLEL_ROLE_TIMEOUT_UX_MS',
  'PARALLEL_ROLE_TIMEOUT_DEV_MS',
  'PARALLEL_ROLE_TIMEOUT_DEV2_MS',
  'PARALLEL_ROLE_TIMEOUT_DEVOPS_MS',
  'PARALLEL_ROLE_TIMEOUT_QA_MS',
  'SESSION_ROTATE_MAX_CYCLES',
  'SESSION_ROTATE_MAX_AGE_MS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_MODEL_FALLBACKS',
  'MODEL_CIRCUIT_BREAKER_ENABLED',
  'MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD',
  'MODEL_CIRCUIT_BREAKER_OPEN_MS',
] as const;

const envSnapshot: Record<string, string | undefined> = {};

for (const key of ENV_KEYS) envSnapshot[key] = process.env[key];

async function loadConfig(): Promise<ConfigModule> {
  vi.resetModules();
  return await import('./config.js');
}

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe('runtime config defaults and overrides', () => {
  beforeEach(() => {
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const prev = envSnapshot[key];
      if (typeof prev === 'string') process.env[key] = prev;
      else delete process.env[key];
    }
  });

  it('defaults to prod mode with AUTO_CONTINUE enabled', async () => {
    const cfg = await loadConfig();
    expect(cfg.APP_MODE).toBe('prod');
    expect(cfg.SWARM_EXEC_MODE).toBe('strict');
    expect(cfg.SWARM_STRICT_MODE).toBe(true);
    expect(cfg.SWARM_AUTONOMOUS_MODE).toBe(false);
    expect(cfg.AUTO_CONTINUE).toBe(true);
  });

  it('disables AUTO_CONTINUE by default in debug mode', async () => {
    process.env.APP_MODE = 'debug';
    const cfg = await loadConfig();
    expect(cfg.APP_MODE).toBe('debug');
    expect(cfg.SWARM_EXEC_MODE).toBe('soft');
    expect(cfg.SWARM_STRICT_MODE).toBe(false);
    expect(cfg.AUTO_CONTINUE).toBe(false);
  });

  it('supports autonomous execution mode', async () => {
    process.env.SWARM_EXEC_MODE = 'autonomous';
    const cfg = await loadConfig();
    expect(cfg.SWARM_EXEC_MODE).toBe('autonomous');
    expect(cfg.SWARM_STRICT_MODE).toBe(true);
    expect(cfg.SWARM_AUTONOMOUS_MODE).toBe(true);
    expect(cfg.AUTO_CONTINUE).toBe(true);
  });

  it('AUTO_CONTINUE env overrides APP_MODE', async () => {
    process.env.APP_MODE = 'debug';
    process.env.AUTO_CONTINUE = '1';
    let cfg = await loadConfig();
    expect(cfg.AUTO_CONTINUE).toBe(true);

    process.env.APP_MODE = 'prod';
    process.env.AUTO_CONTINUE = '0';
    cfg = await loadConfig();
    expect(cfg.AUTO_CONTINUE).toBe(false);
  });

  it('resolves per-role timeout values from env', async () => {
    process.env.PARALLEL_LANE_IDLE_TIMEOUT_MS = '15000';
    process.env.PARALLEL_ROLE_TIMEOUT_DEFAULT_MS = '42000';
    process.env.PARALLEL_ROLE_TIMEOUT_PM_MS = '11000';
    process.env.PARALLEL_ROLE_TIMEOUT_SPEC_MS = '22000';
    process.env.PARALLEL_ROLE_TIMEOUT_ARQ_MS = '23000';
    process.env.PARALLEL_ROLE_TIMEOUT_UX_MS = '24000';
    process.env.PARALLEL_ROLE_TIMEOUT_DEV_MS = '25000';
    process.env.PARALLEL_ROLE_TIMEOUT_DEV2_MS = '26000';
    process.env.PARALLEL_ROLE_TIMEOUT_DEVOPS_MS = '26500';
    process.env.PARALLEL_ROLE_TIMEOUT_QA_MS = '27000';
    process.env.SESSION_ROTATE_MAX_CYCLES = '9';
    process.env.SESSION_ROTATE_MAX_AGE_MS = '1200000';

    const cfg = await loadConfig();
    expect(cfg.PARALLEL_LANE_IDLE_TIMEOUT_MS).toBe(15000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_DEFAULT_MS).toBe(42000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_PM_MS).toBe(11000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_SPEC_MS).toBe(22000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_ARQ_MS).toBe(23000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_UX_MS).toBe(24000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_DEV_MS).toBe(25000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_DEV2_MS).toBe(26000);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_DEVOPS_MS).toBe(26500);
    expect(cfg.PARALLEL_ROLE_TIMEOUT_QA_MS).toBe(27000);
    expect(cfg.SESSION_ROTATE_MAX_CYCLES).toBe(9);
    expect(cfg.SESSION_ROTATE_MAX_AGE_MS).toBe(1200000);
  });

  it('parses model fallback and circuit breaker config', async () => {
    process.env.ANTHROPIC_MODEL = 'MiniMax-M2.5';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'MiniMax-M2.5, MiniMax-M2.5-fast,MiniMax-M2.5-fast';
    process.env.MODEL_CIRCUIT_BREAKER_ENABLED = '1';
    process.env.MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD = '4';
    process.env.MODEL_CIRCUIT_BREAKER_OPEN_MS = '90000';

    const cfg = await loadConfig();
    expect(cfg.MODEL_PRIMARY).toBe('MiniMax-M2.5');
    expect(cfg.MODEL_FALLBACKS).toEqual(['MiniMax-M2.5-fast']);
    expect(cfg.MODEL_CIRCUIT_BREAKER_ENABLED).toBe(true);
    expect(cfg.MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD).toBe(4);
    expect(cfg.MODEL_CIRCUIT_BREAKER_OPEN_MS).toBe(90000);
  });
});
