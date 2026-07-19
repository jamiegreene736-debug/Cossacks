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





function buildNationSprites(nationKey, side = 0) {
  // The painters read an optional `rim` (side colour) and `headgear` off nat.
  const nat = { ...NATIONS[nationKey], rim: SIDE_RIM[side] };
  const out = {};

  const defs = {
    villager: { w: VL_W, h: VL_H, ax: VL_AX, ay: VL_AY, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['work', 0],
    ], painter: (g, pose, leg) => drawWorker(g, nat, pose, leg) },
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
    for (const [pose, leg] of def.frames) {
      const [c, g] = frameCanvas(def.w, def.h);
      def.painter(g, pose, leg);
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

export function draw(world, alpha, dragRect, placementPreview = null, resourceHover = null) {
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
    } else if (u.type === 'villager' && u.state === 'work') {
      frame = 3;
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
