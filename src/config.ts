import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const MODEL_PRIMARY = (process.env.ANTHROPIC_MODEL || '').trim();
const modelFallbackRaw = (
  process.env.ANTHROPIC_MODEL_FALLBACKS
  || process.env.MODEL_FALLBACKS
  || ''
).trim();
export const MODEL_FALLBACKS = modelFallbackRaw
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)
  .filter((x, i, arr) => arr.indexOf(x) === i)
  .filter((x) => x !== MODEL_PRIMARY);
export const MODEL_CIRCUIT_BREAKER_ENABLED =
  (process.env.MODEL_CIRCUIT_BREAKER_ENABLED || '1').trim() !== '0';
export const MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '3', 10) || 3,
);
export const MODEL_CIRCUIT_BREAKER_OPEN_MS = Math.max(
  1000,
  parseInt(process.env.MODEL_CIRCUIT_BREAKER_OPEN_MS || String(10 * 60 * 1000), 10)
  || (10 * 60 * 1000),
);
export const TASK_CIRCUIT_BREAKER_ENABLED =
  (process.env.TASK_CIRCUIT_BREAKER_ENABLED || '1').trim() !== '0';
export const TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '3', 10) || 3,
);
export const TASK_CIRCUIT_BREAKER_OPEN_MS = Math.max(
  1000,
  parseInt(process.env.TASK_CIRCUIT_BREAKER_OPEN_MS || String(10 * 60 * 1000), 10)
  || (10 * 60 * 1000),
);
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '1800000',
  10,
); // 30min default — how long to keep container alive after last result

// UI-only: after we emit an agent message, mark the swarm idle quickly so the dash
// doesn't look "stuck working" while the container session stays alive.
export const DASH_IDLE_GRACE_MS = parseInt(
  process.env.DASH_IDLE_GRACE_MS || '8000',
  10,
);
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);
export const PARALLEL_SUBAGENTS_ENABLED =
  (process.env.PARALLEL_SUBAGENTS_ENABLED || '1').trim() !== '0';
export const PARALLEL_SUBAGENT_COOLDOWN_MS = parseInt(
  process.env.PARALLEL_SUBAGENT_COOLDOWN_MS || '600000',
  10,
); // 10m
export const PARALLEL_LANE_IDLE_TIMEOUT_MS = parseInt(
  process.env.PARALLEL_LANE_IDLE_TIMEOUT_MS || '900000',
  10,
); // 15m default: prioritize functional completion over speed
export const PARALLEL_ROLE_TIMEOUT_DEFAULT_MS = Math.max(
  5000,
  parseInt(
    process.env.PARALLEL_ROLE_TIMEOUT_DEFAULT_MS
    || String(PARALLEL_LANE_IDLE_TIMEOUT_MS),
    10,
  ) || PARALLEL_LANE_IDLE_TIMEOUT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_PM_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_PM_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_SPEC_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_SPEC_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_ARQ_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_ARQ_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_UX_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_UX_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_DEV_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_DEV_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_DEV2_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_DEV2_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_DEVOPS_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_DEVOPS_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_ROLE_TIMEOUT_QA_MS = Math.max(
  5000,
  parseInt(process.env.PARALLEL_ROLE_TIMEOUT_QA_MS || String(PARALLEL_ROLE_TIMEOUT_DEFAULT_MS), 10)
  || PARALLEL_ROLE_TIMEOUT_DEFAULT_MS,
);
export const PARALLEL_SUBAGENT_RETRY_MAX = Math.max(
  0,
  parseInt(process.env.PARALLEL_SUBAGENT_RETRY_MAX || '2', 10) || 2,
);
export const PARALLEL_SUBAGENT_RETRY_BASE_MS = Math.max(
  250,
  parseInt(process.env.PARALLEL_SUBAGENT_RETRY_BASE_MS || '3000', 10) || 3000,
);
export const PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER = Math.max(
  1,
  Number(process.env.PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER || '2') || 2,
);
export const PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS = Math.max(
  PARALLEL_SUBAGENT_RETRY_BASE_MS,
  parseInt(process.env.PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS || '20000', 10) || 20000,
);
export const SUBAGENT_CONTEXT_MESSAGES = Math.max(
  3,
  parseInt(process.env.SUBAGENT_CONTEXT_MESSAGES || '6', 10) || 6,
);
export const TASK_MICRO_BATCH_MAX = Math.max(
  1,
  parseInt(process.env.TASK_MICRO_BATCH_MAX || '3', 10) || 3,
);
export const MAIN_CONTEXT_MESSAGES = Math.max(
  6,
  parseInt(process.env.MAIN_CONTEXT_MESSAGES || '40', 10) || 40,
);
export const SESSION_ROTATE_MAX_CYCLES = Math.max(
  1,
  parseInt(process.env.SESSION_ROTATE_MAX_CYCLES || '8', 10) || 8,
);
export const SESSION_ROTATE_MAX_AGE_MS = Math.max(
  60_000,
  parseInt(process.env.SESSION_ROTATE_MAX_AGE_MS || String(45 * 60 * 1000), 10)
  || (45 * 60 * 1000),
);
export const BOOT_STALE_RUNNING_MS = Math.max(
  60_000,
  parseInt(process.env.BOOT_STALE_RUNNING_MS || String(30 * 60 * 1000), 10)
  || (30 * 60 * 1000),
);
export const BOOT_MAX_RUNNING_TASKS = Math.max(
  1,
  parseInt(process.env.BOOT_MAX_RUNNING_TASKS || '1', 10) || 1,
);
export const MICRO_BATCH_EPIC_PM_ONLY =
  (process.env.MICRO_BATCH_EPIC_PM_ONLY || '1').trim() !== '0';

// Debug UX only: optional quick "processing..." acknowledgement.
// Default is OFF to avoid noisy chat messages; enable with PROCESSING_ACK_ENABLED=1.
export const PROCESSING_ACK_ENABLED =
  (process.env.PROCESSING_ACK_ENABLED || '0').trim() !== '0';
export const PROCESSING_ACK_TEXT =
  process.env.PROCESSING_ACK_TEXT || 'OK, procesando...';
export const PROCESSING_ACK_DEBOUNCE_MS = parseInt(
  process.env.PROCESSING_ACK_DEBOUNCE_MS || '15000',
  10,
);

export const APP_MODE = (process.env.APP_MODE || process.env.MODE || 'prod')
  .trim()
  .toLowerCase();
const execModeRaw = (process.env.SWARM_EXEC_MODE || '').trim().toLowerCase();
export const SWARM_EXEC_MODE: 'soft' | 'strict' | 'autonomous' =
  execModeRaw === 'soft' || execModeRaw === 'strict' || execModeRaw === 'autonomous'
    ? (execModeRaw as 'soft' | 'strict' | 'autonomous')
    : (APP_MODE === 'prod' ? 'strict' : 'soft');
export const SWARM_STRICT_MODE =
  SWARM_EXEC_MODE === 'strict' || SWARM_EXEC_MODE === 'autonomous';
export const SWARM_AUTONOMOUS_MODE = SWARM_EXEC_MODE === 'autonomous';
const autoContinueEnv = (process.env.AUTO_CONTINUE || '').trim().toLowerCase();
export const AUTO_CONTINUE =
  autoContinueEnv.length > 0
    ? !['0', 'false', 'no', 'off'].includes(autoContinueEnv)
    : SWARM_EXEC_MODE !== 'soft';
export const BACKLOG_FREEZE_PREFIX = String(process.env.BACKLOG_FREEZE_PREFIX || '').trim().toUpperCase();
export const BACKLOG_FREEZE_ACTIVE_TASK = String(process.env.BACKLOG_FREEZE_ACTIVE_TASK || '').trim().toUpperCase();

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ─── Config Validation (Zod) ─────────────────────────────────────────────────
import { z } from 'zod';

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().min(0);
const positiveDuration = z.number().int().min(1000, 'Duration must be >= 1000ms');

const ConfigSchema = z.object({
  ASSISTANT_NAME: z.string().min(1, 'ASSISTANT_NAME cannot be empty'),
  POLL_INTERVAL: positiveInt,
  CONTAINER_TIMEOUT: positiveDuration,
  CONTAINER_MAX_OUTPUT_SIZE: positiveInt,
  IDLE_TIMEOUT: positiveDuration,
  DASH_IDLE_GRACE_MS: nonNegativeInt,
  MAX_CONCURRENT_CONTAINERS: positiveInt,
  PARALLEL_SUBAGENT_COOLDOWN_MS: nonNegativeInt,
  PARALLEL_LANE_IDLE_TIMEOUT_MS: positiveDuration,
  PARALLEL_SUBAGENT_RETRY_MAX: nonNegativeInt,
  PARALLEL_SUBAGENT_RETRY_BASE_MS: positiveInt,
  PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER: z.number().min(1),
  PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS: positiveInt,
  SUBAGENT_CONTEXT_MESSAGES: z.number().int().min(3),
  TASK_MICRO_BATCH_MAX: positiveInt,
  MAIN_CONTEXT_MESSAGES: z.number().int().min(6),
  SESSION_ROTATE_MAX_CYCLES: positiveInt,
  SESSION_ROTATE_MAX_AGE_MS: positiveDuration,
  BOOT_STALE_RUNNING_MS: positiveDuration,
  BOOT_MAX_RUNNING_TASKS: positiveInt,
  APP_MODE: z.enum(['prod', 'debug', 'dev', 'test']),
  SWARM_EXEC_MODE: z.enum(['soft', 'strict', 'autonomous']),
  MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD: positiveInt,
  MODEL_CIRCUIT_BREAKER_OPEN_MS: positiveDuration,
  TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD: positiveInt,
  TASK_CIRCUIT_BREAKER_OPEN_MS: positiveDuration,
});

const configResult = ConfigSchema.safeParse({
  ASSISTANT_NAME,
  POLL_INTERVAL,
  CONTAINER_TIMEOUT,
  CONTAINER_MAX_OUTPUT_SIZE,
  IDLE_TIMEOUT,
  DASH_IDLE_GRACE_MS,
  MAX_CONCURRENT_CONTAINERS,
  PARALLEL_SUBAGENT_COOLDOWN_MS,
  PARALLEL_LANE_IDLE_TIMEOUT_MS,
  PARALLEL_SUBAGENT_RETRY_MAX,
  PARALLEL_SUBAGENT_RETRY_BASE_MS,
  PARALLEL_SUBAGENT_RETRY_BACKOFF_MULTIPLIER,
  PARALLEL_SUBAGENT_RETRY_MAX_DELAY_MS,
  SUBAGENT_CONTEXT_MESSAGES,
  TASK_MICRO_BATCH_MAX,
  MAIN_CONTEXT_MESSAGES,
  SESSION_ROTATE_MAX_CYCLES,
  SESSION_ROTATE_MAX_AGE_MS,
  BOOT_STALE_RUNNING_MS,
  BOOT_MAX_RUNNING_TASKS,
  APP_MODE,
  SWARM_EXEC_MODE,
  MODEL_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  MODEL_CIRCUIT_BREAKER_OPEN_MS,
  TASK_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  TASK_CIRCUIT_BREAKER_OPEN_MS,
});

if (!configResult.success) {
  const issues = configResult.error.issues
    .map((e) => `  ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  console.error(
    `\n╔══════════════════════════════════════════════════╗\n` +
    `║  CONFIG VALIDATION FAILED                        ║\n` +
    `╚══════════════════════════════════════════════════╝\n` +
    issues + '\n',
  );
  if (APP_MODE === 'prod') {
    throw new Error(`Invalid configuration:\n${issues}`);
  }
}

