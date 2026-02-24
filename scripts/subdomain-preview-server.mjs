#!/usr/bin/env node
import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

const projectRoot = path.resolve(process.cwd());
const subdomainsFile = process.env.SUBDOMAINS_FILE
  || path.join(projectRoot, 'groups', 'main', 'swarmdev', 'subdomains.md');
const port = Number(process.env.PREVIEW_PORT || 8787);

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]);

function parseTable(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('|---')) continue;
    const cells = trimmed.split('|').map((x) => x.trim()).filter(Boolean);
    if (cells.length < 5) continue;
    if (cells[0].toLowerCase() === 'id') continue;
    const [id, subdomain, deliverable, state, updatedAt] = cells;
    rows.push({ id, subdomain, deliverable, state, updatedAt });
  }
  return rows;
}

function loadMapping() {
  if (!fs.existsSync(subdomainsFile)) return [];
  return parseTable(fs.readFileSync(subdomainsFile, 'utf-8'));
}

function normalizeSlug(hostname) {
  const host = String(hostname || '').toLowerCase().split(':')[0];
  const label = host.split('.')[0] || '';
  return label.replace(/[^a-z0-9-]/g, '');
}

function safeJoin(baseDir, relativePath) {
  const full = path.resolve(baseDir, relativePath);
  if (!full.startsWith(path.resolve(baseDir))) return null;
  return full;
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

async function proxyToUrl(req, res, upstreamBase, reqPath, reqQuery) {
  const base = String(upstreamBase || '').replace(/\/+$/, '');
  const pathPart = reqPath && reqPath !== '/' ? reqPath : '';
  const url = `${base}${pathPart}${reqQuery || ''}`;
  const method = req.method || 'GET';

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (typeof v === 'string') headers.set(k, v);
  }
  headers.delete('host');

  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks = [];
    await new Promise((resolve) => {
      req.on('data', (c) => chunks.push(c));
      req.on('end', resolve);
      req.on('error', resolve);
    });
    init.body = Buffer.concat(chunks);
  }

  const upstream = await fetch(url, init);
  const ct = upstream.headers.get('content-type') || 'text/plain; charset=utf-8';
  res.writeHead(upstream.status, { 'Content-Type': ct });
  const ab = await upstream.arrayBuffer();
  res.end(Buffer.from(ab));
}

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, 'Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME.get(ext) || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    const host = req.headers.host || '';
    const slug = normalizeSlug(host);
    const rows = loadMapping();
    const row = rows.find((r) => {
      const subdomainHost = String(r.subdomain || '').replace(/^https?:\/\//, '').split('/')[0];
      return normalizeSlug(subdomainHost) === slug;
    });

    if (!row) {
      send(
        res,
        404,
        `No mapping for host "${host}". Update ${subdomainsFile} first.`,
      );
      return;
    }

    const deliverable = String(row.deliverable || '').trim();
    const absDeliverable = path.resolve(projectRoot, deliverable);
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const reqPath = decodeURIComponent(reqUrl.pathname || '/');
    const reqQuery = reqUrl.search || '';

    if (/^https?:\/\//i.test(deliverable)) {
      proxyToUrl(req, res, deliverable, reqPath, reqQuery).catch((err) => {
        send(res, 502, `Upstream error: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }

    if (reqPath === '/' || reqPath === '') {
      if (fs.existsSync(absDeliverable) && fs.statSync(absDeliverable).isDirectory()) {
        const indexHtml = path.join(absDeliverable, 'index.html');
        serveFile(res, indexHtml);
        return;
      }
      serveFile(res, absDeliverable);
      return;
    }

    const baseDir = fs.existsSync(absDeliverable) && fs.statSync(absDeliverable).isDirectory()
      ? absDeliverable
      : path.dirname(absDeliverable);
    const filePath = safeJoin(baseDir, reqPath.replace(/^\/+/, ''));
    if (!filePath) {
      send(res, 400, 'Invalid path');
      return;
    }
    serveFile(res, filePath);
  } catch (err) {
    send(res, 500, `Preview server error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`subdomain-preview-server listening on http://127.0.0.1:${port}`);
  // eslint-disable-next-line no-console
  console.log(`mapping file: ${subdomainsFile}`);
});
