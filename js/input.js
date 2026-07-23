// Mouse + keyboard control for selection, orders, building placement,
// formations, control groups, camera movement and minimap navigation.

import {
  camera, screenToWorld, screenPanToWorld, clampCamera, minimapToWorld,
} from './render.js';
import { WORLD, BUILDING_TYPES, UNIT_TYPES } from './config.js';
import { applyMoveOrder, applyAttackOrder, haltOrder } from './formations.js';
import {
  assignBuilders, assignGatherers, assignRepairers, clearWorkerJobs, findEntityAt,
  findResourceAt, isRepairableBuilding, setRallyPoint,
} from './economy.js';
import {
  assignMusketeersToWall, dismountWallUnits,
  isFortificationType, rotateFortificationOrientation,
} from './fortifications.js';
import { formatPeaceTime, isPeaceTime } from './truce.js';
import { assignVillagerPath, clearVillagerPath } from './navigation.js';
import {
  beginThreeFingerViewGesture, createViewGestureState, endThreeFingerViewGesture,
  readThreeFingerViewGesture, readTrackpadViewGesture,
} from './view-gesture.js';
import { clampCameraZoom } from './camera.js';
import { areHostileSides, isPlayerTeam } from './teams.js';

let getWorld = () => null;
let callbacks = {};
let selection = [];
let currentFormation = 'line';
let controlledSide = 0;
let placement = null;
let wallDrag = null;
let primaryBuildingRallyArmed = false;
const groups = {};
const keys = new Set();

let drag = null;
let panDrag = null;
let mmDown = false;
let mouseX = 0, mouseY = 0, mouseIn = false;
let inputCanvas = null;
let resourceHover = null;
let resourceHoverKind = null;
let movePreview = null;

const EDGE = 26;
const PAN_SPEED = 720;
const MOVE_FEEDBACK_LIFE = 2.8;
const BUILD_ROTATE_STEP = Math.PI / 12;
const BUILD_ROTATE_FINE_STEP = Math.PI / 36;
const BUILD_ROTATE_QUARTER_STEP = Math.PI / 2;
const FULL_TURN = Math.PI * 2;

function normalizePlacementRotation(rotation = 0) {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = rotation % FULL_TURN;
  return normalized < 0 ? normalized + FULL_TURN : normalized;
}

function placementSupportsFreeRotation(activePlacement = placement) {
  return Boolean(activePlacement && !isFortificationType(activePlacement.type)
    && !BUILDING_TYPES[activePlacement.type]?.wallAttachment);
}

function applyPlacementRotation(rotation) {
  if (!placementSupportsFreeRotation()) return null;
  placement.rotation = normalizePlacementRotation(rotation);
  if (wallDrag) updateWallDrag(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
  else updatePlacement(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
  callbacks.onPlacement?.(placement);
  return placement.rotation;
}

export function isSecondaryPointerEvent(event) {
  return event?.button === 2 || (event?.button === 0 && Boolean(event.ctrlKey));
}

export function initInput(canvas, minimap, worldGetter, cbs) {
  getWorld = worldGetter;
  callbacks = cbs || {};
  inputCanvas = canvas;
  const viewGesture = createViewGestureState();
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  canvas.addEventListener('mousedown', event => {
    const world = getWorld();
    if (!world || world.state === 'ended') return;
    const secondaryClick = isSecondaryPointerEvent(event);
    if (placement) {
      if (secondaryClick) {
        event.preventDefault();
        cancelPlacement();
      }
      else if (event.button === 0 && placement.type === 'wall') beginWallDrag(event.clientX, event.clientY);
      else if (event.button === 0) placeAt(event.clientX, event.clientY, event.shiftKey);
      return;
    }
    if (secondaryClick) {
      event.preventDefault();
      issueOrder(event.clientX, event.clientY);
      return;
    }
    if (event.button === 0) {
      if (keys.has(' ')) {
        panDrag = { sx: event.clientX, sy: event.clientY, camX: camera.x, camY: camera.y };
      } else {
        const point = screenToWorld(event.clientX, event.clientY);
        const rally = primaryBuildingRallyArmed
          ? setProductionBuildingPrimaryRallyAt(world, getSelection(), point.x, point.y) : null;
        if (rally) {
          primaryBuildingRallyArmed = false;
          announceBuildingRally(world, rally.buildings, point, rally);
          return;
        }
        if (gatherAt(event.clientX, event.clientY)) {
          return;
        }
        drag = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
      }
    } else if (event.button === 1) {
      event.preventDefault();
      panDrag = { sx: event.clientX, sy: event.clientY, camX: camera.x, camY: camera.y };
    }
  });

  document.addEventListener('mousedown', event => {
    if (!placement || event.button !== 0 || event.target === canvas) return;
    if (event.target.closest?.('button[data-action="build"]')) return;
    if (event.target.closest?.('#placement-tip')) return;
    cancelPlacement();
  }, true);

  window.addEventListener('mousemove', event => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    if (drag) { drag.x1 = event.clientX; drag.y1 = event.clientY; }
    if (placement) {
      if (wallDrag) updateWallDrag(event.clientX, event.clientY);
      else updatePlacement(event.clientX, event.clientY);
    }
    else updateResourceHover(event.clientX, event.clientY);
    if (panDrag) {
      const delta = screenPanToWorld(
        (event.clientX - panDrag.sx) / camera.zoom,
        (event.clientY - panDrag.sy) / camera.zoom,
      );
      camera.x = panDrag.camX - delta.x;
      camera.y = panDrag.camY - delta.y;
      clampCamera();
    }
    if (mmDown) minimapJump(event);
  });

  window.addEventListener('mouseup', event => {
    if (event.button === 0 && wallDrag) finishWallDrag(event.clientX, event.clientY);
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
    const swipe = readTrackpadViewGesture(
      viewGesture,
      event,
      event.timeStamp,
      window.innerWidth,
    );
    if (swipe.handled) {
      if (swipe.direction) callbacks.onView?.(swipe.direction);
      return;
    }
    const before = screenToWorld(event.clientX, event.clientY);
    camera.zoom = clampCameraZoom(camera.zoom * Math.exp(-event.deltaY * 0.0013));
    const after = screenToWorld(event.clientX, event.clientY);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    clampCamera();
  }, { passive: false });

  canvas.addEventListener('touchstart', event => {
    if (!getWorld() || !beginThreeFingerViewGesture(viewGesture, event.touches)) return;
    event.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', event => {
    const swipe = readThreeFingerViewGesture(viewGesture, event.touches);
    if (!swipe.handled) return;
    event.preventDefault();
    if (swipe.direction) callbacks.onView?.(swipe.direction);
  }, { passive: false });

  const finishTouchGesture = () => endThreeFingerViewGesture(viewGesture);
  canvas.addEventListener('touchend', finishTouchGesture);
  canvas.addEventListener('touchcancel', finishTouchGesture);

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
    else if (placement && (key === 'q' || key === 'e') && placementSupportsFreeRotation()) {
      event.preventDefault();
      const direction = key === 'q' ? -1 : 1;
      applyPlacementRotation(placement.rotation + direction
        * (event.shiftKey ? BUILD_ROTATE_FINE_STEP : BUILD_ROTATE_STEP));
    }
    else if (key === 'r' && placement) {
      if (isFortificationType(placement.type)) {
        placement.orientation = rotateFortificationOrientation(placement.orientation);
        if (wallDrag) updateWallDrag(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
        else updatePlacement(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
        callbacks.onPlacement?.(placement);
      } else if (placementSupportsFreeRotation()) {
        event.preventDefault();
        applyPlacementRotation(placement.rotation + BUILD_ROTATE_QUARTER_STEP);
      }
    }
    else if (key === 'l') setFormation('line');
    else if (key === 'c') setFormation('column');
    else if (key === 'b' && !getSelection().some(entity => entity.type === 'villager')) setFormation('square');
    else if (key === 'h') haltSelection();
    else if (key === 'p') callbacks.onPause?.();
    else if (key === 'q') callbacks.onView?.(-1);
    else if (key === 'e') callbacks.onView?.(1);
    else if (key === '-' || key === '_') callbacks.onZoom?.(-1);
    else if (key === '=' || key === '+') callbacks.onZoom?.(1);
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

export function setControlledSide(sideIndex = 0) {
  controlledSide = Number.isInteger(sideIndex) && sideIndex >= 0 ? sideIndex : 0;
  setSelection([]);
}

export function getControlledSide() {
  return controlledSide;
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

export function canPlayerSelectEntity(world, entity) {
  if (!world || !entity?.alive) return false;
  if (entity.side === controlledSide) return true;
  const controlledTeam = world.sides[controlledSide]?.team;
  return entity.entityKind === 'building' && controlledTeam !== undefined
    && world.sides[entity.side]?.team === controlledTeam;
}

export function findPlayerSelectableEntityAt(world, x, y) {
  const entity = findEntityAt(world, x, y);
  return canPlayerSelectEntity(world, entity) ? entity : null;
}

function setSelection(entities) {
  const world = getWorld();
  for (const entity of selection) entity.selected = false;
  selection = entities.filter(entity => canPlayerSelectEntity(world, entity));
  for (const entity of selection) entity.selected = true;
  primaryBuildingRallyArmed = selection.length === 1
    && selection[0].side === controlledSide
    && selection[0].entityKind === 'building'
    && selection[0].complete
    && Boolean(BUILDING_TYPES[selection[0].type]?.trains);
  callbacks.onSelection?.(selection);
  updateResourceHover(mouseX, mouseY);
}

export function getSelection() {
  if (selection.some(entity => !entity.alive)) selection = selection.filter(entity => entity.alive);
  return selection;
}

export function clearSelection() { setSelection([]); }

export function selectEntitiesById(world, ids = []) {
  const wanted = new Set(ids);
  const entities = [...(world?.units || []), ...(world?.buildings || [])]
    .filter(entity => wanted.has(entity.id));
  setSelection(entities);
}

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
    const entity = findPlayerSelectableEntityAt(world, point.x, point.y);
    if (entity) {
      picked = [entity];
    } else if (!additive && issuePrimaryUnitCommand(
      world, getSelection(), point.x, point.y, currentFormation,
    )) {
      callbacks.onSelection?.(getSelection());
      updateResourceHover(drag.x1, drag.y1);
      return;
    }
  } else {
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
    picked = world.units.filter(unit => unit.alive && unit.side === controlledSide
      && unit.x >= left && unit.x <= right && unit.y >= top && unit.y <= bottom);
  }
  if (additive) picked = getSelection().concat(picked.filter(entity => !entity.selected));
  setSelection(picked);
}

export function selectAll() {
  const world = getWorld();
  if (!world) return;
  setSelection(world.units.filter(unit => unit.alive && unit.side === controlledSide && unit.type !== 'villager'));
}

function issueOrder(screenX, screenY) {
  const world = getWorld();
  const selected = getSelection();
  if (!world || selected.length === 0) return;
  const point = screenToWorld(screenX, screenY);
  const units = selected.filter(entity => entity.entityKind !== 'building');
  const workers = units.filter(unit => unit.type === 'villager');
  const selectedBuildings = selected.filter(entity => entity.entityKind === 'building'
    && entity.side === controlledSide);

  const enemy = findEntityAt(world, point.x, point.y, 1);
  if (enemy && attackUnits(world, units, enemy)) return;

  const ownEntity = findEntityAt(world, point.x, point.y, controlledSide);
  if (assignVillagersToConstruction(world, workers, ownEntity)) {
    world.flags.push({ x: ownEntity.x, y: ownEntity.y, life: 1.2, max: 1.2 });
    callbacks.onOrder?.('build');
    return;
  }
  if (assignVillagersToRepair(world, workers, ownEntity)) {
    world.flags.push({
      x: ownEntity.x, y: ownEntity.y, life: 1.2, max: 1.2, repair: true,
    });
    callbacks.onOrder?.('build');
    return;
  }

  const musketeers = units.filter(unit => unit.type === 'musk');
  if (musketeers.length && ownEntity?.entityKind === 'building' && ownEntity.complete) {
    const result = assignMusketeersToWall(world, musketeers, ownEntity);
    if (result.assigned) {
      world.flags.push({ x: ownEntity.x, y: ownEntity.y, life: 1.2, max: 1.2, rally: true });
      callbacks.onToast?.(result.message, 'good');
      callbacks.onOrder?.('move');
      return;
    }
    if (ownEntity.type === 'wall' || ownEntity.type === 'gate' || ownEntity.type === 'wall_stairs') {
      callbacks.onToast?.(result.message, 'danger');
      return;
    }
  }

  const resource = findResourceAt(world, point.x, point.y);
  if (workers.length && resource && assignGatherers(world, workers, resource)) {
    world.flags.push({ x: resource.x, y: resource.y, life: 1.2, max: 1.2, gather: true });
    callbacks.onOrder?.('gather');
    return;
  }

  if (selectedBuildings.length) {
    const rally = setBuildingRallyAt(world, selectedBuildings, point.x, point.y);
    if (rally) {
      announceBuildingRally(world, selectedBuildings, point, rally);
      return;
    }
  }

  if (units.length) {
    moveUnitsTo(world, units, point.x, point.y, currentFormation);
  }
}

export function setBuildingRallyAt(world, selected, x, y) {
  const buildings = selected.filter(entity => entity?.alive && entity.entityKind === 'building');
  if (!world || buildings.length === 0) return null;
  const side = buildings[0].side;
  const resource = findResourceAt(world, x, y);
  const ownEntity = findEntityAt(world, x, y, side);
  const target = resource?.entityKind === 'resource' || resource?.side === side
    ? resource
    : ownEntity?.entityKind === 'building' ? ownEntity : null;
  let changed = false;
  for (const building of buildings) changed = setRallyPoint(building, x, y, target) || changed;
  return changed ? { target } : null;
}

export function setTownCenterPrimaryRallyAt(world, selected, x, y) {
  const buildings = selected.filter(entity => entity?.alive && entity.entityKind === 'building'
    && entity.type === 'town_center');
  if (!world || buildings.length === 0) return null;
  const side = buildings[0].side;
  const resource = findResourceAt(world, x, y);
  const ownEntity = findEntityAt(world, x, y, side);
  const target = resource || (ownEntity?.entityKind === 'building' ? ownEntity : null);
  if (!target) return null;
  const rally = setBuildingRallyAt(world, buildings, x, y);
  return rally ? { ...rally, buildings } : null;
}

export function setProductionBuildingPrimaryRallyAt(world, selected, x, y) {
  const buildings = selected.filter(entity => entity?.alive && entity.entityKind === 'building'
    && entity.complete && BUILDING_TYPES[entity.type]?.trains);
  if (!world || buildings.length !== 1) return null;
  if (buildings[0].type === 'town_center') return setTownCenterPrimaryRallyAt(world, buildings, x, y);
  const rally = setBuildingRallyAt(world, buildings, x, y);
  return rally ? { ...rally, buildings } : null;
}

function announceBuildingRally(world, selectedBuildings, point, rally) {
  const rallyTarget = rally.target;
  const targetX = rallyTarget?.x ?? point.x;
  const targetY = rallyTarget?.y ?? point.y;
  world.flags.push({ x: targetX, y: targetY, life: 1.2, max: 1.2, rally: true });
  const townCenterSelected = selectedBuildings.some(building => building.type === 'town_center');
  if (townCenterSelected) primaryBuildingRallyArmed = false;
  const targetDef = rallyTarget?.entityKind === 'building' ? BUILDING_TYPES[rallyTarget.type] : null;
  const autoWorks = townCenterSelected && rallyTarget && (
    rallyTarget.entityKind === 'resource'
    || !rallyTarget.complete
    || rallyTarget.type === 'farm'
    || targetDef?.workResources?.length
  );
  const label = rallyTarget?.entityKind === 'resource'
    ? rallyTarget.resourceType
    : targetDef?.label;
  callbacks.onToast?.(
    autoWorks
      ? `Rally set to ${label}. New villagers will work there automatically.`
      : label ? `Rally point set at ${label}.` : 'Rally point set.',
    'good',
  );
  callbacks.onOrder?.('rally');
  callbacks.onPlayerCommand?.({
    kind: 'rally',
    side: selectedBuildings[0]?.side,
    buildingIds: selectedBuildings.map(building => building.id),
    x: point.x,
    y: point.y,
  });
}

function moveUnitsTo(world, units, x, y, formation) {
  if (!units.length) return false;
  dismountWallUnits(world, units);
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
  for (const unit of units) {
    if (unit.type === 'villager') assignVillagerPath(world, unit, unit.orderX, unit.orderY);
    else clearVillagerPath(unit);
  }
  world.flags.push({
    kind: 'move', route: true,
    x, y, fromX, fromY,
    life: MOVE_FEEDBACK_LIFE, max: MOVE_FEEDBACK_LIFE,
  });
  callbacks.onOrder?.('move');
  callbacks.onPlayerCommand?.({
    kind: 'move',
    side: units[0]?.side,
    unitIds: units.map(unit => unit.id),
    x,
    y,
    formation,
  });
  return true;
}

function attackUnits(world, units, target) {
  if (!units.length || !target?.alive || !areHostileSides(world, units[0].side, target.side)) return false;
  if (isPeaceTime(world)) {
    callbacks.onToast?.(
      `The opening peace lasts ${formatPeaceTime(world)} longer. Combat orders are locked.`,
      'good',
    );
    return true;
  }
  clearWorkerJobs(units);
  const villagers = units.filter(unit => unit.type === 'villager');
  for (const villager of villagers) clearVillagerPath(villager);
  applyAttackOrder(units, target);
  world.flags.push({
    kind: 'attack', attack: true,
    x: target.x, y: target.y,
    life: 1.2, max: 1.2,
  });
  if (villagers.length) {
    const def = target.entityKind === 'building' ? BUILDING_TYPES[target.type] : UNIT_TYPES[target.type];
    const women = villagers.filter(villager => villager.unitType === 'woman_villager').length;
    const men = villagers.length - women;
    const groups = [];
    if (men) groups.push(`${men} villager${men === 1 ? '' : 's'} armed`);
    if (women) {
      groups.push(`${women} woman villager${women === 1 ? '' : 's'} wheeling out ${women === 1 ? 'a cannon' : 'cannons'}`);
    }
    callbacks.onToast?.(
      `${groups.join(' and ')} to attack ${def?.short || def?.label || 'the enemy'}.`,
      'danger',
    );
  }
  callbacks.onOrder?.('attack');
  callbacks.onPlayerCommand?.({
    kind: 'attack',
    side: units[0]?.side,
    unitIds: units.map(unit => unit.id),
    targetId: target.id,
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
  const side = selected.find(entity => entity?.alive && entity.entityKind !== 'building')?.side ?? controlledSide;
  const units = selected.filter(entity => entity.alive && entity.side === side
    && entity.entityKind !== 'building');
  if (!units.some(unit => unit.type === 'villager') || !isOpenGroundMoveTarget(world, x, y)) return false;
  return moveUnitsTo(world, units, x, y, formation);
}

export function issuePrimaryUnitCommand(world, selected, x, y, formation = 'line') {
  const side = selected.find(entity => entity?.alive && entity.entityKind !== 'building')?.side ?? controlledSide;
  const units = selected.filter(entity => entity.alive && entity.side === side
    && entity.entityKind !== 'building');
  if (!world || units.length === 0) return false;
  const enemy = findEntityAt(world, x, y);
  if (enemy && !areHostileSides(world, units[0].side, enemy.side)) return false;
  if (enemy) return attackUnits(world, units, enemy);
  if (!isOpenGroundMoveTarget(world, x, y)) return false;
  return moveUnitsTo(world, units, x, y, formation);
}

function hoverableWorkerTargetAt(screenX, screenY) {
  const world = getWorld();
  const workers = getSelection().filter(entity => entity.type === 'villager');
  if (!world || placement || workers.length === 0) return null;
  const point = screenToWorld(screenX, screenY);
  const construction = findEntityAt(world, point.x, point.y, controlledSide);
  if (construction?.entityKind === 'building' && !construction.complete) return construction;
  if (isRepairableBuilding(construction, workers[0].side)) return construction;
  const target = findResourceAt(world, point.x, point.y);
  if (target?.entityKind === 'building' && !workers.some(worker => worker.side === target.side)) return null;
  return target;
}

export function getVillagerRepairTargetAt(world, selected, x, y) {
  const workers = selected.filter(entity => entity?.alive && entity.type === 'villager');
  if (!world || workers.length === 0) return null;
  const side = workers[0].side;
  if (workers.some(worker => worker.side !== side)) return null;
  const target = findEntityAt(world, x, y, side);
  return isRepairableBuilding(target, side) ? target : null;
}

export function getVillagerAttackTargetAt(world, selected, x, y) {
  const workers = selected.filter(entity => entity?.alive && entity.type === 'villager');
  if (!world || isPeaceTime(world) || workers.length === 0) return null;
  const side = workers[0].side;
  if (workers.some(worker => worker.side !== side)) return null;
  const target = findEntityAt(world, x, y);
  return target?.alive && areHostileSides(world, side, target.side) ? target : null;
}

function hoverableVillagerAttackTargetAt(screenX, screenY) {
  if (placement) return null;
  const world = getWorld();
  const point = world ? screenToWorld(screenX, screenY) : null;
  return point ? getVillagerAttackTargetAt(world, getSelection(), point.x, point.y) : null;
}

export function issueVillagerAttack(world, selected, target) {
  const workers = selected.filter(entity => entity?.alive && entity.type === 'villager'
    && target?.alive && areHostileSides(world, entity.side, target.side));
  if (!world || isPeaceTime(world) || !target?.alive || workers.length === 0) return 0;
  clearWorkerJobs(workers);
  for (const worker of workers) clearVillagerPath(worker);
  applyAttackOrder(workers, target);
  world.flags.push({
    kind: 'attack', attack: true,
    x: target.x, y: target.y,
    life: 1.2, max: 1.2,
  });
  return workers.length;
}

function updateResourceHover(screenX, screenY) {
  const attackTarget = hoverableVillagerAttackTargetAt(screenX, screenY);
  const target = attackTarget || hoverableWorkerTargetAt(screenX, screenY);
  const repair = !attackTarget && target?.entityKind === 'building'
    && isRepairableBuilding(target, target.side);
  resourceHover = target;
  resourceHoverKind = attackTarget ? 'attack' : repair ? 'repair' : target ? 'work' : null;
  const selected = getSelection();
  const hasMobileSelection = selected.some(entity => entity.alive && entity.side === controlledSide
    && entity.entityKind !== 'building');
  const point = !target && hasMobileSelection
    ? screenToWorld(screenX, screenY) : null;
  const enemy = point ? findEntityAt(getWorld(), point.x, point.y) : null;
  const hostileEnemy = enemy && areHostileSides(getWorld(), controlledSide, enemy.side) ? enemy : null;
  movePreview = hostileEnemy
    ? { kind: 'attack', x: hostileEnemy.x, y: hostileEnemy.y, radius: hostileEnemy.radius }
    : point && isOpenGroundMoveTarget(getWorld(), point.x, point.y)
      ? { kind: 'move', x: point.x, y: point.y }
      : null;
  const construction = target?.entityKind === 'building' && !target.complete;
  const buildWork = construction || repair;
  inputCanvas?.classList.toggle('cursor-gather', Boolean(target) && !attackTarget && !buildWork);
  inputCanvas?.classList.toggle('cursor-build', Boolean(buildWork) && !attackTarget);
  inputCanvas?.classList.toggle('cursor-move', movePreview?.kind === 'move');
  inputCanvas?.classList.toggle('cursor-attack', Boolean(attackTarget)
    || movePreview?.kind === 'attack');
  callbacks.onResourceHover?.({
    target, kind: resourceHoverKind,
    workers: getSelection().filter(entity => entity.type === 'villager'),
    screenX,
    screenY,
  });
}

function clearResourceHover() {
  if (!resourceHover && !movePreview
      && !inputCanvas?.classList.contains('cursor-gather')
      && !inputCanvas?.classList.contains('cursor-build')
      && !inputCanvas?.classList.contains('cursor-move')
      && !inputCanvas?.classList.contains('cursor-attack')) return;
  resourceHover = null;
  resourceHoverKind = null;
  movePreview = null;
  inputCanvas?.classList.remove('cursor-attack');
  inputCanvas?.classList.remove('cursor-gather');
  inputCanvas?.classList.remove('cursor-build');
  inputCanvas?.classList.remove('cursor-move');
  callbacks.onResourceHover?.({ target: null, kind: null, workers: [], screenX: mouseX, screenY: mouseY });
}

function gatherAt(screenX, screenY) {
  const world = getWorld();
  const workers = getSelection().filter(entity => entity.type === 'villager');
  const target = hoverableWorkerTargetAt(screenX, screenY);
  if (!world || !target || workers.length === 0) return false;
  if (assignVillagersToConstruction(world, workers, target)) {
    world.flags.push({ x: target.x, y: target.y, life: 1.2, max: 1.2 });
    callbacks.onToast?.(`${workers.length} villager${workers.length === 1 ? '' : 's'} continuing ${BUILDING_TYPES[target.type].label}.`, 'good');
    callbacks.onOrder?.('build');
    callbacks.onPlayerCommand?.({
      kind: 'assign-builders',
      side: workers[0]?.side,
      unitIds: workers.map(worker => worker.id),
      targetId: target.id,
    });
    callbacks.onSelection?.(getSelection());
    updateResourceHover(screenX, screenY);
    return true;
  }
  if (assignVillagersToRepair(world, workers, target)) {
    world.flags.push({
      x: target.x, y: target.y, life: 1.2, max: 1.2, repair: true,
    });
    const label = BUILDING_TYPES[target.type].label;
    callbacks.onToast?.(`${workers.length} villager${workers.length === 1 ? '' : 's'} repairing ${label}.`, 'good');
    callbacks.onOrder?.('build');
    callbacks.onPlayerCommand?.({
      kind: 'repair',
      side: workers[0]?.side,
      unitIds: workers.map(worker => worker.id),
      targetId: target.id,
    });
    callbacks.onSelection?.(getSelection());
    updateResourceHover(screenX, screenY);
    return true;
  }
  if (!assignGatherers(world, workers, target)) return false;
  world.flags.push({ x: target.x, y: target.y, life: 1.2, max: 1.2, gather: true });
  const workplace = target.entityKind === 'building' && BUILDING_TYPES[target.type]?.workResources?.length;
  const resourceType = workplace
    ? workers.find(worker => worker.job?.targetId === target.id)?.job?.resourceType
    : target.resourceType;
  const label = resourceType === 'wood' ? 'timber' : resourceType;
  const action = workplace ? `working at ${BUILDING_TYPES[target.type].label}` : `gathering ${label}`;
  callbacks.onToast?.(`${workers.length} villager${workers.length === 1 ? '' : 's'} ${action}.`, 'good');
  callbacks.onOrder?.('gather');
  callbacks.onPlayerCommand?.({
    kind: 'gather',
    side: workers[0]?.side,
    unitIds: workers.map(worker => worker.id),
    targetId: target.id,
  });
  callbacks.onSelection?.(getSelection());
  updateResourceHover(screenX, screenY);
  return true;
}

export function assignVillagersToConstruction(world, workers, target) {
  const side = workers.find(worker => worker?.alive)?.side;
  return Boolean(world && target?.alive && target.entityKind === 'building' && !target.complete
    && target.side === side && assignBuilders(world, workers, target));
}

export function assignVillagersToRepair(world, workers, target) {
  const repairers = workers.filter(worker => worker?.alive && worker.type === 'villager');
  const side = repairers[0]?.side;
  return Boolean(world && side !== undefined && repairers.every(worker => worker.side === side)
    && isRepairableBuilding(target, side) && assignRepairers(world, repairers, target));
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
    rotation: isFortificationType(type) || BUILDING_TYPES[type]?.wallAttachment ? null : 0,
    millId: null,
    fieldSlot: null,
    wallId: null,
    stairSide: null,
    stairAlong: null,
  };
  updatePlacement(mouseX || window.innerWidth / 2, mouseY || window.innerHeight / 2);
  callbacks.onPlacement?.(placement);
}

export function cancelPlacement() {
  if (!placement) return;
  wallDrag = null;
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
    { orientation: placement.orientation, rotation: placement.rotation },
  )
    || { ok: true, message: '' };
  placement.x = Number.isFinite(validation.x) ? validation.x : point.x;
  placement.y = Number.isFinite(validation.y) ? validation.y : point.y;
  if (validation.orientation != null) placement.orientation = validation.orientation;
  placement.snappedToId = validation.snappedToId ?? null;
  placement.millId = validation.millId ?? null;
  placement.fieldSlot = validation.fieldSlot ?? null;
  placement.wallId = validation.wallId ?? null;
  placement.stairSide = validation.stairSide ?? null;
  placement.stairAlong = validation.stairAlong ?? null;
  placement.valid = validation.ok;
  placement.message = validation.message;
  if (Number.isFinite(validation.rotation)) placement.rotation = normalizePlacementRotation(validation.rotation);
  placement.segments = null;
}

function beginWallDrag(screenX, screenY) {
  const point = screenToWorld(screenX, screenY);
  wallDrag = {
    startX: point.x,
    startY: point.y,
    endX: point.x,
    endY: point.y,
    points: [{ x: point.x, y: point.y }],
  };
  updateWallDrag(screenX, screenY);
}

function updateWallDrag(screenX, screenY) {
  if (!placement || !wallDrag) return;
  const point = screenToWorld(screenX, screenY);
  wallDrag.endX = point.x;
  wallDrag.endY = point.y;
  const lastPoint = wallDrag.points.at(-1);
  if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= 12) {
    wallDrag.points.push({ x: point.x, y: point.y });
  } else if (wallDrag.points.length > 1) {
    wallDrag.points[wallDrag.points.length - 1] = { x: point.x, y: point.y };
  }
  const plan = callbacks.onPlanWallRun?.(
    wallDrag.startX, wallDrag.startY, point.x, point.y, placement.orientation, wallDrag.points,
  ) || { ok: false, segments: [], message: 'Wall planning is unavailable.' };
  const last = plan.segments?.at(-1);
  placement.valid = plan.ok;
  placement.message = plan.message;
  placement.segments = plan.segments || [];
  placement.requestedCount = plan.requestedCount || 0;
  placement.limitedByResources = Boolean(plan.limitedByResources);
  placement.limitedByObstacle = Boolean(plan.limitedByObstacle);
  placement.dragEndX = point.x;
  placement.dragEndY = point.y;
  if (last) {
    placement.x = last.x;
    placement.y = last.y;
    placement.orientation = last.orientation;
  }
}

function finishWallDrag(screenX, screenY) {
  if (!placement || !wallDrag) return;
  updateWallDrag(screenX, screenY);
  const dragState = wallDrag;
  wallDrag = null;
  if (!placement.valid) {
    callbacks.onToast?.(placement.message || 'Cannot build that wall run.', 'danger');
    return;
  }
  const workers = getSelection().filter(entity => entity.type === 'villager');
  const result = callbacks.onPlaceWallRun?.(
    dragState.startX, dragState.startY, dragState.endX, dragState.endY,
    workers, placement.orientation, dragState.points,
  );
  if (!result?.ok) {
    callbacks.onToast?.(result?.message || 'Wall construction failed.', 'danger');
    return;
  }
  callbacks.onToast?.(result.message, 'good');
  callbacks.onPlayerCommand?.({
    kind: 'place-wall-run',
    side: workers[0]?.side ?? controlledSide,
    workerIds: workers.map(worker => worker.id),
    startX: dragState.startX,
    startY: dragState.startY,
    endX: dragState.endX,
    endY: dragState.endY,
    orientation: placement.orientation,
    pathPoints: dragState.points,
  });
  cancelPlacement();
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
    {
      orientation: placement.orientation,
      rotation: placement.rotation,
      millId: placement.millId,
      fieldSlot: placement.fieldSlot,
      wallId: placement.wallId,
      stairSide: placement.stairSide,
      stairAlong: placement.stairAlong,
    },
  );
  if (!result?.ok) {
    callbacks.onToast?.(result?.message || 'Construction failed.', 'danger');
    return;
  }
  callbacks.onToast?.(result.message, 'good');
  callbacks.onPlayerCommand?.({
    kind: 'place-building',
    side: workers[0]?.side ?? controlledSide,
    workerIds: workers.map(worker => worker.id),
    type: placement.type,
    x: placement.x,
    y: placement.y,
    options: {
      orientation: placement.orientation,
      rotation: placement.rotation,
      millId: placement.millId,
      fieldSlot: placement.fieldSlot,
      wallId: placement.wallId,
      stairSide: placement.stairSide,
      stairAlong: placement.stairAlong,
    },
  });
  if (!keepPlacing) cancelPlacement();
}

export function rotatePlacement(deltaRadians) {
  if (!placementSupportsFreeRotation()) return null;
  return applyPlacementRotation((placement.rotation || 0) + deltaRadians);
}

export function rotatePlacementDegrees(deltaDegrees) {
  return rotatePlacement((Number(deltaDegrees) || 0) * Math.PI / 180);
}

export function setPlacementRotationDegrees(degrees) {
  if (!placementSupportsFreeRotation()) return null;
  return applyPlacementRotation((Number(degrees) || 0) * Math.PI / 180);
}

export function resetPlacementRotation() {
  return setPlacementRotationDegrees(0);
}

export function getPlacementPreview() { return placement; }
export function getResourceHoverTarget() { return resourceHover; }
export function getResourceHoverKind() { return resourceHoverKind; }
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
  wallDrag = null;
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
    const delta = screenPanToWorld(vx / length, vy / length);
    camera.x += delta.x * PAN_SPEED / camera.zoom * dt;
    camera.y += delta.y * PAN_SPEED / camera.zoom * dt;
    clampCamera();
  }
}
