import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, MAIN_GROUP_FOLDER } from './config.js';

type SwarmStatus = {
  stage: string;
  item: string;
  files: string;
  next: string;
  updatedAt: string;
};

function statusFilePathForGroupFolder(groupFolder: string): string {
  return path.join(GROUPS_DIR, groupFolder, 'swarmdev', 'status.md');
}

function render(s: SwarmStatus): string {
  return (
    `# SwarmDev Status\n\n` +
    `ETAPA: ${s.stage}\n` +
    `ITEM: ${s.item}\n` +
    `ARCHIVOS: ${s.files}\n` +
    `ULTIMO_UPDATE: ${s.updatedAt}\n` +
    `SIGUIENTE: ${s.next}\n\n`
  );
}

export function updateSwarmStatus(params: {
  groupFolder: string;
  stage: string;
  item?: string;
  files?: string[];
  next?: string;
}): void {
  const groupFolder = params.groupFolder || MAIN_GROUP_FOLDER;
  const filePath = statusFilePathForGroupFolder(groupFolder);
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  const payload: SwarmStatus = {
    stage: params.stage,
    item: params.item || 'n/a',
    files: (params.files && params.files.length > 0)
      ? params.files.join(', ')
      : 'n/a',
    next: params.next || 'n/a',
    updatedAt: new Date().toISOString(),
  };

  const tmp = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmp, render(payload), 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch {
    // Non-fatal.
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

