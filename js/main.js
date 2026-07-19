// Entry point: wires up modules and runs the fixed-timestep game loop.

import { SIM_STEP } from './config.js';
import { createWorld, step } from './sim.js';
import { Commander } from './ai.js';
import { initRender, startBattle as startBattleRender, draw } from './render.js';
import { initInput, updateInput, getSelection, getDragRect,
         setFormation, haltSelection, resetForBattle } from './input.js';
import * as ui from './ui.js';
import { sfx } from './audio.js';

let world = null;
let commander = null;
let endShown = false;

const canvas = document.getElementById('game');
const minimap = document.getElementById('minimap');

initRender(canvas, minimap);
initInput(canvas, minimap, () => world, {
  onPause: togglePause,
  onFormation: ui.markFormation,
});

ui.initMenu(startBattle);
ui.bindControls({
  onPause: togglePause,
  onSpeed: toggleSpeed,
  onHalt: haltSelection,
  onFormation: setFormation,
  onAgain: () => {
    world = null;
    ui.showStartMenu();
  },
});

function startBattle(opts) {
  sfx.ensure();
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

function togglePause() {
  if (!world || world.state === 'ended') return;
  world.state = world.state === 'paused' ? 'running' : 'paused';
  ui.setPauseLabel(world.state === 'paused');
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
  draw(world, Math.min(1, acc / SIM_STEP), getDragRect());
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
  draw(world, 1, null);
  ui.updateHud(world, getSelection());
  if (world.state === 'ended' && !endShown) {
    endShown = true;
    ui.showEnd(world);
  }
  return `t=${world.time.toFixed(1)}s  ${world.sides[0].alive} vs ${world.sides[1].alive}`;
};
