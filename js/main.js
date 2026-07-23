// Entry point: wires up modules and runs the fixed-timestep game loop.

import { SIM_STEP, BUILDING_TYPES } from './config.js';
import { createWorld, damage, spawnUnit, step } from './sim.js';
import { Commander } from './ai.js';
import { initRender, startBattle as startBattleRender, draw,
         camera, clampCamera, rotateView, zoomView } from './render.js';
import { viewDirectionLabel } from './camera.js';
import { initInput, updateInput, getSelection, getDragRect,
         getPlacementPreview, getResourceHoverTarget, getResourceHoverKind, getMovePreview,
         beginPlacement, rotatePlacementDegrees, setPlacementRotationDegrees, setFormation,
         cancelPlacement, haltSelection, resetForBattle, selectEntitiesById,
         setControlledSide } from './input.js';
import {
  assignBuilders, assignGatherers, assignRepairers, createBuilding, executeMarketTrade, findEntityAt,
  findResourceAt, placeBuilding, placeWallRun, planWallRun, queueUnit, setRallyPoint,
  validatePlacement,
} from './economy.js';
import * as ui from './ui.js';
import { sfx } from './audio.js';
import { preloadProductionArt } from './gfx/art-assets.js';
import { bindPageLifecycle } from './lifecycle.js';
import {
  deleteCampaign, getCampaignSummary, loadCampaign, restoreGameSnapshot, saveCampaign,
} from './savegame.js';
import { toggleGate } from './fortifications.js';
import { applyAttackOrder, applyMoveOrder } from './formations.js';
import { OPENING_PEACE_SECONDS } from './truce.js';
import {
  createMultiplayerSession, createMultiplayerSnapshot, encodeMultiplayerSnapshot,
  makeInviteUrl, readInviteFromLocation, restoreMultiplayerSnapshot,
} from './multiplayer.js';

let world = null;
let commanders = [];
let endShown = false;
let localSide = 0;
let suppressNetworkCommand = false;
let lastSnapshotSentAt = 0;

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const productionArtReady = preloadProductionArt();
const multiplayer = createMultiplayerSession({
  onStatus: status => ui.setMultiplayerStatus(status),
  onOpen: () => {
    if (multiplayer.mode === 'host' && world) sendMultiplayerSnapshot(true);
  },
  onMessage: handleMultiplayerMessage,
});

initRender(canvas, minimap);
initInput(canvas, minimap, () => world, {
  onPause: togglePause,
  onView: turnBattleView,
  onZoom: changeBattleZoom,
  onFormation: formation => {
    ui.markFormation(formation);
    sfx.command('move');
  },
  onSelection: () => {
    sfx.command('select');
    if (world) ui.updateHud(world, getSelection());
  },
  onOrder: kind => sfx.command(kind),
  onValidatePlacement: (type, x, y, options) => validatePlacement(world, localSide, type, x, y, options),
  onPlanWallRun: (startX, startY, endX, endY, orientation, pathPoints) => (
    planWallRun(world, localSide, startX, startY, endX, endY, orientation, pathPoints)
  ),
  onPlaceWallRun: (startX, startY, endX, endY, workers, orientation, pathPoints) => {
    const result = placeWallRun(
      world, localSide, startX, startY, endX, endY, workers, orientation, pathPoints,
    );
    if (result.ok) sfx.buildingPlaced(result.building.x);
    return result;
  },
  onPlaceBuilding: (type, x, y, workers, options) => {
    const result = placeBuilding(world, localSide, type, x, y, workers, options);
    if (result.ok) sfx.buildingPlaced(result.building.x);
    return result;
  },
  onPlacement: placement => ui.setPlacement(
    Boolean(placement),
    placement ? BUILDING_TYPES[placement.type].label : '',
    placement?.type || '',
    placement?.orientation || '',
    placement?.rotation ?? null,
  ),
  onResourceHover: hover => ui.setResourceHover(world, hover),
  onToast: ui.toast,
  onPlayerCommand: sendPlayerCommand,
});

ui.initMenu({
  onStart: startBattle,
  onLoad: resumeSavedCampaign,
  onDelete: discardSavedCampaign,
  onMultiplayerHost: createMultiplayerInvite,
  onMultiplayerJoin: joinMultiplayerInvite,
  onMultiplayerAnswer: applyMultiplayerAnswer,
});
ui.bindControls({
  onPause: togglePause,
  onView: turnBattleView,
  onZoom: changeBattleZoom,
  onSpeed: toggleSpeed,
  onHalt: () => {
    haltSelection();
    sfx.command('move');
  },
  onFormation: setFormation,
  onCommand: handleCommand,
  onCancelPlacement: cancelPlacement,
  onRotatePlacement: rotatePlacementDegrees,
  onSetPlacementRotation: setPlacementRotationDegrees,
  onSave: saveCurrentCampaign,
  onAudio: settings => {
    sfx.setSettings(settings);
    ui.setAudioControls(sfx.getSettings());
  },
  onMute: () => {
    const settings = sfx.getSettings();
    sfx.setSettings({ muted: !settings.muted });
    ui.setAudioControls(sfx.getSettings());
  },
  onAgain: () => {
    sfx.stopBattle();
    world = null;
    commanders = [];
    resetForBattle();
    ui.showStartMenu();
    refreshSavedCampaign();
  },
});
refreshSavedCampaign();

function saveActiveCampaignForPageExit() {
  if (!world || !commanders.length) return false;
  try {
    saveCampaign(world, commanders, camera);
    return true;
  } catch (error) {
    console.error('The active campaign could not be auto-saved before page exit.', error);
    return false;
  }
}

function exitActiveCampaignForPageExit() {
  void sfx.shutdown();
  world = null;
  commanders = [];
  resetForBattle();
  ui.showStartMenu();
  refreshSavedCampaign();
}

bindPageLifecycle({
  onSave: saveActiveCampaignForPageExit,
  onPageActivity: active => { void sfx.setPageActive(active); },
  onExit: exitActiveCampaignForPageExit,
});

const invite = readInviteFromLocation(window.location);
if (invite.joinRequested && invite.offer) {
  ui.setMultiplayerOffer(invite.offer);
  ui.setMultiplayerStatus('Invite loaded');
}

function setLocalPlayerSide(sideIndex = 0) {
  localSide = Number.isInteger(sideIndex) && sideIndex >= 0 ? sideIndex : 0;
  setControlledSide(localSide);
  ui.setLocalSide(localSide);
}

async function createMultiplayerInvite(role) {
  try {
    const offer = await multiplayer.createHostOffer(role);
    ui.setMultiplayerOffer(makeInviteUrl(window.location.href, offer));
    ui.setMultiplayerAnswer('');
    ui.toast(`Invite ready. Guest will join as your ${role === 'enemy' ? 'enemy' : 'ally'}.`, 'good');
  } catch (error) {
    ui.setMultiplayerStatus('Invite failed');
    ui.toast(error?.message || 'Multiplayer invite failed.', 'danger');
  }
}

async function joinMultiplayerInvite(rawOffer) {
  try {
    const parsedInvite = (() => {
      try { return readInviteFromLocation(new URL(rawOffer)); }
      catch (_error) { return { offer: rawOffer }; }
    })();
    const answer = await multiplayer.joinFromOffer(parsedInvite.offer || rawOffer);
    setLocalPlayerSide(multiplayer.remoteSide);
    ui.setMultiplayerAnswer(answer);
    ui.toast('Answer ready. Send it back to the host, then wait for the battle.', 'good');
  } catch (error) {
    ui.setMultiplayerStatus('Join failed');
    ui.toast(error?.message || 'Multiplayer join failed.', 'danger');
  }
}

async function applyMultiplayerAnswer(answer) {
  try {
    await multiplayer.acceptGuestAnswer(answer);
    ui.toast('Answer accepted. The guest can connect now.', 'good');
  } catch (error) {
    ui.setMultiplayerStatus('Answer failed');
    ui.toast(error?.message || 'The answer code could not be used.', 'danger');
  }
}

async function startBattle(opts) {
  sfx.ensure();
  await productionArtReady;
  world = createWorld(opts);
  setLocalPlayerSide(0);
  if (multiplayer.mode === 'host') {
    const remoteSide = multiplayer.remoteSide;
    if (world.sides[remoteSide]) {
      world.sides[remoteSide].controller = 'remote-human';
      world.sides[remoteSide].label = multiplayer.role === 'enemy'
        ? 'Guest rival' : 'Guest ally';
    }
  }
  commanders = world.sides
    .map((_side, sideIndex) => sideIndex)
    .filter(sideIndex => sideIndex !== 0 && world.sides[sideIndex]?.controller === 'ai')
    .map(sideIndex => new Commander(world, sideIndex, world.difficulty));
  resetForBattle();
  startBattleRender(world);
  setupLocalBuildingFirePreview(world);
  setupLocalAutoEngagePreview(world);
  setupLocalCurvedWallPreview(world);
  setupLocalTowerCombatPreview(world);
  setupLocalCastlePreview(world);
  setupLocalOttomanArchitecturePreview(world);
  setupLocalFormationMovementPreview(world);
  setupLocalVillagerCarryPreview(world);
  setupLocalWomanVillagerPreview(world);
  setupLocalOpeningTrucePreview(world);
  setupLocalFantasyFactionPreview(world);
  setupLocalEnglandHousePreview(world);
  setupLocalThemedArchitecturePreview(world);
  setupLocalSettlementVarietyPreview(world);
  setupLocalResourceLandscapePreview(world);
  setupLocalVictoryRainbowPreview(world);
  ui.showBattleHud(world);
  ui.setPauseLabel(false);
  ui.setSpeedLabel(1);
  ui.setViewDirection(viewDirectionLabel(camera.rotation));
  ui.markFormation('line');
  sfx.startBattle(world);
  endShown = false;
  acc = 0;
  resetFrameMetrics();
  sendMultiplayerSnapshot(true);
}

function setupLocalFantasyFactionPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'fantasy-factions') return;

  const previewBounds = { left: 1950, right: 3250, top: 850, bottom: 2350 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));
  activeWorld.buildings = activeWorld.buildings.filter(building => (
    building.x < previewBounds.left || building.x > previewBounds.right
    || building.y < previewBounds.top || building.y > previewBounds.bottom
  ));
  activeWorld.time = OPENING_PEACE_SECONDS;

  const hogwartsTypes = ['wizard_duelist', 'witch_duelist', 'moaning_myrtle'];
  const starwarsTypes = [
    'starwars_sentinel', 'starwars_blade_guard', 'starwars_skiff_rider', 'starwars_pulse_cannon',
  ];
  const circusTypes = [
    'pennywise', 'art_clown', 'twisty_clown', 'captain_spaulding', 'killer_klown',
  ];
  const hogwartsUnits = hogwartsTypes.map((type, index) => (
    spawnUnit(activeWorld, 2, type, 2250, 1260 + index * 145)
  ));
  const starwarsUnits = starwarsTypes.map((type, index) => (
    spawnUnit(activeWorld, 4, type, 2385, 1110 + index * 125)
  ));
  const circusUnits = circusTypes.map((type, index) => (
    spawnUnit(activeWorld, 3, type, 2710, 1130 + index * 140)
  ));

  for (const unit of [...hogwartsUnits, ...starwarsUnits, ...circusUnits]) {
    unit.maxHp = Math.max(unit.maxHp, 420);
    unit.hp = unit.maxHp;
    unit.reload = 0;
    if (unit.range > 0) unit.reloadTime = Math.min(unit.reloadTime, 1.15);
    unit.acquireT = 0;
  }
  hogwartsUnits.forEach((unit, index) => {
    applyAttackOrder([unit], circusUnits[index % circusUnits.length]);
  });
  starwarsUnits.forEach((unit, index) => {
    applyAttackOrder([unit], circusUnits[(index + 1) % circusUnits.length]);
  });
  circusUnits.forEach((unit, index) => {
    const allied = index % 2 ? starwarsUnits : hogwartsUnits;
    applyAttackOrder([unit], allied[index % allied.length]);
  });

  camera.x = 2540;
  camera.y = 1450;
  camera.zoom = 0.72;
  clampCamera();
}

function livingUnitsById(unitIds, side) {
  const wanted = new Set(unitIds || []);
  return world?.units.filter(unit => unit.alive && unit.side === side && wanted.has(unit.id)) || [];
}

function buildingsById(buildingIds, side) {
  const wanted = new Set(buildingIds || []);
  return world?.buildings.filter(building => building.alive && building.side === side && wanted.has(building.id)) || [];
}

function entityById(id) {
  return [...(world?.units || []), ...(world?.buildings || []), ...(world?.resources || [])]
    .find(entity => entity.id === id && entity.alive);
}

function applyRemoteCommand(command) {
  if (!world || !command || !Number.isInteger(command.side)) return false;
  if (world.sides[command.side]?.controller !== 'remote-human') return false;
  suppressNetworkCommand = true;
  try {
    if (command.kind === 'move') {
      const units = livingUnitsById(command.unitIds, command.side);
      if (!units.length) return false;
      applyMoveOrder(units, command.x, command.y, command.formation || 'line');
      world.flags.push({ kind: 'move', route: true, x: command.x, y: command.y, life: 2.8, max: 2.8 });
      return true;
    }
    if (command.kind === 'attack') {
      const units = livingUnitsById(command.unitIds, command.side);
      const target = entityById(command.targetId);
      if (!units.length || !target?.alive) return false;
      applyAttackOrder(units, target);
      world.flags.push({ kind: 'attack', attack: true, x: target.x, y: target.y, life: 1.2, max: 1.2 });
      return true;
    }
    if (command.kind === 'gather') {
      const workers = livingUnitsById(command.unitIds, command.side).filter(unit => unit.type === 'villager');
      const target = entityById(command.targetId);
      return assignGatherers(world, workers, target);
    }
    if (command.kind === 'assign-builders') {
      const workers = livingUnitsById(command.unitIds, command.side).filter(unit => unit.type === 'villager');
      const target = entityById(command.targetId);
      return assignBuilders(world, workers, target);
    }
    if (command.kind === 'repair') {
      const workers = livingUnitsById(command.unitIds, command.side).filter(unit => unit.type === 'villager');
      const target = entityById(command.targetId);
      return assignRepairers(world, workers, target);
    }
    if (command.kind === 'rally') {
      const buildings = buildingsById(command.buildingIds, command.side);
      if (!buildings.length) return false;
      const resource = findResourceAt(world, command.x, command.y);
      const ownEntity = findEntityAt(world, command.x, command.y, command.side);
      const target = resource || (ownEntity?.entityKind === 'building' ? ownEntity : null);
      let changed = false;
      for (const building of buildings) changed = setRallyPoint(building, command.x, command.y, target) || changed;
      return changed;
    }
    if (command.kind === 'place-building') {
      const workers = livingUnitsById(command.workerIds, command.side).filter(unit => unit.type === 'villager');
      return placeBuilding(
        world, command.side, command.type, command.x, command.y, workers, command.options || {},
      ).ok;
    }
    if (command.kind === 'place-wall-run') {
      const workers = livingUnitsById(command.workerIds, command.side).filter(unit => unit.type === 'villager');
      return placeWallRun(
        world, command.side, command.startX, command.startY, command.endX, command.endY,
        workers, command.orientation, command.pathPoints || [],
      ).ok;
    }
    if (command.kind === 'train') {
      const building = buildingsById([command.buildingId], command.side)[0];
      return queueUnit(world, building, command.type, command.count).ok;
    }
    if (command.kind === 'gate') {
      const gate = buildingsById([command.buildingId], command.side)[0];
      return toggleGate(world, gate).ok;
    }
    if (command.kind === 'trade') {
      const market = buildingsById([command.buildingId], command.side)[0];
      return executeMarketTrade(
        world, command.side, market, command.fromResource, command.toResource, command.amount,
      ).ok;
    }
  } finally {
    suppressNetworkCommand = false;
  }
  return false;
}

function sendPlayerCommand(command) {
  if (suppressNetworkCommand || multiplayer.mode !== 'guest' || !multiplayer.connected) return;
  if (command?.side !== localSide) return;
  multiplayer.send({ type: 'command', command });
}

function sendMultiplayerSnapshot(force = false) {
  if (multiplayer.mode !== 'host' || !multiplayer.connected || !world || !commanders.length) return;
  const now = performance.now();
  if (!force && now - lastSnapshotSentAt < 350) return;
  lastSnapshotSentAt = now;
  const snapshot = createMultiplayerSnapshot(world, commanders, camera);
  multiplayer.send({ type: 'snapshot', snapshot: encodeMultiplayerSnapshot(snapshot) });
}

async function installGuestSnapshot(serialized) {
  await productionArtReady;
  const selectedIds = getSelection().map(entity => entity.id);
  const firstSnapshot = !world;
  const restored = restoreMultiplayerSnapshot(serialized);
  world = restored.world;
  commanders = [];
  setLocalPlayerSide(multiplayer.remoteSide);
  if (firstSnapshot) {
    resetForBattle();
    startBattleRender(world);
  }
  else {
    selectEntitiesById(world, selectedIds);
  }
  camera.x = restored.camera?.x ?? camera.x;
  camera.y = restored.camera?.y ?? camera.y;
  camera.zoom = restored.camera?.zoom ?? camera.zoom;
  camera.rotation = restored.camera?.rotation ?? camera.rotation;
  clampCamera();
  world.state = 'running';
  ui.showBattleHud(world);
  ui.setPauseLabel(false);
  ui.setSpeedLabel(world.speed);
  ui.setViewDirection(viewDirectionLabel(camera.rotation));
  ui.markFormation('line');
  endShown = false;
  acc = 0;
  resetFrameMetrics();
}

function handleMultiplayerMessage(message) {
  if (message?.protocol !== 1) return;
  if (multiplayer.mode === 'host' && message.type === 'command') {
    if (applyRemoteCommand(message.command)) sendMultiplayerSnapshot(true);
    return;
  }
  if (multiplayer.mode === 'guest' && message.type === 'snapshot') {
    void installGuestSnapshot(message.snapshot);
  }
}

function setupLocalOpeningTrucePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'opening-truce') return;

  activeWorld.units.length = 0;
  activeWorld.sides[0].alive = 0;
  activeWorld.sides[1].alive = 0;
  activeWorld.time = OPENING_PEACE_SECONDS - 6;
  const player = spawnUnit(activeWorld, 0, 'musk', 2420, 1500);
  const enemy = spawnUnit(activeWorld, 1, 'musk', 2570, 1500);
  for (const unit of [player, enemy]) {
    unit.speed = 0;
    unit.reload = 0;
    unit.acquireT = 0;
  }
  camera.x = 2495;
  camera.y = 1500;
  camera.zoom = 1.2;
  clampCamera();
}

function setupLocalVictoryRainbowPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'victory-rainbow') return;
  const playerTeam = activeWorld.sides[0]?.team;
  const rivalTownCenters = activeWorld.buildings.filter(building => (
    building.alive
      && building.type === 'town_center'
      && activeWorld.sides[building.side]?.team !== playerTeam
  ));
  for (const townCenter of rivalTownCenters) {
    damage(activeWorld, townCenter, townCenter.maxHp + 1, null);
  }
  activeWorld.checkT = 0;
  step(activeWorld, SIM_STEP);
  camera.x = 2600;
  camera.y = 1600;
  camera.zoom = 0.56;
  clampCamera();
}

function setupLocalSettlementVarietyPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'settlement-variety') return;

  activeWorld.sides[0].nation = 'england';
  activeWorld.sides[1].nation = 'ottoman';
  const previewBounds = { left: 1350, right: 3900, top: 780, bottom: 2760 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));
  activeWorld.buildings = activeWorld.buildings.filter(building => (
    building.x < previewBounds.left || building.x > previewBounds.right
    || building.y < previewBounds.top || building.y > previewBounds.bottom
  ));

  const englishHomes = ['house', 'english_cottage', 'english_townhouse', 'english_mansion', 'spooky_house'];
  englishHomes.forEach((type, index) => {
    const house = createBuilding(0, type, 1540 + index * 320, 1210 + (index % 2) * 110, true);
    house.id = 210000 + index;
    activeWorld.buildings.push(house);
  });
  for (let index = 0; index < 5; index++) {
    const house = createBuilding(1, 'house', 1540 + index * 320, 1910 + (index % 2) * 110, true);
    house.id = 210100 + index;
    activeWorld.buildings.push(house);
  }

  const deposits = [
    ['wood', 2950, 1040, 19000, 86],
    ['wood', 3340, 1310, 16000, 72],
    ['wood', 3020, 2160, 19000, 86],
    ['wood', 3420, 2420, 16000, 72],
    ['food', 2700, 1160, 6000, 50],
    ['food', 3560, 1110, 4800, 46],
    ['food', 2720, 1960, 6000, 50],
    ['food', 3570, 2190, 4800, 46],
  ];
  deposits.forEach(([type, x, y, amount, radius], index) => {
    activeWorld.resources.push({
      id: 220000 + index,
      entityKind: 'resource',
      type,
      resourceType: type,
      x,
      y,
      amount,
      maxAmount: amount,
      radius,
      alive: true,
      seed: 1200 + index * 37.7,
    });
  });

  camera.x = 2600;
  camera.y = 1690;
  camera.zoom = 0.72;
  clampCamera();
}

function setupLocalResourceLandscapePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'resource-landscape') return;

  const previewBounds = { left: 1250, right: 3950, top: 760, bottom: 2520 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));
  activeWorld.buildings = activeWorld.buildings.filter(building => (
    building.x < previewBounds.left || building.x > previewBounds.right
    || building.y < previewBounds.top || building.y > previewBounds.bottom
  ));

  const deposits = [
    ['wood', 'oak_copse', 2000, 1600, 22000, 88, 1],
    ['wood', 'birch_grove', 2600, 1600, 22000, 88, 1],
    ['wood', 'pine_stand', 3200, 1600, 22000, 88, 1],
    ['food', 'berry_garden', 2300, 2070, 7200, 58, 1],
    ['food', 'apple_orchard', 2900, 2070, 7200, 58, 1],
    ['wood', 'oak_copse', 3500, 2070, 22000, 72, 0.24],
  ];
  deposits.forEach(([type, visualVariant, x, y, maxAmount, radius, fraction], index) => {
    activeWorld.resources.push({
      id: 225000 + index,
      entityKind: 'resource',
      type,
      resourceType: type,
      visualVariant,
      x,
      y,
      amount: maxAmount * fraction,
      maxAmount,
      radius,
      alive: true,
      seed: 1700 + index * 101.7,
    });
  });

  camera.x = 2600;
  camera.y = new URLSearchParams(window.location.search).get('focus') === 'food' ? 2070 : 1600;
  camera.zoom = 0.72;
  clampCamera();
}

function setupLocalEnglandHousePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'england-houses') return;

  activeWorld.sides[0].nation = 'england';
  const previewBounds = { left: 1120, right: 4040, top: 760, bottom: 2290 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));
  activeWorld.buildings = activeWorld.buildings.filter(building => (
    building.x < previewBounds.left || building.x > previewBounds.right
    || building.y < previewBounds.top || building.y > previewBounds.bottom
  ));

  const houses = [
    ['house', 1420, 1270],
    ['english_cottage', 1920, 1280],
    ['english_townhouse', 2440, 1270],
    ['english_mansion', 3020, 1300],
    ['spooky_house', 3600, 1300],
  ];
  for (const [type, x, y] of houses) {
    activeWorld.buildings.push(createBuilding(0, type, x, y, true));
  }

  const worker = spawnUnit(activeWorld, 0, 'villager', 2520, 1570);
  worker.selected = true;
  camera.x = 2520;
  camera.y = 1390;
  camera.zoom = 0.94;
  clampCamera();
}

function setupLocalThemedArchitecturePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'themed-architecture') return;

  const hogwartsSide = activeWorld.sides.findIndex(side => side.nation === 'hogwarts');
  const starwarsSide = activeWorld.sides.findIndex(side => side.nation === 'starwars');
  if (hogwartsSide < 0 || starwarsSide < 0) return;

  activeWorld.time = OPENING_PEACE_SECONDS;
  const previewBounds = { left: 1110, right: 4140, top: 720, bottom: 2560 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));
  activeWorld.buildings = activeWorld.buildings.filter(building => (
    building.x < previewBounds.left || building.x > previewBounds.right
    || building.y < previewBounds.top || building.y > previewBounds.bottom
  ));

  const hogwartsBuildings = [
    ['town_center', 1350, 1050], ['house', 1710, 1050], ['mill', 2040, 1050],
    ['lumber_camp', 2365, 1050], ['mine', 2690, 1050], ['barracks', 3040, 1050],
    ['stable', 3400, 1050], ['foundry', 3740, 1050],
    ['tower', 1450, 1470], ['castle', 1900, 1490], ['school', 2460, 1490],
    ['pool', 3020, 1490], ['beach', 3560, 1490],
  ];
  for (const [type, x, y] of hogwartsBuildings) {
    activeWorld.buildings.push(createBuilding(hogwartsSide, type, x, y, true));
  }

  const starwarsBuildings = [
    ['town_center', 1340, 2060], ['house', 1685, 2060], ['mill', 2025, 2060],
    ['lumber_camp', 2365, 2060], ['mine', 2705, 2060], ['barracks', 3060, 2060],
    ['stable', 3425, 2060], ['foundry', 3785, 2060],
    ['tower', 1760, 2390], ['castle', 2520, 2410],
  ];
  for (const [type, x, y] of starwarsBuildings) {
    activeWorld.buildings.push(createBuilding(starwarsSide, type, x, y, true));
  }

  camera.x = 2540;
  camera.y = 1840;
  camera.zoom = 0.50;
  clampCamera();
}

function setupLocalBuildingFirePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || !['building-fire', 'building-repair'].includes(debugName)) return;

  if (debugName === 'building-repair') {
    const repairTarget = createBuilding(0, 'stable', 1120, 1500, true);
    repairTarget.hp = repairTarget.maxHp * 0.24;
    repairTarget.ignited = true;
    repairTarget.fireImpactCount = 4;
    repairTarget.fireSeed = 7341;
    activeWorld.buildings.push(repairTarget);
    activeWorld.resources = activeWorld.resources.filter(resource => (
      Math.hypot(resource.x - repairTarget.x, resource.y - repairTarget.y)
        > repairTarget.radius + resource.radius + 34
    ));
    spawnUnit(activeWorld, 0, 'villager', repairTarget.x - repairTarget.radius - 32, repairTarget.y);
    camera.x = repairTarget.x;
    camera.y = repairTarget.y;
    camera.zoom = 1.65;
    clampCamera();
    return;
  }

  const target = createBuilding(1, 'stable', 1120, 1500, true);
  target.maxHp = 170;
  target.hp = 170;
  activeWorld.buildings.push(target);
  activeWorld.resources = activeWorld.resources.filter(resource => (
    Math.hypot(resource.x - target.x, resource.y - target.y) > target.radius + resource.radius + 34
  ));
  const attackers = [
    spawnUnit(activeWorld, 0, 'musk', 980, 1458),
    spawnUnit(activeWorld, 0, 'pike', 1054, 1510),
    spawnUnit(activeWorld, 0, 'cav', 1048, 1555),
  ];
  for (const attacker of attackers) {
    attacker.reload = 0;
    attacker.meleeCd = 0;
    attacker.target = target;
    attacker.orderTarget = target;
  }
  camera.x = target.x;
  camera.y = target.y;
  camera.zoom = 1.65;
  clampCamera();
}

function setupLocalAutoEngagePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'auto-engage') return;

  const lanes = [
    { type: 'musk', y: 1380, distance: 240 },
    { type: 'pike', y: 1460, distance: 150 },
    { type: 'cav', y: 1540, distance: 250 },
    { type: 'gun', y: 1650, distance: 700 },
  ];
  for (const lane of lanes) {
    const attacker = spawnUnit(activeWorld, 0, lane.type, 2400, lane.y);
    const defender = spawnUnit(activeWorld, 1, 'musk', 2400 + lane.distance, lane.y);
    defender.acquire = 0;
    defender.reload = 999;
    defender.speed = 0;
    attacker.acquireT = 0;
    attacker.reload = 0;
    applyMoveOrder([attacker], 2000, lane.y, 'line');
  }
  camera.x = 2750;
  camera.y = 1515;
  camera.zoom = 1.15;
  clampCamera();
}

function setupLocalCurvedWallPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || !['curved-wall', 'wall-construction'].includes(debugName)) return;

  const wallWidth = BUILDING_TYPES.wall.w;
  const angles = [-0.52, -0.36, -0.20, -0.04, 0.12, 0.28, 0.44];
  const constructionProgress = [0.02, 0.10, 0.22, 0.40, 0.58, 0.76, 0.92];
  const underConstruction = debugName === 'wall-construction';
  let endpoint = { x: 910, y: 1500 };
  const walls = [];
  for (let index = 0; index < angles.length; index++) {
    const angle = angles[index];
    const axis = { x: Math.cos(angle), y: Math.sin(angle) };
    const wall = createBuilding(
      0,
      'wall',
      endpoint.x + axis.x * wallWidth * 0.5,
      endpoint.y + axis.y * wallWidth * 0.5,
      !underConstruction,
      { orientation: angle },
    );
    if (underConstruction) {
      wall.progress = constructionProgress[index];
      wall.hp = Math.max(1, wall.maxHp * wall.progress);
    }
    walls.push(wall);
    endpoint = {
      x: endpoint.x + axis.x * wallWidth,
      y: endpoint.y + axis.y * wallWidth,
    };
  }
  activeWorld.buildings.push(...walls);
  activeWorld.resources = activeWorld.resources.filter(resource => walls.every(wall => (
    Math.hypot(resource.x - wall.x, resource.y - wall.y)
      > resource.radius + wall.radius + 50
  )));
  camera.x = (walls[0].x + walls.at(-1).x) * 0.5;
  camera.y = (walls[0].y + walls.at(-1).y) * 0.5;
  camera.zoom = 1.45;
  clampCamera();
}

function setupLocalCastlePreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'castle') return;

  const castle = createBuilding(0, 'castle', 1220, 1500, true);
  castle.selected = true;
  castle.reload = 0;
  activeWorld.buildings.push(castle);
  activeWorld.resources = activeWorld.resources.filter(resource => (
    Math.hypot(resource.x - castle.x, resource.y - castle.y)
      > castle.radius + resource.radius + 60
  ));

  const defenders = [
    ['gun', 1645, 1405], ['pike', 1680, 1460], ['musk', 1700, 1515],
    ['cav', 1650, 1570], ['gun', 1720, 1620], ['pike', 1590, 1660],
  ];
  for (const [type, x, y] of defenders) {
    const unit = spawnUnit(activeWorld, 1, type, x, y);
    unit.acquire = 0;
    unit.speed = 0;
    unit.reload = 999;
  }

  camera.x = castle.x + 150;
  camera.y = castle.y;
  camera.zoom = 1.45;
  clampCamera();
}

function setupLocalOttomanArchitecturePreview(activeWorld) {
  const debugParams = new URLSearchParams(window.location.search);
  const debugName = debugParams.get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || !['ottoman-architecture', 'ottoman-construction'].includes(debugName)) return;

  // Keep this gallery deterministic even if the menu's last nation selection
  // was England. It is localhost-only and never changes a normal campaign.
  activeWorld.sides[0].nation = 'ottoman';
  const previewBounds = { left: 1650, right: 3550, top: 800, bottom: 2550 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));

  if (debugName === 'ottoman-construction') {
    const stages = [
      ['house', 1940, 1430, 0.12],
      ['barracks', 2360, 1430, 0.38],
      ['town_center', 2780, 1430, 0.66],
      ['foundry', 3200, 1430, 0.90],
    ];
    for (const [type, x, y, progress] of stages) {
      const building = createBuilding(0, type, x, y, false);
      building.progress = progress;
      building.hp = Math.max(1, building.maxHp * progress);
      activeWorld.buildings.push(building);
    }

    const fortificationStages = [
      ['wall', 2200, 2000, 0.28, 'horizontal', true],
      ['wall', 2480, 2000, 0.72, 'diagonal', true],
      ['gate', 2830, 2000, 0.34, 'horizontal', false],
      ['gate', 3220, 2000, 0.78, 'diagonal', false],
    ];
    for (const [type, x, y, progress, orientation, gateOpen] of fortificationStages) {
      const building = createBuilding(0, type, x, y, false, { orientation, gateOpen });
      building.progress = progress;
      building.hp = Math.max(1, building.maxHp * progress);
      activeWorld.buildings.push(building);
    }

    camera.x = 2580;
    camera.y = debugParams.get('focus') === 'fortifications' ? 2000 : 1430;
    camera.zoom = debugParams.has('focus') ? 1.08 : 0.92;
    clampCamera();
    return;
  }

  const buildings = [
    ['house', 1860, 1180],
    ['mill', 2200, 1150],
    ['lumber_camp', 2550, 1140],
    ['mine', 2910, 1170],
    ['tower', 3300, 1200],
    ['barracks', 1900, 1690],
    ['town_center', 2390, 1660],
    ['stable', 2860, 1690],
    ['foundry', 3290, 1690],
  ];
  for (const [type, x, y] of buildings) {
    activeWorld.buildings.push(createBuilding(0, type, x, y, true));
  }

  const fortifications = [
    ['wall', 1900, 2210, 'horizontal', true],
    ['wall', 2250, 2210, 'diagonal', true],
    ['gate', 2630, 2210, 'horizontal', true],
    ['gate', 3030, 2210, 'diagonal', false],
  ];
  for (const [type, x, y, orientation, gateOpen] of fortifications) {
    activeWorld.buildings.push(
      createBuilding(0, type, x, y, true, { orientation, gateOpen }),
    );
  }

  camera.x = 2570;
  camera.y = debugParams.get('focus') === 'upper' ? 1160
    : debugParams.get('focus') === 'fortifications' ? 2200 : 1620;
  camera.zoom = debugParams.has('focus') ? 1.05 : 0.82;
  clampCamera();
}

function setupLocalTowerCombatPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'tower-combat') return;

  const tower = createBuilding(0, 'tower', 1320, 1500, true);
  tower.reload = 0.8;
  activeWorld.buildings.push(tower);
  activeWorld.resources = activeWorld.resources.filter(resource => (
    Math.hypot(resource.x - tower.x, resource.y - tower.y) > 410 + resource.radius
  ));

  const positions = [
    [220, -92], [258, -38], [276, 28], [244, 92], [188, 132],
  ];
  for (const [offsetX, offsetY] of positions) {
    const target = spawnUnit(activeWorld, 1, 'musk', tower.x + offsetX, tower.y + offsetY);
    target.hp = 210;
    target.maxHp = 210;
    target.speed = 0;
    target.acquire = 0;
    target.reload = 999;
    target.target = null;
    target.orderTarget = null;
  }

  camera.x = tower.x + 60;
  camera.y = tower.y;
  camera.zoom = 1.35;
  clampCamera();
}

function setupLocalFormationMovementPreview(activeWorld) {
  const debugParams = new URLSearchParams(window.location.search);
  const debugName = debugParams.get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'formation-movement') return;

  const lanes = [
    { type: 'musk', count: 15, y: 1450 },
    { type: 'pike', count: 12, y: 1560 },
    { type: 'cav', count: 8, y: 1680 },
    { type: 'gun', count: 3, y: 1800 },
  ];
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < 2200 || resource.x > 3100 || resource.y < 1300 || resource.y > 2080
  ));
  for (const lane of lanes) {
    const units = [];
    for (let index = 0; index < lane.count; index++) {
      const unit = spawnUnit(
        activeWorld,
        0,
        lane.type,
        2380 + (index % 6) * 18,
        lane.y + Math.floor(index / 6) * 18,
      );
      unit.acquire = 0;
      unit.reload = 999;
      units.push(unit);
    }
    applyMoveOrder(units, 2920, lane.y, 'line');
  }

  const soloMusketeer = spawnUnit(activeWorld, 0, 'musk', 2400, 1900);
  const soloCavalry = spawnUnit(activeWorld, 0, 'cav', 2400, 1980);
  soloMusketeer.acquire = 0;
  soloCavalry.acquire = 0;
  applyMoveOrder([soloMusketeer], 2920, 1900, 'line');
  applyMoveOrder([soloCavalry], 2920, 1980, 'line');

  camera.x = 2650;
  camera.y = debugParams.get('focus') === 'rear' ? 1860 : 1590;
  camera.zoom = 1.65;
  clampCamera();
}

function setupLocalVillagerCarryPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'villager-carry') return;

  const resourceTypes = ['wood', 'food', 'gold', 'stone'];
  const sources = resourceTypes.map(resourceType => activeWorld.resources.find(resource => (
    resource.alive && resource.resourceType === resourceType
  ))).filter(Boolean);
  activeWorld.buildings.length = 0;
  activeWorld.resources = sources;
  for (let index = 0; index < sources.length; index++) {
    sources[index].x = 320;
    sources[index].y = 1430 + index * 110;
    sources[index].amount = Math.max(sources[index].amount, 1000);
  }
  const dropoffs = [
    createBuilding(0, 'town_center', 1420, 1580, true),
    createBuilding(1, 'town_center', 1420, 1580, true),
  ];
  activeWorld.buildings.push(...dropoffs);
  activeWorld.sides[0].townCenterId = dropoffs[0].id;
  activeWorld.sides[1].townCenterId = dropoffs[1].id;

  for (let side = 0; side < 2; side++) {
    for (let index = 0; index < resourceTypes.length; index++) {
      const resourceType = resourceTypes[index];
      const source = sources[index];
      if (!source) continue;
      const worker = spawnUnit(
        activeWorld,
        side,
        'villager',
        580 + side * 35 - index * 18,
        1510 + index * 36,
      );
      worker.job = {
        kind: 'gather',
        targetId: source.id,
        phase: 'deliver',
        resourceType,
        dropoffId: dropoffs[side].id,
        carriedAmount: 10,
      };
      worker.state = 'move';
      worker.facing = 1;
      worker.speed = 14;
      worker.animT = index * 0.13;
    }
  }

  camera.x = 760;
  camera.y = 1575;
  camera.zoom = 2.2;
  clampCamera();
}

function setupLocalWomanVillagerPreview(activeWorld) {
  const debugName = new URLSearchParams(window.location.search).get('debug');
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!localHost || debugName !== 'woman-villager') return;

  activeWorld.time = OPENING_PEACE_SECONDS;
  const previewBounds = { left: 780, right: 1750, top: 1160, bottom: 1840 };
  activeWorld.resources = activeWorld.resources.filter(resource => (
    resource.x < previewBounds.left || resource.x > previewBounds.right
    || resource.y < previewBounds.top || resource.y > previewBounds.bottom
  ));

  const foundation = createBuilding(0, 'house', 940, 1540, false);
  foundation.progress = 0.38;
  foundation.hp = foundation.maxHp * foundation.progress;
  activeWorld.buildings.push(foundation);
  const builder = spawnUnit(activeWorld, 0, 'woman_villager', 850, 1540);
  assignBuilders(activeWorld, [builder], foundation);

  const firingWoman = spawnUnit(activeWorld, 0, 'woman_villager', 1120, 1455);
  const firingTarget = spawnUnit(activeWorld, 1, 'musk', 1370, 1455);
  firingTarget.acquire = 0;
  firingTarget.speed = 0;
  firingTarget.reload = 999;
  firingWoman.reload = 0;
  applyAttackOrder([firingWoman], firingTarget);

  const readyWoman = spawnUnit(activeWorld, 0, 'woman_villager', 1120, 1505);
  const readyTarget = spawnUnit(activeWorld, 1, 'pike', 1430, 1505);
  readyTarget.acquire = 0;
  readyTarget.speed = 0;
  readyTarget.reload = 999;
  readyWoman.reload = 999;
  applyAttackOrder([readyWoman], readyTarget);

  camera.x = 1130;
  camera.y = 1490;
  camera.zoom = 2.3;
  clampCamera();
}

function handleCommand(command) {
  if (!world) return;
  if (command.action === 'build') {
    if (getPlacementPreview()?.type === command.type) {
      cancelPlacement();
      return;
    }
    beginPlacement(command.type);
    sfx.command('build');
    return;
  }
  if (command.action === 'train') {
    const building = getSelection().find(entity => entity.entityKind === 'building');
    const result = queueUnit(world, building, command.type, command.count);
    if (result.ok) sfx.command('train');
    ui.toast(result.message, result.ok ? 'good' : 'danger');
    ui.updateHud(world, getSelection());
    if (result.ok) sendPlayerCommand({
      kind: 'train',
      side: localSide,
      buildingId: building.id,
      type: command.type,
      count: command.count,
    });
    return;
  }
  if (command.action === 'trade') {
    const market = getSelection().find(entity => entity.entityKind === 'building'
      && entity.side === localSide && BUILDING_TYPES[entity.type]?.market);
    const result = executeMarketTrade(
      world,
      localSide,
      market,
      command.fromResource,
      command.toResource,
      command.amount,
    );
    ui.toast(result.message, result.ok ? 'good' : 'danger');
    if (result.ok) sfx.command('build');
    ui.updateHud(world, getSelection());
    if (result.ok) sendPlayerCommand({
      kind: 'trade',
      side: localSide,
      buildingId: market.id,
      fromResource: command.fromResource,
      toResource: command.toResource,
      amount: command.amount,
    });
    return;
  }
  if (command.action === 'gate') {
    const gate = getSelection().find(entity => entity.entityKind === 'building'
      && entity.type === 'gate' && entity.side === localSide);
    const result = toggleGate(world, gate);
    ui.toast(result.message, result.ok ? 'good' : 'danger');
    if (result.ok) sfx.command('move');
    ui.updateHud(world, getSelection());
    if (result.ok) sendPlayerCommand({
      kind: 'gate',
      side: localSide,
      buildingId: gate.id,
    });
  }
}

function turnBattleView(direction) {
  if (!world) return;
  const rotation = rotateView(direction);
  ui.setViewDirection(viewDirectionLabel(rotation));
  ui.toast(`View turned ${direction < 0 ? 'left' : 'right'} — facing ${viewDirectionLabel(rotation)}.`, 'good');
}

function changeBattleZoom(direction) {
  if (!world) return;
  zoomView(direction);
}

function togglePause() {
  if (!world || world.state === 'ended') return;
  world.state = world.state === 'paused' ? 'running' : 'paused';
  const paused = world.state === 'paused';
  sfx.setPaused(paused);
  ui.setPauseLabel(paused);
  if (paused) ui.showPauseMenu(sfx.getSettings());
  else ui.hidePauseMenu();
}

function refreshSavedCampaign() {
  ui.setSavedCampaign(getCampaignSummary());
}

function saveCurrentCampaign(exitToMap = false) {
  if (!world || !commanders.length || world.state !== 'paused') return;
  try {
    const summary = saveCampaign(world, commanders, camera);
    refreshSavedCampaign();
    ui.setPauseSaveStatus(`Campaign saved at ${new Date(summary.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
    if (exitToMap) {
      sfx.stopBattle();
      world = null;
      commanders = [];
      resetForBattle();
      ui.showStartMenu();
      ui.toast('Campaign saved. Resume it from the map table.', 'good');
    }
  } catch (error) {
    ui.setPauseSaveStatus(error?.message || 'The campaign could not be saved.', 'danger');
  }
}

async function resumeSavedCampaign() {
  sfx.ensure();
  try {
    await productionArtReady;
    const snapshot = loadCampaign();
    if (!snapshot) {
      refreshSavedCampaign();
      ui.toast('No saved campaign was found.', 'danger');
      return;
    }
    const restored = restoreGameSnapshot(snapshot);
    world = restored.world;
    commanders = restored.commanders || (restored.commander ? [restored.commander] : []);
    resetForBattle();
    startBattleRender(world);
    camera.x = restored.camera?.x ?? camera.x;
    camera.y = restored.camera?.y ?? camera.y;
    camera.zoom = restored.camera?.zoom ?? camera.zoom;
    camera.rotation = restored.camera?.rotation ?? camera.rotation;
    clampCamera();
    ui.setViewDirection(viewDirectionLabel(camera.rotation));
    world.state = 'running';
    sfx.startBattle(world);
    ui.showBattleHud(world);
    ui.setPauseLabel(false);
    ui.setSpeedLabel(world.speed);
    ui.markFormation('line');
    sfx.ensure();
    endShown = false;
    acc = 0;
    resetFrameMetrics();
    ui.toast('Saved campaign restored.', 'good');
  } catch (error) {
    refreshSavedCampaign();
    ui.toast(error?.message || 'The campaign could not be restored.', 'danger');
  }
}

function discardSavedCampaign() {
  deleteCampaign();
  refreshSavedCampaign();
  ui.toast('Saved campaign discarded.');
}

function toggleSpeed() {
  if (!world) return;
  world.speed = world.speed === 1 ? 2 : 1;
  ui.setSpeedLabel(world.speed);
}

let last = performance.now();
let acc = 0;

const frameMetrics = {
  startedAt: last,
  frames: 0,
  samples: 0,
  intervalTotal: 0,
  longestInterval: 0,
  stageTotals: { simulation: 0, audio: 0, input: 0, render: 0, hud: 0 },
  stagePeaks: { simulation: 0, audio: 0, input: 0, render: 0, hud: 0 },
};

function resetFrameMetrics(now = performance.now()) {
  last = now;
  frameMetrics.startedAt = now;
  frameMetrics.frames = 0;
  frameMetrics.samples = 0;
  frameMetrics.intervalTotal = 0;
  frameMetrics.longestInterval = 0;
  for (const stage of Object.keys(frameMetrics.stageTotals)) {
    frameMetrics.stageTotals[stage] = 0;
    frameMetrics.stagePeaks[stage] = 0;
  }
  delete canvas.dataset.frameMetrics;
}

function markEndOverlay() {
  const overlay = document.getElementById('overlay-end');
  if (!overlay || !world) return;
  overlay.classList.toggle('victory', world.winner === world.sides[0]?.team);
}

function recordFrameMetrics(interval, stageTimes) {
  frameMetrics.frames++;
  frameMetrics.intervalTotal += interval;
  frameMetrics.longestInterval = Math.max(frameMetrics.longestInterval, interval);
  if (stageTimes) {
    frameMetrics.samples++;
    for (const stage of Object.keys(stageTimes)) {
      frameMetrics.stageTotals[stage] += stageTimes[stage];
      frameMetrics.stagePeaks[stage] = Math.max(frameMetrics.stagePeaks[stage], stageTimes[stage]);
    }
  }
  if (frameMetrics.frames % 60 !== 0) return;
  const averages = Object.fromEntries(Object.entries(frameMetrics.stageTotals)
    .map(([stage, total]) => [stage, total / Math.max(1, frameMetrics.samples)]));
  canvas.dataset.frameMetrics = JSON.stringify({
    elapsed: performance.now() - frameMetrics.startedAt,
    frames: frameMetrics.frames,
    samples: frameMetrics.samples,
    averageInterval: frameMetrics.intervalTotal / frameMetrics.frames,
    longestInterval: frameMetrics.longestInterval,
    averages,
    peaks: frameMetrics.stagePeaks,
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  const interval = now - last;
  const dt = Math.min(0.1, interval / 1000);
  last = now;
  if (!world) return;

  const shouldSample = (frameMetrics.frames & 3) === 0;
  let mark = shouldSample ? performance.now() : 0;
  const stageTimes = shouldSample ? {} : null;

  if (world.state === 'running') {
    if (multiplayer.mode !== 'guest') {
      acc += dt * world.speed;
      let steps = 0;
      while (acc >= SIM_STEP && steps < 5) {
        step(world, SIM_STEP);
        for (const commander of commanders) commander.update(SIM_STEP);
        acc -= SIM_STEP;
        steps++;
      }
      if (steps === 5) acc = 0; // can't keep up — drop time rather than spiral
      sendMultiplayerSnapshot();
    }
  }
  if (shouldSample) {
    const next = performance.now();
    stageTimes.simulation = next - mark;
    mark = next;
  }

  sfx.update(dt, world, camera.x);
  ui.setMusicStatus(sfx.getNowPlaying(), world.state === 'paused');
  if (shouldSample) {
    const next = performance.now();
    stageTimes.audio = next - mark;
    mark = next;
  }

  updateInput(dt);
  if (shouldSample) {
    const next = performance.now();
    stageTimes.input = next - mark;
    mark = next;
  }
  draw(
    world, Math.min(1, acc / SIM_STEP), getDragRect(),
    getPlacementPreview(), getResourceHoverTarget(), getMovePreview(), getResourceHoverKind(),
  );
  if (shouldSample) {
    const next = performance.now();
    stageTimes.render = next - mark;
    mark = next;
  }
  ui.updateHud(world, getSelection());
  if (shouldSample) stageTimes.hud = performance.now() - mark;
  recordFrameMetrics(interval, stageTimes);

  if (world.state === 'ended' && !endShown) {
    endShown = true;
    ui.showEnd(world);
    markEndOverlay();
  }
}

requestAnimationFrame(frame);

// Console/debug hook: advance the battle by hand, e.g. __tick(30) in DevTools.
window.__tick = (secs = 1) => {
  if (!world) return 'no battle running';
  const n = Math.round(secs / SIM_STEP);
  for (let i = 0; i < n; i++) {
    step(world, SIM_STEP);
    for (const commander of commanders) commander.update(SIM_STEP);
  }
  draw(
    world, 1, null, getPlacementPreview(), getResourceHoverTarget(), getMovePreview(),
    getResourceHoverKind(),
  );
  ui.updateHud(world, getSelection());
  if (world.state === 'ended' && !endShown) {
    endShown = true;
    ui.showEnd(world);
    markEndOverlay();
  }
  return `t=${world.time.toFixed(1)}s  ${world.sides.map(side => side.alive).join(' / ')}`;
};

// Console/debug hook: park the camera for reproducible screenshots.
window.__view = (x, y, zoom, rotation = camera.rotation) => {
  if (!world) return 'no battle running';
  camera.x = x; camera.y = y; camera.zoom = zoom; camera.rotation = rotation;
  clampCamera();
  draw(
    world, 1, null, getPlacementPreview(), getResourceHoverTarget(), getMovePreview(),
    getResourceHoverKind(),
  );
  return `cam=(${camera.x | 0},${camera.y | 0}) zoom=${camera.zoom} rotation=${camera.rotation}`;
};

// Console/debug hook: trigger the normal team-victory path for rainbow QA.
window.__debugWin = () => {
  if (!world) return null;
  const playerTeam = world.sides[0]?.team;
  const rivalTownCenters = world.buildings.filter(building => (
    building.alive
      && building.type === 'town_center'
      && world.sides[building.side]?.team !== playerTeam
  ));
  for (const townCenter of rivalTownCenters) {
    damage(world, townCenter, townCenter.maxHp + 1, null);
  }
  world.checkT = 0;
  step(world, SIM_STEP);
  draw(
    world, 1, null, getPlacementPreview(), getResourceHoverTarget(), getMovePreview(),
    getResourceHoverKind(),
  );
  ui.updateHud(world, getSelection());
  if (world.state === 'ended' && !endShown) {
    endShown = true;
    ui.showEnd(world);
    markEndOverlay();
  }
  return window.__state();
};

// Lightweight diagnostics used by the local browser checks and useful when
// balancing large matches from DevTools.
window.__state = () => {
  if (!world) return null;
  return {
    time: world.time,
    state: world.state,
    winner: world.winner,
    units: world.sides.map(side => side.alive),
    population: world.sides.map(side => side.population),
    buildings: world.sides.map((_, side) => world.buildings.filter(b => b.alive && b.side === side).length),
    automaticEngagements: world.units.filter(unit => (
      unit.alive && unit.type !== 'villager' && unit.target?.alive && !unit.orderTarget
    )).length,
    resources: world.sides.map(side => Object.fromEntries(Object.entries(side.resources).map(([key, value]) => [key, Math.floor(value)]))),
    incomePerHour: world.sides.map(side => Object.fromEntries(Object.entries(side.incomePerHour).map(([key, value]) => [key, Math.round(value)]))),
    carryingVillagers: world.units.filter(unit => (
      unit.alive && unit.type === 'villager' && unit.moving
        && (Number(unit.job?.carriedAmount) || 0) > 0
    )).length,
  };
};

window.__audioState = () => sfx.getDiagnostics();
window.__frameMetrics = () => JSON.parse(canvas.dataset.frameMetrics || 'null');
