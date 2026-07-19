// Rendering: procedurally drawn sprite atlases (no image files), terrain and
// corpse-decal offscreen canvases, camera transform, effects, minimap.

import { WORLD, NATIONS } from './config.js';

const SCALE = 3; // sprite atlas oversampling

export const camera = { x: 1400, y: WORLD.h / 2, zoom: 0.85 };

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
  const m = 150;
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
  camera.x = 1400;
  camera.y = WORLD.h / 2;
  camera.zoom = Math.max(0.55, Math.min(1.1, ch / 1700));
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

// ---------- Frame draw ----------

const sortBuf = [];

export function draw(world, alpha, dragRect) {
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

  // order flags
  for (const f of world.flags) {
    const a = Math.max(0, f.life / f.max);
    ctx.globalAlpha = a * 0.9;
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x, f.y - 14); ctx.stroke();
    ctx.fillStyle = '#c03a30';
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
    ctx.fillStyle = '#1c1c1e';
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
