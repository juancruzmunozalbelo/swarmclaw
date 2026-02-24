const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const ui = {
  pillMode: document.getElementById('pill-mode'),
  pillStage: document.getElementById('pill-stage'),
  pillAgent: document.getElementById('pill-agent'),
  pillWa: document.getElementById('pill-wa'),
  pillUpdated: document.getElementById('pill-updated'),
  pillNow: document.getElementById('pill-now'),
  item: document.getElementById('kv-item'),
  next: document.getElementById('kv-next'),
  files: document.getElementById('kv-files'),
  containers: document.getElementById('kv-containers'),
  runtimeAlertLevel: document.getElementById('runtime-alert-level'),
  runtimeUpdated: document.getElementById('runtime-updated'),
  runtimeCounters: document.getElementById('runtime-counters'),
  runtimeRoles: document.getElementById('runtime-roles'),
  activeLanes: document.getElementById('active-lanes'),
  blockedQueue: document.getElementById('blocked-queue'),
  runtimeAlertItems: document.getElementById('runtime-alert-items'),
  runtimeHistory: document.getElementById('runtime-history'),
  runbookCopyBtn: document.getElementById('runbook-copy-btn'),
  runbookSummary: document.getElementById('runbook-summary'),
  runtimeSyncLanesBtn: document.getElementById('runtime-sync-lanes-btn'),
  runtimeResetBtn: document.getElementById('runtime-reset-btn'),
  runtimeWatchdogBtn: document.getElementById('runtime-watchdog-btn'),
  runtimeMsg: document.getElementById('runtime-msg'),
  kanban: document.getElementById('kanban'),
  todoClearDone: document.getElementById('todo-clear-done'),
  todoClearAll: document.getElementById('todo-clear-all'),
  todoCreateForm: document.getElementById('todo-create-form'),
  todoNewId: document.getElementById('todo-new-id'),
  todoNewOwner: document.getElementById('todo-new-owner'),
  todoNewScope: document.getElementById('todo-new-scope'),
  todoNewState: document.getElementById('todo-new-state'),
  todoCreateBtn: document.getElementById('todo-create-btn'),
  todoCreateMsg: document.getElementById('todo-create-msg'),
  kanbanKpiOverall: document.getElementById('kanban-kpi-overall'),
  kanbanKpiProgress: document.getElementById('kanban-kpi-progress'),
  kanbanKpiWip: document.getElementById('kanban-kpi-wip'),
  kanbanKpiBlocked: document.getElementById('kanban-kpi-blocked'),
  kanbanProgressFill: document.getElementById('kanban-progress-fill'),
  kanbanPortfolio: document.getElementById('kanban-portfolio'),
  events: document.getElementById('events'),
  // Modal
  alertModal: document.getElementById('alert-modal'),
  modalIcon: document.getElementById('modal-icon'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalClose: document.getElementById('modal-close'),
  modalDismiss: document.getElementById('modal-dismiss'),
};

// ── Alert Modal helpers ─────────────────────────────────────────
let _lastAlertLevel = 'ok';
let _lastAlertItems = [];

function showAlertModal(level, items) {
  if (!ui.alertModal) return;
  const overlay = ui.alertModal;
  overlay.classList.remove('is-warn', 'is-critical');
  if (level === 'warn') overlay.classList.add('is-warn');
  else if (level === 'critical') overlay.classList.add('is-critical');

  if (ui.modalIcon) {
    ui.modalIcon.textContent = level === 'critical' ? '🔥' : level === 'warn' ? '⚠️' : '✅';
  }
  if (ui.modalTitle) {
    const titles = { critical: 'Alerta Crítica', warn: 'Advertencia', ok: 'Estado OK' };
    ui.modalTitle.textContent = titles[level] || 'Alerta';
  }
  if (ui.modalBody) {
    if (items.length === 0) {
      ui.modalBody.innerHTML = '<div class="modal-alert-item">Sin alertas activas</div>';
    } else {
      ui.modalBody.innerHTML = items
        .map(item => `<div class="modal-alert-item">${item}</div>`)
        .join('');
    }
  }
  overlay.classList.add('is-visible');
}

function dismissAlertModal() {
  if (ui.alertModal) ui.alertModal.classList.remove('is-visible');
}

// Close modal on X, dismiss button, or clicking the backdrop
if (ui.modalClose) ui.modalClose.addEventListener('click', dismissAlertModal);
if (ui.modalDismiss) ui.modalDismiss.addEventListener('click', dismissAlertModal);
if (ui.alertModal) ui.alertModal.addEventListener('click', (e) => {
  if (e.target === ui.alertModal) dismissAlertModal();
});

// Click pill to re-open modal
if (ui.runtimeAlertLevel) {
  ui.runtimeAlertLevel.style.cursor = 'pointer';
  ui.runtimeAlertLevel.addEventListener('click', () => {
    showAlertModal(_lastAlertLevel, _lastAlertItems);
  });
}
// Click alert items text to re-open modal
if (ui.runtimeAlertItems) {
  ui.runtimeAlertItems.style.cursor = 'pointer';
  ui.runtimeAlertItems.addEventListener('click', () => {
    showAlertModal(_lastAlertLevel, _lastAlertItems);
  });
}

// ── Confirmation Modal (Promise-based) ──────────────────────────
const confirmModal = document.getElementById('confirm-modal');
const confirmIcon = document.getElementById('confirm-icon');
const confirmTitle = document.getElementById('confirm-title');
const confirmBody = document.getElementById('confirm-body');
const confirmOk = document.getElementById('confirm-ok');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmClose = document.getElementById('confirm-close');

let _confirmResolve = null;

function showConfirmModal({ title = 'Confirmar acción', message = '¿Estás seguro?', icon = '⚠️', confirmLabel = 'Confirmar' } = {}) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    if (confirmIcon) confirmIcon.textContent = icon;
    if (confirmTitle) confirmTitle.textContent = title;
    if (confirmBody) confirmBody.innerHTML = `<div class="modal-alert-item">${message}</div>`;
    if (confirmOk) confirmOk.textContent = confirmLabel;
    if (confirmModal) confirmModal.classList.add('is-visible');
  });
}

function resolveConfirm(value) {
  if (_confirmResolve) { _confirmResolve(value); _confirmResolve = null; }
  if (confirmModal) confirmModal.classList.remove('is-visible');
}

if (confirmOk) confirmOk.addEventListener('click', () => resolveConfirm(true));
if (confirmCancel) confirmCancel.addEventListener('click', () => resolveConfirm(false));
if (confirmClose) confirmClose.addEventListener('click', () => resolveConfirm(false));
if (confirmModal) confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) resolveConfirm(false);
});

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function setWarn(el, on) {
  if (!el) return;
  if (on) el.classList.add('pill--warn');
  else el.classList.remove('pill--warn');
}

function showRuntimeMessage(text, level = 'ok') {
  if (!ui.runtimeMsg) return;
  ui.runtimeMsg.textContent = String(text || '');
  ui.runtimeMsg.classList.remove('is-error', 'is-ok');
  ui.runtimeMsg.classList.add(level === 'error' ? 'is-error' : 'is-ok');
}

function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function normalizeTodoState(raw) {
  const v = String(raw || 'todo').trim().toLowerCase();
  if (v === 'pending') return 'todo';
  if (v === 'queued' || v === 'queue') return 'planning';
  if (v === 'working') return 'doing';
  if (v === 'in_progress' || v === 'in-progress' || v === 'inprogress') return 'doing';
  if (v === 'completed' || v === 'complete') return 'done';
  if (v === 'failed') return 'blocked';
  if (v === 'todo' || v === 'planning' || v === 'doing' || v === 'blocked' || v === 'done') return v;
  return 'todo';
}

// Visible error surface if Safari fails to run the JS.
window.addEventListener('error', (ev) => {
  setText(ui.pillNow, `API: JS error (${String(ev?.message || 'unknown')})`);
});

// "Olympus" palette for the GAME canvas.
const PAL = {
  skyA: '#d4e8f9',
  skyB: '#ffffff',

  grass1: '#ffffff', // Clouds
  grass2: '#f0f4f8',
  grass3: '#e1eaf2',

  path1: '#f9d976',  // Gold/yellow brick
  path2: '#e6c253',
  path3: '#d4b040',

  water1: '#84b6e3', // Ethereal sky patches
  water2: '#95c4ea',
  water3: '#72a8d6',

  tree1: '#d7dce2',  // Marble pillars/debris
  tree2: '#cad1d8',
  tree3: '#b4bdc7',

  wall: '#fdfdfd',   // White marble
  roof: '#f2c84b',   // Gold roofs
  roof2: '#d4af37',

  ink: '#3b4351',    // Darker blue/grey for outlines
  ink2: '#525d6e',
  hi: '#ffffff',
  shadow: 'rgba(50,60,80,0.15)',

  // 9 Gods — one per role
  teamlead: '#f1b709',  // Zeus gold
  pm: '#359df3',        // Athena sky blue
  arq: '#da3e2e',       // Hephaestus fire red
  spec: '#e27a1d',      // Apollo sun orange
  ux: '#e91e8c',        // Aphrodite pink
  dev: '#b71c1c',       // Ares blood red
  dev2: '#4caf50',      // Hermes green
  devops: '#1565c0',    // Poseidon deep blue
  qa: '#7b1fa2',        // Artemis purple
};

function parseStage(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('teamlead') || s.includes('team-lead') || s.includes('lead') || s.includes('andy')) return 'teamlead';
  if (s.includes('pm')) return 'pm';
  if (s.includes('arq') || s.includes('arquitect') || s.includes('arch')) return 'arq';
  if (s.includes('spec')) return 'spec';
  if (s.includes('ux') || s.includes('ui')) return 'ux';
  if (s.includes('dev2') || s.includes('dev-2')) return 'dev2';
  if (s.includes('devops') || s.includes('dev-ops')) return 'devops';
  if (s.includes('dev')) return 'dev';
  if (s.includes('qa')) return 'qa';
  if (s.includes('error')) return 'error';
  if (s.includes('running')) return 'running';
  return 'idle';
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

// --- Tiny tile engine -------------------------------------------------------
const TILE = 16;
const W = canvas.width;
const H = canvas.height;
const TCOLS = Math.floor(W / TILE);
const TROWS = Math.floor(H / TILE);

function makeMap() {
  // 0 grass, 1 path, 2 water, 3 tree border, 4 plaza
  const m = Array.from({ length: TROWS }, () => Array(TCOLS).fill(0));

  // tree border
  for (let x = 0; x < TCOLS; x++) { m[0][x] = 3; m[TROWS - 1][x] = 3; }
  for (let y = 0; y < TROWS; y++) { m[y][0] = 3; m[y][TCOLS - 1] = 3; }

  // water strip at the very top
  for (let y = 1; y <= 2; y++) {
    for (let x = 1; x < TCOLS - 1; x++) m[y][x] = 2;
  }

  // central spine (vertical golden road)
  for (let y = 3; y < TROWS - 1; y++) {
    m[y][10] = 1;
    m[y][11] = 1;
  }

  // Cross paths at the different temple rows
  // Y coordinates of temples are roughly: 20, 130, 240, 350, 460
  // Tile indices (y / 16): ~1, 8, 15, 21, 28
  // Placing the paths just below the temples so gods walk on them
  const branchRows = [3, 10, 16, 24, 30];

  for (const ry of branchRows) {
    if (ry < TROWS) {
      // draw horizontal path crossing from left temple to right temple
      for (let x = 4; x <= 17; x++) {
        m[ry][x] = 1;
        m[ry + 1][x] = 1;
      }
      // draw a small marble plaza at the intersections
      for (let py = ry - 1; py <= ry + 2; py++) {
        for (let px = 9; px <= 12; px++) {
          if (py < TROWS) m[py][px] = 4;
        }
      }
    }
  }

  // A large grand plaza around Zeus in the middle
  for (let py = 15; py <= 19; py++) {
    for (let px = 8; px <= 13; px++) {
      m[py][px] = 4;
    }
  }

  return m;
}

const MAP = makeMap();

function drawTile(x, y, t, frame) {
  const px = x * TILE;
  const py = y * TILE;

  if (t === 0) {
    // grass
    const v = (x + y) % 3;
    ctx.fillStyle = v === 0 ? PAL.grass1 : v === 1 ? PAL.grass2 : PAL.grass3;
    ctx.fillRect(px, py, TILE, TILE);
    // speckle
    if (((x * 13 + y * 7 + frame) % 23) === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(px + 12, py + 3, 1, 3);
    }
    return;
  }

  if (t === 1) {
    // path
    const v = (x + y) % 3;
    ctx.fillStyle = v === 0 ? PAL.path1 : v === 1 ? PAL.path2 : PAL.path3;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(px + 2, py + 2, 2, 2);
    ctx.fillRect(px + 11, py + 11, 2, 2);
    return;
  }

  if (t === 2) {
    // water with wave animation
    const wave = ((frame / 10) | 0) % 3;
    ctx.fillStyle = wave === 0 ? PAL.water1 : wave === 1 ? PAL.water2 : PAL.water3;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(px + 2 + wave, py + 3, 6, 2);
    ctx.fillRect(px + 7, py + 10 + (wave % 2), 7, 2);
    return;
  }

  if (t === 3) {
    // tree wall tile
    ctx.fillStyle = PAL.tree3;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = PAL.tree1;
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = PAL.tree2;
    ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(px + 4, py + 4, 5, 2);
    return;
  }

  // plaza (stone)
  ctx.fillStyle = '#aab2b9';
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = '#9aa2aa';
  ctx.fillRect(px + ((x + y) % 2) * 2, py + 1, 12, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(px + 2, py + 2, 12, 1);
}

function drawMap(frame) {
  // sky backdrop in top few rows
  ctx.fillStyle = PAL.skyA;
  ctx.fillRect(0, 0, W, 6 * TILE);
  ctx.fillStyle = PAL.skyB;
  ctx.fillRect(0, 0, W, 2 * TILE);

  for (let y = 0; y < TROWS; y++) {
    for (let x = 0; x < TCOLS; x++) {
      drawTile(x, y, MAP[y][x], frame);
    }
  }
}

// --- Buildings --------------------------------------------------------------
function drawBuilding(x, y, label, accent, active) {
  // Greek Temple style
  const bw = 72;
  const bh = 56;

  // shadow
  ctx.fillStyle = PAL.shadow;
  ctx.fillRect(x + 4, y + bh - 6, bw, 8);

  // Greek Pediment (Triangle Roof)
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(x + bw / 2, y + 2);
  ctx.lineTo(x + bw, y + 20);
  ctx.lineTo(x, y + 20);
  ctx.fill();

  ctx.fillStyle = PAL.roof2;
  ctx.fillRect(x, y + 20, bw, 4); // architrave base

  // Columns (Doric style)
  ctx.fillStyle = PAL.wall;
  const cw = 6;
  for (let i = 0; i < 5; i++) {
    const cx = x + 4 + i * 14;
    ctx.fillRect(cx, y + 24, cw, 28);
    // flute/shade
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(cx + 4, y + 24, 2, 28);
    ctx.fillStyle = PAL.wall;
  }

  // Base steps (stylobate)
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(x - 4, y + 52, bw + 8, 4);
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(x - 6, y + 56, bw + 12, 4);

  // Sign inside pediment
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(x + 18, y + 10, bw - 36, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 8px "Cinzel", "Georgia", serif';
  ctx.fillText(label.slice(0, 6), x + 22, y + 17);

  if (active) {
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.8)'; // gold glow
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y, bw + 4, bh + 4);
  }
}

// --- Sprites: 9 Gods of Olympus (one per role) ----------------------------
const GOD_MAP = {
  teamlead: 'zeus',
  pm: 'athena',
  arq: 'hephaestus',
  spec: 'apollo',
  ux: 'aphrodite',
  dev: 'ares',
  dev2: 'hermes',
  devops: 'poseidon',
  qa: 'artemis',
};
const GOD_TINT = {
  teamlead: PAL.teamlead,
  pm: PAL.pm,
  arq: PAL.arq,
  spec: PAL.spec,
  ux: PAL.ux,
  dev: PAL.dev,
  dev2: PAL.dev2,
  devops: PAL.devops,
  qa: PAL.qa,
};

function drawMonster(px, py, role, frame, isActive, isWalking) {
  const scale = 2;
  const bob = isWalking ? ((frame % 18) < 9 ? 0 : 1) : ((frame % 80) === 0 ? -1 : 0);
  // Give an extra bounce to the active god
  const activeBounce = isActive ? Math.round(Math.sin(frame / 6) * 2) : 0;
  const x = Math.round(px);
  const y = Math.round(py) + bob + activeBounce;
  const kind = GOD_MAP[role] || 'zeus';
  const tint = GOD_TINT[role] || PAL.teamlead;

  if (isActive) {
    // Dynamic pulsing divine aura for active gods
    const pulse = Math.abs(Math.sin(frame / 10));
    ctx.fillStyle = `rgba(255, 230, 80, ${0.15 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(x + 24, y + 24, 34 + pulse * 6, 0, Math.PI * 2);
    ctx.fill();

    // Secondary inner aura ring
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + 24, y + 24, 28, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  // Shadow scales slightly from the bounce
  const shScale = isActive ? Math.max(0, activeBounce) : 0;
  ctx.ellipse(x + 24, y + 48 + shScale, 14 + shScale, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const step = isWalking ? (((frame % 16) < 8) ? 0 : 1) : 0;
  const rect = (ix, iy, w, h, col) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x + ix * scale, y + iy * scale, w * scale, h * scale);
  };

  const OUT = PAL.ink;
  const SKIN = '#ffdfc4';
  const SKIN_SHADE = '#d4aa8c';
  const GOLD = '#f9d976';
  const GOLD_SHADE = '#d4b040';
  const WHITE = '#ffffff';
  const lx = step === 0 ? 0 : 1;
  const rx = step === 0 ? 1 : 0;

  // === BASE BODY (all gods share) ===
  // Arms
  rect(7, 14, 3, 2, SKIN);
  rect(14, 14, 3, 2, SKIN);
  rect(7, 15, 3, 1, SKIN_SHADE);
  rect(14, 15, 3, 1, SKIN_SHADE);

  // Tunic base
  const tunicColor = (kind === 'ares') ? '#424242' :
    (kind === 'hephaestus') ? '#795548' :
      (kind === 'poseidon') ? '#bbdefb' :
        (kind === 'aphrodite') ? '#fce4ec' : WHITE;
  rect(9, 13, 6, 7, tunicColor);
  rect(9, 18, 6, 2, kind === 'ares' ? '#333' : '#e0e0e0');

  // Legs
  rect(10 + lx, 20, 2, 3, SKIN_SHADE);
  rect(13 + rx, 20, 2, 3, SKIN_SHADE);
  rect(10 + lx, 23, 2, 1, GOLD_SHADE);
  rect(13 + rx, 23, 2, 1, GOLD_SHADE);

  // Head
  rect(9, 7, 6, 6, SKIN);
  rect(9, 12, 6, 1, SKIN_SHADE);
  // Eyes
  rect(10.5, 10, 1, 1, OUT);
  rect(13.5, 10, 1, 1, OUT);
  // Mouth
  rect(11, 11.5, 2, 0.5, '#c48b6c');

  // Sash for most gods
  if (kind !== 'ares' && kind !== 'hephaestus') {
    rect(9, 15, 6, 1.5, tint);
  }

  // === GOD-SPECIFIC DETAILS ===
  if (kind === 'zeus') {
    // White hair + long beard
    rect(8, 7, 1.5, 5, WHITE);
    rect(14.5, 7, 1.5, 5, WHITE);
    rect(9, 6, 6, 1.5, WHITE);
    rect(9.5, 12, 5, 3, WHITE);
    rect(10, 14, 4, 1, '#e8e8e8');
    // Crown
    rect(9.5, 5, 1, 2, GOLD);
    rect(11.5, 4.5, 1, 2.5, GOLD);
    rect(13.5, 5, 1, 2, GOLD);
    // Thunderbolt in right hand
    const bf = (frame % 24) < 12;
    rect(15, 11, 1, 2, bf ? '#fff176' : GOLD);
    rect(16, 13, 1, 2, bf ? '#ffee58' : GOLD);
    rect(15, 15, 1, 2, bf ? '#fff176' : GOLD);
    rect(16, 17, 1, 2, bf ? '#ffee58' : GOLD);
    // Glow around bolt
    if (bf) { rect(14, 13, 1, 1, 'rgba(255,255,100,0.3)'); rect(17, 15, 1, 1, 'rgba(255,255,100,0.3)'); }
  } else if (kind === 'athena') {
    // Blue-crested helmet
    rect(8.5, 5, 7, 3, GOLD);
    rect(9, 4, 6, 1.5, GOLD_SHADE);
    rect(11, 2, 2, 3, tint);
    rect(10, 3, 4, 1, tint);
    // Owl eye visor
    rect(9, 8, 1.5, 1, GOLD_SHADE);
    rect(13.5, 8, 1.5, 1, GOLD_SHADE);
    // Shield (left)
    rect(5, 12, 4, 6, GOLD);
    rect(5.5, 13, 3, 4, tint);
    rect(6, 14, 2, 2, WHITE);
    // Spear (right)
    rect(16, 5, 1, 16, '#8b6914');
    rect(15.5, 4, 2, 2, '#9e9e9e');
  } else if (kind === 'hephaestus') {
    // Brown hair
    rect(9, 6.5, 6, 1, '#5d4037');
    rect(8, 7, 2, 3, '#5d4037');
    // Apron
    rect(9, 13, 6, 7, '#795548');
    rect(10, 14, 4, 1, '#5d4037');
    // Hammer (big, in right hand)
    rect(15, 10, 3, 3, '#757575');
    rect(15.5, 13, 1.5, 5, '#8b5a2b');
    rect(15, 10, 3, 1, '#9e9e9e');
    // Anvil sparks
    const sp = (frame % 20) < 10;
    if (sp) {
      rect(6, 16, 1, 1, '#ff9800');
      rect(7, 17, 1, 1, '#ffeb3b');
      rect(5, 18, 1, 1, '#ff5722');
    }
    // Forge glow left
    rect(5, 19, 3, 2, '#ff5722');
    rect(5.5, 18, 2, 1, '#ff9800');
  } else if (kind === 'apollo') {
    // Laurel wreath
    rect(8, 7, 1.5, 4, '#4caf50');
    rect(14.5, 7, 1.5, 4, '#4caf50');
    rect(9, 6, 6, 1.5, '#66bb6a');
    rect(10, 5.5, 4, 1, '#81c784');
    // Lyre in right hand
    rect(15, 12, 1, 5, GOLD);
    rect(18, 12, 1, 5, GOLD);
    rect(15, 11.5, 4, 1, GOLD);
    rect(16, 13, 1, 3, WHITE);
    rect(17, 13.5, 1, 2.5, WHITE);
    // Sun halo (pulsing)
    const hp = Math.sin(frame / 15) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(255,200,50,${0.08 + hp * 0.1})`;
    ctx.beginPath();
    ctx.arc(x + 24, y + 20, 22 + hp * 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'aphrodite') {
    // Flowing hair
    rect(7, 7, 2, 8, '#d4a26a');
    rect(15, 7, 2, 8, '#d4a26a');
    rect(9, 5.5, 6, 2, '#d4a26a');
    rect(8, 6, 2, 2, '#c4925a');
    rect(14, 6, 2, 2, '#c4925a');
    // Rose pink tunic was already set
    // Mirror in right hand
    rect(16, 11, 2, 3, '#e0e0e0');
    rect(16.5, 10, 1, 1, GOLD);
    rect(16.5, 14, 1, 3, GOLD_SHADE);
    // Hearts
    const hf = (frame % 40) < 20;
    if (hf) {
      rect(5, 10 - (frame % 8) / 4, 1.5, 1.5, '#e91e63');
      rect(18, 12 - (frame % 10) / 5, 1, 1, '#f48fb1');
    }
  } else if (kind === 'ares') {
    // Spartan helmet
    rect(8, 5, 8, 4, '#424242');
    rect(9, 4, 6, 1.5, '#333');
    rect(11, 2, 2, 3, '#b71c1c');
    rect(10, 3, 4, 1, '#c62828');
    // Visor slits (red eyes)
    rect(10.5, 10, 1, 1, '#f44336');
    rect(13.5, 10, 1, 1, '#f44336');
    // Dark armor
    rect(9, 13, 6, 7, '#424242');
    rect(10, 14, 4, 2, '#616161');
    // Sword right
    rect(16, 8, 1, 10, '#b0bec5');
    rect(16, 7, 1, 2, '#90a4ae');
    rect(15, 17, 3, 1, '#ffc107');
    // Shield left
    rect(5, 12, 4, 5, '#b71c1c');
    rect(5.5, 13, 3, 3, '#d32f2f');
    rect(6.5, 14, 1, 1, GOLD);
  } else if (kind === 'hermes') {
    // Winged helmet
    rect(9, 6, 6, 2, GOLD);
    rect(7, 6, 2, 1.5, WHITE);
    rect(15, 6, 2, 1.5, WHITE);
    rect(6, 6.5, 2, 1, '#e0e0e0');
    rect(16, 6.5, 2, 1, '#e0e0e0');
    // Caduceus staff
    rect(16, 6, 1, 14, '#8b6914');
    rect(15, 5, 1, 2, GOLD);
    rect(17, 5, 1, 2, GOLD);
    rect(14.5, 7, 1, 1.5, '#4caf50');
    rect(17.5, 7, 1, 1.5, '#4caf50');
    // Winged sandals
    rect(9, 22, 2, 1.5, WHITE);
    rect(14, 22, 2, 1.5, WHITE);
    // Speed lines when walking
    if (isWalking) {
      const sl = (frame % 6) < 3;
      if (sl) {
        rect(3, 16, 3, 0.5, 'rgba(100,200,100,0.5)');
        rect(4, 18, 3, 0.5, 'rgba(100,200,100,0.4)');
      }
    }
  } else if (kind === 'poseidon') {
    // Sea crown
    rect(9, 5, 1.5, 2.5, '#1565c0');
    rect(11, 4.5, 2, 3, '#1565c0');
    rect(13.5, 5, 1.5, 2.5, '#1565c0');
    rect(10, 6, 4, 1, '#42a5f5');
    // Blue-green beard
    rect(8, 9, 2, 4, '#4db6ac');
    rect(14, 9, 2, 4, '#4db6ac');
    rect(9, 12, 6, 2, '#4db6ac');
    // Trident
    rect(16, 4, 1, 16, '#8b6914');
    rect(15, 3, 1, 3, '#90a4ae');
    rect(16, 2, 1, 3, '#90a4ae');
    rect(17, 3, 1, 3, '#90a4ae');
    // Waves at feet
    const wv = (frame % 30) < 15 ? 0 : 1;
    rect(7 + wv, 22, 4, 1, '#64b5f6');
    rect(13 - wv, 22, 4, 1, '#42a5f5');
  } else if (kind === 'artemis') {
    // Silver hair tied back
    rect(8, 7, 1.5, 4, '#b0bec5');
    rect(14.5, 7, 1.5, 4, '#b0bec5');
    rect(9, 6, 6, 1.5, '#90a4ae');
    // Crescent moon crown
    rect(10, 5, 1, 2, '#ce93d8');
    rect(13, 5, 1, 2, '#ce93d8');
    rect(11, 4.5, 2, 1.5, '#e1bee7');
    // Bow in left hand
    rect(5, 10, 1, 8, '#8b6914');
    rect(4, 11, 1, 6, '#a1887f');
    // Arrow notched
    rect(6, 14, 5, 0.5, '#90a4ae');
    rect(5, 13.5, 1, 1.5, '#757575');
    // Quiver on back
    rect(15, 8, 2, 7, '#795548');
    rect(15.5, 7, 1, 1.5, '#90a4ae');
    rect(16, 7.5, 1, 1, '#90a4ae');
  }
}

// --- Textbox ---------------------------------------------------------------
function drawTextbox(lines) {
  const pad = 10;
  const boxH = 62;
  const x = pad;
  const y = H - boxH - pad;
  const w = W - pad * 2;
  const h = boxH;

  // outer dark border like Pokemon
  ctx.fillStyle = '#2d2b2a';
  ctx.fillRect(x, y, w, h);
  // inner border
  ctx.fillStyle = '#f6f0e0';
  ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  // inner bg
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(x + 6, y + 6, w - 12, h - 12);

  ctx.fillStyle = '#1b1a17';
  ctx.font = '12px monospace';

  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] || '');
    ctx.fillText(t.slice(0, 56), x + 14, y + 26 + i * 16);
  }
}

// --- Agent choreography -----------------------------------------------------
function spot(role) {
  // 9 gods in a tall 2-column format for 360x640 canvas
  // Cols: 90, 270 (center 180). Rows: 50, 160, 270, 380, 490
  return {
    pm: { x: 90, y: 50 },          // Athena top-left
    spec: { x: 270, y: 50 },       // Apollo top-right
    arq: { x: 90, y: 160 },        // Hephaestus mid-left
    ux: { x: 270, y: 160 },        // Aphrodite mid-right
    teamlead: { x: 180, y: 270 },  // Zeus center
    dev: { x: 90, y: 380 },        // Ares lower-left
    qa: { x: 270, y: 380 },        // Artemis lower-right
    dev2: { x: 90, y: 490 },       // Hermes bot-left
    devops: { x: 270, y: 490 },    // Poseidon bot-right
    center: { x: 180, y: 270 },
  }[role];
}

function agentPos(role, stageKey, frame) {
  const home = spot(role);
  if (!home) return { x: 196, y: 120, walking: false, active: false };
  const center = spot('center');

  if (stageKey === 'running') {
    const j = Math.sin((frame + role.length * 19) / 12) * 2;
    return { x: home.x + j, y: home.y + j, walking: true, active: false };
  }

  if (stageKey === role) {
    const t = (frame % 220) / 220;
    const ping = t < 0.5 ? t * 2 : (1 - t) * 2;
    const x = center.x + (home.x - center.x) * ping;
    const y = center.y + (home.y - center.y) * ping;
    return { x, y, walking: true, active: true };
  }

  const seed = role.length * 37 + role.charCodeAt(0) * 7;
  const driftX = Math.sin((frame + seed) / 18) * 1.6;
  const driftY = Math.cos((frame + seed * 2) / 24) * 1.0;
  const idleStep = ((frame + seed) % 52) < 10;
  return { x: home.x + driftX, y: home.y + driftY, walking: idleStep, active: false };
}

const ALL_ROLES = ['teamlead', 'pm', 'arq', 'spec', 'ux', 'dev', 'dev2', 'devops', 'qa'];

function getVisualRoleActivity(stageKey) {
  const flags = {};
  ALL_ROLES.forEach(r => flags[r] = false);
  const roleStatus = Array.isArray(state?.roleStatus) ? state.roleStatus : [];
  for (const row of roleStatus) {
    const rowState = String(row?.state || '').toLowerCase();
    if (rowState !== 'working') continue;
    const role = String(row?.role || '').toUpperCase();
    if (role === 'TEAMLEAD') flags.teamlead = true;
    else if (role === 'PM') flags.pm = true;
    else if (role === 'ARQ') flags.arq = true;
    else if (role === 'SPEC') flags.spec = true;
    else if (role === 'UX') flags.ux = true;
    else if (role === 'DEV') flags.dev = true;
    else if (role === 'DEV2') flags.dev2 = true;
    else if (role === 'DEVOPS') flags.devops = true;
    else if (role === 'QA') flags.qa = true;
  }

  const hasAny = Object.values(flags).some(Boolean);
  if (!hasAny) {
    if (flags.hasOwnProperty(stageKey)) flags[stageKey] = true;
    else if (stageKey === 'running') {
      ALL_ROLES.forEach(r => flags[r] = true);
    }
  }
  return flags;
}

// --- State ------------------------------------------------------------------
let state = {
  status: { stage: 'idle', item: 'n/a', files: [], next: 'n/a', updatedAt: 'n/a' },
  health: { agentState: 'idle', transportState: 'unknown', activeContainers: 0, activeContainerIds: [] },
  runtimeAlerts: { level: 'ok', items: [] },
  runbook: { report: '', summary: [] },
  todo: [],
  events: [],
  actions: [],
};
let lastKanbanSig = '';
let lastEventsSig = '';
let lastRuntimeSig = '';

async function updateTodoStateApi(id, stateName) {
  try {
    await fetch('/api/todo/update-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, state: stateName }),
    });
  } catch {
    // ignore; next poll will reflect actual state
  }
}

async function taskActionApi(id, action) {
  const res = await fetch('/api/task/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function renderKanban(items) {
  if (!ui.kanban) return;
  const prevScroll = ui.kanban.scrollLeft || 0;
  const frag = document.createDocumentFragment();
  const lanes = [
    { key: 'todo', label: 'To Do', klass: 'lane--todo' },
    { key: 'planning', label: 'Planning', klass: 'lane--planning' },
    { key: 'doing', label: 'Doing', klass: 'lane--doing' },
    { key: 'blocked', label: 'Blocked', klass: 'lane--blocked' },
    { key: 'done', label: 'Done', klass: 'lane--done' },
  ];

  const normalized = Array.isArray(items) ? items.map((it) => ({
    ...it,
    state: normalizeTodoState(it.state),
  })) : [];

  for (const lane of lanes) {
    const col = document.createElement('section');
    col.className = `lane ${lane.klass}`;

    const head = document.createElement('div');
    head.className = 'lane__head';
    const title = document.createElement('div');
    title.className = 'lane__title';
    title.textContent = lane.label;
    const count = document.createElement('div');
    count.className = 'lane__count';
    const laneItems = normalized.filter((it) => it.state === lane.key);
    count.textContent = String(laneItems.length);
    head.appendChild(title);
    head.appendChild(count);

    const body = document.createElement('div');
    body.className = 'lane__body';

    if (laneItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ev';
      empty.textContent = 'Sin tareas';
      body.appendChild(empty);
    } else {
      for (const it of laneItems) {
        const card = document.createElement('article');
        card.className = 'task';

        const id = document.createElement('div');
        id.className = 'task__id';
        id.textContent = it.id || 'N/A';
        const owner = document.createElement('div');
        owner.className = 'task__owner';
        const src = String(it.source || '').trim();
        owner.textContent = `${it.owner || 'sin owner'}${src ? ` · ${src}` : ''}`;
        const scope = document.createElement('div');
        scope.className = 'task__scope';
        scope.textContent = it.scope || 'sin scope';

        const moves = document.createElement('div');
        moves.className = 'task__moves';
        for (const target of lanes) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `moveBtn moveBtn--${target.key}`;
          if (target.key === it.state) b.classList.add('is-active');
          b.textContent = target.key;
          b.disabled = target.key === it.state;
          b.addEventListener('click', async () => {
            b.disabled = true;
            await updateTodoStateApi(it.id, target.key);
            setTimeout(poll, 80);
          });
          moves.appendChild(b);
        }

        const sendAll = document.createElement('button');
        sendAll.type = 'button';
        sendAll.className = 'btn btn--soft';
        sendAll.textContent = 'Mandar a todos';
        sendAll.addEventListener('click', async () => {
          sendAll.disabled = true;
          try {
            await fetch('/api/todo/send-all', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: it.id }),
            });
          } catch {
            // ignore
          } finally {
            sendAll.disabled = false;
          }
          setTimeout(poll, 80);
        });
        moves.appendChild(sendAll);

        const makeActionBtn = (label, action, variant = 'btn--soft') => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `btn ${variant}`;
          b.textContent = label;
          b.addEventListener('click', async () => {
            b.disabled = true;
            try {
              const out = await taskActionApi(it.id, action);
              showRuntimeMessage(out?.message || `${action} OK`);
            } catch (err) {
              showRuntimeMessage(`Task action error (${it.id}): ${String(err?.message || 'unknown').slice(0, 120)}`, 'error');
            } finally {
              b.disabled = false;
            }
            setTimeout(poll, 100);
          });
          return b;
        };

        if (it.state !== 'done') moves.appendChild(makeActionBtn('Requeue', 'requeue'));
        if (it.state === 'blocked') moves.appendChild(makeActionBtn('Retry', 'retry'));
        if (it.state !== 'blocked') moves.appendChild(makeActionBtn('Block', 'block'));
        moves.appendChild(makeActionBtn('Clear stale', 'clear_stale'));

        card.appendChild(id);
        card.appendChild(owner);
        card.appendChild(scope);
        card.appendChild(moves);
        body.appendChild(card);
      }
    }

    col.appendChild(head);
    col.appendChild(body);
    frag.appendChild(col);
  }
  ui.kanban.replaceChildren(frag);
  ui.kanban.scrollLeft = prevScroll;
}

function taskPrefix(id) {
  const m = String(id || '').toUpperCase().match(/^([A-Z]+)-\d+/);
  return m ? m[1] : 'OTHER';
}

function renderKanbanMetrics(items) {
  const normalized = Array.isArray(items) ? items.map((it) => ({
    ...it,
    state: normalizeTodoState(it.state),
  })) : [];
  const total = normalized.length;
  const done = normalized.filter((x) => x.state === 'done').length;
  const blocked = normalized.filter((x) => x.state === 'blocked').length;
  const wip = normalized.filter((x) => x.state === 'doing' || x.state === 'planning').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  setText(ui.kanbanKpiOverall, `TOTAL: ${total}`);
  setText(ui.kanbanKpiProgress, `DONE: ${done} (${pct}%)`);
  setText(ui.kanbanKpiWip, `WIP: ${wip}`);
  setText(ui.kanbanKpiBlocked, `BLOCKED: ${blocked}`);
  if (ui.kanbanProgressFill) ui.kanbanProgressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  if (!ui.kanbanPortfolio) return;
  ui.kanbanPortfolio.innerHTML = '';

  const byPrefix = new Map();
  for (const it of normalized) {
    const p = taskPrefix(it.id);
    const row = byPrefix.get(p) || { total: 0, done: 0, blocked: 0, wip: 0 };
    row.total += 1;
    if (it.state === 'done') row.done += 1;
    if (it.state === 'blocked') row.blocked += 1;
    if (it.state === 'doing' || it.state === 'planning') row.wip += 1;
    byPrefix.set(p, row);
  }

  const sorted = [...byPrefix.entries()]
    .sort((a, b) => {
      const aOpen = a[1].total - a[1].done;
      const bOpen = b[1].total - b[1].done;
      return bOpen - aOpen;
    })
    .slice(0, 8);

  for (const [prefix, row] of sorted) {
    const chip = document.createElement('div');
    chip.className = 'portfolioChip';
    const pp = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
    chip.textContent = `${prefix} ${row.done}/${row.total} (${pp}%) · wip ${row.wip} · blocked ${row.blocked}`;
    ui.kanbanPortfolio.appendChild(chip);
  }
}

function signatureKanban(items) {
  if (!Array.isArray(items)) return '[]';
  return [...items]
    .map((it) => ({
      id: String(it?.id || ''),
      owner: String(it?.owner || ''),
      state: normalizeTodoState(it?.state),
      scope: String(it?.scope || ''),
    }))
    .sort((a, b) => `${a.id}|${a.owner}`.localeCompare(`${b.id}|${b.owner}`))
    .map((it) => `${it.id}|${it.owner}|${it.state}|${it.scope}`)
    .join('||');
}

function signatureEvents(items) {
  if (!Array.isArray(items)) return '[]';
  return items.slice(-30).map((it) => `${it.ts || ''}|${it.kind || it.action || ''}|${it.msg || it.detail || it.item || ''}`).join('||');
}

function signatureRuntime(st, h, runtimeAlerts, runtimeMetrics) {
  const parts = [
    st?.stage || '',
    st?.item || '',
    st?.next || '',
    st?.updatedAt || '',
    String(h?.agentState || ''),
    String(h?.transportState || ''),
    String(h?.activeContainers || 0),
    String(h?.staleContainers || 0),
    String(h?.orphanContainers || 0),
    String(runtimeAlerts?.level || ''),
    String(runtimeMetrics?.updatedAt || ''),
  ];
  return parts.join('|');
}

function renderEvents(items) {
  if (!ui.events) return;
  ui.events.innerHTML = '';
  if (!items || items.length === 0) {
    const el = document.createElement('div');
    el.className = 'ev';
    el.textContent = 'Sin eventos todavía (esperando actividad).';
    ui.events.appendChild(el);
    return;
  }

  for (const it of items.slice(-30).reverse()) {
    const box = document.createElement('div');
    box.className = 'ev';

    const row = document.createElement('div');
    row.className = 'ev__row';
    const k = document.createElement('div');
    k.className = 'ev__k';
    const kind = String(it.kind || it.action || 'event');
    const stage = it.stage ? ` ${String(it.stage)}` : '';
    k.textContent = `${kind}${stage}`;
    const t = document.createElement('div');
    t.className = 'ev__t';
    t.textContent = String(it.ts || '').replace('T', ' ').replace('Z', 'Z');
    row.appendChild(k);
    row.appendChild(t);

    const msg = document.createElement('div');
    msg.className = 'ev__msg';
    const m = it.msg || it.detail || it.item || '';
    msg.textContent = String(m).slice(0, 240);

    box.appendChild(row);
    if (m) box.appendChild(msg);
    ui.events.appendChild(box);
  }
}

function renderRuntimeMetrics(runtimeMetrics, runtimeAlerts) {
  const level = String(runtimeAlerts?.level || 'ok').toLowerCase();
  const items = Array.isArray(runtimeAlerts?.items) ? runtimeAlerts.items : [];
  const c = runtimeMetrics?.counters || {};

  if (ui.runtimeAlertLevel) {
    ui.runtimeAlertLevel.classList.remove('pill--warn', 'pill--ok', 'pill--critical');
    if (level === 'critical') ui.runtimeAlertLevel.classList.add('pill--critical');
    else if (level === 'warn') ui.runtimeAlertLevel.classList.add('pill--warn');
    else ui.runtimeAlertLevel.classList.add('pill--ok');
    ui.runtimeAlertLevel.textContent = `ALERT: ${level.toUpperCase()}`;
  }
  setText(ui.runtimeUpdated, `updatedAt: ${runtimeMetrics?.updatedAt || 'n/a'}`);
  setText(ui.runtimeAlertItems, items.length > 0 ? items.join(' | ') : 'sin alertas');

  // Show modal when alert level escalates or items change
  const levelChanged = level !== _lastAlertLevel;
  const itemsSig = items.join('|');
  const oldItemsSig = _lastAlertItems.join('|');
  if ((levelChanged && level !== 'ok') || (level !== 'ok' && itemsSig !== oldItemsSig)) {
    showAlertModal(level, items);
  }
  _lastAlertLevel = level;
  _lastAlertItems = items;

  if (!ui.runtimeCounters) return;
  ui.runtimeCounters.innerHTML = '';
  const metrics = [
    ['requests', Number(c.requestsStarted || 0)],
    ['outputs', Number(c.outputsSent || 0)],
    ['agent_errors', Number(c.agentErrors || 0)],
    ['validation_fails', Number(c.validationFailures || 0)],
    ['contract_fails', Number(c.contractFailures || 0)],
    ['artifact_fails', Number(c.artifactFailures || 0)],
    ['dev_gate_fails', Number(c.devGateFailures || 0)],
    ['blocked_open', Math.max(0, Number(c.blockedQuestionsSet || 0) - Number(c.blockedQuestionsResolved || 0))],
  ];
  const skillMetrics = runtimeMetrics?.skillMetrics && typeof runtimeMetrics.skillMetrics === 'object'
    ? Object.entries(runtimeMetrics.skillMetrics)
    : [];
  const skillRows = skillMetrics
    .map(([skill, row]) => {
      const dispatched = Number(row?.dispatched || 0);
      const failed = Number(row?.failed || 0);
      const retries = Number(row?.retries || 0);
      const validationFails = Number(row?.validationFails || 0);
      const failRate = dispatched > 0 ? Math.round((failed / dispatched) * 100) : 0;
      return { skill, dispatched, failed, retries, validationFails, failRate };
    })
    .filter((x) => x.dispatched > 0 || x.failed > 0 || x.validationFails > 0)
    .sort((a, b) => b.failRate - a.failRate || b.dispatched - a.dispatched)
    .slice(0, 3);
  for (const row of skillRows) {
    metrics.push([
      `skill:${row.skill}`,
      `${row.failed}/${row.dispatched} fail (${row.failRate}%) r=${row.retries} v=${row.validationFails}`,
    ]);
  }
  for (const [name, value] of metrics) {
    const card = document.createElement('div');
    card.className = 'metric';
    const k = document.createElement('div');
    k.className = 'metric__k';
    k.textContent = String(name);
    const v = document.createElement('div');
    v.className = 'metric__v';
    v.textContent = String(value);
    card.appendChild(k);
    card.appendChild(v);
    ui.runtimeCounters.appendChild(card);
  }
}

function renderRoleStatus(items) {
  if (!ui.runtimeRoles) return;
  ui.runtimeRoles.innerHTML = '';
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const role = String(it?.role || 'N/A');
    const st = String(it?.state || 'idle').toLowerCase();
    const ago = Number(it?.lastSeenAgoMs || 0);
    const seen = Number.isFinite(ago) && ago > 0 ? `${fmtMs(ago)} ago` : 'n/a';

    const card = document.createElement('div');
    card.className = `roleCard roleCard--${st}`;
    const name = document.createElement('div');
    name.className = 'roleCard__name';
    name.textContent = role;
    const state = document.createElement('div');
    state.className = 'roleCard__state';
    state.textContent = st;
    const seenEl = document.createElement('div');
    seenEl.className = 'roleCard__seen';
    seenEl.textContent = `last: ${seen}`;
    card.appendChild(name);
    card.appendChild(state);
    card.appendChild(seenEl);
    ui.runtimeRoles.appendChild(card);
  }
}

function renderActiveLanes(items) {
  if (!ui.activeLanes) return;
  ui.activeLanes.innerHTML = '';
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ev';
    empty.textContent = 'Lanes activos: sin actividad de subagentes';
    ui.activeLanes.appendChild(empty);
    return;
  }

  for (const it of list.slice(0, 12)) {
    const card = document.createElement('div');
    card.className = 'laneTaskCard';

    const head = document.createElement('div');
    head.className = 'laneTaskCard__head';
    const id = document.createElement('div');
    id.className = 'laneTaskCard__id';
    id.textContent = String(it?.taskId || 'N/A');
    head.appendChild(id);
    card.appendChild(head);

    const lanesWrap = document.createElement('div');
    lanesWrap.className = 'laneTaskCard__lanes';
    const lanes = Array.isArray(it?.lanes) ? it.lanes : [];
    for (const lane of lanes) {
      const chip = document.createElement('div');
      const state = String(lane?.state || 'idle').toLowerCase();
      chip.className = `laneChip laneChip--${state}`;
      const role = String(lane?.role || 'ROLE');
      const dep = lane?.dependency ? ` (${String(lane.dependency)})` : '';
      chip.textContent = `${role}: ${state}${dep}`;
      lanesWrap.appendChild(chip);
    }
    card.appendChild(lanesWrap);

    if (it?.teamleadSummary?.file) {
      const merge = document.createElement('div');
      merge.className = 'laneTaskCard__merge';
      merge.textContent = `TeamLead merge: ${String(it.teamleadSummary.file)}`;
      card.appendChild(merge);
    }

    ui.activeLanes.appendChild(card);
  }
}

function renderBlockedQueue(items) {
  if (!ui.blockedQueue) return;
  ui.blockedQueue.innerHTML = '';
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ev';
    empty.textContent = 'Blocked Queue: sin preguntas pendientes';
    ui.blockedQueue.appendChild(empty);
    return;
  }

  for (const it of list) {
    const taskId = String(it?.taskId || 'N/A').toUpperCase();
    const stage = String(it?.stage || 'BLOCKED');
    const qs = Array.isArray(it?.questions) ? it.questions : [];

    const card = document.createElement('div');
    card.className = 'blockedCard';

    const head = document.createElement('div');
    head.className = 'blockedCard__head';
    const id = document.createElement('div');
    id.className = 'blockedCard__id';
    id.textContent = taskId;
    const meta = document.createElement('div');
    meta.className = 'blockedCard__meta';
    meta.textContent = stage;
    head.appendChild(id);
    head.appendChild(meta);

    const qsEl = document.createElement('div');
    qsEl.className = 'blockedCard__qs';
    qsEl.textContent = qs.map((q) => `• ${String(q)}`).join('  ');

    const actions = document.createElement('div');
    actions.className = 'blockedCard__actions';
    const input = document.createElement('input');
    input.className = 'blockedCard__input';
    input.placeholder = 'Respuesta/decisión para desbloquear...';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--soft';
    btn.textContent = 'Resolver';
    btn.addEventListener('click', async () => {
      const decision = String(input.value || '').trim();
      if (!decision) return;
      btn.disabled = true;
      try {
        const out = await resolveBlockedQuestionApi(taskId, decision);
        if (ui.runtimeMsg) {
          ui.runtimeMsg.textContent = out?.message || `task ${taskId} desbloqueada`;
          ui.runtimeMsg.classList.remove('is-error');
          ui.runtimeMsg.classList.add('is-ok');
        }
      } catch (err) {
        if (ui.runtimeMsg) {
          ui.runtimeMsg.textContent = `No se pudo resolver ${taskId}: ${String(err?.message || 'error').slice(0, 120)}`;
          ui.runtimeMsg.classList.add('is-error');
          ui.runtimeMsg.classList.remove('is-ok');
        }
      } finally {
        btn.disabled = false;
      }
      setTimeout(poll, 120);
    });
    actions.appendChild(input);
    actions.appendChild(btn);

    card.appendChild(head);
    card.appendChild(qsEl);
    card.appendChild(actions);
    ui.blockedQueue.appendChild(card);
  }
}

function renderRuntimeHistory(items) {
  if (!ui.runtimeHistory) return;
  ui.runtimeHistory.innerHTML = '';
  const list = Array.isArray(items) ? items.slice(-8).reverse() : [];
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ev';
    empty.textContent = 'Alert History: sin cambios recientes';
    ui.runtimeHistory.appendChild(empty);
    return;
  }
  for (const it of list) {
    const level = String(it?.level || 'ok').toLowerCase();
    const row = document.createElement('div');
    row.className = `runtimeHistory__row runtimeHistory__row--${level}`;

    const head = document.createElement('div');
    head.className = 'runtimeHistory__head';
    const left = document.createElement('div');
    left.textContent = `${String(it?.level || 'ok').toUpperCase()} · ${String(it?.stage || 'n/a')}`;
    const right = document.createElement('div');
    right.textContent = String(it?.ts || '').replace('T', ' ').replace('Z', 'Z');
    head.appendChild(left);
    head.appendChild(right);

    const msg = document.createElement('div');
    msg.className = 'runtimeHistory__msg';
    const itemsText = Array.isArray(it?.items) ? it.items.join(' | ') : '';
    msg.textContent = itemsText || 'sin detalle';
    row.appendChild(head);
    row.appendChild(msg);
    ui.runtimeHistory.appendChild(row);
  }
}

function renderRunbook(runbook) {
  const lines = Array.isArray(runbook?.summary) ? runbook.summary : [];
  if (ui.runbookSummary) {
    ui.runbookSummary.textContent = lines.length > 0 ? lines.join('\n') : 'Sin datos de runbook.';
  }
}

async function resetRuntimeCountersApi() {
  const res = await fetch('/api/runtime/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function runWatchdogNowApi() {
  const res = await fetch('/api/watchdog/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function syncLanesNowApi() {
  const res = await fetch('/api/lanes/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function resolveBlockedQuestionApi(taskId, decision) {
  const res = await fetch('/api/workflow/resolve-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, decision }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function poll() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state = data;

    const st = data.status || {};
    const h = data.health || {};
    setText(ui.pillMode, `MODE: ${String(data.appMode || 'prod').toUpperCase()}`);
    const runtimeSig = signatureRuntime(st, h, data.runtimeAlerts, data.runtimeMetrics);
    if (runtimeSig !== lastRuntimeSig) {
      setText(ui.pillStage, `ETAPA: ${st.stage || '...'}`);
      setText(ui.pillAgent, `AGENT: ${h.agentState || '...'}`);
      setText(ui.pillWa, `WA: ${h.transportState || '...'}`);
      setWarn(ui.pillWa, String(h.transportState || '') !== 'connected');
      setWarn(
        ui.pillAgent,
        String(h.agentState || '') === 'error' ||
        Number(h.orphanContainers || 0) > 0 ||
        Number(h.staleContainers || 0) > 0,
      );
      setText(ui.pillUpdated, `ULTIMO_UPDATE: ${st.updatedAt || '...'}`);
      setText(ui.item, st.item || '...');
      setText(ui.next, st.next || '...');
      setText(ui.files, (st.files || []).join('\n') || '...');
      const cCount = Number(h.activeContainers || 0);
      const cIds = Array.isArray(h.activeContainerIds) ? h.activeContainerIds : [];
      const staleCount = Number(h.staleContainers || 0);
      const orphanCount = Number(h.orphanContainers || 0);
      const oldest = Number(h.oldestContainerAgeMs || 0);
      const head = `activos=${cCount} stale=${staleCount} huérfanos=${orphanCount} oldest=${fmtMs(oldest)}`;
      setText(ui.containers, cCount > 0 ? `${head}\n${cIds.join('\n')}` : head);
      renderRuntimeMetrics(data.runtimeMetrics, data.runtimeAlerts);
      renderRoleStatus(data.roleStatus);
      renderActiveLanes(data.activeTaskLanes);
      renderBlockedQueue(data.blockedQueue);
      renderRuntimeHistory(data.runtimeAlertHistory);
      renderRunbook(data.runbook);
      lastRuntimeSig = runtimeSig;
    }

    setText(ui.pillNow, `API: ${data.now || '...'}`);

    const kanbanSig = signatureKanban(data.todo || []);
    if (kanbanSig !== lastKanbanSig) {
      renderKanban(data.todo || []);
      renderKanbanMetrics(data.todo || []);
      lastKanbanSig = kanbanSig;
    }

    const eventsSig = signatureEvents(data.events || []);
    if (eventsSig !== lastEventsSig) {
      renderEvents(data.events || []);
      lastEventsSig = eventsSig;
    }
  } catch {
    // keep last state; show that polling is failing
    setText(ui.pillNow, 'API: offline');
  } finally {
    setTimeout(poll, 1500);
  }
}

let frame = 0;
function tick() {
  frame++;
  const stageKey = parseStage(state?.status?.stage);
  const activeRoles = getVisualRoleActivity(stageKey);

  // map + buildings
  drawMap(frame);

  // temples — tall 2-column layout for 360x640 canvas
  // Row 1
  drawBuilding(60, 20, 'ATHENA', PAL.pm, activeRoles.pm);
  drawBuilding(240, 20, 'APOLLO', PAL.spec, activeRoles.spec);
  // Row 2
  drawBuilding(60, 130, 'HEPH', PAL.arq, activeRoles.arq);
  drawBuilding(240, 130, 'APHRO', PAL.ux, activeRoles.ux);
  // Row 3 (center)
  drawBuilding(150, 240, 'ZEUS', PAL.teamlead, activeRoles.teamlead);
  // Row 4
  drawBuilding(60, 350, 'ARES', PAL.dev, activeRoles.dev);
  drawBuilding(240, 350, 'ARTMS', PAL.qa, activeRoles.qa);
  // Row 5
  drawBuilding(60, 460, 'HERMES', PAL.dev2, activeRoles.dev2);
  drawBuilding(240, 460, 'PSDN', PAL.devops, activeRoles.devops);

  // agents — all 9 gods
  for (const role of ALL_ROLES) {
    const isActive = Boolean(activeRoles[role]);
    const p = isActive
      ? agentPos(role, role, frame)
      : agentPos(role, stageKey, frame);
    drawMonster(p.x, p.y, role, frame, p.active, p.walking);
  }

  // textbox status
  const st = state?.status || {};
  const h = state?.health || {};
  const line1 = `ETAPA ${String(st.stage || '...')}`.toUpperCase();
  const lastEv = (state?.events && state.events.length) ? state.events[state.events.length - 1] : null;
  const hint = lastEv && (lastEv.msg || lastEv.item) ? (lastEv.msg || lastEv.item) : st.item;
  const activeNames = Object.entries(activeRoles)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => String(k).toUpperCase())
    .join(',');
  const laneLine = activeNames ? `WORKING ${activeNames}` : '';
  const line2 = (laneLine || `${String(h.agentState || '').toUpperCase()} / WA ${String(h.transportState || '').toUpperCase()}`).slice(0, 46) || String(hint || '').slice(0, 46) || '...';
  drawTextbox([line1, line2]);

  if (stageKey === 'error') {
    ctx.fillStyle = 'rgba(255, 0, 90, 0.18)';
    ctx.fillRect(0, 0, W, H);
  }
  if (String(state?.runtimeAlerts?.level || '').toLowerCase() === 'critical') {
    const pulse = 0.14 + (Math.sin(frame / 8) + 1) * 0.08;
    ctx.fillStyle = `rgba(255, 36, 90, ${pulse.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
  }

  requestAnimationFrame(tick);
}

poll();
tick();

if (ui.todoClearDone) {
  ui.todoClearDone.addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Limpiar completados',
      message: 'Se van a remover todos los items completados del Kanban.',
      icon: '🧹',
      confirmLabel: 'Limpiar',
    });
    if (!ok) return;
    ui.todoClearDone.disabled = true;
    try {
      await fetch('/api/todo/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'completed' }),
      });
    } catch {
      // ignore
    } finally {
      ui.todoClearDone.disabled = false;
    }
    setTimeout(poll, 80);
  });
}

if (ui.todoClearAll) {
  ui.todoClearAll.addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Borrar todo el Kanban',
      message: 'Esto va a borrar TODOS los items del todo.md. Esta acción no se puede deshacer.',
      icon: '🗑️',
      confirmLabel: 'Borrar todo',
    });
    if (!ok) return;
    ui.todoClearAll.disabled = true;
    try {
      await fetch('/api/todo/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all' }),
      });
    } catch {
      // ignore
    } finally {
      ui.todoClearAll.disabled = false;
    }
    setTimeout(poll, 80);
  });
}

if (ui.todoCreateForm) {
  ui.todoCreateForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = String(ui.todoNewId?.value || '').trim().toUpperCase();
    const owner = String(ui.todoNewOwner?.value || '').trim();
    const scope = String(ui.todoNewScope?.value || '').trim();
    const stateName = String(ui.todoNewState?.value || 'todo').trim().toLowerCase();
    if (!scope) {
      if (ui.todoCreateMsg) {
        ui.todoCreateMsg.textContent = 'Scope requerido';
        ui.todoCreateMsg.classList.add('is-error');
        ui.todoCreateMsg.classList.remove('is-ok');
      }
      return;
    }

    if (ui.todoCreateBtn) ui.todoCreateBtn.disabled = true;
    try {
      const res = await fetch('/api/todo/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          owner,
          scope,
          state: stateName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      if (ui.todoNewId) ui.todoNewId.value = '';
      if (ui.todoNewOwner) ui.todoNewOwner.value = '';
      if (ui.todoNewScope) ui.todoNewScope.value = '';
      if (ui.todoNewState) ui.todoNewState.value = 'todo';
      if (ui.todoCreateMsg) {
        ui.todoCreateMsg.textContent = data?.message || 'Tarea creada';
        ui.todoCreateMsg.classList.remove('is-error');
        ui.todoCreateMsg.classList.add('is-ok');
      }
    } catch {
      if (ui.todoCreateMsg) {
        ui.todoCreateMsg.textContent = 'No se pudo agregar la tarea (revisa ID/scope o auth)';
        ui.todoCreateMsg.classList.add('is-error');
        ui.todoCreateMsg.classList.remove('is-ok');
      }
    } finally {
      if (ui.todoCreateBtn) ui.todoCreateBtn.disabled = false;
    }
    setTimeout(poll, 80);
  });
}

if (ui.runtimeResetBtn) {
  ui.runtimeResetBtn.addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Resetear Contadores',
      message: 'Se van a resetear todos los contadores de runtime-metrics a cero.',
      icon: '🔄',
      confirmLabel: 'Resetear',
    });
    if (!ok) return;
    ui.runtimeResetBtn.disabled = true;
    try {
      const out = await resetRuntimeCountersApi();
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = out?.message || 'runtime metrics reseteadas';
        ui.runtimeMsg.classList.remove('is-error');
        ui.runtimeMsg.classList.add('is-ok');
      }
    } catch {
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = 'No se pudo resetear runtime metrics';
        ui.runtimeMsg.classList.add('is-error');
        ui.runtimeMsg.classList.remove('is-ok');
      }
    } finally {
      ui.runtimeResetBtn.disabled = false;
    }
    setTimeout(poll, 80);
  });
}

if (ui.runtimeWatchdogBtn) {
  ui.runtimeWatchdogBtn.addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Ejecutar Watchdog',
      message: 'Se va a ejecutar el watchdog manualmente ahora. Esto puede detener containers stale.',
      icon: '🐕',
      confirmLabel: 'Ejecutar',
    });
    if (!ok) return;
    ui.runtimeWatchdogBtn.disabled = true;
    try {
      const out = await runWatchdogNowApi();
      if (ui.runtimeMsg) {
        const details = String(out?.output || '').trim();
        ui.runtimeMsg.textContent = details
          ? `${out?.message || 'watchdog ejecutado'}: ${details.slice(0, 120)}`
          : (out?.message || 'watchdog ejecutado');
        ui.runtimeMsg.classList.remove('is-error');
        ui.runtimeMsg.classList.add('is-ok');
      }
    } catch (err) {
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = `Watchdog error: ${String(err?.message || 'unknown').slice(0, 140)}`;
        ui.runtimeMsg.classList.add('is-error');
        ui.runtimeMsg.classList.remove('is-ok');
      }
    } finally {
      ui.runtimeWatchdogBtn.disabled = false;
    }
    setTimeout(poll, 120);
  });
}

if (ui.runtimeSyncLanesBtn) {
  ui.runtimeSyncLanesBtn.addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Sincronizar Lanes',
      message: 'Se van a reconciliar todos los lane states con el workflow. Lanes huérfanas serán marcadas como error.',
      icon: '🔗',
      confirmLabel: 'Sincronizar',
    });
    if (!ok) return;
    ui.runtimeSyncLanesBtn.disabled = true;
    try {
      const out = await syncLanesNowApi();
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = out?.message || 'sync lanes ejecutado';
        ui.runtimeMsg.classList.remove('is-error');
        ui.runtimeMsg.classList.add('is-ok');
      }
    } catch (err) {
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = `Sync lanes error: ${String(err?.message || 'unknown').slice(0, 140)}`;
        ui.runtimeMsg.classList.add('is-error');
        ui.runtimeMsg.classList.remove('is-ok');
      }
    } finally {
      ui.runtimeSyncLanesBtn.disabled = false;
    }
    setTimeout(poll, 120);
  });
}

if (ui.runbookCopyBtn) {
  ui.runbookCopyBtn.addEventListener('click', async () => {
    const report = String(state?.runbook?.report || '').trim();
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = 'Runbook copiado al portapapeles';
        ui.runtimeMsg.classList.remove('is-error');
        ui.runtimeMsg.classList.add('is-ok');
      }
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        // ignore fallback failure
      }
      document.body.removeChild(ta);
      if (ui.runtimeMsg) {
        ui.runtimeMsg.textContent = 'Runbook listo (copy fallback aplicado)';
        ui.runtimeMsg.classList.remove('is-error');
        ui.runtimeMsg.classList.add('is-ok');
      }
    }
  });
}
