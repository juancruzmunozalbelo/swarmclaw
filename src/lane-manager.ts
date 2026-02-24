import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_CONTEXT_MESSAGES } from './config.js';
import { getTaskWorkflowState } from './swarm-workflow.js';
import type { NewMessage } from './types.js';
import { appendSwarmAction, appendSwarmTransitionAction } from './swarm-events.js';
import { nowIso } from './text-helpers.js';
import {
    upsertLaneState as dbUpsertLaneState,
    getLaneStatesForTask,
    getLaneStatesForGroup,
    updateStaleLaneStates,
    syncLanesWithWorkflow,
    type LaneStateRow,
} from './db.js';
import type { SubagentRole } from './prompt-builder.js';
import type { ExecutionTrack } from './text-helpers.js';

export type LaneState = 'idle' | 'queued' | 'working' | 'waiting' | 'done' | 'error' | 'failed';
export type LaneSnapshot = {
    state: LaneState;
    updatedAt: string;
    detail?: string;
    summary?: string;
    dependency?: string;
};
export type TaskLaneState = {
    taskId: string;
    lanes: Record<SubagentRole, LaneSnapshot>;
    teamleadSummary?: {
        updatedAt: string;
        pmUpdatedAt: string;
        specUpdatedAt: string;
        file: string;
        summary: string;
    };
};
export type LaneStateFile = {
    version: 1;
    updatedAt: string;
    tasks: Record<string, TaskLaneState>;
};

function laneStatePath(groupFolder: string): string {
    return path.join(GROUPS_DIR, groupFolder, 'swarmdev', 'lane-state.json');
}

const ALL_ROLES: SubagentRole[] = ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'];

export function laneTemplate(): Record<SubagentRole, LaneSnapshot> {
    const mk = (): LaneSnapshot => ({ state: 'idle', updatedAt: nowIso() });
    return {
        PM: mk(),
        SPEC: mk(),
        ARQ: mk(),
        UX: mk(),
        DEV: mk(),
        DEV2: mk(),
        DEVOPS: mk(),
        QA: mk(),
    };
}

/** Convert DB rows for a task into the lanes Record shape. */
function rowsToLanes(rows: LaneStateRow[]): Record<SubagentRole, LaneSnapshot> {
    const lanes = laneTemplate();
    for (const row of rows) {
        const role = row.role as SubagentRole;
        if (lanes[role]) {
            lanes[role] = {
                state: row.state as LaneState,
                updatedAt: row.updated_at,
                detail: row.detail || undefined,
                summary: row.summary || undefined,
                dependency: row.dependency || undefined,
            };
        }
    }
    return lanes;
}

/** Write JSON file as read-only cache for external scripts. */
function writeJsonCache(groupFolder: string, state: LaneStateFile): void {
    const p = laneStatePath(groupFolder);
    try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        state.updatedAt = nowIso();
        const tmp = `${p}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
        fs.renameSync(tmp, p);
    } catch {
        // Cache write is best-effort
    }
}

export function loadLaneState(groupFolder: string): LaneStateFile {
    const rows = getLaneStatesForGroup(groupFolder);
    const tasks: Record<string, TaskLaneState> = {};
    // Group rows by task_id
    const byTask = new Map<string, LaneStateRow[]>();
    for (const row of rows) {
        const id = row.task_id;
        if (!byTask.has(id)) byTask.set(id, []);
        byTask.get(id)!.push(row);
    }
    for (const [taskId, taskRows] of byTask) {
        tasks[taskId] = {
            taskId,
            lanes: rowsToLanes(taskRows),
        };
    }
    return { version: 1, updatedAt: nowIso(), tasks };
}

export function saveLaneState(groupFolder: string, state: LaneStateFile): void {
    // Write each lane to DB
    for (const [taskId, taskState] of Object.entries(state.tasks)) {
        if (!taskState?.lanes) continue;
        for (const role of ALL_ROLES) {
            const lane = taskState.lanes[role];
            if (!lane) continue;
            dbUpsertLaneState({
                taskId,
                groupFolder,
                role,
                state: lane.state,
                detail: lane.detail,
                summary: lane.summary,
                dependency: lane.dependency,
                updatedAt: lane.updatedAt,
            });
        }
    }
    // Write JSON cache
    writeJsonCache(groupFolder, state);
}

export function upsertTaskLaneState(state: LaneStateFile, taskId: string): TaskLaneState {
    const id = taskId.trim().toUpperCase();
    if (!state.tasks[id]) {
        state.tasks[id] = {
            taskId: id,
            lanes: laneTemplate(),
        };
    }
    return state.tasks[id];
}

export function setTodoLaneProgress(params: {
    groupFolder: string;
    taskId: string;
    lanes: Record<SubagentRole, LaneSnapshot>;
}): boolean {
    const todoPath = path.join(GROUPS_DIR, params.groupFolder, 'todo.md');
    if (!fs.existsSync(todoPath)) return false;
    const taskId = String(params.taskId || '').trim().toUpperCase();
    if (!taskId) return false;

    const lines = fs.readFileSync(todoPath, 'utf-8').split('\n');
    const idRe = /^- ID:\s*([A-Z]+-\d+)\s*$/;
    let idLine = -1;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(idRe);
        if (!m) continue;
        if (String(m[1]).toUpperCase() === taskId) {
            idLine = i;
            break;
        }
    }
    if (idLine === -1) return false;

    let end = lines.length - 1;
    for (let i = idLine + 1; i < lines.length; i++) {
        if (idRe.test(lines[i])) {
            end = i - 1;
            break;
        }
    }

    let progressLine = -1;
    for (let i = idLine + 1; i <= end; i++) {
        if (/^\s*Lanes:\s*/.test(lines[i])) {
            progressLine = i;
            break;
        }
    }

    const roles: SubagentRole[] = ['PM', 'SPEC', 'ARQ', 'UX', 'DEV', 'DEV2', 'DEVOPS', 'QA'];
    const shortTime = (iso?: string): string => {
        const s = String(iso || '');
        const m = s.match(/T(\d{2}:\d{2})/);
        return m ? m[1] : '';
    };
    const payload = roles
        .map((role) => {
            const lane = params.lanes?.[role];
            const state = String(lane?.state || 'idle');
            const hhmm = shortTime(lane?.updatedAt);
            return hhmm ? `${role}=${state}@${hhmm}` : `${role}=${state}`;
        })
        .join(' | ');
    const nextLine = `  Lanes: ${payload}`;
    if (progressLine >= 0) {
        if (lines[progressLine].trim() === nextLine.trim()) return false;
        lines[progressLine] = nextLine;
    } else {
        const insertAt = Math.min(end + 1, lines.length);
        lines.splice(insertAt, 0, nextLine);
    }

    const tmp = `${todoPath}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
    fs.renameSync(tmp, todoPath);
    return true;
}

export function syncTodoLaneProgressFromLaneState(groupFolder: string): void {
    try {
        const state = loadLaneState(groupFolder);
        for (const [taskId, row] of Object.entries(state.tasks || {})) {
            if (!row || typeof row !== 'object' || !row.lanes) continue;
            setTodoLaneProgress({
                groupFolder,
                taskId,
                lanes: row.lanes,
            });
        }
    } catch {
        // ignore
    }
}

export function reconcileLaneStateOnBoot(groupFolder: string, staleMs: number): {
    changed: boolean;
    staleLanes: number;
    touchedTasks: string[];
} {
    const syncRes = syncLanesWithWorkflow(groupFolder);
    const staleRes = updateStaleLaneStates({
        groupFolder,
        staleMs,
        newState: 'failed',
        detail: 'boot recovery: stale lane auto-failed',
    });
    const count = syncRes.count + staleRes.count;
    if (count > 0) {
        // Update JSON cache
        writeJsonCache(groupFolder, loadLaneState(groupFolder));
    }
    return {
        changed: count > 0,
        staleLanes: staleRes.count,
        touchedTasks: [...new Set([...syncRes.taskIds, ...staleRes.taskIds])],
    };
}

export function setLaneState(params: {
    groupFolder: string;
    taskId: string;
    role: SubagentRole;
    next: LaneState;
    detail?: string;
    summary?: string;
    dependency?: string;
}): TaskLaneState {
    const nextState = String(params.next || '').toLowerCase();
    const allowed = ['idle', 'queued', 'working', 'waiting', 'done', 'error', 'failed'];
    if (!allowed.includes(nextState)) {
        appendSwarmAction(params.groupFolder, {
            action: 'lane_transition_invalid',
            stage: params.role,
            detail: `invalid lane state ${nextState} for ${params.taskId}`,
            meta: { taskId: params.taskId, role: params.role, state: nextState, reason: params.detail || 'invalid_state' },
        });
        // Return current state from DB
        const state = loadLaneState(params.groupFolder);
        const taskId = String(params.taskId || '').trim().toUpperCase();
        return state.tasks[taskId] || {
            taskId,
            lanes: laneTemplate(),
        };
    }
    // Write directly to DB
    const taskId = String(params.taskId || '').trim().toUpperCase();
    dbUpsertLaneState({
        taskId,
        groupFolder: params.groupFolder,
        role: params.role,
        state: params.next,
        detail: params.detail,
        summary: params.summary,
        dependency: params.dependency,
    });
    // Reconstruct task state from DB
    const taskRows = getLaneStatesForTask(taskId, params.groupFolder);
    const task: TaskLaneState = {
        taskId,
        lanes: rowsToLanes(taskRows),
    };
    // Write JSON cache
    writeJsonCache(params.groupFolder, loadLaneState(params.groupFolder));
    try {
        setTodoLaneProgress({
            groupFolder: params.groupFolder,
            taskId: params.taskId,
            lanes: task.lanes,
        });
    } catch {
        // ignore todo lane progress sync failures
    }
    const reason = String(params.detail || 'lane state update').trim() || 'lane state update';
    const logged = appendSwarmTransitionAction(params.groupFolder, {
        action: 'lane_transition',
        taskId,
        role: params.role,
        state: nextState as 'idle' | 'queued' | 'working' | 'waiting' | 'done' | 'error' | 'failed',
        reason,
        stage: params.role,
        detail: reason,
        meta: params.dependency ? { dependency: params.dependency } : undefined,
    });
    if (!logged) {
        appendSwarmAction(params.groupFolder, {
            action: 'lane_transition_invalid',
            stage: params.role,
            detail: `transition log rejected for ${taskId}`,
            meta: { taskId, role: params.role, state: nextState, reason },
        });
    }
    return task;
}

export function isArchitectureReadyForDev(
    groupFolder: string,
    taskId: string,
    track: ExecutionTrack,
): boolean {
    const id = taskId.trim().toUpperCase();
    const taskRows = getLaneStatesForTask(id, groupFolder);
    const lanes = rowsToLanes(taskRows);
    const laneDone = lanes.SPEC?.state === 'done';
    const arqDone = lanes.ARQ?.state === 'done';
    if (track === 'frontend') {
        if (laneDone) return true;
    } else if (laneDone && arqDone) {
        return true;
    }
    const wf = getTaskWorkflowState(groupFolder, taskId);
    return wf.stage === 'DEV' || wf.stage === 'QA' || wf.stage === 'DONE';
}

export function maybeWriteTeamleadSummary(params: {
    groupFolder: string;
    taskId: string;
}): { wrote: boolean; file?: string; summary?: string } {
    const taskId = params.taskId.trim().toUpperCase();
    const taskRows = getLaneStatesForTask(taskId, params.groupFolder);
    const lanes = rowsToLanes(taskRows);
    const pm = lanes.PM;
    const spec = lanes.SPEC;
    const arq = lanes.ARQ;
    if (pm.state !== 'done' || spec.state !== 'done') return { wrote: false };

    // Check if we already wrote a summary for this exact state by reading existing file
    const fileRel = `groups/${params.groupFolder}/swarmdev/teamlead_${taskId}.md`;
    const fileAbs = path.join(GROUPS_DIR, params.groupFolder, 'swarmdev', `teamlead_${taskId}.md`);
    if (fs.existsSync(fileAbs)) {
        // Simple dedup: if file exists and PM+SPEC are still done, skip
        return { wrote: false };
    }

    const pmSummary = (pm.summary || pm.detail || 'sin salida PM').trim();
    const specSummary = (spec.summary || spec.detail || 'sin salida SPEC').trim();
    const arqSummary = (arq?.summary || arq?.detail || '').trim();
    const summaryContent =
        `# TeamLead Merge ${taskId}\n\n` +
        `Generado: ${nowIso()}\n\n` +
        `## PM\n${pmSummary}\n\n` +
        `## SPEC\n${specSummary}\n\n` +
        (arqSummary ? `## ARQ\n${arqSummary}\n\n` : '') +
        `## TeamLead Summary\n` +
        `PM/SPEC${arqSummary ? '/ARQ' : ''} completados. Listo para DEV con dependencias satisfechas.\n`;

    fs.mkdirSync(path.dirname(fileAbs), { recursive: true });
    const tmp = `${fileAbs}.tmp`;
    fs.writeFileSync(tmp, summaryContent, 'utf-8');
    fs.renameSync(tmp, fileAbs);

    return {
        wrote: true,
        file: fileRel,
        summary: arqSummary ? 'PM+SPEC+ARQ merged by TeamLead' : 'PM+SPEC merged by TeamLead',
    };
}

export function trimMainContextMessages(messages: NewMessage[]): {
    messages: NewMessage[];
    dropped: number;
} {
    const max = Math.max(6, MAIN_CONTEXT_MESSAGES);
    if (messages.length <= max) return { messages, dropped: 0 };
    return {
        messages: messages.slice(-max),
        dropped: messages.length - max,
    };
}
