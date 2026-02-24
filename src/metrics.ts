import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';

export type SwarmMetrics = {
  stage: string;
  item: string;
  next: string;
  updatedAt: string;
  chatJid?: string;
  containerName?: string;
  files?: string[];
  note?: string;
};

function metricsPath(groupFolder: string): string {
  return path.join(GROUPS_DIR, groupFolder, 'swarmdev', 'metrics.json');
}

export function writeSwarmMetrics(groupFolder: string, m: Omit<SwarmMetrics, 'updatedAt'>): void {
  const out: SwarmMetrics = { ...m, updatedAt: new Date().toISOString() };
  const p = metricsPath(groupFolder);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, p);
}
