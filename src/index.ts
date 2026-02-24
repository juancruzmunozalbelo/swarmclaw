import fs from 'fs';
import path from 'path';

import {
  setupPhase,
  preflightPhase,
  timersPhase,
  buildOutputCallback,
  cleanupPhase,
} from './phases/index.js';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  MAIN_CONTEXT_MESSAGES,
  BOOT_STALE_RUNNING_MS,
  BOOT_MAX_RUNNING_TASKS,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
} from './config.js';
import { maybeSendProcessingAck } from './processing-ack.js';
import { dispatchParallelLanes } from './parallel-dispatch.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import {
  writeGroupsSnapshot,
} from './container-runner.js';
import { updateSwarmStatus } from './swarm-status.js';
import { writeSwarmMetrics } from './metrics.js';
import { appendSwarmAction, appendSwarmEvent } from './swarm-events.js';
import {
  reconcileWorkflowOnBoot,
} from './swarm-workflow.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import { formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { ensureContainerSystemRunning } from './container-boot.js';
import { loadCircuitBreakerState } from './model-circuit.js';
import { loadSecrets, KNOWN_SECRETS } from './secrets-vault.js';
import { startLivenessProbeLoop } from './liveness-probes.js';
import {
  inferStageHint,
} from './text-helpers.js';
export type { ExecutionTrack } from './text-helpers.js';
export type { SubagentRole, TaskKind } from './prompt-builder.js';

import {
  syncTodoLaneProgressFromLaneState,
  reconcileLaneStateOnBoot,
  trimMainContextMessages,
} from './lane-manager.js';
export type { LaneState, LaneSnapshot, TaskLaneState, LaneStateFile } from './lane-manager.js';

import {
  setTodoState,
} from './todo-manager.js';
import { runAgent, type AgentRunnerDeps } from './agent-runner.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

let channel: Channel;
const queue = new GroupQueue();

const sessionLifecycleByKey = new Map<string, { startedAt: number; cycles: number }>();











function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

function buildAgentRunnerDeps(): AgentRunnerDeps {
  return {
    sessions,
    sessionLifecycleByKey,
    registeredGroups,
    queue: {
      registerProcess: (jid, proc, containerName, groupFolder) =>
        queue.registerProcess(jid, proc as import('child_process').ChildProcess, containerName, groupFolder),
    },
    getAvailableGroups,
    saveState,
  };
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 *
 * Sprint 4 — Rewritten as thin orchestrator.
 * Phases 1, 2, 3, 4, 5 are in src/phases/.
 * Only `maybeDispatchParallelSubagents` remains inline (362 lines).
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  // ── Phase 1: Setup & Message Fetch ─────────────────────────────────
  const ctx = await setupPhase(chatJid, group, lastAgentTimestamp);
  if (!ctx) return true;

  // Destructure for maybeDispatchParallelSubagents closure compatibility
  const { isMainGroup, stageHint, missedMessages } = ctx;
  let { taskIds } = ctx;

  // ── Phase 2a: Pre-flight (non-dispatch) ────────────────────────────
  preflightPhase(ctx);
  // Sync taskIds back (preflightPhase may have modified ctx.taskIds)
  taskIds = ctx.taskIds;
  // ── Phase 2b: Parallel Dispatch (via extracted module) ─────────────
  dispatchParallelLanes({
    group,
    taskIds,
    stageHint,
    missedMessages,
    chatJid,
    isMainGroup,
    deps: {
      buildAgentRunnerDeps,
      sessionLifecycleByKey,
      sendNotification: (jid, text) => { try { channel.sendMessage(jid, text); } catch { /* ignore */ } },
    },
  });

  // ── Phase 3: Cursor Advance & Timer Setup ──────────────────────────
  const timers = await timersPhase(ctx, {
    channel,
    queue,
    lastAgentTimestamp,
    saveState,
  });

  // ── Phase 4: Agent Execution & Output Processing ───────────────────
  const outputCallback = buildOutputCallback(ctx, timers, { channel, queue });
  const output = await runAgent(group, ctx.prompt, chatJid, buildAgentRunnerDeps(), outputCallback);

  // ── Phase 5: Cleanup & Error Recovery ──────────────────────────────
  return cleanupPhase(ctx, timers, output, {
    channel,
    queue,
    lastAgentTimestamp,
    saveState,
  });
}





async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const rawMessagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const trimmed = trimMainContextMessages(rawMessagesToSend);
          const messagesToSend = trimmed.messages;
          const formatted = formatMessages(messagesToSend);
          const pipeStageHint = inferStageHint(messagesToSend[messagesToSend.length - 1]?.content || '');
          if (trimmed.dropped > 0) {
            appendSwarmAction(group.folder, {
              action: 'context_trimmed',
              stage: pipeStageHint,
              detail: `trimmed ${trimmed.dropped} old messages before dispatch`,
              meta: { chatJid, dropped: trimmed.dropped, kept: messagesToSend.length, max: MAIN_CONTEXT_MESSAGES },
            });
          }

          if (queue.sendMessage(chatJid, formatted)) {
            // Container already running; still send ack + status so the user sees activity.
            try {
              updateSwarmStatus({
                groupFolder: group.folder,
                stage: pipeStageHint,
                item: 'piped follow-up to active container',
                files: [`data/ipc/${group.folder}/input`],
                next: 'waiting for agent output',
              });
              writeSwarmMetrics(group.folder, {
                stage: pipeStageHint,
                item: 'piped follow-up to active container',
                next: 'waiting for agent output',
                chatJid,
                files: [`data/ipc/${group.folder}/input`],
                note: 'piped',
              });
              appendSwarmEvent(group.folder, {
                kind: 'piped',
                stage: pipeStageHint,
                item: 'piped follow-up to active container',
                next: 'waiting for agent output',
                files: [`data/ipc/${group.folder}/input`],
                chatJid,
              });
              appendSwarmAction(group.folder, {
                action: 'piped',
                stage: pipeStageHint,
                detail: 'piped follow-up to active container',
                files: [`data/ipc/${group.folder}/input`],
                meta: { chatJid },
              });
              await maybeSendProcessingAck({
                chatJid,
                isMainGroup,
                groupRequiresTrigger: group.requiresTrigger,
              }, { sendMessage: (jid, text) => channel.sendMessage(jid, text) });
            } catch {
              // ignore
            }
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}



async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadCircuitBreakerState();
  loadSecrets([...KNOWN_SECRETS]);
  loadState();
  for (const group of Object.values(registeredGroups)) {
    try {
      const wf = reconcileWorkflowOnBoot({
        groupFolder: group.folder,
        staleMs: BOOT_STALE_RUNNING_MS,
        maxRunning: BOOT_MAX_RUNNING_TASKS,
      });
      const lanes = reconcileLaneStateOnBoot(group.folder, BOOT_STALE_RUNNING_MS);
      if (wf.changed || lanes.changed) {
        appendSwarmAction(group.folder, {
          action: 'boot_recovery',
          stage: 'TEAMLEAD',
          detail: `boot recovery applied (workflowChanged=${wf.changed}, laneChanged=${lanes.changed})`,
          files: [
            `groups/${group.folder}/swarmdev/workflow-state.json`,
            `groups/${group.folder}/swarmdev/lane-state.json`,
          ],
          meta: {
            staleMs: BOOT_STALE_RUNNING_MS,
            maxRunning: BOOT_MAX_RUNNING_TASKS,
            workflow: wf,
            laneStale: lanes.staleLanes,
            touchedTasks: [...new Set([...wf.blockedTaskIds, ...lanes.touchedTasks])].slice(0, 40),
          },
        });
      }
      const taskIdsToBlock = new Set<string>([...wf.blockedTaskIds, ...lanes.touchedTasks]);
      for (const taskId of taskIdsToBlock) {
        try {
          await setTodoState({ groupFolder: group.folder, taskId, state: 'blocked', skipAutoAdvance: true });
        } catch {
          // ignore
        }
      }
    } catch (err) {
      logger.warn({ err, groupFolder: group.folder }, 'Boot recovery failed for group');
    }
  }
  syncTodoLaneProgressFromLaneState(MAIN_GROUP_FOLDER);
  for (const group of Object.values(registeredGroups)) {
    syncTodoLaneProgressFromLaneState(group.folder);
  }

  // Clear stale "working" UI state after restarts so the dash doesn't look stuck.
  try {
    // Always refresh main (dash reads groups/main).
    updateSwarmStatus({
      groupFolder: MAIN_GROUP_FOLDER,
      stage: 'idle',
      item: 'boot',
      files: [`groups/${MAIN_GROUP_FOLDER}/swarmdev/status.md`],
      next: 'awaiting next message',
    });
    writeSwarmMetrics(MAIN_GROUP_FOLDER, {
      stage: 'idle',
      item: 'boot',
      next: 'awaiting next message',
      note: 'boot',
    });
    appendSwarmEvent(MAIN_GROUP_FOLDER, {
      kind: 'status',
      stage: 'idle',
      item: 'boot',
      next: 'awaiting next message',
      msg: 'booted; cleared stale dash state',
    });

    for (const group of Object.values(registeredGroups)) {
      updateSwarmStatus({
        groupFolder: group.folder,
        stage: 'idle',
        item: 'boot',
        files: [`groups/${group.folder}/swarmdev/status.md`],
        next: 'awaiting next message',
      });
      writeSwarmMetrics(group.folder, {
        stage: 'idle',
        item: 'boot',
        next: 'awaiting next message',
        note: 'boot',
      });
      appendSwarmEvent(group.folder, {
        kind: 'status',
        stage: 'idle',
        item: 'boot',
        next: 'awaiting next message',
        msg: 'booted; cleared stale dash state',
      });
    }
  } catch {
    // ignore
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    await channel.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Create WhatsApp channel
  const whatsapp = new WhatsAppChannel({
    onMessage: (chatJid, msg) => storeMessage(msg),
    onChatMetadata: (chatJid, timestamp) => storeChatMetadata(chatJid, timestamp),
    registeredGroups: () => registeredGroups,
  });
  channel = whatsapp;

  // Connect — resolves when first connected
  await channel.connect();

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const text = formatOutbound(channel, rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => channel.sendMessage(jid, text),
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp.syncGroupMetadata(force),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop();
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
