let BOARD_SIZE = 10;

document.getElementById('btn-mute').onclick = () => {
  const muted = AudioEngine.toggleMute();
  document.getElementById('btn-mute').innerHTML = muted ? '&#128263;' : '&#128266;';
};

const SHIP_DEFS = [
  { name: 'Czteromasztowiec', shape: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: 'Trojmasztowiec 1', shape: [[0, 0], [1, 0], [2, 0]] },
  { name: 'Trojmasztowiec 2', shape: [[0, 0], [1, 0], [2, 0]] },
  { name: 'Dwumasztowiec 1', shape: [[0, 0], [1, 0]] },
  { name: 'Dwumasztowiec 2', shape: [[0, 0], [1, 0]] },
  { name: 'Dwumasztowiec 3', shape: [[0, 0], [1, 0]] },
  { name: 'Jednomasztowiec 1', shape: [[0, 0]] },
  { name: 'Jednomasztowiec 2', shape: [[0, 0]] },
  { name: 'Jednomasztowiec 3', shape: [[0, 0]] },
  { name: 'Jednomasztowiec 4', shape: [[0, 0]] },
];

const screens = {
  lobby: document.getElementById('screen-lobby'),
  waiting: document.getElementById('screen-waiting'),
  pass: document.getElementById('screen-pass'),
  place: document.getElementById('screen-place'),
  game: document.getElementById('screen-game'),
  multiSetup: document.getElementById('screen-multi-setup'),
  target: document.getElementById('screen-target'),
  onlineSetup: document.getElementById('screen-online-setup'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function colLetter(x) {
  return String.fromCharCode(65 + x);
}

function symbolForState(state) {
  if (state === 'hit') return '✕';
  if (state === 'miss') return '•';
  if (state === 'sunk') return '☒';
  return '';
}

// ---------- Shape / rotation math ----------

function rotateOffset([dx, dy], rotation) {
  switch (rotation % 4) {
    case 1: return [-dy, dx];
    case 2: return [-dx, -dy];
    case 3: return [dy, -dx];
    default: return [dx, dy];
  }
}

function mirrorOffset([dx, dy], mirrored) {
  return mirrored ? [-dx, dy] : [dx, dy];
}

function shapeCells(anchorX, anchorY, shape, rotation, mirrored) {
  const transformed = shape
    .map(off => mirrorOffset(off, mirrored))
    .map(off => rotateOffset(off, rotation));
  const minDx = Math.min(...transformed.map(c => c[0]));
  const minDy = Math.min(...transformed.map(c => c[1]));
  return transformed.map(([dx, dy]) => [anchorX + dx - minDx, anchorY + dy - minDy]);
}

function cellsInBounds(cells) {
  return cells.every(([x, y]) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE);
}

function shapeBoundingBox(shape) {
  const xs = shape.map(c => c[0]);
  const ys = shape.map(c => c[1]);
  return {
    w: Math.max(...xs) - Math.min(...xs) + 1,
    h: Math.max(...ys) - Math.min(...ys) + 1,
    minX: Math.min(...xs),
    minY: Math.min(...ys),
  };
}

function isStraightLine(cells) {
  if (cells.length <= 1) return false;
  const allSameY = cells.every(([, y]) => y === cells[0][1]);
  const allSameX = cells.every(([x]) => x === cells[0][0]);
  return allSameY || allSameX;
}

function cellPct() {
  return 100 / BOARD_SIZE;
}

function shipCenterPercent(cells) {
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX + 1) / 2 * cellPct(), cy: (minY + maxY + 1) / 2 * cellPct() };
}

// ---------- Ship graphics ----------

function shipSVGMarkup(size, horizontal) {
  const len = size * 40;
  const w = horizontal ? len : 40;
  const h = horizontal ? 40 : len;
  const turretCount = size - 1;
  let turrets = '';
  for (let i = 0; i < turretCount; i++) {
    const t = (i + 1) / (turretCount + 1);
    const cx = horizontal ? len * t : 20;
    const cy = horizontal ? 20 : len * t;
    turrets += `<circle cx="${cx}" cy="${cy}" r="5" class="ship-turret" />`;
  }
  const hullPoints = horizontal
    ? `4,20 14,6 ${len - 14},6 ${len - 4},20 ${len - 14},34 14,34`
    : `20,4 34,14 34,${len - 14} 20,${len - 4} 6,${len - 14} 6,14`;
  const deckLine = horizontal
    ? `<line x1="10" y1="20" x2="${len - 10}" y2="20" class="ship-deck-line" />`
    : `<line x1="20" y1="10" x2="20" y2="${len - 10}" class="ship-deck-line" />`;
  const bowTip = horizontal
    ? `<circle cx="${len - 6}" cy="20" r="3" class="ship-bow" />`
    : `<circle cx="20" cy="6" r="3" class="ship-bow" />`;
  return `<svg viewBox="0 0 ${w} ${h}" class="ship-svg" preserveAspectRatio="none">
    <polygon points="${hullPoints}" class="ship-hull" />
    ${deckLine}
    ${turrets}
    ${bowTip}
  </svg>`;
}

function renderShipOverlays(gridEl, ships, isSunkFn) {
  gridEl.querySelectorAll('.ship-overlay').forEach(el => el.remove());
  ships.forEach(ship => {
    const cells = ship.cells;
    const sunk = isSunkFn ? isSunkFn(ship) : false;

    if (cells.length === 1) {
      const [x, y] = cells[0];
      const el = document.createElement('div');
      el.className = 'ship-overlay' + (sunk ? ' sunk' : '');
      el.style.left = `${x * cellPct()}%`;
      el.style.top = `${y * cellPct()}%`;
      el.style.width = `${cellPct()}%`;
      el.style.height = `${cellPct()}%`;
      el.style.animationDelay = `${(Math.random() * -3).toFixed(2)}s`;
      el.innerHTML = '<div class="ship-single-dot"></div>';
      gridEl.appendChild(el);
    } else if (isStraightLine(cells)) {
      const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const horizontal = (maxX - minX) >= (maxY - minY);
      const el = document.createElement('div');
      el.className = 'ship-overlay' + (sunk ? ' sunk' : '');
      el.style.left = `${minX * cellPct()}%`;
      el.style.top = `${minY * cellPct()}%`;
      el.style.width = `${(maxX - minX + 1) * cellPct()}%`;
      el.style.height = `${(maxY - minY + 1) * cellPct()}%`;
      el.style.animationDelay = `${(Math.random() * -3).toFixed(2)}s`;
      el.innerHTML = shipSVGMarkup(cells.length, horizontal);
      gridEl.appendChild(el);
    } else {
      const segDelay = `${(Math.random() * -3).toFixed(2)}s`;
      cells.forEach(([x, y]) => {
        const seg = document.createElement('div');
        seg.className = 'ship-overlay ship-segment' + (sunk ? ' sunk' : '');
        seg.style.left = `${x * cellPct()}%`;
        seg.style.top = `${y * cellPct()}%`;
        seg.style.width = `${cellPct()}%`;
        seg.style.height = `${cellPct()}%`;
        seg.style.animationDelay = segDelay;
        seg.innerHTML = '<div class="seg-inner"></div>';
        gridEl.appendChild(seg);
      });
    }
  });
}

function spawnSinkBurst(gridEl, cxPercent, cyPercent) {
  if (!gridEl) return;
  const burst = document.createElement('div');
  burst.className = 'sink-burst';
  burst.style.left = `${cxPercent}%`;
  burst.style.top = `${cyPercent}%`;
  const count = 10;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'sink-burst-particle';
    p.style.setProperty('--angle', `${(360 / count) * i}deg`);
    burst.appendChild(p);
  }
  gridEl.appendChild(burst);

  const wave1 = document.createElement('div');
  wave1.className = 'sink-wave';
  wave1.style.left = `${cxPercent}%`;
  wave1.style.top = `${cyPercent}%`;
  gridEl.appendChild(wave1);

  const wave2 = document.createElement('div');
  wave2.className = 'sink-wave sink-wave-delayed';
  wave2.style.left = `${cxPercent}%`;
  wave2.style.top = `${cyPercent}%`;
  gridEl.appendChild(wave2);

  setTimeout(() => {
    burst.remove();
    wave1.remove();
    wave2.remove();
  }, 800);
}

function spawnHitPoof(gridEl, x, y) {
  if (!gridEl) return;
  const cxPercent = (x + 0.5) * cellPct();
  const cyPercent = (y + 0.5) * cellPct();
  const poof = document.createElement('div');
  poof.className = 'sink-burst';
  poof.style.left = `${cxPercent}%`;
  poof.style.top = `${cyPercent}%`;
  const count = 6;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'hit-poof-particle';
    p.style.setProperty('--angle', `${(360 / count) * i}deg`);
    poof.appendChild(p);
  }
  gridEl.appendChild(poof);
  setTimeout(() => poof.remove(), 450);
}

function spawnMissRipple(gridEl, x, y) {
  if (!gridEl) return;
  const cxPercent = (x + 0.5) * cellPct();
  const cyPercent = (y + 0.5) * cellPct();
  const ripple = document.createElement('div');
  ripple.className = 'miss-ripple';
  ripple.style.left = `${cxPercent}%`;
  ripple.style.top = `${cyPercent}%`;
  gridEl.appendChild(ripple);
  setTimeout(() => ripple.remove(), 550);
}

function spawnProjectile(gridEl, x, y) {
  if (!gridEl) return;
  const targetXPercent = (x + 0.5) * cellPct();
  const targetYPercent = (y + 0.5) * cellPct();
  const shell = document.createElement('div');
  shell.className = 'cannon-shell';
  shell.style.left = `${targetXPercent}%`;
  shell.style.top = `${targetYPercent}%`;
  shell.style.setProperty('--rise', `${40 + Math.random() * 30}px`);
  gridEl.appendChild(shell);
  setTimeout(() => shell.remove(), 380);
}

function renderLegendMini(shape, extraClass) {
  const { w, h, minX, minY } = shapeBoundingBox(shape);
  const wrap = document.createElement('div');
  wrap.className = 'ship-legend-mini' + (extraClass ? ' ' + extraClass : '');
  wrap.style.gridTemplateColumns = `repeat(${w}, 9px)`;
  wrap.style.gridTemplateRows = `repeat(${h}, 9px)`;
  const filled = new Set(shape.map(([x, y]) => `${x - minX},${y - minY}`));
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const cell = document.createElement('div');
      cell.className = 'ship-legend-mini-cell' + (filled.has(`${xx},${yy}`) ? ' filled' : '');
      wrap.appendChild(cell);
    }
  }
  return wrap;
}

// ---------- Generic board builder ----------

function buildBoard(containerId, opts) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  container.className = 'board-wrapper' + (opts.small ? ' small' : '');

  const corner = document.createElement('div');
  corner.className = 'corner';
  container.appendChild(corner);

  const colLabels = document.createElement('div');
  colLabels.className = 'col-labels';
  colLabels.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;
  for (let x = 0; x < BOARD_SIZE; x++) {
    const l = document.createElement('div');
    l.className = 'label-cell';
    l.textContent = colLetter(x);
    colLabels.appendChild(l);
  }
  container.appendChild(colLabels);

  const rowLabels = document.createElement('div');
  rowLabels.className = 'row-labels';
  rowLabels.style.gridTemplateRows = `repeat(${BOARD_SIZE}, 1fr)`;
  for (let y = 0; y < BOARD_SIZE; y++) {
    const l = document.createElement('div');
    l.className = 'label-cell';
    l.textContent = String(y + 1);
    rowLabels.appendChild(l);
  }
  container.appendChild(rowLabels);

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${BOARD_SIZE}, 1fr)`;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      const extraClasses = opts.getCellClass ? opts.getCellClass(x, y) : [];
      extraClasses.forEach(c => c && cell.classList.add(c));
      const content = opts.getCellContent ? opts.getCellContent(x, y) : '';
      if (content) cell.textContent = content;
      if (opts.onClick) cell.onclick = () => opts.onClick(x, y);
      if (opts.onHover) cell.addEventListener('mouseenter', () => opts.onHover(x, y));
      grid.appendChild(cell);
    }
  }
  if (opts.onLeaveGrid) grid.addEventListener('mouseleave', opts.onLeaveGrid);
  container.appendChild(grid);
  return grid;
}

function triggerCellAnimation(containerId, x, y, hit) {
  const cell = document.querySelector(`#${containerId} .grid .cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;
  cell.classList.add(hit ? 'anim-hit' : 'anim-miss');
}

// ---------- Placement (shared between online and local) ----------

let placeShipIdx = 0;
let currentRotation = 0;
let currentMirrored = false;
let lastHoverX = null;
let lastHoverY = null;
let selectedIdx = 0;
let placedByIndex = [];
let placementOrder = [];
let placedSet = new Set();
let onPlacementReady = null;
let manualCells = [];

function hasConflict(x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (placedSet.has(`${x + dx},${y + dy}`)) return true;
    }
  }
  return false;
}

function isAdjacentToAny(x, y, cells) {
  return cells.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1);
}

function placedShipsList() {
  return placedByIndex.filter(Boolean);
}

function firstUnplacedIndex() {
  return placedByIndex.findIndex(s => !s);
}

function startPlacementUI(onReady) {
  showScreen('place');
  currentRotation = 0;
  currentMirrored = false;
  lastHoverX = null;
  lastHoverY = null;
  selectedIdx = 0;
  placedByIndex = new Array(SHIP_DEFS.length).fill(null);
  placementOrder = [];
  placedSet = new Set();
  manualCells = [];
  onPlacementReady = onReady;
  document.getElementById('place-message').textContent = '';
  refreshPlacementUI();
}

function refreshPlacementUI() {
  renderPlaceHint();
  renderShipsLegend();
  buildPlaceBoardUI();

  const allPlaced = placedByIndex.every(Boolean);
  const pending = !placedByIndex[selectedIdx];
  const freeform = SHIP_DEFS[selectedIdx].freeform;
  document.getElementById('btn-ready').classList.toggle('hidden', !allPlaced);
  document.getElementById('btn-rotate').classList.toggle('hidden', !pending || !!freeform);
  document.getElementById('btn-mirror').classList.add('hidden');
  document.getElementById('btn-undo').classList.toggle('hidden', placementOrder.length === 0 && manualCells.length === 0);
}

function renderPlaceHint() {
  const def = SHIP_DEFS[selectedIdx];
  if (!placedByIndex[selectedIdx]) {
    if (def.freeform) {
      document.getElementById('place-hint').textContent = `Ustaw: ${def.name} - wybierz pole ${manualCells.length + 1}/${def.shape.length} (sasiadujace), kliknij ostatnie by cofnac`;
    } else {
      document.getElementById('place-hint').textContent = `Ustaw: ${def.name}`;
    }
  } else {
    document.getElementById('place-hint').textContent = 'Wszystkie statki rozstawione. Kliknij statek na liscie, aby go przestawic.';
  }
}

function renderShipsLegend() {
  const legend = document.getElementById('ships-legend');
  legend.innerHTML = '';
  SHIP_DEFS.forEach((def, i) => {
    const item = document.createElement('div');
    item.className = 'ship-legend-item legend-in';
    item.style.animationDelay = `${i * 0.05}s`;
    if (placedByIndex[i]) item.classList.add('placed');
    if (i === selectedIdx) item.classList.add('current');
    item.appendChild(renderLegendMini(def.shape));
    item.onclick = () => selectShip(i);
    legend.appendChild(item);
  });
}

function selectShip(i) {
  if (placedByIndex[i]) {
    placedByIndex[i].cells.forEach(([x, y]) => placedSet.delete(`${x},${y}`));
    placedByIndex[i] = null;
    placementOrder = placementOrder.filter(idx => idx !== i);
  }
  selectedIdx = i;
  currentRotation = 0;
  currentMirrored = false;
  manualCells = [];
  document.getElementById('place-message').textContent = '';
  refreshPlacementUI();
}

function clearPreview() {
  document.querySelectorAll('#place-board .grid .cell.preview-valid, #place-board .grid .cell.preview-invalid')
    .forEach(el => el.classList.remove('preview-valid', 'preview-invalid'));
}

function previewShip(x, y) {
  lastHoverX = x;
  lastHoverY = y;
  clearPreview();
  if (placedByIndex[selectedIdx]) return;

  if (SHIP_DEFS[selectedIdx].freeform) {
    if (manualCells.some(([cx, cy]) => cx === x && cy === y)) return;
    const valid = !hasConflict(x, y) && (manualCells.length === 0 || isAdjacentToAny(x, y, manualCells));
    const el = document.querySelector(`#place-board .grid .cell[data-x="${x}"][data-y="${y}"]`);
    if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
    return;
  }

  const cells = shapeCells(x, y, SHIP_DEFS[selectedIdx].shape, currentRotation, currentMirrored);
  const valid = cellsInBounds(cells) && cells.every(([cx, cy]) => !hasConflict(cx, cy));
  cells.forEach(([cx, cy]) => {
    if (cx < 0 || cx >= BOARD_SIZE || cy < 0 || cy >= BOARD_SIZE) return;
    const el = document.querySelector(`#place-board .grid .cell[data-x="${cx}"][data-y="${cy}"]`);
    if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
  });
}

function buildPlaceBoardUI() {
  const grid = buildBoard('place-board', {
    onClick: (x, y) => (SHIP_DEFS[selectedIdx].freeform ? handleManualCellClick(x, y) : tryPlaceShip(x, y)),
    onHover: previewShip,
    onLeaveGrid: clearPreview,
  });
  const overlayList = placedShipsList().concat(manualCells.length > 0 ? [{ cells: manualCells }] : []);
  renderShipOverlays(grid, overlayList, () => false);
}

function handleManualCellClick(x, y) {
  if (placedByIndex[selectedIdx]) return;
  const idxInManual = manualCells.findIndex(([mx, my]) => mx === x && my === y);
  if (idxInManual !== -1) {
    manualCells = manualCells.slice(0, idxInManual);
    document.getElementById('place-message').textContent = '';
    refreshPlacementUI();
    return;
  }

  const size = SHIP_DEFS[selectedIdx].shape.length;
  if (manualCells.length >= size) return;

  if (hasConflict(x, y)) {
    document.getElementById('place-message').textContent = 'Statki nie moga sie stykac ze soba.';
    return;
  }
  if (manualCells.length > 0 && !isAdjacentToAny(x, y, manualCells)) {
    document.getElementById('place-message').textContent = 'Kolejne pole musi sasiadowac z poprzednim.';
    return;
  }

  manualCells.push([x, y]);
  document.getElementById('place-message').textContent = '';

  if (manualCells.length === size) {
    const cells = manualCells.slice();
    cells.forEach(([cx, cy]) => placedSet.add(`${cx},${cy}`));
    placedByIndex[selectedIdx] = { cells };
    placementOrder.push(selectedIdx);
    manualCells = [];

    const next = firstUnplacedIndex();
    if (next !== -1) selectedIdx = next;
    currentRotation = 0;
    currentMirrored = false;
  }
  refreshPlacementUI();
}

function tryPlaceShip(x, y) {
  if (placedByIndex[selectedIdx]) return;
  const cells = shapeCells(x, y, SHIP_DEFS[selectedIdx].shape, currentRotation, currentMirrored);

  if (!cellsInBounds(cells)) {
    document.getElementById('place-message').textContent = 'Statek nie miesci sie na planszy.';
    return;
  }
  if (cells.some(([cx, cy]) => hasConflict(cx, cy))) {
    document.getElementById('place-message').textContent = 'Statki nie moga sie stykac ze soba.';
    return;
  }

  cells.forEach(([cx, cy]) => placedSet.add(`${cx},${cy}`));
  placedByIndex[selectedIdx] = { cells };
  placementOrder.push(selectedIdx);
  document.getElementById('place-message').textContent = '';

  const next = firstUnplacedIndex();
  if (next !== -1) selectedIdx = next;
  currentRotation = 0;
  currentMirrored = false;
  refreshPlacementUI();
}

document.getElementById('btn-rotate').onclick = () => {
  currentRotation = (currentRotation + 1) % 4;
  if (lastHoverX !== null) previewShip(lastHoverX, lastHoverY);
};

document.getElementById('btn-mirror').onclick = () => {
  currentMirrored = !currentMirrored;
  if (lastHoverX !== null) previewShip(lastHoverX, lastHoverY);
};

document.getElementById('btn-undo').onclick = () => {
  if (manualCells.length > 0) {
    manualCells.pop();
    document.getElementById('place-message').textContent = '';
    refreshPlacementUI();
    return;
  }
  if (placementOrder.length === 0) return;
  const idx = placementOrder.pop();
  placedByIndex[idx].cells.forEach(([x, y]) => placedSet.delete(`${x},${y}`));
  placedByIndex[idx] = null;
  selectedIdx = idx;
  currentRotation = 0;
  currentMirrored = false;
  document.getElementById('place-message').textContent = '';
  refreshPlacementUI();
};

document.getElementById('btn-ready').onclick = () => {
  if (onPlacementReady) onPlacementReady(placedShipsList());
};

// ---------- Online mode (2-4 players over the network) ----------

let ws;
let playerIdx = null;
let roomCode = null;
let myTurn = false;

const netMulti = {
  playerCount: 2,
  hits: [],
  sunkShips: [],
  alive: [],
  viewTarget: null,
};

function onlinePlayerName(i) {
  if (i === playerIdx) return 'Ty';
  return `Gracz ${i + 1}`;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
  ws.onclose = () => {
    document.getElementById('game-message').textContent = 'Polaczenie przerwane.';
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'created':
      roomCode = msg.code;
      playerIdx = msg.playerIdx;
      netMulti.playerCount = msg.playerCount;
      BOARD_SIZE = 10 + 2 * (msg.playerCount - 2);
      document.getElementById('room-code').textContent = roomCode;
      updateWaitingHint(msg.joinedCount, msg.playerCount);
      showScreen('waiting');
      break;
    case 'joined':
      roomCode = msg.code;
      playerIdx = msg.playerIdx;
      netMulti.playerCount = msg.playerCount;
      BOARD_SIZE = 10 + 2 * (msg.playerCount - 2);
      if (msg.joinedCount < msg.playerCount) {
        document.getElementById('room-code').textContent = roomCode;
        updateWaitingHint(msg.joinedCount, msg.playerCount);
        showScreen('waiting');
      } else {
        startPlacementUI(onOnlineReady);
      }
      break;
    case 'player_joined':
      if (msg.joinedCount >= msg.playerCount) {
        startPlacementUI(onOnlineReady);
      } else {
        updateWaitingHint(msg.joinedCount, msg.playerCount);
      }
      break;
    case 'error':
      document.getElementById('lobby-message').textContent = msg.message;
      break;
    case 'opponent_ready':
      document.getElementById('place-message').textContent = 'Przynajmniej jeden przeciwnik jest gotowy.';
      break;
    case 'start':
      playerIdx = msg.yourIdx;
      netMulti.playerCount = msg.playerCount;
      myTurn = msg.turn === playerIdx;
      startOnlineGame();
      break;
    case 'fire_result':
      applyOnlineFireResult(msg);
      break;
    case 'opponent_left':
      document.getElementById('game-message').textContent = 'Jeden z graczy opuscil gre.';
      break;
  }
}

function updateWaitingHint(joinedCount, playerCount) {
  document.getElementById('waiting-hint').textContent = `Czekam na graczy... (${joinedCount}/${playerCount} dolaczylo)`;
}

function onOnlineReady(ships) {
  ws.send(JSON.stringify({ type: 'place_ships', ships }));
  document.getElementById('btn-ready').disabled = true;
  document.getElementById('place-message').textContent = 'Czekamy na pozostalych graczy...';
}

document.getElementById('btn-create').onclick = () => {
  showScreen('onlineSetup');
  const container = document.getElementById('online-count-buttons');
  container.innerHTML = '';
  [2, 3, 4].forEach((n) => {
    const btn = document.createElement('button');
    btn.textContent = `${n} graczy`;
    btn.onclick = () => {
      BOARD_SIZE = 10 + 2 * (n - 2);
      connect();
      ws.onopen = () => ws.send(JSON.stringify({ type: 'create', playerCount: n }));
    };
    container.appendChild(btn);
  });
};

document.getElementById('btn-join').onclick = () => {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!code) return;
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', code }));
};

function startOnlineGame() {
  showScreen('game');
  netMulti.hits = Array.from({ length: netMulti.playerCount }, () => ({}));
  netMulti.sunkShips = Array.from({ length: netMulti.playerCount }, () => []);
  netMulti.alive = new Array(netMulti.playerCount).fill(true);
  netMulti.viewTarget = aliveOpponentsOnline()[0];
  document.getElementById('game-message').classList.remove('game-over-banner');
  document.getElementById('own-board-title').textContent = 'Ty';
  renderOnlineTargetSwitcher();
  buildEnemyBoardOnline();
  buildOwnBoardOnline();
  updateTurnIndicator();
}

function pulseTurnIndicator() {
  const el = document.getElementById('turn-indicator');
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function updateTurnIndicator() {
  document.getElementById('turn-indicator').textContent = myTurn ? 'Twoja tura - strzelaj!' : 'Czekaj na swoja ture...';
  pulseTurnIndicator();
}

function aliveOpponentsOnline() {
  const result = [];
  for (let i = 0; i < netMulti.playerCount; i++) {
    if (i !== playerIdx && netMulti.alive[i]) result.push(i);
  }
  return result;
}

function renderOnlineTargetSwitcher() {
  const container = document.getElementById('online-target-switcher');
  const opponents = aliveOpponentsOnline();
  if (netMulti.playerCount <= 2 || opponents.length <= 1) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = '';
  opponents.forEach((i) => {
    const btn = document.createElement('button');
    btn.textContent = onlinePlayerName(i);
    if (i === netMulti.viewTarget) btn.style.boxShadow = '0 0 0 2px #1d9e75';
    btn.onclick = () => {
      netMulti.viewTarget = i;
      renderOnlineTargetSwitcher();
      buildEnemyBoardOnline();
    };
    container.appendChild(btn);
  });
}

function buildEnemyBoardOnline() {
  const target = netMulti.viewTarget;
  document.getElementById('enemy-board-title').textContent = target === null ? 'Przeciwnik' : onlinePlayerName(target);
  const hits = target === null ? {} : netMulti.hits[target];
  const grid = buildBoard('enemy-board', {
    getCellClass: (x, y) => [hits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(hits[`${x},${y}`]),
    onClick: (x, y) => fireOnline(x, y, target),
  });
  renderShipOverlays(grid, target === null ? [] : netMulti.sunkShips[target], () => true);
}

function buildOwnBoardOnline() {
  const myHits = netMulti.hits[playerIdx] || {};
  const grid = buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [myHits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(myHits[`${x},${y}`]),
  });
  renderShipOverlays(grid, placedShipsList(), (ship) => ship.cells.every(([x, y]) => myHits[`${x},${y}`] === 'sunk'));
}

function fireOnline(x, y, target) {
  if (!myTurn || target === null || target === undefined) return;
  const key = `${x},${y}`;
  if (netMulti.hits[target][key]) return;
  AudioEngine.playCannonShot();
  spawnProjectile(document.querySelector('#enemy-board .grid'), x, y);
  ws.send(JSON.stringify({ type: 'fire', x, y, target }));
}

function applyOnlineFireResult(msg) {
  const key = `${msg.x},${msg.y}`;
  const iFired = msg.shooter === playerIdx;
  const iAmTarget = msg.target === playerIdx;
  const targetHits = netMulti.hits[msg.target];
  targetHits[key] = msg.hit ? 'hit' : 'miss';

  if (msg.sunk && msg.sunkCells) {
    msg.sunkCells.forEach(([sx, sy]) => {
      targetHits[`${sx},${sy}`] = 'sunk';
    });
    netMulti.sunkShips[msg.target].push({ cells: msg.sunkCells });
  }

  if (msg.targetEliminated) {
    netMulti.alive[msg.target] = false;
    if (netMulti.viewTarget === msg.target) {
      const remaining = aliveOpponentsOnline();
      netMulti.viewTarget = remaining.length ? remaining[0] : null;
    }
  }

  renderOnlineTargetSwitcher();
  buildEnemyBoardOnline();
  buildOwnBoardOnline();

  const involvesMyView = msg.target === netMulti.viewTarget || iAmTarget;
  if (involvesMyView) {
    const boardId = iAmTarget ? 'own-board' : 'enemy-board';
    triggerCellAnimation(boardId, msg.x, msg.y, msg.hit);
    const boardGrid = document.querySelector(`#${boardId} .grid`);
    if (msg.sunk && msg.sunkCells) {
      const { cx, cy } = shipCenterPercent(msg.sunkCells);
      spawnSinkBurst(boardGrid, cx, cy);
      AudioEngine.playExplosion();
    } else if (msg.hit) {
      spawnHitPoof(boardGrid, msg.x, msg.y);
      AudioEngine.playHitImpact();
    } else {
      spawnMissRipple(boardGrid, msg.x, msg.y);
      AudioEngine.playSplash();
    }
  }

  myTurn = msg.nextTurn === playerIdx;
  updateTurnIndicator();

  const gm = document.getElementById('game-message');
  if (msg.gameOver) {
    gm.textContent = msg.winner === playerIdx ? 'Wygrywasz! Zostajesz jedynym niezatopionym graczem.' : `${onlinePlayerName(msg.winner)} wygrywa!`;
    gm.classList.add('game-over-banner');
  } else if (msg.targetEliminated) {
    gm.textContent = iAmTarget ? 'Twoja flota zostala zatopiona - wypadasz z gry.' : `${onlinePlayerName(msg.target)} zostaje wyeliminowany!`;
  } else if (msg.hit) {
    gm.textContent = iFired ? 'Trafienie!' : (iAmTarget ? `${onlinePlayerName(msg.shooter)} Cie trafil.` : 'Trafienie u innego gracza.');
  } else {
    gm.textContent = iFired ? 'Pudlo.' : (iAmTarget ? `${onlinePlayerName(msg.shooter)} nie trafil.` : 'Pudlo u innego gracza.');
  }
}

// ---------- Local (one-device, hotseat) mode ----------

const local = {
  ships: [null, null],
  hits: [new Set(), new Set()],
  turn: 0,
  placingPlayer: 0,
};

document.getElementById('btn-local').onclick = () => {
  BOARD_SIZE = 10;
  local.ships = [null, null];
  local.hits = [new Set(), new Set()];
  local.turn = 0;
  local.placingPlayer = 0;
  showPass(`Gracz 1`, 'Rozstaw swoje statki. Przekaz telefon graczowi 1, jesli jeszcze go nie trzyma.', () => {
    startPlacementUI(onLocalReady);
  });
};

function onLocalReady(ships) {
  local.ships[local.placingPlayer] = ships;
  if (local.placingPlayer === 0) {
    local.placingPlayer = 1;
    showPass('Przekaz telefon graczowi 2', 'Gracz 2 rozstawia swoje statki. Gracz 1 nie powinien patrzec na ekran.', () => {
      startPlacementUI(onLocalReady);
    });
  } else {
    local.turn = 0;
    showPass('Gracz 1', 'Wszystkie statki rozstawione. Twoja tura - strzelaj pierwszy!', () => {
      startLocalTurn();
    });
  }
}

function showPass(title, message, onContinue) {
  showScreen('pass');
  document.getElementById('pass-title').textContent = title;
  document.getElementById('pass-message').textContent = message;
  document.getElementById('btn-pass-continue').onclick = onContinue;
}

function cellStateLocal(targetPlayerIdx, x, y) {
  const key = `${x},${y}`;
  if (!local.hits[targetPlayerIdx].has(key)) return null;
  const ship = local.ships[targetPlayerIdx].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  if (!ship) return 'miss';
  const sunk = ship.cells.every(([sx, sy]) => local.hits[targetPlayerIdx].has(`${sx},${sy}`));
  return sunk ? 'sunk' : 'hit';
}

function shipFullySunkLocal(targetPlayerIdx, ship) {
  return ship.cells.every(([x, y]) => local.hits[targetPlayerIdx].has(`${x},${y}`));
}

function startLocalTurn() {
  showScreen('game');
  const gm = document.getElementById('game-message');
  gm.textContent = '';
  gm.classList.remove('game-over-banner');
  document.getElementById('turn-indicator').textContent = `Gracz ${local.turn + 1} - Twoja tura, strzelaj!`;
  pulseTurnIndicator();

  const shooter = local.turn;
  const target = shooter === 0 ? 1 : 0;

  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (x, y) => [local.hits[target].has(`${x},${y}`) ? cellStateLocal(target, x, y) : null],
    getCellContent: (x, y) => local.hits[target].has(`${x},${y}`) ? symbolForState(cellStateLocal(target, x, y)) : '',
    onClick: (x, y) => fireLocal(x, y, shooter, target),
  });
  const sunkTargetShips = local.ships[target].filter(ship => shipFullySunkLocal(target, ship));
  renderShipOverlays(enemyGrid, sunkTargetShips, () => true);

  const ownGrid = buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [local.hits[shooter].has(`${x},${y}`) ? cellStateLocal(shooter, x, y) : null],
    getCellContent: (x, y) => local.hits[shooter].has(`${x},${y}`) ? symbolForState(cellStateLocal(shooter, x, y)) : '',
  });
  renderShipOverlays(ownGrid, local.ships[shooter], (ship) => shipFullySunkLocal(shooter, ship));
}

function fireLocal(x, y, shooter, target) {
  const key = `${x},${y}`;
  if (local.hits[target].has(key)) return;

  AudioEngine.playCannonShot();
  spawnProjectile(document.querySelector('#enemy-board .grid'), x, y);
  local.hits[target].add(key);
  const hitShip = local.ships[target].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  const isHit = !!hitShip;
  const shipJustSunk = isHit && shipFullySunkLocal(target, hitShip);
  const allSunk = local.ships[target].every(s => shipFullySunkLocal(target, s));

  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (cx, cy) => [local.hits[target].has(`${cx},${cy}`) ? cellStateLocal(target, cx, cy) : null],
    getCellContent: (cx, cy) => local.hits[target].has(`${cx},${cy}`) ? symbolForState(cellStateLocal(target, cx, cy)) : '',
    onClick: () => {},
  });
  const sunkTargetShips = local.ships[target].filter(ship => shipFullySunkLocal(target, ship));
  renderShipOverlays(enemyGrid, sunkTargetShips, () => true);
  triggerCellAnimation('enemy-board', x, y, isHit);

  if (shipJustSunk) {
    const { cx, cy } = shipCenterPercent(hitShip.cells);
    spawnSinkBurst(enemyGrid, cx, cy);
    AudioEngine.playExplosion();
  } else if (isHit) {
    spawnHitPoof(enemyGrid, x, y);
    AudioEngine.playHitImpact();
  } else {
    spawnMissRipple(enemyGrid, x, y);
    AudioEngine.playSplash();
  }

  if (allSunk) {
    const gm = document.getElementById('game-message');
    gm.textContent = 'Zatopiony ostatni statek!';
    gm.classList.add('game-over-banner');
    document.getElementById('turn-indicator').textContent = `Gracz ${shooter + 1} wygrywa!`;
    return;
  }

  document.getElementById('game-message').textContent = isHit ? (shipJustSunk ? 'Zatopiony!' : 'Trafienie!') : 'Pudlo.';

  local.turn = target;
  setTimeout(() => {
    showPass(`Przekaz telefon graczowi ${target + 1}`, `Gracz ${target + 1}, kliknij Dalej gdy telefon jest u Ciebie.`, () => {
      startLocalTurn();
    });
  }, 1200);
}

// ---------- Multi (3-4 players, hotseat + computer) mode ----------

const multi = {
  playerCount: 0,
  computerCount: 0,
  humanCount: 0,
  isAI: [],
  humanQueue: [],
  ships: [],
  hits: [],
  alive: [],
  currentPlayer: 0,
};

function playerName(i) {
  return i < multi.humanCount ? `Gracz ${i + 1}` : `Komputer ${i - multi.humanCount + 1}`;
}

function cellConflictsWithSet(set, x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (set.has(`${x + dx},${y + dy}`)) return true;
    }
  }
  return false;
}

function randomAIFleet() {
  const occupied = new Set();
  const ships = [];
  SHIP_DEFS.forEach((def) => {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 400) {
      attempts++;
      const rotation = Math.floor(Math.random() * 4);
      const mirrored = Math.random() < 0.5;
      const x = Math.floor(Math.random() * BOARD_SIZE);
      const y = Math.floor(Math.random() * BOARD_SIZE);
      const cells = shapeCells(x, y, def.shape, rotation, mirrored);
      if (!cellsInBounds(cells)) continue;
      if (cells.some(([cx, cy]) => cellConflictsWithSet(occupied, cx, cy))) continue;
      cells.forEach(([cx, cy]) => occupied.add(`${cx},${cy}`));
      ships.push({ cells });
      placed = true;
    }
  });
  return ships;
}

document.getElementById('btn-multi').onclick = () => {
  multi.playerCount = 0;
  multi.computerCount = 0;
  showScreen('multiSetup');
  renderMultiTotalButtons();
  renderMultiComputerButtons();
};

function renderMultiTotalButtons() {
  const container = document.getElementById('multi-total-buttons');
  container.innerHTML = '';
  [2, 3, 4].forEach((n) => {
    const btn = document.createElement('button');
    btn.textContent = `${n} graczy`;
    if (multi.playerCount === n) btn.style.boxShadow = '0 0 0 2px #1d9e75';
    btn.onclick = () => {
      multi.playerCount = n;
      if (multi.computerCount > n - 1) multi.computerCount = n - 1;
      renderMultiTotalButtons();
      renderMultiComputerButtons();
    };
    container.appendChild(btn);
  });
}

function renderMultiComputerButtons() {
  const container = document.getElementById('multi-computer-buttons');
  container.innerHTML = '';
  if (!multi.playerCount) return;
  for (let c = 0; c <= multi.playerCount - 1; c++) {
    const btn = document.createElement('button');
    btn.textContent = String(c);
    if (multi.computerCount === c) btn.style.boxShadow = '0 0 0 2px #1d9e75';
    btn.onclick = () => {
      multi.computerCount = c;
      renderMultiComputerButtons();
    };
    container.appendChild(btn);
  }
}

document.getElementById('btn-multi-start').onclick = () => {
  if (!multi.playerCount) return;
  const total = multi.playerCount;
  const computerCount = multi.computerCount;
  multi.humanCount = total - computerCount;
  multi.isAI = new Array(total).fill(false);
  for (let i = multi.humanCount; i < total; i++) multi.isAI[i] = true;
  startMultiSetupComplete();
};

function startMultiSetupComplete() {
  const total = multi.playerCount;
  BOARD_SIZE = 10 + 2 * (total - 2);
  multi.ships = new Array(total).fill(null);
  multi.hits = Array.from({ length: total }, () => new Set());
  multi.alive = new Array(total).fill(true);

  for (let i = 0; i < total; i++) {
    if (multi.isAI[i]) multi.ships[i] = randomAIFleet();
  }

  multi.humanQueue = [];
  for (let i = 0; i < total; i++) {
    if (!multi.isAI[i]) multi.humanQueue.push(i);
  }

  beginNextHumanPlacement(0);
}

function beginNextHumanPlacement(queueIdx) {
  if (queueIdx >= multi.humanQueue.length) {
    multi.currentPlayer = 0;
    showPass('Wszyscy gotowi', 'Wszystkie statki rozstawione. Zaczynamy!', () => {
      beginMultiTurn(multi.currentPlayer);
    });
    return;
  }
  const playerIdx = multi.humanQueue[queueIdx];
  showPass(playerName(playerIdx), `${playerName(playerIdx)}, rozstaw swoje statki. Kliknij Dalej gdy telefon jest u Ciebie.`, () => {
    startPlacementUI((ships) => {
      multi.ships[playerIdx] = ships;
      beginNextHumanPlacement(queueIdx + 1);
    });
  });
}

function aliveOpponentsOf(player) {
  const result = [];
  for (let i = 0; i < multi.playerCount; i++) {
    if (i !== player && multi.alive[i]) result.push(i);
  }
  return result;
}

function nextAlivePlayer(after) {
  for (let step = 1; step <= multi.playerCount; step++) {
    const idx = (after + step) % multi.playerCount;
    if (multi.alive[idx]) return idx;
  }
  return after;
}

function beginMultiTurn(player) {
  if (multi.isAI[player]) {
    announceAITurn(player);
  } else {
    showPass(playerName(player), `${playerName(player)}, kliknij Dalej gdy telefon jest u Ciebie.`, () => {
      startHumanTurn(player);
    });
  }
}

function announceAITurn(player) {
  showScreen('pass');
  document.getElementById('pass-title').textContent = playerName(player);
  document.getElementById('pass-message').textContent = `${playerName(player)} (komputer) namierza cel...`;
  document.getElementById('btn-pass-continue').classList.add('hidden');
  setTimeout(() => {
    document.getElementById('btn-pass-continue').classList.remove('hidden');
    runAITurn(player);
  }, 900);
}

function startHumanTurn(player) {
  const opponents = aliveOpponentsOf(player);
  if (opponents.length === 1) {
    startMultiFireScreen(player, opponents[0]);
  } else {
    showScreen('target');
    document.getElementById('target-title').textContent = `${playerName(player)}, wybierz cel`;
    const container = document.getElementById('target-buttons');
    container.innerHTML = '';
    opponents.forEach((oppIdx) => {
      const btn = document.createElement('button');
      btn.textContent = playerName(oppIdx);
      btn.onclick = () => startMultiFireScreen(player, oppIdx);
      container.appendChild(btn);
    });
  }
}

function runAITurn(player) {
  const opponents = aliveOpponentsOf(player);
  const target = opponents[Math.floor(Math.random() * opponents.length)];
  const emptyCells = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (!multi.hits[target].has(`${x},${y}`)) emptyCells.push([x, y]);
    }
  }
  const [x, y] = emptyCells[Math.floor(Math.random() * emptyCells.length)];

  startMultiFireScreen(player, target);
  document.getElementById('turn-indicator').textContent = `${playerName(player)} (komputer) strzela...`;
  setTimeout(() => {
    fireMulti(x, y, player, target);
  }, 500);
}

function cellStateMulti(targetIdx, x, y) {
  const key = `${x},${y}`;
  if (!multi.hits[targetIdx].has(key)) return null;
  const ship = multi.ships[targetIdx].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  if (!ship) return 'miss';
  const sunk = ship.cells.every(([sx, sy]) => multi.hits[targetIdx].has(`${sx},${sy}`));
  return sunk ? 'sunk' : 'hit';
}

function shipFullySunkMulti(targetIdx, ship) {
  return ship.cells.every(([x, y]) => multi.hits[targetIdx].has(`${x},${y}`));
}

function startMultiFireScreen(shooter, target) {
  showScreen('game');
  const gm = document.getElementById('game-message');
  gm.textContent = '';
  gm.classList.remove('game-over-banner');
  document.getElementById('enemy-board-title').textContent = playerName(target);
  document.getElementById('own-board-title').textContent = `${playerName(shooter)} (Ty)`;
  document.getElementById('turn-indicator').textContent = `${playerName(shooter)} - Twoja tura, strzelaj!`;
  pulseTurnIndicator();

  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (x, y) => [multi.hits[target].has(`${x},${y}`) ? cellStateMulti(target, x, y) : null],
    getCellContent: (x, y) => multi.hits[target].has(`${x},${y}`) ? symbolForState(cellStateMulti(target, x, y)) : '',
    onClick: (x, y) => fireMulti(x, y, shooter, target),
  });
  const sunkTargetShips = multi.ships[target].filter(ship => shipFullySunkMulti(target, ship));
  renderShipOverlays(enemyGrid, sunkTargetShips, () => true);

  const ownGrid = buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [multi.hits[shooter].has(`${x},${y}`) ? cellStateMulti(shooter, x, y) : null],
    getCellContent: (x, y) => multi.hits[shooter].has(`${x},${y}`) ? symbolForState(cellStateMulti(shooter, x, y)) : '',
  });
  renderShipOverlays(ownGrid, multi.ships[shooter], (ship) => shipFullySunkMulti(shooter, ship));
}

function advanceMultiTurn(shooter) {
  const next = nextAlivePlayer(shooter);
  multi.currentPlayer = next;
  setTimeout(() => beginMultiTurn(next), 1200);
}

function fireMulti(x, y, shooter, target) {
  const key = `${x},${y}`;
  if (multi.hits[target].has(key)) return;

  AudioEngine.playCannonShot();
  spawnProjectile(document.querySelector('#enemy-board .grid'), x, y);
  multi.hits[target].add(key);
  const hitShip = multi.ships[target].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  const isHit = !!hitShip;
  const shipJustSunk = isHit && shipFullySunkMulti(target, hitShip);
  const targetAllSunk = multi.ships[target].every(s => shipFullySunkMulti(target, s));

  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (cx, cy) => [multi.hits[target].has(`${cx},${cy}`) ? cellStateMulti(target, cx, cy) : null],
    getCellContent: (cx, cy) => multi.hits[target].has(`${cx},${cy}`) ? symbolForState(cellStateMulti(target, cx, cy)) : '',
    onClick: () => {},
  });
  const sunkTargetShips = multi.ships[target].filter(ship => shipFullySunkMulti(target, ship));
  renderShipOverlays(enemyGrid, sunkTargetShips, () => true);
  triggerCellAnimation('enemy-board', x, y, isHit);

  if (shipJustSunk) {
    const { cx, cy } = shipCenterPercent(hitShip.cells);
    spawnSinkBurst(enemyGrid, cx, cy);
    AudioEngine.playExplosion();
  } else if (isHit) {
    spawnHitPoof(enemyGrid, x, y);
    AudioEngine.playHitImpact();
  } else {
    spawnMissRipple(enemyGrid, x, y);
    AudioEngine.playSplash();
  }

  if (targetAllSunk) {
    multi.alive[target] = false;
  }

  const aliveCount = multi.alive.filter(Boolean).length;
  if (aliveCount <= 1) {
    const winnerIdx = multi.alive.findIndex(Boolean);
    const gm = document.getElementById('game-message');
    gm.textContent = `${playerName(winnerIdx)} wygrywa!`;
    gm.classList.add('game-over-banner');
    document.getElementById('turn-indicator').textContent = 'Koniec gry';
    return;
  }

  document.getElementById('game-message').textContent = targetAllSunk
    ? `Zatopiona cala flota gracza: ${playerName(target)}!`
    : (isHit ? 'Trafienie!' : 'Pudlo.');

  advanceMultiTurn(shooter);
}
