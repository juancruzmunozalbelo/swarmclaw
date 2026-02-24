import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, STORE_DIR } from './config.js';
import { NewMessage, RegisteredGroup, ScheduledTask, TaskRunLog } from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS workflow_tasks (
      task_id TEXT NOT NULL,
      group_folder TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'TEAMLEAD',
      status TEXT NOT NULL DEFAULT 'running',
      retries INTEGER NOT NULL DEFAULT 0,
      pending_questions TEXT DEFAULT '[]',
      decisions TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT,
      PRIMARY KEY (task_id, group_folder)
    );
    CREATE INDEX IF NOT EXISTS idx_wf_group ON workflow_tasks(group_folder);
    CREATE INDEX IF NOT EXISTS idx_wf_status ON workflow_tasks(status);

    CREATE TABLE IF NOT EXISTS workflow_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      group_folder TEXT NOT NULL,
      ts TEXT NOT NULL,
      from_stage TEXT NOT NULL,
      to_stage TEXT NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wt_task ON workflow_transitions(task_id, group_folder);

    CREATE TABLE IF NOT EXISTS lane_states (
      task_id TEXT NOT NULL,
      group_folder TEXT NOT NULL,
      role TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'idle',
      updated_at TEXT NOT NULL,
      detail TEXT,
      summary TEXT,
      dependency TEXT,
      PRIMARY KEY (task_id, group_folder, role)
    );
    CREATE INDEX IF NOT EXISTS idx_ls_group ON lane_states(group_folder);
    CREATE INDEX IF NOT EXISTS idx_ls_task ON lane_states(task_id, group_folder);
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add tokens_used column to workflow_tasks (Sprint 2 migration)
  try {
    database.exec(
      `ALTER TABLE workflow_tasks ADD COLUMN tokens_used INTEGER DEFAULT 0`,
    );
  } catch {
    /* column already exists */
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  try {
    db = new Database(dbPath);
    // Healthcheck: verify DB is readable before proceeding
    db.prepare('SELECT 1').get();
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    createSchema(db);
  } catch {
    // DB is likely corrupted — back it up and start fresh
    const backup = `${dbPath}.corrupt.${Date.now()}`;
    try {
      db?.close();
      fs.renameSync(dbPath, backup);
      console.error(`[db] DB corrupta — backup en ${backup}, recreando desde cero`);
    } catch {
      // ignore rename errors (file may not exist)
    }
    db = new Database(dbPath);
    db.prepare('SELECT 1').get(); // must succeed on fresh DB
    createSchema(db);
  }

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
  );
}



export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter out bot's own messages by checking content prefix (not is_from_me, since user shares the account)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter out bot's own messages by checking content prefix
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ?
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}



export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---



export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function clearSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
      jid: string;
      name: string;
      folder: string;
      trigger_pattern: string;
      added_at: string;
      container_config: string | null;
      requires_trigger: number | null;
    }
    | undefined;
  if (!row) return undefined;
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
  };
}

export function setRegisteredGroup(
  jid: string,
  group: RegisteredGroup,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db
    .prepare('SELECT * FROM registered_groups')
    .all() as Array<{
      jid: string;
      name: string;
      folder: string;
      trigger_pattern: string;
      added_at: string;
      container_config: string | null;
      requires_trigger: number | null;
    }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      containerConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger: row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    };
  }
  return result;
}

// --- Workflow state accessors ---

export interface WorkflowTaskRow {
  task_id: string;
  group_folder: string;
  stage: string;
  status: string;
  retries: number;
  pending_questions: string;
  decisions: string;
  created_at: string;
  updated_at: string;
  last_error: string | null;
}

export interface WorkflowTransitionRow {
  id: number;
  task_id: string;
  group_folder: string;
  ts: string;
  from_stage: string;
  to_stage: string;
  reason: string | null;
}

export function upsertWorkflowTask(params: {
  taskId: string;
  groupFolder: string;
  stage: string;
  status: string;
  retries: number;
  pendingQuestions: string[];
  decisions: string[];
  lastError?: string | null;
  tokensUsed?: number;
  expectedStage?: string;
}): boolean {
  const now = new Date().toISOString();

  if (params.expectedStage) {
    const info = db.prepare(`
      UPDATE workflow_tasks SET
        stage = ?, status = ?, retries = ?, pending_questions = ?, decisions = ?, updated_at = ?, last_error = ?,
        tokens_used = CASE WHEN ? IS NOT NULL THEN ? ELSE tokens_used END
      WHERE task_id = ? AND group_folder = ? AND stage = ?
    `).run(
      params.stage, params.status, params.retries, JSON.stringify(params.pendingQuestions), JSON.stringify(params.decisions), now, params.lastError ?? null,
      params.tokensUsed ?? null, params.tokensUsed ?? null,
      params.taskId, params.groupFolder, params.expectedStage
    );
    if (info.changes === 0) {
      const exists = db.prepare('SELECT 1 FROM workflow_tasks WHERE task_id = ? AND group_folder = ?').get(params.taskId, params.groupFolder);
      if (exists) return false; // OCC failed: dirty write
    } else {
      return true;
    }
  }

  db.prepare(`
    INSERT INTO workflow_tasks (task_id, group_folder, stage, status, retries, pending_questions, decisions, created_at, updated_at, last_error, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, group_folder) DO UPDATE SET
      stage = excluded.stage,
      status = excluded.status,
      retries = excluded.retries,
      pending_questions = excluded.pending_questions,
      decisions = excluded.decisions,
      updated_at = excluded.updated_at,
      last_error = excluded.last_error,
      tokens_used = CASE
        WHEN excluded.tokens_used IS NOT NULL THEN excluded.tokens_used
        ELSE workflow_tasks.tokens_used
      END
  `).run(
    params.taskId,
    params.groupFolder,
    params.stage,
    params.status,
    params.retries,
    JSON.stringify(params.pendingQuestions),
    JSON.stringify(params.decisions),
    now,
    now,
    params.lastError ?? null,
    params.tokensUsed ?? null,
  );
  return true;
}

export function getWorkflowTask(taskId: string, groupFolder: string): WorkflowTaskRow | undefined {
  return db.prepare(
    'SELECT * FROM workflow_tasks WHERE task_id = ? AND group_folder = ?',
  ).get(taskId, groupFolder) as WorkflowTaskRow | undefined;
}

export function getWorkflowTasksByGroup(groupFolder: string): WorkflowTaskRow[] {
  return db.prepare(
    'SELECT * FROM workflow_tasks WHERE group_folder = ? ORDER BY updated_at DESC',
  ).all(groupFolder) as WorkflowTaskRow[];
}

export function getBlockedWorkflowTasks(groupFolder: string): WorkflowTaskRow[] {
  return db.prepare(
    "SELECT * FROM workflow_tasks WHERE group_folder = ? AND status = 'blocked' ORDER BY updated_at DESC",
  ).all(groupFolder) as WorkflowTaskRow[];
}

export function insertWorkflowTransition(params: {
  taskId: string;
  groupFolder: string;
  fromStage: string;
  toStage: string;
  reason?: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO workflow_transitions(task_id, group_folder, ts, from_stage, to_stage, reason)
    VALUES(?, ?, ?, ?, ?, ?)
      `).run(
    params.taskId,
    params.groupFolder,
    now,
    params.fromStage,
    params.toStage,
    params.reason ?? null,
  );
}

export function getWorkflowTransitions(taskId: string, groupFolder: string): WorkflowTransitionRow[] {
  return db.prepare(
    'SELECT * FROM workflow_transitions WHERE task_id = ? AND group_folder = ? ORDER BY ts',
  ).all(taskId, groupFolder) as WorkflowTransitionRow[];
}

export function deleteWorkflowTask(taskId: string, groupFolder: string): void {
  db.prepare('DELETE FROM workflow_transitions WHERE task_id = ? AND group_folder = ?').run(taskId, groupFolder);
  db.prepare('DELETE FROM workflow_tasks WHERE task_id = ? AND group_folder = ?').run(taskId, groupFolder);
}



// --- Lane state accessors ---

export interface LaneStateRow {
  task_id: string;
  group_folder: string;
  role: string;
  state: string;
  updated_at: string;
  detail: string | null;
  summary: string | null;
  dependency: string | null;
}

export function upsertLaneState(params: {
  taskId: string;
  groupFolder: string;
  role: string;
  state: string;
  detail?: string | null;
  summary?: string | null;
  dependency?: string | null;
  updatedAt?: string;
}): void {
  const now = params.updatedAt || new Date().toISOString();
  db.prepare(`
    INSERT INTO lane_states(task_id, group_folder, role, state, updated_at, detail, summary, dependency)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id, group_folder, role) DO UPDATE SET
      state = excluded.state,
    updated_at = excluded.updated_at,
    detail = excluded.detail,
    summary = excluded.summary,
    dependency = excluded.dependency
      `).run(
    params.taskId.trim().toUpperCase(),
    params.groupFolder,
    params.role,
    params.state,
    now,
    params.detail ?? null,
    params.summary ?? null,
    params.dependency ?? null,
  );
}

export function getLaneStatesForTask(taskId: string, groupFolder: string): LaneStateRow[] {
  return db.prepare(
    'SELECT * FROM lane_states WHERE task_id = ? AND group_folder = ?',
  ).all(taskId.trim().toUpperCase(), groupFolder) as LaneStateRow[];
}

export function getLaneStatesForGroup(groupFolder: string): LaneStateRow[] {
  return db.prepare(
    'SELECT * FROM lane_states WHERE group_folder = ? ORDER BY task_id, role',
  ).all(groupFolder) as LaneStateRow[];
}



export function updateStaleLaneStates(params: {
  groupFolder: string;
  staleMs: number;
  newState: string;
  detail: string;
}): { count: number; taskIds: string[] } {
  const now = new Date();
  const cutoff = new Date(now.getTime() - Math.max(60_000, params.staleMs)).toISOString();
  const activeStates = ['queued', 'working', 'waiting'];
  const placeholders = activeStates.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT task_id, role FROM lane_states
    WHERE group_folder = ? AND state IN(${placeholders}) AND updated_at < ?
    `).all(params.groupFolder, ...activeStates, cutoff) as Array<{ task_id: string; role: string }>;

  if (rows.length === 0) return { count: 0, taskIds: [] };

  const nowIso = now.toISOString();
  const stmt = db.prepare(`
    UPDATE lane_states SET state = ?, updated_at = ?, detail = ?
    WHERE task_id = ? AND group_folder = ? AND role = ?
      `);
  const taskIds = new Set<string>();
  for (const row of rows) {
    stmt.run(params.newState, nowIso, params.detail, row.task_id, params.groupFolder, row.role);
    taskIds.add(row.task_id);
  }
  return { count: rows.length, taskIds: [...taskIds] };
}

export function syncLanesWithWorkflow(groupFolder: string): { count: number; taskIds: string[] } {
  const activeStates = ['queued', 'working', 'waiting'];
  const placeholders = activeStates.map(() => '?').join(',');

  // Match active lanes where EITHER:
  //   (a) a workflow_task exists but is NOT running (split-brain), OR
  //   (b) no workflow_task exists at all (orphan lane from a crash)
  const condition = `
    group_folder = ? AND state IN (${placeholders})
    AND (
      EXISTS (
        SELECT 1 FROM workflow_tasks wt
        WHERE wt.task_id = lane_states.task_id
        AND wt.group_folder = lane_states.group_folder
        AND wt.status != 'running'
      )
      OR NOT EXISTS (
        SELECT 1 FROM workflow_tasks wt
        WHERE wt.task_id = lane_states.task_id
        AND wt.group_folder = lane_states.group_folder
      )
    )
  `;

  const rows = db.prepare(
    `SELECT DISTINCT task_id FROM lane_states WHERE ${condition}`
  ).all(groupFolder, ...activeStates) as Array<{ task_id: string }>;

  if (rows.length === 0) return { count: 0, taskIds: [] };

  const taskIds = new Set(rows.map(r => r.task_id));
  const nowIso = new Date().toISOString();

  db.prepare(`
    UPDATE lane_states
    SET state = 'error', updated_at = ?, detail = 'boot recovery: overridden by workflow source of truth'
    WHERE ${condition}
  `).run(nowIso, groupFolder, ...activeStates);

  return { count: rows.length, taskIds: [...taskIds] };
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      setRegisteredGroup(jid, group);
    }
  }
}
