// Rendering: procedurally drawn sprite atlases (no image files), terrain and
// corpse-decal offscreen canvases, camera transform, effects, minimap.

import { WORLD, NATIONS, BUILDING_TYPES } from './config.js';
import { buildTerrain, drawTerrain, drawTree, buildMinimapTerrain } from './gfx/terrain.js';
import { drawSoldier, INF_W, INF_H, INF_AX, INF_AY } from './gfx/infantry.js';
import { setDecalCtx, buildDecalStamps, paintDecal } from './gfx/decals.js';
import { setEffectsCamera, setEffectsView, buildParticleTextures,
         drawEffects } from './gfx/effects.js';
import { getTerrainCanvas } from './gfx/terrain.js';
import { getTrampleCanvas } from './gfx/decals.js';
import { drawCavalry, drawCannon } from './gfx/mounted.js';
import { drawWorker, VL_W, VL_H, VL_AX, VL_AY } from './gfx/villager.js';
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
  buildTerrain();
  decalCanvas = document.createElement('canvas');
  decalCanvas.width = WORLD.w;
  decalCanvas.height = WORLD.h;
  decalCtx = decalCanvas.getContext('2d');
  setDecalCtx(decalCtx);
  buildDecalStamps(world);
  buildParticleTextures();
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

function seeded(seed, index) {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function drawResourceNode(resource) {
  const fade = Math.max(0.25, resource.amount / resource.maxAmount);
  ctx.save();
  ctx.translate(resource.x, resource.y);
  ctx.globalAlpha = 0.55 + fade * 0.45;
  if (resource.type === 'wood') {
    for (let i = 0; i < 13; i++) {
      const angle = seeded(resource.seed, i) * Math.PI * 2;
      const distance = Math.sqrt(seeded(resource.seed, i + 30)) * resource.radius * 0.75;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance * 0.62;
      const r = 8 + seeded(resource.seed, i + 50) * 8;
      ctx.fillStyle = 'rgba(21,31,17,0.3)';
      ctx.beginPath(); ctx.ellipse(x + 4, y + 6, r, r * 0.42, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#604326'; ctx.fillRect(x - 1.6, y - 1, 3.2, 13);
      ctx.fillStyle = i % 2 ? '#315b35' : '#3f6c3d';
      ctx.beginPath(); ctx.arc(x, y - 5, r, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(117,150,72,0.42)';
      ctx.beginPath(); ctx.arc(x - r * 0.28, y - 8, r * 0.56, 0, 7); ctx.fill();
    }
  } else if (resource.type === 'food') {
    for (let i = 0; i < 18; i++) {
      const angle = seeded(resource.seed, i) * Math.PI * 2;
      const distance = Math.sqrt(seeded(resource.seed, i + 20)) * resource.radius * 0.8;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance * 0.65;
      ctx.fillStyle = '#315f31';
      ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill();
      ctx.fillStyle = i % 3 ? '#a43b38' : '#d4ba4d';
      ctx.beginPath(); ctx.arc(x - 2, y - 2, 1.2, 0, 7); ctx.arc(x + 2, y, 1.1, 0, 7); ctx.fill();
    }
  } else {
    const gold = resource.type === 'gold';
    ctx.fillStyle = 'rgba(24,20,16,0.25)';
    ctx.beginPath(); ctx.ellipse(3, 11, resource.radius * 0.82, resource.radius * 0.34, 0, 0, 7); ctx.fill();
    for (let i = 0; i < 12; i++) {
      const angle = seeded(resource.seed, i) * Math.PI * 2;
      const distance = Math.sqrt(seeded(resource.seed, i + 20)) * resource.radius * 0.68;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance * 0.5;
      const size = 6 + seeded(resource.seed, i + 40) * 10;
      ctx.fillStyle = gold ? (i % 3 ? '#8b7540' : '#c29b35') : (i % 3 ? '#777a73' : '#a0a093');
      ctx.beginPath();
      ctx.moveTo(x - size, y + size * 0.45);
      ctx.lineTo(x - size * 0.5, y - size * 0.55);
      ctx.lineTo(x + size * 0.4, y - size * 0.75);
      ctx.lineTo(x + size, y + size * 0.4);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawFarm(building) {
  const w = building.w, h = building.h;
  ctx.fillStyle = '#795e32';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = '#b08b48';
  ctx.lineWidth = 2;
  for (let x = -w / 2 + 8; x < w / 2; x += 9) {
    ctx.beginPath(); ctx.moveTo(x, -h / 2 + 4); ctx.lineTo(x + 8, h / 2 - 4); ctx.stroke();
  }
  ctx.strokeStyle = '#4e3b22';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#d1b454';
  for (let i = 0; i < 20; i++) {
    const x = -w / 2 + 6 + (i * 17) % (w - 12);
    const y = -h / 2 + 8 + (i * 23) % (h - 16);
    ctx.fillRect(x, y, 1, 4);
  }
}

function drawFoundation(building) {
  const w = building.w, h = building.h;
  ctx.fillStyle = '#7b674b';
  ctx.beginPath(); ctx.ellipse(0, 5, w * 0.54, h * 0.42, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#9c8b73';
  const wallH = h * 0.28 * building.progress;
  ctx.fillRect(-w * 0.42, -wallH + 8, w * 0.84, wallH);
  ctx.strokeStyle = '#604326';
  ctx.lineWidth = 2;
  for (const x of [-w * 0.43, w * 0.43]) {
    ctx.beginPath(); ctx.moveTo(x, 13); ctx.lineTo(x, -h * 0.55); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-w * 0.5, -h * 0.3); ctx.lineTo(w * 0.5, -h * 0.3); ctx.stroke();
}

function drawCompleteBuilding(building, nation) {
  const def = BUILDING_TYPES[building.type];
  const w = building.w, h = building.h;
  if (building.type === 'farm') { drawFarm(building); return; }

  ctx.fillStyle = 'rgba(23,20,16,0.28)';
  ctx.beginPath(); ctx.ellipse(5, 12, w * 0.54, h * 0.28, 0, 0, 7); ctx.fill();

  if (building.type === 'tower') {
    ctx.fillStyle = '#a99b82';
    ctx.fillRect(-w * 0.34, -h * 0.78, w * 0.68, h * 0.88);
    ctx.fillStyle = '#706653';
    for (let x = -w * 0.38; x <= w * 0.26; x += w * 0.22) ctx.fillRect(x, -h * 0.88, w * 0.14, h * 0.18);
    ctx.fillStyle = '#20251f'; ctx.fillRect(-4, -h * 0.48, 8, 14);
    ctx.strokeStyle = '#393a34'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -h * 0.72); ctx.lineTo(building.side === 0 ? 21 : -21, -h * 0.87); ctx.stroke();
  } else {
    const wall = building.type === 'lumber_camp' ? '#705439'
      : building.type === 'stable' ? '#8a7658' : '#b4a58d';
    const bodyTop = building.type === 'town_center' ? -h * 0.62 : -h * 0.5;
    ctx.fillStyle = wall;
    ctx.fillRect(-w * 0.44, bodyTop, w * 0.88, h * 0.62);
    ctx.fillStyle = 'rgba(255,248,218,0.16)';
    ctx.fillRect(-w * 0.38, bodyTop + 5, w * 0.09, h * 0.45);
    ctx.fillStyle = '#3b2d22';
    ctx.fillRect(-8, bodyTop + h * 0.28, 16, h * 0.34);
    ctx.fillStyle = '#314457';
    for (const x of [-w * 0.28, w * 0.25]) ctx.fillRect(x - 4, bodyTop + h * 0.2, 8, 10);

    if (nation === 'ottoman' && (building.type === 'town_center' || building.type === 'mill')) {
      ctx.fillStyle = NATIONS[nation].roof;
      ctx.beginPath(); ctx.arc(0, bodyTop + 2, w * 0.38, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#d7b64b';
      ctx.fillRect(-1, bodyTop - w * 0.38 - 8, 2, 10);
      ctx.beginPath(); ctx.arc(3, bodyTop - w * 0.38 - 7, 4, Math.PI / 2, Math.PI * 1.5); ctx.fill();
    } else {
      ctx.fillStyle = NATIONS[nation].roof;
      ctx.beginPath();
      ctx.moveTo(-w * 0.53, bodyTop + 2);
      ctx.lineTo(0, bodyTop - h * 0.43);
      ctx.lineTo(w * 0.53, bodyTop + 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#303b45'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    if (building.type === 'town_center') {
      // A portico, upper hall and steps keep the starting landmark visually
      // distinct from ordinary houses even at the strategic zoom level.
      ctx.fillStyle = wall;
      ctx.fillRect(-w * 0.21, bodyTop - h * 0.22, w * 0.42, h * 0.28);
      ctx.fillStyle = nation === 'ottoman' ? '#285b51' : '#425363';
      ctx.fillRect(-w * 0.17, bodyTop - h * 0.17, w * 0.34, 9);
      ctx.fillStyle = '#d1c2a2';
      for (const x of [-w * 0.16, w * 0.16]) ctx.fillRect(x - 2.5, bodyTop + h * 0.2, 5, h * 0.35);
      ctx.fillStyle = '#6e604a';
      ctx.fillRect(-18, bodyTop + h * 0.53, 36, 4);
      ctx.fillRect(-23, bodyTop + h * 0.59, 46, 4);
      ctx.fillStyle = '#e5d7ac';
      ctx.beginPath(); ctx.arc(0, bodyTop - h * 0.08, 6, 0, 7); ctx.fill();
      ctx.strokeStyle = '#5c5039'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, bodyTop - h * 0.08, 6, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, bodyTop - h * 0.08); ctx.lineTo(3, bodyTop - h * 0.12); ctx.stroke();
    } else if (building.type === 'barracks') {
      ctx.strokeStyle = '#5a4028'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-18, bodyTop + h * 0.48); ctx.lineTo(18, bodyTop + h * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(18, bodyTop + h * 0.48); ctx.lineTo(-18, bodyTop + h * 0.1); ctx.stroke();
      ctx.strokeStyle = '#c7c9c3'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(15, bodyTop + h * 0.13); ctx.lineTo(21, bodyTop + h * 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-15, bodyTop + h * 0.13); ctx.lineTo(-21, bodyTop + h * 0.05); ctx.stroke();
    } else if (building.type === 'stable') {
      ctx.fillStyle = '#3c2d22';
      ctx.beginPath(); ctx.arc(0, bodyTop + h * 0.48, 13, Math.PI, 0); ctx.fill();
      ctx.fillRect(-13, bodyTop + h * 0.48, 26, h * 0.2);
      ctx.strokeStyle = '#785b35'; ctx.lineWidth = 2;
      for (let x = -w * 0.55; x <= w * 0.55; x += 14) {
        ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 22); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(-w * 0.6, 14); ctx.lineTo(w * 0.6, 14); ctx.stroke();
    } else if (building.type === 'foundry') {
      ctx.fillStyle = '#665644'; ctx.fillRect(w * 0.24, bodyTop - h * 0.33, 15, h * 0.48);
      ctx.fillStyle = '#373530'; ctx.fillRect(w * 0.22, bodyTop - h * 0.36, 19, 5);
      ctx.strokeStyle = '#3e4348'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-w * 0.15, bodyTop + h * 0.46); ctx.lineTo(-w * 0.46, bodyTop + h * 0.3); ctx.stroke();
      ctx.fillStyle = '#d27a34'; ctx.beginPath(); ctx.arc(9, bodyTop + h * 0.48, 5, 0, 7); ctx.fill();
    } else if (building.type === 'mill') {
      ctx.fillStyle = '#5d4931'; ctx.beginPath(); ctx.arc(w * 0.28, bodyTop + h * 0.32, 6, 0, 7); ctx.fill();
      ctx.strokeStyle = '#d2c294'; ctx.lineWidth = 3;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 2) {
        ctx.beginPath(); ctx.moveTo(w * 0.28, bodyTop + h * 0.32);
        ctx.lineTo(w * 0.28 + Math.cos(angle + 0.5) * 23, bodyTop + h * 0.32 + Math.sin(angle + 0.5) * 23); ctx.stroke();
      }
    } else if (building.type === 'lumber_camp') {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#745033' : '#8a6139';
        ctx.fillRect(-w * 0.42 + i * 13, 7 + (i % 2) * 4, 22, 7);
        ctx.fillStyle = '#b08a57'; ctx.beginPath(); ctx.arc(-w * 0.42 + i * 13 + 21, 10.5 + (i % 2) * 4, 3.5, 0, 7); ctx.fill();
      }
    } else if (building.type === 'mine') {
      ctx.strokeStyle = '#514b3f'; ctx.lineWidth = 2;
      ctx.strokeRect(-18, 5, 31, 13);
      ctx.beginPath(); ctx.arc(-11, 20, 5, 0, 7); ctx.arc(7, 20, 5, 0, 7); ctx.stroke();
      ctx.fillStyle = '#b99535';
      ctx.beginPath(); ctx.moveTo(-16, 5); ctx.lineTo(-5, -4); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill();
    } else if (building.type === 'house') {
      ctx.fillStyle = '#5a4c3d'; ctx.fillRect(w * 0.24, bodyTop - h * 0.3, 8, h * 0.34);
    }
  }

  // Flags make ownership readable even when national architecture shares a
  // material palette.
  if (building.type === 'town_center' || building.type === 'barracks' || building.type === 'foundry') {
    const flagX = building.side === 0 ? -w * 0.34 : w * 0.34;
    ctx.strokeStyle = '#493621'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(flagX, -h * 0.42); ctx.lineTo(flagX, -h * 0.92); ctx.stroke();
    ctx.fillStyle = NATIONS[nation].coat;
    ctx.beginPath(); ctx.moveTo(flagX, -h * 0.9); ctx.lineTo(flagX + (building.side === 0 ? 18 : -18), -h * 0.82);
    ctx.lineTo(flagX, -h * 0.75); ctx.closePath(); ctx.fill();
  }

  if (def.trains && building.queue.length) {
    const progress = 1 - building.queue[0].remaining / building.queue[0].total;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(-w * 0.38, 17, w * 0.76, 4);
    ctx.fillStyle = '#d1b454'; ctx.fillRect(-w * 0.38, 17, w * 0.76 * progress, 4);
  }
}

function drawBuilding(building, world) {
  ctx.save();
  ctx.translate(building.x, building.y);
  if (building.selected) {
    ctx.strokeStyle = 'rgba(145,235,145,0.9)';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.beginPath(); ctx.ellipse(0, 5, building.radius, building.radius * 0.48, 0, 0, 7); ctx.stroke();
  }
  if (building.complete) drawCompleteBuilding(building, world.sides[building.side].nation);
  else drawFoundation(building);
  if (building.selected || building.hp < building.maxHp || !building.complete) {
    const width = Math.min(90, building.w * 0.75);
    const y = -building.h * 0.82 - 10;
    const fraction = building.complete ? building.hp / building.maxHp : building.progress;
    ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(-width / 2, y, width, 5);
    ctx.fillStyle = building.complete ? (fraction > 0.5 ? '#6ec36e' : '#d3674e') : '#d1b454';
    ctx.fillRect(-width / 2, y, width * Math.max(0, fraction), 5);
  }
  ctx.restore();
}

// ---------- Frame draw ----------

const sortBuf = [];

export function draw(world, alpha, dragRect, placementPreview = null) {
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
    for (const d of world.pendingDecals) paintDecal(d);
    world.pendingDecals.length = 0;
  }
  ctx.drawImage(decalCanvas, 0, 0);

  for (const resource of world.resources) {
    if (resource.alive && resource.amount > 0) drawResourceNode(resource);
  }

  const visibleBuildings = world.buildings.filter(building => building.alive)
    .sort((a, b) => a.y - b.y);
  for (const building of visibleBuildings) drawBuilding(building, world);

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

