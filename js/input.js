// Mouse + keyboard: box selection, move/attack orders, formations,
// control groups, camera pan/zoom, minimap navigation.

import { camera, screenToWorld, clampCamera, minimapToWorld } from './render.js';
import { applyMoveOrder, applyAttackOrder, haltOrder } from './formations.js';

let getWorld = () => null;
let callbacks = {};
let selection = [];
let currentFormation = 'line';
const groups = {};
const keys = new Set();

let drag = null;          // left-drag selection box {x0,y0,x1,y1}
let panDrag = null;       // middle/space drag {sx,sy,camX,camY}
let mmDown = false;
let mouseX = 0, mouseY = 0, mouseIn = false;

const EDGE = 26, PAN_SPEED = 620;

export function initInput(canvas, minimap, worldGetter, cbs) {
  getWorld = worldGetter;
  callbacks = cbs || {};

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousedown', (e) => {
    const world = getWorld();
    if (!world) return;
    if (e.button === 0) {
      if (keys.has(' ')) {
        panDrag = { sx: e.clientX, sy: e.clientY, camX: camera.x, camY: camera.y };
      } else {
        drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
      }
    } else if (e.button === 1) {
      e.preventDefault();
      panDrag = { sx: e.clientX, sy: e.clientY, camX: camera.x, camY: camera.y };
    } else if (e.button === 2) {
      issueOrder(e.clientX, e.clientY);
    }
  });

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX; mouseY = e.clientY;
    if (drag) { drag.x1 = e.clientX; drag.y1 = e.clientY; }
    if (panDrag) {
      camera.x = panDrag.camX - (e.clientX - panDrag.sx) / camera.zoom;
      camera.y = panDrag.camY - (e.clientY - panDrag.sy) / camera.zoom;
      clampCamera();
    }
    if (mmDown) minimapJump(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && drag) { finishSelect(e.shiftKey); drag = null; }
    if (panDrag && (e.button === 0 || e.button === 1)) panDrag = null;
    if (e.button === 0) mmDown = false;
  });

  document.addEventListener('mouseleave', () => { mouseIn = false; });
  document.addEventListener('mouseenter', () => { mouseIn = true; });
  window.addEventListener('mousemove', () => { mouseIn = true; }, { once: true });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const world = getWorld();
    if (!world) return;
    const before = screenToWorld(e.clientX, e.clientY);
    camera.zoom = Math.max(0.45, Math.min(2.4, camera.zoom * Math.exp(-e.deltaY * 0.0013)));
    const after = screenToWorld(e.clientX, e.clientY);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    clampCamera();
  }, { passive: false });

  minimap.addEventListener('mousedown', (e) => {
    if (e.button === 0) { mmDown = true; minimapJump(e); }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') e.preventDefault();
    const world = getWorld();
    if (!world) return;

    const k = e.key.toLowerCase();
    if (k === 'l') setFormation('line');
    else if (k === 'c') setFormation('column');
    else if (k === 'b') setFormation('square');
    else if (k === 'h') haltSelection();
    else if (k === 'p') callbacks.onPause && callbacks.onPause();
    else if (k === 'f') selectAll();
    else if (/^[1-9]$/.test(e.key)) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        groups[e.key] = getSelection().slice();
      } else {
        const g = (groups[e.key] || []).filter(u => u.alive);
        groups[e.key] = g;
        if (g.length) setSelection(g.slice());
      }
    }
  });

  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}

function minimapJump(e) {
  // e.target changes while dragging off the element; always use the minimap itself
  const mm = document.getElementById('minimap');
  const r = mm.getBoundingClientRect();
  const p = minimapToWorld(
    (e.clientX - r.left) * (mm.width / r.width),
    (e.clientY - r.top) * (mm.height / r.height));
  camera.x = p.x; camera.y = p.y;
  clampCamera();
}

// ---------- Selection ----------

function setSelection(units) {
  for (const u of selection) u.selected = false;
  selection = units.filter(u => u.alive && u.side === 0);
  for (const u of selection) u.selected = true;
  callbacks.onSelection && callbacks.onSelection(selection);
}

export function getSelection() {
  if (selection.some(u => !u.alive)) {
    selection = selection.filter(u => u.alive);
  }
  return selection;
}

export function clearSelection() { setSelection([]); }

function finishSelect(additive) {
  const world = getWorld();
  if (!world) return;
  const dx = Math.abs(drag.x1 - drag.x0), dy = Math.abs(drag.y1 - drag.y0);
  const a = screenToWorld(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
  const b = screenToWorld(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
  let picked = [];

  if (dx < 6 && dy < 6) {
    // click select: nearest friendly unit under cursor
    const p = screenToWorld(drag.x1, drag.y1);
    const r = 14 / camera.zoom + 6;
    let best = null, bestD = Infinity;
    for (const u of world.units) {
      if (!u.alive || u.side !== 0) continue;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < r && d < bestD) { bestD = d; best = u; }
    }
    if (best) picked = [best];
  } else {
    for (const u of world.units) {
      if (!u.alive || u.side !== 0) continue;
      if (u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y) picked.push(u);
    }
  }

  if (additive) picked = getSelection().concat(picked.filter(u => !u.selected));
  setSelection(picked);
}

export function selectAll() {
  const world = getWorld();
  if (!world) return;
  setSelection(world.units.filter(u => u.alive && u.side === 0));
}

// ---------- Orders ----------

function issueOrder(sx, sy) {
  const world = getWorld();
  const sel = getSelection();
  if (!world || sel.length === 0) return;
  const p = screenToWorld(sx, sy);

  // attack a specific enemy if one is under the cursor
  const r = 12 / camera.zoom + 6;
  let target = null, bestD = Infinity;
  for (const u of world.units) {
    if (!u.alive || u.side === 0) continue;
    const d = Math.hypot(u.x - p.x, u.y - p.y);
    if (d < r && d < bestD) { bestD = d; target = u; }
  }

  if (target) {
    applyAttackOrder(sel, target);
    world.flags.push({ x: target.x, y: target.y, life: 1.2, max: 1.2, attack: true });
  } else {
    applyMoveOrder(sel, p.x, p.y, currentFormation);
    world.flags.push({ x: p.x, y: p.y, life: 1.2, max: 1.2 });
  }
}

export function setFormation(f) {
  currentFormation = f;
  const sel = getSelection();
  if (sel.length) {
    // re-form around the selection's current centroid
    let cx = 0, cy = 0;
    for (const u of sel) { cx += u.x; cy += u.y; }
    applyMoveOrder(sel, cx / sel.length, cy / sel.length, f);
  }
  callbacks.onFormation && callbacks.onFormation(f);
}

export function getFormation() { return currentFormation; }

export function haltSelection() { haltOrder(getSelection()); }

export function getDragRect() {
  if (!drag) return null;
  return {
    x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0),
  };
}

export function resetForBattle() {
  selection = [];
  for (const k of Object.keys(groups)) delete groups[k];
  drag = null; panDrag = null;
}

// ---------- Per-frame camera update ----------

export function updateInput(dt) {
  const world = getWorld();
  if (!world) return;
  let vx = 0, vy = 0;
  if (keys.has('w') || keys.has('arrowup')) vy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) vy += 1;
  if (keys.has('a') || keys.has('arrowleft')) vx -= 1;
  if (keys.has('d') || keys.has('arrowright')) vx += 1;

  // edge pan
  if (mouseIn && !drag && !panDrag) {
    if (mouseX <= EDGE) vx -= 1;
    else if (mouseX >= window.innerWidth - EDGE) vx += 1;
    if (mouseY <= EDGE) vy -= 1;
    else if (mouseY >= window.innerHeight - EDGE) vy += 1;
  }

  if (vx || vy) {
    const len = Math.hypot(vx, vy);
    camera.x += vx / len * PAN_SPEED / camera.zoom * dt;
    camera.y += vy / len * PAN_SPEED / camera.zoom * dt;
    clampCamera();
  }
}
