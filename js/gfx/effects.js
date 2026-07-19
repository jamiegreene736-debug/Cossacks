// Battle effects: powder smoke, muzzle flash, cannonballs, blood, dust.
// Puff/flash/blood textures are baked once at battle start; each particle
// is then a single drawImage, so the per-frame cost stays flat.
import { WORLD } from '../config.js';

// render.js owns the camera and viewport; it injects them so this module
// can cull to the visible area without importing render.js (which would
// create an import cycle).
let camera = { x: 0, y: 0, zoom: 1 };
let cw = 0, ch = 0;
function setEffectsCamera(c) { camera = c; }
function setEffectsView(w, h) { cw = w; ch = h; }

// =============================================================================
//  EFFECTS  —  black-powder smoke, muzzle flash, shot, impact, blood, dust
// =============================================================================
//
//  Art Bible compliance
//  --------------------
//  * ONE sun for the whole game: FX_SUN below. Every puff has a warm-lit top-left
//    and a cool blue-violet shaded bottom-right. Every ground shadow falls
//    down-right. Nothing invents its own light.
//  * EVERYTHING expensive happens once, inside buildParticleTextures():
//    radial gradients, ctx.filter blurs, destination-out edge erosion,
//    rotation pre-baking, and pre-multiplied opacity variants.
//  * The per-particle hot loop is: a handful of integer/float ops, then ONE
//    9-argument ctx.drawImage from an already-bound atlas. No path building,
//    no gradients, no filter, no shadowBlur, no globalAlpha writes, no string
//    allocation (the old code built ~54,000 rgba() template literals a second).
//  * globalCompositeOperation is assigned exactly twice per frame ('lighter'
//    for the additive batch, then back to 'source-over'), regardless of how
//    many particles are alive.
//
//  Two persistent low-resolution fields carry what particles cannot:
//    smokeBank  (WORLD/8) — every shot stamps into it; it decays and drifts and
//                           is blitted twice per frame (once under the troops,
//                           once over them). This is the rolling powder bank
//                           that swallows a firing line — the signature image
//                           of black-powder warfare — and it costs O(1) per
//                           frame no matter how many muskets are firing.
//    spillField (WORLD/8) — additive warm light stamped per muzzle flash, so a
//                           volley visibly lights up the ground it stands on.
//
//  ---------------------------------------------------------------------------
//  ADAPTED for the settlement-economy render.js (buildings / resource nodes).
//  ---------------------------------------------------------------------------
//  The frame is no longer "terrain, decals, units". It is now:
//
//      terrain -> decals -> [GROUND PLANE] -> resource nodes -> buildings
//              -> units -> [AIR PLANE]
//
//  Anything that lies FLAT ON THE BOARD has to be drawn before the things that
//  STAND ON the board, or it paints over them. Two things moved down out of
//  drawEffects() into drawSmokeUnder() for exactly that reason:
//
//    * projectile ground shadows — a 24 lb roundshot passing over a town centre
//      used to drop its shadow ON THE ROOF. A town centre is 132x104 world px,
//      roughly seven times a soldier's footprint, so this was not a subtlety.
//    * blood and debris — ground litter. Same argument, and it also lets a
//      building's own footprint occlude the debris its collapse threw.
//
//  Everything airborne (smoke, dust, the dirt column, the rising powder bank,
//  the shot itself, muzzle flash, embers, tracers) stays ABOVE the buildings,
//  which is likewise correct: powder smoke drifts across a barracks, it does
//  not slide under it.
//
//  Two further adaptations, both of which make a shipped-but-invisible feature
//  visible without touching sim.js or economy.js:
//
//    * fxNoteDecal() — hook the existing pendingDecals flush. A destroyed
//      building currently pushes a 'ruin' decal and nothing else: 3,200 hp of
//      masonry vanishes in one frame with no dust, no debris, no sound cue for
//      the eye. fxNoteDecal turns each decal kind into the burst it deserves.
//    * tower muzzle fire — economy.js spawns a tower projectile with no flash
//      and no smoke at all, so a defended wall reads as inert. We detect a
//      projectile on the frame it first appears and give it its muzzle event.
//
//  The two persistent fields are now blitted through fxBlitField(), which uses
//  the 9-argument source-rect form clipped to the camera frustum. The old whole-
//  world blit asked Chrome to sample a 5200x3200 destination every frame and
//  threw away ~85% of it at typical zoom.
//
// =============================================================================

/* --------------------------------------------------------------------------
   Global lighting constant — the single sun. Nothing here may contradict it.
   -------------------------------------------------------------------------- */

const FX_SUN = {
  x: -0.64, y: -0.77,            // unit vector TOWARD the light (up-left)
  sx: 0.64, sy: 0.77,            // direction shadows fall (down-right)
  squash: 0.42,
  shadowRGB: '26,30,48',         // cool violet — never pure black
};

const FX_SIM_DT = 1 / 30;           // sim.js fixed step; used to back-extrapolate

/* --------------------------------------------------------------------------
   Atlas geometry.  Shape/variant counts are powers of two so the hot loop can
   pick a variant with `p.v & MASK` instead of a modulo.
   -------------------------------------------------------------------------- */

const SMOKE_CELL = 128, SMOKE_SHAPES = 8, SMOKE_MASK = 7, SMOKE_ALPHAS = 10;
const CSMK_CELL = 192, CSMK_SHAPES = 4, CSMK_MASK = 3, CSMK_ALPHAS = 10;
const DUST_CELL = 96, DUST_SHAPES = 4, DUST_MASK = 3, DUST_ALPHAS = 8;
const BLOOD_CELL = 64, BLOOD_VARS = 4, BLOOD_MASK = 3, BLOOD_ALPHAS = 3;
const DIRT_CELL = 192, DIRT_VARS = 2, DIRT_MASK = 1, DIRT_ALPHAS = 8;
const DEBRIS_CELL = 32, DEBRIS_VARS = 8, DEBRIS_MASK = 7, DEBRIS_ALPHAS = 4;
const EMBER_CELL = 24, EMBER_VARS = 4, EMBER_MASK = 3, EMBER_ALPHAS = 5;
const BALL_CELL = 64, BALL_VARS = 2;
const BSHADOW_CELL = 40, BSHADOW_STEPS = 6;
const ROT = 16;                   // baked rotations for directional sprites
const ROT_MASK = 15;
const ROT_K = ROT / (Math.PI * 2); // radians -> rotation index scale

// Sprite-radius -> world-radius conversion factors. Each master is painted so
// its visible content reaches ~0.42 * cell from the sprite centre.
const SMOKE_K = 2.40;             // drawn diameter = p.size * SMOKE_K
const DUST_K = 2.40;
const BLOOD_K = 3.00;
const DEBRIS_K = 2.20;
const DIRT_K = 3.20;
const FLASH_K = 4.60;
const EMBER_K = 3.40;
const BALL_D = 22;                // constant world diameter for the shot sprite
const BSHADOW_D = 15;

// Muzzle-flash size classes: 0 = musket, 1 = tower/impact, 2 = cannon.
const FLASH_CELLS = [72, 104, 160];
const FLASH_ALPHAS = 4;

/* --------------------------------------------------------------------------
   Deterministic RNG, so a rebuilt atlas looks identical between runs (makes
   visual regressions obvious instead of "maybe it was always like that").
   -------------------------------------------------------------------------- */

let fxSeed = 0x9e3779b9;
function fxRand() {
  fxSeed ^= fxSeed << 13; fxSeed |= 0;
  fxSeed ^= fxSeed >>> 17;
  fxSeed ^= fxSeed << 5; fxSeed |= 0;
  return (fxSeed >>> 0) / 4294967296;
}
function fxRnd(a, b) { return a + fxRand() * (b - a); }
function fxPick(arr) { return arr[(fxRand() * arr.length) | 0]; }

/* --------------------------------------------------------------------------
   Bake-time canvas helpers.  ctx.filter is used freely in here and NOWHERE
   below the "RUNTIME" banner.
   -------------------------------------------------------------------------- */

function fxCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

function fxCtx(c) {
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return g;
}

// Returns a NEW blurred copy. Bake-time only.
function fxBlur(src, radius) {
  const c = fxCanvas(src.width, src.height);
  const g = c.getContext('2d');
  g.filter = 'blur(' + radius.toFixed(2) + 'px)';
  g.drawImage(src, 0, 0);
  g.filter = 'none';
  return c;
}

// Soft-edged eraser used under gCO='destination-out' to destroy the perfectly
// circular silhouette a stack of radial gradients otherwise has. This single
// step is most of what makes a puff read as smoke rather than as a disc.
function fxErase(g, x, y, r, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, 'rgba(0,0,0,' + a.toFixed(3) + ')');
  gr.addColorStop(0.5, 'rgba(0,0,0,' + (a * 0.62).toFixed(3) + ')');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}

// Soft additive/normal blob, clipped by the caller's gCO.
function fxBlob(g, x, y, r, c0, c1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}

// A flared powder-flame outline: narrow at the muzzle, widest near the tip,
// with a rounded outer lip. Path only — caller fills.
function fxConePath(g, x, y, len, half, baseW) {
  const wEnd = Math.tan(half) * len;
  g.beginPath();
  g.moveTo(x, y - baseW);
  g.quadraticCurveTo(x + len * 0.60, y - wEnd * 0.52, x + len, y - wEnd);
  g.quadraticCurveTo(x + len * 1.13, y, x + len, y + wEnd);
  g.quadraticCurveTo(x + len * 0.60, y + wEnd * 0.52, x, y + baseW);
  g.closePath();
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — smoke / dust puff
   --------------------------------------------------------------------------
   Construction, in order:
     1. 7-11 overlapping radial-gradient lobes with the gradient origin pushed
        toward the sun, so each lobe is already a lit sphere rather than a flat
        disc.
     2. Interior creases — soft dark blobs at 'source-atop' that give the puff
        internal volume instead of a uniform interior.
     3. Cool underside at 'source-atop' offset along +FX_SUN.shadow.
     4. Warm key highlight at 'source-atop' offset along FX_SUN.
     5. Blur, to melt the lobes into one body.
     6. Rim erosion at 'destination-out' — 30-46 soft bites around and just
        inside the silhouette, plus a few interior holes.
     7. Final light blur to take the hard edges off the bites.
   -------------------------------------------------------------------------- */

function bakePuffMaster(S, cfg) {
  let c = fxCanvas(S, S);
  let g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  const R = S * cfg.r;

  // --- 1. body lobes -------------------------------------------------------
  const lobes = cfg.lobes[0] + ((fxRand() * (cfg.lobes[1] - cfg.lobes[0] + 1)) | 0);
  for (let i = 0; i < lobes; i++) {
    const a = fxRand() * 6.28318;
    const d = Math.sqrt(fxRand()) * R * cfg.spread;
    const lx = cx + Math.cos(a) * d * cfg.aspect;
    const ly = cy + Math.sin(a) * d;
    const lr = R * fxRnd(cfg.lobeMin, 1);
    const gr = g.createRadialGradient(
      lx + FX_SUN.x * lr * 0.36, ly + FX_SUN.y * lr * 0.36, lr * 0.04,
      lx, ly, lr);
    gr.addColorStop(0, cfg.core);
    gr.addColorStop(0.40, cfg.mid);
    gr.addColorStop(0.76, cfg.mid2);
    gr.addColorStop(1, cfg.edge);
    g.fillStyle = gr;
    g.beginPath(); g.arc(lx, ly, lr, 0, 7); g.fill();
  }

  // --- 2. interior creases -------------------------------------------------
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < cfg.creases; i++) {
    const a = fxRand() * 6.28318;
    const d = Math.sqrt(fxRand()) * R * 0.75;
    fxBlob(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * fxRnd(0.22, 0.5),
      cfg.crease, 'rgba(0,0,0,0)');
  }

  // --- 3. cool shaded underside (down-right) -------------------------------
  fxBlob(g,
    cx + FX_SUN.sx * R * 0.72, cy + FX_SUN.sy * R * 0.72, R * 1.30,
    cfg.under, 'rgba(0,0,0,0)');
  // a second, tighter pool right at the base so the puff sits on something
  fxBlob(g,
    cx + FX_SUN.sx * R * 1.02, cy + FX_SUN.sy * R * 1.02, R * 0.72,
    cfg.under2, 'rgba(0,0,0,0)');

  // --- 4. warm key highlight (up-left) -------------------------------------
  fxBlob(g,
    cx + FX_SUN.x * R * 0.62, cy + FX_SUN.y * R * 0.62, R * 0.98,
    cfg.top, 'rgba(0,0,0,0)');
  // tight specular crown on the very top lobe
  fxBlob(g,
    cx + FX_SUN.x * R * 0.92, cy + FX_SUN.y * R * 0.92, R * 0.42,
    cfg.top2, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'source-over';

  // --- 5. melt the lobes together -----------------------------------------
  c = fxBlur(c, S * cfg.blur1);
  g = fxCtx(c);

  // --- 6. destroy the circular silhouette ---------------------------------
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < cfg.erode; i++) {
    const a = fxRand() * 6.28318;
    const rr = R * fxRnd(0.80, 1.28);
    fxErase(g, cx + Math.cos(a) * rr * cfg.aspect, cy + Math.sin(a) * rr,
      R * fxRnd(0.16, 0.44), fxRnd(0.40, 1.0));
  }
  // interior thin spots — light passes through real smoke
  for (let i = 0; i < cfg.holes; i++) {
    const a = fxRand() * 6.28318;
    const d = Math.sqrt(fxRand()) * R * 0.7;
    fxErase(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d,
      R * fxRnd(0.10, 0.26), fxRnd(0.10, 0.34));
  }
  // shave the trailing (down-right) side harder: the sun side of a puff is
  // denser-looking because it is lit, the lee side dissolves into shade
  for (let i = 0; i < (cfg.erode >> 1); i++) {
    const a = fxRnd(-0.9, 0.9) + Math.atan2(FX_SUN.sy, FX_SUN.sx);
    const rr = R * fxRnd(0.86, 1.24);
    fxErase(g, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr,
      R * fxRnd(0.18, 0.40), fxRnd(0.30, 0.80));
  }
  g.globalCompositeOperation = 'source-over';

  // --- 7. soften the bites -------------------------------------------------
  c = fxBlur(c, S * cfg.blur2);
  return c;
}

const MUSKET_SMOKE_CFG = {
  r: 0.255, lobes: [7, 10], spread: 0.62, aspect: 1.14, lobeMin: 0.50,
  core: 'rgba(250,247,238,0.50)',
  mid: 'rgba(232,228,216,0.30)',
  mid2: 'rgba(206,203,192,0.11)',
  edge: 'rgba(196,193,182,0)',
  crease: 'rgba(120,124,138,0.16)',
  under: 'rgba(104,114,142,0.34)',
  under2: 'rgba(78,86,112,0.30)',
  top: 'rgba(255,242,206,0.30)',
  top2: 'rgba(255,250,228,0.26)',
  creases: 5, erode: 34, holes: 10, blur1: 0.030, blur2: 0.014,
};

const CANNON_SMOKE_CFG = {
  r: 0.250, lobes: [9, 12], spread: 0.66, aspect: 1.06, lobeMin: 0.55,
  core: 'rgba(242,236,222,0.60)',
  mid: 'rgba(214,206,188,0.38)',
  mid2: 'rgba(178,170,152,0.16)',
  edge: 'rgba(162,155,138,0)',
  crease: 'rgba(96,98,110,0.20)',
  under: 'rgba(86,96,126,0.40)',
  under2: 'rgba(62,70,98,0.34)',
  top: 'rgba(255,238,198,0.34)',
  top2: 'rgba(255,248,222,0.30)',
  creases: 7, erode: 44, holes: 14, blur1: 0.026, blur2: 0.011,
};

const DUST_CFG = {
  r: 0.250, lobes: [6, 9], spread: 0.70, aspect: 1.34, lobeMin: 0.46,
  core: 'rgba(198,180,140,0.52)',
  mid: 'rgba(170,152,112,0.30)',
  mid2: 'rgba(140,124,92,0.12)',
  edge: 'rgba(132,116,86,0)',
  crease: 'rgba(104,92,68,0.20)',
  under: 'rgba(92,92,96,0.34)',
  under2: 'rgba(70,70,78,0.28)',
  top: 'rgba(232,214,168,0.34)',
  top2: 'rgba(244,230,192,0.24)',
  creases: 4, erode: 30, holes: 12, blur1: 0.024, blur2: 0.012,
};

// Dust gets a scatter of coarse grains that smoke does not have — it is
// suspended dirt, not vapour, and the grain is what tells them apart.
function bakeDustMaster(S) {
  const c = bakePuffMaster(S, DUST_CFG);
  const g = fxCtx(c);
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 70; i++) {
    const a = fxRand() * 6.28318;
    const d = Math.sqrt(fxRand()) * S * 0.30;
    const x = S * 0.5 + Math.cos(a) * d * 1.3;
    const y = S * 0.5 + Math.sin(a) * d;
    g.fillStyle = fxRand() < 0.55 ? 'rgba(112,96,68,0.34)' : 'rgba(226,210,170,0.30)';
    g.beginPath();
    g.ellipse(x, y, fxRnd(0.6, 2.0), fxRnd(0.5, 1.3), fxRand() * 3, 0, 7);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — muzzle flash
   --------------------------------------------------------------------------
   Muzzle at the CELL CENTRE, flame pointing +X, so a rotation about the cell
   centre is all that is needed to aim it and the runtime just centres the
   sprite on the muzzle point.
   -------------------------------------------------------------------------- */

function bakeFlashMaster(S, cfg) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  const L = S * 0.42;

  // --- outer glow, blurred, laid down first so everything else sits in it ---
  const glow = fxCanvas(S, S);
  const gg = fxCtx(glow);
  fxConePath(gg, cx, cy, L * 1.02, cfg.spread * 1.55, S * 0.030);
  const glowGrad = gg.createLinearGradient(cx, cy, cx + L, cy);
  glowGrad.addColorStop(0, 'rgba(255,226,150,0.55)');
  glowGrad.addColorStop(0.45, 'rgba(255,158,52,0.30)');
  glowGrad.addColorStop(1, 'rgba(178,60,10,0)');
  gg.fillStyle = glowGrad;
  gg.fill();
  fxBlob(gg, cx, cy, L * 0.55, 'rgba(255,196,96,0.42)', 'rgba(255,140,30,0)');
  g.drawImage(fxBlur(glow, S * 0.070), 0, 0);

  g.globalCompositeOperation = 'lighter';

  // --- three overlapping flame lobes at slightly different angles ----------
  for (let i = 0; i < 3; i++) {
    const ang = (i - 1) * cfg.spread * 0.55;
    const len = L * (i === 1 ? 1.0 : fxRnd(0.62, 0.86));
    g.save();
    g.translate(cx, cy);
    g.rotate(ang);
    fxConePath(g, 0, 0, len, cfg.spread * (i === 1 ? 1 : 0.72), S * 0.022);
    const lg = g.createLinearGradient(0, 0, len, 0);
    lg.addColorStop(0, '#FFFDF2');
    lg.addColorStop(0.30, '#FFD57A');
    lg.addColorStop(0.62, '#FF8A22');
    lg.addColorStop(1, 'rgba(180,60,10,0)');
    g.fillStyle = lg;
    g.fill();
    g.restore();
  }

  // --- white-hot inner jet -------------------------------------------------
  fxConePath(g, cx, cy, L * 0.60, cfg.spread * 0.40, S * 0.016);
  const jet = g.createLinearGradient(cx, cy, cx + L * 0.60, cy);
  jet.addColorStop(0, '#FFFFFF');
  jet.addColorStop(0.45, 'rgba(255,248,220,0.90)');
  jet.addColorStop(1, 'rgba(255,214,140,0)');
  g.fillStyle = jet;
  g.fill();

  // --- muzzle hot spot -----------------------------------------------------
  fxBlob(g, cx, cy, L * 0.22, '#FFFFFF', 'rgba(255,176,56,0)');
  fxBlob(g, cx + L * 0.10, cy, L * 0.13, '#FFFFFF', 'rgba(255,236,180,0)');

  // --- four-point star: this is what makes a 3-screen-pixel flash read as a
  //     flash instead of a yellow dot at 0.6x zoom -------------------------
  const rays = [
    [1, 0, L * 1.02, S * 0.030],
    [-1, 0, L * 0.34, S * 0.020],
    [0, -1, L * 0.46, S * 0.020],
    [0, 1, L * 0.46, S * 0.020],
  ];
  for (const [rx, ry, rl, rw] of rays) {
    const px = -ry, py = rx;                     // perpendicular
    g.beginPath();
    g.moveTo(cx + px * rw, cy + py * rw);
    g.lineTo(cx + rx * rl, cy + ry * rl);
    g.lineTo(cx - px * rw, cy - py * rw);
    g.closePath();
    const rg = g.createLinearGradient(cx, cy, cx + rx * rl, cy + ry * rl);
    rg.addColorStop(0, 'rgba(255,246,208,0.85)');
    rg.addColorStop(1, 'rgba(255,180,70,0)');
    g.fillStyle = rg;
    g.fill();
  }

  // --- burning-powder sparks ----------------------------------------------
  for (let i = 0; i < cfg.sparks; i++) {
    const a = fxRnd(-1, 1) * cfg.spread * 1.9;
    const d0 = L * fxRnd(0.10, 0.32);
    const d1 = d0 + L * fxRnd(0.20, 0.62);
    g.strokeStyle = fxRand() < 0.4 ? '#FFFFFF' : '#FFE2A0';
    g.lineWidth = S * fxRnd(0.008, 0.020);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
    g.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1);
    g.stroke();
  }
  // a couple of detached embers at the tip
  for (let i = 0; i < (cfg.sparks >> 1); i++) {
    const a = fxRnd(-1, 1) * cfg.spread * 2.2;
    const d = L * fxRnd(0.55, 1.05);
    fxBlob(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d, S * fxRnd(0.012, 0.028),
      'rgba(255,238,180,0.9)', 'rgba(255,140,40,0)');
  }

  g.globalCompositeOperation = 'source-over';
  return c;
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — blood spray (directional fan, +X)
   -------------------------------------------------------------------------- */

function bakeBloodMaster(S) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  const L = S * 0.42;

  // soft stain under the fan, so it reads as wet rather than as confetti
  const halo = g.createRadialGradient(cx + L * 0.26, cy, 0, cx + L * 0.26, cy, L * 0.66);
  halo.addColorStop(0, 'rgba(102,26,20,0.40)');
  halo.addColorStop(0.6, 'rgba(84,20,16,0.18)');
  halo.addColorStop(1, 'rgba(74,18,16,0)');
  g.fillStyle = halo;
  g.beginPath(); g.ellipse(cx + L * 0.26, cy, L * 0.66, L * 0.44, 0, 0, 7); g.fill();

  // core splash right at the impact
  g.fillStyle = '#5E1512';
  g.beginPath(); g.ellipse(cx + L * 0.06, cy, L * 0.21, L * 0.14, 0, 0, 7); g.fill();
  g.fillStyle = '#7A1E18';
  g.beginPath(); g.ellipse(cx + L * 0.02, cy - L * 0.03, L * 0.13, L * 0.08, 0, 0, 7); g.fill();

  // ballistic droplets — denser and larger near the wound, sparser and finer
  // toward the tip, exactly the way a spatter pattern actually distributes
  const n = 18 + ((fxRand() * 8) | 0);
  const px = S / 64;
  for (let i = 0; i < n; i++) {
    const a = fxRnd(-0.48, 0.48);
    const t = Math.pow(fxRand(), 0.62);
    const d = t * L;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const r = fxRnd(0.7, 2.7) * px * (1 - t * 0.45);
    g.fillStyle = t < 0.45 ? '#7A1E18' : t < 0.78 ? '#661A16' : '#4A1210';
    g.beginPath();
    g.ellipse(x, y, r * fxRnd(1.0, 2.1), r, a, 0, 7);
    g.fill();
  }

  // a few fast streaks that outrun the droplets
  for (let i = 0; i < 5; i++) {
    const a = fxRnd(-0.40, 0.40);
    const d0 = L * fxRnd(0.15, 0.45);
    const d1 = d0 + L * fxRnd(0.18, 0.50);
    g.strokeStyle = fxRand() < 0.5 ? 'rgba(122,30,24,0.88)' : 'rgba(90,22,18,0.80)';
    g.lineWidth = px * fxRnd(0.9, 2.0);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
    g.lineTo(cx + Math.cos(a) * d1, cy + Math.sin(a) * d1);
    g.stroke();
  }

  // one specular glint on the up-left of the core so it reads as liquid
  g.globalCompositeOperation = 'source-atop';
  fxBlob(g, cx + FX_SUN.x * L * 0.10, cy + FX_SUN.y * L * 0.10, L * 0.14,
    'rgba(214,120,96,0.30)', 'rgba(214,120,96,0)');
  g.globalCompositeOperation = 'source-over';
  return c;
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — dirt column (shell impact plume). Base at bottom centre.
   -------------------------------------------------------------------------- */

function bakeDirtColumnMaster(S) {
  let c = fxCanvas(S, S);
  let g = fxCtx(c);
  const cx = S * 0.5;
  const baseY = S * 0.93;
  const H = S * 0.80;

  // --- wide, low skirt of thrown earth at the base ------------------------
  for (let i = 0; i < 12; i++) {
    const x = cx + fxRnd(-1, 1) * S * 0.30;
    const y = baseY - fxRnd(0, 1) * S * 0.06;
    const r = S * fxRnd(0.05, 0.12);
    const gr = g.createRadialGradient(x + FX_SUN.x * r * 0.4, y + FX_SUN.y * r * 0.4, r * 0.05, x, y, r);
    gr.addColorStop(0, 'rgba(150,120,80,0.62)');
    gr.addColorStop(0.45, 'rgba(102,80,52,0.44)');
    gr.addColorStop(1, 'rgba(62,48,32,0)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(x, y, r * 1.4, r * 0.8, 0, 0, 7); g.fill();
  }

  // --- the column itself: lobes stacked up a slightly leaning axis ---------
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const y = baseY - H * Math.pow(t, 0.86);
    const lean = Math.sin(t * 2.3) * S * 0.030 + t * t * S * 0.055 * FX_SUN.x;
    const w = S * (0.060
      + 0.130 * Math.sin(Math.PI * Math.min(1, t * 1.28))
      + 0.055 * (1 - t));
    const lit = 1 - t * 0.30;
    for (let j = 0; j < 3; j++) {
      const jx = cx + lean + fxRnd(-w * 0.65, w * 0.65);
      const jy = y + fxRnd(-w * 0.38, w * 0.38);
      const r = w * fxRnd(0.55, 1.05);
      const gr = g.createRadialGradient(
        jx + FX_SUN.x * r * 0.38, jy + FX_SUN.y * r * 0.38, r * 0.05, jx, jy, r);
      gr.addColorStop(0, 'rgba(152,122,80,' + (0.60 * lit).toFixed(3) + ')');
      gr.addColorStop(0.42, 'rgba(104,82,54,' + (0.44 * lit).toFixed(3) + ')');
      gr.addColorStop(0.80, 'rgba(72,56,38,' + (0.16 * lit).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(62,48,32,0)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(jx, jy, r, 0, 7); g.fill();
    }
  }

  // --- directional shading over the whole plume ---------------------------
  g.globalCompositeOperation = 'source-atop';
  const shade = g.createLinearGradient(
    cx - S * 0.22, baseY - H * 0.9, cx + S * 0.26, baseY);
  shade.addColorStop(0, 'rgba(255,238,196,0.26)');
  shade.addColorStop(0.42, 'rgba(255,238,196,0)');
  shade.addColorStop(0.62, 'rgba(30,26,44,0)');
  shade.addColorStop(1, 'rgba(30,26,44,0.40)');
  g.fillStyle = shade;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  // --- ballistic grit and clods thrown clear of the column ----------------
  for (let i = 0; i < 30; i++) {
    const a = fxRnd(-2.55, -0.60);              // upward fan
    const d = S * fxRnd(0.16, 0.46);
    const x = cx + Math.cos(a) * d * 1.25;
    const y = baseY - H * 0.18 + Math.sin(a) * d;
    const r = S * fxRnd(0.006, 0.020);
    g.fillStyle = fxRand() < 0.6 ? 'rgba(58,45,30,0.85)' : 'rgba(126,100,66,0.80)';
    g.beginPath(); g.ellipse(x, y, r * fxRnd(1, 2.2), r, a, 0, 7); g.fill();
    if (fxRand() < 0.45) {
      g.strokeStyle = 'rgba(94,74,50,0.45)';
      g.lineWidth = r * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - Math.cos(a) * S * 0.045, y - Math.sin(a) * S * 0.045);
      g.stroke();
    }
  }

  c = fxBlur(c, S * 0.010);
  g = fxCtx(c);

  // --- erode the silhouette so it is not a smooth airbrushed cone ---------
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    const t = fxRand();
    const y = baseY - H * t;
    const w = S * (0.075 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 1.28)));
    const side = fxRand() < 0.5 ? -1 : 1;
    fxErase(g, cx + side * w * fxRnd(0.75, 1.30), y,
      S * fxRnd(0.020, 0.065), fxRnd(0.35, 1.0));
  }
  for (let i = 0; i < 10; i++) {
    fxErase(g, cx + fxRnd(-1, 1) * S * 0.09, baseY - H * fxRand(),
      S * fxRnd(0.014, 0.036), fxRnd(0.10, 0.34));
  }
  g.globalCompositeOperation = 'source-over';

  return fxBlur(c, S * 0.006);
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — debris chip (splintered wood / earth clod / stone flake)
   -------------------------------------------------------------------------- */

function bakeDebrisMaster(S) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  const R = S * 0.30;
  const pts = 4 + ((fxRand() * 3) | 0);
  const path = [];
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * 6.28318 + fxRnd(-0.25, 0.25);
    const r = R * fxRnd(0.45, 1.0);
    path.push([cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r]);
  }
  const body = fxPick(['#2B261E', '#3A3126', '#4A3B2C', '#2F2A22']);

  // cast shadow first, offset along +FX_SUN.shadow
  g.fillStyle = 'rgba(' + FX_SUN.shadowRGB + ',0.30)';
  g.beginPath();
  g.moveTo(path[0][0] + FX_SUN.sx * S * 0.06, path[0][1] + FX_SUN.sy * S * 0.06);
  for (let i = 1; i < path.length; i++) {
    g.lineTo(path[i][0] + FX_SUN.sx * S * 0.06, path[i][1] + FX_SUN.sy * S * 0.06);
  }
  g.closePath(); g.fill();

  // body
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(path[0][0], path[0][1]);
  for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
  g.closePath(); g.fill();

  // lit facet on the sun side + a hard lining so it survives minification
  g.globalCompositeOperation = 'source-atop';
  const lit = g.createLinearGradient(
    cx + FX_SUN.x * R, cy + FX_SUN.y * R, cx + FX_SUN.sx * R, cy + FX_SUN.sy * R);
  lit.addColorStop(0, 'rgba(255,233,188,0.55)');
  lit.addColorStop(0.5, 'rgba(255,233,188,0)');
  lit.addColorStop(1, 'rgba(' + FX_SUN.shadowRGB + ',0.45)');
  g.fillStyle = lit;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  g.strokeStyle = 'rgba(16,13,10,0.85)';
  g.lineWidth = Math.max(1, S * 0.035);
  g.beginPath();
  g.moveTo(path[0][0], path[0][1]);
  for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
  g.closePath(); g.stroke();
  return c;
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — ember / spark (drawn additively)
   -------------------------------------------------------------------------- */

function bakeEmberMaster(S) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  g.globalCompositeOperation = 'lighter';
  fxBlob(g, cx, cy, S * 0.42, 'rgba(255,150,44,0.55)', 'rgba(190,60,10,0)');
  fxBlob(g, cx, cy, S * 0.20, 'rgba(255,226,150,0.95)', 'rgba(255,150,44,0)');
  fxBlob(g, cx, cy, S * 0.085, '#FFFFFF', 'rgba(255,244,206,0)');
  // a short tail, so a spark reads as moving
  const a = fxRand() * 6.28318;
  const rg = g.createLinearGradient(cx, cy, cx + Math.cos(a) * S * 0.4, cy + Math.sin(a) * S * 0.4);
  rg.addColorStop(0, 'rgba(255,206,120,0.70)');
  rg.addColorStop(1, 'rgba(255,140,40,0)');
  g.strokeStyle = rg;
  g.lineWidth = S * 0.075;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a) * S * 0.4, cy + Math.sin(a) * S * 0.4);
  g.stroke();
  g.globalCompositeOperation = 'source-over';
  return c;
}

/* --------------------------------------------------------------------------
   MASTER PAINTER — cannonball with motion tail (ball centred, tail toward -X)
   -------------------------------------------------------------------------- */

function bakeBallMaster(S, cfg) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  const R = S * 0.115;

  // --- motion streak: at ~320 world px/s the ball covers roughly its own
  //     diameter per frame, so without this it strobes as discrete dots ----
  const tail = g.createLinearGradient(cx - S * 0.42, cy, cx, cy);
  tail.addColorStop(0, cfg.tail0);
  tail.addColorStop(0.55, cfg.tail1);
  tail.addColorStop(1, cfg.tail2);
  g.strokeStyle = tail;
  g.lineWidth = R * 1.55;
  g.beginPath();
  g.moveTo(cx - S * 0.42, cy);
  g.lineTo(cx - R * 0.2, cy);
  g.stroke();
  // a fainter, wider wake around the streak
  g.strokeStyle = cfg.wake;
  g.lineWidth = R * 2.6;
  g.beginPath();
  g.moveTo(cx - S * 0.30, cy);
  g.lineTo(cx - R * 0.4, cy);
  g.stroke();

  // --- the ball: lit up-left, dark lower-right, hard lining ---------------
  const rg = g.createRadialGradient(
    cx + FX_SUN.x * R * 0.46, cy + FX_SUN.y * R * 0.46, R * 0.06, cx, cy, R * 1.02);
  rg.addColorStop(0, cfg.hi);
  rg.addColorStop(0.44, cfg.body);
  rg.addColorStop(1, cfg.lo);
  g.fillStyle = rg;
  g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();

  // lower-right terminator crescent
  g.globalCompositeOperation = 'source-atop';
  fxBlob(g, cx + FX_SUN.sx * R * 0.75, cy + FX_SUN.sy * R * 0.75, R * 0.95,
    'rgba(' + FX_SUN.shadowRGB + ',0.55)', 'rgba(' + FX_SUN.shadowRGB + ',0)');
  g.globalCompositeOperation = 'source-over';

  // specular
  g.fillStyle = cfg.spec;
  g.beginPath();
  g.ellipse(cx + FX_SUN.x * R * 0.44, cy + FX_SUN.y * R * 0.44, R * 0.32, R * 0.20, -0.88, 0, 7);
  g.fill();

  // lining
  g.strokeStyle = cfg.line;
  g.lineWidth = Math.max(1, S * 0.020);
  g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  return c;
}

const BALL_CFGS = [
  { // iron roundshot
    hi: '#6E6E78', body: '#2B2B31', lo: '#0E0E12', spec: 'rgba(196,198,210,0.55)',
    line: 'rgba(8,8,12,0.95)',
    tail0: 'rgba(44,44,52,0)', tail1: 'rgba(44,44,52,0.28)', tail2: 'rgba(52,52,60,0.55)',
    wake: 'rgba(120,122,134,0.10)',
  },
  { // stone shot from towers
    hi: '#DAD2BA', body: '#A79E86', lo: '#5E5748', spec: 'rgba(255,250,232,0.6)',
    line: 'rgba(38,32,24,0.9)',
    tail0: 'rgba(150,142,122,0)', tail1: 'rgba(150,142,122,0.22)', tail2: 'rgba(164,156,134,0.48)',
    wake: 'rgba(196,190,170,0.10)',
  },
];

/* --------------------------------------------------------------------------
   Powder-bank / light-spill stamp sprites
   -------------------------------------------------------------------------- */

function bakeBankStamp(S, tint, peak) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5, cy = S * 0.5;
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
  gr.addColorStop(0, 'rgba(' + tint + ',' + peak.toFixed(3) + ')');
  gr.addColorStop(0.42, 'rgba(' + tint + ',' + (peak * 0.52).toFixed(3) + ')');
  gr.addColorStop(1, 'rgba(' + tint + ',0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(cx, cy, S * 0.5, 0, 7); g.fill();
  // warm top / cool bottom, so both blit passes read as correctly lit
  g.globalCompositeOperation = 'source-atop';
  const vg = g.createLinearGradient(cx + FX_SUN.x * S * 0.4, cy + FX_SUN.y * S * 0.4,
    cx + FX_SUN.sx * S * 0.4, cy + FX_SUN.sy * S * 0.4);
  vg.addColorStop(0, 'rgba(255,242,208,0.34)');
  vg.addColorStop(0.5, 'rgba(255,242,208,0)');
  vg.addColorStop(1, 'rgba(120,130,158,0.34)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';
  // break the perfect circle a little
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 12; i++) {
    const a = fxRand() * 6.28318;
    fxErase(g, cx + Math.cos(a) * S * fxRnd(0.30, 0.48),
      cy + Math.sin(a) * S * fxRnd(0.30, 0.48),
      S * fxRnd(0.08, 0.18), fxRnd(0.2, 0.6));
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

function bakeSpillStamp(S) {
  const c = fxCanvas(S, S);
  const g = fxCtx(c);
  const cx = S * 0.5;
  const gr = g.createRadialGradient(cx, cx, 0, cx, cx, S * 0.5);
  gr.addColorStop(0, 'rgba(255,214,140,0.80)');
  gr.addColorStop(0.35, 'rgba(255,166,64,0.34)');
  gr.addColorStop(1, 'rgba(255,120,24,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(cx, cx, S * 0.5, 0, 7); g.fill();
  return c;
}

/* --------------------------------------------------------------------------
   SET BAKERS — pack masters into atlases with pre-multiplied opacity so the
   runtime never assigns globalAlpha.
   -------------------------------------------------------------------------- */

// layout: col = alpha index, row = shape index
function bakeAlphaSet(cell, shapes, alphas, aMin, aMax, gamma, makeMaster) {
  const tex = fxCanvas(cell * alphas, cell * shapes);
  const g = tex.getContext('2d');
  for (let s = 0; s < shapes; s++) {
    const m = makeMaster();
    for (let a = 0; a < alphas; a++) {
      const t = alphas === 1 ? 1 : a / (alphas - 1);
      g.globalAlpha = aMin + (aMax - aMin) * Math.pow(t, gamma);
      g.drawImage(m, a * cell, s * cell);
    }
  }
  g.globalAlpha = 1;
  return { tex, cell, alphas, shapes };
}

// layout: col = rotation index, row = alpha index (single master)
function bakeRotAlphaSet(cell, rots, alphas, aMin, aMax, master) {
  const tex = fxCanvas(cell * rots, cell * alphas);
  const g = tex.getContext('2d');
  const h = cell * 0.5;
  for (let a = 0; a < alphas; a++) {
    const t = alphas === 1 ? 1 : a / (alphas - 1);
    g.globalAlpha = aMin + (aMax - aMin) * t;
    for (let r = 0; r < rots; r++) {
      g.save();
      g.translate(r * cell + h, a * cell + h);
      g.rotate(r * 6.283185307179586 / rots);
      g.drawImage(master, -h, -h);
      g.restore();
    }
  }
  g.globalAlpha = 1;
  return { tex, cell, rots, alphas };
}

// layout: col = rotation index, row = variant*alphas + alpha index
function bakeVarRotAlphaSet(cell, vars, rots, alphas, aMin, aMax, makeMaster) {
  const tex = fxCanvas(cell * rots, cell * vars * alphas);
  const g = tex.getContext('2d');
  const h = cell * 0.5;
  for (let v = 0; v < vars; v++) {
    const master = makeMaster();
    for (let a = 0; a < alphas; a++) {
      const t = alphas === 1 ? 1 : a / (alphas - 1);
      g.globalAlpha = aMin + (aMax - aMin) * t;
      const row = v * alphas + a;
      for (let r = 0; r < rots; r++) {
        g.save();
        g.translate(r * cell + h, row * cell + h);
        g.rotate(r * 6.283185307179586 / rots);
        g.drawImage(master, -h, -h);
        g.restore();
      }
    }
  }
  g.globalAlpha = 1;
  return { tex, cell, vars, rots, alphas };
}

/* =============================================================================
   PUBLIC BAKE ENTRY POINT
   ============================================================================= */

let fxTex = null;                    // all baked texture sets
let smokeBank = null, smokeBankCtx = null;
let bankScratch = null, bankScratchCtx = null;
let spillField = null, spillCtx = null;
let bankW = 0, bankH = 0;
let bankDriftX = 0, bankDriftY = 0;
let fxFrame = 0;
let spillHot = 0;                 // frames of spill decay still worth running
let bankHot = 0;                  // frames since the bank last received powder
let fxVarCtr = 0;                 // per-particle variant/rotation dealer

// VERIFIED against the live sim.js: smokePuff() and flash() take a `big`
// argument but do NOT store it on the particle, and neither writes `v`
// (shape variant), `a` (angle) or `cls` (flash size class). Reading `p.big`
// therefore yields undefined forever, and `p.v & MASK` yields 0 forever.
// Left uncorrected that means: the cannon smoke atlas and the large flash
// atlas (~13 MB of bake) NEVER draw, every cannon shot looks like a musket
// shot, and every puff/dust/ember on screen is the byte-identical shape 0.
// fxClassify() below recovers all three from fields the sim DOES set, and
// is a no-op the moment sim starts writing them properly.
const SMOKE_BIG_MAX = 1.2;        // sim: big 1.6s vs small 0.9s
const FLASH_BIG_SIZE = 6.5;       // sim: big 9 vs small 4
const GOLDEN_ANGLE = 2.399963229728653;

function fxClassify(p) {
  p.st = 1;
  // Bounded so `p.v * GOLDEN_ANGLE` stays small enough that the later
  // `| 0` rotation index never runs into ToInt32 wrapping.
  if (p.v === undefined) p.v = (fxVarCtr = (fxVarCtr + 1) & 0xffff);
  const k = p.kind;
  if (k === 'smoke') {
    if (p.big === undefined) p.big = p.max > SMOKE_BIG_MAX;
  } else if (k === 'flash') {
    if (p.big === undefined) p.big = p.size >= FLASH_BIG_SIZE;
    if (p.cls === undefined) p.cls = p.big ? 2 : 0;
    // The sim discards the shot vector it already computes, so the true
    // muzzle angle is unrecoverable here. A fixed fallback would point every
    // flash in an army due east — a far louder artifact over 400 simultaneous
    // flashes than an individually wrong 0.1s cone. Deal golden-angle
    // rotations so the volley reads as scattered fire, and delete this the
    // moment sim.js passes the (nx,ny) it already has.
    if (p.a === undefined) p.a = (p.v * GOLDEN_ANGLE) % 6.283185307179586;
  }
}

const BANK_DIV = 8;               // powder bank resolution = WORLD / 8
// 8-bit decay note: a per-frame multiplicative decay on an 8-bit surface stalls
// once dst*(1-k) rounds back to dst, i.e. below 0.5/k. A gentle per-frame decay
// therefore never dissipates at all (k=0.0012 stalls at 416/255 — nothing ever
// fades). Applying a LARGER decay LESS often decouples half-life from the
// residue floor: k=0.06 every 16 frames gives a ~3.0 s half-life with a floor
// of 8/255, which blitted at 0.50 alpha is ~1.5% screen opacity — below
// perceptual threshold, and what little remains reads as ground scorch exactly
// where the fighting was. Both constants are inlined as literal rgba strings at
// the use site so the runtime allocates no strings.
const BANK_DECAY_EVERY = 16;      // decay alpha 0.06, see fillStyle below
                                  // spill decay alpha 0.10 per frame

function buildParticleTextures() {
  if (fxTex) return fxTex;
  fxSeed = 0x9e3779b9;

  fxTex = {};

  // ---- smoke ------------------------------------------------------------
  fxTex.smoke = bakeAlphaSet(SMOKE_CELL, SMOKE_SHAPES, SMOKE_ALPHAS, 0.05, 0.60, 0.88,
    () => bakePuffMaster(SMOKE_CELL, MUSKET_SMOKE_CFG));
  fxTex.csmoke = bakeAlphaSet(CSMK_CELL, CSMK_SHAPES, CSMK_ALPHAS, 0.06, 0.76, 0.85,
    () => bakePuffMaster(CSMK_CELL, CANNON_SMOKE_CFG));

  // ---- dust -------------------------------------------------------------
  fxTex.dust = bakeAlphaSet(DUST_CELL, DUST_SHAPES, DUST_ALPHAS, 0.06, 0.62, 0.90,
    () => bakeDustMaster(DUST_CELL));

  // ---- muzzle flash, three size classes ---------------------------------
  fxTex.flash = [
    bakeRotAlphaSet(FLASH_CELLS[0], ROT, FLASH_ALPHAS, 0.24, 1.0,
      bakeFlashMaster(FLASH_CELLS[0], { spread: 0.30, sparks: 8 })),
    bakeRotAlphaSet(FLASH_CELLS[1], ROT, FLASH_ALPHAS, 0.24, 1.0,
      bakeFlashMaster(FLASH_CELLS[1], { spread: 0.34, sparks: 10 })),
    bakeRotAlphaSet(FLASH_CELLS[2], ROT, FLASH_ALPHAS, 0.24, 1.0,
      bakeFlashMaster(FLASH_CELLS[2], { spread: 0.40, sparks: 14 })),
  ];

  // ---- blood ------------------------------------------------------------
  fxTex.blood = bakeVarRotAlphaSet(BLOOD_CELL, BLOOD_VARS, ROT, BLOOD_ALPHAS, 0.30, 1.0,
    () => bakeBloodMaster(BLOOD_CELL));

  // ---- impact plume -----------------------------------------------------
  fxTex.dirt = bakeAlphaSet(DIRT_CELL, DIRT_VARS, DIRT_ALPHAS, 0.08, 0.95, 0.9,
    () => bakeDirtColumnMaster(DIRT_CELL));

  // ---- debris chips -----------------------------------------------------
  fxTex.debris = bakeAlphaSet(DEBRIS_CELL, DEBRIS_VARS, DEBRIS_ALPHAS, 0.25, 1.0, 1.0,
    () => bakeDebrisMaster(DEBRIS_CELL));

  // ---- embers -----------------------------------------------------------
  fxTex.ember = bakeAlphaSet(EMBER_CELL, EMBER_VARS, EMBER_ALPHAS, 0.15, 1.0, 1.0,
    () => bakeEmberMaster(EMBER_CELL));

  // ---- projectiles ------------------------------------------------------
  {
    const tex = fxCanvas(BALL_CELL * ROT, BALL_CELL * BALL_VARS);
    const g = tex.getContext('2d');
    const h = BALL_CELL * 0.5;
    for (let v = 0; v < BALL_VARS; v++) {
      const m = bakeBallMaster(BALL_CELL, BALL_CFGS[v]);
      for (let r = 0; r < ROT; r++) {
        g.save();
        g.translate(r * BALL_CELL + h, v * BALL_CELL + h);
        g.rotate(r * 6.283185307179586 / ROT);
        g.drawImage(m, -h, -h);
        g.restore();
      }
    }
    fxTex.ball = { tex, cell: BALL_CELL };
  }

  // ---- projectile ground shadow, indexed by arc height -------------------
  {
    const S = BSHADOW_CELL;
    const tex = fxCanvas(S * BSHADOW_STEPS, S);
    const g = tex.getContext('2d');
    for (let i = 0; i < BSHADOW_STEPS; i++) {
      const hgt = i / (BSHADOW_STEPS - 1);        // 0 = on the ground, 1 = apex
      const a = 0.36 * (1 - 0.55 * hgt);
      const rx = S * 0.42 * (1 - 0.40 * hgt);
      const cx = i * S + S * 0.5, cy = S * 0.5;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
      gr.addColorStop(0, 'rgba(' + FX_SUN.shadowRGB + ',' + a.toFixed(3) + ')');
      gr.addColorStop(0.55, 'rgba(' + FX_SUN.shadowRGB + ',' + (a * 0.44).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(' + FX_SUN.shadowRGB + ',0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(cx, cy, rx, rx * FX_SUN.squash, 0, 0, 7); g.fill();
    }
    fxTex.ballShadow = { tex, cell: S, steps: BSHADOW_STEPS };
  }

  // ---- persistent-field stamps ------------------------------------------
  // Peak alphas are deliberately low: the bank must build over a sustained
  // firing line, not saturate off three shots. source-over accumulation means
  // n overlapping small stamps reach 1-(1-0.10)^n, so ~20 shots in one place
  // approaches an opaque bank, which is about one musket volley cycle.
  fxTex.bankStampSmall = bakeBankStamp(48, '236,232,220', 0.10);
  fxTex.bankStampBig = bakeBankStamp(64, '224,218,202', 0.24);
  fxTex.spillStamp = bakeSpillStamp(64);

  // ---- persistent fields ------------------------------------------------
  bankW = Math.ceil(WORLD.w / BANK_DIV);
  bankH = Math.ceil(WORLD.h / BANK_DIV);
  smokeBank = fxCanvas(bankW, bankH);
  smokeBankCtx = smokeBank.getContext('2d');
  smokeBankCtx.imageSmoothingQuality = 'high';
  bankScratch = fxCanvas(bankW, bankH);
  bankScratchCtx = bankScratch.getContext('2d');
  spillField = fxCanvas(bankW, bankH);
  spillCtx = spillField.getContext('2d');

  return fxTex;
}

// Call at the start of every battle so a rematch does not inherit last game's
// powder. Cheap: two clears of a 650x400 surface.
function resetEffectFields() {
  if (!smokeBank) return;
  smokeBankCtx.setTransform(1, 0, 0, 1, 0, 0);
  smokeBankCtx.globalCompositeOperation = 'source-over';
  smokeBankCtx.clearRect(0, 0, bankW, bankH);
  spillCtx.setTransform(1, 0, 0, 1, 0, 0);
  spillCtx.globalCompositeOperation = 'source-over';
  spillCtx.clearRect(0, 0, bankW, bankH);
  bankScratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  bankScratchCtx.globalCompositeOperation = 'source-over';
  bankScratchCtx.clearRect(0, 0, bankW, bankH);
  bankDriftX = 0; bankDriftY = 0;
  fxFrame = 0;
  spillHot = 0;
  bankHot = 0;
  fxVarCtr = 0;
}

/* =============================================================================
   ==============================  RUNTIME  ====================================
   No ctx.filter, no ctx.shadowBlur, no gradient construction, no template
   literals, no per-particle globalAlpha below this line.
   ============================================================================= */

function stampBank(x, y, r, big) {
  const s = big ? fxTex.bankStampBig : fxTex.bankStampSmall;
  const d = r * 2 / BANK_DIV;
  smokeBankCtx.drawImage(s, x / BANK_DIV - d * 0.5, y / BANK_DIV - d * 0.5, d, d);
  // ~15s of decay after the last shot: five half-lives, which takes a fully
  // saturated bank below the 8-bit residue floor before the hard clear lands.
  bankHot = 900;
}

function stampSpill(x, y, r) {
  const d = r * 2 / BANK_DIV;
  spillCtx.drawImage(fxTex.spillStamp, x / BANK_DIV - d * 0.5, y / BANK_DIV - d * 0.5, d, d);
  spillHot = 40;
}

/*  fxBlitField — draw one of the WORLD/8 persistent fields, clipped to the
 *  camera frustum with a 9-argument source-rect drawImage.
 *
 *  The field is conceptually pinned to the destination rect
 *  (dx0, dy0, dw, dh) in WORLD space — normally (0, 0, WORLD.w, WORLD.h), but
 *  the rising pass deliberately offsets and oversizes it so the high smoke
 *  parallaxes against the ground-hugging copy.
 *
 *  Blitting the whole 5200x3200 destination and letting the canvas clip is
 *  correct but wasteful: Chrome still sets up the full sampling transform, and
 *  at zoom 0.9 on a 1920x1080 viewport the visible world rect is ~2133x1200,
 *  i.e. 15% of the field. Clipping the SOURCE as well means the upscale filter
 *  only ever touches texels that can reach the screen.
 */
function fxBlitField(ctx, field, a, dx0, dy0, dw, dh) {
  const z = camera.zoom;
  const m = BANK_DIV * 3;                 // ~3 field texels of slack
  let x0 = camera.x - cw / 2 / z - m;
  let x1 = camera.x + cw / 2 / z + m;
  let y0 = camera.y - ch / 2 / z - m;
  let y1 = camera.y + ch / 2 / z + m;
  const dx1 = dx0 + dw, dy1 = dy0 + dh;
  if (x0 < dx0) x0 = dx0;
  if (y0 < dy0) y0 = dy0;
  if (x1 > dx1) x1 = dx1;
  if (y1 > dy1) y1 = dy1;
  if (x1 - x0 < 1 || y1 - y0 < 1) return;
  const kx = bankW / dw, ky = bankH / dh;
  ctx.globalAlpha = a;
  ctx.drawImage(field,
    (x0 - dx0) * kx, (y0 - dy0) * ky, (x1 - x0) * kx, (y1 - y0) * ky,
    x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1;
}

/* --------------------------------------------------------------------------
   Renderer-side particle injection.

   sim.js only ever spawns 'smoke' and 'flash', and its integrator only grows
   'smoke'. Everything below therefore (a) marks itself `st: 1` so
   updateEffectFields does not re-seed the persistent fields from it, (b) deals
   its own `v` / `a` / `cls` so no atlas index is ever undefined, and (c) carries
   `grow` which the DRAW code applies for 'dust' and 'dirt' (see the air layer),
   because sim will not.

   These are one-shot bursts triggered by an event that already exists in the
   codebase, so the steady-state particle budget is unchanged.
   -------------------------------------------------------------------------- */

const FX_PART_CAP = 900;                  // mirror of sim.js PARTICLE_CAP

function fxPush(world, p) {
  const arr = world.particles;
  if (arr.length >= FX_PART_CAP) return;
  p.st = 1;
  p.v = (fxVarCtr = (fxVarCtr + 1) & 0x3fffffff);
  p.life = 0;
  arr.push(p);
}

function fxBurstDebris(world, x, y, n, spd, life, size) {
  for (let i = 0; i < n; i++) {
    const a = fxRand() * 6.283185307179586;
    const v = spd * (0.35 + fxRand() * 0.65);
    fxPush(world, {
      kind: 'debris', x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.62 - v * 0.35,
      max: life * (0.7 + fxRand() * 0.6), size: size * (0.6 + fxRand() * 0.8), grow: 0,
    });
  }
}

/*  fxNoteDecal — call once per entry while render.js is draining
 *  world.pendingDecals, alongside paintDecal(d).
 *
 *  The decal list is the only place in the codebase where "something just died"
 *  is reported to the renderer, and it is currently used for one flat stamp and
 *  nothing else. Every kind here already exists in sim.js; none of this needs a
 *  sim change.
 */
function fxNoteDecal(world, d) {
  if (!fxTex) return;
  const x = d.x, y = d.y;
  switch (d.kind) {
    case 'ruin': {
      // A building coming down. This is the largest single visual event in the
      // game and it currently has no visual at all beyond a rubble stamp.
      // Scale the burst by footprint so a watch tower is not a town centre.
      const def = (typeof BUILDING_TYPES !== 'undefined' && d.type)
        ? BUILDING_TYPES[d.type] : null;
      const w = def ? def.w : 80;
      const k = w / 100;
      stampBank(x, y, 40 * k, true);
      stampBank(x - w * 0.22, y + 6, 26 * k, true);
      stampBank(x + w * 0.22, y + 2, 26 * k, true);
      // a low ring of dust rolling outward from the footprint
      for (let i = 0; i < 7; i++) {
        const a = fxRand() * 6.283185307179586;
        const r = w * (0.10 + fxRand() * 0.34);
        fxPush(world, {
          kind: 'dust', x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.55 + 4,
          vx: Math.cos(a) * 26, vy: Math.sin(a) * 13 - 9,
          max: 1.9 + fxRand() * 1.1, size: 12 * k + fxRand() * 9, grow: 1.5,
        });
      }
      // the column of dust punched straight up out of the collapse
      fxPush(world, {
        kind: 'dirt', x, y: y + 4, vx: 0, vy: -14,
        max: 1.15, size: 20 * k, grow: 0.55,
      });
      fxBurstDebris(world, x, y, 9, 86, 1.0, 3.4 * k);
      if (typeof mmNoteEvent === 'function') mmNoteEvent(x, y, 2);
      break;
    }
    case 'crater': {
      // Roundshot striking the earth. explodeShell already spawns two puffs and
      // a flash; what it never had was the thrown earth that makes an impact
      // read as an impact rather than as a bloom.
      fxPush(world, {
        kind: 'dirt', x, y, vx: 0, vy: -6,
        max: 0.72, size: 15, grow: 0.75,
      });
      fxBurstDebris(world, x, y, 7, 120, 0.62, 2.4);
      for (let i = 0; i < 3; i++) {
        const a = fxRand() * 6.283185307179586;
        fxPush(world, {
          kind: 'ember', x, y,
          vx: Math.cos(a) * 70, vy: Math.sin(a) * 42 - 34,
          max: 0.34 + fxRand() * 0.22, size: 2.0 + fxRand() * 1.4, grow: 0,
        });
      }
      if (typeof mmNoteEvent === 'function') mmNoteEvent(x, y, 1);
      break;
    }
    case 'wreck': {
      // A gun going over: splintered carriage, no fireball.
      stampBank(x, y, 16, false);
      fxBurstDebris(world, x, y, 6, 72, 0.85, 2.8);
      fxPush(world, {
        kind: 'dust', x, y: y + 2, vx: 4, vy: -11,
        max: 1.3, size: 13, grow: 1.1,
      });
      if (typeof mmNoteEvent === 'function') mmNoteEvent(x, y, 0);
      break;
    }
    default: {
      // A man falling. The blood is baked into the corpse stamp itself, so all
      // that is wanted here is the minimap ping — the cheapest possible way to
      // answer "where is the fighting" without looking away from the field.
      if (typeof mmNoteEvent === 'function') mmNoteEvent(x, y, 0);
      break;
    }
  }
}

/*  updateEffectFields — O(1) in unit count.
 *  Decay, wind-drift, then drain the frame's stamp queue.
 */
function updateEffectFields(world) {
  fxFrame++;

  // --- decay -------------------------------------------------------------
  // Multiplicative destination-out decay on an 8-bit surface has a hard floor:
  // once dst*(1-k) rounds back to dst it stops decaying entirely, so BOTH
  // fields would otherwise keep a permanent residue everywhere anything ever
  // fired. The floor is faint, but on the additive spill field it is a warm
  // glow that never leaves, and on the bank it is haze that outlives the
  // battle. Each field therefore also gets a hard clear once it has gone
  // quiet long enough that nothing above the floor can still be present.
  if (bankHot > 0) {
    bankHot--;
    if ((fxFrame % BANK_DECAY_EVERY) === 0) {
      smokeBankCtx.globalCompositeOperation = 'destination-out';
      smokeBankCtx.fillStyle = 'rgba(0,0,0,0.06)';
      smokeBankCtx.fillRect(0, 0, bankW, bankH);
      smokeBankCtx.globalCompositeOperation = 'source-over';
    }
    if (bankHot === 0) smokeBankCtx.clearRect(0, 0, bankW, bankH);
  }
  if (spillHot > 0) {
    spillHot--;
    spillCtx.globalCompositeOperation = 'destination-out';
    spillCtx.fillStyle = 'rgba(0,0,0,0.1)';
    spillCtx.fillRect(0, 0, bankW, bankH);
    spillCtx.globalCompositeOperation = 'source-over';
    if (spillHot === 0) spillCtx.clearRect(0, 0, bankW, bankH);
  }

  // --- wind drift: whole-pixel self-blit, ~1 shift every 7 frames ---------
  bankDriftX += 0.145;
  bankDriftY -= 0.052;
  const dx = bankDriftX | 0;
  const dy = bankDriftY < 0 ? -((-bankDriftY) | 0) : (bankDriftY | 0);
  if (dx !== 0 || dy !== 0) {
    // Always consume the accumulator, even when the bank is cold, or it grows
    // without bound across a battle and the truncation stops producing 1px
    // steps.
    bankDriftX -= dx; bankDriftY -= dy;
  }
  if (bankHot > 0 && (dx !== 0 || dy !== 0)) {
    bankScratchCtx.clearRect(0, 0, bankW, bankH);
    bankScratchCtx.drawImage(smokeBank, 0, 0);
    smokeBankCtx.clearRect(0, 0, bankW, bankH);
    smokeBankCtx.drawImage(bankScratch, dx, dy);
  }

  // --- muzzle events for projectiles that have no particle of their own ---
  // economy.js's updateTowers() pushes a projectile and nothing else: no flash,
  // no smoke, no report. A defended settlement therefore shoots silently and
  // invisibly, which reads as a bug rather than as a design. Catch each
  // projectile on the frame it first appears and give it its muzzle event.
  // (Cannon fire is already served by fireCannon's own smokePuff + flash.)
  {
    const projs = world.projectiles;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      if (p.fxSeen === 1) continue;
      p.fxSeen = 1;
      if (p.kind !== 'tower') continue;
      const dx = p.tx - p.sx, dy = p.ty - p.sy;
      stampSpill(p.sx, p.sy, 22);
      stampBank(p.sx, p.sy, 13, false);
      fxPush(world, {
        kind: 'flash', cls: 1, big: false,
        a: Math.atan2(dy, dx),
        x: p.sx, y: p.sy, vx: 0, vy: 0,
        max: 0.13, size: 5.6, grow: 0,
      });
      fxPush(world, {
        kind: 'smoke', big: false,
        x: p.sx, y: p.sy, vx: dx * 0.012, vy: dy * 0.012 - 7,
        max: 0.85, size: 3.2, grow: 6,
      });
    }
  }

  // --- drain the queue sim pushed this tick ------------------------------
  const q = world.smokeStamps;
  if (q !== undefined && q.length) {
    for (let i = 0; i < q.length; i++) {
      const s = q[i];
      stampBank(s.x, s.y, s.r, s.big === true);
    }
    q.length = 0;
  }

  // --- Every particle is examined exactly ONCE in its lifetime: the first
  //     frame it is seen. Smoke seeds the powder bank, a flash seeds the light
  //     spill. Particles that sim already queued a stamp for carry nostamp.
  //     (Spec: sim initialises `st: 0` in the particle literal so this write
  //     never triggers a hidden-class transition.)
  const parts = world.particles;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.st) continue;
    fxClassify(p);
    if (p.nostamp === true) continue;
    const k = p.kind;
    if (k === 'smoke') {
      stampBank(p.x, p.y, p.big === true ? 34 : 15, p.big === true);
    } else if (k === 'flash') {
      stampSpill(p.x, p.y, p.cls === 2 ? 46 : p.cls === 1 ? 30 : 20);
    }
  }
}

/* -----------------------------------------------------------------------------
   drawSmokeUnder — THE GROUND PLANE.

   Call inside the world transform, AFTER the decal blit and BEFORE resource
   nodes and buildings. Everything drawn here lies flat on the board, so every
   object that stands on the board must be able to occlude it.

     1. field maintenance (decay, drift, stamp queue, muzzle events)
     2. ground litter          blood, debris          source-over
     3. projectile ground shadows                     source-over
     4. ground-hugging powder bank                    source-over (1 drawImage)

   Three fixed-size fills plus one clipped blit, plus one pass over the particle
   array. Cost is independent of unit count and of building count.
   -------------------------------------------------------------------------- */

function drawSmokeUnder(ctx, world, alpha) {
  if (!fxTex) return;
  updateEffectFields(world);

  const parts = world.particles;
  const np = parts.length;
  // Particles integrate at 30 Hz; back-extrapolate toward the previous sim
  // position so they do not judder against 60 Hz interpolated units.
  const back = (1 - (alpha === undefined ? 1 : alpha)) * FX_SIM_DT;

  // ---------------- 2. ground litter: blood + debris ----------------------
  {
    const bloodTex = fxTex.blood.tex, bc = fxTex.blood.cell;
    const debTex = fxTex.debris.tex, dc = fxTex.debris.cell;
    for (let i = 0; i < np; i++) {
      const p = parts[i];
      // Defensive: updateEffectFields classifies every particle on its first
      // frame, but a particle injected THIS frame by fxNoteDecal arrives with
      // st already set, and a caller could in principle skip the field pass.
      if (!p.st) fxClassify(p);
      const k = p.kind;
      if (k === 'blood') {
        const t = p.life / p.max;
        // hold full for the first 45% of life, then fall away
        let o = t < 0.45 ? 1 : 1 - (t - 0.45) * 1.8181818;
        if (o < 0) o = 0;
        let ai = (o * BLOOD_ALPHAS) | 0;
        if (ai >= BLOOD_ALPHAS) ai = BLOOD_ALPHAS - 1; else if (ai < 0) continue;
        // p.a may be absent (sim does not spawn blood yet); NaN|0 is 0, which
        // would point every spray the same way. Deal a varied angle instead.
        const ang = p.a !== undefined ? p.a : (p.v * GOLDEN_ANGLE) % 6.283185307179586;
        const r = ((ang * ROT_K + 16.5) | 0) & ROT_MASK;
        const row = (p.v & BLOOD_MASK) * BLOOD_ALPHAS + ai;
        const d = p.size * BLOOD_K;
        const x = p.x - p.vx * back, y = p.y - p.vy * back;
        ctx.drawImage(bloodTex, r * bc, row * bc, bc, bc,
          x - d * 0.5, y - d * 0.5, d, d);
      } else if (k === 'debris') {
        const t = p.life / p.max;
        let o = t < 0.7 ? 1 : 1 - (t - 0.7) * 3.3333333;
        if (o <= 0) continue;
        let ai = (o * DEBRIS_ALPHAS) | 0;
        if (ai >= DEBRIS_ALPHAS) ai = DEBRIS_ALPHAS - 1; else if (ai < 0) continue;
        const d = p.size * DEBRIS_K;
        const x = p.x - p.vx * back, y = p.y - p.vy * back;
        ctx.drawImage(debTex, ai * dc, (p.v & DEBRIS_MASK) * dc, dc, dc,
          x - d * 0.5, y - d * 0.5, d, d);
      }
    }
  }

  // ---------------- 3. projectile ground shadows --------------------------
  // MOVED here from drawEffects. These are cast ON THE GROUND, so they belong
  // under everything that stands on the ground — most visibly a building, whose
  // roof a passing roundshot's shadow used to slide straight across.
  {
    const projs = world.projectiles;
    const shTex = fxTex.ballShadow.tex, sc = fxTex.ballShadow.cell;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      const kk = p.t / p.dur;
      const k = kk > 1 ? 1 : kk;
      const gx = p.sx + (p.tx - p.sx) * k;
      const gy = p.sy + (p.ty - p.sy) * k;
      // sim already computes the arc height; it used to throw it away, so the
      // shadow was a fixed ellipse and the whole two-second arc read as flat
      const hgt = Math.sin(Math.PI * k);
      let si = (hgt * BSHADOW_STEPS) | 0;
      if (si >= BSHADOW_STEPS) si = BSHADOW_STEPS - 1;
      const d = BSHADOW_D;
      ctx.drawImage(shTex, si * sc, 0, sc, sc, gx - d * 0.5, gy - d * 0.5, d, d);
    }
  }

  // ---------------- 4. ground-hugging half of the powder bank -------------
  // Troops, farms and palisades wade INTO their own smoke rather than floating
  // on top of it. Skipped entirely once the field is provably clear.
  if (bankHot > 0) fxBlitField(ctx, smokeBank, 0.50, 0, 0, WORLD.w, WORLD.h);
}

/* -----------------------------------------------------------------------------
   drawEffects — THE AIR PLANE.

   Call inside the world transform, AFTER the unit pass. Everything here is
   above head height, so it correctly passes IN FRONT of buildings: powder smoke
   drifts across a barracks roof, it does not slide underneath the wall.

     1. air layer         dust, dirt plume, smoke    source-over
     2. rising powder bank                           source-over (1 drawImage)
     3. projectiles in flight                        source-over
     4. additive batch    spill field, flashes,      lighter
                          embers, tracers

   The ground half of the system now lives in drawSmokeUnder(); see the header.
   Exactly two globalCompositeOperation assignments per frame, regardless of how
   many particles are alive.
   -------------------------------------------------------------------------- */

function drawEffects(ctx, world, alpha) {
  if (!fxTex) return;

  const parts = world.particles;
  const np = parts.length;
  // Particles are integrated at 30 Hz; back-extrapolate toward the previous
  // sim position so they do not judder against 60 Hz interpolated units.
  const back = (1 - alpha) * FX_SIM_DT;

  // ========================== 1. air layer ================================
  {
    const smTex = fxTex.smoke.tex, smc = fxTex.smoke.cell;
    const csTex = fxTex.csmoke.tex, csc = fxTex.csmoke.cell;
    const duTex = fxTex.dust.tex, duc = fxTex.dust.cell;
    const diTex = fxTex.dirt.tex, dic = fxTex.dirt.cell;
    for (let i = 0; i < np; i++) {
      const p = parts[i];
      const k = p.kind;
      if (k === 'smoke') {
        const t = p.life / p.max;
        const s = 1 - t;
        if (s <= 0) continue;
        // birth ramp over the first 12% of life so puffs do not pop in at full
        // opacity, then a slow square-root falloff so the bank lingers
        let birth = t * 8.3333333;
        if (birth > 1) birth = 1;
        const o = birth * Math.sqrt(s);
        const d = p.size * SMOKE_K;
        const x = p.x - p.vx * back, y = p.y - p.vy * back;
        if (p.big === true) {
          let ai = (o * CSMK_ALPHAS) | 0;
          if (ai >= CSMK_ALPHAS) ai = CSMK_ALPHAS - 1; else if (ai < 0) continue;
          ctx.drawImage(csTex, ai * csc, (p.v & CSMK_MASK) * csc, csc, csc,
            x - d * 0.5, y - d * 0.5, d, d);
        } else {
          let ai = (o * SMOKE_ALPHAS) | 0;
          if (ai >= SMOKE_ALPHAS) ai = SMOKE_ALPHAS - 1; else if (ai < 0) continue;
          ctx.drawImage(smTex, ai * smc, (p.v & SMOKE_MASK) * smc, smc, smc,
            x - d * 0.5, y - d * 0.5, d, d);
        }
      } else if (k === 'dust') {
        const t = p.life / p.max;
        const s = 1 - t;
        if (s <= 0) continue;
        let birth = t * 10;
        if (birth > 1) birth = 1;
        const o = birth * s * (0.55 + 0.45 * s);
        let ai = (o * DUST_ALPHAS) | 0;
        if (ai >= DUST_ALPHAS) ai = DUST_ALPHAS - 1; else if (ai < 0) continue;
        // sim.js's integrator only grows 'smoke', so dust would otherwise hang
        // at a constant radius and read as a decal rather than as an expanding
        // cloud. Apply the growth in the draw, where it costs one multiply.
        const d = p.size * DUST_K * (1 + (p.grow !== undefined ? p.grow : 0) * t);
        const x = p.x - p.vx * back, y = p.y - p.vy * back;
        ctx.drawImage(duTex, ai * duc, (p.v & DUST_MASK) * duc, duc, duc,
          x - d * 0.5, y - d * 0.5, d, d);
      } else if (k === 'dirt') {
        const t = p.life / p.max;
        const s = 1 - t;
        if (s <= 0) continue;
        let birth = t * 12;
        if (birth > 1) birth = 1;
        const o = birth * Math.sqrt(s) * s;
        let ai = (o * DIRT_ALPHAS) | 0;
        if (ai >= DIRT_ALPHAS) ai = DIRT_ALPHAS - 1; else if (ai < 0) continue;
        const d = p.size * DIRT_K * (1 + (p.grow !== undefined ? p.grow : 0) * t);
        const x = p.x - p.vx * back, y = p.y - p.vy * back;
        // anchored at the base: the column grows upward out of the impact
        ctx.drawImage(diTex, ai * dic, (p.v & DIRT_MASK) * dic, dic, dic,
          x - d * 0.5, y - d * 0.93, d, d);
      }
    }
  }

  // ================= 2. the rising half of the powder bank ================
  // Slightly larger and offset up-screen, so it parallaxes against the ground-
  // hugging copy drawSmokeUnder already laid behind the troops. The offset is
  // baked into the destination rect and fxBlitField maps the source through it,
  // so the frustum clip stays exact.
  if (bankHot > 0) {
    fxBlitField(ctx, smokeBank, 0.44, -7, -16, WORLD.w + 14, WORLD.h + 32);
  }

  // ================= 3. projectiles in flight =============================
  {
    const projs = world.projectiles;
    const bTex = fxTex.ball.tex, bc = fxTex.ball.cell;
    for (let i = 0; i < projs.length; i++) {
      const p = projs[i];
      const ix = p.px + (p.x - p.px) * alpha;
      const iy = p.py + (p.y - p.py) * alpha;
      // heading from the last sim position gives the motion-streak angle
      let vx = p.x - p.px, vy = p.y - p.py;
      if (vx === 0 && vy === 0) { vx = p.tx - p.sx; vy = p.ty - p.sy; }
      const r = ((Math.atan2(vy, vx) * ROT_K + 16.5) | 0) & ROT_MASK;
      const row = p.kind === 'tower' ? 1 : 0;
      ctx.drawImage(bTex, r * bc, row * bc, bc, bc,
        ix - BALL_D * 0.5, iy - BALL_D * 0.5, BALL_D, BALL_D);
    }
  }

  // ==================== 4. additive batch =================================
  ctx.globalCompositeOperation = 'lighter';

  // muzzle-flash light spilling onto the ground — one drawImage buys
  // "the volley line lights up the field it is standing on"
  if (spillHot > 0) fxBlitField(ctx, spillField, 0.32, 0, 0, WORLD.w, WORLD.h);

  const flashSets = fxTex.flash;
  const emTex = fxTex.ember.tex, emc = fxTex.ember.cell;
  let tracers = 0;
  for (let i = 0; i < np; i++) {
    const p = parts[i];
    const k = p.kind;
    if (k === 'flash') {
      const s = 1 - p.life / p.max;
      if (s <= 0) continue;
      const o = Math.sqrt(s);
      let ai = (o * FLASH_ALPHAS) | 0;
      if (ai >= FLASH_ALPHAS) ai = FLASH_ALPHAS - 1; else if (ai < 0) continue;
      const cls = p.cls !== undefined ? p.cls : (p.big === true ? 2 : 0);
      const set = flashSets[cls];
      const c = set.cell;
      const r = p.a !== undefined ? ((p.a * ROT_K + 16.5) | 0) & ROT_MASK : 0;
      const d = p.size * FLASH_K;
      ctx.drawImage(set.tex, r * c, ai * c, c, c,
        p.x - d * 0.5, p.y - d * 0.5, d, d);
    } else if (k === 'ember') {
      const s = 1 - p.life / p.max;
      if (s <= 0) continue;
      const o = s * s;
      let ai = (o * EMBER_ALPHAS) | 0;
      if (ai >= EMBER_ALPHAS) ai = EMBER_ALPHAS - 1; else if (ai < 0) continue;
      const d = p.size * EMBER_K;
      const x = p.x - p.vx * back, y = p.y - p.vy * back;
      ctx.drawImage(emTex, ai * emc, (p.v & EMBER_MASK) * emc, emc, emc,
        x - d * 0.5, y - d * 0.5, d, d);
    } else if (k === 'tracer') {
      tracers++;
    }
  }

  // Tracers: one batched path, one stroke, regardless of how many are alive.
  // Cheaper than a sprite per streak and the geometry stays exact.
  if (tracers > 0) {
    ctx.strokeStyle = 'rgba(255,246,214,0.45)';
    ctx.lineWidth = 1.1 / camera.zoom;
    ctx.beginPath();
    for (let i = 0; i < np; i++) {
      const p = parts[i];
      if (p.kind !== 'tracer') continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.ex, p.ey);
    }
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

export { setEffectsCamera, setEffectsView, buildParticleTextures, drawEffects };
