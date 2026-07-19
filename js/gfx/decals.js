// ============================================================================
//  DECALS — persistent battlefield aftermath
//  "Kriegsspiel Table" art bible: painted miniatures under one warm gallery
//  photoflood up and to the LEFT. Every decal obeys DEC_SUN. Nothing is a
//  shapeless blob; nothing invents its own light.
//
//  ARCHITECTURE
//    All expensive painting happens ONCE, at battle start, into small
//    offscreen STAMP canvases (buildDecalStamps). ctx.filter, blurs, 8-offset
//    lining dilation, radial gradients — all legal there.
//    paintDecal() then becomes 1-2 drawImage calls + one save/restore, which
//    is CHEAPER than the path-building it replaces. That matters: during
//    contact paintDecal can fire 40+ times in a single frame.
//
//  THE ROTATION PROBLEM, AND HOW THIS FILE SOLVES IT
//    A corpse must be able to lie in any direction, but the light must not
//    rotate with it — a stamp rotated 180 degrees at paint time is lit from
//    the bottom-right and instantly breaks the whole diorama illusion.
//    So: HEADING IS BAKED IN. Each corpse variant is painted with the figure
//    already rotated, while the per-shape shading reads DEC_L — the sun
//    expressed in the ROTATED local frame — and the whole-object passes
//    (cast shadow, contact AO, gallery gradient) read the fixed DEC_SUN in
//    frame space. Result: 12 baked headings per infantry type per side, every
//    one lit from up-left. paintDecal then applies only a few degrees of
//    jitter, which is safe.
//
//  COORDINATE CONVENTION
//    decalCanvas is 1:1 world pixels (WORLD.w x WORLD.h). Stamps bake at
//    DEC_OS x oversampling and blit down to 1:1 world px, so every edge is
//    box-filtered rather than aliased.
//
//  This is a real ES module, not a splice fragment. render.js already imports
//  { setDecalCtx, buildDecalStamps, paintDecal } from './gfx/decals.js', so the
//  bindings below must exist as genuine imports/exports — free references to
//  WORLD / NATIONS / BUILDING_TYPES / decalCtx would be ReferenceErrors under
//  module scope, and the missing export would fail the import outright.
// ============================================================================

import { WORLD, NATIONS, BUILDING_TYPES } from '../config.js';

// render.js owns the decal canvas; it hands us the context at battle start.
let decalCtx = null;
function setDecalCtx(g) {
  decalCtx = g;
  // Stamps are baked at DEC_OS oversampling and blitted down 3:1. Chrome's
  // default 'low' smoothing aliases badly on a 3x minification, which would
  // throw away exactly the edge quality the oversampling was paid for.
  if (g) g.imageSmoothingQuality = 'high';
}

const DEC_TAU = Math.PI * 2;
const DEC_OS = 3;              // stamp oversampling (bake px per world px)

// ---- The one sun, in FRAME space. Whole-object passes use this. -------------
const DEC_SUN = {
  x: -0.64, y: -0.77,          // unit vector TOWARD the light (up-left)
  sx: 0.64, sy: 0.77,          // direction shadows fall (down-right)
  ang: Math.atan2(-0.77, -0.64),
  shadowRGB: '26,30,48',       // cool blue-violet. Never pure black.
};

// ---- The same sun, expressed in the current LOCAL (possibly rotated) frame.
//      Every primitive painter reads this, never DEC_SUN.
//
//  ROTATION BOOKKEEPING. Painters nest rotations freely — a corpse baked at a
//  heading, containing a torso at its own angle, wearing a hat knocked off at
//  a third angle. If a primitive offsets its shade band by DEC_SUN inside a
//  rotated context, that band lands in the WRONG DIRECTION by exactly the
//  accumulated rotation, and the figure ends up lit from several directions at
//  once. So every rotation goes through decPush/decPop, which keep DEC_L equal
//  to the one true sun re-expressed in whatever frame is currently active.
const DEC_L = { x: DEC_SUN.x, y: DEC_SUN.y, sx: DEC_SUN.sx, sy: DEC_SUN.sy, ang: DEC_SUN.ang };

let decRot = 0;
const decRotStack = [];

function decApplySun() {
  const c = Math.cos(-decRot), s = Math.sin(-decRot);
  DEC_L.x = DEC_SUN.x * c - DEC_SUN.y * s;
  DEC_L.y = DEC_SUN.x * s + DEC_SUN.y * c;
  DEC_L.sx = -DEC_L.x;
  DEC_L.sy = -DEC_L.y;
  DEC_L.ang = Math.atan2(DEC_L.y, DEC_L.x);
}

// Set the absolute rotation of the surface about to be painted (used once per
// stamp bake, to match a ctx that has already been rotated to a heading).
function decSetRot(r) {
  decRot = r;
  decRotStack.length = 0;
  decApplySun();
}

// save + translate + rotate, keeping DEC_L correct inside.
function decPush(g, x, y, r) {
  g.save();
  if (x || y) g.translate(x, y);
  if (r) g.rotate(r);
  decRotStack.push(decRot);
  decRot += (r || 0);
  decApplySun();
}

function decPop(g) {
  g.restore();
  decRot = decRotStack.length ? decRotStack.pop() : 0;
  decApplySun();
}

// ---- Board palette (shared with the terrain spec) --------------------------
const DEC_PAL = {
  TURF_DEEP: '#39422B',
  STRAW: '#BFA867',
  EARTH: '#7A5F3E',
  EARTH_LIGHT: '#A08059',
  EARTH_DARK: '#4A3826',
  ROCK: '#8A8578',
  ROCK_LIGHT: '#B5B0A0',
  CHAR: '#241C14',
  SOOT: '#16120D',
  ASH: '#9A9186',
  BLOOD: '#5E1512',
  BLOOD_DARK: '#3A0F0D',
  BLOOD_WET: '#8E3A2C',
  STEEL: '#8D939B',
  WOOD: '#5A452C',
  WOOD_PALE: '#8C7048',
  IRON: '#3C4148',
  LEATHER: '#4A3823',
  LINEN: '#C8C0A8',
};

// ============================================================================
//  Colour maths
// ============================================================================

function decHex2rgb(h) {
  let s = h.charAt(0) === '#' ? h.slice(1) : h;
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function decClamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function decRgb2hex(r, g, b) {
  return '#' + ((1 << 24) | (decClamp255(r) << 16) | (decClamp255(g) << 8) | decClamp255(b))
    .toString(16).slice(1);
}

function decMix(a, b, t) {
  const A = decHex2rgb(a), B = decHex2rgb(b);
  return decRgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

function decLum(hex) {
  const c = decHex2rgb(hex);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function decShift(hex, mul) {
  const c = decHex2rgb(hex);
  return decRgb2hex(c[0] * mul, c[1] * mul, c[2] * mul);
}

function decRgba(hex, a) {
  const c = decHex2rgb(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

// THE ACRYLIC RAMP. One basecoat expands to the five values a miniature
// painter actually lays down. The LINE value is force-clamped to relative
// luminance <= 58 so ANY nation coat — including one a user adds to config.js
// later — still yields a lining that reads against its own fill.
function decRamp(baseHex) {
  const shade = decMix(baseHex, '#1B2033', 0.42);
  const light = decMix(baseHex, '#FFE9BC', 0.30);
  const edge = decMix(baseHex, '#FFF6DE', 0.62);
  let line = decMix(baseHex, '#14100C', 0.78);
  const L = decLum(line);
  if (L > 58) line = decShift(line, 58 / L);
  return { shade: shade, base: baseHex, light: light, edge: edge, line: line };
}

// Per-instance material jitter so a field of 200 corpses is not 200 clones.
function decJitterRamp(pal, rng, amt) {
  return decRamp(decShift(pal.base, 1 + (rng() - 0.5) * 2 * amt));
}

// ============================================================================
//  Deterministic RNG (mulberry32). The current paintDecal calls Math.random()
//  WHILE painting, so the battlefield differs between a save and a reload.
//  Everything here is seeded.
// ============================================================================

function decRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function decR(rng, a, b) { return a + rng() * (b - a); }
function decPick(rng, arr) { return arr[(rng() * arr.length) | 0]; }

// ============================================================================
//  Canvas plumbing
// ============================================================================

function decCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.imageSmoothingQuality = 'high';
  return [c, g];
}

// A stamp: oversampled canvas whose user space is world px, origin centred.
function decStampCanvas(wWorld, hWorld) {
  const [c, g] = decCanvas(wWorld * DEC_OS, hWorld * DEC_OS);
  g.setTransform(DEC_OS, 0, 0, DEC_OS, (wWorld * DEC_OS) / 2, (hWorld * DEC_OS) / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  c._wWorld = wWorld;
  c._hWorld = hWorld;
  return [c, g];
}

// Solid tinted silhouette (unblurred — blur at composite time so the alpha
// falloff survives; blurring before source-in would flatten it to a hard edge).
function decSilhouette(src, colour) {
  const [c, g] = decCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// A near-binary mask: the silhouette drawn over itself so antialiased edge
// pixels saturate toward opaque. Needed so the destination-in re-crop in the
// recess wash does not square the edge alpha and erode the artwork.
function decMask(src) {
  const sil = decSilhouette(src, '#ffffff');
  const [c, g] = decCanvas(src.width, src.height);
  for (let i = 0; i < 4; i++) g.drawImage(sil, 0, 0);
  return c;
}

// LINING. An 8-offset dilation of the object's own silhouette composited UNDER
// the artwork. This is what a miniature painter's black lining does, and it is
// the single change that keeps a corpse readable on turf, on earth, on the
// road, and lying on top of another corpse.
function decApplyLining(c, colour, px, alpha) {
  const g = c.getContext('2d');
  const sil = decSilhouette(c, colour);
  const o = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = alpha;
  for (let i = 0; i < 8; i++) g.drawImage(sil, o[i][0] * px, o[i][1] * px);
  g.restore();
}

// GROUND-BOUNCE HALO. A dark lining alone is not sufficient: measured against
// TURF_DEEP #39422B (hedge ditches, shade under treelines) a coat-tinted
// near-black outline yields only 1.66:1, so a corpse that falls in deep shade
// loses its silhouette entirely. This adds a soft warm rim one step OUTSIDE
// the dark lining — physically the ground bounce the art bible already
// specifies (#B9A277 kicking off the board) pushed toward the key light. On
// pale ground the dark lining carries the read and the halo vanishes into the
// straw; on dark ground the halo carries it. Every ground the figure can land
// on now clears 3:1. Bake-time only; zero runtime cost.
function decApplyHalo(c, colour, px, alpha) {
  const g = c.getContext('2d');
  const sil = decSilhouette(c, colour);
  const o = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  // Dilate FIRST into a scratch, then blur ONCE on the way in. The obvious
  // version (set ctx.filter, then eight drawImages) pays for a full blur
  // pipeline eight times per object; across ~110 baked stamps that was several
  // hundred filtered blits and by far the largest single term in the bake.
  // Same result, one eighth the filter work.
  const [ring, rg] = decCanvas(c.width, c.height);
  for (let i = 0; i < 8; i++) rg.drawImage(sil, o[i][0] * px, o[i][1] * px);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = alpha;
  g.filter = 'blur(1.1px)';
  g.drawImage(ring, 0, 0);
  g.filter = 'none';
  g.restore();
}

// Asymmetric second lining only along +SUN.shadow: the ambient occlusion that
// lifts the object off the ground it is lying on. FRAME space — fixed sun.
function decApplyContactAO(c, px, alpha) {
  const g = c.getContext('2d');
  const sil = decSilhouette(c, 'rgba(' + DEC_SUN.shadowRGB + ',1)');
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.globalAlpha = alpha;
  g.filter = 'blur(' + (px * 0.6).toFixed(2) + 'px)';
  g.drawImage(sil, DEC_SUN.sx * px, DEC_SUN.sy * px);
  g.filter = 'none';
  g.restore();
}

// WHOLE-OBJECT PASS A: unifying gallery light. source-atop clips to painted
// pixels for free, so one gradient shades coat, limbs, hat and weapon together
// — which is what makes a stack of separately drawn parts read as one physical
// painted object. FRAME space.
function decGalleryLight(c, strength) {
  const g = c.getContext('2d');
  const s = strength === undefined ? 1 : strength;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const grd = g.createLinearGradient(0, 0, c.width, c.height);
  grd.addColorStop(0, 'rgba(255,236,190,' + (0.26 * s).toFixed(3) + ')');
  grd.addColorStop(0.42, 'rgba(255,236,190,0)');
  grd.addColorStop(0.62, 'rgba(24,20,42,0)');
  grd.addColorStop(1, 'rgba(24,20,42,' + (0.34 * s).toFixed(3) + ')');
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
}

// WHOLE-OBJECT PASS B: recess wash. Multiply the frame by a blurred copy of
// itself — darkness pools in interior crevices exactly as a shade wash does.
// The destination-in re-crop is REQUIRED: canvas blend modes still composite
// source-over, so the blurred copy would otherwise smear outside the object.
function decRecessWash(c, alpha, blurPx) {
  const g = c.getContext('2d');
  const mask = decMask(c);
  const [snap, sg] = decCanvas(c.width, c.height);
  sg.drawImage(c, 0, 0);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = alpha;
  g.filter = 'blur(' + blurPx + 'px)';
  g.drawImage(snap, 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0);
  g.restore();
}

// WHOLE-OBJECT PASS C: matte varnish. Kills any impression of gloss and pulls
// both nations into one painted family.
function decMatteVarnish(c, alpha) {
  const g = c.getContext('2d');
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(238,232,214,' + alpha + ')';
  g.fillRect(0, 0, c.width, c.height);
  g.restore();
}

function decFinish(c, opts) {
  const o = opts || {};
  decGalleryLight(c, o.light === undefined ? 1 : o.light);
  decRecessWash(c, o.wash === undefined ? 0.18 : o.wash, o.washBlur === undefined ? 1.5 : o.washBlur);
  decMatteVarnish(c, o.varnish === undefined ? 0.045 : o.varnish);
  if (o.lineColour !== null) {
    // linePx is in DEVICE px on a DEC_OS-oversampled stamp, so the lining the
    // player actually sees is linePx/DEC_OS world px. At the old default of 2
    // that is 0.67 world px — under a screen pixel at any zoom below 1.5x, i.e.
    // the silhouette guarantee quietly evaporated exactly where it was needed.
    // DEC_OS gives a true 1 world px lining.
    const lpx = o.linePx === undefined ? DEC_OS : o.linePx;
    // destination-over stacks downward, so each call lands under the previous:
    // artwork / dark lining / warm halo / contact shadow.
    decApplyLining(c, o.lineColour || '#141118', lpx, o.lineAlpha === undefined ? 1 : o.lineAlpha);
    if (o.halo !== false) decApplyHalo(c, o.haloColour || '#DCC9A0', lpx + 2, o.haloAlpha === undefined ? 0.42 : o.haloAlpha);
    decApplyContactAO(c, o.aoPx === undefined ? 4 : o.aoPx, o.aoAlpha === undefined ? 0.45 : o.aoAlpha);
  }
}

// ============================================================================
//  Primitive painters. Every one obeys DEC_L and uses the acrylic ramp.
//  These run in stamp user space (world px, origin centred, possibly rotated).
// ============================================================================

// A cylindrical limb: base, shade band hugging the down-sun rim, drybrushed
// light on the sun-facing plane, single-sided edge highlight. Four values from
// four strokes — this is what turns a flat rectangle into a form.
function decLimb(g, x1, y1, x2, y2, w, pal, edgeA) {
  g.lineCap = 'round';
  g.strokeStyle = pal.base;
  g.lineWidth = w;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();

  const so = w * 0.34, lo = w * 0.30, eo = w * 0.40;
  g.strokeStyle = pal.shade;
  g.lineWidth = w * 0.50;
  g.beginPath();
  g.moveTo(x1 + DEC_L.sx * so, y1 + DEC_L.sy * so);
  g.lineTo(x2 + DEC_L.sx * so, y2 + DEC_L.sy * so);
  g.stroke();

  g.strokeStyle = pal.light;
  g.lineWidth = w * 0.34;
  g.beginPath();
  g.moveTo(x1 - DEC_L.sx * lo, y1 - DEC_L.sy * lo);
  g.lineTo(x2 - DEC_L.sx * lo, y2 - DEC_L.sy * lo);
  g.stroke();

  const ea = edgeA === undefined ? 0.68 : edgeA;
  if (ea > 0) {
    g.globalAlpha = ea;
    g.strokeStyle = pal.edge;
    g.lineWidth = Math.max(0.2, w * 0.15);
    g.beginPath();
    g.moveTo(x1 - DEC_L.sx * eo, y1 - DEC_L.sy * eo);
    g.lineTo(x2 - DEC_L.sx * eo, y2 - DEC_L.sy * eo);
    g.stroke();
    g.globalAlpha = 1;
  }
}

// A jointed limb (upper + lower with a knee/elbow), tapering.
function decJointLimb(g, ax, ay, bx, by, cx, cy, w1, w2, pal, edgeA) {
  decLimb(g, ax, ay, bx, by, w1, pal, edgeA);
  decLimb(g, bx, by, cx, cy, w2, pal, edgeA);
  g.fillStyle = pal.light;
  g.globalAlpha = 0.5;
  g.beginPath();
  g.ellipse(bx - DEC_L.sx * w1 * 0.2, by - DEC_L.sy * w1 * 0.2, w1 * 0.34, w1 * 0.3, 0, 0, DEC_TAU);
  g.fill();
  g.globalAlpha = 1;
}

// A rounded mass (torso, head, hat crown, horse barrel). Base fill, shade
// pooled at 62%..100% along +shadow, drybrush at 0%..26%, one-sided edge arc.
function decDome(g, cx, cy, rx, ry, rot, pal, edgeA) {
  decPush(g, cx, cy, rot);
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, DEC_TAU);
  g.fillStyle = pal.base;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = pal.shade;
  g.beginPath();
  g.ellipse(DEC_L.sx * rx * 0.66, DEC_L.sy * ry * 0.66, rx, ry, 0, 0, DEC_TAU);
  g.fill();
  g.fillStyle = pal.light;
  g.beginPath();
  g.ellipse(-DEC_L.sx * rx * 0.40, -DEC_L.sy * ry * 0.40, rx * 0.70, ry * 0.70, 0, 0, DEC_TAU);
  g.fill();
  g.restore();
  const ea = edgeA === undefined ? 0.8 : edgeA;
  if (ea > 0) {
    const lw = Math.max(0.22, Math.min(rx, ry) * 0.16);
    const a = DEC_L.ang;
    g.globalAlpha = ea;
    g.strokeStyle = pal.edge;
    g.lineWidth = lw;
    g.beginPath();
    g.ellipse(0, 0, Math.max(0.1, rx - lw * 0.5), Math.max(0.1, ry - lw * 0.5), 0, a - 1.25, a + 1.25);
    g.stroke();
    g.globalAlpha = 1;
  }
  decPop(g);
}

// A flat panel with a lit sun-side bevel: planks, carriage cheeks, wall stubs.
function decPanel(g, cx, cy, w, h, rot, pal, edgeA) {
  decPush(g, cx, cy, rot);
  // Which half is shaded depends on where the sun ended up in THIS frame, so a
  // rotated panel still darkens on its true down-sun side.
  const sX = DEC_L.sx >= 0 ? 1 : -1;
  const sY = DEC_L.sy >= 0 ? 1 : -1;
  g.fillStyle = pal.base;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle = pal.shade;
  g.fillRect(sX > 0 ? w * 0.08 : -w / 2, -h / 2, w * 0.42, h);
  g.fillRect(-w / 2, sY > 0 ? h * 0.12 : -h / 2, w, h * 0.38);
  g.fillStyle = pal.light;
  g.fillRect(sX > 0 ? -w / 2 : w * 0.20, sY > 0 ? -h / 2 : h * 0.16, w * 0.30, h * 0.34);
  g.fillRect(-w / 2, sY > 0 ? -h / 2 : h / 2 - Math.max(0.25, h * 0.16), w, Math.max(0.25, h * 0.16));
  const ea = edgeA === undefined ? 0.7 : edgeA;
  if (ea > 0) {
    g.globalAlpha = ea;
    g.strokeStyle = pal.edge;
    g.lineWidth = 0.28;
    g.beginPath();
    g.moveTo(-sX * w / 2, sY * h / 2);
    g.lineTo(-sX * w / 2, -sY * h / 2);
    g.lineTo(sX * w / 2, -sY * h / 2);
    g.stroke();
    g.globalAlpha = 1;
  }
  decPop(g);
}

// A splintered timber: tapered plank whose ends break into fibres with raw
// pale end grain. Nothing says "destroyed" like a shattered end.
function decSplinter(g, x1, y1, x2, y2, w, pal, rng, bothEnds) {
  decLimb(g, x1, y1, x2, y2, w, pal, 0.6);
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const nx = -uy, ny = ux;
  const ends = bothEnds ? [[x2, y2, ux, uy], [x1, y1, -ux, -uy]] : [[x2, y2, ux, uy]];
  for (let e = 0; e < ends.length; e++) {
    const ex = ends[e][0], ey = ends[e][1], vx = ends[e][2], vy = ends[e][3];
    g.fillStyle = decMix(pal.light, '#E8D8B0', 0.45);
    g.globalAlpha = 0.75;
    g.beginPath();
    g.ellipse(ex, ey, w * 0.42, w * 0.5, Math.atan2(uy, ux), 0, DEC_TAU);
    g.fill();
    g.globalAlpha = 1;
    const n = 3 + ((rng() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const off = decR(rng, -w * 0.45, w * 0.45);
      const len = decR(rng, w * 0.5, w * 1.9);
      const sx = ex + nx * off, sy = ey + ny * off;
      const tx = sx + vx * len + nx * decR(rng, -w * 0.3, w * 0.3);
      const ty = sy + vy * len + ny * decR(rng, -w * 0.3, w * 0.3);
      g.strokeStyle = i & 1 ? pal.light : pal.base;
      g.lineWidth = decR(rng, 0.16, 0.4);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(tx, ty); g.stroke();
    }
  }
}

// A wheel drawn as a RING — a hole in the silhouette that nothing else on the
// battlefield has. Broken wheels lose an arc and shed loose spokes.
function decWheel(g, cx, cy, r, pal, rng, broken, squash) {
  const sq = squash === undefined ? 0.55 : squash;
  const thick = Math.max(0.5, r * 0.20);
  const gap = broken ? decR(rng, 1.1, 2.2) : 0;
  const gapAt = rng() * DEC_TAU;
  g.save();
  g.translate(cx, cy);
  g.scale(1, sq);
  // Inside a non-uniformly scaled frame an angle is no longer the angle you
  // see: DEC_L.ang used raw put the wheel's rim highlight up to ~17 degrees off
  // the sun at sq=0.45. Pre-distort so the lit arc still faces the photoflood.
  const sunA = Math.atan2(DEC_L.y / sq, DEC_L.x);
  g.strokeStyle = pal.base;
  g.lineWidth = thick;
  g.beginPath();
  if (broken) g.arc(0, 0, r, gapAt + gap, gapAt + DEC_TAU);
  else g.arc(0, 0, r, 0, DEC_TAU);
  g.stroke();
  g.strokeStyle = pal.shade;
  g.lineWidth = thick * 0.5;
  g.beginPath();
  if (broken) g.arc(0, 0, r + thick * 0.24, gapAt + gap, gapAt + DEC_TAU);
  else g.arc(0, 0, r + thick * 0.24, 0, DEC_TAU);
  g.stroke();
  g.strokeStyle = pal.light;
  g.lineWidth = thick * 0.34;
  g.beginPath();
  g.arc(0, 0, r - thick * 0.22, sunA - 1.2, sunA + 1.2);
  g.stroke();
  g.strokeStyle = decRgba(DEC_PAL.ROCK_LIGHT, 0.45);
  g.lineWidth = thick * 0.18;
  g.beginPath();
  g.arc(0, 0, r + thick * 0.34, sunA - 0.8, sunA + 0.8);
  g.stroke();
  const spokes = 10;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * DEC_TAU;
    if (broken) {
      const da = ((a - gapAt) % DEC_TAU + DEC_TAU) % DEC_TAU;
      if (da < gap) continue;
      if (rng() < 0.28) continue;              // snapped spokes
    }
    const outR = broken && rng() < 0.3 ? r * decR(rng, 0.55, 0.85) : r - thick * 0.4;
    g.strokeStyle = pal.base;
    g.lineWidth = thick * 0.42;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22);
    g.lineTo(Math.cos(a) * outR, Math.sin(a) * outR);
    g.stroke();
    g.strokeStyle = pal.light;
    g.lineWidth = thick * 0.16;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * 0.24 - DEC_L.sx * 0.14, Math.sin(a) * r * 0.24 - DEC_L.sy * 0.14);
    g.lineTo(Math.cos(a) * outR - DEC_L.sx * 0.14, Math.sin(a) * outR - DEC_L.sy * 0.14);
    g.stroke();
  }
  g.restore();
  decDome(g, cx, cy, r * 0.24, r * 0.24 * sq, 0, decRamp(DEC_PAL.IRON), 0.9);
}

// Scatter of small dimensional clods/rubble, each individually lit with its
// own contact shadow.
function decClods(g, rng, cx, cy, spreadX, spreadY, count, pal, minR, maxR, falloff) {
  for (let i = 0; i < count; i++) {
    const a = rng() * DEC_TAU;
    const d = Math.pow(rng(), falloff === undefined ? 0.6 : falloff);
    const x = cx + Math.cos(a) * spreadX * d;
    const y = cy + Math.sin(a) * spreadY * d;
    const r = decR(rng, minR, maxR);
    g.fillStyle = 'rgba(' + DEC_SUN.shadowRGB + ',0.30)';
    g.beginPath();
    g.ellipse(x + DEC_L.sx * r * 0.55, y + DEC_L.sy * r * 0.55, r * 0.95, r * 0.62, 0, 0, DEC_TAU);
    g.fill();
    g.fillStyle = rng() < 0.5 ? pal.base : pal.shade;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.72, rng() * DEC_TAU, 0, DEC_TAU);
    g.fill();
    g.fillStyle = pal.light;
    g.beginPath();
    g.ellipse(x - DEC_L.sx * r * 0.34, y - DEC_L.sy * r * 0.34, r * 0.46, r * 0.32, 0, 0, DEC_TAU);
    g.fill();
  }
}

// Ground the object disturbed: churned soil showing through, plus grass combed
// flat and radiating outward from the impact.
function decGroundScuff(g, rng, cx, cy, rx, ry, strength) {
  const s = strength === undefined ? 1 : strength;
  const n = 7 + ((rng() * 5) | 0);
  for (let i = 0; i < n; i++) {
    const a = rng() * DEC_TAU, d = Math.pow(rng(), 0.7);
    const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
    const r = decR(rng, rx * 0.3, rx * 0.62);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, decRgba(DEC_PAL.EARTH_DARK, 0.20 * s));
    grd.addColorStop(0.6, decRgba(DEC_PAL.EARTH_DARK, 0.10 * s));
    grd.addColorStop(1, decRgba(DEC_PAL.EARTH_DARK, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.68, 0, 0, DEC_TAU);
    g.fill();
  }
  for (let i = 0; i < 22; i++) {
    const a = rng() * DEC_TAU;
    const d = decR(rng, 0.5, 1.05);
    const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
    const len = decR(rng, 1.0, 2.6);
    g.strokeStyle = rng() < 0.55 ? decRgba(DEC_PAL.TURF_DEEP, 0.34 * s) : decRgba(DEC_PAL.STRAW, 0.24 * s);
    g.lineWidth = decR(rng, 0.22, 0.5);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.75);
    g.stroke();
  }
}

// ============================================================================
//  BLOOD
//  Never a flat ellipse. A union of soft radial pools, a dark saturated core,
//  run-off trickles that flow away down-slope, a directional spatter fan, a
//  coagulated drying rim, and a wet sheen on the sun-facing side.
// ============================================================================

function decBloodPool(g, rng, cx, cy, rx, ry, amount) {
  const amt = amount === undefined ? 1 : amount;
  const lobes = 8 + ((rng() * 6) | 0);
  for (let i = 0; i < lobes; i++) {
    const a = rng() * DEC_TAU;
    const d = Math.pow(rng(), 0.62);
    const px = cx + Math.cos(a) * rx * d * 0.9;
    const py = cy + Math.sin(a) * ry * d * 0.9;
    const r = decR(rng, rx * 0.30, rx * 0.66);
    const grd = g.createRadialGradient(px, py, 0, px, py, r);
    grd.addColorStop(0, decRgba(DEC_PAL.BLOOD, 0.72 * amt));
    grd.addColorStop(0.5, decRgba(DEC_PAL.BLOOD_DARK, 0.56 * amt));
    grd.addColorStop(1, decRgba(DEC_PAL.BLOOD_DARK, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(px, py, r, r * decR(rng, 0.66, 0.92), rng() * DEC_TAU, 0, DEC_TAU);
    g.fill();
  }

  const coreGrd = g.createRadialGradient(cx - 0.4, cy - 0.3, 0, cx - 0.4, cy - 0.3, rx * 0.55);
  coreGrd.addColorStop(0, decRgba('#2E0B09', 0.60 * amt));
  coreGrd.addColorStop(1, decRgba('#2E0B09', 0));
  g.fillStyle = coreGrd;
  g.beginPath();
  g.ellipse(cx - 0.4, cy - 0.3, rx * 0.55, ry * 0.5, 0, 0, DEC_TAU);
  g.fill();

  // Run-off follows the ground, away from the light (our notional downhill).
  const trickles = 2 + ((rng() * 4) | 0);
  for (let t = 0; t < trickles; t++) {
    let ang = Math.atan2(DEC_L.sy, DEC_L.sx) + decR(rng, -0.9, 0.9);
    let x = cx + Math.cos(ang) * rx * 0.6;
    let y = cy + Math.sin(ang) * ry * 0.6;
    const steps = 3 + ((rng() * 4) | 0);
    g.strokeStyle = decRgba(DEC_PAL.BLOOD_DARK, 0.5 * amt);
    g.lineWidth = decR(rng, 0.4, 0.9);
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < steps; s++) {
      ang += decR(rng, -0.4, 0.4);
      x += Math.cos(ang) * decR(rng, 1.0, 2.4);
      y += Math.sin(ang) * decR(rng, 0.8, 1.9);
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = decRgba(DEC_PAL.BLOOD_DARK, 0.44 * amt);
    g.beginPath();
    g.ellipse(x, y, decR(rng, 0.5, 1.1), decR(rng, 0.4, 0.8), 0, 0, DEC_TAU);
    g.fill();
  }

  // Fine spatter fan — biased one way, as an exit wound throws it.
  const fanA = rng() * DEC_TAU;
  const maxD = rx * 2.0;
  const drops = 20 + ((rng() * 22) | 0);
  for (let i = 0; i < drops; i++) {
    const a = fanA + decR(rng, -0.75, 0.75);
    const d = decR(rng, rx * 0.7, maxD);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d * 0.78;
    const r = decR(rng, 0.16, 0.62) * (1 - d / (maxD * 1.35));
    if (r <= 0.05) continue;
    g.fillStyle = decRgba(DEC_PAL.BLOOD_DARK, decR(rng, 0.3, 0.62) * amt);
    g.beginPath();
    g.ellipse(x, y, r * decR(rng, 1.0, 2.2), r, a, 0, DEC_TAU);
    g.fill();
  }

  // Coagulated rim: blood dries darker and thicker at the perimeter.
  g.strokeStyle = decRgba('#280907', 0.26 * amt);
  g.lineWidth = 0.5;
  g.beginPath();
  for (let i = 0; i <= 26; i++) {
    const a = (i / 26) * DEC_TAU;
    const wob = 1 + Math.sin(a * 3.1 + rx) * 0.10 + Math.sin(a * 5.7) * 0.07;
    const x = cx + Math.cos(a) * rx * 0.92 * wob;
    const y = cy + Math.sin(a) * ry * 0.92 * wob;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();

  // Wet sheen. Fresh blood is the one glossy thing on a matte-varnished board,
  // and this small arc is what sells "wet" rather than "brown paint".
  g.globalAlpha = 0.30 * amt;
  g.strokeStyle = DEC_PAL.BLOOD_WET;
  g.lineWidth = Math.max(0.3, rx * 0.11);
  g.beginPath();
  g.ellipse(cx + DEC_L.x * rx * 0.20, cy + DEC_L.y * ry * 0.20,
    rx * 0.52, ry * 0.46, 0, DEC_L.ang - 1.0, DEC_L.ang + 1.0);
  g.stroke();
  g.globalAlpha = 1;
}

// ============================================================================
//  KIT — hats, weapons, pouches. Painted into the FIGURE layer so they share
//  its lining and contact AO. A hat with no outline floats.
// ============================================================================

function decTricorn(g, x, y, rot, rng, trimHex) {
  const felt = decRamp('#241E14');
  decPush(g, x, y, rot);
  // Three-cornered brim, so the OUTLINE alone identifies it at 8px.
  g.beginPath();
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * DEC_TAU;
    const lobe = 1 + 0.20 * Math.cos(3 * (a + 0.4));
    const px = Math.cos(a) * 2.85 * lobe;
    const py = Math.sin(a) * 2.45 * lobe;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = felt.base;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = felt.shade;
  g.beginPath();
  g.ellipse(DEC_L.sx * 1.9, DEC_L.sy * 1.7, 3.3, 2.9, 0, 0, DEC_TAU);
  g.fill();
  g.restore();
  decDome(g, -0.25, -0.2, 1.45, 1.2, decR(rng, -0.3, 0.3), felt, 0.85);
  // Hat lace and cockade in the nation trim: the one saturated fleck on a
  // corpse, and the only faction cue left once the man is face-down.
  g.strokeStyle = decRgba(trimHex, 0.85);
  g.lineWidth = 0.34;
  g.beginPath();
  g.ellipse(0, 0, 2.5, 2.1, 0, 0, DEC_TAU);
  g.stroke();
  g.fillStyle = trimHex;
  g.beginPath();
  g.ellipse(-1.5, -1.1, 0.55, 0.45, 0, 0, DEC_TAU);
  g.fill();
  decPop(g);
}

function decHelmet(g, x, y, rot) {
  const steel = decRamp('#6E747C');
  decPush(g, x, y, rot);
  decDome(g, 0, 0, 2.5, 2.0, 0, steel, 0.95);
  // Comb ridge: a hard specular line, unmistakably metal, and the shape cue
  // that separates a pikeman's corpse from a musketeer's.
  g.strokeStyle = decMix(steel.edge, '#FFFFFF', 0.35);
  g.lineWidth = 0.42;
  g.beginPath();
  g.moveTo(-2.0, -0.5);
  g.lineTo(1.9, -0.9);
  g.stroke();
  g.strokeStyle = steel.shade;
  g.lineWidth = 0.3;
  g.beginPath();
  g.moveTo(-2.0, 0.35);
  g.lineTo(1.9, -0.05);
  g.stroke();
  g.strokeStyle = steel.base;
  g.lineWidth = 0.5;
  g.beginPath();
  g.ellipse(0, 0.35, 2.7, 2.15, 0, 0, DEC_TAU);
  g.stroke();
  decPop(g);
}

function decCap(g, x, y, rot, coatHex) {
  const wool = decRamp(decMix(coatHex, '#6B5A3E', 0.55));
  decPush(g, x, y, rot);
  decDome(g, 0, 0, 2.0, 1.6, 0, wool, 0.7);
  g.fillStyle = wool.shade;
  g.beginPath();
  g.ellipse(1.3, 0.7, 1.1, 0.7, 0.4, 0, DEC_TAU);
  g.fill();
  decPop(g);
}

function decMusket(g, x1, y1, x2, y2) {
  const wood = decRamp(DEC_PAL.LEATHER);
  const steel = decRamp(DEC_PAL.STEEL);
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  decLimb(g, x1, y1, x1 + ux * L * 0.55, y1 + uy * L * 0.55, 1.35, wood, 0.7);
  decDome(g, x1 + ux * 0.5, y1 + uy * 0.5, 1.05, 0.8, Math.atan2(uy, ux), wood, 0.7);
  decLimb(g, x1 + ux * L * 0.42, y1 + uy * L * 0.42, x2, y2, 0.85, steel, 0.9);
  g.fillStyle = decRamp('#8C6A32').light;
  g.beginPath();
  g.ellipse(x1 + ux * L * 0.42, y1 + uy * L * 0.42, 0.75, 0.5, Math.atan2(uy, ux), 0, DEC_TAU);
  g.fill();
  g.strokeStyle = decRgba('#FFF6DE', 0.5);
  g.lineWidth = 0.2;
  g.beginPath();
  g.moveTo(x1 + ux * L * 0.5 - DEC_L.sx * 0.34, y1 + uy * L * 0.5 - DEC_L.sy * 0.34);
  g.lineTo(x2 - DEC_L.sx * 0.34, y2 - DEC_L.sy * 0.34);
  g.stroke();
}

function decPike(g, x1, y1, x2, y2) {
  const wood = decRamp('#5D4B32');
  const steel = decRamp('#B9BEC6');
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  decLimb(g, x1, y1, x2 - ux * 2.6, y2 - uy * 2.6, 0.95, wood, 0.6);
  decPush(g, x2 - ux * 1.3, y2 - uy * 1.3, Math.atan2(uy, ux));
  g.beginPath();
  g.moveTo(-1.6, 0);
  g.quadraticCurveTo(-0.2, -0.72, 1.6, 0);
  g.quadraticCurveTo(-0.2, 0.72, -1.6, 0);
  g.closePath();
  g.fillStyle = steel.base;
  g.fill();
  g.fillStyle = steel.light;
  g.beginPath();
  g.moveTo(-1.5, -0.08);
  g.quadraticCurveTo(-0.2, -0.6, 1.45, -0.06);
  g.quadraticCurveTo(-0.2, -0.26, -1.5, -0.08);
  g.closePath();
  g.fill();
  decPop(g);
}

function decTool(g, x1, y1, x2, y2) {
  const haft = decRamp('#7A6038');
  const steel = decRamp('#7E848C');
  decLimb(g, x1, y1, x2, y2, 0.85, haft, 0.6);
  decPush(g, x2, y2, Math.atan2(y2 - y1, x2 - x1));
  g.beginPath();
  g.moveTo(-0.4, -1.5);
  g.lineTo(1.7, -1.1);
  g.lineTo(1.7, 1.1);
  g.lineTo(-0.4, 1.5);
  g.closePath();
  g.fillStyle = steel.base;
  g.fill();
  g.fillStyle = steel.light;
  g.beginPath();
  g.moveTo(-0.4, -1.5);
  g.lineTo(1.7, -1.1);
  g.lineTo(1.7, -0.5);
  g.lineTo(-0.4, -0.85);
  g.closePath();
  g.fill();
  decPop(g);
}

function decPouch(g, x, y, rot) {
  decDome(g, x, y, 1.15, 0.85, rot, decRamp('#3A2C1C'), 0.6);
  g.strokeStyle = decRgba('#C9B98E', 0.55);
  g.lineWidth = 0.22;
  g.beginPath();
  g.moveTo(x - 1.0, y - 0.2);
  g.lineTo(x + 1.0, y - 0.45);
  g.stroke();
}

function decSabre(g, x1, y1, x2, y2) {
  const steel = decRamp('#AFB6BE');
  const grip = decRamp('#2E2418');
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const nx = -uy, ny = ux;
  g.strokeStyle = steel.base;
  g.lineWidth = 0.72;
  g.beginPath();
  g.moveTo(x1 + ux * L * 0.22, y1 + uy * L * 0.22);
  g.quadraticCurveTo(x1 + ux * L * 0.62 + nx * 1.1, y1 + uy * L * 0.62 + ny * 1.1, x2, y2);
  g.stroke();
  g.strokeStyle = steel.edge;
  g.lineWidth = 0.24;
  g.beginPath();
  g.moveTo(x1 + ux * L * 0.24 - DEC_L.sx * 0.24, y1 + uy * L * 0.24 - DEC_L.sy * 0.24);
  g.quadraticCurveTo(x1 + ux * L * 0.62 + nx * 1.1 - DEC_L.sx * 0.24,
    y1 + uy * L * 0.62 + ny * 1.1 - DEC_L.sy * 0.24,
    x2 - DEC_L.sx * 0.24, y2 - DEC_L.sy * 0.24);
  g.stroke();
  decLimb(g, x1, y1, x1 + ux * L * 0.2, y1 + uy * L * 0.2, 0.85, grip, 0.6);
  decDome(g, x1 + ux * L * 0.22, y1 + uy * L * 0.22, 0.75, 0.5, Math.atan2(uy, ux),
    decRamp('#8C6A32'), 0.9);
}

// ============================================================================
//  FALLEN INFANTRY — four genuinely different sprawls, hand-placed. The POSE
//  is the readability, not the colour: four rotations of one shape would still
//  read as a repeated stamp.
// ============================================================================

function decPaintInfantry(g, rng, kit, pose) {
  const coat = decJitterRamp(decRamp(kit.coat), rng, 0.06);
  const trim = decRamp(kit.trim);
  const skin = decJitterRamp(decRamp(kit.skin), rng, 0.08);
  const breech = decRamp(kit.breech || '#B7AC8E');
  const boot = decRamp('#2B261E');
  const belt = decRamp(DEC_PAL.LINEN);

  function boots(x, y, a) {
    decPush(g, x, y, a);
    decDome(g, 0, 0, 1.25, 0.85, 0, boot, 0.55);
    g.fillStyle = decRgba('#0E0C09', 0.6);
    g.beginPath();
    g.ellipse(0.5, 0.15, 0.55, 0.45, 0, 0, DEC_TAU);
    g.fill();
    decPop(g);
  }
  function hand(x, y) { decDome(g, x, y, 0.82, 0.72, 0, skin, 0.9); }

  function head(x, y, a, faceUp) {
    // hair / queue first, so it sits under the skull
    decDome(g, x - Math.cos(a) * 1.5, y - Math.sin(a) * 1.5, 1.5, 1.3, a, decRamp('#3A2C1E'), 0.4);
    decDome(g, x, y, 2.05, 1.85, a, skin, 0.95);
    if (faceUp) {
      // eyes closed, mouth open — the detail that makes it a man, not a lump
      g.strokeStyle = decRgba('#20160F', 0.8);
      g.lineWidth = 0.26;
      g.beginPath();
      g.moveTo(x + Math.cos(a + 1.1) * 0.85 - 0.35, y + Math.sin(a + 1.1) * 0.85);
      g.lineTo(x + Math.cos(a + 1.1) * 0.85 + 0.35, y + Math.sin(a + 1.1) * 0.85);
      g.moveTo(x + Math.cos(a - 1.1) * 0.85 - 0.35, y + Math.sin(a - 1.1) * 0.85);
      g.lineTo(x + Math.cos(a - 1.1) * 0.85 + 0.35, y + Math.sin(a - 1.1) * 0.85);
      g.stroke();
      g.fillStyle = decRgba('#1A1008', 0.75);
      g.beginPath();
      g.ellipse(x + Math.cos(a) * 1.15, y + Math.sin(a) * 1.15, 0.4, 0.3, a, 0, DEC_TAU);
      g.fill();
    } else {
      g.fillStyle = decRgba('#2C2116', 0.55);
      g.beginPath();
      g.ellipse(x - Math.cos(a) * 0.5, y - Math.sin(a) * 0.5, 1.7, 1.5, a, 0, DEC_TAU);
      g.fill();
    }
  }

  function torso(cx, cy, rot, heavy) {
    const rx = heavy ? 4.9 : 4.5, ry = heavy ? 3.5 : 3.1;
    // coat skirts flare out from under the body
    decDome(g, cx - Math.cos(rot) * 3.1, cy - Math.sin(rot) * 3.1, rx * 0.78, ry * 1.02, rot, coat, 0.5);
    decDome(g, cx, cy, rx, ry, rot, coat, 0.8);
    decPush(g, cx, cy, rot);
    // turnback facings in the trim colour
    g.fillStyle = trim.base;
    g.beginPath();
    g.ellipse(-rx * 0.62, ry * 0.42, rx * 0.30, ry * 0.26, 0.4, 0, DEC_TAU);
    g.fill();
    g.fillStyle = trim.light;
    g.beginPath();
    g.ellipse(-rx * 0.66, ry * 0.36, rx * 0.16, ry * 0.13, 0.4, 0, DEC_TAU);
    g.fill();
    // crossbelts: two pale straps, the strongest internal contrast on the coat
    g.strokeStyle = belt.base;
    g.lineWidth = 0.62;
    g.beginPath();
    g.moveTo(-rx * 0.55, -ry * 0.62);
    g.lineTo(rx * 0.62, ry * 0.5);
    g.stroke();
    g.strokeStyle = belt.light;
    g.lineWidth = 0.24;
    g.beginPath();
    g.moveTo(-rx * 0.55 - DEC_L.sx * 0.2, -ry * 0.62 - DEC_L.sy * 0.2);
    g.lineTo(rx * 0.62 - DEC_L.sx * 0.2, ry * 0.5 - DEC_L.sy * 0.2);
    g.stroke();
    g.strokeStyle = belt.shade;
    g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(-rx * 0.5, ry * 0.6);
    g.lineTo(rx * 0.58, -ry * 0.44);
    g.stroke();
    g.fillStyle = trim.light;
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.ellipse(i * rx * 0.26, -ry * 0.30, 0.24, 0.2, 0, 0, DEC_TAU);
      g.fill();
    }
    decPop(g);
  }

  const heavy = kit.weapon === 'pike';

  if (pose === 0) {
    // FACE DOWN, arms thrown forward. The classic volley casualty.
    decJointLimb(g, -3.2, -1.5, -6.6, -2.9, -9.8, -3.4, 1.95, 1.55, breech, 0.5);
    decJointLimb(g, -3.2, 1.5, -6.4, 3.1, -9.2, 4.0, 1.95, 1.55, breech, 0.5);
    boots(-10.3, -3.6, 0.2);
    boots(-9.7, 4.3, 0.5);
    torso(0.2, 0, 0.06, heavy);
    decJointLimb(g, 3.0, -2.3, 6.0, -3.6, 8.6, -4.4, 1.5, 1.25, coat, 0.5);
    decJointLimb(g, 3.0, 2.3, 6.2, 3.5, 8.4, 4.8, 1.5, 1.25, coat, 0.5);
    hand(9.2, -4.7); hand(9.0, 5.2);
    head(5.6, -0.3, 0.15, false);
    decPouch(g, -2.2, -3.0, 0.3);
  } else if (pose === 1) {
    // FACE UP, arms flung wide, one knee up. "Shot and dropped straight back."
    decJointLimb(g, -3.0, -1.4, -6.8, -1.9, -10.2, -1.2, 2.0, 1.55, breech, 0.5);
    decJointLimb(g, -3.0, 1.4, -6.3, 4.0, -3.6, 6.4, 2.0, 1.55, breech, 0.5);
    boots(-10.9, -1.0, -0.15);
    boots(-3.0, 7.1, 1.3);
    torso(0, 0, -0.04, heavy);
    decJointLimb(g, 2.6, -2.5, 4.8, -5.0, 6.6, -7.2, 1.5, 1.25, coat, 0.5);
    decJointLimb(g, 2.6, 2.5, 4.4, 5.2, 5.8, 7.4, 1.5, 1.25, coat, 0.5);
    hand(7.2, -7.8); hand(6.2, 8.0);
    head(5.4, 0.5, -0.35, true);
  } else if (pose === 2) {
    // CURLED ON HIS SIDE, knees drawn up, one arm across the chest. Compact —
    // this is the silhouette that breaks up a field of long horizontal shapes.
    decJointLimb(g, -2.6, 1.4, -6.2, 4.0, -2.8, 6.2, 1.95, 1.5, breech, 0.5);
    decJointLimb(g, -2.8, -0.4, -6.8, 1.2, -3.8, 3.6, 1.95, 1.5, breech, 0.5);
    boots(-2.1, 6.9, 1.5);
    boots(-3.2, 4.1, 1.2);
    torso(0.4, 0.2, -0.28, heavy);
    decJointLimb(g, 2.4, 1.0, 1.6, 3.2, 0.4, 4.4, 1.45, 1.2, coat, 0.5);
    decJointLimb(g, 2.8, -1.6, 5.6, -3.4, 7.8, -4.6, 1.45, 1.2, coat, 0.5);
    hand(-0.2, 5.0); hand(8.5, -5.0);
    head(4.9, -1.7, -0.75, true);
  } else {
    // CRUMPLED AND TWISTED, one arm pinned beneath, head thrown back.
    decJointLimb(g, -3.0, 0.9, -6.2, 2.4, -9.0, 3.4, 1.95, 1.5, breech, 0.5);
    decJointLimb(g, -3.0, -0.9, -6.6, -0.2, -9.4, -1.6, 1.95, 1.5, breech, 0.5);
    boots(-9.7, 3.9, 0.35);
    boots(-10.1, -2.0, -0.35);
    torso(0, 0, 0.52, heavy);
    decJointLimb(g, 2.2, -2.0, 5.2, -1.6, 8.0, -0.9, 1.5, 1.25, coat, 0.5);
    hand(-1.6, 3.2);          // the pinned arm: only the hand escapes
    hand(8.7, -0.7);
    head(5.2, 2.1, 0.85, true);
    decPouch(g, -3.4, -2.4, -0.4);
  }

  // ---- hat, always displaced. A dead man does not keep his hat. ------------
  const hatA = rng() * DEC_TAU;
  const hatD = decR(rng, 4.2, 6.6);
  const hx = Math.cos(hatA) * hatD * 1.2;
  const hy = Math.sin(hatA) * hatD * 0.8;
  if (kit.hat === 'helmet') decHelmet(g, hx, hy, decR(rng, 0, DEC_TAU));
  else if (kit.hat === 'cap') decCap(g, hx, hy, decR(rng, 0, DEC_TAU), kit.coat);
  else decTricorn(g, hx, hy, decR(rng, 0, DEC_TAU), rng, kit.trim);

  // ---- dropped weapon -----------------------------------------------------
  const wa = decR(rng, 0, DEC_TAU);
  if (kit.weapon === 'pike') {
    // 22 world px of ash shaft lying across the body: an unmistakable
    // silhouette even as a pure black shape at 8 screen px, which is exactly
    // what musketeer-vs-pikeman currently fails.
    const cxp = decR(rng, -3, 3), cyp = decR(rng, -2, 5);
    decPike(g, cxp - Math.cos(wa) * 11, cyp - Math.sin(wa) * 8,
      cxp + Math.cos(wa) * 11, cyp + Math.sin(wa) * 8);
  } else if (kit.weapon === 'tool') {
    const cxp = decR(rng, -2, 5), cyp = decR(rng, 1, 6);
    decTool(g, cxp - Math.cos(wa) * 4, cyp - Math.sin(wa) * 3,
      cxp + Math.cos(wa) * 4, cyp + Math.sin(wa) * 3);
  } else {
    const cxp = decR(rng, -2, 4), cyp = decR(rng, 1, 6);
    decMusket(g, cxp - Math.cos(wa) * 6.5, cyp - Math.sin(wa) * 4.6,
      cxp + Math.cos(wa) * 6.5, cyp + Math.sin(wa) * 4.6);
  }
}

// ============================================================================
//  FALLEN CAVALRY — a dead horse is a BIG shape and must read as one. Three
//  collapse poses, each disposing of the rider differently.
// ============================================================================

function decPaintCavalry(g, rng, kit, pose) {
  const hides = ['#553D28', '#3E2C1C', '#6B4A2C', '#7A736A', '#4A3324'];
  const hideHex = decPick(rng, hides);
  const hide = decJitterRamp(decRamp(hideHex), rng, 0.07);
  const mane = decRamp(decMix(hideHex, '#181109', 0.55));
  const muzzle = decRamp(decMix(hideHex, '#1A1208', 0.4));
  const hoof = decRamp('#2A2018');
  const coat = decJitterRamp(decRamp(kit.coat), rng, 0.06);
  const trim = decRamp(kit.trim);
  const skin = decRamp(kit.skin);
  const tack = decRamp('#3A2A1A');
  const breech = decRamp('#B7AC8E');

  function leg(hx, hy, kx, ky, fx, fy, w) {
    decJointLimb(g, hx, hy, kx, ky, fx, fy, w, w * 0.62, hide, 0.55);
    decDome(g, fx, fy, w * 0.5, w * 0.42, Math.atan2(fy - ky, fx - kx), hoof, 0.8);
  }
  function saddle(sx, sy, rot) {
    decPush(g, sx, sy, rot);
    // shabraque in the nation trim — the only saturated block on a horse, and
    // the thing that tells you whose cavalry died here
    g.fillStyle = trim.base;
    g.beginPath(); g.ellipse(0, 0, 3.9, 2.9, 0, 0, DEC_TAU); g.fill();
    g.fillStyle = trim.shade;
    g.beginPath();
    g.ellipse(DEC_L.sx * 1.4, DEC_L.sy * 1.1, 3.2, 2.4, 0, 0, DEC_TAU);
    g.fill();
    g.strokeStyle = trim.edge;
    g.lineWidth = 0.3;
    g.globalAlpha = 0.7;
    g.beginPath(); g.ellipse(0, 0, 3.7, 2.7, 0, DEC_L.ang - 1.2, DEC_L.ang + 1.2); g.stroke();
    g.globalAlpha = 1;
    decPop(g);
    decDome(g, sx - 0.4, sy - 0.6, 2.5, 1.9, rot, tack, 0.8);
  }
  function tail(bx, by, dx1, dy1, dx2, dy2) {
    for (let i = 0; i < 10; i++) {
      g.strokeStyle = i & 1 ? mane.base : mane.shade;
      g.lineWidth = decR(rng, 0.35, 0.85);
      g.beginPath();
      g.moveTo(bx, by + decR(rng, -1.4, 1.4));
      g.quadraticCurveTo(bx + dx1, by + dy1 + decR(rng, -1.4, 1.4),
        bx + dx2, by + dy2 + decR(rng, -1.8, 1.8));
      g.stroke();
    }
  }
  function crest(x0, y0, x1v, y1v, spread) {
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const bx = x0 + (x1v - x0) * t, by = y0 + (y1v - y0) * t;
      g.strokeStyle = i & 1 ? mane.base : mane.shade;
      g.lineWidth = decR(rng, 0.4, 0.9);
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + spread[0] + decR(rng, -0.8, 0.8), by + spread[1] + decR(rng, -0.8, 0.8));
      g.stroke();
    }
  }

  if (pose === 0) {
    // ON HIS SIDE, legs extended stiffly, neck stretched out flat.
    leg(5.2, 3.0, 6.6, 7.4, 7.6, 11.4, 2.3);
    leg(2.0, 3.2, 1.4, 7.6, 0.8, 11.8, 2.3);
    leg(-4.6, 3.0, -5.8, 7.0, -6.8, 10.6, 2.6);
    leg(-7.4, 2.6, -8.8, 6.2, -10.0, 9.4, 2.6);
    decDome(g, -6.2, -0.4, 5.0, 4.6, 0.1, hide, 0.7);
    decDome(g, 0.4, 0, 9.3, 5.2, 0.06, hide, 0.85);
    saddle(1.6, -1.2, 0.08);
    g.strokeStyle = tack.base; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(2.0, -4.4); g.lineTo(1.2, 4.6); g.stroke();
    decLimb(g, 7.6, -1.4, 13.4, -3.4, 4.3, hide, 0.6);
    decLimb(g, 12.2, -3.0, 15.6, -4.2, 3.0, hide, 0.7);
    decDome(g, 16.6, -4.6, 3.0, 1.9, -0.32, hide, 0.9);
    decDome(g, 18.9, -5.4, 1.35, 1.0, -0.32, muzzle, 0.8);
    g.fillStyle = mane.base;
    g.beginPath(); g.ellipse(14.9, -6.0, 0.85, 0.5, -0.9, 0, DEC_TAU); g.fill();
    g.strokeStyle = decRgba('#14100A', 0.75); g.lineWidth = 0.3;
    g.beginPath(); g.moveTo(16.0, -5.6); g.lineTo(17.1, -5.8); g.stroke();
    crest(7.8, -3.2, 16.4, -5.1, [-0.6, -2.0]);
    g.strokeStyle = tack.base; g.lineWidth = 0.42;
    g.beginPath(); g.moveTo(16.0, -3.1); g.lineTo(18.4, -4.3); g.stroke();
    g.beginPath(); g.moveTo(15.4, -5.6); g.lineTo(15.9, -2.9); g.stroke();
    g.strokeStyle = decRgba('#332415', 0.8); g.lineWidth = 0.36;
    g.beginPath();
    g.moveTo(16.4, -3.4);
    g.quadraticCurveTo(13.0, 2.6, 8.4, 4.2);
    g.stroke();                                   // reins trailing in the dirt
    tail(-10.6, -0.6, -3.0, 1.2, -5.6, 3.4);
    // rider pinned behind the horse
    decJointLimb(g, -3.4, -6.4, -6.4, -8.0, -9.2, -8.4, 1.7, 1.4, breech, 0.5);
    decDome(g, -1.0, -6.6, 4.1, 2.9, -0.2, coat, 0.8);
    decJointLimb(g, 1.6, -7.6, 4.2, -9.6, 6.2, -11.0, 1.4, 1.2, coat, 0.5);
    decDome(g, 6.9, -11.5, 0.8, 0.7, 0, skin, 0.9);
    decDome(g, 2.9, -6.0, 2.0, 1.8, 0.3, skin, 0.95);
    decTricorn(g, 6.6, -6.0, decR(rng, 0, DEC_TAU), rng, kit.trim);
    decSabre(g, -6.0, -12.4, 3.2, -13.8);
  } else if (pose === 1) {
    // COLLAPSED FORWARD onto folded legs, head tucked back over the shoulder,
    // rider thrown clear ahead and face down.
    leg(4.6, 2.6, 7.8, 5.2, 4.2, 7.0, 2.3);
    leg(1.6, 3.0, 4.4, 6.2, 0.6, 7.6, 2.3);
    leg(-4.8, 2.8, -8.4, 5.0, -4.6, 7.2, 2.6);
    leg(-7.6, 2.2, -11.0, 4.0, -7.4, 6.4, 2.6);
    decDome(g, -6.6, -0.8, 5.2, 4.8, -0.14, hide, 0.7);
    decDome(g, 0, -0.4, 9.0, 5.4, -0.05, hide, 0.85);
    saddle(1.0, -2.0, -0.06);
    decLimb(g, 7.2, -2.0, 11.4, -5.6, 4.2, hide, 0.6);
    decLimb(g, 10.6, -5.2, 8.6, -8.4, 3.0, hide, 0.7);
    decDome(g, 6.6, -9.6, 2.9, 2.0, -1.15, hide, 0.9);
    decDome(g, 5.4, -11.6, 1.3, 1.0, -1.15, muzzle, 0.8);
    g.fillStyle = mane.base;
    g.beginPath(); g.ellipse(8.4, -10.0, 0.85, 0.5, 0.3, 0, DEC_TAU); g.fill();
    crest(8.0, -3.0, 11.0, -8.4, [1.6, 0.2]);
    tail(-10.8, -1.4, -3.4, -1.6, -6.2, -1.0);
    decJointLimb(g, 12.8, 5.2, 15.6, 7.2, 18.2, 8.4, 1.7, 1.4, breech, 0.5);
    decJointLimb(g, 12.6, 7.4, 15.0, 9.6, 17.4, 10.6, 1.7, 1.4, breech, 0.5);
    decDome(g, 10.4, 6.4, 4.2, 3.0, 0.42, coat, 0.8);
    decJointLimb(g, 8.2, 4.2, 5.8, 2.2, 3.4, 1.2, 1.4, 1.2, coat, 0.5);
    decDome(g, 2.6, 0.9, 0.8, 0.7, 0, skin, 0.9);
    decDome(g, 7.8, 4.6, 2.0, 1.8, 0.4, skin, 0.95);
    decTricorn(g, 4.0, 8.8, decR(rng, 0, DEC_TAU), rng, kit.trim);
    decSabre(g, 14.0, 1.0, 19.4, 3.2);
  } else {
    // ON HIS BACK, legs up and rigid. Brutal, unmistakable, and it breaks the
    // horizontal monotony of a field of dead.
    leg(4.8, -2.4, 6.4, -7.0, 7.0, -10.8, 2.3);
    leg(1.8, -2.6, 1.0, -7.2, 0.4, -11.0, 2.3);
    leg(-4.4, -2.4, -5.6, -6.6, -6.4, -10.0, 2.6);
    leg(-7.2, -2.0, -8.6, -5.8, -9.6, -8.8, 2.6);
    decDome(g, -6.0, 0.6, 5.0, 4.7, -0.06, hide, 0.7);
    decDome(g, 0.6, 0.4, 9.1, 5.5, 0.02, hide, 0.85);
    g.fillStyle = decRgba(decMix(hideHex, '#D8C8A8', 0.5), 0.5);
    g.beginPath(); g.ellipse(0.2, -0.6, 7.2, 3.4, 0.02, 0, DEC_TAU); g.fill();
    g.strokeStyle = tack.base; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(2.2, -4.8); g.lineTo(1.6, 5.0); g.stroke();
    saddle(3.2, 6.2, 0.5);                        // saddle hanging off the flank
    decLimb(g, 8.0, 1.6, 13.2, 4.4, 4.2, hide, 0.6);
    decLimb(g, 12.4, 4.2, 15.8, 5.6, 3.0, hide, 0.7);
    decDome(g, 16.8, 6.0, 3.0, 1.9, 0.36, hide, 0.9);
    decDome(g, 19.1, 6.9, 1.35, 1.0, 0.36, muzzle, 0.8);
    g.fillStyle = mane.base;
    g.beginPath(); g.ellipse(15.0, 7.6, 0.85, 0.5, 0.9, 0, DEC_TAU); g.fill();
    crest(8.2, 4.6, 16.6, 6.6, [-0.4, 2.0]);
    tail(-10.4, 1.4, -3.4, 1.8, -6.2, 2.4);
    decJointLimb(g, -4.0, 8.2, -7.4, 9.6, -10.4, 9.2, 1.7, 1.4, breech, 0.5);
    decDome(g, -1.6, 8.4, 4.1, 2.9, 0.16, coat, 0.8);
    decJointLimb(g, 1.0, 9.6, 3.6, 11.4, 6.0, 12.2, 1.4, 1.2, coat, 0.5);
    decDome(g, 6.7, 12.6, 0.8, 0.7, 0, skin, 0.9);
    decDome(g, 2.3, 7.7, 2.0, 1.8, -0.25, skin, 0.95);
    decTricorn(g, 6.4, 8.4, decR(rng, 0, DEC_TAU), rng, kit.trim);
    decSabre(g, -8.0, 13.0, -1.4, 14.6);
  }
}

// ============================================================================
//  STAMP BAKERS
// ============================================================================

let decStamps = null;    // built once per battle

const DEC_BOX = {
  musk: [46, 46],
  pike: [52, 52],
  villager: [42, 42],
  cav: [66, 66],
};

// Bake ONE corpse: ground scuff, blood, figure — all rotated to `heading`,
// all lit from the fixed sun via DEC_L.
function decBakeCorpse(kit, type, pose, heading, seed) {
  const box = DEC_BOX[type] || DEC_BOX.musk;
  const W = box[0], H = box[1];

  decSetRot(heading);

  // --- layer 1: the ground the body disturbed -----------------------------
  const [groundC, gg] = decStampCanvas(W, H);
  gg.rotate(heading);
  decGroundScuff(gg, decRng(seed ^ 0x51ed3a71), 0, 0,
    type === 'cav' ? 13 : 7.5, type === 'cav' ? 9 : 5.5, type === 'cav' ? 1.5 : 1);

  // --- layer 2: blood ------------------------------------------------------
  const [bloodC, bg] = decStampCanvas(W, H);
  bg.rotate(heading);
  const brng = decRng(seed ^ 0x9d2c8f13);
  if (type === 'cav') {
    decBloodPool(bg, brng, decR(brng, -2, 6), decR(brng, -1, 4),
      decR(brng, 7.0, 9.5), decR(brng, 4.8, 6.8), 1);
    decBloodPool(bg, brng, decR(brng, -10, -4), decR(brng, -4, 4),
      decR(brng, 3.2, 5.0), decR(brng, 2.2, 3.6), 0.75);
  } else {
    decBloodPool(bg, brng, decR(brng, -1.5, 3.5), decR(brng, -1, 2.5),
      decR(brng, 4.6, 6.8), decR(brng, 3.2, 4.8), 1);
    if (brng() < 0.55) {
      decBloodPool(bg, brng, decR(brng, -8, -3), decR(brng, -3, 4),
        decR(brng, 2.2, 3.4), decR(brng, 1.6, 2.4), 0.62);
    }
  }

  // --- layer 3: figure + kit (one shared lining) ---------------------------
  const [figC, fg] = decStampCanvas(W, H);
  fg.rotate(heading);
  const rng = decRng(seed);
  if (type === 'cav') decPaintCavalry(fg, rng, kit, pose % 3);
  else decPaintInfantry(fg, rng, kit, pose % 4);
  // Material-tinted lining, not vector black — so the outline reads as PAINTED.
  // decRamp's force-clamp guarantees relative luminance <= 58 for any coat a
  // user may add to config.js later, which is what makes this safe to tint.
  decFinish(figC, {
    light: 1, wash: 0.20, washBlur: 1.6, varnish: 0.045,
    lineColour: decMix(decRamp(kit.coat).line, '#141118', 0.45),
    linePx: DEC_OS, lineAlpha: 1,   // a true 1 world px painted lining
    aoPx: type === 'cav' ? 6 : 4, aoAlpha: 0.5,
  });

  decSetRot(0);

  // --- composite: scuff -> blood -> cast shadow -> figure ------------------
  const [outC, og] = decCanvas(W * DEC_OS, H * DEC_OS);
  og.drawImage(groundC, 0, 0);
  og.drawImage(bloodC, 0, 0);
  const shadow = decSilhouette(figC, 'rgba(' + DEC_SUN.shadowRGB + ',1)');
  og.save();
  og.globalAlpha = 0.42;
  og.filter = 'blur(2.6px)';
  og.drawImage(shadow, DEC_SUN.sx * 2.2 * DEC_OS, DEC_SUN.sy * 2.2 * DEC_OS);
  og.filter = 'none';
  og.restore();
  og.drawImage(figC, 0, 0);

  outC._wWorld = W;
  outC._hWorld = H;
  return outC;
}

// ---- CRATERS ---------------------------------------------------------------
// What makes a hole read as a hole is the inversion: LIT OUTER RIM on the sun
// side paired with a LIT INNER WALL on the OPPOSITE side. Get that backwards
// and you have drawn a dome. Two stacked dark ellipses (the current code) read
// as a stain, which is exactly the reported defect.
function decBakeCrater(seed) {
  // The box must contain the EJECTA, not just the bowl. Rays reach R*2.75 and
  // scorch tongues R*2.1 with R up to 19, i.e. 52 world px in x and 39 in y.
  // At the original 70x58 every ray and tongue was sliced off dead straight by
  // the canvas edge, stamping a hard rectangle around every shell hole — the
  // exact "analytic edge" the rest of this file works to avoid.
  const W = 124, H = 96;
  const rng = decRng(seed);
  const [c, g] = decStampCanvas(W, H);
  decSetRot(0);

  const R = decR(rng, 14, 19);
  const RY = R * decR(rng, 0.66, 0.78);
  const earth = decRamp(DEC_PAL.EARTH);
  const earthL = decRamp(DEC_PAL.EARTH_LIGHT);
  const rock = decRamp(DEC_PAL.ROCK);

  // 1. Sooty apron built from overlapping soft blobs — no analytic edge.
  for (let i = 0; i < 16; i++) {
    const a = rng() * DEC_TAU, d = Math.pow(rng(), 0.5);
    const x = Math.cos(a) * R * 1.9 * d, y = Math.sin(a) * RY * 1.9 * d;
    const r = decR(rng, R * 0.5, R * 1.15);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, decRgba(DEC_PAL.CHAR, 0.22));
    grd.addColorStop(0.55, decRgba(DEC_PAL.CHAR, 0.11));
    grd.addColorStop(1, decRgba(DEC_PAL.CHAR, 0));
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, y, r, r * 0.72, 0, 0, DEC_TAU); g.fill();
  }

  // 2. Ejecta rays: tapered wedges of thrown soil, brightest at the rim.
  const rays = 16 + ((rng() * 8) | 0);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * DEC_TAU + decR(rng, -0.14, 0.14);
    const inner = R * decR(rng, 0.85, 1.05);
    const outer = R * decR(rng, 1.35, 2.75);
    const wBase = decR(rng, 0.10, 0.26);
    const ca = Math.cos(a), sa = Math.sin(a) * 0.74;
    const grd = g.createLinearGradient(ca * inner, sa * inner, ca * outer, sa * outer);
    grd.addColorStop(0, decRgba(DEC_PAL.EARTH_LIGHT, 0.55));
    grd.addColorStop(0.4, decRgba(DEC_PAL.EARTH, 0.34));
    grd.addColorStop(1, decRgba(DEC_PAL.EARTH, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(Math.cos(a - wBase) * inner, Math.sin(a - wBase) * inner * 0.74);
    g.lineTo(ca * outer, sa * outer);
    g.lineTo(Math.cos(a + wBase) * inner, Math.sin(a + wBase) * inner * 0.74);
    g.closePath();
    g.fill();
  }

  // 3. Thrown clods and a few exposed stones out on the apron.
  decClods(g, rng, 0, 0, R * 2.3, R * 1.7, 44, earth, 0.35, 1.25, 0.35);
  decClods(g, rng, 0, 0, R * 1.5, R * 1.1, 7, rock, 0.5, 1.1, 0.5);

  // 4. The raised rim, built from ~30 overlapping lumps so the lip is organic
  //    rather than a traced ellipse.
  const lumps = 30;
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * DEC_TAU;
    const rr = R * decR(rng, 0.94, 1.10);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.74;
    const s = decR(rng, R * 0.16, R * 0.30);
    const facing = Math.cos(a) * DEC_SUN.x + Math.sin(a) * DEC_SUN.y;  // 1 = up-left
    g.fillStyle = facing > 0 ? earthL.base : earth.shade;
    g.beginPath(); g.ellipse(x, y, s, s * 0.72, a, 0, DEC_TAU); g.fill();
    if (facing > 0.15) {
      g.fillStyle = earthL.light;
      g.beginPath();
      g.ellipse(x - DEC_SUN.sx * s * 0.32, y - DEC_SUN.sy * s * 0.32, s * 0.58, s * 0.4, a, 0, DEC_TAU);
      g.fill();
    } else if (facing < -0.15) {
      g.fillStyle = decRgba('#3A3245', 0.55);
      g.beginPath();
      g.ellipse(x + DEC_SUN.sx * s * 0.2, y + DEC_SUN.sy * s * 0.2, s * 0.8, s * 0.55, a, 0, DEC_TAU);
      g.fill();
    }
  }

  // 5. The bowl, clipped to the crater mouth so nothing spills over the lip.
  g.save();
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * DEC_TAU;
    const wob = 1 + Math.sin(a * 3.3 + R) * 0.06 + Math.sin(a * 6.1) * 0.04;
    const x = Math.cos(a) * R * 0.90 * wob, y = Math.sin(a) * RY * 0.90 * wob;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.clip();

  g.fillStyle = '#2A2016';
  g.fillRect(-W, -H, W * 2, H * 2);

  // 5a. LIT inner wall on the anti-sun side — it faces up-left, into the key.
  const litX = DEC_SUN.sx * R * 0.62, litY = DEC_SUN.sy * RY * 0.62;
  const wallGrd = g.createRadialGradient(litX, litY, 0, litX, litY, R * 0.95);
  wallGrd.addColorStop(0, decRgba('#7A5F3E', 0.62));
  wallGrd.addColorStop(0.55, decRgba('#5A452C', 0.34));
  wallGrd.addColorStop(1, decRgba('#5A452C', 0));
  g.fillStyle = wallGrd;
  g.fillRect(-W, -H, W * 2, H * 2);
  g.globalAlpha = 0.5;
  g.strokeStyle = DEC_PAL.EARTH_LIGHT;
  g.lineWidth = R * 0.13;
  g.beginPath();
  g.ellipse(0, 0, R * 0.78, RY * 0.78, 0, DEC_SUN.ang + Math.PI - 1.05, DEC_SUN.ang + Math.PI + 1.05);
  g.stroke();
  g.globalAlpha = 1;

  // 5b. SHADOWED inner wall directly beneath the sun-side rim.
  const shX = -DEC_SUN.sx * R * 0.72, shY = -DEC_SUN.sy * RY * 0.72;
  const shGrd = g.createRadialGradient(shX, shY, 0, shX, shY, R * 1.05);
  shGrd.addColorStop(0, decRgba('#12100C', 0.78));
  shGrd.addColorStop(0.6, decRgba('#12100C', 0.34));
  shGrd.addColorStop(1, decRgba('#12100C', 0));
  g.fillStyle = shGrd;
  g.fillRect(-W, -H, W * 2, H * 2);

  // 5c. Deepest point: near-black, pulled toward the shadowed wall.
  const cX = -DEC_SUN.sx * R * 0.18, cY = -DEC_SUN.sy * RY * 0.18;
  const cGrd = g.createRadialGradient(cX, cY, 0, cX, cY, R * 0.46);
  cGrd.addColorStop(0, decRgba('#0C0A07', 0.85));
  cGrd.addColorStop(1, decRgba('#0C0A07', 0));
  g.fillStyle = cGrd;
  g.beginPath(); g.ellipse(cX, cY, R * 0.5, RY * 0.5, 0, 0, DEC_TAU); g.fill();

  // 5d. Torn soil inside the bowl: radial gouges, loose spoil, scorched flecks.
  for (let i = 0; i < 30; i++) {
    const a = rng() * DEC_TAU;
    const r0 = decR(rng, R * 0.15, R * 0.5);
    const r1 = r0 + decR(rng, R * 0.15, R * 0.42);
    g.strokeStyle = rng() < 0.5 ? decRgba('#3D2E1D', 0.5) : decRgba('#8A6C46', 0.28);
    g.lineWidth = decR(rng, 0.28, 0.8);
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.74);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.74);
    g.stroke();
  }
  decClods(g, rng, 0, 0, R * 0.7, R * 0.5, 16, decRamp('#5A452C'), 0.28, 0.8, 0.5);
  for (let i = 0; i < 26; i++) {
    const a = rng() * DEC_TAU, d = Math.pow(rng(), 0.5);
    g.fillStyle = decRgba(DEC_PAL.SOOT, decR(rng, 0.25, 0.7));
    g.beginPath();
    g.ellipse(Math.cos(a) * R * 0.8 * d, Math.sin(a) * RY * 0.8 * d,
      decR(rng, 0.2, 0.75), decR(rng, 0.15, 0.5), a, 0, DEC_TAU);
    g.fill();
  }
  g.restore();

  // 6. Scorch tongues licking outward past the rim.
  for (let i = 0; i < 9; i++) {
    const a = rng() * DEC_TAU;
    const len = decR(rng, R * 1.1, R * 2.1);
    const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len * 0.74);
    grd.addColorStop(0, decRgba(DEC_PAL.SOOT, 0.30));
    grd.addColorStop(1, decRgba(DEC_PAL.SOOT, 0));
    g.strokeStyle = grd;
    g.lineWidth = decR(rng, 1.2, 3.4);
    g.beginPath();
    g.moveTo(Math.cos(a) * R * 0.6, Math.sin(a) * RY * 0.6);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.74);
    g.stroke();
  }

  // 7. Ring of blown-flat, singed grass just outside the ejecta.
  for (let i = 0; i < 60; i++) {
    const a = rng() * DEC_TAU;
    const d = decR(rng, 1.05, 1.7);
    const x = Math.cos(a) * R * d, y = Math.sin(a) * RY * d;
    const len = decR(rng, 1.2, 3.2);
    g.strokeStyle = rng() < 0.5 ? decRgba(DEC_PAL.CHAR, 0.34) : decRgba(DEC_PAL.STRAW, 0.22);
    g.lineWidth = decR(rng, 0.22, 0.5);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.74);
    g.stroke();
  }

  decGalleryLight(c, 0.5);
  c._wWorld = W;
  c._hWorld = H;
  return c;
}

// ---- WRECKED CANNON --------------------------------------------------------
function decBakeWreck(kit, heading, seed) {
  const W = 62, H = 62;
  const rng = decRng(seed);

  decSetRot(heading);

  const [groundC, gg] = decStampCanvas(W, H);
  gg.rotate(heading);
  decGroundScuff(gg, decRng(seed ^ 0x2f1d9b07), 0, 1, 13, 8, 1.3);
  for (let i = 0; i < 11; i++) {
    const a = rng() * DEC_TAU, d = Math.pow(rng(), 0.6);
    const x = Math.cos(a) * 13 * d, y = 1 + Math.sin(a) * 8 * d;
    const r = decR(rng, 4, 9);
    const grd = gg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, decRgba(DEC_PAL.SOOT, 0.30));
    grd.addColorStop(1, decRgba(DEC_PAL.SOOT, 0));
    gg.fillStyle = grd;
    gg.beginPath(); gg.ellipse(x, y, r, r * 0.66, 0, 0, DEC_TAU); gg.fill();
  }

  const [c, g] = decStampCanvas(W, H);
  g.rotate(heading);
  const wood = decRamp(DEC_PAL.WOOD);
  const woodPale = decRamp(DEC_PAL.WOOD_PALE);
  const iron = decRamp(DEC_PAL.IRON);
  const brass = decRamp('#8C6A32');
  const variant = seed % 3;

  // --- trail: two splintered cheek timbers, snapped apart ------------------
  const skew = decR(rng, -0.5, 0.5);
  decSplinter(g, -18, 6, -5, 3 + skew * 2, 2.3, wood, rng, true);
  decSplinter(g, -6, 8.5, 7.5, 6.0 + skew, 2.5, wood, rng, true);
  decPanel(g, -1.5, 4.0, 12, 3.2, skew * 0.4 + 0.06, wood, 0.65);
  g.strokeStyle = decRgba('#181209', 0.7);
  g.lineWidth = 0.5;
  g.beginPath();
  g.moveTo(-2.5, 2.2); g.lineTo(-0.5, 4.0); g.lineTo(-2.0, 5.8);
  g.stroke();
  // iron strapping torn loose and curling
  g.strokeStyle = iron.base;
  g.lineWidth = 0.75;
  g.beginPath();
  g.moveTo(-9, 5.0);
  g.quadraticCurveTo(-12.5, 1.4, -15.5, 3.6);
  g.stroke();
  g.strokeStyle = iron.light;
  g.lineWidth = 0.26;
  g.beginPath();
  g.moveTo(-9 - DEC_L.sx * 0.3, 5.0 - DEC_L.sy * 0.3);
  g.quadraticCurveTo(-12.5 - DEC_L.sx * 0.3, 1.4 - DEC_L.sy * 0.3,
    -15.5 - DEC_L.sx * 0.3, 3.6 - DEC_L.sy * 0.3);
  g.stroke();

  // --- wheels: at least one survives as an upright RING --------------------
  if (variant === 0) {
    decWheel(g, -10.5, 9.5, 6.2, wood, rng, true, 0.45);
    decWheel(g, 9.0, 2.0, 6.6, wood, rng, false, 0.95);
  } else if (variant === 1) {
    decWheel(g, 11.0, 9.0, 6.4, wood, rng, true, 0.5);
    decWheel(g, -9.5, 1.5, 6.0, wood, rng, true, 0.9);
  } else {
    decWheel(g, -12.0, 7.5, 6.0, wood, rng, false, 0.42);
    decWheel(g, 12.5, 5.0, 6.4, wood, rng, true, 0.85);
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * DEC_TAU;
    const x = decR(rng, -20, 20), y = decR(rng, -8, 15);
    decSplinter(g, x, y, x + Math.cos(a) * decR(rng, 2.5, 5.5),
      y + Math.sin(a) * decR(rng, 1.6, 3.6), decR(rng, 0.7, 1.2), woodPale, rng, true);
  }

  // --- the barrel, dismounted, muzzle low ----------------------------------
  const ba = decR(rng, -0.55, -0.15) + (variant === 2 ? 0.9 : 0);
  const bcx = decR(rng, -1, 3), bcy = decR(rng, -6, -2);
  const bl = 15.5;
  const bx1 = bcx - Math.cos(ba) * bl * 0.5, by1 = bcy - Math.sin(ba) * bl * 0.5;
  const bx2 = bcx + Math.cos(ba) * bl * 0.5, by2 = bcy + Math.sin(ba) * bl * 0.5;
  decLimb(g, bx1, by1, bcx, bcy, 3.5, iron, 0.9);     // breech is fatter
  decLimb(g, bcx, bcy, bx2, by2, 2.7, iron, 0.9);     // than the muzzle
  decDome(g, bx1, by1, 2.2, 2.0, ba, iron, 0.95);     // cascabel
  for (let t = 0; t < 3; t++) {
    const f = [0.28, 0.52, 0.78][t];
    const rx = bx1 + (bx2 - bx1) * f, ry = by1 + (by2 - by1) * f;
    g.strokeStyle = brass.base;
    g.lineWidth = 0.55;
    g.beginPath();
    g.moveTo(rx - Math.sin(ba) * 1.7, ry + Math.cos(ba) * 1.7);
    g.lineTo(rx + Math.sin(ba) * 1.7, ry - Math.cos(ba) * 1.7);
    g.stroke();
    g.strokeStyle = brass.light;
    g.lineWidth = 0.22;
    g.beginPath();
    g.moveTo(rx - Math.sin(ba) * 1.7 - DEC_L.sx * 0.26, ry + Math.cos(ba) * 1.7 - DEC_L.sy * 0.26);
    g.lineTo(rx + Math.sin(ba) * 1.7 - DEC_L.sx * 0.26, ry - Math.cos(ba) * 1.7 - DEC_L.sy * 0.26);
    g.stroke();
  }
  decDome(g, bcx - Math.sin(ba) * 2.6, bcy + Math.cos(ba) * 2.6, 1.0, 0.85, ba, iron, 0.9);
  // THE BORE: a genuine hole in the silhouette, second only to the wheel ring
  decPush(g, bx2, by2, ba);
  g.fillStyle = '#0B0B0D';
  g.beginPath(); g.ellipse(0, 0, 0.85, 1.25, 0, 0, DEC_TAU); g.fill();
  g.strokeStyle = decRgba('#9AA0A8', 0.7);
  g.lineWidth = 0.3;
  g.beginPath();
  g.ellipse(0, 0, 1.25, 1.6, 0, DEC_L.ang - 1.2, DEC_L.ang + 1.2);
  g.stroke();
  decPop(g);
  g.fillStyle = decRgba(DEC_PAL.SOOT, 0.35);
  g.beginPath(); g.ellipse(bx2, by2, 2.6, 2.0, ba, 0, DEC_TAU); g.fill();

  // --- burst ammunition chest, round shot spilled -------------------------
  const chx = decR(rng, -20, -13), chy = decR(rng, -5, 4);
  decPanel(g, chx, chy, 7.5, 5.0, decR(rng, -0.5, 0.5), decRamp('#4E3B24'), 0.7);
  g.strokeStyle = decRgba('#181209', 0.7);
  g.lineWidth = 0.45;
  g.beginPath();
  g.moveTo(chx - 3, chy - 1.6); g.lineTo(chx + 1.2, chy + 0.6); g.lineTo(chx + 3.4, chy - 1.2);
  g.stroke();
  for (let i = 0; i < 7; i++) {
    const sx = chx + decR(rng, -1, 9), sy = chy + decR(rng, -2, 6);
    const sr = decR(rng, 0.8, 1.25);
    g.fillStyle = 'rgba(' + DEC_SUN.shadowRGB + ',0.35)';
    g.beginPath();
    g.ellipse(sx + DEC_L.sx * sr * 0.7, sy + DEC_L.sy * sr * 0.7, sr, sr * 0.6, 0, 0, DEC_TAU);
    g.fill();
    decDome(g, sx, sy, sr, sr, 0, decRamp('#26262A'), 1);
  }

  // --- rammer and sponge staves flung clear -------------------------------
  for (let i = 0; i < 2; i++) {
    const a = rng() * DEC_TAU;
    const px = decR(rng, -6, 16), py = decR(rng, 8, 15);
    decLimb(g, px - Math.cos(a) * 6, py - Math.sin(a) * 3.4,
      px + Math.cos(a) * 6, py + Math.sin(a) * 3.4, 0.8, woodPale, 0.6);
    decDome(g, px + Math.cos(a) * 6, py + Math.sin(a) * 3.4, 1.1, 0.9, a, decRamp('#6B5A3A'), 0.7);
  }

  // --- a torn side-coloured cover: the only saturated block, and the only
  //     thing that tells you whose gun this was
  decPush(g, decR(rng, 4, 14), decR(rng, 9, 14), decR(rng, 0, DEC_TAU));
  const cloth = decRamp(kit.coat);
  g.fillStyle = cloth.base;
  g.beginPath();
  g.moveTo(-3.2, -1.6); g.lineTo(1.0, -2.4); g.lineTo(3.4, 0.4);
  g.lineTo(0.6, 2.3); g.lineTo(-2.6, 1.4);
  g.closePath();
  g.fill();
  g.fillStyle = cloth.shade;
  g.beginPath();
  g.moveTo(0.2, -1.0); g.lineTo(3.4, 0.4); g.lineTo(0.6, 2.3);
  g.closePath();
  g.fill();
  decPop(g);

  decFinish(c, {
    light: 1, wash: 0.20, washBlur: 1.6, varnish: 0.045,
    lineColour: decMix(decRamp(DEC_PAL.WOOD).line, '#141118', 0.4),
    linePx: DEC_OS, lineAlpha: 1, aoPx: 5, aoAlpha: 0.5,
  });
  decSetRot(0);

  const [outC, og] = decCanvas(W * DEC_OS, H * DEC_OS);
  og.drawImage(groundC, 0, 0);
  const shadow = decSilhouette(c, 'rgba(' + DEC_SUN.shadowRGB + ',1)');
  og.save();
  og.globalAlpha = 0.44;
  og.filter = 'blur(3px)';
  og.drawImage(shadow, DEC_SUN.sx * 2.8 * DEC_OS, DEC_SUN.sy * 2.8 * DEC_OS);
  og.filter = 'none';
  og.restore();
  og.drawImage(c, 0, 0);
  outC._wWorld = W;
  outC._hWorld = H;
  return outC;
}

// ---- RUBBLE CHUNKS (composed into building ruins) --------------------------
function decBakeRubbleChunk(seed) {
  const W = 14, H = 12;
  const rng = decRng(seed);
  const [c, g] = decStampCanvas(W, H);
  decSetRot(0);
  const kind = seed % 3;
  const pal = kind === 0 ? decRamp('#9C8B73')      // dressed masonry
    : kind === 1 ? decRamp('#7B674B')              // rendered wall lump
      : decRamp('#4A3826');                        // charred timber
  const n = 5 + ((rng() * 3) | 0);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * DEC_TAU;
    const r = decR(rng, 2.6, 4.6);
    const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.72;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = pal.base;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = pal.shade;
  g.beginPath();
  g.ellipse(DEC_SUN.sx * 2.6, DEC_SUN.sy * 2.2, 4.4, 3.4, 0, 0, DEC_TAU);
  g.fill();
  g.fillStyle = pal.light;
  g.beginPath();
  g.ellipse(-DEC_SUN.sx * 1.8, -DEC_SUN.sy * 1.5, 2.6, 1.9, 0, 0, DEC_TAU);
  g.fill();
  g.restore();
  g.globalAlpha = 0.75;
  g.strokeStyle = pal.edge;
  g.lineWidth = 0.3;
  g.beginPath();
  g.ellipse(0, 0, 3.3, 2.4, 0, DEC_SUN.ang - 1.2, DEC_SUN.ang + 1.2);
  g.stroke();
  g.globalAlpha = 1;
  if (kind === 2) {
    g.fillStyle = decRgba(DEC_PAL.SOOT, 0.5);
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.ellipse(decR(rng, -3, 3), decR(rng, -2, 2), decR(rng, 0.4, 1.3), decR(rng, 0.3, 0.9),
        rng() * DEC_TAU, 0, DEC_TAU);
      g.fill();
    }
  }
  decFinish(c, {
    light: 0.7, wash: 0.16, washBlur: 1.2, varnish: 0.04,
    lineColour: decMix(pal.line, '#161219', 0.4), linePx: 2, lineAlpha: 0.95,
    aoPx: 3, aoAlpha: 0.5,
  });
  c._wWorld = W;
  c._hWorld = H;
  return c;
}

// ---- BLOOD SPLAT (non-fatal hits, melee) -----------------------------------
function decBakeSplat(seed) {
  const W = 24, H = 20;
  const rng = decRng(seed);
  const [c, g] = decStampCanvas(W, H);
  decSetRot(0);
  decBloodPool(g, rng, 0, 0, decR(rng, 2.0, 3.4), decR(rng, 1.4, 2.4), 0.8);
  c._wWorld = W;
  c._hWorld = H;
  return c;
}

// ---- TRAMPLE / WEAR BLOBS --------------------------------------------------
// Painted in TRAMPLE space (WORLD/4), so 1 canvas px = 4 world px.
function decBakeWearBlob(seed, sizeWorld) {
  const rng = decRng(seed);
  // Lobes reach sizeWorld*(0.45+0.7) from centre, so the canvas must be at
  // least 2.3*sizeWorld across plus slack. The old fixed S=32 clipped every
  // blob above size 13 into a hard-edged square — visible as rectangular mud
  // patches wherever deaths clustered.
  const S = Math.max(24, Math.ceil(sizeWorld * 2.6) + 2);
  const [c, g] = decCanvas(S, S);
  const cx = S / 2, cy = S / 2;
  const lobes = 4 + ((rng() * 4) | 0);
  for (let i = 0; i < lobes; i++) {
    const a = rng() * DEC_TAU, d = Math.pow(rng(), 0.6) * sizeWorld * 0.45;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
    const r = decR(rng, sizeWorld * 0.35, sizeWorld * 0.7);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    // Warm top / cool bottom, so the layer still reads lit when it is blitted
    // under everything else.
    grd.addColorStop(0, 'rgba(48,38,24,1)');
    grd.addColorStop(0.55, 'rgba(42,36,28,0.45)');
    grd.addColorStop(1, 'rgba(42,36,28,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, y, r, r * 0.72, 0, 0, DEC_TAU); g.fill();
  }
  return c;
}

// ============================================================================
//  BATTLE-START BAKE
// ============================================================================

function decNationOf(key) {
  return (typeof NATIONS !== 'undefined' && NATIONS[key]) ? NATIONS[key] : null;
}

function decKitFor(nationKey, type) {
  const nat = decNationOf(nationKey);
  const coat = nat ? nat.coat : '#b33a38';
  const trim = nat ? nat.trim : '#f0e7d0';
  const skin = nat ? nat.skin : '#e0ad82';
  if (type === 'villager') {
    // A villager's silhouette must not read as a soldier's: drab smock, soft
    // cap instead of a tricorn mass, a tool instead of a musket.
    return {
      coat: decMix(coat, '#7A6647', 0.62),
      trim: decMix(trim, '#8B7B5C', 0.5),
      skin: skin, breech: '#8C7C5E', hat: 'cap', weapon: 'tool',
    };
  }
  if (type === 'pike') {
    return { coat: coat, trim: trim, skin: skin, breech: '#A79A7C', hat: 'helmet', weapon: 'pike' };
  }
  if (type === 'cav') {
    return { coat: coat, trim: trim, skin: skin, breech: '#B7AC8E', hat: 'tricorn', weapon: 'sabre' };
  }
  return { coat: coat, trim: trim, skin: skin, breech: '#B7AC8E', hat: 'tricorn', weapon: 'musk' };
}

const DEC_CORPSE_TYPES = ['musk', 'pike', 'villager', 'cav'];
const DEC_VARIANTS = 3;    // headings per pose; 12 baked headings per inf type

// Call ONCE per battle from startBattle(), after decalCanvas exists.
function buildDecalStamps(world) {
  const nations = [
    world && world.sides ? world.sides[0].nation : 'england',
    world && world.sides ? world.sides[1].nation : 'ottoman',
  ];

  const corpse = [{}, {}];
  const wreck = [[], []];
  let seed = 0x1a2b3c4d;
  const nextSeed = function () {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };

  for (let side = 0; side < 2; side++) {
    for (let t = 0; t < DEC_CORPSE_TYPES.length; t++) {
      const type = DEC_CORPSE_TYPES[t];
      const kit = decKitFor(nations[side], type);
      const poses = type === 'cav' ? 3 : 4;
      const total = poses * DEC_VARIANTS;
      const list = [];
      let k = 0;
      for (let p = 0; p < poses; p++) {
        for (let v = 0; v < DEC_VARIANTS; v++) {
          // Spread baked headings evenly around the circle so a corpse field
          // never reads as a repeated stamp pointing one way.
          const s = nextSeed();
          const heading = (k / total) * DEC_TAU + (((s >>> 8) & 255) / 255 - 0.5) * (DEC_TAU / total) * 0.8;
          list.push(decBakeCorpse(kit, type, p, heading, s));
          k++;
        }
      }
      corpse[side][type] = list;
    }
    const gunKit = decKitFor(nations[side], 'gun');
    for (let v = 0; v < 4; v++) {
      const s = nextSeed();
      wreck[side].push(decBakeWreck(gunKit, (v / 4) * DEC_TAU + decR(decRng(s), -0.3, 0.3), s));
    }
  }

  const crater = [];
  for (let v = 0; v < 5; v++) crater.push(decBakeCrater(nextSeed()));
  const rubble = [];
  for (let v = 0; v < 9; v++) rubble.push(decBakeRubbleChunk(0x77000 + v));
  const splat = [];
  for (let v = 0; v < 6; v++) splat.push(decBakeSplat(nextSeed()));
  const wear = [
    decBakeWearBlob(11, 4), decBakeWearBlob(23, 5),
    decBakeWearBlob(37, 7), decBakeWearBlob(53, 9),
  ];
  // Trample space is WORLD/4, so these radii are in units of 4 world px. The
  // previous 13/16 produced death scuffs ~130 world px across — after a few
  // hundred casualties that blankets the board in mud instead of tracing where
  // the fighting was. 8/10 gives a ~35-45 world px scuff, close to the spec's
  // 14x14 trample-space stamp.
  const wearBig = [decBakeWearBlob(71, 8), decBakeWearBlob(89, 10)];

  const n0 = decNationOf(nations[0]), n1 = decNationOf(nations[1]);
  decStamps = {
    nations: nations,
    rawCoats: [n0 ? n0.coat : '#b33a38', n1 ? n1.coat : '#2f7768'],
    corpse: corpse, wreck: wreck, crater: crater,
    rubble: rubble, splat: splat, wear: wear, wearBig: wearBig,
  };

  decInitTrample();
  return decStamps;
}

function decEnsureStamps() {
  if (!decStamps) buildDecalStamps(null);
  return decStamps;
}

// ============================================================================
//  TRAMPLE / WEAR LAYER
//  A WORLD/4 canvas accumulating where the armies actually walked and where
//  men actually died. Blitted UNDER the decal canvas each frame — ONE
//  drawImage, cost independent of army size. Over a five-minute battle this
//  produces emergent mud tracks along the paths the lines actually took.
// ============================================================================

let trampleCanvas = null;
let trampleCtx = null;
const DEC_TRAMPLE_DIV = 4;

function decInitTrample() {
  const w = Math.ceil(WORLD.w / DEC_TRAMPLE_DIV);
  const h = Math.ceil(WORLD.h / DEC_TRAMPLE_DIV);
  if (!trampleCanvas) trampleCanvas = document.createElement('canvas');
  trampleCanvas.width = w;
  trampleCanvas.height = h;
  trampleCtx = trampleCanvas.getContext('2d');
  trampleCtx.imageSmoothingQuality = 'high';
}

// weight: 0 = footfall, 1 = death / wreck, 2 = shell scorch.
function stampTrample(x, y, weight, alpha) {
  if (!trampleCtx) return;
  const S = decEnsureStamps();
  const set = weight >= 1 ? S.wearBig : S.wear;
  const img = set[(((x * 7 + y * 13) | 0) % set.length + set.length) % set.length];
  trampleCtx.globalAlpha = alpha === undefined ? (weight >= 1 ? 0.16 : 0.055) : alpha;
  trampleCtx.drawImage(img, x / DEC_TRAMPLE_DIV - img.width / 2, y / DEC_TRAMPLE_DIV - img.height / 2);
  trampleCtx.globalAlpha = 1;
}

// Drain whatever the sim queued this tick. Supports either a packed
// Float32Array ring (preferred — zero allocation) or a plain array of records.
function drainTrample(world) {
  if (!trampleCtx || !world) return;
  const n = world.trampleN | 0;
  const buf = world.trampleBuf;
  if (buf && n > 0) {
    for (let i = 0; i < n; i += 3) stampTrample(buf[i], buf[i + 1], buf[i + 2]);
    world.trampleN = 0;
  }
  const list = world.pendingTrample;
  if (list && list.length) {
    for (let i = 0; i < list.length; i++) stampTrample(list[i].x, list[i].y, list[i].w || 0);
    list.length = 0;
  }
}

// Never returns null: the documented integration is a bare
// ctx.drawImage(getTrampleCanvas(), ...) in draw(), and drawImage(null) throws
// a TypeError that would kill the frame — so a caller that runs before
// buildDecalStamps must still get a valid (empty) surface.
function getTrampleCanvas() {
  if (!trampleCanvas) decInitTrample();
  return trampleCanvas;
}

// ============================================================================
//  paintDecal — the ONLY entry point render.js calls per decal.
//  Cost: 1-2 drawImage + one save/restore + one trample stamp. Strictly
//  cheaper than the path building it replaces.
// ============================================================================

function decSideOf(d) {
  if (d.side === 0 || d.side === 1) return d.side;
  const S = decEnsureStamps();
  if (d.coat && S.rawCoats) {
    if (d.coat === S.rawCoats[1]) return 1;
    if (d.coat === S.rawCoats[0]) return 0;
  }
  return 0;
}

// Deterministic per-decal seed. sim.js SHOULD supply d.seed; if it does not we
// hash the position, so a reload reproduces the same battlefield.
function decSeedOf(d) {
  if (d.seed !== undefined) return d.seed >>> 0;
  return ((Math.imul(d.x | 0, 73856093) ^ Math.imul(d.y | 0, 19349663)) ^ 0x5bf03635) >>> 0;
}

function decBlitStamp(g, stamp, x, y, ang, scale) {
  const s = scale || 1;
  const w = stamp._wWorld * s, h = stamp._hWorld * s;
  g.save();
  g.translate(x, y);
  if (ang) g.rotate(ang);
  g.drawImage(stamp, -w / 2, -h / 2, w, h);
  g.restore();
}

function paintDecal(d) {
  const g = decalCtx;
  if (!g) return;
  const S = decEnsureStamps();
  const seed = decSeedOf(d);
  const rng = decRng(seed);

  if (d.kind === 'crater') {
    // No free rotation: the lit inner wall would swing away from the sun.
    // Variety comes from 5 distinct ejecta patterns plus scale.
    decBlitStamp(g, S.crater[seed % S.crater.length], d.x, d.y,
      decR(rng, -0.12, 0.12), decR(rng, 0.85, 1.25));
    stampTrample(d.x, d.y, 2, 0.22);
    return;
  }

  if (d.kind === 'ruin') { decPaintRuin(g, d, rng); return; }

  if (d.kind === 'wreck') {
    const list = S.wreck[decSideOf(d)];
    // Heading is baked into each of the 4 variants; only jitter here.
    decBlitStamp(g, list[seed % list.length], d.x, d.y, decR(rng, -0.14, 0.14), 1);
    stampTrample(d.x, d.y, 1, 0.20);
    return;
  }

  if (d.kind === 'blood' || d.kind === 'splat') {
    decBlitStamp(g, S.splat[seed % S.splat.length], d.x, d.y, rng() * DEC_TAU, decR(rng, 0.7, 1.3));
    return;
  }

  // ---- corpse -------------------------------------------------------------
  const type = (d.type === 'musk' || d.type === 'pike' || d.type === 'cav' || d.type === 'villager')
    ? d.type : 'musk';
  const list = S.corpse[decSideOf(d)][type];
  // 12 baked headings for infantry, 9 for cavalry, each already lit correctly.
  // Only a few degrees of jitter on top, which the near-flat art tolerates.
  decBlitStamp(g, list[seed % list.length], d.x, d.y, decR(rng, -0.14, 0.14), 1);
  stampTrample(d.x, d.y, 1, type === 'cav' ? 0.22 : 0.13);
}

// ---- RUINS -----------------------------------------------------------------
// kill() already pushes a 'ruin' decal for every destroyed building, so this is
// real content that currently renders as 14 flat grey squares. Composed live
// (ruins are rare) from pre-baked rubble chunks, scaled to the footprint.
function decPaintRuin(g, d, rng) {
  const S = decEnsureStamps();
  const bt = (typeof BUILDING_TYPES !== 'undefined' && BUILDING_TYPES[d.type]) || null;
  const w = d.w || (bt ? bt.w : 80);
  const h = d.h || (bt ? bt.h : 64);
  const rx = w * 0.60, ry = h * 0.52;

  decSetRot(0);
  g.save();
  g.translate(d.x, d.y);

  // 1. Charred, irregular fire scar.
  for (let i = 0; i < 14; i++) {
    const a = rng() * DEC_TAU, dd = Math.pow(rng(), 0.55);
    const x = Math.cos(a) * rx * dd, y = Math.sin(a) * ry * dd + h * 0.06;
    const r = decR(rng, rx * 0.26, rx * 0.55);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, decRgba('#1E1811', 0.58));
    grd.addColorStop(0.55, decRgba('#2A2117', 0.32));
    grd.addColorStop(1, decRgba('#2A2117', 0));
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(x, y, r, r * 0.7, 0, 0, DEC_TAU); g.fill();
  }

  // 2. Surviving wall stubs with ragged broken top courses.
  const stone = decRamp('#9C8B73');
  const stubs = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < stubs; i++) {
    const a = (i / stubs) * DEC_TAU + decR(rng, -0.4, 0.4);
    const x = Math.cos(a) * rx * decR(rng, 0.55, 0.85);
    const y = Math.sin(a) * ry * decR(rng, 0.55, 0.85);
    const sw = decR(rng, w * 0.10, w * 0.22);
    const sh = decR(rng, h * 0.08, h * 0.18);
    g.fillStyle = 'rgba(' + DEC_SUN.shadowRGB + ',0.40)';
    g.beginPath();
    g.ellipse(x + DEC_SUN.sx * sh * 0.8, y + DEC_SUN.sy * sh * 0.8, sw * 0.7, sh * 0.5, 0, 0, DEC_TAU);
    g.fill();
    decPanel(g, x, y, sw, sh, decR(rng, -0.25, 0.25), stone, 0.7);
    g.fillStyle = stone.shade;
    for (let k = 0; k < 4; k++) {
      g.fillRect(x - sw / 2 + k * sw / 4 + decR(rng, 0, sw * 0.1), y - sh / 2,
        sw * decR(rng, 0.08, 0.18), sh * decR(rng, 0.15, 0.4));
    }
  }

  // 3. Fallen roof timbers, criss-crossed, charred, each casting its shadow.
  const charred = decRamp('#3A2C1E');
  const beams = 5 + ((rng() * 4) | 0);
  for (let i = 0; i < beams; i++) {
    const a = rng() * Math.PI;
    const len = decR(rng, w * 0.35, w * 0.75);
    const cx = decR(rng, -rx * 0.55, rx * 0.55);
    const cy = decR(rng, -ry * 0.5, ry * 0.6) + h * 0.05;
    const x1 = cx - Math.cos(a) * len / 2, y1 = cy - Math.sin(a) * len / 2 * 0.7;
    const x2 = cx + Math.cos(a) * len / 2, y2 = cy + Math.sin(a) * len / 2 * 0.7;
    g.strokeStyle = 'rgba(' + DEC_SUN.shadowRGB + ',0.34)';
    g.lineWidth = decR(rng, 3.4, 5.6);
    g.beginPath();
    g.moveTo(x1 + DEC_SUN.sx * 2, y1 + DEC_SUN.sy * 2);
    g.lineTo(x2 + DEC_SUN.sx * 2, y2 + DEC_SUN.sy * 2);
    g.stroke();
    decLimb(g, x1, y1, x2, y2, decR(rng, 3.0, 5.0), charred, 0.55);
    g.strokeStyle = decRgba(DEC_PAL.SOOT, 0.4);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x1 + DEC_SUN.sx * 0.8, y1 + DEC_SUN.sy * 0.8);
    g.lineTo(x2 + DEC_SUN.sx * 0.8, y2 + DEC_SUN.sy * 0.8);
    g.stroke();
  }

  // 4. Rubble field. NOT mirrored — a horizontal flip would light the chunk
  //    from up-RIGHT and break the one-sun rule for the sake of variety we do
  //    not need (9 distinct chunk shapes plus scale and small rotation).
  const chunks = 42 + ((rng() * 30) | 0);
  for (let i = 0; i < chunks; i++) {
    const a = rng() * DEC_TAU, dd = Math.pow(rng(), 0.5);
    const x = Math.cos(a) * rx * dd * 1.05;
    const y = Math.sin(a) * ry * dd * 1.05 + h * 0.05;
    const st = S.rubble[(rng() * S.rubble.length) | 0];
    const sc = decR(rng, 0.35, 1.05);
    g.save();
    g.translate(x, y);
    g.rotate(decR(rng, -0.4, 0.4));
    g.drawImage(st, -st._wWorld * sc / 2, -st._hWorld * sc / 2, st._wWorld * sc, st._hWorld * sc);
    g.restore();
  }

  // 5. Ash drift and settled dust.
  for (let i = 0; i < 28; i++) {
    const a = rng() * DEC_TAU, dd = Math.pow(rng(), 0.4);
    const x = Math.cos(a) * rx * dd * 1.2, y = Math.sin(a) * ry * dd * 1.2 + h * 0.05;
    const r = decR(rng, 2, 7);
    g.fillStyle = decRgba(DEC_PAL.ASH, decR(rng, 0.05, 0.16));
    g.beginPath(); g.ellipse(x, y, r, r * 0.6, 0, 0, DEC_TAU); g.fill();
  }

  // 6. Scorch tongues escaping the footprint.
  for (let i = 0; i < 8; i++) {
    const a = rng() * DEC_TAU;
    const len = decR(rng, rx * 1.0, rx * 1.6);
    const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len * 0.7);
    grd.addColorStop(0, decRgba(DEC_PAL.SOOT, 0.26));
    grd.addColorStop(1, decRgba(DEC_PAL.SOOT, 0));
    g.strokeStyle = grd;
    g.lineWidth = decR(rng, 3, 9);
    g.beginPath();
    g.moveTo(Math.cos(a) * rx * 0.5, Math.sin(a) * ry * 0.5);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.7);
    g.stroke();
  }

  g.restore();

  // 7. Wear the ground under and around the ruin.
  stampTrample(d.x, d.y, 1, 0.30);
  stampTrample(d.x - w * 0.25, d.y + h * 0.15, 1, 0.22);
  stampTrample(d.x + w * 0.25, d.y - h * 0.10, 1, 0.22);
}

// drainTrample is exported deliberately: the integration notes instruct render.js
// to call it every frame, and the shipped export list omitted it — the wear
// layer would have accumulated deaths only and never a single footfall.
export {
  setDecalCtx, buildDecalStamps, paintDecal,
  stampTrample, drainTrample, getTrampleCanvas,
};
