// Rendering: procedural sprite atlases plus selected production building art,
// terrain and corpse-decal canvases, camera transform, effects, and minimap.

import { WORLD, NATIONS, UNIT_TYPES, BUILDING_TYPES } from './config.js';
import { buildTerrain, drawTerrain, drawTree, buildMinimapTerrain } from './gfx/terrain.js';
import { drawSoldier, INF_W, INF_H, INF_AX, INF_AY } from './gfx/infantry.js';
import {
  setDecalCtx, buildDecalStamps, paintDecal, decalOpacity, isDecalExpired,
} from './gfx/decals.js';
import { setEffectsCamera, setEffectsView, buildParticleTextures,
         resetEffectFields, fxNoteDecal, drawSmokeUnder, drawBuildingFires,
         drawEffects } from './gfx/effects.js';
import { getTerrainCanvas } from './gfx/terrain.js';
import { getTrampleCanvas } from './gfx/decals.js';
import { drawCavalry, drawCannon } from './gfx/mounted.js';
import { drawWorker, VL_W, VL_H, VL_AX, VL_AY } from './gfx/villager.js';
import {
  MILITARY_ART_ROWS,
  MILITARY_ART_SPECS,
  VILLAGER_COMBAT_ART_SPEC,
  VILLAGER_CARRY_ART_SPECS,
  WOMAN_VILLAGER_ART_SPECS,
  WOMAN_VILLAGER_CANNON_ART_SPEC,
  FACTION_CHARACTER_ART_SPECS,
  getProductionArt,
  getProductionFrameSlice,
} from './gfx/art-assets.js';
import { fortificationCorners, isFortificationType } from './fortifications.js';
import { getWomanVillagerFrame, getWorkerFrame } from './worker-animation.js';
import { getMilitaryFrame } from './military-animation.js';
import { getCharacterMotion } from './character-animation.js';
import {
  chooseRenderDpr, circleIntersectsBounds, getVisibleWorldBounds,
} from './render-performance.js';
import {
  clampCameraZoom, normalizeViewRotation, rotatedViewHalfExtents, screenPointToWorld,
  screenVectorToWorld, stepCameraZoom, turnView as nextViewRotation,
  viewMirrorsHorizontalFacing, worldViewDepth,
} from './camera.js';
import { playerTeam } from './teams.js';
import { setBuildingRefs, bdResetCaches, drawResourceNode, drawFarm,
         drawFarmForeground, drawFoundation, drawCompleteBuilding, drawBuilding,
         drawBuildingCollapse } from './gfx/buildings.js';
import { setCompositeRefs, setCompositeView, setCompositeTrampleLayer,
         buildCompositeTextures, buildMinimapBase, drawLightingPass,
         drawTowerAttackRanges, drawSelection, drawHealthBars, drawOrderFlags, drawDragRect,
         drawMinimap } from './gfx/composite.js';

const SCALE = 4; // sprite atlas oversampling — 4 keeps figures crisp at 2.4x zoom

// Reserved side colours. These appear nowhere else in the world, so side
// identity survives even a mirror matchup (England vs England).
const SIDE_RIM = ['#3E78B8', '#B8483E', '#4FAE8B', '#C67A2F', '#7365D6'];
const PRODUCTION_WORKER = Object.freeze({
  w: 38, h: 44, ax: 19, ay: 36.5, sourceW: 384, sourceH: 448,
});
const PRODUCTION_WORKER_ART = Object.freeze({
  england: 'englishVillager',
  ottoman: 'ottomanVillager',
});

export const camera = { x: 660, y: WORLD.h / 2, zoom: 0.9, rotation: 0 };

let canvas, ctx, mmCanvas, mmCtx;
let cw = 0, ch = 0, dpr = 1;
let decalCanvas = null, decalCtx = null;
let nextDecalFadeRepaintAt = 0;
let mmTerrain = null;
let sprites = null; // sprites[side][type] = {frames: [dir][frame], w,h,ax,ay}
const buildingSortBuf = [];
let victoryRainbowKey = '';
let victoryRainbowStartedAt = 0;

function drawVictoryRainbow(world) {
  const active = world?.state === 'ended' && world.winner === playerTeam(world);
  if (!active) {
    victoryRainbowKey = '';
    victoryRainbowStartedAt = 0;
    return;
  }
  const key = `${world.winner}:${Math.round(world.time * 10)}`;
  if (victoryRainbowKey !== key) {
    victoryRainbowKey = key;
    victoryRainbowStartedAt = performance.now();
  }
  const age = (performance.now() - victoryRainbowStartedAt) / 1000;
  const appear = Math.min(1, age / 0.38);
  const ease = 1 - Math.pow(1 - appear, 3);
  const shimmer = 0.5 + Math.sin(age * 4.7) * 0.5;
  const cx = cw * 0.50;
  const cy = ch * 1.10;
  const baseRadius = Math.max(cw * 0.42, Math.min(cw * 0.78, ch * 0.96));
  const bands = [
    ['#e74d4d', 0],
    ['#f28b2f', 1],
    ['#f4d553', 2],
    ['#6dcf67', 3],
    ['#54a8f0', 4],
    ['#7057d8', 5],
  ];

  ctx.save();
  ctx.globalAlpha = 0.18 * ease;
  ctx.globalCompositeOperation = 'lighter';
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, 'rgba(107,153,211,0.30)');
  sky.addColorStop(0.42, 'rgba(255,234,174,0.18)');
  sky.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);

  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.55)';
  ctx.shadowBlur = 18 + shimmer * 10;
  for (const [color, index] of bands) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = (0.72 - index * 0.035) * ease;
    ctx.lineWidth = Math.max(10, Math.min(26, cw * 0.014));
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius - index * ctx.lineWidth * 1.08, Math.PI + 0.05, Math.PI * 2 - 0.05);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.56 * ease;
  ctx.strokeStyle = 'rgba(255,247,214,0.62)';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 18; i++) {
    const a = Math.PI + 0.18 + i / 17 * (Math.PI - 0.36);
    const r0 = baseRadius * 0.60;
    const r1 = baseRadius * (0.92 + 0.04 * Math.sin(age * 2 + i));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  const cloud = (x, y, scale) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = 0.86 * ease;
    ctx.fillStyle = 'rgba(255,248,223,0.90)';
    ctx.strokeStyle = 'rgba(181,197,213,0.42)';
    ctx.lineWidth = 1.2;
    for (const [px, py, rx, ry] of [
      [-42, 10, 34, 19], [-18, -3, 37, 25], [18, -8, 42, 28], [50, 7, 34, 19],
      [3, 12, 68, 22],
    ]) {
      ctx.beginPath();
      ctx.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  };
  cloud(cx - baseRadius * 0.97, cy - 16, Math.max(0.62, Math.min(1.1, cw / 1450)));
  cloud(cx + baseRadius * 0.97, cy - 16, Math.max(0.62, Math.min(1.1, cw / 1450)));

  ctx.globalAlpha = 0.74 * ease;
  for (let i = 0; i < 34; i++) {
    const a = Math.PI + 0.10 + ((i * 0.618) % 1) * (Math.PI - 0.20);
    const r = baseRadius * (0.58 + ((i * 37) % 31) / 100);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r + Math.sin(age * 3 + i) * 6;
    const size = 1.6 + ((i * 11) % 5) * 0.38;
    ctx.fillStyle = i % 3 === 0 ? '#fff7ce' : i % 3 === 1 ? '#cbeeff' : '#ffe2f1';
    ctx.beginPath();
    ctx.moveTo(x, y - size * 2);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size * 2);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawThrowingTorch(unit, x, y, visualFacing = unit.facing) {
  if (!(unit.torchT > 0)) return;
  const facing = visualFacing >= 0 ? 1 : -1;
  const progress = Math.max(0, Math.min(1, 1 - unit.torchT / 0.48));
  const mounted = unit.type === 'cav';
  const shoulderX = x + facing * (mounted ? 3 : 1);
  const shoulderY = y - (mounted ? 20 : 18);
  const reach = 7 + Math.sin(progress * Math.PI) * 8;
  const handX = shoulderX + facing * reach;
  const handY = shoulderY - 5 - Math.sin(progress * Math.PI) * 6;
  const headX = handX + facing * 8;
  const headY = handY - 7;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = SIDE_RIM[unit.side] || '#873936';
  ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(shoulderX, shoulderY); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.strokeStyle = '#8B5A2B';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(handX - facing * 3, handY + 3); ctx.lineTo(headX, headY); ctx.stroke();
  ctx.strokeStyle = '#241711';
  ctx.lineWidth = 4.4;
  ctx.beginPath(); ctx.moveTo(headX - facing * 2.5, headY + 2); ctx.lineTo(headX + facing * 2.5, headY - 2); ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = '#FF7A20';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#E64A16';
  ctx.beginPath();
  ctx.moveTo(headX - 4, headY); ctx.quadraticCurveTo(headX, headY - 12, headX + 4, headY - 2);
  ctx.quadraticCurveTo(headX + 5, headY + 4, headX, headY + 5);
  ctx.quadraticCurveTo(headX - 5, headY + 3, headX - 4, headY); ctx.fill();
  ctx.fillStyle = '#FFE08A';
  ctx.beginPath(); ctx.ellipse(headX, headY, 2.1, 4.2, 0.3 * facing, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawStarWarsEnergyBlade(unit, visualFacing = unit.facing) {
  if (unit.unitType !== 'starwars_blade_guard' || !(unit.fireT > 0)) return;
  const facing = visualFacing >= 0 ? 1 : -1;
  const attack = Math.max(0, Math.min(1, 1 - unit.fireT / 0.12));
  const pivotX = facing * 2;
  const pivotY = -23;
  const startAngle = facing > 0 ? -2.35 : Math.PI + 2.35;
  const endAngle = facing > 0 ? 0.32 : Math.PI - 0.32;
  const currentAngle = startAngle + (endAngle - startAngle) * attack;
  const bladeLength = 31;
  const tipX = pivotX + Math.cos(currentAngle) * bladeLength;
  const tipY = pivotY + Math.sin(currentAngle) * bladeLength;
  const fade = 0.68 + Math.sin(attack * Math.PI) * 0.32;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.17 * fade;
  ctx.strokeStyle = '#278dff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, bladeLength, startAngle, currentAngle, facing < 0);
  ctx.stroke();
  ctx.globalAlpha = 0.5 * fade;
  ctx.strokeStyle = '#4ed8ff';
  ctx.lineWidth = 3.8;
  ctx.stroke();
  ctx.globalAlpha = 0.92 * fade;
  ctx.strokeStyle = '#f6ffff';
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.globalAlpha = 0.34 * fade;
  ctx.strokeStyle = '#2da8ff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(pivotX, pivotY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.globalAlpha = 0.98 * fade;
  ctx.strokeStyle = '#f8ffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// ---------- Setup ----------

export function initRender(gameCanvas, minimapCanvas) {
  canvas = gameCanvas;
  ctx = canvas.getContext('2d', { alpha: false });
  mmCanvas = minimapCanvas;
  mmCtx = mmCanvas.getContext('2d');
  setEffectsCamera(camera);
  setCompositeRefs({ camera, mmCanvas, mmCtx });
  setBuildingRefs({ ctx, camera });
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  dpr = chooseRenderDpr(window.devicePixelRatio);
  cw = window.innerWidth;
  ch = window.innerHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.dataset.renderScale = String(dpr);
  setEffectsView(cw, ch);
  setCompositeView(cw, ch, dpr);
  buildCompositeTextures();   // grade/vignette gradients are viewport-sized
}

export function getViewSize() { return { w: cw, h: ch }; }

export function screenToWorld(sx, sy) {
  return screenPointToWorld(camera, cw, ch, sx, sy);
}

export function screenPanToWorld(dx, dy) {
  return screenVectorToWorld(camera, dx, dy);
}

export function rotateView(direction) {
  camera.rotation = nextViewRotation(camera.rotation, direction);
  clampCamera();
  return camera.rotation;
}

export function zoomView(direction) {
  camera.zoom = stepCameraZoom(camera.zoom, direction);
  clampCamera();
  return camera.zoom;
}

export function clampCamera() {
  camera.zoom = clampCameraZoom(camera.zoom);
  const extents = rotatedViewHalfExtents(camera, cw, ch);
  const halfW = extents.x, halfH = extents.y;
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
  nextDecalFadeRepaintAt = 0;
  redrawDecalCanvas(world);
  buildParticleTextures();
  resetEffectFields();   // so a rematch does not inherit last game's powder
  sprites = world.sides.map((side, sideIndex) => buildNationSprites(side.nation, sideIndex));
  mmTerrain = buildMinimapTerrain(mmCanvas.width, mmCanvas.height);
  setCompositeRefs({ mmTerrain });
  setCompositeTrampleLayer(getTrampleCanvas());
  buildMinimapBase(getTerrainCanvas());
  const townCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  camera.x = townCenter?.x || 660;
  camera.y = townCenter?.y || WORLD.h / 2;
  camera.zoom = Math.max(0.62, Math.min(1.15, ch / 1050));
  camera.rotation = 0;
  clampCamera();
}

function redrawDecalCanvas(world) {
  if (!decalCtx) return;
  decalCtx.clearRect(0, 0, WORLD.w, WORLD.h);
  for (const decal of world.decals || []) {
    paintDecal(decal, { opacity: decalOpacity(decal, world.time), stampWear: false });
  }
}

function updateTimedDecals(world) {
  if (!world?.decals?.length) return;
  const now = Number.isFinite(world.time) ? world.time : 0;
  let removed = false;
  let fading = false;
  const kept = [];
  for (const decal of world.decals) {
    if (isDecalExpired(decal, now)) {
      removed = true;
      continue;
    }
    if (decalOpacity(decal, now) < 1) fading = true;
    kept.push(decal);
  }
  if (removed) world.decals = kept;
  if (removed || (fading && now >= nextDecalFadeRepaintAt)) {
    redrawDecalCanvas(world);
    nextDecalFadeRepaintAt = now + 1;
  } else if (!fading) {
    nextDecalFadeRepaintAt = now + 1;
  }
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

function paintProductionMilitaryBase(g, def, side) {
  g.save();
  g.translate(def.w / 2, def.ay - 0.35);
  g.fillStyle = 'rgba(27,30,42,0.42)';
  g.beginPath();
  g.ellipse(0, 0, def.baseRadiusX, def.baseRadiusY, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = SIDE_RIM[side];
  g.lineWidth = 1.15;
  g.globalAlpha = 0.92;
  g.stroke();
  g.restore();
}

function withProductionMilitaryArt(type, nationKey, fallback) {
  const spec = MILITARY_ART_SPECS[type];
  const image = spec ? getProductionArt(spec.key) : null;
  const walkImage = spec?.walk ? getProductionArt(spec.walk.key) : null;
  const sourceRow = MILITARY_ART_ROWS[nationKey] ?? 0;
  if (!spec || !image || sourceRow === undefined) return fallback;

  return {
    ...fallback,
    w: spec.w,
    h: spec.h,
    ax: spec.ax,
    ay: spec.ay,
    baseRadiusX: spec.baseRadiusX,
    baseRadiusY: spec.baseRadiusY,
    military: true,
    production: {
      image,
      sourceW: spec.sourceW,
      sourceH: spec.sourceH,
      sourceRow,
      frameXBounds: spec.frameXBounds?.[nationKey],
    },
    walkProduction: walkImage ? {
      image: walkImage,
      sourceW: spec.walk.sourceW,
      sourceH: spec.walk.sourceH,
      sourceRow,
    } : null,
  };
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

function paintFallbackWorkerMusket(g, phase, w, h) {
  const aim = phase === 'fire';
  const reload = phase === 'reload';
  const y = aim ? h * 0.39 : reload ? h * 0.45 : h * 0.57;
  const x0 = reload ? w * 0.41 : w * 0.18;
  const x1 = reload ? w * 0.73 : w * 0.91;
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = '#211810';
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(x0, y + (reload ? 5 : 1.4));
  g.lineTo(x1, y - (reload ? 12 : 1.4));
  g.stroke();
  g.strokeStyle = '#795331';
  g.lineWidth = 1.35;
  g.stroke();
  g.strokeStyle = '#b7b9b1';
  g.lineWidth = 0.65;
  g.beginPath();
  g.moveTo(reload ? w * 0.5 : w * 0.46, y - (reload ? 2 : 0.3));
  g.lineTo(x1 + (reload ? 0 : 2), y - (reload ? 14 : 1.8));
  g.stroke();
  g.restore();
}

function paintFallbackWomanWorker(g, nat, pose, leg, action) {
  drawWorker(g, nat, pose, leg, action);
}

function paintFallbackWomanCannon(g, nat, pose, side) {
  g.save();
  g.translate(3, 20);
  drawWorker(g, nat, pose === 'deploy' ? 'idle' : 'work', pose === 'fire' ? 1 : 0, 'build');
  g.restore();
  g.save();
  g.translate(34, 24);
  drawCannon(g, nat, pose === 'fire' ? 'fire' : 'idle', side);
  g.restore();
}

function buildFactionCharacterDefs(nationKey, side, nat) {
  const spec = FACTION_CHARACTER_ART_SPECS[nationKey];
  const image = spec ? getProductionArt(spec.key) : null;
  if (!spec || !image) return {};
  const defs = {};
  const normalizeScale = nationKey === 'hogwarts' || nationKey === 'starwars';
  for (const [unitType, sourceRow] of Object.entries(spec.unitRows)) {
    const worker = Boolean(UNIT_TYPES[unitType]?.worker);
    const isGhost = unitType === 'moaning_myrtle';
    const isHeavy = unitType === 'killer_klown' || unitType === 'starwars_pulse_cannon';
    const isMounted = unitType === 'starwars_skiff_rider';
    const frame = normalizeScale
      ? worker ? PRODUCTION_WORKER
        : isHeavy ? MILITARY_ART_SPECS.gun
          : isMounted ? MILITARY_ART_SPECS.cav
            : MILITARY_ART_SPECS.musk
      : null;
    const w = frame?.w ?? (isHeavy ? 78 : isMounted ? 72 : isGhost ? 68 : 58);
    const h = frame?.h ?? (isHeavy ? 66 : isMounted ? 62 : isGhost ? 64 : 62);
    const ax = frame?.ax ?? w / 2;
    const ay = frame?.ay ?? h - 5;
    const sourceFrames = getFactionCharacterFrameSources(unitType, worker);
    defs[unitType] = {
      w, h, ax, ay,
      military: !worker,
      baseRadiusX: frame?.baseRadiusX ?? (isHeavy ? 23 : 15),
      baseRadiusY: frame?.baseRadiusY ?? (isHeavy ? 4.2 : 3.1),
      production: {
        image, sourceW: spec.sourceW, sourceH: spec.sourceH, sourceRow,
      },
      frames: sourceFrames.map(sourceFrame => ['idle', 0, null, sourceFrame]),
      painter: worker
        ? (g, pose, leg, action) => drawWorker(g, nat, pose, leg, action)
        : (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'musk'),
    };
  }
  return defs;
}

export function getFactionCharacterFrameSources(unitType, worker = Boolean(UNIT_TYPES[unitType]?.worker)) {
  if (worker) {
    return [
      0,
      1, 0, 3, 1, 0, 3,
      3, 0, 3, 0, 3, 0, 3, 0, 3, 0,
      0, 1, 2, 3,
      1, 0, 3, 1, 1, 0, 3, 1,
    ];
  }
  // Artillery uses a two-frame runtime contract. Its second runtime frame must
  // address the authored firing column rather than the locomotion column.
  if (unitType === 'starwars_pulse_cannon') return [0, 2];
  return [0, 1, 0, 3, 1, 0, 3, 2];
}





function buildNationSprites(nationKey, side = 0) {
  // The painters read an optional `rim` (side colour) and `headgear` off nat.
  const nat = { ...NATIONS[nationKey], rim: SIDE_RIM[side] };
  const out = {};
  const productionWorker = getProductionArt(PRODUCTION_WORKER_ART[nationKey]);
  const productionWorkerCombat = getProductionArt(VILLAGER_COMBAT_ART_SPEC.key);
  const carryArtSpec = VILLAGER_CARRY_ART_SPECS[nationKey];
  const productionWorkerCarry = carryArtSpec ? getProductionArt(carryArtSpec.key) : null;
  const womanArtSpec = WOMAN_VILLAGER_ART_SPECS[nationKey];
  const productionWomanWorker = womanArtSpec ? getProductionArt(womanArtSpec.key) : null;
  const productionWomanCannon = getProductionArt(WOMAN_VILLAGER_CANNON_ART_SPEC.key);
  const workerFrames = [
    ['idle', 0, null, 0],
    ['idle', 1, null, 1], ['idle', 0, null, 0], ['idle', 2, null, 2],
    ['idle', 2, null, 2], ['idle', 0, null, 0], ['idle', 1, null, 1],
    ['build', 0, 'build', 3], ['build', 1, 'build', 0],
    ['work', 0, 'chop', 3], ['work', 1, 'chop', 0],
    ['work', 0, 'mine', 3], ['work', 1, 'mine', 0],
    ['work', 0, 'farm', 3], ['work', 1, 'farm', 0],
    ['work', 0, 'forage', 3], ['work', 1, 'forage', 0],
    ['combat', 0, 'ready', 0, 'combat'],
    ['combat', 1, 'advance', 1, 'combat'],
    ['combat', 0, 'fire', 2, 'combat'],
    ['combat', 0, 'reload', 3, 'combat'],
    ['carry', 1, null, 0, 'carry', 0],
    ['carry', 2, null, 1, 'carry', 0],
    ['carry', 1, null, 2, 'carry', 0],
    ['carry', 2, null, 3, 'carry', 0],
    ['carry', 1, null, 0, 'carry', 1],
    ['carry', 2, null, 1, 'carry', 1],
    ['carry', 1, null, 2, 'carry', 1],
    ['carry', 2, null, 3, 'carry', 1],
  ];
  const workerDefBase = productionWorker ? {
    w: PRODUCTION_WORKER.w,
    h: PRODUCTION_WORKER.h,
    ax: PRODUCTION_WORKER.ax,
    ay: PRODUCTION_WORKER.ay,
    production: {
      image: productionWorker,
      sourceW: PRODUCTION_WORKER.sourceW,
      sourceH: PRODUCTION_WORKER.sourceH,
      sourceRow: 0,
    },
    frames: workerFrames,
    painter: (g, pose, leg, action) => drawWorker(g, nat, pose, leg, action),
  } : {
    w: VL_W,
    h: VL_H,
    ax: VL_AX,
    ay: VL_AY,
    frames: workerFrames,
    painter: (g, pose, leg, action) => drawWorker(g, nat, pose, leg, action),
  };
  const workerDef = {
    ...workerDefBase,
    carryProduction: productionWorkerCarry ? {
      image: productionWorkerCarry,
      sourceW: carryArtSpec.sourceW,
      sourceH: carryArtSpec.sourceH,
      sourceRow: 0,
    } : null,
    combatProduction: productionWorkerCombat ? {
      image: productionWorkerCombat,
      sourceW: VILLAGER_COMBAT_ART_SPEC.sourceW,
      sourceH: VILLAGER_COMBAT_ART_SPEC.sourceH,
      sourceRow: MILITARY_ART_ROWS[nationKey] ?? 0,
    } : null,
  };
  const womanWorkerFrames = [
    ['idle', 0, null, 0],
    ['idle', 1, null, 1], ['idle', 0, null, 0], ['idle', 2, null, 2],
    ['idle', 2, null, 2], ['idle', 0, null, 0], ['idle', 1, null, 1],
    ['build', 0, 'build', 3],
    ['deploy', 0, null, 0, 'combat'],
    ['aim', 0, null, 1, 'combat'],
    ['fire', 0, null, 2, 'combat'],
    ['reload', 0, null, 3, 'combat'],
  ];
  const womanWorkerDef = {
    w: workerDefBase.w, h: workerDefBase.h, ax: workerDefBase.ax, ay: workerDefBase.ay,
    frames: womanWorkerFrames,
    cannonWorker: true,
    production: productionWomanWorker && womanArtSpec ? {
      image: productionWomanWorker,
      sourceW: womanArtSpec.sourceW,
      sourceH: womanArtSpec.sourceH,
      sourceRow: 0,
    } : null,
    combatProduction: productionWomanCannon ? {
      image: productionWomanCannon,
      sourceW: WOMAN_VILLAGER_CANNON_ART_SPEC.sourceW,
      sourceH: WOMAN_VILLAGER_CANNON_ART_SPEC.sourceH,
      sourceRow: MILITARY_ART_ROWS[nationKey] ?? 0,
    } : null,
    painter: (g, pose, leg, action) => paintFallbackWomanWorker(g, nat, pose, leg, action),
    combatPainter: (g, pose) => paintFallbackWomanCannon(g, nat, pose, side),
  };

  const proceduralDefs = {
    villager: workerDef,
    woman_villager: womanWorkerDef,
    musk: { w: INF_W, h: INF_H, ax: INF_AX, ay: INF_AY, frames: [
      ['idle', 0],
      ['idle', 0, null, 0, 'walk'], ['idle', 1, null, 1, 'walk'],
      ['idle', 2, null, 2, 'walk'], ['idle', 0, null, 3, 'walk'],
      ['idle', 1, null, 4, 'walk'], ['idle', 2, null, 5, 'walk'],
      ['fire', 0, null, 3],
    ], painter: (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'musk') },
    pike: { w: INF_W, h: INF_H, ax: INF_AX, ay: INF_AY, frames: [
      ['idle', 0],
      ['idle', 0, null, 0, 'walk'], ['idle', 1, null, 1, 'walk'],
      ['idle', 2, null, 2, 'walk'], ['idle', 0, null, 3, 'walk'],
      ['idle', 1, null, 4, 'walk'], ['idle', 2, null, 5, 'walk'],
      ['attack', 0, null, 3],
    ], painter: (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'pike') },
    // Boxes come from the mounted bounds audit: the painted geometry reaches
    // x=30.19 and x=39.54, so the old 23/27-wide boxes clipped the horse's
    // head and the gun's far crewman outright. Anchor is exactly w/2 so the
    // mirrored facing lines up.
    cav: { w: 33, h: 29, ax: 16.5, ay: 23.4, frames: [
      ['idle', 0],
      ['idle', 0, null, 0, 'walk'], ['idle', 1, null, 1, 'walk'],
      ['idle', 2, null, 2, 'walk'], ['idle', 0, null, 3, 'walk'],
      ['idle', 1, null, 4, 'walk'], ['idle', 2, null, 5, 'walk'],
      ['attack', 0, null, 3],
    ], painter: (g, pose, leg) => drawCavalry(g, nat, pose, leg, side) },
    gun: { w: 41, h: 29, ax: 20.5, ay: 23.4, frames: [
      ['idle', 0], ['fire', 0],
    ], painter: (g, pose) => drawCannon(g, nat, pose, side) },
  };
  const defs = {
    ...proceduralDefs,
    musk: withProductionMilitaryArt('musk', nationKey, proceduralDefs.musk),
    pike: withProductionMilitaryArt('pike', nationKey, proceduralDefs.pike),
    cav: withProductionMilitaryArt('cav', nationKey, proceduralDefs.cav),
    gun: withProductionMilitaryArt('gun', nationKey, proceduralDefs.gun),
    ...buildFactionCharacterDefs(nationKey, side, nat),
  };

  for (const [type, def] of Object.entries(defs)) {
    const right = [], left = [];
    for (let frameIndex = 0; frameIndex < def.frames.length; frameIndex++) {
      const [
        pose, leg, action = null, sourceFrame = frameIndex, sourceKind = 'default',
        sourceRowOffset = 0,
      ] = def.frames[frameIndex];
      const [c, g] = frameCanvas(def.w, def.h);
      let resolvedSourceFrame = sourceFrame;
      let resolvedSourceRowOffset = sourceRowOffset;
      let production = sourceKind === 'procedural' ? null : sourceKind === 'combat'
        ? def.combatProduction
        : sourceKind === 'walk' ? def.walkProduction
          : sourceKind === 'carry' ? def.carryProduction : def.production;
      // Carry art is an enhancement over the base detailed villager. If its
      // file fails independently, keep the production character and reuse the
      // two walking poses instead of changing style to the procedural body.
      if (sourceKind === 'carry' && !production && def.production) {
        production = def.production;
        resolvedSourceFrame = 1 + (sourceFrame % 2);
        resolvedSourceRowOffset = 0;
      }
      if (production) {
        if (def.military) paintProductionMilitaryBase(g, def, side);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        const slice = getProductionFrameSlice(
          production.sourceW,
          resolvedSourceFrame,
          production.frameXBounds,
          def.w,
        );
        g.drawImage(
          production.image,
          slice.sourceX,
          (production.sourceRow + resolvedSourceRowOffset) * production.sourceH,
          slice.sourceW, production.sourceH,
          slice.destX, 0, slice.destW, def.h,
        );
        if (!def.military && action && sourceKind !== 'combat') {
          paintProductionWorkerTool(g, nationKey, action, leg);
        }
      } else if (sourceKind === 'combat' && def.cannonWorker) {
        def.combatPainter(g, pose);
      } else if (sourceKind === 'combat' && def.production) {
        g.drawImage(
          def.production.image,
          0, def.production.sourceRow * def.production.sourceH,
          def.production.sourceW, def.production.sourceH,
          0, 0, def.w, def.h,
        );
        paintFallbackWorkerMusket(g, action, def.w, def.h);
      } else {
        def.painter(g, pose, leg, action);
        if (sourceKind === 'combat') paintFallbackWorkerMusket(g, action, def.w, def.h);
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

function drawAnimatedCharacterFrame(context, image, sprite, motion) {
  const left = -sprite.ax;
  const top = -sprite.ay;
  context.save();
  context.translate(motion.shiftX, motion.shiftY);
  context.rotate(motion.rotation);
  context.scale(motion.scaleX, motion.scaleY);

  if (!motion.articulateHead) {
    context.drawImage(image, left, top, sprite.w, sprite.h);
    context.restore();
    return;
  }

  const neckY = top + sprite.h * 0.31;
  context.save();
  context.beginPath();
  context.rect(left - 2, neckY - 1, sprite.w + 4, sprite.h - (neckY - top) + 3);
  context.clip();
  context.drawImage(image, left, top, sprite.w, sprite.h);
  context.restore();

  context.save();
  context.beginPath();
  context.rect(left - 3, top - 3, sprite.w + 6, neckY - top + 5);
  context.clip();
  context.translate(motion.headShiftX, neckY + motion.headShiftY);
  context.rotate(motion.headRotation);
  context.translate(0, -neckY);
  context.drawImage(image, left, top, sprite.w, sprite.h);
  context.restore();
  context.restore();
}

function drawResourceHover(target, zoom, kind = 'resource') {
  if (!target?.alive) return;
  const construction = target.entityKind === 'building' && !target.complete;
  const repair = kind === 'repair';
  if (kind !== 'attack' && !repair && !construction && target.amount <= 0) return;
  const colors = {
    food: ['#f4d58a', '#9fc96b'],
    wood: ['#d7e8a8', '#6fa455'],
    gold: ['#fff0a4', '#d0a23d'],
    stone: ['#e5e7df', '#9fa8a6'],
    construction: ['#fff0bb', '#d2a34d'],
    repair: ['#fff0bd', '#d1a83f'],
    attack: ['#ffd1c7', '#b74336'],
  };
  const [light, base] = kind === 'attack' ? colors.attack
    : repair ? colors.repair
      : construction ? colors.construction : colors[target.resourceType] || colors.food;
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
  if (kind === 'attack') {
    const cy = target.y + target.radius * 0.28;
    ctx.lineWidth = 2.4 / zoom;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = target.x + sx * (rx + 5 / zoom);
        const y = cy + sy * (ry + 4 / zoom);
        ctx.beginPath();
        ctx.moveTo(x - sx * 8 / zoom, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * 6 / zoom);
        ctx.stroke();
      }
    }
  } else if (repair) {
    const iconX = target.x + rx * 0.62;
    const iconY = target.y - ry * 0.76;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(22, 18, 12, 0.88)';
    ctx.lineWidth = 5.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(iconX - 6 / zoom, iconY + 7 / zoom);
    ctx.lineTo(iconX + 5 / zoom, iconY - 4 / zoom);
    ctx.stroke();
    ctx.strokeStyle = '#d5a54a';
    ctx.lineWidth = 2.4 / zoom;
    ctx.stroke();
    ctx.fillStyle = light;
    ctx.strokeStyle = 'rgba(22, 18, 12, 0.9)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(iconX + 1 / zoom, iconY - 8 / zoom);
    ctx.lineTo(iconX + 7 / zoom, iconY - 10 / zoom);
    ctx.lineTo(iconX + 12 / zoom, iconY - 5 / zoom);
    ctx.lineTo(iconX + 9 / zoom, iconY + 1 / zoom);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
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
  const attack = preview.kind === 'attack';
  ctx.save();
  ctx.translate(preview.x, preview.y);
  ctx.scale(s, s);
  ctx.globalAlpha = 0.58 + pulse * 0.18;
  ctx.strokeStyle = attack ? '#ffd5c7' : '#f0e9cf';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -time * 11;
  ctx.beginPath();
  const targetRadius = attack ? Math.min(64, Math.max(17, (preview.radius || 0) / s + 7)) : 17;
  ctx.ellipse(0, 0, targetRadius + pulse * 2, targetRadius * 0.46 + pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = attack ? '#d7664f' : '#d4b860';
  ctx.lineWidth = 1.8;
  if (attack) {
    const arm = Math.min(18, targetRadius * 0.62);
    ctx.beginPath();
    ctx.moveTo(-arm, -arm * 0.46);
    ctx.lineTo(arm, arm * 0.46);
    ctx.moveTo(arm, -arm * 0.46);
    ctx.lineTo(-arm, arm * 0.46);
    ctx.stroke();
  } else {
    for (let i = -1; i <= 1; i++) {
      const x = i * 7;
      ctx.beginPath();
      ctx.moveTo(x - 3.5, 1.5);
      ctx.lineTo(x, -2);
      ctx.lineTo(x + 3.5, 1.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function draw(
  world, alpha, dragRect, placementPreview = null, resourceHover = null, movePreview = null,
  hoverKind = null,
) {
  // margins outside the world
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a2112';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const z = camera.zoom;
  const rotation = normalizeViewRotation(camera.rotation);
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  ctx.setTransform(
    dpr * z * cos,
    dpr * z * sin,
    -dpr * z * sin,
    dpr * z * cos,
    dpr * (cw / 2 - z * (cos * camera.x - sin * camera.y)),
    dpr * (ch / 2 - z * (sin * camera.x + cos * camera.y)),
  );

  const viewExtents = rotatedViewHalfExtents(camera, cw, ch);
  drawTerrain(ctx, camera.x, camera.y, viewExtents.x * 2, viewExtents.y * 2);

  const visibleWorld = getVisibleWorldBounds(camera, cw, ch, 0, WORLD.w, WORLD.h);

  // flush new decals, then blit
  updateTimedDecals(world);
  if (world.pendingDecals.length) {
    if (!world.decals) world.decals = [];
    for (const d of world.pendingDecals) {
      paintDecal(d, { opacity: decalOpacity(d, world.time) });
      fxNoteDecal(world, d);
      world.decals.push(d);
    }
    // A very long artillery campaign should not grow the save indefinitely.
    if (world.decals.length > 5000) world.decals.splice(0, world.decals.length - 5000);
    world.pendingDecals.length = 0;
  }
  const decalView = getVisibleWorldBounds(camera, cw, ch, 64, WORLD.w, WORLD.h);
  const decalX = Math.floor(decalView.left);
  const decalY = Math.floor(decalView.top);
  const decalW = Math.max(1, Math.ceil(decalView.right) - decalX);
  const decalH = Math.max(1, Math.ceil(decalView.bottom) - decalY);
  ctx.drawImage(decalCanvas, decalX, decalY, decalW, decalH, decalX, decalY, decalW, decalH);

  // Ground-hugging powder bank, blood and debris litter, and projectile ground
  // shadows. These lie flat on the board, so they are drawn before anything
  // that stands on it and can therefore be occluded by it. Also runs the
  // effect-field decay and drift for the frame; cost is independent of unit
  // count.
  drawSmokeUnder(ctx, world, alpha);
  drawTowerAttackRanges(ctx, world.buildings, world.time);

  for (const resource of world.resources) {
    if (resource.alive && resource.amount > 0
      && circleIntersectsBounds(resource, visibleWorld, 140)) drawResourceNode(resource);
  }

  buildingSortBuf.length = 0;
  for (const building of world.buildings) {
    if (building.alive && circleIntersectsBounds(building, visibleWorld, 190)) {
      buildingSortBuf.push(building);
    }
  }
  buildingSortBuf.sort((a, b) => worldViewDepth(camera, a.x, a.y) - worldViewDepth(camera, b.x, b.y));

  // Fields are parts of a mill complex, not unrelated map cards. Restrained
  // wheel ruts link every parcel to its parent mill beneath actors/structures.
  for (const field of buildingSortBuf) {
    if (!field.alive || field.type !== 'farm' || !Number.isFinite(field.millId)) continue;
    const mill = world.buildings.find(building => building.id === field.millId
      && building.alive && building.type === 'mill');
    if (!mill) continue;
    const dx = field.x - mill.x, dy = field.y - mill.y;
    const distance = Math.hypot(dx, dy) || 1;
    const reach = Math.min(mill.radius * 0.62, distance * 0.35);
    const startX = mill.x + dx / distance * reach;
    const startY = mill.y + dy / distance * reach;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(67,49,31,.38)';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(field.x, field.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(174,143,87,.22)';
    ctx.lineWidth = 1.5;
    for (const offset of [-2.2, 2.2]) {
      const nx = -dy / distance * offset, ny = dx / distance * offset;
      ctx.beginPath(); ctx.moveTo(startX + nx, startY + ny);
      ctx.lineTo(field.x + nx, field.y + ny); ctx.stroke();
    }
    ctx.restore();
  }

  // Inner-wall stairs must remain legible even when their ground anchor is
  // behind the host wall in y-sort order. Paint fortifications first, then the
  // attached stair volume so the individual treads and landing stay visible.
  for (const building of buildingSortBuf) {
    if (building.type !== 'wall_stairs') drawBuilding(building, world);
  }
  for (const building of buildingSortBuf) {
    if (building.type === 'wall_stairs') drawBuilding(building, world);
  }
  for (const destruction of world.destructions || []) {
    if (circleIntersectsBounds(destruction, visibleWorld, 190)) {
      drawBuildingCollapse(destruction, world.time);
    }
  }

  drawResourceHover(resourceHover, z, hoverKind);

  if (placementPreview) {
    const def = BUILDING_TYPES[placementPreview.type];
    if (def) {
      ctx.save();
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = placementPreview.valid ? '#78c878' : '#d35d50';
      ctx.strokeStyle = placementPreview.valid ? '#b9efb9' : '#ffb0a7';
      ctx.lineWidth = 2 / z;
      if (placementPreview.type === 'farm' && Number.isFinite(placementPreview.millId)) {
        const mill = world.buildings.find(building => building.id === placementPreview.millId);
        if (mill) {
          ctx.save();
          ctx.globalAlpha = 0.8;
          ctx.setLineDash([8 / z, 6 / z]);
          ctx.lineWidth = 2.2 / z;
          ctx.beginPath();
          ctx.moveTo(mill.x, mill.y);
          ctx.lineTo(placementPreview.x, placementPreview.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(mill.x, mill.y, mill.radius + 12 / z, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (isFortificationType(placementPreview.type) || def.wallAttachment) {
        const previews = placementPreview.segments?.length
          ? placementPreview.segments : [placementPreview];
        for (const preview of previews) {
          ctx.globalAlpha = 0.58;
          ctx.fillStyle = placementPreview.valid ? '#78c878' : '#d35d50';
          ctx.strokeStyle = placementPreview.valid ? '#b9efb9' : '#ffb0a7';
          ctx.lineWidth = 2 / z;
          const corners = fortificationCorners(
            preview.type,
            preview.x,
            preview.y,
            preview.orientation,
          );
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          const axis = {
            x: corners[1].x - corners[0].x,
            y: corners[1].y - corners[0].y,
          };
          const length = Math.hypot(axis.x, axis.y) || 1;
          const nx = axis.x / length, ny = axis.y / length;
          for (const sign of [-1, 1]) {
            const ex = preview.x + nx * def.w * 0.5 * sign;
            const ey = preview.y + ny * def.w * 0.5 * sign;
            ctx.beginPath();
            ctx.arc(ex, ey, 3.5 / z, 0, Math.PI * 2);
            ctx.fillStyle = placementPreview.valid ? '#d9f2ca' : '#ffd0c7';
            ctx.fill();
          }
          if (placementPreview.type === 'gate') {
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = placementPreview.valid ? '#eff6de' : '#ffe3dc';
            ctx.lineWidth = 4 / z;
            ctx.beginPath();
            ctx.moveTo(preview.x - nx * 15, preview.y - ny * 15);
            ctx.lineTo(preview.x + nx * 15, preview.y + ny * 15);
            ctx.stroke();
          }
        }
        if (def.wallAttachment && Number.isFinite(placementPreview.wallId)) {
          const wall = world.buildings.find(building => building.id === placementPreview.wallId);
          if (wall) {
            ctx.setLineDash([6 / z, 4 / z]);
            ctx.lineWidth = 1.5 / z;
            ctx.beginPath();
            ctx.moveTo(wall.x, wall.y);
            ctx.lineTo(placementPreview.x, placementPreview.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        if (placementPreview.segments?.length
          && (placementPreview.limitedByResources || placementPreview.limitedByObstacle)) {
          const last = placementPreview.segments.at(-1);
          ctx.save();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = placementPreview.limitedByResources ? '#e4bf65' : '#e27a67';
          ctx.setLineDash([9 / z, 6 / z]);
          ctx.lineWidth = 2 / z;
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(placementPreview.dragEndX, placementPreview.dragEndY);
          ctx.stroke();
          ctx.restore();
        }
      } else {
        ctx.translate(placementPreview.x, placementPreview.y);
        if (Number.isFinite(placementPreview.rotation)) ctx.rotate(placementPreview.rotation);
        ctx.fillRect(-def.w / 2, -def.h / 2, def.w, def.h);
        ctx.strokeRect(-def.w / 2, -def.h / 2, def.w, def.h);
      }
      ctx.restore();
    }
  }

  drawMovePreview(movePreview, z, world.time);
  drawOrderFlags(ctx, world);

  // visible-unit list, sorted by y for correct overlap
  sortBuf.length = 0;
  for (const u of world.units) {
    if (!u.alive) continue;
    if (!circleIntersectsBounds(u, visibleWorld, 56)) continue;
    sortBuf.push(u);
  }
  sortBuf.sort((a, b) => {
    const depthA = Math.round(worldViewDepth(camera, a.x, a.y));
    const depthB = Math.round(worldViewDepth(camera, b.x, b.y));
    // Dense ranks can move by fractions of a pixel during separation. One-world-
    // pixel depth layers give the sort a transitive, stable id tie-break.
    return depthA - depthB || a.id - b.id;
  });

  // Selection rings go under the sprites so they read as marks on the ground.
  drawSelection(ctx, sortBuf, alpha);

  for (const u of sortBuf) {
    const unitType = u.unitType || u.type;
    const sp = sprites[u.side][unitType];
    const ix = u.px + (u.x - u.px) * alpha;
    const iy = u.py + (u.y - u.py) * alpha - (u.wallElevation || 0);
    let frame;
    if (unitType === 'woman_villager') {
      frame = getWomanVillagerFrame(u, hoverKind === 'attack' && u.selected);
    } else if (u.type === 'villager') {
      frame = getWorkerFrame(u, hoverKind === 'attack' && u.selected);
    } else {
      frame = getMilitaryFrame(u);
    }
    const rearView = viewMirrorsHorizontalFacing(rotation);
    const dir = (u.facing >= 0) !== rearView ? 0 : 1;
    const visualFacing = dir === 0 ? 1 : -1;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(-rotation);
    drawAnimatedCharacterFrame(ctx, sp.frames[dir][frame], sp, getCharacterMotion(u, visualFacing));
    drawThrowingTorch(u, 0, 0, visualFacing);
    drawStarWarsEnergyBlade(u, visualFacing);
    ctx.restore();
  }

  // Near rows occlude boots and lower legs, making the hoeing villager read as
  // physically inside the crop instead of pasted above it.
  for (const building of buildingSortBuf) drawFarmForeground(building);

  drawBuildingFires(ctx, world);

  // Projectiles, powder smoke, muzzle flash, blood and dust.
  drawEffects(ctx, world, alpha);

  // Health bars sit above the sprites, still in world space.
  drawHealthBars(ctx, sortBuf, alpha, sprites);

  // Atmosphere: aerial haze, warm/cool grade, vignette. Screen space, and its
  // cost does not scale with the number of units.
  drawLightingPass(ctx, cw, ch, dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawVictoryRainbow(world);
  drawDragRect(ctx, dragRect);

  drawMinimap(world);
}
