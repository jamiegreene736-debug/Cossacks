// Rendering: procedurally drawn sprite atlases (no image files), terrain and
// corpse-decal offscreen canvases, camera transform, effects, minimap.

import { WORLD, NATIONS, BUILDING_TYPES } from './config.js';

const SCALE = 3; // sprite atlas oversampling

export const camera = { x: 660, y: WORLD.h / 2, zoom: 0.9 };

let canvas, ctx, mmCanvas, mmCtx;
let cw = 0, ch = 0, dpr = 1;
let terrainCanvas = null;
let decalCanvas = null, decalCtx = null;
let mmTerrain = null;
let sprites = null; // sprites[side][type] = {frames: [dir][frame], w,h,ax,ay}

// ---------- Setup ----------

export function initRender(gameCanvas, minimapCanvas) {
  canvas = gameCanvas;
  ctx = canvas.getContext('2d');
  mmCanvas = minimapCanvas;
  mmCtx = mmCanvas.getContext('2d');
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
  sprites = [
    buildNationSprites(world.sides[0].nation),
    buildNationSprites(world.sides[1].nation),
  ];
  mmTerrain = document.createElement('canvas');
  mmTerrain.width = mmCanvas.width;
  mmTerrain.height = mmCanvas.height;
  mmTerrain.getContext('2d').drawImage(terrainCanvas, 0, 0, mmCanvas.width, mmCanvas.height);
  const townCenter = world.buildings.find(building => building.side === 0 && building.type === 'town_center');
  camera.x = townCenter?.x || 660;
  camera.y = townCenter?.y || WORLD.h / 2;
  camera.zoom = Math.max(0.62, Math.min(1.15, ch / 1050));
  clampCamera();
}

// ---------- Terrain ----------

function rnd(a, b) { return a + Math.random() * (b - a); }

function buildTerrain() {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = WORLD.w / 2;
  terrainCanvas.height = WORLD.h / 2;
  const g = terrainCanvas.getContext('2d');
  g.scale(0.5, 0.5);

  const grad = g.createLinearGradient(0, 0, 0, WORLD.h);
  grad.addColorStop(0, '#66854b');
  grad.addColorStop(0.5, '#6f8f50');
  grad.addColorStop(1, '#5f7c45');
  g.fillStyle = grad;
  g.fillRect(0, 0, WORLD.w, WORLD.h);

  // Soft tonal patches
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(40, 55, 25, ${rnd(0.04, 0.09)})`;
    g.beginPath();
    g.ellipse(rnd(0, WORLD.w), rnd(0, WORLD.h), rnd(80, 320), rnd(50, 180), rnd(0, 3), 0, 7);
    g.fill();
  }
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(200, 210, 140, ${rnd(0.03, 0.07)})`;
    g.beginPath();
    g.ellipse(rnd(0, WORLD.w), rnd(0, WORLD.h), rnd(60, 220), rnd(40, 120), rnd(0, 3), 0, 7);
    g.fill();
  }
  // Grass specks
  for (let i = 0; i < 2600; i++) {
    const shade = Math.random() < 0.5 ? 'rgba(35,50,22,0.35)' : 'rgba(190,205,130,0.3)';
    g.fillStyle = shade;
    g.fillRect(rnd(0, WORLD.w), rnd(0, WORLD.h), rnd(2, 4), 2);
  }
  // A rutted country road across the field
  g.strokeStyle = 'rgba(120, 100, 60, 0.35)';
  g.lineWidth = 26;
  g.beginPath();
  g.moveTo(0, WORLD.h * 0.42);
  g.bezierCurveTo(WORLD.w * 0.3, WORLD.h * 0.36, WORLD.w * 0.6, WORLD.h * 0.5, WORLD.w, WORLD.h * 0.46);
  g.stroke();

  // Tree lines along the north and south edges
  for (let i = 0; i < 150; i++) {
    const top = Math.random() < 0.5;
    const x = rnd(0, WORLD.w);
    const y = top ? rnd(20, 140) : rnd(WORLD.h - 140, WORLD.h - 20);
    drawTree(g, x, y, rnd(9, 16));
  }
  // Scattered copses and bushes
  for (let i = 0; i < 26; i++) {
    const x = rnd(100, WORLD.w - 100);
    const y = Math.random() < 0.5 ? rnd(180, 620) : rnd(WORLD.h - 620, WORLD.h - 180);
    drawTree(g, x, y, rnd(4, 8));
  }
}

function drawTree(g, x, y, r) {
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.5, r, r * 0.4, 0, 0, 7); g.fill();
  g.fillStyle = '#31502c';
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  g.fillStyle = '#41653a';
  g.beginPath(); g.arc(x - r * 0.25, y - r * 0.3, r * 0.62, 0, 7); g.fill();
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

function drawSoldier(g, nat, pose, legPhase, weapon) {
  const coat = nat.coat, trim = nat.trim, skin = nat.skin;
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(8, 17.6, 5, 1.7, 0, 0, 7); g.fill();
  // legs
  g.fillStyle = '#2b261e';
  if (legPhase === 1) {
    g.fillRect(5.9, 12.5, 1.4, 4.6);
    g.fillRect(9.5, 12.5, 1.4, 4.1);
  } else if (legPhase === 2) {
    g.fillRect(6.7, 12.5, 1.4, 4.1);
    g.fillRect(8.7, 12.5, 1.4, 4.6);
  } else {
    g.fillRect(6.5, 12.5, 1.4, 4.5);
    g.fillRect(8.9, 12.5, 1.4, 4.5);
  }
  // coat
  g.fillStyle = coat;
  g.fillRect(5.7, 6.4, 5.1, 6.8);
  g.fillRect(5.3, 11.5, 5.9, 1.7); // skirt flare
  // trim: cuffs + facing stripe
  g.fillStyle = trim;
  g.fillRect(9.9, 6.8, 0.9, 3.2);
  g.fillRect(5.7, 6.4, 0.7, 1.1);
  // crossbelt
  g.strokeStyle = 'rgba(235,230,215,0.9)';
  g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(6.3, 7.4); g.lineTo(10.2, 12.2); g.stroke();
  // head + tricorn
  g.fillStyle = skin;
  g.beginPath(); g.arc(8.3, 4.7, 2.05, 0, 7); g.fill();
  g.fillStyle = '#241e14';
  g.fillRect(5.9, 3, 5, 1.4);
  g.fillRect(6.3, 2.2, 1.2, 1);
  g.fillRect(9.3, 2.2, 1.2, 1);
  // weapon
  if (weapon === 'musk') {
    if (pose === 'fire') {
      g.strokeStyle = '#4a3823'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(9.2, 8.4); g.lineTo(13.2, 8.1); g.stroke();
      g.strokeStyle = '#8d939b'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(13, 8.1); g.lineTo(15.9, 7.9); g.stroke();
      g.fillStyle = skin; g.fillRect(10.2, 7.7, 1.3, 1.3); // forward hand
    } else {
      g.strokeStyle = '#4a3823'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(10.4, 13.6); g.lineTo(12.6, 6.8); g.stroke();
      g.strokeStyle = '#8d939b'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(12.6, 6.8); g.lineTo(13.5, 4.2); g.stroke();
    }
  } else if (weapon === 'pike') {
    g.strokeStyle = '#5d4b32'; g.lineWidth = 1;
    if (pose === 'attack') {
      g.beginPath(); g.moveTo(7.5, 10.8); g.lineTo(16.8, 9.6); g.stroke();
      g.strokeStyle = '#b9bec6'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(16.5, 9.6); g.lineTo(18.6, 9.35); g.stroke();
    } else {
      g.beginPath(); g.moveTo(11.2, 15); g.lineTo(11.2, 0.8); g.stroke();
      g.strokeStyle = '#b9bec6'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(11.2, 1.2); g.lineTo(11.2, -0.8); g.stroke();
    }
  }
}

function drawWorker(g, nat, pose, legPhase) {
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(8, 17.6, 5.2, 1.7, 0, 0, 7); g.fill();
  g.fillStyle = '#3a3024';
  const stride = legPhase === 1 ? 0.8 : legPhase === 2 ? -0.8 : 0;
  g.fillRect(6 + stride, 12.5, 1.5, 4.7);
  g.fillRect(9 - stride, 12.5, 1.5, 4.7);
  g.fillStyle = '#866942';
  g.fillRect(5.5, 6.8, 5.6, 6.5);
  g.fillStyle = nat.trim;
  g.globalAlpha = 0.7;
  g.fillRect(6.2, 8.2, 4.2, 4.8);
  g.globalAlpha = 1;
  g.fillStyle = nat.skin;
  g.beginPath(); g.arc(8.3, 5, 2.05, 0, 7); g.fill();
  g.fillStyle = '#6a4d2f';
  g.fillRect(5.9, 3.2, 4.9, 1.1);
  g.beginPath(); g.arc(8.3, 3.7, 2.2, Math.PI, 0); g.fill();
  g.strokeStyle = '#5a4128';
  g.lineWidth = 1.2;
  if (pose === 'work') {
    g.beginPath(); g.moveTo(9.2, 8); g.lineTo(14.8, 14.8); g.stroke();
    g.strokeStyle = '#8b9298';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(13.4, 14); g.lineTo(16, 16.2); g.stroke();
  } else {
    g.beginPath(); g.moveTo(10.4, 9); g.lineTo(13.2, 16.8); g.stroke();
  }
}

function drawCavalry(g, nat, pose, legPhase) {
  const coat = nat.coat, skin = nat.skin;
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(11, 17.7, 8, 1.9, 0, 0, 7); g.fill();
  // horse legs
  g.strokeStyle = '#3f2d1d'; g.lineWidth = 1.15;
  const legsIdle = [[5.6, 0], [8.2, 0], [13.6, 0], [16.2, 0]];
  const legsW1 = [[5.6, 1.4], [8.2, -1.1], [13.6, 1.2], [16.2, -1.4]];
  const legsW2 = [[5.6, -1.3], [8.2, 1.2], [13.6, -1.1], [16.2, 1.4]];
  const legs = legPhase === 1 ? legsW1 : legPhase === 2 ? legsW2 : legsIdle;
  for (const [lx, off] of legs) {
    g.beginPath(); g.moveTo(lx, 13.5); g.lineTo(lx + off, 18.6); g.stroke();
  }
  // horse body
  g.fillStyle = '#553d28';
  g.beginPath(); g.ellipse(11, 11.8, 7.2, 3.1, 0, 0, 7); g.fill();
  // neck + head
  g.beginPath();
  g.moveTo(16.4, 10.6); g.lineTo(19.3, 6.4); g.lineTo(21, 7.4); g.lineTo(18, 12.4);
  g.closePath(); g.fill();
  g.beginPath(); g.ellipse(20.3, 6.9, 1.8, 1.05, -0.35, 0, 7); g.fill();
  g.fillStyle = '#332416';
  g.fillRect(19.6, 5.4, 0.8, 1.2); // ear
  g.strokeStyle = '#332416'; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(16.8, 10.4); g.lineTo(19.5, 6.6); g.stroke(); // mane
  // tail
  g.beginPath(); g.moveTo(4, 10.6); g.lineTo(2.2, 15.4); g.stroke();
  // rider
  g.fillStyle = coat;
  g.fillRect(9.7, 3.5, 4.4, 6.2);
  g.fillStyle = nat.trim;
  g.fillRect(9.7, 3.5, 0.8, 1);
  g.fillStyle = skin;
  g.beginPath(); g.arc(11.9, 2.2, 1.85, 0, 7); g.fill();
  g.fillStyle = '#241e14';
  g.fillRect(9.8, 0.7, 4.2, 1.25);
  // sabre
  g.strokeStyle = '#c9cdd4'; g.lineWidth = 1;
  if (pose === 'attack') {
    g.beginPath(); g.moveTo(13.8, 6.2); g.lineTo(19.8, 4.6); g.stroke();
  } else {
    g.beginPath(); g.moveTo(13.6, 5.6); g.lineTo(16.6, 2.2); g.stroke();
  }
}

function drawCannon(g, nat, pose) {
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.beginPath(); g.ellipse(13, 18.2, 9.5, 2.1, 0, 0, 7); g.fill();
  const recoil = pose === 'fire' ? -1.3 : 0;
  // carriage
  g.fillStyle = '#6b5238';
  g.beginPath();
  g.moveTo(6.5 + recoil, 16.5); g.lineTo(10.5 + recoil, 12);
  g.lineTo(20 + recoil, 14.5); g.lineTo(17.5 + recoil, 17.5);
  g.closePath(); g.fill();
  // barrel
  g.strokeStyle = '#3c4148'; g.lineWidth = 2.7;
  g.beginPath(); g.moveTo(8 + recoil, 14); g.lineTo(21 + recoil, 9.6); g.stroke();
  g.strokeStyle = '#596069'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(19.2 + recoil, 10.5); g.lineTo(21.2 + recoil, 9.8); g.stroke();
  // wheel
  g.strokeStyle = '#4f3b26'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(12 + recoil, 14.6, 4.2, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(12 + recoil, 10.4); g.lineTo(12 + recoil, 18.8); g.stroke();
  g.beginPath(); g.moveTo(7.8 + recoil, 14.6); g.lineTo(16.2 + recoil, 14.6); g.stroke();
  g.fillStyle = '#4f3b26';
  g.beginPath(); g.arc(12 + recoil, 14.6, 1.1, 0, 7); g.fill();
  // two crewmen
  for (const cx of [2.6, 24]) {
    g.fillStyle = '#2b261e';
    g.fillRect(cx - 0.6, 13.8, 1, 3);
    g.fillRect(cx + 0.8, 13.8, 1, 3);
    g.fillStyle = nat.coat;
    g.fillRect(cx - 1, 9.4, 3.2, 4.8);
    g.fillStyle = nat.skin;
    g.beginPath(); g.arc(cx + 0.6, 8.2, 1.5, 0, 7); g.fill();
    g.fillStyle = '#241e14';
    g.fillRect(cx - 1, 6.9, 3.2, 1);
  }
}

function buildNationSprites(nationKey) {
  const nat = NATIONS[nationKey];
  const out = {};

  const defs = {
    villager: { w: 18, h: 20, ax: 8, ay: 17.6, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['work', 0],
    ], painter: (g, pose, leg) => drawWorker(g, nat, pose, leg) },
    musk: { w: 18, h: 20, ax: 8, ay: 17.6, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['fire', 0],
    ], painter: (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'musk') },
    pike: { w: 20, h: 20, ax: 8, ay: 17.6, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['attack', 0],
    ], painter: (g, pose, leg) => drawSoldier(g, nat, pose, leg, 'pike') },
    cav: { w: 23, h: 20, ax: 11, ay: 17.7, frames: [
      ['idle', 0], ['idle', 1], ['idle', 2], ['attack', 0],
    ], painter: (g, pose, leg) => drawCavalry(g, nat, pose, leg) },
    gun: { w: 27, h: 21, ax: 13, ay: 18.2, frames: [
      ['idle', 0], ['fire', 0],
    ], painter: (g, pose) => drawCannon(g, nat, pose) },
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

function paintDecal(d) {
  const g = decalCtx;
  g.save();
  g.translate(d.x, d.y);
  if (d.kind === 'crater') {
    g.fillStyle = 'rgba(45, 35, 22, 0.55)';
    g.beginPath(); g.ellipse(0, 0, 7, 4.5, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(25, 20, 12, 0.5)';
    g.beginPath(); g.ellipse(0, 0, 3.5, 2.2, 0, 0, 7); g.fill();
  } else if (d.kind === 'ruin') {
    g.fillStyle = 'rgba(43, 34, 24, 0.7)';
    g.beginPath(); g.ellipse(0, 5, 42, 21, 0, 0, 7); g.fill();
    g.fillStyle = '#625545';
    for (let i = 0; i < 14; i++) {
      const x = Math.sin(i * 19.7) * 34;
      const y = Math.cos(i * 12.3) * 15;
      g.fillRect(x - 4, y - 3, 8, 6);
    }
  } else if (d.kind === 'wreck') {
    g.rotate(d.ang);
    g.strokeStyle = '#4a3826'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 4, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(-6, 3); g.lineTo(7, -2); g.stroke();
    g.strokeStyle = '#3c4148'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-4, -3); g.lineTo(8, 2); g.stroke();
  } else {
    g.rotate(d.ang + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2));
    g.fillStyle = 'rgba(70, 30, 22, 0.4)';
    g.beginPath(); g.ellipse(1, 1, 5.5, 3.5, 0, 0, 7); g.fill();
    g.fillStyle = d.coat;
    g.globalAlpha = 0.85;
    g.fillRect(-4, -1.8, 7, 3.6);
    g.globalAlpha = 1;
    g.fillStyle = '#d9a877';
    g.beginPath(); g.arc(4.3, 0, 1.6, 0, 7); g.fill();
    if (d.type === 'cav') {
      g.fillStyle = 'rgba(60, 42, 26, 0.9)';
      g.beginPath(); g.ellipse(-6, 1, 6, 3, 0.3, 0, 7); g.fill();
    }
  }
  g.restore();
}

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

  ctx.drawImage(terrainCanvas, 0, 0, WORLD.w, WORLD.h);

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

  // order flags
  for (const f of world.flags) {
    const a = Math.max(0, f.life / f.max);
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x, f.y - 14); ctx.stroke();
    ctx.fillStyle = f.attack ? '#c03a30' : f.gather ? '#d1b454' : f.rally ? '#5aa3dc' : '#ece4cb';
    ctx.beginPath();
    ctx.moveTo(f.x, f.y - 14); ctx.lineTo(f.x + 9, f.y - 11.5); ctx.lineTo(f.x, f.y - 9);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // visible-unit list, sorted by y for correct overlap
  const viewHalfW = cw / 2 / z + 40, viewHalfH = ch / 2 / z + 40;
  sortBuf.length = 0;
  for (const u of world.units) {
    if (!u.alive) continue;
    if (Math.abs(u.x - camera.x) > viewHalfW || Math.abs(u.y - camera.y) > viewHalfH) continue;
    sortBuf.push(u);
  }
  sortBuf.sort((a, b) => a.y - b.y);

  // selection rings under sprites
  ctx.strokeStyle = 'rgba(140, 235, 140, 0.85)';
  ctx.lineWidth = 1.2 / z;
  for (const u of sortBuf) {
    if (!u.selected) continue;
    const ix = u.px + (u.x - u.px) * alpha;
    const iy = u.py + (u.y - u.py) * alpha;
    ctx.beginPath();
    ctx.ellipse(ix, iy, u.radius + 3.5, (u.radius + 3.5) * 0.5, 0, 0, 7);
    ctx.stroke();
  }

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
    if (u.selected && u.hp < u.maxHp) {
      const w = 10, frac = u.hp / u.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(ix - w / 2, iy - sp.ay - 3, w, 1.6);
      ctx.fillStyle = frac > 0.5 ? '#7fd67f' : frac > 0.25 ? '#e0c34a' : '#d65f4a';
      ctx.fillRect(ix - w / 2, iy - sp.ay - 3, w * frac, 1.6);
    }
  }

  // cannonballs
  for (const p of world.projectiles) {
    const ix = p.px + (p.x - p.px) * alpha;
    const iy = p.py + (p.y - p.py) * alpha;
    const k = Math.min(1, p.t / p.dur);
    const gx = p.sx + (p.tx - p.sx) * k;
    const gy = p.sy + (p.ty - p.sy) * k;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(gx, gy, 2.2, 1.1, 0, 0, 7); ctx.fill();
    ctx.fillStyle = p.kind === 'tower' ? '#b6ad92' : '#1c1c1e';
    ctx.beginPath(); ctx.arc(ix, iy, 2.3, 0, 7); ctx.fill();
  }

  // particles
  for (const p of world.particles) {
    const lifeFrac = 1 - p.life / p.max;
    if (p.kind === 'smoke') {
      ctx.fillStyle = `rgba(225, 223, 212, ${0.35 * lifeFrac})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(255, 214, 110, ${0.9 * lifeFrac})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
  }

  // selection drag box (screen space)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (dragRect) {
    ctx.strokeStyle = 'rgba(140, 235, 140, 0.9)';
    ctx.fillStyle = 'rgba(140, 235, 140, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
    ctx.strokeRect(dragRect.x, dragRect.y, dragRect.w, dragRect.h);
  }

  drawMinimap(world);
}

let mmT = 0;

function drawMinimap(world) {
  const now = performance.now();
  if (now - mmT < 90) return;
  mmT = now;
  const w = mmCanvas.width, h = mmCanvas.height;
  mmCtx.drawImage(mmTerrain, 0, 0);
  const sx = w / WORLD.w, sy = h / WORLD.h;
  for (const resource of world.resources) {
    if (!resource.alive || resource.amount <= 0) continue;
    mmCtx.fillStyle = resource.type === 'wood' ? '#315d35'
      : resource.type === 'food' ? '#9a7337'
        : resource.type === 'gold' ? '#d2ad42' : '#94968f';
    mmCtx.fillRect(resource.x * sx - 1.5, resource.y * sy - 1.5, 3, 3);
  }
  for (const building of world.buildings) {
    if (!building.alive) continue;
    mmCtx.fillStyle = building.side === 0 ? '#72b8f2' : '#f07868';
    const size = building.type === 'town_center' ? 5 : 3;
    mmCtx.fillRect(building.x * sx - size / 2, building.y * sy - size / 2, size, size);
  }
  for (const u of world.units) {
    if (!u.alive) continue;
    mmCtx.fillStyle = u.side === 0 ? '#63b0ff' : '#ff6a5e';
    mmCtx.fillRect(u.x * sx - 0.75, u.y * sy - 0.75, 1.5, 1.5);
  }
  mmCtx.strokeStyle = 'rgba(255,255,255,0.85)';
  mmCtx.lineWidth = 1;
  const vw = cw / camera.zoom * sx, vh = ch / camera.zoom * sy;
  mmCtx.strokeRect(camera.x * sx - vw / 2, camera.y * sy - vh / 2, vw, vh);
}
