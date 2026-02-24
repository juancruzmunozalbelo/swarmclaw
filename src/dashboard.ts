/**
 * Dashboard API — lightweight HTTP server for monitoring the orchestrator.
 * Serves JSON API endpoints and an embedded HTML dashboard.
 *
 * Sprint 18 — Audit item #6.
 */

import http from 'http';
import { loadWorkflowState } from './swarm-workflow.js';
import { readRuntimeMetrics } from './runtime-metrics.js';
import { loadLaneState } from './lane-manager.js';
import { logger } from './logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface DashboardOpts {
    port: number;
    registeredGroups: () => Record<string, { name: string; folder: string }>;
}

// ── API Handlers ───────────────────────────────────────────────────────────

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data, null, 2));
}

function handleApiGroups(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    groups: () => Record<string, { name: string; folder: string }>,
): void {
    const g = groups();
    const list = Object.entries(g).map(([jid, group]) => ({
        jid,
        name: group.name,
        folder: group.folder,
    }));
    jsonResponse(res, { groups: list });
}

function handleApiWorkflow(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    groupFolder: string,
): void {
    const state = loadWorkflowState(groupFolder);
    jsonResponse(res, state);
}

function handleApiMetrics(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    groupFolder: string,
): void {
    const metrics = readRuntimeMetrics(groupFolder);
    jsonResponse(res, metrics);
}

function handleApiLanes(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    groupFolder: string,
): void {
    const lanes = loadLaneState(groupFolder);
    jsonResponse(res, lanes);
}

// ── Dashboard HTML ─────────────────────────────────────────────────────────

function dashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NanoClaw Dashboard</title>
<style>
  :root { --bg: #0d1117; --surface: #161b22; --border: #30363d; --text: #c9d1d9; --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
  h1 { color: var(--accent); margin-bottom: 24px; font-size: 1.5rem; }
  h2 { color: var(--text); margin: 16px 0 8px; font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
  .badge-running { background: #1f6feb33; color: var(--accent); }
  .badge-done { background: #23862033; color: var(--green); }
  .badge-blocked { background: #da363033; color: var(--red); }
  .badge-todo { background: #d2992233; color: var(--yellow); }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  th { color: var(--accent); font-weight: 600; }
  .mono { font-family: 'SF Mono', Consolas, monospace; font-size: 0.8rem; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: var(--green); }
  .dot-yellow { background: var(--yellow); }
  .dot-red { background: var(--red); }
  #refreshBtn { background: var(--accent); color: #0d1117; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }
  #refreshBtn:hover { opacity: 0.8; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .meta { color: #8b949e; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="header">
  <h1>🔬 NanoClaw Dashboard</h1>
  <div><span class="meta" id="lastUpdate"></span> <button id="refreshBtn" onclick="refresh()">Refresh</button></div>
</div>
<div id="content">Loading...</div>
<script>
const BASE = location.origin;
async function fetchJson(path) {
  const r = await fetch(BASE + path);
  return r.json();
}
function badge(state) {
  const cls = state === 'done' ? 'badge-done' : state === 'blocked' ? 'badge-blocked' : state === 'running' ? 'badge-running' : 'badge-todo';
  return '<span class="badge ' + cls + '">' + state + '</span>';
}
async function refresh() {
  try {
    const { groups } = await fetchJson('/api/groups');
    let html = '<div class="grid">';
    for (const g of groups) {
      const wf = await fetchJson('/api/workflow/' + g.folder);
      const metrics = await fetchJson('/api/metrics/' + g.folder);
      const lanes = await fetchJson('/api/lanes/' + g.folder);
      html += '<div class="card">';
      html += '<h2>' + (g.name || g.folder) + '</h2>';
      // Tasks table
      const tasks = Object.values(wf.tasks || {});
      if (tasks.length > 0) {
        html += '<table><tr><th>Task</th><th>Stage</th><th>Status</th><th>Retries</th></tr>';
        for (const t of tasks) {
          html += '<tr><td class="mono">' + t.taskId + '</td><td>' + t.stage + '</td><td>' + badge(t.status) + '</td><td>' + t.retries + '</td></tr>';
        }
        html += '</table>';
      } else { html += '<p class="meta">No tasks</p>'; }
      // Lanes
      const laneEntries = Object.entries(lanes || {});
      if (laneEntries.length > 0) {
        html += '<h2>Lanes</h2><table><tr><th>Role</th><th>State</th><th>Detail</th></tr>';
        for (const [k, v] of laneEntries) {
          const dot = v.next === 'done' ? 'dot-green' : v.next === 'failed' ? 'dot-red' : 'dot-yellow';
          html += '<tr><td>' + v.role + '</td><td><span class="status-dot ' + dot + '"></span>' + v.next + '</td><td class="mono">' + (v.detail || '').slice(0,60) + '</td></tr>';
        }
        html += '</table>';
      }
      // Metrics summary
      if (metrics && metrics.totalRuns) {
        html += '<h2>Metrics</h2><p class="meta">Runs: ' + metrics.totalRuns + ' | Errors: ' + (metrics.totalErrors||0) + ' | Last: ' + (metrics.lastStage||'-') + '</p>';
      }
      html += '</div>';
    }
    html += '</div>';
    document.getElementById('content').innerHTML = html;
    document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();
  } catch (e) { document.getElementById('content').innerHTML = '<p>Error: ' + e.message + '</p>'; }
}
refresh();
setInterval(refresh, 15000);
</script>
</body>
</html>`;
}

// ── Server ─────────────────────────────────────────────────────────────────

export function startDashboard(opts: DashboardOpts): http.Server {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${opts.port}`);
        const path = url.pathname;

        if (path === '/' || path === '/dashboard') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(dashboardHtml());
            return;
        }

        if (path === '/api/groups') {
            handleApiGroups(req, res, opts.registeredGroups);
            return;
        }

        const workflowMatch = path.match(/^\/api\/workflow\/(.+)$/);
        if (workflowMatch) {
            handleApiWorkflow(req, res, workflowMatch[1]);
            return;
        }

        const metricsMatch = path.match(/^\/api\/metrics\/(.+)$/);
        if (metricsMatch) {
            handleApiMetrics(req, res, metricsMatch[1]);
            return;
        }

        const lanesMatch = path.match(/^\/api\/lanes\/(.+)$/);
        if (lanesMatch) {
            handleApiLanes(req, res, lanesMatch[1]);
            return;
        }

        // Health check
        if (path === '/health') {
            jsonResponse(res, { ok: true, uptime: process.uptime() });
            return;
        }

        jsonResponse(res, { error: 'Not found' }, 404);
    });

    server.listen(opts.port, () => {
        logger.info({ port: opts.port }, `Dashboard running at http://localhost:${opts.port}`);
    });

    return server;
}
