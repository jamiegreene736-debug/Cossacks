// Rendering: procedural sprite atlases plus selected production building art,
// terrain and corpse-decal canvases, camera transform, effects, and minimap.

import { WORLD, NATIONS, BUILDING_TYPES } from './config.js';
import { buildTerrain, drawTerrain, drawTree, buildMinimapTerrain } from './gfx/terrain.js';
import { drawSoldier, INF_W, INF_H, INF_AX, INF_AY } from './gfx/infantry.js';
import { setDecalCtx, buildDecalStamps, paintDecal } from './gfx/decals.js';
import { setEffectsCamera, setEffectsView, buildParticleTextures,
         resetEffectFields, drawSmokeUnder, drawEffects } from './gfx/effects.js';
import { getTerrainCanvas } from './gfx/terrain.js';
import { getTrampleCanvas } from './gfx/decals.js';
import { drawCavalry, drawCannon } from './gfx/mounted.js';
import { drawWorker, VL_W, VL_H, VL_AX, VL_AY } from './gfx/villager.js';
import { getProductionArt } from './gfx/art-assets.js';
import { getWorkerFrame } from './worker-animation.js';
import { setBuildingRefs, bdResetCaches, drawResourceNode, drawFarm,
         drawFoundation, drawCompleteBuilding, drawBuilding } from './gfx/buildings.js';
import { setCompositeRefs, setCompositeView, setCompositeTrampleLayer,
         buildCompositeTextures, buildMinimapBase, drawLightingPass,
         drawSelection, drawHealthBars, drawOrderFlags, drawDragRect,
         drawMinimap } from './gfx/composite.js';

const SCALE = 4; // sprite atlas oversampling — 4 keeps figures crisp at 2.4x zoom

// Reserved side colours. These appear nowhere else in the world, so side
// identity survives even a mirror matchup (England vs England).
const SIDE_RIM = ['#3E78B8', '#B8483E'];
const PRODUCTION_WORKER = Object.freeze({
  w: 38, h: 44, ax: 19, ay: 36.5, sourceW: 384, sourceH: 448,
});
const PRODUCTION_WORKER_ART = Object.freeze({
  england: 'englishVillager',
  ottoman: 'ottomanVillager',
});

export const camera = { x: 660, y: WORLD.h / 2, zoom: 0.9 };

let canvas, ctx, mmCanvas, mmCtx;
let cw = 0, ch = 0, dpr = 1;
let decalCanvas = null, decalCtx = null;
let mmTerrain = null;
let sprites = null; // sprites[side][type] = {frames: [dir][frame], w,h,ax,ay}

// ---------- Setup ----------

export function initRender(gameCanvas, minimapCanvas) {
  canvas = gameCanvas;
  ctx = canvas.getContext('2d');
  mmCanvas = minimapCanvas;
  mmCtx = mmCanvas.getContext('2d');
  setEffectsCamera(camera);
  setCompositeRefs({ camera, mmCanvas, mmCtx });
  setBuildingRefs({ ctx, camera });
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  cw = window.innerWidth;
  ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  setEffectsView(cw, ch);
  setCompositeView(cw, ch, dpr);
  buildCompositeTextures();   // grade/vignette gradients are viewport-sized
}

export function getViewSize() { return { w: cw, h: ch }; }

export function screenToWorld(sx, sy) {
  return {
    x: camera.x + (sx - cw / 2) / camera.zoom,
    y: camera.y + (sy - ch / 2) / camera.zoom,
  };
}

export function clampCamera() {
  const halfW = cw / 2 / camera.zoom, halfH = ch / 2 / camera.zoom;
  const m = 0;
  camera.x = Math.max(halfW - m, Math.min(WORLD.w - halfW + m, camera.x));
  camera.y = Math.max(halfH - m, Math.min(WORLD.h - halfH + m, camera.y));
  if (WORLD.w + 2 * m < 2 * halfW) camera.x = WORLD.w / 2;
  if (WORLD.h + 2 * m < 2 * halfH) camera.y = WORLD.h / 2;
}

export function minimapToWorld(mx, my) {
  return { x: mx / mmCanvas.width * WORLD.w, y: my / mmCanvas.height * WORLD.h };
}

// ---------- Battle setup ----------

export function startBattle(world) {
  bdResetCaches();   // drop baked building stamps from the previous battle
  buildTerrain();
  decalCanvas = document.createElement('canvas');
  decalCanvas.width = WORLD.w;
  decalCanvas.height = WORLD.h;
  decalCtx = decalCanvas.getContext('2d');
  setDecalCtx(decalCtx);
  buildDecalStamps(world);
  for (const decal of world.decals || []) paintDecal(decal);
  buildParticleTextures();
  resetEffectFields();   // so a rematch does not inherit last game's powder
  sprites = [
    buildNationSprites(world.sides[0].nation, 0),
    buildNationSprites(world.sides[1].nation, 1),
  ];
  mmTerrain = buildMinimapTerrain(mmCanvas.width, mmCanvas.height);
  setCompositeRefs({ mmTerrain });
  setCompositeTrampleLayer(getTrampleCanvas());
  buildMinimapBase(getTerrainCanvas());
  const townCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  camera.x = townCenter?.x || 660;
  camera.y = townCenter?.y || WORLD.h / 2;
  camera.zoom = Math.max(0.62, Math.min(1.15, ch / 1050));
  clampCamera();
}


// ---------- Sprite atlases ----------

function frameCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w * SCALE; c.height = h * SCALE;
  const g = c.getContext('2d');
  g.scale(SCALE, SCALE);
  g.lineCap = 'round';
  return [c, g];
}

function mirror(c) {
  const m = document.createElement('canvas');
  m.width = c.width; m.height = c.height;
  const g = m.getContext('2d');
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(c, 0, 0);
  return m;
}

const PRODUCTION_TOOL_CLEAR = Object.freeze({
  england: [[6.8, 4.5], [30.2, 23.6]],
  ottoman: [[6.7, 4.8], [14.5, 25.0]],
});

function paintProductionToolHead(g, action, grip, head) {
  const angle = Math.atan2(head[1] - grip[1], head[0] - grip[0]);
  const steel = '#9da49e';
  const steelEdge = '#e8e0c7';
  const steelLine = '#292b29';

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#2b2117';
  g.lineWidth = 1.45;
  g.beginPath();
  g.moveTo(grip[0], grip[1]);
  g.lineTo(head[0], head[1]);
  g.stroke();
  g.strokeStyle = '#8a5b30';
  g.lineWidth = 0.8;
  g.stroke();

  g.translate(head[0], head[1]);
  g.rotate(angle);
  g.strokeStyle = steelLine;
  g.fillStyle = steel;

  if (action === 'mine') {
    g.lineWidth = 1.65;
    g.beginPath();
    g.moveTo(-0.35, -3.5);
    g.quadraticCurveTo(0.75, 0, -0.05, 3.5);
    g.stroke();
    g.strokeStyle = steelEdge;
    g.lineWidth = 0.45;
    g.stroke();
  } else if (action === 'farm') {
    g.lineWidth = 0.8;
    g.strokeRect(-0.35, 0.1, 2.6, 3.15);
    g.fillRect(-0.35, 0.1, 2.6, 3.15);
    g.strokeStyle = steelEdge;
    g.lineWidth = 0.35;
    g.beginPath();
    g.moveTo(1.95, 0.45);
    g.lineTo(1.95, 2.9);
    g.stroke();
  } else if (action === 'forage') {
    g.lineWidth = 1.55;
    g.beginPath();
    g.moveTo(0, 0.1);
    g.quadraticCurveTo(3.6, 2.6, 0.5, 3.8);
    g.stroke();
    g.strokeStyle = steelEdge;
    g.lineWidth = 0.45;
    g.stroke();
  } else if (action === 'build') {
    g.lineWidth = 0.8;
    g.strokeRect(-0.7, -2.8, 3.2, 5.6);
    g.fillStyle = '#745137';
    g.fillRect(-0.7, -2.8, 3.2, 5.6);
    g.strokeStyle = steelEdge;
    g.lineWidth = 0.35;
    g.beginPath();
    g.moveTo(0, -2.5);
    g.lineTo(0, 2.5);
    g.stroke();
  } else {
    g.lineWidth = 0.85;
    g.beginPath();
    g.moveTo(-0.25, -0.55);
    g.lineTo(2.9, -2.25);
    g.quadraticCurveTo(3.75, 0.3, 2.2, 2.85);
    g.lineTo(-0.2, 0.8);
    g.closePath();
    g.fill();
    g.stroke();
    g.strokeStyle = steelEdge;
    g.lineWidth = 0.35;
    g.beginPath();
    g.moveTo(2.65, -1.9);
    g.quadraticCurveTo(3.45, 0.3, 2.05, 2.45);
    g.stroke();
  }
  g.restore();
}

function paintProductionWorkerTool(g, nationKey, action, phase) {
  const oldHead = PRODUCTION_TOOL_CLEAR[nationKey]?.[phase];
  if (oldHead) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.ellipse(oldHead[0], oldHead[1], 3.8, 3.8, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  const grip = phase === 0 ? [17.6, 13.2] : [21.0, 23.8];
  const head = phase === 0 ? [6.7, 4.7] : [32.4, 30.2];
  paintProductionToolHead(g, action, grip, head);

  if (phase === 0) return;
  const chip = action === 'farm' ? '#725632'
    : action === 'forage' ? '#8ba052'
      : action === 'chop' || action === 'build' ? '#c09a61' : '#c8c2ab';
  g.save();
  g.fillStyle = chip;
  g.globalAlpha = 0.9;
  for (const [x, y, r] of [[35.1, 27.8, 0.7], [36.0, 30.7, 0.55], [34.8, 33.0, 0.45]]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}





function buildNationSprites(nationKey, side = 0) {
  // The painters read an optional `rim` (side colour) and `headgear` off nat.
  const nat = { ...NATIONS[nationKey], rim: SIDE_RIM[side] };
  const out = {};
  const productionWorker = getProductionArt(PRODUCTION_WORKER_ART[nationKey]);
  const workerFrames = [
    ['idle', 0, null, 0], ['idle', 1, null, 1], ['idle', 2, null, 2],
    ['build', 0, 'build', 3], ['build', 1, 'build', 0],
    ['work', 0, 'chop', 3], ['work', 1, 'chop', 0],
    ['work', 0, 'mine', 3], ['work', 1, 'mine', 0],
    ['work', 0, 'farm', 3], ['work', 1, 'farm', 0],
    ['work', 0, 'forage', 3], ['work', 1, 'forage', 0],
  ];
  const workerDef = productionWorker ? {
    w: PRODUCTION_WORKER.w,
    h: PRODUCTION_WORKER.h,
    ax: PRODUCTION_WORKER.ax,
    ay: PRODUCTION_WORKER.ay,
    production: productionWorker,
    frames: workerFrames,
  } : {
    w: VL_W,
    h: VL_H,
    ax: VL_AX,
    ay: VL_AY,
    frames: workerFrames,
    painter: (g, pose, leg, action) => drawWorker(g, nat, pose, leg, action),
  };

  const defs = {
    villager: workerDef,
    musk: { w: INF_W, h: INF_H, ax: INF_AX, ay: INF_AY, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['fire', 0],
    ], painter: (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'musk') },
    pike: { w: INF_W, h: INF_H, ax: INF_AX, ay: INF_AY, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['attack', 0],
    ], painter: (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'pike') },
    // Boxes come from the mounted bounds audit: the painted geometry reaches
    // x=30.19 and x=39.54, so the old 23/27-wide boxes clipped the horse's
    // head and the gun's far crewman outright. Anchor is exactly w/2 so the
    // mirrored facing lines up.
    cav: { w: 33, h: 29, ax: 16.5, ay: 23.4, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['attack', 0],
    ], painter: (g, pose, leg) => drawCavalry(g, nat, pose, leg, side) },
    gun: { w: 41, h: 29, ax: 20.5, ay: 23.4, frames: [
      ['idle', 0], ['fire', 0],
    ], painter: (g, pose) => drawCannon(g, nat, pose, side) },
  };

  for (const [type, def] of Object.entries(defs)) {
    const right = [], left = [];
    for (let frameIndex = 0; frameIndex < def.frames.length; frameIndex++) {
      const [pose, leg, action = null, sourceFrame = frameIndex] = def.frames[frameIndex];
      const [c, g] = frameCanvas(def.w, def.h);
      if (def.production) {
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(
          def.production,
          sourceFrame * PRODUCTION_WORKER.sourceW, 0,
          PRODUCTION_WORKER.sourceW, PRODUCTION_WORKER.sourceH,
          0, 0, def.w, def.h,
        );
        if (action) paintProductionWorkerTool(g, nationKey, action, leg);
      } else {
        def.painter(g, pose, leg, action);
      }
      right.push(c);
      left.push(mirror(c));
    }
    out[type] = { w: def.w, h: def.h, ax: def.ax, ay: def.ay, frames: [right, left] };
  }
  return out;
}

// ---------- Decals ----------


// ---------- Settlement art ----------







// ---------- Frame draw ----------

const sortBuf = [];

function drawResourceHover(target, zoom) {
  if (!target?.alive || target.amount <= 0) return;
  const colors = {
    food: ['#f4d58a', '#9fc96b'],
    wood: ['#d7e8a8', '#6fa455'],
    gold: ['#fff0a4', '#d0a23d'],
    stone: ['#e5e7df', '#9fa8a6'],
  };
  const [light, base] = colors[target.resourceType] || colors.food;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
  const rx = target.radius + 11 + pulse * 3;
  const ry = Math.max(15, target.radius * 0.48 + pulse * 2);
  ctx.save();
  ctx.strokeStyle = 'rgba(16, 20, 12, 0.72)';
  ctx.lineWidth = 5 / zoom;
  ctx.beginPath();
  ctx.ellipse(target.x, target.y + target.radius * 0.28, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([8 / zoom, 5 / zoom]);
  ctx.lineDashOffset = -performance.now() * 0.012 / zoom;
  ctx.beginPath();
  ctx.ellipse(target.x, target.y + target.radius * 0.28, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = base;
  ctx.strokeStyle = light;
  ctx.lineWidth = 1.2 / zoom;
  ctx.beginPath();
  ctx.moveTo(target.x, target.y - target.radius - 13 - pulse * 3);
  ctx.lineTo(target.x - 6, target.y - target.radius - 22 - pulse * 3);
  ctx.lineTo(target.x + 6, target.y - target.radius - 22 - pulse * 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMovePreview(preview, zoom, time) {
  if (!preview) return;
  const s = 1 / Math.max(0.62, Math.min(1.45, zoom));
  const pulse = 0.5 + Math.sin(time * 5.5) * 0.5;
  ctx.save();
  ctx.translate(preview.x, preview.y);
  ctx.scale(s, s);
  ctx.globalAlpha = 0.58 + pulse * 0.18;
  ctx.strokeStyle = '#f0e9cf';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -time * 11;
  ctx.beginPath();
  ctx.ellipse(0, 0, 17 + pulse * 2, 7.5 + pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#d4b860';
  ctx.lineWidth = 1.8;
  for (let i = -1; i <= 1; i++) {
    const x = i * 7;
    ctx.beginPath();
    ctx.moveTo(x - 3.5, 1.5);
    ctx.lineTo(x, -2);
    ctx.lineTo(x + 3.5, 1.5);
    ctx.stroke();
  }
  ctx.restore();
}

export function draw(
  world, alpha, dragRect, placementPreview = null, resourceHover = null, movePreview = null,
) {
  // margins outside the world
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a2112';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const z = camera.zoom;
  ctx.setTransform(dpr * z, 0, 0, dpr * z,
    dpr * (cw / 2 - camera.x * z), dpr * (ch / 2 - camera.y * z));

  drawTerrain(ctx, camera.x, camera.y, cw / z, ch / z);

  // flush new decals, then blit
  if (world.pendingDecals.length) {
    if (!world.decals) world.decals = [];
    for (const d of world.pendingDecals) {
      paintDecal(d);
      world.decals.push(d);
    }
    // A very long artillery campaign should not grow the save indefinitely.
    if (world.decals.length > 5000) world.decals.splice(0, world.decals.length - 5000);
    world.pendingDecals.length = 0;
  }
  ctx.drawImage(decalCanvas, 0, 0);

  // Ground-hugging powder bank, blood and debris litter, and projectile ground
  // shadows. These lie flat on the board, so they are drawn before anything
  // that stands on it and can therefore be occluded by it. Also runs the
  // effect-field decay and drift for the frame; cost is independent of unit
  // count.
  drawSmokeUnder(ctx, world, alpha);

  for (const resource of world.resources) {
    if (resource.alive && resource.amount > 0) drawResourceNode(resource);
  }

  const visibleBuildings = world.buildings.filter(building => building.alive)
    .sort((a, b) => a.y - b.y);
  for (const building of visibleBuildings) drawBuilding(building, world);

  drawResourceHover(resourceHover, z);

  if (placementPreview) {
    const def = BUILDING_TYPES[placementPreview.type];
    if (def) {
      ctx.save();
      ctx.translate(placementPreview.x, placementPreview.y);
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = placementPreview.valid ? '#78c878' : '#d35d50';
      ctx.fillRect(-def.w / 2, -def.h / 2, def.w, def.h);
      ctx.strokeStyle = placementPreview.valid ? '#b9efb9' : '#ffb0a7';
      ctx.lineWidth = 2 / z;
      ctx.strokeRect(-def.w / 2, -def.h / 2, def.w, def.h);
      ctx.restore();
    }
  }

  drawMovePreview(movePreview, z, world.time);
  drawOrderFlags(ctx, world);

  // visible-unit list, sorted by y for correct overlap
  const viewHalfW = cw / 2 / z + 40, viewHalfH = ch / 2 / z + 40;
  sortBuf.length = 0;
  for (const u of world.units) {
    if (!u.alive) continue;
    if (Math.abs(u.x - camera.x) > viewHalfW || Math.abs(u.y - camera.y) > viewHalfH) continue;
    sortBuf.push(u);
  }
  sortBuf.sort((a, b) => a.y - b.y);

  // Selection rings go under the sprites so they read as marks on the ground.
  drawSelection(ctx, sortBuf, alpha);

  for (const u of sortBuf) {
    const sp = sprites[u.side][u.type];
    const ix = u.px + (u.x - u.px) * alpha;
    const iy = u.py + (u.y - u.py) * alpha;
    let frame;
    if (u.type === 'gun') {
      frame = u.fireT > 0 ? 1 : 0;
    } else if (u.type === 'villager') {
      frame = getWorkerFrame(u);
    } else if (u.moving) {
      frame = 1 + (((u.animT * 6) | 0) % 2);
    } else if (u.fireT > 0) {
      frame = 3;
    } else {
      frame = 0;
    }
    const dir = u.facing >= 0 ? 0 : 1;
    ctx.drawImage(sp.frames[dir][frame], ix - sp.ax, iy - sp.ay, sp.w, sp.h);
  }

  // Projectiles, powder smoke, muzzle flash, blood and dust.
  drawEffects(ctx, world, alpha);

  // Health bars sit above the sprites, still in world space.
  drawHealthBars(ctx, sortBuf, alpha, sprites);

  // Atmosphere: aerial haze, warm/cool grade, vignette. Screen space, and its
  // cost does not scale with the number of units.
  drawLightingPass(ctx, cw, ch, dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawDragRect(ctx, dragRect);

  drawMinimap(world);
}

let mmT = 0;
