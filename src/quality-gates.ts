import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';

type GateName = 'build' | 'lint' | 'test';
type GateStatus = 'passed' | 'failed' | 'skipped';

export type GateRun = {
  dir: string;
  gate: GateName;
  status: GateStatus;
  command?: string;
  output?: string;
  reason?: string;
};

export type DevGateResult = {
  ok: boolean;
  runs: GateRun[];
  summary: string;
};

const MAX_OUTPUT = 4000;
const CMD_TIMEOUT_MS = 120_000;

function rel(p: string): string {
  const root = process.cwd();
  if (p.startsWith(root)) return path.relative(root, p) || '.';
  return p;
}

function readPackageScripts(dir: string): Record<string, string> {
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts || {};
  } catch {
    return {};
  }
}

function parseArchivoTokens(archivosText: string): string[] {
  return String(archivosText || '')
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^['"`]+|['"`]+$/g, ''));
}

function resolveCandidateDirs(groupFolder: string, archivosText: string): string[] {
  const out = new Set<string>();
  const groupDir = path.join(GROUPS_DIR, groupFolder);
  out.add(groupDir);
  const root = process.cwd();

  const findPackageRoot = (startDir: string): string | null => {
    let cur = path.resolve(startDir);
    while (true) {
      if (fs.existsSync(path.join(cur, 'package.json'))) return cur;
      if (cur === root || cur === path.dirname(cur)) break;
      cur = path.dirname(cur);
    }
    return null;
  };

  for (const token of parseArchivoTokens(archivosText)) {
    if (token === 'n/a' || token === '...') continue;
    let abs = token;
    if (!path.isAbsolute(abs)) abs = path.join(root, token);
    abs = path.normalize(abs);
    if (!abs.startsWith(root)) continue;
    const statPath = fs.existsSync(abs) ? abs : path.dirname(abs);
    if (!fs.existsSync(statPath)) continue;
    const st = fs.statSync(statPath);
    const dir = st.isDirectory() ? statPath : path.dirname(statPath);
    const pkg = findPackageRoot(dir);
    if (pkg) out.add(pkg);
  }

  // keep only dirs that contain package.json
  return [...out].filter((d) => fs.existsSync(path.join(d, 'package.json')));
}

function runGate(dir: string, gate: GateName, scripts: Record<string, string>): GateRun {
  if (!scripts[gate]) {
    return {
      dir: rel(dir),
      gate,
      status: 'skipped',
      reason: `script '${gate}' not found`,
    };
  }
  const cmd = `npm run -s ${gate}`;
  try {
    const out = execSync(cmd, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CMD_TIMEOUT_MS,
    });
    return {
      dir: rel(dir),
      gate,
      status: 'passed',
      command: cmd,
      output: String(out || '').slice(-MAX_OUTPUT),
    };
  } catch (err: unknown) {
    const execErr = err as Record<string, unknown>;
    const stdout = String(execErr?.stdout || '');
    const stderr = String(execErr?.stderr || '');
    return {
      dir: rel(dir),
      gate,
      status: 'failed',
      command: cmd,
      output: `${stdout}\n${stderr}`.slice(-MAX_OUTPUT),
      reason: (err instanceof Error ? err.message : 'command failed') as string,
    };
  }
}

export function runDevQualityGates(params: {
  groupFolder: string;
  archivosText: string;
}): DevGateResult {
  const dirs = resolveCandidateDirs(params.groupFolder, params.archivosText);
  const runs: GateRun[] = [];

  for (const dir of dirs) {
    const scripts = readPackageScripts(dir);
    for (const gate of ['build', 'lint', 'test'] as GateName[]) {
      runs.push(runGate(dir, gate, scripts));
    }
  }

  const executed = runs.filter((r) => r.status !== 'skipped');
  const failed = runs.filter((r) => r.status === 'failed');
  if (executed.length === 0) {
    return {
      ok: false,
      runs,
      summary: 'no build/lint/test scripts found in candidate directories',
    };
  }
  if (failed.length > 0) {
    return {
      ok: false,
      runs,
      summary: `${failed.length} quality gate(s) failed`,
    };
  }
  return {
    ok: true,
    runs,
    summary: `${executed.length} quality gate(s) passed`,
  };
}

export function writeDevGateEvidence(params: {
  groupFolder: string;
  taskId: string;
  result: DevGateResult;
}): string {
  const taskId = params.taskId.trim().toUpperCase();
  const p = path.join(
    GROUPS_DIR,
    params.groupFolder,
    'swarmdev',
    `qa_${taskId}.md`,
  );
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const lines: string[] = [];
  lines.push(`# QA ${taskId}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Summary: ${params.result.summary}`);
  lines.push('');
  lines.push('## Gate Runs');
  lines.push('');
  for (const run of params.result.runs) {
    lines.push(`- [${run.status}] ${run.dir} :: ${run.gate}`);
    if (run.command) lines.push(`  - cmd: \`${run.command}\``);
    if (run.reason) lines.push(`  - reason: ${run.reason}`);
  }
  lines.push('');
  lines.push('## Outputs');
  lines.push('');
  for (const run of params.result.runs) {
    if (!run.output) continue;
    lines.push(`### ${run.dir} :: ${run.gate} (${run.status})`);
    lines.push('');
    lines.push('```');
    lines.push(run.output);
    lines.push('```');
    lines.push('');
  }
  fs.writeFileSync(p, lines.join('\n'), 'utf-8');
  return `groups/${params.groupFolder}/swarmdev/qa_${taskId}.md`;
}
