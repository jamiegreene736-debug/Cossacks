// Entry point: wires up modules and runs the fixed-timestep game loop.

import { SIM_STEP, BUILDING_TYPES } from './config.js';
import { createWorld, spawnUnit, step } from './sim.js';
import { Commander } from './ai.js';
import { initRender, startBattle as startBattleRender, draw,
         camera, clampCamera, rotateView } from './render.js';
import { viewDirectionLabel } from './camera.js';
import { initInput, updateInput, getSelection, getDragRect,
         getPlacementPreview, getResourceHoverTarget, getResourceHoverKind, getMovePreview,
         beginPlacement, setFormation,
         cancelPlacement, haltSelection, resetForBattle } from './input.js';
import {
  createBuilding, placeBuilding, placeWallRun, planWallRun, queueUnit, validatePlacement,
} from './economy.js';
import * as ui from './ui.js';
import { sfx } from './audio.js';
import { preloadProductionArt } from './gfx/art-assets.js';
import {
  deleteCampaign, getCampaignSummary, loadCampaign, restoreGameSnapshot, saveCampaign,
} from './savegame.js';
import { toggleGate } from './fortifications.js';
import { applyMoveOrder } from './formations.js';

let world = null;
let commander = null;
let endShown = false;

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const productionArtReady = preloadProductionArt();

initRender(canvas, minimap);
initInput(canvas, minimap, () => world, {
  onPause: togglePause,
  onView: turnBattleView,
  onFormation: formation => {
    ui.markFormation(formation);
    sfx.command('move');
  },
  onSelection: () => {
    sfx.command('select');
    if (world) ui.updateHud(world, getSelection());
  },
  onOrder: kind => sfx.command(kind),
  onValidatePlacement: (type, x, y, options) => validatePlacement(world, 0, type, x, y, options),
  onPlanWallRun: (startX, startY, endX, endY, orientation, pathPoints) => (
    planWallRun(world, 0, startX, startY, endX, endY, orientation, pathPoints)
  ),
  onPlaceWallRun: (startX, startY, endX, endY, workers, orientation, pathPoints) => {
    const result = placeWallRun(
      world, 0, startX, startY, endX, endY, workers, orientation, pathPoints,
    );
    if (result.ok) sfx.buildingPlaced(result.building.x);
    return result;
  },
  onPlaceBuilding: (type, x, y, workers, options) => {
    const result = placeBuilding(world, 0, type, x, y, workers, options);
    if (result.ok) sfx.buildingPlaced(result.building.x);
    return result;
  },
  onPlacement: placement => ui.setPlacement(
    Boolean(placement),
    placement ? BUILDING_TYPES[placement.type].label : '',
    placement?.type || '',
    placement?.orientation || '',
  ),
  onResourceHover: hover => ui.setResourceHover(world, hover),
  onToast: ui.toast,
});

ui.initMenu({
  onStart: startBattle,
  onLoad: resumeSavedCampaign,
  onDelete: discardSavedCampaign,
});
ui.bindControls({
  onPause: togglePause,
  onView: turnBattleView,
  onSpeed: toggleSpeed,
  onHalt: () => {
    haltSelection();
    sfx.command('move');
  },
  onFormation: setFormation,
  onCommand: handleCommand,
  onCancelPlacement: cancelPlacement,
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
    commander = null;
    resetForBattle();
    ui.showStartMenu();
    refreshSavedCampaign();
  },
});
refreshSavedCampaign();

function syncAudioPageActivity() {
  void sfx.setPageActive(document.visibilityState === 'visible');
}

document.addEventListener('visibilitychange', syncAudioPageActivity);
window.addEventListener('pagehide', () => { void sfx.setPageActive(false); });
window.addEventListener('pageshow', syncAudioPageActivity);
syncAudioPageActivity();

async function startBattle(opts) {
  sfx.ensure();
  await productionArtReady;
  world = createWorld(opts);
  commander = new Commander(world, 1, world.difficulty);
  resetForBattle();
  startBattleRender(world);
  setupLocalBuildingFirePreview(world);
  setupLocalAutoEngagePreview(world);
  setupLocalCurvedWallPreview(world);
  setupLocalTowerCombatPreview(world);
  setupLocalCastlePreview(world);
  setupLocalOttomanArchitecturePreview(world);
  setupLocalFormationMovementPreview(world);
  ui.showBattleHud(world);
  ui.setPauseLabel(false);
  ui.setSpeedLabel(1);
  ui.setViewDirection(viewDirectionLabel(camera.rotation));
  ui.markFormation('line');
  sfx.startBattle(world);
  endShown = false;
  acc = 0;
  resetFrameMetrics();
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
  if (!localHost || debugName !== 'curved-wall') return;

  const wallWidth = BUILDING_TYPES.wall.w;
  const angles = [-0.52, -0.36, -0.20, -0.04, 0.12, 0.28, 0.44];
  let endpoint = { x: 910, y: 1500 };
  const walls = [];
  for (const angle of angles) {
    const axis = { x: Math.cos(angle), y: Math.sin(angle) };
    const wall = createBuilding(
      0,
      'wall',
      endpoint.x + axis.x * wallWidth * 0.5,
      endpoint.y + axis.y * wallWidth * 0.5,
      true,
      { orientation: angle },
    );
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
    return;
  }
  if (command.action === 'gate') {
    const gate = getSelection().find(entity => entity.entityKind === 'building'
      && entity.type === 'gate' && entity.side === 0);
    const result = toggleGate(world, gate);
    ui.toast(result.message, result.ok ? 'good' : 'danger');
    if (result.ok) sfx.command('move');
    ui.updateHud(world, getSelection());
  }
}

function turnBattleView(direction) {
  if (!world) return;
  const rotation = rotateView(direction);
  ui.setViewDirection(viewDirectionLabel(rotation));
  ui.toast(`View turned ${direction < 0 ? 'left' : 'right'} — facing ${viewDirectionLabel(rotation)}.`, 'good');
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
  if (!world || !commander || world.state !== 'paused') return;
  try {
    const summary = saveCampaign(world, commander, camera);
    refreshSavedCampaign();
    ui.setPauseSaveStatus(`Campaign saved at ${new Date(summary.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`);
    if (exitToMap) {
      sfx.stopBattle();
      world = null;
      commander = null;
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
    commander = restored.commander;
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
    acc += dt * world.speed;
    let steps = 0;
    while (acc >= SIM_STEP && steps < 5) {
      step(world, SIM_STEP);
      commander.update(SIM_STEP);
      acc -= SIM_STEP;
      steps++;
    }
    if (steps === 5) acc = 0; // can't keep up — drop time rather than spiral
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
  }
}

requestAnimationFrame(frame);

// Console/debug hook: advance the battle by hand, e.g. __tick(30) in DevTools.
window.__tick = (secs = 1) => {
  if (!world) return 'no battle running';
  const n = Math.round(secs / SIM_STEP);
  for (let i = 0; i < n; i++) {
    step(world, SIM_STEP);
    commander.update(SIM_STEP);
  }
  draw(
    world, 1, null, getPlacementPreview(), getResourceHoverTarget(), getMovePreview(),
    getResourceHoverKind(),
  );
  ui.updateHud(world, getSelection());
  if (world.state === 'ended' && !endShown) {
    endShown = true;
    ui.showEnd(world);
  }
  return `t=${world.time.toFixed(1)}s  ${world.sides[0].alive} vs ${world.sides[1].alive}`;
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
  };
};

window.__audioState = () => sfx.getDiagnostics();
window.__frameMetrics = () => JSON.parse(canvas.dataset.frameMetrics || 'null');
