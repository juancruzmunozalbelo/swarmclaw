import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER } from './config.js';

export type SwarmEvent = {
  ts: string; // ISO string
  groupFolder: string;
  kind:
  | 'ack'
  | 'piped'
  | 'spawn'
  | 'agent_output'
  | 'agent_stage'
  | 'agent_log'
  | 'status'
  | 'metrics'
  | 'error'
  | 'finish'
  | 'watchdog'
  | 'logcollector';
  stage?: string;
  item?: string;
  next?: string;
  files?: string[];
  chatJid?: string;
  containerName?: string;
  msg?: string; // short human-readable text
  meta?: Record<string, unknown>;
};

function dirFor(groupFolder: string): string {
  return path.join(GROUPS_DIR, groupFolder || MAIN_GROUP_FOLDER, 'swarmdev');
}

function eventsPath(groupFolder: string): string {
  return path.join(dirFor(groupFolder), 'events.jsonl');
}

function actionsPath(groupFolder: string): string {
  return path.join(dirFor(groupFolder), 'actions.jsonl');
}

function rotateIfTooBig(p: string, maxBytes: number): void {
  try {
    const st = fs.statSync(p);
    if (st.size <= maxBytes) return;
  } catch {
    return;
  }

  // Keep a small history: actions/events.jsonl -> .1 -> .2
  for (let i = 2; i >= 1; i--) {
    const src = `${p}.${i}`;
    const dst = `${p}.${i + 1}`;
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch {
      // ignore
    }
  }
  try {
    fs.renameSync(p, `${p}.1`);
  } catch {
    // ignore
  }
}

function appendJsonl(p: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  rotateIfTooBig(p, 5 * 1024 * 1024); // 5MB
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf-8');
}

export function appendSwarmEvent(groupFolder: string, ev: Omit<SwarmEvent, 'ts' | 'groupFolder'> & { ts?: string }): void {
  const out: SwarmEvent = {
    ts: ev.ts || new Date().toISOString(),
    groupFolder: groupFolder || MAIN_GROUP_FOLDER,
    ...ev,
  };
  appendJsonl(eventsPath(groupFolder), out);
}

// "Actions" are a stricter subset intended to reflect "what Andy did".
export type SwarmAction = {
  ts: string;
  groupFolder: string;
  stage?: string;
  action: string; // e.g. "stage_enter", "file_write", "question", "decision"
  detail?: string;
  files?: string[];
  meta?: Record<string, unknown>;
};

export type SwarmTransitionAction = {
  ts: string;
  groupFolder: string;
  action: 'lane_transition';
  taskId: string;
  role: 'PM' | 'SPEC' | 'ARQ' | 'UX' | 'DEV' | 'DEV2' | 'DEVOPS' | 'QA';
  state: 'idle' | 'queued' | 'working' | 'waiting' | 'done' | 'error' | 'failed';
  reason: string;
  stage?: string;
  detail?: string;
  files?: string[];
  meta?: Record<string, unknown>;
};

function isValidTransitionAction(input: unknown): input is Omit<SwarmTransitionAction, 'ts' | 'groupFolder'> & { ts?: string } {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  if (String(obj.action || '') !== 'lane_transition') return false;
  const taskId = String(obj.taskId || '').trim().toUpperCase();
  if (!/^[A-Z]+-\d+$/.test(taskId)) return false;
  const role = String(obj.role || '').trim().toUpperCase();
  if (!['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'].includes(role)) return false;
  const state = String(obj.state || '').trim().toLowerCase();
  if (!['idle', 'queued', 'working', 'waiting', 'done', 'error', 'failed'].includes(state)) return false;
  const reason = String(obj.reason || '').trim();
  if (!reason) return false;
  return true;
}

export function appendSwarmAction(groupFolder: string, a: Omit<SwarmAction, 'ts' | 'groupFolder'> & { ts?: string }): void {
  const out: SwarmAction = {
    ts: a.ts || new Date().toISOString(),
    groupFolder: groupFolder || MAIN_GROUP_FOLDER,
    ...a,
  };
  appendJsonl(actionsPath(groupFolder), out);
}

export function appendSwarmTransitionAction(
  groupFolder: string,
  a: Omit<SwarmTransitionAction, 'ts' | 'groupFolder'> & { ts?: string },
): boolean {
  if (!isValidTransitionAction(a)) return false;
  const out: SwarmTransitionAction = {
    ts: a.ts || new Date().toISOString(),
    groupFolder: groupFolder || MAIN_GROUP_FOLDER,
    action: 'lane_transition',
    taskId: String(a.taskId).trim().toUpperCase(),
    role: String(a.role).trim().toUpperCase() as SwarmTransitionAction['role'],
    state: String(a.state).trim().toLowerCase() as SwarmTransitionAction['state'],
    reason: String(a.reason).trim(),
    stage: a.stage,
    detail: a.detail,
    files: a.files,
    meta: a.meta,
  };
  appendJsonl(actionsPath(groupFolder), out);
  return true;
}
