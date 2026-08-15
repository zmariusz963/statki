const BOARD_SIZE = 10;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

document.getElementById('btn-mute').onclick = () => {
  const muted = AudioEngine.toggleMute();
  document.getElementById('btn-mute').innerHTML = muted ? '&#128263;' : '&#128266;';
};

document.getElementById('btn-fullscreen').onclick = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
};

document.addEventListener('fullscreenchange', () => {
  document.getElementById('btn-fullscreen').innerHTML = document.fullscreenElement ? '&#10006;' : '&#9974;';
});

const SHIP_DEFS = [
  { name: 'Czteromasztowiec', shape: [[0, 0], [1, 0], [2, 0], [3, 0]], altShapes: [[[0, 0], [1, 0], [2, 0], [2, 1]]] },
  { name: 'Trojmasztowiec 1', shape: [[0, 0], [1, 0], [2, 0]], altShapes: [[[0, 0], [1, 0], [1, 1]]] },
  { name: 'Trojmasztowiec 2', shape: [[0, 0], [1, 0], [2, 0]], altShapes: [[[0, 0], [1, 0], [1, 1]]] },
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
  onlineMode: document.getElementById('screen-online-mode'),
  waiting: document.getElementById('screen-waiting'),
  pass: document.getElementById('screen-pass'),
  place: document.getElementById('screen-place'),
  game: document.getElementById('screen-game'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
  document.getElementById('btn-back-menu').classList.toggle('hidden', name === 'lobby');
}

document.getElementById('btn-back-menu').onclick = () => {
  if (ws) {
    try { ws.close(); } catch (e) { /* ignore */ }
    ws = null;
  }
  document.getElementById('lobby-message').textContent = '';
  showScreen('lobby');
};

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

function shipShapeVariant(def, variant) {
  if (variant === 0 || !def.altShapes) return def.shape;
  return def.altShapes[variant - 1];
}

function shipVariantCount(def) {
  return 1 + (def.altShapes ? def.altShapes.length : 0);
}

function shipCellSet(ships) {
  const set = new Set();
  ships.forEach(ship => ship.cells.forEach(([x, y]) => set.add(`${x},${y}`)));
  return set;
}

function fleetSizeCounts() {
  const counts = {};
  SHIP_DEFS.forEach(def => {
    const size = def.shape.length;
    counts[size] = (counts[size] || 0) + 1;
  });
  return counts;
}

function renderSunkTally(containerId, sunkShipsList) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalCounts = fleetSizeCounts();
  const sunkCounts = {};
  sunkShipsList.forEach(ship => {
    const size = ship.cells.length;
    sunkCounts[size] = (sunkCounts[size] || 0) + 1;
  });
  const sizes = Object.keys(totalCounts).map(Number).sort((a, b) => b - a);
  el.innerHTML = '';
  sizes.forEach(size => {
    const sunk = sunkCounts[size] || 0;
    const total = totalCounts[size];
    const row = document.createElement('tr');
    if (sunk === total) row.classList.add('all-sunk');
    row.innerHTML = `<td class="sunk-tally-size">${size}-masztowe</td><td class="sunk-tally-count">${sunk}/${total}</td>`;
    el.appendChild(row);
  });
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

function shapeOrientations(def) {
  const variants = [def.shape, ...(def.altShapes || [])];
  const seen = new Set();
  const result = [];
  variants.forEach((shape, variantIdx) => {
    for (let rotation = 0; rotation < 4; rotation++) {
      [false, true].forEach((mirrored) => {
        const cells = shapeCells(0, 0, shape, rotation, mirrored);
        const key = cells.map(c => c.join(',')).sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        result.push({ variant: variantIdx, rotation, mirrored, cells });
      });
    }
  });
  return result;
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
let currentVariant = 0;
let lastHoverX = null;
let lastHoverY = null;
let selectedIdx = 0;
let placedByIndex = [];
let placementOrder = [];
let placedSet = new Set();
let onPlacementReady = null;
let manualCells = [];
let placementSingleShipMode = false;

function hasConflict(x, y) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (placedSet.has(`${x + dx},${y + dy}`)) return true;
    }
  }
  return false;
}

function firstFreeAnchor(shape, rotation, mirrored) {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cells = shapeCells(x, y, shape, rotation, mirrored);
      if (cellsInBounds(cells) && cells.every(([cx, cy]) => !hasConflict(cx, cy))) {
        return [x, y];
      }
    }
  }
  return [0, 0];
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

function startPlacementUI(onReady, opts) {
  opts = opts || {};
  showScreen('place');
  currentRotation = 0;
  currentMirrored = false;
  currentVariant = 0;
  lastHoverX = null;
  lastHoverY = null;
  placedByIndex = new Array(SHIP_DEFS.length).fill(null);
  placementOrder = [];
  placedSet = new Set();
  manualCells = [];
  placementSingleShipMode = !!opts.singleShip;
  onPlacementReady = onReady;
  document.getElementById('place-message').textContent = '';

  if (opts.preplaced) {
    opts.preplaced.forEach((ship, i) => {
      placedByIndex[i] = ship;
      placementOrder.push(i);
      ship.cells.forEach(([x, y]) => placedSet.add(`${x},${y}`));
    });
  }
  const next = firstUnplacedIndex();
  selectedIdx = next === -1 ? 0 : next;
  refreshPlacementUI();
}

function refreshPlacementUI() {
  renderPlaceHint();
  renderShipsLegend();
  renderShapePicker();
  buildPlaceBoardUI();

  const allPlaced = placedByIndex.every(Boolean);
  const pending = !placedByIndex[selectedIdx];
  const def = SHIP_DEFS[selectedIdx];
  const freeform = def.freeform;
  const hasVariants = shipVariantCount(def) > 1;
  document.getElementById('btn-ready').classList.toggle('hidden', !allPlaced);
  document.getElementById('btn-rotate').classList.toggle('hidden', !pending || !!freeform || hasVariants);
  document.getElementById('btn-mirror').classList.add('hidden');
  document.getElementById('btn-undo').classList.toggle('hidden', placementOrder.length === 0 && manualCells.length === 0);

  if (pending && !freeform) {
    // Auto-preview the pending ship. The remembered position is only reused when the ship
    // still actually fits there - otherwise (e.g. right after placing a ship on that very
    // spot, which is what happens on touch devices where there is no pointer movement to
    // refresh it) we jump to the first free anchor instead of showing a red overlapping ghost.
    const shape = shipShapeVariant(def, currentVariant);
    let px = lastHoverX;
    let py = lastHoverY;
    let fits = px !== null && py !== null;
    if (fits) {
      const cells = shapeCells(px, py, shape, currentRotation, currentMirrored);
      fits = cellsInBounds(cells) && cells.every(([cx, cy]) => !hasConflict(cx, cy));
    }
    if (!fits) {
      const anchor = firstFreeAnchor(shape, currentRotation, currentMirrored);
      px = anchor[0];
      py = anchor[1];
    }
    previewShip(px, py);
  }
}

function renderShapePicker() {
  const picker = document.getElementById('shape-picker');
  const def = SHIP_DEFS[selectedIdx];
  if (!def || def.freeform || shipVariantCount(def) <= 1) {
    picker.classList.add('hidden');
    picker.innerHTML = '';
    return;
  }
  picker.classList.remove('hidden');
  picker.innerHTML = '';
  const placed = placedByIndex[selectedIdx];
  shapeOrientations(def).forEach((orient) => {
    const item = document.createElement('div');
    item.className = 'shape-thumb-item';
    const active = placed
      ? (placed.variant === orient.variant && placed.rotation === orient.rotation && placed.mirrored === orient.mirrored)
      : (currentVariant === orient.variant && currentRotation === orient.rotation && currentMirrored === orient.mirrored);
    if (active) item.classList.add('current');
    item.appendChild(renderLegendMini(orient.cells));
    item.onclick = () => chooseShapeOrientation(orient);
    picker.appendChild(item);
  });
}

function chooseShapeOrientation(orient) {
  const idx = selectedIdx;
  const def = SHIP_DEFS[idx];
  if (placedByIndex[idx]) {
    const placed = placedByIndex[idx];
    const oldCells = placed.cells;
    const anchorX = Math.min(...oldCells.map(c => c[0]));
    const anchorY = Math.min(...oldCells.map(c => c[1]));
    oldCells.forEach(([x, y]) => placedSet.delete(`${x},${y}`));
    const newCells = shapeCells(anchorX, anchorY, shipShapeVariant(def, orient.variant), orient.rotation, orient.mirrored);
    const valid = cellsInBounds(newCells) && newCells.every(([x, y]) => !hasConflict(x, y));
    if (valid) {
      newCells.forEach(([x, y]) => placedSet.add(`${x},${y}`));
      placedByIndex[idx] = { cells: newCells, rotation: orient.rotation, mirrored: orient.mirrored, variant: orient.variant };
      document.getElementById('place-message').textContent = '';
    } else {
      oldCells.forEach(([x, y]) => placedSet.add(`${x},${y}`));
      document.getElementById('place-message').textContent = 'Brak miejsca na ten uklad w tym miejscu - przesun statek i sprobuj ponownie.';
    }
  } else {
    currentVariant = orient.variant;
    currentRotation = orient.rotation;
    currentMirrored = orient.mirrored;
    if (lastHoverX !== null) previewShip(lastHoverX, lastHoverY);
  }
  refreshPlacementUI();
}

function renderPlaceHint() {
  const def = SHIP_DEFS[selectedIdx];
  if (!placedByIndex[selectedIdx]) {
    if (def.freeform) {
      document.getElementById('place-hint').textContent = `Ustaw: ${def.name} - wybierz pole ${manualCells.length + 1}/${def.shape.length} (sasiadujace), kliknij ostatnie by cofnac`;
    } else if (shipVariantCount(def) > 1) {
      document.getElementById('place-hint').textContent = `Ustaw: ${def.name} - wybierz uklad ponizej, potem kliknij pole na planszy.`;
    } else {
      document.getElementById('place-hint').textContent = `Ustaw: ${def.name}`;
    }
  } else if (shipVariantCount(def) > 1) {
    document.getElementById('place-hint').textContent = `${def.name} postawiony. Wybierz inny uklad ponizej lub kliknij inny statek na liscie.`;
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
  currentVariant = 0;
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

  const cells = shapeCells(x, y, shipShapeVariant(SHIP_DEFS[selectedIdx], currentVariant), currentRotation, currentMirrored);
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
  const cells = shapeCells(x, y, shipShapeVariant(SHIP_DEFS[selectedIdx], currentVariant), currentRotation, currentMirrored);

  if (!cellsInBounds(cells)) {
    document.getElementById('place-message').textContent = 'Statek nie miesci sie na planszy.';
    return;
  }
  if (cells.some(([cx, cy]) => hasConflict(cx, cy))) {
    document.getElementById('place-message').textContent = 'Statki nie moga sie stykac ze soba.';
    return;
  }

  cells.forEach(([cx, cy]) => placedSet.add(`${cx},${cy}`));
  const placedShip = { cells, rotation: currentRotation, mirrored: currentMirrored, variant: currentVariant };
  placedByIndex[selectedIdx] = placedShip;
  placementOrder.push(selectedIdx);
  document.getElementById('place-message').textContent = '';

  if (placementSingleShipMode) {
    if (onPlacementReady) onPlacementReady([placedShip]);
    return;
  }

  const next = firstUnplacedIndex();
  if (next !== -1) selectedIdx = next;
  currentRotation = 0;
  currentMirrored = false;
  currentVariant = 0;
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
  currentVariant = 0;
  document.getElementById('place-message').textContent = '';
  refreshPlacementUI();
};

document.getElementById('btn-ready').onclick = () => {
  if (onPlacementReady) onPlacementReady(placedShipsList());
};

function pulseTurnIndicator() {
  const el = document.getElementById('turn-indicator');
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function showPass(title, message, onContinue) {
  showScreen('pass');
  const titleEl = document.getElementById('pass-title');
  titleEl.textContent = title;
  titleEl.classList.toggle('hidden', !title);
  document.getElementById('pass-message').textContent = message;
  document.getElementById('btn-pass-continue').onclick = onContinue;
}

// ---------- Random fleet placement (for computer sides) ----------

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
      const variant = Math.floor(Math.random() * shipVariantCount(def));
      const x = Math.floor(Math.random() * BOARD_SIZE);
      const y = Math.floor(Math.random() * BOARD_SIZE);
      const cells = shapeCells(x, y, shipShapeVariant(def, variant), rotation, mirrored);
      if (!cellsInBounds(cells)) continue;
      if (cells.some(([cx, cy]) => cellConflictsWithSet(occupied, cx, cy))) continue;
      cells.forEach(([cx, cy]) => occupied.add(`${cx},${cy}`));
      ships.push({ cells });
      placed = true;
    }
  });
  return ships;
}

// ---------- Online mode (2-4 real players over the network, side-based) ----------

let ws;
let mySide = null;
let mySeatIndex = null;
let isLeader = false;
let onlineTurn = 'A';
let onlineTurnSeat = 0;
let myOnlineTurn = false;
let onlineOwnShips = null;
let onlineSeatsA = 1;
let onlineSeatsB = 1;
let onlineTeamShips = [];
const onlineHits = { A: {}, B: {} };
const onlineSunkShips = { A: [], B: [] };

function onlineSeatsForSide(s) {
  return s === 'A' ? onlineSeatsA : onlineSeatsB;
}

function otherSideClient(s) {
  return s === 'A' ? 'B' : 'A';
}

let keepaliveTimer = null;

// Shows a message on whichever screen the player is actually looking at. Without this,
// disconnects and server errors were written to elements on other screens, so a player
// stuck during placement saw no explanation at all - just an endless "waiting" message.
function showOnlineStatus(text) {
  const target = [
    ['game', 'game-message'],
    ['place', 'place-message'],
    ['pass', 'pass-message'],
    ['waiting', 'waiting-hint'],
    ['lobby', 'lobby-message'],
  ].find(([screen]) => screens[screen] && !screens[screen].classList.contains('hidden'));
  if (target) document.getElementById(target[1]).textContent = text;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
  // addEventListener, not onopen: the lobby buttons assign their own ws.onopen to send
  // create/join, which would silently wipe out the keepalive if it lived there too.
  ws.addEventListener('open', () => {
    clearInterval(keepaliveTimer);
    // Placement sends no traffic for minutes; without this the connection is dropped as idle.
    keepaliveTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 20000);
  });
  ws.addEventListener('close', () => {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    showOnlineStatus('Polaczenie przerwane. Wroc do menu i dolacz ponownie tym samym kodem.');
  });
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'created':
      mySide = 'A';
      mySeatIndex = 0;
      isLeader = true;
      onlineSeatsA = msg.seatsA;
      onlineSeatsB = msg.seatsB;
      document.getElementById('room-code').textContent = msg.code;
      updateOnlineWaitingHint(msg);
      showScreen('waiting');
      break;
    case 'joined':
      mySide = msg.side;
      mySeatIndex = msg.seatIndex;
      isLeader = msg.isLeader;
      onlineSeatsA = msg.seatsA;
      onlineSeatsB = msg.seatsB;
      if (msg.filledA === msg.seatsA && msg.filledB === msg.seatsB) {
        proceedToOnlinePlacement();
      } else {
        document.getElementById('room-code').textContent = '----';
        updateOnlineWaitingHint(msg);
        showScreen('waiting');
      }
      break;
    case 'seat_update':
      if (msg.filledA === msg.seatsA && msg.filledB === msg.seatsB) {
        proceedToOnlinePlacement();
      } else {
        updateOnlineWaitingHint(msg);
      }
      break;
    case 'pong':
      break;
    case 'error':
      showOnlineStatus(msg.message);
      break;
    case 'side_ready':
      if (msg.side === otherSideClient(mySide) && screens.place && !screens.place.classList.contains('hidden')) {
        document.getElementById('place-message').textContent = 'Przeciwnicy sa gotowi. Czekamy na Was.';
      }
      break;
    case 'side_ships':
      onlineOwnShips = msg.ships;
      break;
    case 'ship_placed':
      if (msg.side === mySide) handleTeamShipPlaced(msg);
      break;
    case 'start':
      onlineTurn = msg.turn;
      onlineTurnSeat = msg.turnSeat || 0;
      myOnlineTurn = onlineTurn === mySide && (onlineSeatsForSide(mySide) < 2 || onlineTurnSeat === mySeatIndex);
      startOnlineSideGame();
      break;
    case 'fire_result':
      applyOnlineSideFireResult(msg);
      break;
    case 'opponent_left':
      showOnlineStatus('Drugi gracz stracil polaczenie. Moze dolaczyc ponownie tym samym kodem.');
      break;
  }
}

function updateOnlineWaitingHint(msg) {
  const filled = msg.filledA + msg.filledB;
  const total = msg.seatsA + msg.seatsB;
  document.getElementById('waiting-hint').textContent = `Czekam na graczy... (${filled}/${total} dolaczylo)`;
}

function proceedToOnlinePlacement() {
  onlineTeamShips = [];
  if (onlineSeatsForSide(mySide) < 2) {
    if (isLeader) {
      startPlacementUI(onOnlineReady);
    } else {
      showWaitingForTeam('Rozstawianie statkow', 'Twoj partner (pierwszy w pokoju) rozstawia statki. Czekaj...');
    }
  } else if (mySeatIndex === 0) {
    startOnlineTeamShipTurn();
  } else {
    showWaitingForTeam('Rozstawianie statkow', 'Twoj partner stawia pierwszy statek. Czekaj na swoja kolej...');
  }
}

function showWaitingForTeam(title, message) {
  showScreen('pass');
  document.getElementById('pass-title').textContent = title;
  document.getElementById('pass-title').classList.remove('hidden');
  document.getElementById('pass-message').textContent = message;
  document.getElementById('btn-pass-continue').classList.add('hidden');
}

// Used only for 1-seat sides (1v1, 1vAI's human side). Sends the whole fleet at once,
// independent from the 2-seat team placement flow below.
function onOnlineReady(ships) {
  ws.send(JSON.stringify({ type: 'place_ships', ships }));
  document.getElementById('btn-ready').disabled = true;
  document.getElementById('place-message').textContent = 'Czekamy na pozostalych graczy...';
}

function startOnlineTeamShipTurn() {
  startPlacementUI(onOnlineSingleShipReady, { singleShip: true, preplaced: onlineTeamShips });
}

function onOnlineSingleShipReady(ships) {
  const ship = ships[0];
  ws.send(JSON.stringify({ type: 'place_ship', cells: ship.cells }));
  showWaitingForTeam('Statek wyslany', 'Czekaj, teraz kolej partnera na postawienie statku.');
}

function handleTeamShipPlaced(msg) {
  onlineTeamShips.push({ cells: msg.cells });
  if (msg.shipsPlaced >= msg.totalShips) {
    showWaitingForTeam('Flota gotowa', 'Wasza flota jest gotowa. Czekamy na przeciwnikow...');
    return;
  }
  if (msg.activeSeatIndex === mySeatIndex) {
    startOnlineTeamShipTurn();
  } else {
    showWaitingForTeam('Kolej partnera', `Partner stawia statek ${msg.shipsPlaced + 1}/${msg.totalShips}. Czekaj na swoja kolej...`);
  }
}

document.getElementById('btn-create').onclick = () => {
  showScreen('onlineMode');
};

document.getElementById('btn-online-1v1').onclick = () => {
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'create', mode: '1v1' }));
};

document.getElementById('btn-online-2v2').onclick = () => {
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'create', mode: '2v2' }));
};

document.getElementById('btn-online-2vai').onclick = () => {
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'create', mode: '2vai' }));
};

document.getElementById('btn-join').onclick = () => {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!code) return;
  connect();
  ws.onopen = () => ws.send(JSON.stringify({ type: 'join', code }));
};

function startOnlineSideGame() {
  showScreen('game');
  onlineHits.A = {};
  onlineHits.B = {};
  onlineSunkShips.A = [];
  onlineSunkShips.B = [];
  document.getElementById('enemy-board-title').textContent = 'Przeciwnicy';
  document.getElementById('own-board-title').textContent = 'Wy';
  document.getElementById('game-message').classList.remove('game-over-banner');
  renderOnlineSideBoards();
  updateOnlineTurnIndicator();
}

function updateOnlineTurnIndicator() {
  let text;
  if (myOnlineTurn) {
    text = 'Wasza tura - strzelajcie!';
  } else if (onlineTurn === mySide) {
    text = 'Tura partnera - czekaj...';
  } else {
    text = 'Tura przeciwnikow...';
  }
  document.getElementById('turn-indicator').textContent = text;
  pulseTurnIndicator();
}

function renderOnlineSideBoards() {
  const target = otherSideClient(mySide);
  const hits = onlineHits[target];
  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (x, y) => [hits[`${x},${y}`] || null],
    getCellContent: (x, y) => symbolForState(hits[`${x},${y}`]),
    onClick: fireOnlineSide,
  });
  renderShipOverlays(enemyGrid, onlineSunkShips[target], () => true);
  renderSunkTally('sunk-tally', onlineSunkShips[target]);

  const myHits = onlineHits[mySide];
  const ownShipCells = shipCellSet(onlineOwnShips || []);
  const ownGrid = buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [
      myHits[`${x},${y}`] || null,
      ownShipCells.has(`${x},${y}`) ? 'own-ship' : null,
    ],
    getCellContent: (x, y) => symbolForState(myHits[`${x},${y}`]),
  });
  renderShipOverlays(ownGrid, onlineOwnShips || [], (ship) => ship.cells.every(([x, y]) => myHits[`${x},${y}`] === 'sunk'));
}

function fireOnlineSide(x, y) {
  if (!myOnlineTurn) return;
  const target = otherSideClient(mySide);
  const key = `${x},${y}`;
  if (onlineHits[target][key]) return;
  AudioEngine.playCannonShot();
  spawnProjectile(document.querySelector('#enemy-board .grid'), x, y);
  ws.send(JSON.stringify({ type: 'fire', x, y }));
}

function applyOnlineSideFireResult(msg) {
  const key = `${msg.x},${msg.y}`;
  const targetSide = otherSideClient(msg.shooterSide);
  const iAmShooterSide = msg.shooterSide === mySide;
  const iAmTargetSide = targetSide === mySide;
  const targetHits = onlineHits[targetSide];
  targetHits[key] = msg.hit ? 'hit' : 'miss';

  if (msg.sunk && msg.sunkCells) {
    msg.sunkCells.forEach(([sx, sy]) => {
      targetHits[`${sx},${sy}`] = 'sunk';
    });
    onlineSunkShips[targetSide].push({ cells: msg.sunkCells });
  }

  if (msg.autoMissCells) {
    msg.autoMissCells.forEach(([sx, sy]) => {
      targetHits[`${sx},${sy}`] = 'miss';
    });
  }

  renderOnlineSideBoards();

  const boardId = iAmTargetSide ? 'own-board' : 'enemy-board';
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

  onlineTurn = msg.nextTurn;
  onlineTurnSeat = msg.nextTurnSeat || 0;
  myOnlineTurn = onlineTurn === mySide && (onlineSeatsForSide(mySide) < 2 || onlineTurnSeat === mySeatIndex);
  updateOnlineTurnIndicator();

  const gm = document.getElementById('game-message');
  if (msg.gameOver) {
    gm.textContent = iAmShooterSide ? 'ZWYCIEZCA: Wy! Cala flota przeciwnikow zatopiona.' : 'ZWYCIEZCA: Przeciwnicy! Wasza flota zostala zatopiona.';
    gm.classList.add('game-over-banner');
  } else if (msg.hit) {
    gm.textContent = iAmShooterSide ? 'Trafienie!' : (iAmTargetSide ? 'Przeciwnicy Was trafili.' : 'Trafienie.');
  } else {
    gm.textContent = iAmShooterSide ? 'Pudlo.' : (iAmTargetSide ? 'Przeciwnicy nie trafili.' : 'Pudlo.');
  }
}

// ---------- Local side-based modes (Gracz vs Gracz / vs Komputer / 2v2 / 2v2 komputer) ----------
// Each side has ONE shared board/fleet. A side can be controlled by 1 or 2 human
// players (sharing the same board, taking turns hotseat-style) or by the computer.

const side = {
  labelA: '',
  labelB: '',
  bIsAI: false,
  ships: { A: null, B: null },
  hits: { A: new Set(), B: new Set() },
  turn: 'A',
};

let aiTargetQueue = [];

function startSideMode(labelA, labelB, bIsAI) {
  side.labelA = labelA;
  side.labelB = labelB;
  side.bIsAI = bIsAI;
  side.ships = { A: null, B: null };
  side.hits = { A: new Set(), B: new Set() };
  side.turn = 'A';
  aiTargetQueue = [];

  showPass('', `${labelA}, rozstawcie swoje statki. Kliknij Dalej gdy jestescie gotowi.`, () => {
    startPlacementUI((ships) => onSidePlacementReady('A', ships));
  });
}

function onSidePlacementReady(who, ships) {
  side.ships[who] = ships;
  if (who === 'A') {
    if (side.bIsAI) {
      side.ships.B = randomAIFleet();
      showPass(side.labelA, 'Wszystkie statki rozstawione. Wasza tura - strzelajcie pierwsi!', () => {
        startSideTurn();
      });
    } else {
      showPass('', `${side.labelB}, rozstawcie swoje statki. Kliknij Dalej gdy jestescie gotowi.`, () => {
        startPlacementUI((shipsB) => onSidePlacementReady('B', shipsB));
      });
    }
  } else {
    showPass(side.labelA, 'Wszystkie statki rozstawione. Wasza tura - strzelajcie pierwsi!', () => {
      startSideTurn();
    });
  }
}

function otherSide(who) {
  return who === 'A' ? 'B' : 'A';
}

function sideLabel(who) {
  return who === 'A' ? side.labelA : side.labelB;
}

function cellStateSide(targetSide, x, y) {
  const key = `${x},${y}`;
  if (!side.hits[targetSide].has(key)) return null;
  const ship = side.ships[targetSide].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  if (!ship) return 'miss';
  const sunk = ship.cells.every(([sx, sy]) => side.hits[targetSide].has(`${sx},${sy}`));
  return sunk ? 'sunk' : 'hit';
}

function shipFullySunkSide(targetSide, ship) {
  return ship.cells.every(([x, y]) => side.hits[targetSide].has(`${x},${y}`));
}

function startSideTurn() {
  const shooter = side.turn;
  if (shooter === 'B' && side.bIsAI) {
    announceAISideTurn();
    return;
  }

  showScreen('game');
  const gm = document.getElementById('game-message');
  gm.textContent = '';
  gm.classList.remove('game-over-banner');
  document.getElementById('turn-indicator').textContent = `${sideLabel(shooter)} - Wasza tura, strzelajcie!`;
  pulseTurnIndicator();

  renderSideBoards(shooter, true);
}

function announceAISideTurn() {
  showScreen('pass');
  document.getElementById('pass-title').textContent = side.labelB;
  document.getElementById('pass-title').classList.remove('hidden');
  document.getElementById('pass-message').textContent = `${side.labelB} namierza cel...`;
  document.getElementById('btn-pass-continue').classList.add('hidden');
  setTimeout(() => {
    document.getElementById('btn-pass-continue').classList.remove('hidden');
    runAISideTurn();
  }, 900);
}

function runAISideTurn() {
  const target = otherSide('B');
  let x, y;

  while (aiTargetQueue.length > 0) {
    const [cx, cy] = aiTargetQueue.shift();
    if (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE && !side.hits[target].has(`${cx},${cy}`)) {
      x = cx;
      y = cy;
      break;
    }
  }

  if (x === undefined) {
    const emptyCells = [];
    for (let yy = 0; yy < BOARD_SIZE; yy++) {
      for (let xx = 0; xx < BOARD_SIZE; xx++) {
        if (!side.hits[target].has(`${xx},${yy}`)) emptyCells.push([xx, yy]);
      }
    }
    [x, y] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  }

  showScreen('game');
  document.getElementById('game-message').textContent = '';
  document.getElementById('game-message').classList.remove('game-over-banner');
  document.getElementById('turn-indicator').textContent = `${side.labelB} strzela...`;
  renderSideBoards('B', false);

  setTimeout(() => {
    const hitShip = side.ships[target].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
    fireSide(x, y, 'B', target);
    if (hitShip) {
      if (shipFullySunkSide(target, hitShip)) {
        aiTargetQueue = [];
      } else {
        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          .filter(([nx, ny]) => nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE && !side.hits[target].has(`${nx},${ny}`));
        for (let i = neighbors.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
        }
        aiTargetQueue.push(...neighbors);
      }
    }
  }, 500);
}

function renderSideBoards(shooter, interactive) {
  const target = otherSide(shooter);
  document.getElementById('enemy-board-title').textContent = sideLabel(target);
  document.getElementById('own-board-title').textContent = `${sideLabel(shooter)} (Wy)`;

  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (x, y) => [side.hits[target].has(`${x},${y}`) ? cellStateSide(target, x, y) : null],
    getCellContent: (x, y) => side.hits[target].has(`${x},${y}`) ? symbolForState(cellStateSide(target, x, y)) : '',
    onClick: interactive ? (x, y) => fireSide(x, y, shooter, target) : () => {},
  });
  const sunkTargetShips = side.ships[target].filter(ship => shipFullySunkSide(target, ship));
  renderShipOverlays(enemyGrid, sunkTargetShips, () => true);
  renderSunkTally('sunk-tally', sunkTargetShips);

  const ownShipCells = shipCellSet(side.ships[shooter]);
  const ownGrid = buildBoard('own-board', {
    small: true,
    getCellClass: (x, y) => [
      side.hits[shooter].has(`${x},${y}`) ? cellStateSide(shooter, x, y) : null,
      ownShipCells.has(`${x},${y}`) ? 'own-ship' : null,
    ],
    getCellContent: (x, y) => side.hits[shooter].has(`${x},${y}`) ? symbolForState(cellStateSide(shooter, x, y)) : '',
  });
  renderShipOverlays(ownGrid, side.ships[shooter], (ship) => shipFullySunkSide(shooter, ship));
}

function fireSide(x, y, shooter, target) {
  const key = `${x},${y}`;
  if (side.hits[target].has(key)) return;

  AudioEngine.playCannonShot();
  spawnProjectile(document.querySelector('#enemy-board .grid'), x, y);
  side.hits[target].add(key);
  const hitShip = side.ships[target].find(s => s.cells.some(([sx, sy]) => sx === x && sy === y));
  const isHit = !!hitShip;
  const shipJustSunk = isHit && shipFullySunkSide(target, hitShip);
  const allSunk = side.ships[target].every(s => shipFullySunkSide(target, s));

  if (shipJustSunk) {
    surroundingCells(hitShip.cells).forEach(([sx, sy]) => side.hits[target].add(`${sx},${sy}`));
  }

  const enemyGrid = buildBoard('enemy-board', {
    getCellClass: (cx, cy) => [side.hits[target].has(`${cx},${cy}`) ? cellStateSide(target, cx, cy) : null],
    getCellContent: (cx, cy) => side.hits[target].has(`${cx},${cy}`) ? symbolForState(cellStateSide(target, cx, cy)) : '',
    onClick: () => {},
  });
  const sunkTargetShips = side.ships[target].filter(ship => shipFullySunkSide(target, ship));
  renderShipOverlays(enemyGrid, sunkTargetShips, () => true);
  renderSunkTally('sunk-tally', sunkTargetShips);
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
    document.getElementById('turn-indicator').textContent = `ZWYCIEZCA: ${sideLabel(shooter)}!`;
    return;
  }

  document.getElementById('game-message').textContent = isHit ? (shipJustSunk ? 'Zatopiony!' : 'Trafienie!') : 'Pudlo.';

  side.turn = target;
  setTimeout(() => {
    startSideTurn();
  }, 1200);
}

document.getElementById('btn-mode-1v1').onclick = () => {
  startSideMode('Gracz 1', 'Gracz 2', false);
};

document.getElementById('btn-mode-1vai').onclick = () => {
  startSideMode('Gracz 1', 'Komputer', true);
};

document.getElementById('btn-mode-2vai').onclick = () => {
  startSideMode('Gracz 1 i Gracz 2', 'Komputer', true);
};
