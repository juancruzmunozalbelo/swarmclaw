import fs from 'fs';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendSwarmTransitionAction } from './swarm-events.js';

const GROUP = 'test-events';
const ACTIONS_PATH = path.join(process.cwd(), 'groups', GROUP, 'swarmdev', 'actions.jsonl');

function readLines(): string[] {
  if (!fs.existsSync(ACTIONS_PATH)) return [];
  return fs.readFileSync(ACTIONS_PATH, 'utf-8').trim().split('\n').filter(Boolean);
}

afterEach(() => {
  try {
    fs.rmSync(path.join(process.cwd(), 'groups', GROUP), { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe('appendSwarmTransitionAction', () => {
  it('writes valid lane_transition action', () => {
    const ok = appendSwarmTransitionAction(GROUP, {
      action: 'lane_transition',
      taskId: 'ECOM-001',
      role: 'DEV',
      state: 'working',
      reason: 'attempt 1 started',
      detail: 'DEV running ECOM-001',
    });

    expect(ok).toBe(true);
    const lines = readLines();
    expect(lines.length).toBe(1);
    const row = JSON.parse(lines[0]);
    expect(row.action).toBe('lane_transition');
    expect(row.taskId).toBe('ECOM-001');
    expect(row.role).toBe('DEV');
    expect(row.state).toBe('working');
    expect(row.reason).toBe('attempt 1 started');
    expect(typeof row.ts).toBe('string');
  });

  it('rejects invalid transition schema and does not write', () => {
    const badMissingReason = appendSwarmTransitionAction(GROUP, {
      action: 'lane_transition',
      taskId: 'ECOM-001',
      role: 'DEV',
      state: 'working',
      reason: '',
    });
    expect(badMissingReason).toBe(false);

    const badTaskId = appendSwarmTransitionAction(GROUP, {
      action: 'lane_transition',
      taskId: 'BAD',
      role: 'DEV',
      state: 'working',
      reason: 'x',
    });
    expect(badTaskId).toBe(false);

    const badState = appendSwarmTransitionAction(GROUP, {
      action: 'lane_transition',
      taskId: 'ECOM-001',
      role: 'DEV',
      state: 'doing' as any,
      reason: 'x',
    });
    expect(badState).toBe(false);

    const lines = readLines();
    expect(lines.length).toBe(0);
  });
});
