/**
 * Container Runner for NanoClaw
 * Spawns agent execution in Apple Container and handles IPC
 */
import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
} from './config.js';
import { logger } from './logger.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error(
      'Unable to determine home directory: HOME environment variable is not set and os.homedir() returned empty',
    );
  }
  return home;
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  modelOverride?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

function copyDirRecursive(srcDir: string, dstDir: string): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dst);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.copyFileSync(src, dst);
  }
}

function syncHostCodexProfile(homeDir: string, dstCodexDir: string): void {
  const srcCodexDir = path.join(homeDir, '.codex');
  if (!fs.existsSync(srcCodexDir) || !fs.statSync(srcCodexDir).isDirectory()) return;

  fs.mkdirSync(dstCodexDir, { recursive: true });

  const fileEntries = ['config.toml', 'auth.json', 'version.json'];
  for (const file of fileEntries) {
    const src = path.join(srcCodexDir, file);
    const dst = path.join(dstCodexDir, file);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dst);
    }
  }

  const dirEntries = ['skills', 'rules'];
  for (const dir of dirEntries) {
    const src = path.join(srcCodexDir, dir);
    const dst = path.join(dstCodexDir, dir);
    if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
      copyDirRecursive(src, dst);
    }
  }

  // Ensure container workspace paths are trusted in cloned Codex config.
  const configPath = path.join(dstCodexDir, 'config.toml');
  const trustBlocks = [
    '[projects."/workspace/project"]\ntrust_level = "trusted"\n',
    '[projects."/workspace/group"]\ntrust_level = "trusted"\n',
  ];
  let configContent = '';
  if (fs.existsSync(configPath)) {
    try {
      configContent = fs.readFileSync(configPath, 'utf-8');
    } catch {
      configContent = '';
    }
  }
  let changed = false;
  for (const block of trustBlocks) {
    const header = block.split('\n')[0];
    if (!configContent.includes(header)) {
      if (configContent && !configContent.endsWith('\n')) configContent += '\n';
      configContent += `\n${block}`;
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(configPath, configContent, 'utf-8');
  }
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();

  if (isMain) {
    // Main gets the entire project root mounted
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: false,
    });

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: path.join(GROUPS_DIR, group.folder),
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Apple Container only supports directory mounts, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own .claude/ to prevent cross-group session access
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  // Keep per-group Claude settings in sync: create if missing, then merge updates.
  const baseEnv: Record<string, string> = {
    // Enable agent swarms (subagent orchestration)
    // https://code.claude.com/docs/en/agent-teams#orchestrate-teams-of-claude-code-sessions
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    // Load CLAUDE.md from additional mounted directories
    // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    // Enable Claude's memory feature (persists user preferences between sessions)
    // https://code.claude.com/docs/en/memory#manage-auto-memory
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
  };

  const resolveIndirect = (raw: string): string => {
    const v = raw.trim();
    const m = v.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (m) return (process.env[m[1]] || '').trim();
    return v;
  };

  const loadDotEnv = (): Record<string, string> => {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const out: Record<string, string> = {};
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  };

  let existingEnv: Record<string, string> = {};
  if (fs.existsSync(settingsFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf-8')) as {
        env?: Record<string, string>;
      };
      existingEnv = parsed.env || {};
    } catch {
      existingEnv = {};
    }
  }

  const env: Record<string, string> = { ...baseEnv, ...existingEnv };

  const loadClaudeUserSettingsEnv = (): Record<string, string> => {
    try {
      const home = process.env.HOME || os.homedir();
      if (!home) return {};
      const p = path.join(home, '.claude', 'settings.json');
      if (!fs.existsSync(p)) return {};
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
        env?: Record<string, unknown>;
      };
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed.env || {})) {
        if (typeof v === 'string') out[k] = v;
        else if (typeof v === 'number') out[k] = String(v);
        else if (typeof v === 'boolean') out[k] = v ? '1' : '0';
      }
      return out;
    } catch {
      return {};
    }
  };

  // If the host has set an Anthropic-compatible base URL / model prefs (e.g. MiniMax),
  // propagate them into the per-group Claude settings inside the container.
  // Secrets are still passed separately via stdin (see readSecrets()).
  const passthroughKeys = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SONNET_MODEL',
    'ANTHROPIC_SMALL_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_SMALL_REASONING_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'API_TIMEOUT_MS',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
    // Runtime app/deploy env (needed so agents can run services without asking for sudo).
    'DATABASE_URL',
    'DATABASE_URL_MAIN',
    'JWT_SECRET',
    'PORT',
    'HOST',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
  ] as const;

  const dotEnv = loadDotEnv();
  const userClaudeEnv = loadClaudeUserSettingsEnv();
  for (const key of passthroughKeys) {
    const raw = dotEnv[key] ?? process.env[key] ?? userClaudeEnv[key];
    if (!raw) continue;
    const v = resolveIndirect(String(raw));
    if (v && v.trim()) env[key] = v.trim();
  }

  fs.writeFileSync(settingsFile, JSON.stringify({ env }, null, 2) + '\n');

  // Sync skills from container/skills/ into each group's .claude/skills/
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      copyDirRecursive(srcDir, dstDir);
    }
  }

  // Sync host Claude teams into each group's isolated session home so TeamCreate/SendMessage
  // can use the same team definitions configured on the host.
  const hostTeamsSrc = path.join(homeDir, '.claude', 'teams');
  const sessionTeamsDst = path.join(groupSessionsDir, 'teams');
  if (fs.existsSync(hostTeamsSrc) && fs.statSync(hostTeamsSrc).isDirectory()) {
    copyDirRecursive(hostTeamsSrc, sessionTeamsDst);
  }

  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group Codex profile so codex CLI inside containers can reuse host config/auth/skills.
  // Keep it scoped per group to avoid cross-group session leakage.
  const groupCodexDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.codex',
  );
  syncHostCodexProfile(homeDir, groupCodexDir);
  mounts.push({
    hostPath: groupCodexDir,
    containerPath: '/home/node/.codex',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Mount agent-runner source from host — recompiled on container startup.
  // Bypasses Apple Container's sticky build cache for code changes.
  const agentRunnerSrc = path.join(projectRoot, 'container', 'agent-runner', 'src');
  mounts.push({
    hostPath: agentRunnerSrc,
    containerPath: '/app/src',
    readonly: true,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

/**
 * Read allowed secrets from .env for passing to the container via stdin.
 * Secrets are never written to disk or mounted as files.
 */
function readSecrets(): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  const allowedVars = [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'MINIMAX_API_KEY',
    'MINIMAX_API_HOST',
    'MINIMAX_API_RESOURCE_MODE',
    'MINIMAX_MCP_BASE_PATH',
    'MINIMAX_CODING_PLAN_MCP_ENABLED',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ZONE_ID',
    'CLOUDFLARE_ZONE_NAME',
    'CLOUDFLARE_TUNNEL_TARGET',
  ];
  const secrets: Record<string, string> = {};

  const resolve = (raw: string): string => {
    const v = raw.trim();
    // Allow simple indirection like ANTHROPIC_API_KEY=${MINIMAX_API_KEY}
    const m = v.match(/^\$\{([A-Z0-9_]+)\}$/);
    if (m) return (process.env[m[1]] || '').trim();
    return v;
  };

  // 1) Load from project .env if present
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (!allowedVars.includes(key)) continue;
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      value = resolve(value);
      if (value) secrets[key] = value;
    }
  }

  // 2) Fall back to host env (useful when secrets are stored in login profiles/keychains)
  for (const key of allowedVars) {
    if (secrets[key]) continue;
    const v = (process.env[key] || '').trim();
    if (v) secrets[key] = v;
  }

  // Convenience: if using an Anthropic-compatible proxy (e.g. MiniMax),
  // prefer ANTHROPIC_AUTH_TOKEN and avoid setting both AUTH_TOKEN and API_KEY at once.
  const minimaxKey = (process.env.MINIMAX_API_KEY || '').trim();
  if (minimaxKey && !secrets.ANTHROPIC_AUTH_TOKEN) {
    secrets.ANTHROPIC_AUTH_TOKEN = minimaxKey;
  }
  // If an API key was implicitly the same as the MiniMax key, drop it to avoid conflicts.
  if (
    minimaxKey &&
    secrets.ANTHROPIC_API_KEY &&
    secrets.ANTHROPIC_API_KEY.trim() === minimaxKey
  ) {
    delete secrets.ANTHROPIC_API_KEY;
  }

  return secrets;
}

function buildContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Apple Container: --mount for readonly, -v for read-write
  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(
        '--mount',
        `type=bind,source=${mount.hostPath},target=${mount.containerPath},readonly`,
      );
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn('container', containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Pass secrets via stdin (never written to disk or mounted as files)
    input.secrets = readSecrets();
    container.stdin.write(JSON.stringify(input));
    container.stdin.end();
    // Remove secrets from input so they don't appear in logs
    delete input.secrets;

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = (reason: 'idle' | 'absolute') => {
      timedOut = true;
      logger.error({ group: group.name, containerName, reason }, `Container ${reason} timeout, stopping gracefully`);
      exec(`container stop ${containerName}`, { timeout: 15000 }, (err) => {
        if (err) {
          logger.warn({ group: group.name, containerName, err }, 'Graceful stop failed, force killing');
          container.kill('SIGKILL');
        }
      });
    };

    const ABSOLUTE_MAX_RUN_MS = Math.max(timeoutMs * 2, 10 * 60 * 1000); // 10 minutes minimum
    let idleTimeout = setTimeout(() => killOnTimeout('idle'), timeoutMs);
    const absoluteTimeout = setTimeout(() => killOnTimeout('absolute'), ABSOLUTE_MAX_RUN_MS);

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => killOnTimeout('idle'), timeoutMs);
    };

    container.on('close', (code) => {
      clearTimeout(idleTimeout);
      clearTimeout(absoluteTimeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        fs.writeFileSync(timeoutLog, [
          `=== Container Run Log (TIMEOUT) ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `Container: ${containerName}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
          `Had Streaming Output: ${hadStreamingOutput}`,
        ].join('\n'));

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out with no output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${configTimeout}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Container exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(idleTimeout);
      clearTimeout(absoluteTimeout);
      logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  _registeredJids: Set<string>,
): void {
  const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
