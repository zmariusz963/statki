const BOARD_SIZE = 10;

const SHIP_DEFS = [
  { name: 'Krazownik (5)', shape: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { name: 'Pancernik (4)', shape: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: 'Niszczyciel L (4)', shape: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: 'Fregata (3)', shape: [[0, 0], [1, 0], [2, 0]], freeform: true },
  { name: 'Korweta (3)', shape: [[0, 0], [1, 0], [2, 0]] },
  { name: 'Torpedowiec (2)', shape: [[0, 0], [1, 0]] },
  { name: 'Kuter (2)', shape: [[0, 0], [1, 0]] },
  { name: 'Lodz (1)', shape: [[0, 0]] },
  { name: 'Boja (1)', shape: [[0, 0]] },
];

const screens = {
  lobby: document.getElementById('screen-lobby'),
  waiting: document.getElementById('screen-waiting'),
  pass: document.getElementById('screen-pass'),
  place: document.getElementById('screen-place'),
  game: document.getElementById('screen-game'),
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

function shipCenterPercent(cells) {
  const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { cx: (minX + maxX + 1) / 2 * 10, cy: (minY + maxY + 1) / 2 * 10 };
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
  return `<svg viewBox="0 0 ${w} ${h}" class="ship-svg" preserveAspectRatio="none">
    <polygon points="${hullPoints}" class="ship-hull" />
    ${turrets}
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
      el.style.left = `${x * 10}%`;
      el.style.top = `${y * 10}%`;
      el.style.width = '10%';
      el.style.height = '10%';
      el.innerHTML = '<div class="ship-single-dot"></div>';
      gridEl.appendChild(el);
    } else if (isStraightLine(cells)) {
      const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const horizontal = (maxX - minX) >= (maxY - minY);
      const el = document.createElement('div');
      el.className = 'ship-overlay' + (sunk ? ' sunk' : '');
      el.style.left = `${minX * 10}%`;
      el.style.top = `${minY * 10}%`;
      el.style.width = `${(maxX - minX + 1) * 10}%`;
      el.style.height = `${(maxY - minY + 1) * 10}%`;
      el.innerHTML = shipSVGMarkup(cells.length, horizontal);
      gridEl.appendChild(el);
    } else {
      cells.forEach(([x, y]) => {
        const seg = document.createElement('div');
        seg.className = 'ship-overlay ship-segment' + (sunk ? ' sunk' : '');
        seg.style.left = `${x * 10}%`;
        seg.style.top = `${y * 10}%`;
        seg.style.width = '10%';
        seg.style.height = '10%';
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
  for (let x = 0; x < BOARD_SIZE; x++) {
    const l = document.createElement('div');
    l.className = 'label-cell';
    l.textContent = colLetter(x);
    colLabels.appendChild(l);
  }
  container.appendChild(colLabels);

  const rowLabels = document.createElement('div');
  rowLabels.className = 'row-labels';
  for (let y = 0; y < BOARD_SIZE; y++) {
    const l = document.createElement('div');
    l.className = 'label-cell';
    l.textContent = String(y + 1);
    rowLabels.appendChild(l);
  }
  container.appendChild(rowLabels);

  const grid = document.createElement('div');
  grid.className = 'grid';
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
  document.getElementById('btn-rotate').classList.toggle('hidden', !pending || freeform);
  document.getElementById('btn-mirror').classList.toggle('hidden', !pending || freeform);
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
    item.className = 'ship-legend-item';
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

// ---------- Online mode ----------

let ws;
let playerIdx = null;
let roomCode = null;
let myTurn = false;
let enemyHits = {};
let ownHits = {};
let sunkEnemyShips = [];

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
      document.getElementById('room-code').textContent = roomCode;
      showScreen('waiting');
      break;
    case 'joined':
      roomCode = msg.code;
      playerIdx = msg.playerIdx;
      startPlacementUI(onOnlineReady);
      break;
    case 'opponent_joined':
      startPlacementUI(onOnlineReady);
      break;
    case 'error':
      document.getElementById('lobby-message').textContent = msg.message;
      break;
    case 'opponent_ready':
      document.getElementById('place-message').textContent = 'Przeciwnik jest gotowy. Czekamy na Ciebie.';
      break;
    case 'start':
      myTurn = msg.yourTurn;
      startOnlineGame();
      break;
    case 'fire_result':
      applyOnlineFireResult(msg);
      break;
    case 'opponent_left':
      document.getElementById('game-message').textContent = 'Przeciwnik opuscil gre.';
      break;
  }
}

function onOnlineReady(ships) {
  ws.send(JSON.stringify({ type: 'place_ships', ships }));
  document.getElementById('btn-ready').disabled = true;
  document.getElementById('place-message').textContent = 'Czekamy na przeciwnika...';
}

document.getElementById('btn-create').onclick = () => {
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'create' }));
};

document.getElementById('btn-join').onclick = () => {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!code) return;
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', code }));
};

function startOnlineGame() {
  showScreen('game');
  enemyHits = {};
  ownHits = {};
  sunkEnemyShips = [];
  buildEnemyBoardOnline();
  buildOwnBoardOnline();
  updateTurnIndicator();
}

function updateTurnIndicator() {
  document.getElementById('turn-indicator').textContent = myTurn ? 'Twoja tura - strzelaj!' : 'Tura przeciwnika...';
}

function buildEnemyBoardOnline() {
  const grid = buildBoard('enemy-board', {
    getCellClass: (x, y) => [enemyHits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(enemyHits[`${x},${y}`]),
    onClick: fireOnline,
  });
  renderShipOverlays(grid, sunkEnemyShips, () => true);
}

function buildOwnBoardOnline() {
  const grid = buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [ownHits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(ownHits[`${x},${y}`]),
  });
  renderShipOverlays(grid, placedShipsList(), (ship) => ship.cells.every(([x, y]) => ownHits[`${x},${y}`] === 'sunk'));
}

function fireOnline(x, y) {
  if (!myTurn) return;
  const key = `${x},${y}`;
  if (enemyHits[key]) return;
  ws.send(JSON.stringify({ type: 'fire', x, y }));
}

function applyOnlineFireResult(msg) {
  const key = `${msg.x},${msg.y}`;
  const iFired = myTurn;
  const targetHits = iFired ? enemyHits : ownHits;
  targetHits[key] = msg.hit ? 'hit' : 'miss';

  if (msg.sunk && msg.sunkCells) {
    msg.sunkCells.forEach(([sx, sy]) => {
      targetHits[`${sx},${sy}`] = 'sunk';
    });
    if (iFired) sunkEnemyShips.push({ cells: msg.sunkCells });
  }

  buildEnemyBoardOnline();
  buildOwnBoardOnline();
  triggerCellAnimation(iFired ? 'enemy-board' : 'own-board', msg.x, msg.y, msg.hit);

  if (msg.sunk && msg.sunkCells) {
    const { cx, cy } = shipCenterPercent(msg.sunkCells);
    spawnSinkBurst(document.querySelector(`#${iFired ? 'enemy-board' : 'own-board'} .grid`), cx, cy);
  }

  myTurn = msg.nextTurn === playerIdx;
  updateTurnIndicator();

  if (msg.gameOver) {
    document.getElementById('game-message').textContent = iFired ? 'Wygrywasz! Wszystkie statki przeciwnika zatopione.' : 'Przegrywasz! Twoja flota zatopiona.';
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
  document.getElementById('game-message').textContent = '';
  document.getElementById('turn-indicator').textContent = `Gracz ${local.turn + 1} - Twoja tura, strzelaj!`;

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
  }

  document.getElementById('game-message').textContent = isHit
    ? (allSunk ? 'Zatopiony ostatni statek!' : (shipJustSunk ? 'Zatopiony!' : 'Trafienie!'))
    : 'Pudlo.';

  if (allSunk) {
    document.getElementById('turn-indicator').textContent = `Gracz ${shooter + 1} wygrywa!`;
    return;
  }

  local.turn = target;
  setTimeout(() => {
    showPass(`Przekaz telefon graczowi ${target + 1}`, `Gracz ${target + 1}, kliknij Dalej gdy telefon jest u Ciebie.`, () => {
      startLocalTurn();
    });
  }, 1200);
}
