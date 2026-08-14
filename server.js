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
  '.json': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
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

// rooms: code -> {
//   mode, seatsA, seatsB (human seat counts; 0 means that side is the computer),
//   seats: { A: [ws|null, ...], B: [ws|null, ...] },
//   ships: { A, B }, hits: { A: Set, B: Set }, ready: { A, B }, aiSide: 'A'|'B'|null,
//   turn: 'A'|'B', started: bool,
// }
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

function broadcastRoom(room, msg) {
  [...room.seats.A, ...room.seats.B].forEach(ws => send(ws, msg));
}

function broadcastSide(room, side, msg) {
  room.seats[side].forEach(ws => send(ws, msg));
}

function seatsConfigForMode(mode) {
  if (mode === '1v1') return { seatsA: 1, seatsB: 1, aiSide: null };
  if (mode === '1vai') return { seatsA: 1, seatsB: 0, aiSide: 'B' };
  if (mode === '2v2') return { seatsA: 2, seatsB: 2, aiSide: null };
  if (mode === '2vai') return { seatsA: 2, seatsB: 0, aiSide: 'B' };
  return { seatsA: 1, seatsB: 1, aiSide: null };
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

function validateOneShip(cells, expectedSize, alreadyPlacedCells) {
  if (!Array.isArray(cells) || cells.length !== expectedSize) return false;
  const seen = new Set();
  for (const c of cells) {
    if (!Array.isArray(c) || c.length !== 2) return false;
    const [x, y] = c;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false;
    const key = `${x},${y}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const occupied = new Set();
  alreadyPlacedCells.forEach(([x, y]) => occupied.add(`${x},${y}`));
  const conflicts = (x, y) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (occupied.has(`${x + dx},${y + dy}`)) return true;
      }
    }
    return false;
  };
  return cells.every(([x, y]) => !conflicts(x, y));
}

function randomAIShips() {
  const occupied = new Set();
  const ships = [];
  const conflicts = (x, y) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (occupied.has(`${x + dx},${y + dy}`)) return true;
      }
    }
    return false;
  };
  SHIP_SIZES.forEach((size) => {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 400) {
      attempts++;
      const horizontal = Math.random() < 0.5;
      const x = Math.floor(Math.random() * BOARD_SIZE);
      const y = Math.floor(Math.random() * BOARD_SIZE);
      const cells = [];
      let ok = true;
      for (let i = 0; i < size; i++) {
        const cx = horizontal ? x + i : x;
        const cy = horizontal ? y : y + i;
        if (cx >= BOARD_SIZE || cy >= BOARD_SIZE || conflicts(cx, cy)) {
          ok = false;
          break;
        }
        cells.push([cx, cy]);
      }
      if (!ok) continue;
      cells.forEach(([cx, cy]) => occupied.add(`${cx},${cy}`));
      ships.push({ cells });
      placed = true;
    }
  });
  return ships;
}

function checkAllSunk(ships, hits) {
  return ships.every(ship => ship.cells.every(([x, y]) => hits.has(`${x},${y}`)));
}

function surroundingCells(shipCells) {
  const shipSet = new Set(shipCells.map(([x, y]) => `${x},${y}`));
  const seen = new Set();
  const result = [];
  shipCells.forEach(([x, y]) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx, ny = y + dy;
        const k = `${nx},${ny}`;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue;
        if (shipSet.has(k) || seen.has(k)) continue;
        seen.add(k);
        result.push([nx, ny]);
      }
    }
  });
  return result;
}

function otherSide(s) {
  return s === 'A' ? 'B' : 'A';
}

function seatCounts(room) {
  return {
    filledA: room.seats.A.filter(Boolean).length,
    filledB: room.seats.B.filter(Boolean).length,
  };
}

function maybeStartGame(room) {
  if (room.started) return;
  if (!room.ready.A || !room.ready.B) return;
  room.started = true;
  room.turn = 'A';
  broadcastRoom(room, { type: 'start', turn: room.turn, turnSeat: room.fireSeat[room.turn] });
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.side = null;
  ws.seatIndex = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'create') {
      const { seatsA, seatsB, aiSide } = seatsConfigForMode(msg.mode);
      const code = makeRoomCode();
      const room = {
        mode: msg.mode,
        seatsA,
        seatsB,
        aiSide,
        seats: { A: new Array(seatsA).fill(null), B: new Array(seatsB).fill(null) },
        ships: { A: null, B: null },
        shipsPartial: { A: [], B: [] },
        placeTurn: { A: 0, B: 0 },
        fireSeat: { A: 0, B: 0 },
        hits: { A: new Set(), B: new Set() },
        ready: { A: aiSide === 'A', B: aiSide === 'B' },
        turn: 'A',
        started: false,
      };
      if (aiSide) room.ships[aiSide] = randomAIShips();
      room.seats.A[0] = ws;
      ws.roomCode = code;
      ws.side = 'A';
      ws.seatIndex = 0;
      rooms.set(code, room);
      const { filledA, filledB } = seatCounts(room);
      send(ws, { type: 'created', code, mode: room.mode, side: 'A', seatIndex: 0, isLeader: true, seatsA, seatsB, filledA, filledB });
      return;
    }

    if (msg.type === 'join') {
      const room = rooms.get(msg.code);
      if (!room) {
        send(ws, { type: 'error', message: 'Nieprawidlowy kod pokoju.' });
        return;
      }
      let side = null;
      let seatIndex = -1;
      if (room.seats.A.includes(null)) {
        side = 'A';
        seatIndex = room.seats.A.indexOf(null);
      } else if (room.seats.B.includes(null)) {
        side = 'B';
        seatIndex = room.seats.B.indexOf(null);
      }
      if (side === null) {
        send(ws, { type: 'error', message: 'Pokoj jest pelny.' });
        return;
      }
      room.seats[side][seatIndex] = ws;
      ws.roomCode = msg.code;
      ws.side = side;
      ws.seatIndex = seatIndex;
      const { filledA, filledB } = seatCounts(room);
      send(ws, { type: 'joined', code: msg.code, mode: room.mode, side, seatIndex, isLeader: seatIndex === 0, seatsA: room.seatsA, seatsB: room.seatsB, filledA, filledB });
      broadcastRoom(room, { type: 'seat_update', filledA, filledB, seatsA: room.seatsA, seatsB: room.seatsB });
      return;
    }

    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const mySide = ws.side;

    if (msg.type === 'place_ship') {
      if (room.ready[mySide]) return;
      const seatsForSide = mySide === 'A' ? room.seatsA : room.seatsB;
      if (seatsForSide === 2 && ws.seatIndex !== room.placeTurn[mySide]) {
        send(ws, { type: 'error', message: 'Nie twoja kolej na stawianie statku.' });
        return;
      }
      const partial = room.shipsPartial[mySide];
      const nextIndex = partial.length;
      if (nextIndex >= SHIP_SIZES.length) return;
      const alreadyPlacedCells = partial.flatMap(s => s.cells);
      if (!validateOneShip(msg.cells, SHIP_SIZES[nextIndex], alreadyPlacedCells)) {
        send(ws, { type: 'error', message: 'Nieprawidlowe ustawienie statku.' });
        return;
      }

      partial.push({ cells: msg.cells });
      if (seatsForSide === 2) room.placeTurn[mySide] = 1 - room.placeTurn[mySide];

      if (partial.length === SHIP_SIZES.length) {
        room.ships[mySide] = partial;
        room.ready[mySide] = true;
        broadcastSide(room, mySide, { type: 'side_ships', ships: partial });
        broadcastRoom(room, { type: 'side_ready', side: mySide });
        maybeStartGame(room);
      } else {
        broadcastSide(room, mySide, {
          type: 'ship_placed',
          side: mySide,
          cells: msg.cells,
          shipsPlaced: partial.length,
          totalShips: SHIP_SIZES.length,
          activeSeatIndex: room.placeTurn[mySide],
        });
      }
      return;
    }

    if (msg.type === 'fire') {
      if (!room.started) return;
      if (room.turn !== mySide) return;
      const seatsForMySide = mySide === 'A' ? room.seatsA : room.seatsB;
      if (seatsForMySide === 2 && ws.seatIndex !== room.fireSeat[mySide]) return;
      const target = otherSide(mySide);
      const { x, y } = msg;
      if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;

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

      const allSunk = checkAllSunk(targetShips, room.hits[target]);
      if (seatsForMySide === 2) room.fireSeat[mySide] = 1 - room.fireSeat[mySide];
      if (!allSunk) room.turn = target;

      let autoMissCells = [];
      if (sunk) {
        surroundingCells(hitShip.cells).forEach(([sx, sy]) => {
          const k = `${sx},${sy}`;
          if (!room.hits[target].has(k)) {
            room.hits[target].add(k);
            autoMissCells.push([sx, sy]);
          }
        });
      }

      const resultMsg = {
        type: 'fire_result',
        shooterSide: mySide,
        x, y,
        hit: isHit,
        sunk,
        sunkCells: sunk ? hitShip.cells : null,
        autoMissCells,
        gameOver: allSunk,
        winnerSide: allSunk ? mySide : null,
        nextTurn: room.turn,
        nextTurnSeat: room.fireSeat[room.turn],
      };
      broadcastRoom(room, resultMsg);
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (ws.side && ws.seatIndex !== null) room.seats[ws.side][ws.seatIndex] = null;
    broadcastRoom(room, { type: 'opponent_left' });
    rooms.delete(ws.roomCode);
  });
});

server.listen(PORT, () => {
  console.log(`Serwer statkow dziala na porcie ${PORT}`);
});
