// Entry point: wires up modules and runs the fixed-timestep game loop.

import { SIM_STEP, BUILDING_TYPES } from './config.js';
import { createWorld, step } from './sim.js';
import { Commander } from './ai.js';
import { initRender, startBattle as startBattleRender, draw,
         camera, clampCamera } from './render.js';
import { initInput, updateInput, getSelection, getDragRect,
         getPlacementPreview, getResourceHoverTarget, beginPlacement, setFormation,
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
  onFormation: ui.markFormation,
  onSelection: () => world && ui.updateHud(world, getSelection()),
  onValidatePlacement: (type, x, y) => validatePlacement(world, 0, type, x, y),
  onPlaceBuilding: (type, x, y, workers) => placeBuilding(world, 0, type, x, y, workers),
  onPlacement: placement => ui.setPlacement(
    Boolean(placement),
    placement ? BUILDING_TYPES[placement.type].label : '',
    placement?.type || '',
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
  onHalt: haltSelection,
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
  endShown = false;
  acc = 0;
}

function handleCommand(command) {
  if (!world) return;
  if (command.action === 'build') {
    if (getPlacementPreview()?.type === command.type) {
      cancelPlacement();
      return;
    }
    beginPlacement(command.type);
    return;
  }
  if (command.action === 'train') {
    const building = getSelection().find(entity => entity.entityKind === 'building');
    const result = queueUnit(world, building, command.type, command.count);
    ui.toast(result.message, result.ok ? 'good' : 'danger');
    ui.updateHud(world, getSelection());
  }
}

function togglePause() {
  if (!world || world.state === 'ended') return;
  world.state = world.state === 'paused' ? 'running' : 'paused';
  const paused = world.state === 'paused';
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
    ui.showBattleHud(world);
    ui.setPauseLabel(false);
    ui.setSpeedLabel(world.speed);
    ui.markFormation('line');
    sfx.ensure();
    endShown = false;
    acc = 0;
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

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!world) return;

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

  updateInput(dt);
  draw(world, Math.min(1, acc / SIM_STEP), getDragRect(), getPlacementPreview(), getResourceHoverTarget());
  ui.updateHud(world, getSelection());

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
  draw(world, 1, null, getPlacementPreview(), getResourceHoverTarget());
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
  draw(world, 1, null, getPlacementPreview(), getResourceHoverTarget());
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
