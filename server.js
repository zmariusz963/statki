const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

const SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

function boardSizeForCount(n) {
  return 10 + 2 * (n - 2);
}

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// rooms: code -> { playerCount, boardSize, players, ships, hits, ready, alive, turn, started, joinedCount }
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptIdx) {
  room.players.forEach((ws, i) => {
    if (i !== exceptIdx) send(ws, msg);
  });
}

function validateShips(ships, boardSize) {
  if (!Array.isArray(ships) || ships.length !== SHIP_SIZES.length) return false;
  const occupied = new Set();
  const sizesUsed = ships.map(s => s.cells.length).sort((a, b) => b - a);
  const expected = [...SHIP_SIZES].sort((a, b) => b - a);
  if (JSON.stringify(sizesUsed) !== JSON.stringify(expected)) return false;

  for (const ship of ships) {
    for (const [x, y] of ship.cells) {
      if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return false;
      const key = `${x},${y}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  return true;
}

function checkAllSunk(ships, hits) {
  return ships.every(ship => ship.cells.every(([x, y]) => hits.has(`${x},${y}`)));
}

function nextAlivePlayer(room, after) {
  for (let step = 1; step <= room.playerCount; step++) {
    const idx = (after + step) % room.playerCount;
    if (room.alive[idx]) return idx;
  }
  return after;
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerIdx = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'create') {
      const playerCount = [2, 3, 4].includes(msg.playerCount) ? msg.playerCount : 2;
      const code = makeRoomCode();
      const room = {
        playerCount,
        boardSize: boardSizeForCount(playerCount),
        players: new Array(playerCount).fill(null),
        ships: new Array(playerCount).fill(null),
        hits: Array.from({ length: playerCount }, () => new Set()),
        ready: new Array(playerCount).fill(false),
        alive: new Array(playerCount).fill(true),
        turn: 0,
        started: false,
        joinedCount: 0,
      };
      room.players[0] = ws;
      room.joinedCount = 1;
      rooms.set(code, room);
      ws.roomCode = code;
      ws.playerIdx = 0;
      send(ws, { type: 'created', code, playerIdx: 0, playerCount, joinedCount: 1 });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(msg.code);
      if (!room) {
        send(ws, { type: 'error', message: 'Nieprawidlowy kod pokoju.' });
        return;
      }
      const freeIdx = room.players.findIndex(p => p === null);
      if (freeIdx === -1) {
        send(ws, { type: 'error', message: 'Pokoj jest pelny.' });
        return;
      }
      room.players[freeIdx] = ws;
      room.joinedCount += 1;
      ws.roomCode = msg.code;
      ws.playerIdx = freeIdx;
      send(ws, { type: 'joined', code: msg.code, playerIdx: freeIdx, playerCount: room.playerCount, joinedCount: room.joinedCount });
      broadcast(room, { type: 'player_joined', joinedCount: room.joinedCount, playerCount: room.playerCount }, freeIdx);
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const idx = ws.playerIdx;

    if (msg.type === 'place_ships') {
      if (room.joinedCount < room.playerCount) return;
      if (!validateShips(msg.ships, room.boardSize)) {
        send(ws, { type: 'error', message: 'Nieprawidlowe ustawienie statkow.' });
        return;
      }
      room.ships[idx] = msg.ships;
      room.ready[idx] = true;
      broadcast(room, { type: 'opponent_ready', playerIdx: idx }, idx);

      if (room.ready.every(Boolean) && !room.started) {
        room.started = true;
        room.players.forEach((playerWs, i) => {
          send(playerWs, { type: 'start', yourIdx: i, playerCount: room.playerCount, turn: room.turn });
        });
      }
      return;
    }

    if (msg.type === 'fire') {
      if (!room.started) return;
      if (room.turn !== idx) return;
      const { x, y, target } = msg;
      if (typeof target !== 'number' || target === idx || !room.alive[target]) return;
      if (x < 0 || x >= room.boardSize || y < 0 || y >= room.boardSize) return;

      const key = `${x},${y}`;
      if (room.hits[target].has(key)) return;

      room.hits[target].add(key);
      const targetShips = room.ships[target];
      const hitShip = targetShips.find(ship => ship.cells.some(([sx, sy]) => sx === x && sy === y));
      const isHit = !!hitShip;
      let sunk = false;
      if (isHit) {
        sunk = hitShip.cells.every(([sx, sy]) => room.hits[target].has(`${sx},${sy}`));
      }

      const targetAllSunk = checkAllSunk(targetShips, room.hits[target]);
      if (targetAllSunk) room.alive[target] = false;

      const aliveCount = room.alive.filter(Boolean).length;
      const gameOver = aliveCount <= 1;
      const winner = gameOver ? room.alive.findIndex(Boolean) : null;

      if (!gameOver) {
        room.turn = nextAlivePlayer(room, idx);
      }

      const resultMsg = {
        type: 'fire_result',
        shooter: idx,
        target,
        x, y,
        hit: isHit,
        sunk,
        sunkCells: sunk ? hitShip.cells : null,
        targetEliminated: targetAllSunk,
        gameOver,
        winner,
        nextTurn: room.turn,
      };
      broadcast(room, resultMsg, null);
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    broadcast(room, { type: 'opponent_left' }, ws.playerIdx);
    rooms.delete(ws.roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Serwer statkow dziala na porcie ${PORT}`);
});
