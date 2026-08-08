const BOARD_SIZE = 10;
const SHIP_SIZES = [5, 4, 3, 3, 2];
const SHIP_NAMES = ['Krazownik (5)', 'Pancernik (4)', 'Fregata (3)', 'Fregata (3)', 'Niszczyciel (2)'];

const screens = {
  lobby: document.getElementById('screen-lobby'),
  waiting: document.getElementById('screen-waiting'),
  place: document.getElementById('screen-place'),
  game: document.getElementById('screen-game'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

let ws;
let playerIdx = null;
let roomCode = null;
let myTurn = false;

let placeShipIdx = 0;
let horizontal = true;
let placedShips = [];
let placedSet = new Set();

let enemyHits = {};
let ownHits = {};

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  };

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
      startPlacement();
      break;

    case 'opponent_joined':
      startPlacement();
      break;

    case 'error':
      document.getElementById('lobby-message').textContent = msg.message;
      break;

    case 'opponent_ready':
      document.getElementById('place-message').textContent = 'Przeciwnik jest gotowy. Czekamy na Ciebie.';
      break;

    case 'start':
      myTurn = msg.yourTurn;
      startGame();
      break;

    case 'fire_result':
      applyFireResult(msg);
      break;

    case 'opponent_left':
      document.getElementById('game-message').textContent = 'Przeciwnik opuscil gre.';
      break;
  }
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

function startPlacement() {
  showScreen('place');
  placeShipIdx = 0;
  placedShips = [];
  placedSet = new Set();
  renderPlaceHint();
  buildPlaceBoard();
}

function renderPlaceHint() {
  if (placeShipIdx < SHIP_SIZES.length) {
    document.getElementById('place-hint').textContent = `Ustaw: ${SHIP_NAMES[placeShipIdx]}`;
  }
}

document.getElementById('btn-rotate').onclick = () => {
  horizontal = !horizontal;
};

function buildPlaceBoard() {
  const board = document.getElementById('place-board');
  board.innerHTML = '';
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      if (placedSet.has(`${x},${y}`)) cell.classList.add('ship');
      cell.onclick = () => tryPlaceShip(x, y);
      board.appendChild(cell);
    }
  }
}

function tryPlaceShip(x, y) {
  if (placeShipIdx >= SHIP_SIZES.length) return;
  const size = SHIP_SIZES[placeShipIdx];
  const cells = [];
  for (let i = 0; i < size; i++) {
    const cx = horizontal ? x + i : x;
    const cy = horizontal ? y : y + i;
    if (cx >= BOARD_SIZE || cy >= BOARD_SIZE) {
      document.getElementById('place-message').textContent = 'Statek nie miesci sie na planszy.';
      return;
    }
    if (placedSet.has(`${cx},${cy}`)) {
      document.getElementById('place-message').textContent = 'Statki nie moga sie stykac na tych polach.';
      return;
    }
    cells.push([cx, cy]);
  }

  cells.forEach(([cx, cy]) => placedSet.add(`${cx},${cy}`));
  placedShips.push({ cells });
  placeShipIdx++;
  document.getElementById('place-message').textContent = '';
  buildPlaceBoard();

  if (placeShipIdx >= SHIP_SIZES.length) {
    document.getElementById('place-hint').textContent = 'Wszystkie statki rozstawione.';
    document.getElementById('btn-ready').classList.remove('hidden');
    document.getElementById('btn-rotate').classList.add('hidden');
  } else {
    renderPlaceHint();
  }
}

document.getElementById('btn-ready').onclick = () => {
  ws.send(JSON.stringify({ type: 'place_ships', ships: placedShips }));
  document.getElementById('btn-ready').disabled = true;
  document.getElementById('place-message').textContent = 'Czekamy na przeciwnika...';
};

function startGame() {
  showScreen('game');
  enemyHits = {};
  ownHits = {};
  buildEnemyBoard();
  buildOwnBoard();
  updateTurnIndicator();
}

function updateTurnIndicator() {
  document.getElementById('turn-indicator').textContent = myTurn ? 'Twoja tura - strzelaj!' : 'Tura przeciwnika...';
}

function buildEnemyBoard() {
  const board = document.getElementById('enemy-board');
  board.innerHTML = '';
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;
      const key = `${x},${y}`;
      if (enemyHits[key]) cell.classList.add(enemyHits[key]);
      cell.onclick = () => fire(x, y);
      board.appendChild(cell);
    }
  }
}

function buildOwnBoard() {
  const board = document.getElementById('own-board');
  board.innerHTML = '';
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const key = `${x},${y}`;
      if (placedSet.has(key)) cell.classList.add('ship');
      if (ownHits[key]) cell.classList.add(ownHits[key]);
      board.appendChild(cell);
    }
  }
}

function fire(x, y) {
  if (!myTurn) return;
  const key = `${x},${y}`;
  if (enemyHits[key]) return;
  ws.send(JSON.stringify({ type: 'fire', x, y }));
}

function applyFireResult(msg) {
  const key = `${msg.x},${msg.y}`;
  const iFired = myTurn;

  const targetHits = iFired ? enemyHits : ownHits;
  targetHits[key] = msg.hit ? 'hit' : 'miss';

  if (msg.sunk && msg.sunkCells) {
    msg.sunkCells.forEach(([sx, sy]) => {
      targetHits[`${sx},${sy}`] = 'sunk';
    });
  }

  buildEnemyBoard();
  buildOwnBoard();

  myTurn = msg.nextTurn === playerIdx;
  updateTurnIndicator();

  if (msg.gameOver) {
    const won = msg.hit !== undefined && iFired;
    document.getElementById('game-message').textContent = won ? 'Wygrywasz! Wszystkie statki przeciwnika zatopione.' : 'Przegrywasz! Twoja flota zatopiona.';
  }
}
