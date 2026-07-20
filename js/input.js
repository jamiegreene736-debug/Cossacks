// Mouse + keyboard control for selection, orders, building placement,
// formations, control groups, camera movement and minimap navigation.

import { camera, screenToWorld, clampCamera, minimapToWorld } from './render.js';
import { WORLD } from './config.js';
import { applyMoveOrder, applyAttackOrder, haltOrder } from './formations.js';
import {
  assignBuilders, assignGatherers, clearWorkerJobs, findEntityAt,
  findResourceAt, setRallyPoint,
} from './economy.js';
import {
  isFortificationType, rotateFortificationOrientation,
} from './fortifications.js';

let getWorld = () => null;
let callbacks = {};
let selection = [];
let currentFormation = 'line';
let placement = null;
const groups = {};
const keys = new Set();

let drag = null;
let panDrag = null;
let mmDown = false;
let mouseX = 0, mouseY = 0, mouseIn = false;
let inputCanvas = null;
let resourceHover = null;
let movePreview = null;

const EDGE = 26;
const PAN_SPEED = 720;
const MOVE_FEEDBACK_LIFE = 2.8;

export function initInput(canvas, minimap, worldGetter, cbs) {
  getWorld = worldGetter;
  callbacks = cbs || {};
  inputCanvas = canvas;
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  canvas.addEventListener('mousedown', event => {
    const world = getWorld();
    if (!world || world.state === 'ended') return;
    if (placement) {
      if (event.button === 2) cancelPlacement();
      else if (event.button === 0) placeAt(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (event.button === 0) {
      if (keys.has(' ')) {
        panDrag = { sx: event.clientX, sy: event.clientY, camX: camera.x, camY: camera.y };
      } else if (gatherAt(event.clientX, event.clientY)) {
        return;
      } else {
        drag = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
      }
    } else if (event.button === 1) {
      event.preventDefault();
      panDrag = { sx: event.clientX, sy: event.clientY, camX: camera.x, camY: camera.y };
    } else if (event.button === 2) {
      issueOrder(event.clientX, event.clientY);
    }
  });

  document.addEventListener('mousedown', event => {
    if (!placement || event.button !== 0 || event.target === canvas) return;
    if (event.target.closest?.('button[data-action="build"]')) return;
    cancelPlacement();
  }, true);

  window.addEventListener('mousemove', event => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    if (drag) { drag.x1 = event.clientX; drag.y1 = event.clientY; }
    if (placement) updatePlacement(event.clientX, event.clientY);
    else updateResourceHover(event.clientX, event.clientY);
    if (panDrag) {
      camera.x = panDrag.camX - (event.clientX - panDrag.sx) / camera.zoom;
      camera.y = panDrag.camY - (event.clientY - panDrag.sy) / camera.zoom;
      clampCamera();
    }
    if (mmDown) minimapJump(event);
  });

  window.addEventListener('mouseup', event => {
    if (event.button === 0 && drag) { finishSelect(event.shiftKey); drag = null; }
    if (panDrag && (event.button === 0 || event.button === 1)) panDrag = null;
    if (event.button === 0) mmDown = false;
  });

  document.addEventListener('mouseleave', () => { mouseIn = false; clearResourceHover(); });
  document.addEventListener('mouseenter', () => { mouseIn = true; });
  window.addEventListener('mousemove', () => { mouseIn = true; }, { once: true });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (!getWorld()) return;
    const before = screenToWorld(event.clientX, event.clientY);
    camera.zoom = Math.max(0.42, Math.min(2.5, camera.zoom * Math.exp(-event.deltaY * 0.0013)));
    const after = screenToWorld(event.clientX, event.clientY);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    clampCamera();
  }, { passive: false });

  minimap.addEventListener('mousedown', event => {
    if (event.button === 0) { mmDown = true; minimapJump(event); }
  });

  window.addEventListener('keydown', event => {
    if (event.target.tagName === 'SELECT' || event.target.tagName === 'INPUT') return;
    keys.add(event.key.toLowerCase());
    if (event.key === ' ') event.preventDefault();
    if (!getWorld()) return;
    const key = event.key.toLowerCase();
    if (key === 'escape') cancelPlacement();
    else if (key === 'r' && placement && isFortificationType(placement.type)) {
      placement.orientation = rotateFortificationOrientation(placement.orientation);
      updatePlacement(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
      callbacks.onPlacement?.(placement);
    }
    else if (key === 'l') setFormation('line');
    else if (key === 'c') setFormation('column');
    else if (key === 'b' && !getSelection().some(entity => entity.type === 'villager')) setFormation('square');
    else if (key === 'h') haltSelection();
    else if (key === 'p') callbacks.onPause?.();
    else if (key === 'f' && !getSelection().some(entity => entity.type === 'villager')) selectAll();
    else if (/^[1-9]$/.test(event.key)) {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        groups[event.key] = getSelection().slice();
      } else {
        const group = (groups[event.key] || []).filter(entity => entity.alive);
        groups[event.key] = group;
        if (group.length) setSelection(group.slice());
      }
    }
  });

  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}

function minimapJump(event) {
  const minimap = document.getElementById('minimap');
  const rect = minimap.getBoundingClientRect();
  const point = minimapToWorld(
    (event.clientX - rect.left) * (minimap.width / rect.width),
    (event.clientY - rect.top) * (minimap.height / rect.height),
  );
  camera.x = point.x;
  camera.y = point.y;
  clampCamera();
}

function setSelection(entities) {
  for (const entity of selection) entity.selected = false;
  selection = entities.filter(entity => entity.alive && entity.side === 0);
  for (const entity of selection) entity.selected = true;
  callbacks.onSelection?.(selection);
  updateResourceHover(mouseX, mouseY);
}

export function getSelection() {
  if (selection.some(entity => !entity.alive)) selection = selection.filter(entity => entity.alive);
  return selection;
}

export function clearSelection() { setSelection([]); }

function finishSelect(additive) {
  const world = getWorld();
  if (!world) return;
  const dx = Math.abs(drag.x1 - drag.x0);
  const dy = Math.abs(drag.y1 - drag.y0);
  const start = screenToWorld(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
  const end = screenToWorld(Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1));
  let picked = [];

  if (dx < 6 && dy < 6) {
    const point = screenToWorld(drag.x1, drag.y1);
    const entity = findEntityAt(world, point.x, point.y, 0);
    if (entity) {
      picked = [entity];
    } else if (!additive && issueVillagerGroundMove(world, getSelection(), point.x, point.y, currentFormation)) {
      callbacks.onSelection?.(getSelection());
      updateResourceHover(drag.x1, drag.y1);
      return;
    }
  } else {
    picked = world.units.filter(unit => unit.alive && unit.side === 0
      && unit.x >= start.x && unit.x <= end.x && unit.y >= start.y && unit.y <= end.y);
  }
  if (additive) picked = getSelection().concat(picked.filter(entity => !entity.selected));
  setSelection(picked);
}

export function selectAll() {
  const world = getWorld();
  if (!world) return;
  setSelection(world.units.filter(unit => unit.alive && unit.side === 0 && unit.type !== 'villager'));
}

function issueOrder(screenX, screenY) {
  const world = getWorld();
  const selected = getSelection();
  if (!world || selected.length === 0) return;
  const point = screenToWorld(screenX, screenY);
  const units = selected.filter(entity => entity.entityKind !== 'building');
  const workers = units.filter(unit => unit.type === 'villager');
  const selectedBuildings = selected.filter(entity => entity.entityKind === 'building');

  const enemy = findEntityAt(world, point.x, point.y, 1);
  if (enemy && units.length) {
    clearWorkerJobs(units);
    applyAttackOrder(units, enemy);
    world.flags.push({ x: enemy.x, y: enemy.y, life: 1.2, max: 1.2, attack: true });
    return;
  }

  const ownEntity = findEntityAt(world, point.x, point.y, 0);
  if (workers.length && ownEntity?.entityKind === 'building' && !ownEntity.complete) {
    assignBuilders(world, workers, ownEntity);
    world.flags.push({ x: ownEntity.x, y: ownEntity.y, life: 1.2, max: 1.2 });
    return;
  }

  const resource = findResourceAt(world, point.x, point.y);
  if (workers.length && resource && assignGatherers(world, workers, resource)) {
    world.flags.push({ x: resource.x, y: resource.y, life: 1.2, max: 1.2, gather: true });
    return;
  }

  if (selectedBuildings.length) {
    let changed = false;
    for (const building of selectedBuildings) changed = setRallyPoint(building, point.x, point.y) || changed;
    if (changed) {
      world.flags.push({ x: point.x, y: point.y, life: 1.2, max: 1.2, rally: true });
      callbacks.onToast?.('Rally point set.', 'good');
      return;
    }
  }

  if (units.length) {
    moveUnitsTo(world, units, point.x, point.y, currentFormation);
  }
}

function moveUnitsTo(world, units, x, y, formation) {
  if (!units.length) return false;
  let fromX = 0;
  let fromY = 0;
  for (const unit of units) {
    fromX += unit.x;
    fromY += unit.y;
  }
  fromX /= units.length;
  fromY /= units.length;
  clearWorkerJobs(units);
  applyMoveOrder(units, x, y, formation);
  world.flags.push({
    kind: 'move', route: true,
    x, y, fromX, fromY,
    life: MOVE_FEEDBACK_LIFE, max: MOVE_FEEDBACK_LIFE,
  });
  return true;
}

export function isOpenGroundMoveTarget(world, x, y) {
  return Boolean(world)
    && x >= 0 && x <= WORLD.w && y >= 0 && y <= WORLD.h
    && !findEntityAt(world, x, y)
    && !findResourceAt(world, x, y);
}

export function issueVillagerGroundMove(world, selected, x, y, formation = 'line') {
  const units = selected.filter(entity => entity.alive && entity.side === 0
    && entity.entityKind !== 'building');
  if (!units.some(unit => unit.type === 'villager') || !isOpenGroundMoveTarget(world, x, y)) return false;
  return moveUnitsTo(world, units, x, y, formation);
}

function hoverableResourceAt(screenX, screenY) {
  const world = getWorld();
  const workers = getSelection().filter(entity => entity.type === 'villager');
  if (!world || placement || workers.length === 0) return null;
  const point = screenToWorld(screenX, screenY);
  const target = findResourceAt(world, point.x, point.y);
  if (target?.entityKind === 'building' && !workers.some(worker => worker.side === target.side)) return null;
  return target;
}

function updateResourceHover(screenX, screenY) {
  const target = hoverableResourceAt(screenX, screenY);
  resourceHover = target;
  const selected = getSelection();
  const point = !target && selected.some(entity => entity.type === 'villager')
    ? screenToWorld(screenX, screenY) : null;
  movePreview = point && isOpenGroundMoveTarget(getWorld(), point.x, point.y) ? point : null;
  inputCanvas?.classList.toggle('cursor-gather', Boolean(target));
  inputCanvas?.classList.toggle('cursor-move', Boolean(movePreview));
  callbacks.onResourceHover?.({
    target,
    workers: getSelection().filter(entity => entity.type === 'villager'),
    screenX,
    screenY,
  });
}

function clearResourceHover() {
  if (!resourceHover && !movePreview
      && !inputCanvas?.classList.contains('cursor-gather')
      && !inputCanvas?.classList.contains('cursor-move')) return;
  resourceHover = null;
  movePreview = null;
  inputCanvas?.classList.remove('cursor-gather');
  inputCanvas?.classList.remove('cursor-move');
  callbacks.onResourceHover?.({ target: null, workers: [], screenX: mouseX, screenY: mouseY });
}

function gatherAt(screenX, screenY) {
  const world = getWorld();
  const workers = getSelection().filter(entity => entity.type === 'villager');
  const target = hoverableResourceAt(screenX, screenY);
  if (!world || !target || workers.length === 0 || !assignGatherers(world, workers, target)) return false;
  world.flags.push({ x: target.x, y: target.y, life: 1.2, max: 1.2, gather: true });
  const label = target.resourceType === 'wood' ? 'timber' : target.resourceType;
  callbacks.onToast?.(`${workers.length} villager${workers.length === 1 ? '' : 's'} gathering ${label}.`, 'good');
  callbacks.onSelection?.(getSelection());
  updateResourceHover(screenX, screenY);
  return true;
}

export function setFormation(formation) {
  currentFormation = formation;
  const units = getSelection().filter(entity => entity.entityKind !== 'building' && entity.type !== 'villager');
  if (units.length) {
    let x = 0, y = 0;
    for (const unit of units) { x += unit.x; y += unit.y; }
    applyMoveOrder(units, x / units.length, y / units.length, formation);
  }
  callbacks.onFormation?.(formation);
}

export function haltSelection() {
  const units = getSelection().filter(entity => entity.entityKind !== 'building');
  clearWorkerJobs(units);
  haltOrder(units);
}

export function beginPlacement(type) {
  clearResourceHover();
  placement = {
    type, x: camera.x, y: camera.y, valid: false, message: '',
    orientation: isFortificationType(type) ? 'horizontal' : null,
  };
  updatePlacement(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
  callbacks.onPlacement?.(placement);
}

export function cancelPlacement() {
  if (!placement) return;
  placement = null;
  callbacks.onPlacement?.(null);
  updateResourceHover(mouseX, mouseY);
}

function updatePlacement(screenX, screenY) {
  if (!placement) return;
  const point = screenToWorld(screenX, screenY);
  const validation = callbacks.onValidatePlacement?.(
    placement.type,
    point.x,
    point.y,
    { orientation: placement.orientation },
  )
    || { ok: true, message: '' };
  placement.x = Number.isFinite(validation.x) ? validation.x : point.x;
  placement.y = Number.isFinite(validation.y) ? validation.y : point.y;
  if (validation.orientation) placement.orientation = validation.orientation;
  placement.snappedToId = validation.snappedToId ?? null;
  placement.valid = validation.ok;
  placement.message = validation.message;
}

function placeAt(screenX, screenY, keepPlacing) {
  if (!placement) return;
  updatePlacement(screenX, screenY);
  if (!placement.valid) {
    callbacks.onToast?.(placement.message || 'Cannot build there.', 'danger');
    return;
  }
  const workers = getSelection().filter(entity => entity.type === 'villager');
  const result = callbacks.onPlaceBuilding?.(
    placement.type,
    placement.x,
    placement.y,
    workers,
    { orientation: placement.orientation },
  );
  if (!result?.ok) {
    callbacks.onToast?.(result?.message || 'Construction failed.', 'danger');
    return;
  }
  callbacks.onToast?.(result.message, 'good');
  if (!keepPlacing) cancelPlacement();
}

export function getPlacementPreview() { return placement; }
export function getResourceHoverTarget() { return resourceHover; }
export function getMovePreview() { return movePreview; }

export function getDragRect() {
  if (!drag) return null;
  return {
    x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1),
    w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0),
  };
}

export function resetForBattle() {
  selection = [];
  placement = null;
  for (const key of Object.keys(groups)) delete groups[key];
  drag = null;
  panDrag = null;
  clearResourceHover();
}

export function updateInput(dt) {
  if (!getWorld()) return;
  let vx = 0, vy = 0;
  if (keys.has('w') || keys.has('arrowup')) vy -= 1;
  if (keys.has('s') || keys.has('arrowdown')) vy += 1;
  if (keys.has('a') || keys.has('arrowleft')) vx -= 1;
  if (keys.has('d') || keys.has('arrowright')) vx += 1;
  if (mouseIn && !drag && !panDrag) {
    if (mouseX <= EDGE) vx -= 1;
    else if (mouseX >= window.innerWidth - EDGE) vx += 1;
    if (mouseY <= EDGE) vy -= 1;
    else if (mouseY >= window.innerHeight - EDGE) vy += 1;
  }
  if (vx || vy) {
    const length = Math.hypot(vx, vy);
    camera.x += vx / length * PAN_SPEED / camera.zoom * dt;
    camera.y += vy / length * PAN_SPEED / camera.zoom * dt;
    clampCamera();
  }
}
