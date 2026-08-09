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

const SHIP_SIZES = [5, 4, 3, 3, 2];
const BOARD_SIZE = 10;

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

// rooms: code -> { players: [ws, ws], boards: [board, board], ready: [bool, bool], turn: 0, started: bool }
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

function validateShips(ships) {
  if (!Array.isArray(ships) || ships.length !== SHIP_SIZES.length) return false;
  const occupied = new Set();
  const sizesUsed = ships.map(s => s.cells.length).sort((a, b) => b - a);
  const expected = [...SHIP_SIZES].sort((a, b) => b - a);
  if (JSON.stringify(sizesUsed) !== JSON.stringify(expected)) return false;

  for (const ship of ships) {
    for (const [x, y] of ship.cells) {
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false;
      const key = `${x},${y}`;
      if (occupied.has(key)) return false;
      occupied.add(key);
    }
  }
  return true;
}

function otherPlayer(room, idx) {
  return room.players[idx === 0 ? 1 : 0];
}

function checkAllSunk(ships, hits) {
  return ships.every(ship => ship.cells.every(([x, y]) => hits.has(`${x},${y}`)));
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
      const code = makeRoomCode();
      rooms.set(code, {
        players: [ws, null],
        ships: [null, null],
        hits: [new Set(), new Set()],
        ready: [false, false],
        turn: 0,
        started: false,
      });
      ws.roomCode = code;
      ws.playerIdx = 0;
      send(ws, { type: 'created', code, playerIdx: 0 });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(msg.code);
      if (!room || room.players[1]) {
        send(ws, { type: 'error', message: 'Nieprawidlowy kod pokoju lub pokoj jest pelny.' });
        return;
      }
      room.players[1] = ws;
      ws.roomCode = msg.code;
      ws.playerIdx = 1;
      send(ws, { type: 'joined', code: msg.code, playerIdx: 1 });
      send(room.players[0], { type: 'opponent_joined' });
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const idx = ws.playerIdx;

    if (msg.type === 'place_ships') {
      if (!validateShips(msg.ships)) {
        send(ws, { type: 'error', message: 'Nieprawidlowe ustawienie statkow.' });
        return;
      }
      room.ships[idx] = msg.ships;
      room.ready[idx] = true;
      send(otherPlayer(room, idx), { type: 'opponent_ready' });

      if (room.ready[0] && room.ready[1] && !room.started) {
        room.started = true;
        send(room.players[0], { type: 'start', yourTurn: true });
        send(room.players[1], { type: 'start', yourTurn: false });
      }
      return;
    }

    if (msg.type === 'fire') {
      if (!room.started) return;
      if (room.turn !== idx) return;
      const { x, y } = msg;
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;

      const targetIdx = idx === 0 ? 1 : 0;
      const key = `${x},${y}`;
      if (room.hits[targetIdx].has(key)) return;

      room.hits[targetIdx].add(key);
      const targetShips = room.ships[targetIdx];
      const hitShip = targetShips.find(ship => ship.cells.some(([sx, sy]) => sx === x && sy === y));
      const isHit = !!hitShip;
      let sunk = false;
      if (isHit) {
        sunk = hitShip.cells.every(([sx, sy]) => room.hits[targetIdx].has(`${sx},${sy}`));
      }

      const allSunk = checkAllSunk(targetShips, room.hits[targetIdx]);
      if (!allSunk) room.turn = targetIdx;

      const resultMsg = {
        type: 'fire_result',
        x, y,
        hit: isHit,
        sunk,
        sunkCells: sunk ? hitShip.cells : null,
        gameOver: allSunk,
        nextTurn: room.turn,
      };
      send(room.players[idx], resultMsg);
      send(room.players[targetIdx], resultMsg);
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const otherIdx = ws.playerIdx === 0 ? 1 : 0;
    send(room.players[otherIdx], { type: 'opponent_left' });
    rooms.delete(ws.roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Serwer statkow dziala na porcie ${PORT}`);
});
