#!/usr/bin/env npx tsx
import fs from 'fs';
import path from 'path';

const home = process.env.HOME || '';
if (!home) {
    console.error('HOME not set');
    process.exit(1);
}

const cfgPath = process.env.CLOUDFLARED_CONFIG
    || path.join(home, '.cloudflared', 'config.yml');
const previewHost = process.env.CLOUDFLARE_PREVIEW_HOST || '*.juancruzalbelo.com.ar';
const previewService = process.env.CLOUDFLARE_PREVIEW_SERVICE || 'http://localhost:8787';

if (!fs.existsSync(cfgPath)) {
    console.error(`Missing cloudflared config: ${cfgPath}`);
    process.exit(1);
}

const original = fs.readFileSync(cfgPath, 'utf-8');
const lines = original.split('\n');

if (!lines.some((l) => l.trim() === 'ingress:')) {
    lines.push('ingress:');
    lines.push('  - service: http_status:404');
}

const entryHostname = `  - hostname: ${previewHost}`;
const entryService = `    service: ${previewService}`;
const already = lines.some((l) => l.trim() === `- hostname: ${previewHost}`);

if (!already) {
    const fallbackIdx = lines.findIndex((l) => l.trim() === '- service: http_status:404');
    if (fallbackIdx >= 0) {
        lines.splice(fallbackIdx, 0, entryHostname, entryService);
    } else {
        lines.push(entryHostname, entryService, '  - service: http_status:404');
    }
}

const updated = lines.join('\n');
if (updated === original) {
    console.log('cloudflared ingress already configured');
    process.exit(0);
}

const backup = `${cfgPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(cfgPath, backup);
fs.writeFileSync(cfgPath, updated, 'utf-8');
console.log(`updated ${cfgPath}`);
console.log(`backup: ${backup}`);
