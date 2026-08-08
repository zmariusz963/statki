const BOARD_SIZE = 10;
const SHIP_SIZES = [5, 4, 3, 3, 2];
const SHIP_NAMES = ['Krazownik (5)', 'Pancernik (4)', 'Fregata (3)', 'Fregata (3)', 'Niszczyciel (2)'];

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
}

function triggerCellAnimation(containerId, x, y, hit) {
  const cell = document.querySelector(`#${containerId} .grid .cell[data-x="${x}"][data-y="${y}"]`);
  if (!cell) return;
  cell.classList.add(hit ? 'anim-hit' : 'anim-miss');
}

// ---------- Placement (shared between online and local) ----------

let placeShipIdx = 0;
let horizontal = true;
let placedShips = [];
let placedSet = new Set();
let onPlacementReady = null;

function hasConflict(x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (placedSet.has(`${x + dx},${y + dy}`)) return true;
    }
  }
  return false;
}

function shipCandidateCells(x, y, size) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    const cx = horizontal ? x + i : x;
    const cy = horizontal ? y : y + i;
    if (cx >= BOARD_SIZE || cy >= BOARD_SIZE) return null;
    cells.push([cx, cy]);
  }
  return cells;
}

function startPlacementUI(onReady) {
  showScreen('place');
  placeShipIdx = 0;
  placedShips = [];
  placedSet = new Set();
  horizontal = true;
  onPlacementReady = onReady;
  document.getElementById('btn-ready').classList.add('hidden');
  document.getElementById('btn-rotate').classList.remove('hidden');
  document.getElementById('btn-undo').classList.remove('hidden');
  document.getElementById('place-message').textContent = '';
  renderPlaceHint();
  renderShipsLegend();
  buildPlaceBoardUI();
}

function renderPlaceHint() {
  if (placeShipIdx < SHIP_SIZES.length) {
    document.getElementById('place-hint').textContent = `Ustaw: ${SHIP_NAMES[placeShipIdx]}`;
  } else {
    document.getElementById('place-hint').textContent = 'Wszystkie statki rozstawione.';
  }
}

function renderShipsLegend() {
  const legend = document.getElementById('ships-legend');
  legend.innerHTML = '';
  SHIP_SIZES.forEach((size, i) => {
    const item = document.createElement('div');
    item.className = 'ship-legend-item';
    if (i < placeShipIdx) item.classList.add('placed');
    if (i === placeShipIdx) item.classList.add('current');
    const squares = document.createElement('div');
    squares.className = 'ship-legend-squares';
    for (let s = 0; s < size; s++) {
      const sq = document.createElement('div');
      sq.className = 'ship-legend-square';
      squares.appendChild(sq);
    }
    item.appendChild(squares);
    legend.appendChild(item);
  });
}

function clearPreview() {
  document.querySelectorAll('#place-board .grid .cell.preview-valid, #place-board .grid .cell.preview-invalid')
    .forEach(el => el.classList.remove('preview-valid', 'preview-invalid'));
}

function previewShip(x, y) {
  clearPreview();
  if (placeShipIdx >= SHIP_SIZES.length) return;
  const size = SHIP_SIZES[placeShipIdx];
  const cells = shipCandidateCells(x, y, size);
  const valid = cells !== null && cells.every(([cx, cy]) => !hasConflict(cx, cy));
  if (!cells) return;
  cells.forEach(([cx, cy]) => {
    const el = document.querySelector(`#place-board .grid .cell[data-x="${cx}"][data-y="${cy}"]`);
    if (el) el.classList.add(valid ? 'preview-valid' : 'preview-invalid');
  });
}

function buildPlaceBoardUI() {
  buildBoard('place-board', {
    getCellClass: (x, y) => [placedSet.has(`${x},${y}`) ? 'ship' : null],
    onClick: tryPlaceShip,
    onHover: previewShip,
    onLeaveGrid: clearPreview,
  });
}

function tryPlaceShip(x, y) {
  if (placeShipIdx >= SHIP_SIZES.length) return;
  const size = SHIP_SIZES[placeShipIdx];
  const cells = shipCandidateCells(x, y, size);

  if (!cells) {
    document.getElementById('place-message').textContent = 'Statek nie miesci sie na planszy.';
    return;
  }
  if (cells.some(([cx, cy]) => hasConflict(cx, cy))) {
    document.getElementById('place-message').textContent = 'Statki nie moga sie stykac ze soba.';
    return;
  }

  cells.forEach(([cx, cy]) => placedSet.add(`${cx},${cy}`));
  placedShips.push({ cells });
  placeShipIdx++;
  document.getElementById('place-message').textContent = '';
  renderShipsLegend();
  buildPlaceBoardUI();
  renderPlaceHint();

  if (placeShipIdx >= SHIP_SIZES.length) {
    document.getElementById('btn-ready').classList.remove('hidden');
    document.getElementById('btn-rotate').classList.add('hidden');
    document.getElementById('btn-undo').classList.add('hidden');
  }
}

document.getElementById('btn-rotate').onclick = () => {
  horizontal = !horizontal;
};

document.getElementById('btn-undo').onclick = () => {
  if (placedShips.length === 0) return;
  const last = placedShips.pop();
  last.cells.forEach(([x, y]) => placedSet.delete(`${x},${y}`));
  placeShipIdx--;
  document.getElementById('btn-ready').classList.add('hidden');
  document.getElementById('btn-rotate').classList.remove('hidden');
  document.getElementById('place-message').textContent = '';
  renderPlaceHint();
  renderShipsLegend();
  buildPlaceBoardUI();
};

document.getElementById('btn-ready').onclick = () => {
  if (onPlacementReady) onPlacementReady(placedShips.slice());
};

// ---------- Online mode ----------

let ws;
let playerIdx = null;
let roomCode = null;
let myTurn = false;
let enemyHits = {};
let ownHits = {};

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
  document.getElementById('btn-pass-turn').classList.add('hidden');
  enemyHits = {};
  ownHits = {};
  buildEnemyBoardOnline();
  buildOwnBoardOnline();
  updateTurnIndicator();
}

function updateTurnIndicator() {
  document.getElementById('turn-indicator').textContent = myTurn ? 'Twoja tura - strzelaj!' : 'Tura przeciwnika...';
}

function buildEnemyBoardOnline() {
  buildBoard('enemy-board', {
    getCellClass: (x, y) => [enemyHits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(enemyHits[`${x},${y}`]),
    onClick: fireOnline,
  });
}

function buildOwnBoardOnline() {
  buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [placedSet.has(`${x},${y}`) ? 'ship' : null, ownHits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(ownHits[`${x},${y}`]),
  });
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
  }

  buildEnemyBoardOnline();
  buildOwnBoardOnline();
  triggerCellAnimation(iFired ? 'enemy-board' : 'own-board', msg.x, msg.y, msg.hit);

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

function startLocalTurn() {
  showScreen('game');
  document.getElementById('game-message').textContent = '';
  document.getElementById('btn-pass-turn').classList.add('hidden');
  document.getElementById('turn-indicator').textContent = `Gracz ${local.turn + 1} - Twoja tura, strzelaj!`;

  const shooter = local.turn;
  const target = shooter === 0 ? 1 : 0;

  buildBoard('enemy-board', {
    getCellClass: (x, y) => [local.hits[target].has(`${x},${y}`) ? cellStateLocal(target, x, y) : null],
    getCellContent: (x, y) => local.hits[target].has(`${x},${y}`) ? symbolForState(cellStateLocal(target, x, y)) : '',
    onClick: (x, y) => fireLocal(x, y, shooter, target),
  });

  buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => {
      const isShip = local.ships[shooter].some(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
      const state = local.hits[shooter].has(`${x},${y}`) ? cellStateLocal(shooter, x, y) : null;
      return [isShip ? 'ship' : null, state];
    },
    getCellContent: (x, y) => local.hits[shooter].has(`${x},${y}`) ? symbolForState(cellStateLocal(shooter, x, y)) : '',
  });
}

function cellStateLocal(targetPlayerIdx, x, y) {
  const key = `${x},${y}`;
  if (!local.hits[targetPlayerIdx].has(key)) return null;
  const ship = local.ships[targetPlayerIdx].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  if (!ship) return 'miss';
  const sunk = ship.cells.every(([sx, sy]) => local.hits[targetPlayerIdx].has(`${sx},${sy}`));
  return sunk ? 'sunk' : 'hit';
}

function fireLocal(x, y, shooter, target) {
  const key = `${x},${y}`;
  if (local.hits[target].has(key)) return;

  local.hits[target].add(key);
  const hitShip = local.ships[target].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  const isHit = !!hitShip;
  const allSunk = local.ships[target].every(s => s.cells.every(([sx, sy]) => local.hits[target].has(`${sx},${sy}`)));

  buildBoard('enemy-board', {
    getCellClass: (cx, cy) => [local.hits[target].has(`${cx},${cy}`) ? cellStateLocal(target, cx, cy) : null],
    getCellContent: (cx, cy) => local.hits[target].has(`${cx},${cy}`) ? symbolForState(cellStateLocal(target, cx, cy)) : '',
    onClick: () => {},
  });
  triggerCellAnimation('enemy-board', x, y, isHit);

  document.getElementById('game-message').textContent = isHit
    ? (allSunk ? 'Zatopiony ostatni statek!' : 'Trafienie!')
    : 'Pudlo.';

  if (allSunk) {
    document.getElementById('turn-indicator').textContent = `Gracz ${shooter + 1} wygrywa!`;
    document.getElementById('btn-pass-turn').classList.add('hidden');
    return;
  }

  local.turn = target;
  const passBtn = document.getElementById('btn-pass-turn');
  passBtn.classList.remove('hidden');
  passBtn.onclick = () => {
    showPass(`Przekaz telefon graczowi ${target + 1}`, `Gracz ${target + 1}, kliknij Dalej gdy telefon jest u Ciebie.`, () => {
      startLocalTurn();
    });
  };
}
