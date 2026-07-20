// Entry point: wires up modules and runs the fixed-timestep game loop.

import { SIM_STEP, BUILDING_TYPES } from './config.js';
import { createWorld, step } from './sim.js';
import { Commander } from './ai.js';
import { initRender, startBattle as startBattleRender, draw,
         camera, clampCamera } from './render.js';
import { initInput, updateInput, getSelection, getDragRect,
         getPlacementPreview, getResourceHoverTarget, getMovePreview, beginPlacement, setFormation,
         cancelPlacement, haltSelection, resetForBattle } from './input.js';
import { placeBuilding, queueUnit, validatePlacement } from './economy.js';
import * as ui from './ui.js';
import { sfx } from './audio.js';
import { preloadProductionArt } from './gfx/art-assets.js';
import {
  deleteCampaign, getCampaignSummary, loadCampaign, restoreGameSnapshot, saveCampaign,
} from './savegame.js';

let world = null;
let commander = null;
let endShown = false;

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');
const productionArtReady = preloadProductionArt();

initRender(canvas, minimap);
initInput(canvas, minimap, () => world, {
  onPause: togglePause,
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

async function startBattle(opts) {
  sfx.ensure();
  await productionArtReady;
  world = createWorld(opts);
  commander = new Commander(world, 1);
  resetForBattle();
  startBattleRender(world);
  ui.showBattleHud(world);
  ui.setPauseLabel(false);
  ui.setSpeedLabel(1);
  ui.markFormation('line');
  sfx.startBattle(world);
  endShown = false;
  acc = 0;
  resetFrameMetrics();
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
  }
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
    clampCamera();
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
    getPlacementPreview(), getResourceHoverTarget(), getMovePreview(),
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
  draw(world, 1, null, getPlacementPreview(), getResourceHoverTarget(), getMovePreview());
  ui.updateHud(world, getSelection());
  if (world.state === 'ended' && !endShown) {
    endShown = true;
    ui.showEnd(world);
  }
  return `t=${world.time.toFixed(1)}s  ${world.sides[0].alive} vs ${world.sides[1].alive}`;
};

// Console/debug hook: park the camera for reproducible screenshots.
window.__view = (x, y, zoom) => {
  if (!world) return 'no battle running';
  camera.x = x; camera.y = y; camera.zoom = zoom;
  clampCamera();
  draw(world, 1, null, getPlacementPreview(), getResourceHoverTarget(), getMovePreview());
  return `cam=(${camera.x | 0},${camera.y | 0}) zoom=${camera.zoom}`;
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
    resources: world.sides.map(side => Object.fromEntries(Object.entries(side.resources).map(([key, value]) => [key, Math.floor(value)]))),
    incomePerHour: world.sides.map(side => Object.fromEntries(Object.entries(side.incomePerHour).map(([key, value]) => [key, Math.round(value)]))),
  };
};

window.__audioState = () => sfx.getDiagnostics();
window.__frameMetrics = () => JSON.parse(canvas.dataset.frameMetrics || 'null');
