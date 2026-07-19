// Cavalry and cannon sprite painters (Kriegsspiel Table).
// Frame boxes, from the bounds audit: cav 33x29 anchor (16.5,23.4),
// gun 41x29 anchor (20.5,23.4). Anchor is exactly w/2 so the mirrored
// facing shares it.
// =============================================================================
//  MOUNTED SUBSYSTEM  —  drawCavalry() / drawCannon()
//  "Kriegsspiel Table — painted miniatures under a gallery spotlight"
//
//  Everything in this file runs ONCE, at battle start, inside buildNationSprites().
//  Per-frame cost is unchanged: one drawImage per unit. So we are lavish here.
//
//  Splice into js/render.js, replacing the existing drawCavalry / drawCannon.
//  No imports / exports — this is a fragment. It references the render.js
//  module-level const SCALE when present and otherwise falls back to 4.
// =============================================================================


// -----------------------------------------------------------------------------
//  0.  LIGHTING MODEL  —  one sun for the whole game.
// -----------------------------------------------------------------------------

const MOUNT_SUN = {
  x: -0.64, y: -0.77,             // unit vector TOWARD the light (up and left)
  elevDeg: 38,
  shadow: { x: 0.64, y: 0.77 },   // direction cast shadows fall
  lenMul: 0.55,
  squash: 0.42,
  key: '#FFF1CE',                 // warm gallery photoflood
  fill: '#8FA4C4',                // cool room bounce
  bounce: '#B9A277',              // warm kick off the board into undersides
  shadowRGB: '26,30,48',          // cool violet — never pure black
};

// Faction colour. Baked in, never ambiguous, never occluded.
const MOUNT_SIDE_RIM = ['#3E78B8', '#B8483E'];
const MOUNT_SIDE_LIT = ['#6FA3DC', '#DC7A6F'];

// Ground contact line inside both sprite boxes (sprite units, y down).
const MOUNT_GY = 23.4;

// FRAME ORIGIN OFFSET.
// The part geometry below was authored against a 30-wide (cav) / 40-wide (gun)
// box. A bounds audit (gfx/mounted_bounds_check.js, which tracks the full affine
// transform stack and maps every drawn coordinate to device pixels) showed the
// artwork reaching x=30.19 on the cavalry and x=39.54 on the gun — i.e. PAST the
// right edge — and leaving no room at all for the 8-way lining dilation, which
// spills up to 1px in every direction plus a second blit at shadow*2 = (1.28,
// 1.54)px. That is exactly the defect the art bible flags on the idle pike,
// whose tip is drawn outside its frame and is silently clipped on every unit in
// the game.
//
// Rather than re-authoring 2,000 lines of coordinates, the boxes are widened and
// the whole figure is nudged by these offsets at painter entry. The anchor moves
// with it, so ax stays exactly w/2 and the mirrored copy still shares an anchor.
//   cav  w 33  h 29  ax 16.5  ay 23.4   (was w30 h28 ax15)
//   gun  w 41  h 29  ax 20.5  ay 23.4   (was w40 h28 ax20)
const MOUNT_CAV_OX = 1.5;   // 15 -> 16.5, the new w/2
const MOUNT_GUN_OX = 0.5;   // 20 -> 20.5, the new w/2

// Sprite oversampling. render.js declares `const SCALE`; fall back for safety.
function mScale() {
  try { return (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 4; }
  catch (e) { return 4; }
}


// -----------------------------------------------------------------------------
//  1.  COLOUR RAMP HELPERS
//      Programmatic acrylic layering: every material expands from one basecoat
//      into deep / shade / mid / base / lit / edge / line. Works for any nation
//      colour, present or future, because nothing is hand-tabulated.
// -----------------------------------------------------------------------------

function mClamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

function mParseHex(h) {
  if (typeof h !== 'string') return [128, 128, 128];
  let s = h.trim().replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mToHex(rgb) {
  const r = Math.round(mClamp255(rgb[0]));
  const g = Math.round(mClamp255(rgb[1]));
  const b = Math.round(mClamp255(rgb[2]));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function mMixRGB(a, b, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Mix two css hex colours, return hex.
function mMix(a, b, t) { return mToHex(mMixRGB(mParseHex(a), mParseHex(b), t)); }

// Rec.709 weighted value on a 0..255 scale (rough, for ordering only).
function mLum(rgb) { return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]; }

// WCAG relative luminance — the correct basis for a contrast guarantee.
function mSrgbLin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function mRelLum(rgb) {
  return 0.2126 * mSrgbLin(rgb[0]) + 0.7152 * mSrgbLin(rgb[1]) + 0.0722 * mSrgbLin(rgb[2]);
}

// PALETTE LAW, enforced rather than described.
// The lining must clear a stated contrast against mid-ground turf for ANY coat
// a nation might be given.
//
// TURF_MID #77804A has WCAG relative luminance 0.1986 (NOT 0.205 — that figure
// was carried through the spec unchecked and is what made this constant wrong).
// Solving (0.1986 + 0.05) / (L + 0.05) >= 4.0 gives L <= 0.01216.
// The previous 0.014 was above that, so England (4.05:1) passed while Ottoman
// (3.97:1) and a white coat (3.90:1) quietly missed the guarantee this constant
// exists to provide.
//
// Ceiling check: pure black against this turf is (0.2486 / 0.05) = 4.97:1, so
// 4.0:1 is reachable for every coat and any spec demanding 5.2:1 is not.
const MOUNT_LINE_MAX_RELLUM = 0.0121;

/**
 * Force a lining colour down until it clears the palette law.
 * Scaling is multiplicative, so channel ratios — and therefore the material
 * tint that keeps the outline reading as painted rather than as vector black —
 * are preserved. Iterated AFTER 8-bit quantisation, because the colour we
 * actually paint is the rounded one, not the float.
 */
function mClampLine(rgb) {
  let v = [rgb[0], rgb[1], rgb[2]];
  for (let i = 0; i < 16; i++) {
    const q = [Math.round(mClamp255(v[0])), Math.round(mClamp255(v[1])), Math.round(mClamp255(v[2]))];
    if (mRelLum(q) <= MOUNT_LINE_MAX_RELLUM) return q;
    v = [v[0] * 0.82, v[1] * 0.82, v[2] * 0.82];
  }
  return [0, 0, 0];
}

function mRGBA(rgb, a) {
  return 'rgba(' + Math.round(mClamp255(rgb[0])) + ',' + Math.round(mClamp255(rgb[1]))
    + ',' + Math.round(mClamp255(rgb[2])) + ',' + a + ')';
}

// Alpha-ise a hex colour.
function mA(hex, a) { return mRGBA(mParseHex(hex), a); }

/**
 * The acrylic ramp. Basecoat in, five painted values out.
 *   shade  — recess wash, cool and hue-shifted toward blue
 *   base   — the basecoat itself
 *   lit    — drybrush on the sun-facing planes, warm
 *   edge   — extreme edge highlight, up-left boundary only
 *   line   — material-tinted lining, luminance FORCE-CLAMPED so that even a
 *            near-black coat still yields an outline that separates from its
 *            own fill. This is the guarantee that keeps future nations legible.
 */
function mRamp(hex) {
  const b = mParseHex(hex);

  // ADAPTIVE RAMP. A fixed set of mix fractions silently fails at both ends of
  // the value scale: a bone-white coat has nowhere left to highlight (mixing
  // #DFD5BC toward warm white moves almost nothing), and a near-black coat has
  // nowhere left to shade. So the ramp leans the way the basecoat allows —
  // which is also what a miniature painter does by hand: you highlight a dark
  // model and you shade a light one.
  const bl = mRelLum(b);                       // 0 (black) .. 1 (white)
  const litT = 0.06 + 0.30 * (1 - 0.62 * bl);
  const edgeT = 0.10 + 0.62 * (1 - 0.55 * bl);
  const shadeT = 0.42 + 0.30 * bl;
  const deepT = 0.66 + 0.22 * bl;

  const deep = mMixRGB(b, [0x1B, 0x20, 0x33], deepT);
  const shade = mMixRGB(b, [0x1B, 0x20, 0x33], shadeT);
  const mid = mMixRGB(b, shade, 0.42);
  const lit = mMixRGB(b, [0xFF, 0xE9, 0xBC], litT);
  const edge = mMixRGB(b, [0xFF, 0xF6, 0xDE], edgeT);
  const line = mClampLine(mMixRGB(b, [0x14, 0x10, 0x0C], 0.78));
  // Warm light bouncing off the board into the underside of every form.
  const bounce = mMixRGB(shade, mParseHex(MOUNT_SUN.bounce), 0.30);
  return {
    hex: mToHex(b), rgb: b,
    deep: mToHex(deep), shade: mToHex(shade), mid: mToHex(mid),
    base: mToHex(b), lit: mToHex(lit), edge: mToHex(edge),
    line: mToHex(line), bounce: mToHex(bounce),
  };
}

// Push a whole ramp toward atmospheric shadow — used for far-side limbs and
// far-side crew so the figure reads with depth instead of as a flat cut-out.
function mFar(R, t) {
  const target = '#39405A';
  return {
    hex: R.hex, rgb: R.rgb,
    deep: mMix(R.deep, target, t), shade: mMix(R.shade, target, t),
    mid: mMix(R.mid, target, t), base: mMix(R.base, target, t),
    lit: mMix(R.lit, target, t * 0.8), edge: mMix(R.edge, target, t * 0.8),
    line: R.line, bounce: mMix(R.bounce, target, t),
  };
}

// Deterministic PRNG (mulberry32) so decorative detail is identical between
// poses. A mane that reshuffles every walk frame is a strobing artefact.
function mRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mHashStr(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}


// -----------------------------------------------------------------------------
//  2.  GEOMETRY / SHADING PRIMITIVES
// -----------------------------------------------------------------------------

const MOUNT_TAU = Math.PI * 2;

// Sun handedness. Painters that draw inside a ctx.scale(-1,1) (the mirrored gun
// crewman) must invert the sun's X component, otherwise every gradient, spec
// streak and edge light they bake lands on the down-RIGHT side and that figure
// is lit from the opposite direction to the rest of the game. Set to -1 for the
// duration of a mirrored sub-painter and back to 1 afterwards.
let MOUNT_FLIP = 1;
function mSunX() { return MOUNT_SUN.x * MOUNT_FLIP; }

// NOTE: there is deliberately no mSnap() helper here. One used to exist, with a
// comment claiming it was applied to "structural straight edges (carriage,
// barrel bands)". It had zero call sites. The art bible's SPRITE SPEC rule that
// every painter coordinate be snapped to 0.25 sprite units is genuinely NOT
// implemented in this file — see the review notes. Rather than leave a dead
// helper implying otherwise, the gap is stated plainly.

// Quadratic-through-midpoints: an organic curve from a point list.
function mCurve(g, pts, move) {
  if (!pts.length) return;
  if (move !== false) g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
    const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last[0], last[1]);
}

function mPoly(g, pts, close) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close !== false) g.closePath();
}

/**
 * A tapered organic limb: build offset polygons either side of a spine and
 * curve through them. This is how legs, tails, manes and coat tails get real
 * volume instead of a constant-width round-capped stroke.
 */
function mLimbPath(g, pts, widths) {
  const n = pts.length;
  const L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const w = widths[i];
    L.push([p[0] - dy * w, p[1] + dx * w]);
    Rr.push([p[0] + dy * w, p[1] - dx * w]);
  }
  g.beginPath();
  mCurve(g, L);
  const rev = Rr.slice().reverse();
  g.lineTo(rev[0][0], rev[0][1]);
  mCurve(g, rev, false);
  g.closePath();
}

function mLimb(g, pts, widths, style) {
  mLimbPath(g, pts, widths);
  g.fillStyle = style;
  g.fill();
}

/**
 * Linear gradient across a cylinder axis: terminator, core shadow, and a
 * warm bounce lip on the far rim. The single most valuable shading primitive
 * here — it is what makes a cannon barrel read as turned bronze and a horse
 * leg read as bone-and-muscle rather than a coloured stick.
 */
function mCylGrad(g, x0, y0, x1, y1, halfW, R, specHex) {
  let dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  let nx = -dy, ny = dx;
  if (nx * mSunX() + ny * MOUNT_SUN.y < 0) { nx = -nx; ny = -ny; }
  const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
  const grd = g.createLinearGradient(
    cx + nx * halfW, cy + ny * halfW, cx - nx * halfW, cy - ny * halfW);
  grd.addColorStop(0.00, R.lit);
  grd.addColorStop(0.13, specHex || R.edge);
  grd.addColorStop(0.32, R.lit);
  grd.addColorStop(0.55, R.base);
  grd.addColorStop(0.80, R.shade);
  grd.addColorStop(0.95, R.deep);
  grd.addColorStop(1.00, R.bounce);
  return grd;
}

/** Broad form gradient across a mass, sun-aligned. */
function mFormGrad(g, cx, cy, r, R) {
  const grd = g.createLinearGradient(
    cx + mSunX() * r, cy + MOUNT_SUN.y * r,
    cx - mSunX() * r, cy - MOUNT_SUN.y * r);
  grd.addColorStop(0.00, R.edge);
  grd.addColorStop(0.14, R.lit);
  grd.addColorStop(0.42, R.base);
  grd.addColorStop(0.70, R.base);
  grd.addColorStop(0.90, R.shade);
  grd.addColorStop(1.00, R.deep);
  return grd;
}

/** Soft radial bloom used for muscle-mass drybrushing. */
function mBlobGrad(g, cx, cy, r, hex, a0, a1) {
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  const rgb = mParseHex(hex);
  grd.addColorStop(0, mRGBA(rgb, a0));
  grd.addColorStop(0.55, mRGBA(rgb, a0 * 0.45 + a1 * 0.55));
  grd.addColorStop(1, mRGBA(rgb, a1));
  return grd;
}

/** Drybrush a lit muscle mass inside the current clip. */
function mMuscle(g, cx, cy, rx, ry, rot, hex, alpha) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(1, ry / rx);
  g.fillStyle = mBlobGrad(g, 0, 0, rx, hex, alpha, 0);
  g.beginPath(); g.arc(0, 0, rx, 0, MOUNT_TAU); g.fill();
  g.restore();
}

/**
 * Single-sided edge light. Stroked only along the up-left boundary of a form —
 * a two-sided highlight reads as an outline, a one-sided one reads as lit.
 */
function mEdgeLight(g, pts, hex, w, alpha) {
  g.save();
  g.globalAlpha = alpha === undefined ? 0.9 : alpha;
  g.strokeStyle = hex;
  g.lineWidth = w;
  g.beginPath();
  mCurve(g, pts);
  g.stroke();
  g.restore();
}

/** Cool ambient-occlusion crease where two forms meet. */
function mCrease(g, pts, w, alpha) {
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = alpha === undefined ? 0.5 : alpha;
  g.strokeStyle = 'rgb(' + MOUNT_SUN.shadowRGB + ')';
  g.lineWidth = w;
  g.beginPath();
  mCurve(g, pts);
  g.stroke();
  g.restore();
}


// -----------------------------------------------------------------------------
//  3.  WHOLE-FIGURE PASSES
//      Run once at the end of each painter, after every part is down. These are
//      what make a stack of shapes read as one physical painted object.
// -----------------------------------------------------------------------------

const MOUNT_OFF8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function mSilhouette(c, hex) {
  const s = document.createElement('canvas');
  s.width = c.width; s.height = c.height;
  const sg = s.getContext('2d');
  // Two passes firm up antialiased edges so the lining is solid, not ghosted.
  sg.drawImage(c, 0, 0);
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = hex;
  sg.fillRect(0, 0, s.width, s.height);
  return s;
}

function mSupportsFilter(g) {
  try { const p = g.filter; g.filter = 'blur(1px)'; const ok = g.filter !== 'none'; g.filter = 'none'; return ok && p !== undefined; }
  catch (e) { return false; }
}

/**
 * Gallery light + shade wash + matte varnish + black lining.
 * Everything here is device-pixel work, so we drop the sprite-unit transform.
 * Must be called BEFORE any translucent overlay (muzzle blast, motion streak)
 * so those do not acquire a black outline.
 */
function mFinishFigure(g, opts) {
  const o = opts || {};
  const c = g.canvas;
  const W = c.width, H = c.height;
  const S = mScale();

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;

  // --- A. UNIFYING GALLERY LIGHT ------------------------------------------
  // source-atop clips to painted pixels, so one gradient shades horse, rider,
  // tack, hat and weapon consistently — a single lit object, not a collage.
  //
  // The gradient axis is the SUN SHADOW VECTOR, not the frame diagonal. It has
  // to be: infantry.js:passGalleryLight and villager.js both run
  // createLinearGradient(0, 0, L*SUN.shadow.x, L*SUN.shadow.y), and a
  // box-aspect-derived axis (the old W*0.55, H) pointed a different way in the
  // cav frame (0.53, 0.85) than in the gun frame (0.61, 0.79) than in an
  // infantry frame (0.64, 0.77). Three units standing in the same rank, each
  // lit from a slightly different angle, and a fourth angle appearing the
  // moment anyone changes a frame width. That is exactly the failure the art
  // bible names as the worst possible outcome.
  const L = W * Math.abs(MOUNT_SUN.shadow.x) + H * Math.abs(MOUNT_SUN.shadow.y);
  g.globalCompositeOperation = 'source-atop';
  const lg = g.createLinearGradient(0, 0, L * MOUNT_SUN.shadow.x, L * MOUNT_SUN.shadow.y);
  lg.addColorStop(0.00, 'rgba(255,236,190,0.26)');
  lg.addColorStop(0.42, 'rgba(255,236,190,0)');
  lg.addColorStop(0.62, 'rgba(24,20,42,0)');
  lg.addColorStop(1.00, 'rgba(24,20,42,0.34)');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  // --- B. RECESS WASH ------------------------------------------------------
  // BLUR THE FRAME, NOT THE SILHOUETTE. Multiplying a blurred SOLID silhouette
  // back over the figure is a no-op in the interior — the blur of a solid
  // region is still solid, so every pixel more than a blur radius from the
  // outline receives the SAME multiplier. Measured, a solid #141118 at alpha
  // 0.18 is a flat 0.832x on every interior pixel: no crevice pooling at all,
  // and a uniform ~17% darkening that made every horse and every gun read
  // muddier than the infantry beside them, on top of the gallery gradient's
  // own 0.34 darkening in the lower right.
  //
  // Blurring the frame's own COLOUR instead makes the multiplier a function of
  // each pixel's neighbourhood: sun-facing planes are multiplied by something
  // near white and barely move, while pixels next to dark neighbours — under
  // the hat brim, between the barrel and the carriage cheek, in the gap
  // between the horse's near and far legs — are multiplied by something dark
  // and pool. This is infantry.js:passRecessWash verbatim, so the two lineages
  // now shade identically.
  if (mSupportsFilter(g)) {
    const wc = document.createElement('canvas');
    wc.width = W; wc.height = H;
    const wg = wc.getContext('2d');
    wg.filter = 'blur(' + (S * 0.42).toFixed(2) + 'px)';
    wg.drawImage(c, 0, 0);
    wg.filter = 'none';
    // Lift toward white so the wash can only pool, never crush.
    wg.globalCompositeOperation = 'source-atop';
    wg.fillStyle = 'rgba(255,252,244,0.42)';
    wg.fillRect(0, 0, W, H);
    // Confine to the figure. Without this the blur halo extends past the
    // silhouette, and multiply-over-transparent degenerates to source-over —
    // the figure would acquire a dark smudge ring that the lining pass then
    // bakes in permanently.
    wg.globalCompositeOperation = 'destination-in';
    wg.drawImage(c, 0, 0);

    g.globalCompositeOperation = 'multiply';
    g.globalAlpha = 0.55;
    g.drawImage(wc, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // --- C. MATTE VARNISH ----------------------------------------------------
  // A flat scattering film. Kills any impression of gloss and pulls every
  // nation's palette into one painted family.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(238,232,214,0.045)';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  // --- D. LINING -----------------------------------------------------------
  // Painted outline dilated beneath the artwork. This is how a sixty-man block
  // stays reading as sixty men. Zero runtime cost.
  //
  // Tint: the MATERIAL-TINTED, luminance-force-clamped lining from the coat
  // ramp, matching infantry.js:passLining(g, S, coat.line). The whole
  // mClampLine / MOUNT_LINE_MAX_RELLUM palette-law apparatus above exists to
  // produce this value; before this it was computed for eighteen materials per
  // nation and then thrown away in favour of a hardcoded '#141118', so mounted
  // units carried a colder, bluer outline than the infantry they rode past.
  const sil = mSilhouette(c, o.tint || '#141118');

  // Width: max(1, round(S*0.60)) device px — infantry's figure, so the two
  // lineages carry the same line weight. At SCALE 4 that is 2 device px
  // (0.5 sprite units); the old fixed 1 px was half the infantry's outline.
  const d = Math.max(1, Math.round(S * 0.60));
  g.globalCompositeOperation = 'destination-over';
  for (let i = 0; i < MOUNT_OFF8.length; i++) {
    g.drawImage(sil, MOUNT_OFF8[i][0] * d, MOUNT_OFF8[i][1] * d);
  }

  // A second, asymmetric ring along the sun-shadow axis: the ambient occlusion
  // that lifts the figure off the ground instead of pasting it on.
  //
  // Offsets are ROUNDED to whole device pixels. The old code offset by
  // shadow*2 = (1.28, 1.54) px, and a fractional-offset drawImage of a
  // hard-edged silhouette resamples it — the AO ring arrived as a soft
  // half-alpha ghost rather than a crisp band.
  //
  // Infantry also runs a third ring at d*3.2 alpha 0.20. It is deliberately
  // NOT ported: the bounds gate measures the tightest margins in these frames
  // at R 0.96 and B 0.99 sprite units (3.84 / 3.96 device px at SCALE 4), and
  // a third ring would land at (4.1, 4.9) px — outside the box on both axes,
  // so it would be sliced off by a hard straight frame edge. Two rings fit
  // with room to spare: worst-case spill is 0.75 units right and bottom,
  // 0.5 units top and left, against margins of 0.96 / 0.99 / 0.54 / 0.80.
  g.globalAlpha = 0.42;
  const d2 = d * 2;
  g.drawImage(sil, Math.round(MOUNT_SUN.shadow.x * d2), Math.round(MOUNT_SUN.shadow.y * d2));
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  g.restore();
}

/**
 * Baked contact shadow. Never a flat-alpha ellipse — always a radial falloff
 * offset down-right along the sun-shadow axis, in cool violet. Painted with
 * destination-over so it lands beneath the figure AND beneath its lining.
 *
 * `side` tints the trodden earth toward the owning army at ~40% chroma: an
 * always-unoccluded block of faction colour at the anchor point that chains
 * across a formation front, but reads as ground rather than as a plastic base.
 */
function mContactShadow(g, cx, cy, rx, ry, strength, side) {
  const a = strength === undefined ? 1 : strength;
  const ox = cx + MOUNT_SUN.shadow.x * (rx * 0.22);
  const oy = cy + MOUNT_SUN.shadow.y * (ry * 0.30);

  g.save();
  g.globalCompositeOperation = 'destination-over';

  // side-tinted contact scuff: trodden earth cooled toward blue or warmed
  // toward red, sitting under the shadow so it never fights the figure.
  if (side === 0 || side === 1) {
    const tint = mMix('#6B5B3C', MOUNT_SIDE_RIM[side], 0.42);
    // 1.5, matching the shadow's own falloff radius. At 1.9 the scuff ran past
    // the frame on both the gun (x 41.9 in a 40u box) and the horse, so it was
    // sliced off by a hard straight edge instead of fading out.
    g.save();
    g.translate(ox, oy);
    g.scale(1, ry / rx);
    g.fillStyle = mBlobGrad(g, 0, 0, rx * 1.5, tint, 0.30 * a, 0);
    g.beginPath(); g.arc(0, 0, rx * 1.5, 0, MOUNT_TAU); g.fill();
    g.restore();
  }

  g.translate(ox, oy);
  g.scale(1, (ry * 1.5) / (rx * 1.5));
  const r = rx * 1.5;
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grd.addColorStop(0.00, 'rgba(' + MOUNT_SUN.shadowRGB + ',' + (0.46 * a).toFixed(3) + ')');
  grd.addColorStop(0.55, 'rgba(' + MOUNT_SUN.shadowRGB + ',' + (0.20 * a).toFixed(3) + ')');
  grd.addColorStop(1.00, 'rgba(' + MOUNT_SUN.shadowRGB + ',0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, r, 0, MOUNT_TAU); g.fill();
  g.restore();
}


// -----------------------------------------------------------------------------
//  4.  MATERIAL SET
// -----------------------------------------------------------------------------

// Four plausible troop-horse coats. Chosen deterministically per nation so a
// nation's cavalry is remounted consistently, never randomly per frame.
const MOUNT_HORSE_COATS = [
  { body: '#5C3B24', points: '#211710', mane: '#241A11' }, // bay
  { body: '#7A4A26', points: '#5A3418', mane: '#8A6238' }, // chestnut
  { body: '#42301F', points: '#1C150F', mane: '#1E1610' }, // dark brown
  { body: '#8B857C', points: '#4A4640', mane: '#B6B1A6' }, // dapple grey
];

function mHeadgear(nat) {
  if (nat && typeof nat.headgear === 'string') return nat.headgear;
  const tag = ((nat && (nat.name || nat.adjective)) || '') + '';
  return /ottoman|turk|janiss/i.test(tag) ? 'turban' : 'tricorn';
}

function mMaterials(nat, side) {
  const key = (nat && (nat.coat || '')) + '|' + (nat && (nat.trim || ''));
  const h = mHashStr(key);
  const horse = MOUNT_HORSE_COATS[h % MOUNT_HORSE_COATS.length];
  // render.js already stitches the reserved side colour onto the nation object
  // as `nat.rim` before calling the painters, so prefer that when no explicit
  // side index was threaded through — otherwise faction colour silently
  // degrades to nation trim and both armies end up wearing the same shabraque.
  const ri = (nat && typeof nat.rim === 'string') ? MOUNT_SIDE_RIM.indexOf(nat.rim) : -1;
  const idx = (side === 0 || side === 1) ? side : ri;
  // Normalised through the parser so a malformed config string can never reach
  // fillStyle directly — every colour this file emits is a valid 6-digit hex.
  const sideHex = mToHex(mParseHex((idx === 0 || idx === 1) ? MOUNT_SIDE_RIM[idx]
    : (nat && nat.rim) || (nat && nat.trim) || '#D0C8A8'));
  const sideLit = (idx === 0 || idx === 1) ? MOUNT_SIDE_LIT[idx] : mMix(sideHex, '#FFFFFF', 0.35);
  return {
    seed: h,
    headgear: mHeadgear(nat),
    coat: mRamp((nat && nat.coat) || '#7A3A33'),
    trim: mRamp((nat && nat.trim) || '#E4D9AE'),
    skin: mRamp((nat && nat.skin) || '#D8A87E'),
    hat: mRamp('#26201A'),
    hair: mRamp('#2E241A'),
    leather: mRamp('#5E4327'),
    strap: mRamp('#3B2C1C'),
    buff: mRamp('#CFC3A4'),            // buff/pipeclayed crossbelts
    steel: mRamp('#8C949F'),
    iron: mRamp('#3F444C'),
    brass: mRamp('#B08A38'),
    bronze: mRamp('#9E7C39'),
    // Carriage paint: national colour cut into a service wood/paint tone, so
    // artillery still reads as belonging to somebody without shouting.
    carriage: mRamp(mMix((nat && nat.coat) || '#7A3A33', '#6E5C3E', 0.58)),
    wood: mRamp('#7A5F3A'),
    hoof: mRamp('#4C4235'),
    horseBody: mRamp(horse.body),
    horsePoints: mRamp(horse.points),
    horseMane: mRamp(horse.mane),
    white: mRamp('#D9D3C4'),
    side: sideHex,
    sideIdx: (idx === 0 || idx === 1) ? idx : -1,
    sideLit: sideLit,
    sideRamp: mRamp(sideHex),
  };
}


// =============================================================================
//  5.  CAVALRY
//
//  Sprite box:  w = 33, h = 29, ax = 16.5, ay = 23.4
//  Ground line at y = 23.4. Withers ~1.6 m, poll ~2.1 m, rider hat top ~2.5 m
//  at 9 sprite units per metre — a horse that properly dwarfs an 18px man.
// =============================================================================

/** Closed silhouette of the horse: chest, barrel, croup, neck arch, head. */
function mHorseBodyPath(g) {
  g.beginPath();
  g.moveTo(6.2, 10.0);
  g.bezierCurveTo(6.9, 8.8, 9.7, 8.3, 12.3, 9.6);     // croup
  g.bezierCurveTo(14.1, 10.5, 15.4, 9.7, 17.3, 9.0);  // back dip → withers
  g.bezierCurveTo(19.9, 8.1, 21.7, 6.9, 23.4, 5.1);   // crest of the neck
  g.bezierCurveTo(24.1, 4.3, 25.1, 4.3, 25.7, 5.2);   // poll
  g.bezierCurveTo(26.5, 6.4, 27.7, 7.4, 28.5, 8.2);   // face
  g.bezierCurveTo(29.1, 8.8, 28.8, 9.7, 28.0, 9.8);   // muzzle
  g.bezierCurveTo(26.6, 10.0, 25.4, 9.7, 24.4, 9.0);  // chin groove
  g.bezierCurveTo(23.4, 8.4, 22.6, 8.6, 22.0, 9.7);   // throatlatch
  g.bezierCurveTo(21.4, 11.1, 21.2, 12.4, 20.9, 13.6);// front of neck → chest
  g.bezierCurveTo(20.7, 14.9, 20.1, 15.9, 19.1, 16.5);// shoulder → elbow
  g.bezierCurveTo(17.1, 17.5, 13.4, 17.6, 10.6, 17.0);// belly
  g.bezierCurveTo(8.6, 16.6, 7.2, 15.4, 6.2, 13.8);   // flank / stifle
  g.bezierCurveTo(5.2, 12.4, 5.3, 11.0, 6.2, 10.0);   // point of buttock
  g.closePath();
}

/**
 * Leg keyframes. Four stances:
 *   0 = standing square
 *   1 = gallop, EXTENDED (fore reaching, hind trailing, body low)
 *   2 = gallop, GATHERED (all four bunched under the barrel, suspension)
 *   3 = attack, a bounding leap with the forehand up
 * Alternating 1/2 reads unmistakably as a gallop because the body also rises,
 * falls and pitches. Legs wiggling under a rigid body never reads as anything.
 */
function mHorseStance(phase) {
  if (phase === 1) {
    return {
      lift: 0.55, pitch: -0.045, riderLift: 0.15, tailBlow: 1,
      foreNear: [[19.3, 13.4], [21.9, 16.3], [24.5, 17.9], [25.7, 19.2]],
      foreFar: [[17.5, 13.7], [19.5, 17.2], [21.3, 19.7], [22.2, 21.2]],
      hindNear: [[9.3, 13.0], [6.7, 16.5], [4.5, 19.7], [3.2, 21.5]],
      hindFar: [[10.8, 13.2], [8.5, 16.7], [6.5, 19.5], [5.3, 20.9]],
      shadow: { dx: 0.6, rx: 8.0, ry: 2.3, a: 0.82 },
    };
  }
  if (phase === 2) {
    return {
      lift: -0.60, pitch: 0.07, riderLift: -0.20, tailBlow: 0.6,
      foreNear: [[19.3, 13.4], [20.7, 16.7], [19.1, 15.1], [17.4, 15.5]],
      foreFar: [[17.5, 13.7], [19.0, 17.2], [17.7, 15.9], [16.2, 16.7]],
      hindNear: [[9.3, 13.0], [8.0, 17.1], [10.6, 19.1], [12.7, 19.8]],
      hindFar: [[10.8, 13.2], [9.5, 17.3], [11.9, 19.3], [13.9, 20.1]],
      shadow: { dx: -0.4, rx: 6.5, ry: 2.0, a: 0.55 },
    };
  }
  if (phase === 3) {
    return {
      lift: -0.15, pitch: -0.155, riderLift: -0.15, tailBlow: 0.85,
      foreNear: [[19.3, 13.4], [21.7, 12.0], [23.5, 12.7], [23.0, 14.5]],
      foreFar: [[17.5, 13.7], [19.7, 12.7], [21.9, 14.1], [21.4, 15.7]],
      hindNear: [[9.3, 13.0], [7.3, 17.4], [7.9, 20.4], [7.6, 22.5]],
      hindFar: [[10.8, 13.2], [9.1, 17.5], [9.8, 20.4], [9.6, 22.4]],
      shadow: { dx: -1.4, rx: 7.2, ry: 2.25, a: 0.9 },
    };
  }
  return {
    lift: 0, pitch: 0, riderLift: 0, tailBlow: 0,
    // Hoof polygons extend ~0.95u past the last spine point, so these stop
    // short of MOUNT_GY (23.4) rather than at it — otherwise a standing horse
    // sinks a full pixel below its own declared ground line and anchor.
    foreNear: [[19.3, 13.4], [19.5, 17.5], [19.7, 20.5], [19.8, 22.4]],
    foreFar: [[17.5, 13.7], [17.3, 17.6], [17.1, 20.5], [17.0, 21.9]],
    hindNear: [[9.3, 13.0], [7.5, 17.3], [8.4, 20.4], [8.6, 22.4]],
    hindFar: [[10.8, 13.2], [9.2, 17.4], [10.0, 20.4], [10.2, 21.8]],
    shadow: { dx: 0, rx: 8.4, ry: 2.4, a: 1 },
  };
}

/** One horse leg: upper mass, joint knob, tapered cannon bone, hoof. */
function mHorseLeg(g, pts, R, points, hoofR, opts) {
  const o = opts || {};
  const s = o.scale === undefined ? 1 : o.scale;

  // Upper mass (forearm / gaskin) — the heavy muscled part.
  mLimb(g, [pts[0], pts[1]], [1.55 * s, 0.86 * s], R.base);
  g.save();
  mLimbPath(g, [pts[0], pts[1]], [1.55 * s, 0.86 * s]);
  g.clip();
  const g1 = mCylGrad(g, pts[0][0], pts[0][1], pts[1][0], pts[1][1], 1.6 * s, R);
  g.fillStyle = g1;
  g.fillRect(pts[0][0] - 4, Math.min(pts[0][1], pts[1][1]) - 4, 9, 9);
  g.restore();

  // Cannon bone: thin, hard, with its own cylinder shading. Dark "points"
  // colour below the knee is what makes a bay read as a bay.
  const lower = [pts[1], pts[2], pts[3]];
  const lw = [0.78 * s, 0.60 * s, 0.52 * s];
  mLimb(g, lower, lw, points.base);
  g.save();
  mLimbPath(g, lower, lw);
  g.clip();
  g.fillStyle = mCylGrad(g, pts[1][0], pts[1][1], pts[3][0], pts[3][1], 0.9 * s, points);
  g.fillRect(Math.min(pts[1][0], pts[3][0]) - 3, Math.min(pts[1][1], pts[3][1]) - 3, 11, 11);
  g.restore();

  // Knee / hock knob.
  g.fillStyle = R.mid;
  g.beginPath(); g.arc(pts[1][0], pts[1][1], 0.95 * s, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA(R.lit, 0.75);
  g.beginPath();
  g.arc(pts[1][0] + MOUNT_SUN.x * 0.3 * s, pts[1][1] + MOUNT_SUN.y * 0.3 * s, 0.52 * s, 0, MOUNT_TAU);
  g.fill();

  // Fetlock joint + ergot tuft.
  g.fillStyle = points.mid;
  g.beginPath(); g.arc(pts[2][0], pts[2][1], 0.66 * s, 0, MOUNT_TAU); g.fill();

  // White sock, if this leg has one.
  if (o.sock) {
    g.save();
    mLimbPath(g, [pts[2], pts[3]], [0.62 * s, 0.56 * s]);
    g.clip();
    g.fillStyle = '#CFC7B6';
    g.fillRect(pts[2][0] - 3, pts[2][1] - 3, 7, 7);
    g.fillStyle = mA('#6E6A60', 0.5);
    g.fillRect(pts[2][0] - 3 + MOUNT_SUN.shadow.x * 0.9, pts[2][1] - 3, 7, 7);
    g.restore();
  }

  // Hoof — a distinct trapezoid, wider at the ground, with a lit wall.
  const d = [pts[3][0] - pts[2][0], pts[3][1] - pts[2][1]];
  const dl = Math.hypot(d[0], d[1]) || 1;
  const ux = d[0] / dl, uy = d[1] / dl;
  const px = -uy, py = ux;
  const hx = pts[3][0], hy = pts[3][1];
  mPoly(g, [
    [hx + px * 0.55 * s - ux * 0.25 * s, hy + py * 0.55 * s - uy * 0.25 * s],
    [hx - px * 0.55 * s - ux * 0.25 * s, hy - py * 0.55 * s - uy * 0.25 * s],
    [hx - px * 0.82 * s + ux * 0.95 * s, hy - py * 0.82 * s + uy * 0.95 * s],
    [hx + px * 0.82 * s + ux * 0.95 * s, hy + py * 0.82 * s + uy * 0.95 * s],
  ]);
  g.fillStyle = hoofR.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mCylGrad(g, hx - px * 2, hy - py * 2, hx + px * 2, hy + py * 2, 1.1 * s, hoofR);
  g.fillRect(hx - 3, hy - 3, 6, 6);
  g.restore();
}

/** Flowing tail, per stance. */
function mHorseTail(g, blow, R, rng) {
  let spine, widths;
  if (blow > 0.9) {
    spine = [[6.5, 10.2], [4.7, 11.1], [2.9, 12.4], [1.6, 14.2]];
    widths = [0.55, 1.30, 1.25, 0.55];
  } else if (blow > 0.7) {
    spine = [[6.5, 10.2], [4.9, 10.9], [3.2, 11.9], [2.3, 13.5]];
    widths = [0.55, 1.25, 1.15, 0.50];
  } else if (blow > 0.3) {
    spine = [[6.5, 10.2], [4.9, 12.0], [3.5, 14.6], [2.7, 17.5]];
    widths = [0.55, 1.35, 1.20, 0.55];
  } else {
    spine = [[6.5, 10.2], [5.3, 13.0], [4.7, 16.4], [5.0, 19.4], [5.5, 21.3]];
    widths = [0.55, 1.20, 1.35, 1.05, 0.50];
  }
  mLimb(g, spine, widths, R.base);
  g.save();
  mLimbPath(g, spine, widths);
  g.clip();
  // hair strands: lit strands on the up-left face only
  g.lineWidth = 0.22;
  for (let i = 0; i < 16; i++) {
    const t = rng();
    const j = (rng() - 0.5) * 1.8;
    const a = t < 0.5 ? R.lit : R.shade;
    g.strokeStyle = mA(a, 0.5 + rng() * 0.35);
    g.beginPath();
    const p0 = spine[0], p1 = spine[Math.min(1, spine.length - 1)];
    const pl = spine[spine.length - 1];
    g.moveTo(p0[0] + j * 0.3, p0[1]);
    g.quadraticCurveTo(p1[0] + j, p1[1] + j * 0.4, pl[0] + j * 1.2, pl[1] + j * 0.6);
    g.stroke();
  }
  g.restore();
  // A single edge-light strand along the up-left boundary.
  g.save();
  g.globalAlpha = 0.55;
  g.strokeStyle = R.edge;
  g.lineWidth = 0.24;
  g.beginPath();
  mCurve(g, spine.map(function (p, i) {
    return [p[0] + MOUNT_SUN.x * widths[i] * 0.8, p[1] + MOUNT_SUN.y * widths[i] * 0.8];
  }));
  g.stroke();
  g.restore();
}

/** Mane locks flowing from poll to withers. */
function mHorseMane(g, blow, R, rng) {
  const crest = [[24.4, 4.6], [22.6, 5.5], [20.7, 6.6], [18.9, 7.8], [17.4, 8.9]];
  // Base mane mass sits just behind the crest line.
  const mass = crest.map(function (p, i) {
    return [p[0] - 0.25, p[1] + 0.75 + i * 0.05];
  });
  mLimb(g, mass, [0.55, 1.05, 1.15, 1.15, 0.95], R.base);

  const drift = 0.9 + blow * 1.7;
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const idx = t * (crest.length - 1);
    const i0 = Math.floor(idx), f = idx - i0;
    const i1 = Math.min(crest.length - 1, i0 + 1);
    const x = crest[i0][0] + (crest[i1][0] - crest[i0][0]) * f;
    const y = crest[i0][1] + (crest[i1][1] - crest[i0][1]) * f;
    const len = 1.5 + rng() * 1.5;
    const back = drift * (0.6 + rng() * 0.7);
    const lock = [[x, y + 0.2], [x - back * 0.5, y + len * 0.6], [x - back, y + len]];
    const shade = rng() < 0.34 ? R.lit : (rng() < 0.5 ? R.base : R.shade);
    mLimb(g, lock, [0.42, 0.34, 0.14], shade);
  }
  // Forelock over the brow.
  mLimb(g, [[25.2, 5.0], [26.1, 5.6], [26.6, 6.6]], [0.42, 0.32, 0.12], R.shade);
  // Edge light on the crest, up-left side only.
  mEdgeLight(g, crest.map(function (p) {
    return [p[0] + MOUNT_SUN.x * 0.35, p[1] + MOUNT_SUN.y * 0.35];
  }), R.edge, 0.26, 0.6);
}

/** Head detail: eye, nostril, muzzle, cheek mass, blaze. */
function mHorseHead(g, M, rng) {
  const R = M.horseBody;

  // Cheek / jowl mass, lit.
  mMuscle(g, 25.0, 7.4, 1.6, 1.25, -0.5, R.lit, 0.34);
  // Face plane running down the nasal bone toward the muzzle.
  g.save();
  mHorseBodyPath(g); g.clip();
  g.fillStyle = mA(R.lit, 0.22);
  mPoly(g, [[25.3, 5.2], [27.4, 7.1], [28.4, 8.5], [27.5, 8.9], [25.6, 6.9]]);
  g.fill();
  // Muzzle: always darker and softer than the face.
  g.fillStyle = mA(M.horsePoints.shade, 0.55);
  g.beginPath(); g.ellipse(27.9, 8.9, 1.25, 0.95, -0.5, 0, MOUNT_TAU); g.fill();
  g.restore();

  // Blaze — a specific, observed marking; deterministic per nation.
  if ((M.seed & 1) === 0) {
    g.save();
    mHorseBodyPath(g); g.clip();
    g.fillStyle = mA('#D6CFBE', 0.72);
    mPoly(g, [[25.5, 5.4], [26.2, 5.5], [28.2, 8.4], [27.6, 8.7], [25.9, 6.4]]);
    g.fill();
    g.restore();
  }

  // Ear — a small pricked cone, part of the silhouette.
  mPoly(g, [[23.9, 4.9], [24.35, 2.9], [25.0, 4.6]]);
  g.fillStyle = M.horseBody.base; g.fill();
  mPoly(g, [[24.15, 4.6], [24.4, 3.4], [24.72, 4.5]]);
  g.fillStyle = M.horsePoints.shade; g.fill();
  // far ear, darker, behind
  mPoly(g, [[22.9, 5.4], [23.3, 3.7], [23.9, 5.2]]);
  g.fillStyle = mFar(M.horseBody, 0.4).shade; g.fill();

  // Eye: dark almond, cool socket crease, one warm specular.
  g.fillStyle = mA('#1A1510', 0.35);
  g.beginPath(); g.ellipse(25.05, 6.12, 0.75, 0.62, -0.3, 0, MOUNT_TAU); g.fill();
  g.fillStyle = '#15110D';
  g.beginPath(); g.ellipse(25.05, 6.1, 0.5, 0.42, -0.3, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA('#FFF1CE', 0.85);
  g.beginPath(); g.arc(24.88, 5.94, 0.18, 0, MOUNT_TAU); g.fill();

  // Nostril.
  g.fillStyle = '#1C1510';
  g.beginPath(); g.ellipse(28.15, 8.6, 0.32, 0.24, -0.7, 0, MOUNT_TAU); g.fill();

  // Jaw / cheekbone crease.
  mCrease(g, [[24.0, 8.6], [25.4, 8.0], [26.0, 7.0]], 0.28, 0.35);
}

/**
 * Bridle, reins, saddle, girth, breast collar and the shabraque — the saddle
 * cloth, which is the largest unoccluded block of faction colour on the model.
 */
function mHorseTack(g, M, side, stance) {
  const leather = M.strap;
  const sideHex = M.side, sideLitHex = M.sideLit;

  // ---- Shabraque (saddle cloth) -------------------------------------------
  // Pointed hussar cloth. Side colour field, nation-trim border, corner device.
  const cloth = [
    [18.2, 10.6], [18.6, 13.2], [17.6, 15.8], [13.0, 17.0],
    [9.4, 17.9], [8.5, 15.5], [10.0, 12.3], [12.6, 10.2],
  ];
  mPoly(g, cloth);
  g.fillStyle = sideHex; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 13.5, 13.6, 5.4, mRamp(sideHex));
  g.globalAlpha = 0.85;
  g.fillRect(7, 9, 13, 10);
  g.globalAlpha = 1;
  // fold shadow where the cloth falls over the barrel
  g.fillStyle = mA(mMix(sideHex, '#1B2033', 0.5), 0.4);
  mPoly(g, [[9.4, 17.9], [8.5, 15.5], [10.4, 15.8], [11.4, 17.6]]); g.fill();
  g.restore();
  // border in nation trim, plus a fine side-lit lip on the up-left edge
  g.lineWidth = 0.62;
  g.strokeStyle = M.trim.base;
  mPoly(g, cloth); g.stroke();
  g.lineWidth = 0.26;
  g.strokeStyle = M.trim.lit;
  g.beginPath();
  g.moveTo(12.6, 10.2); g.lineTo(18.2, 10.6);
  g.moveTo(10.0, 12.3); g.lineTo(12.6, 10.2);
  g.stroke();
  // corner device (a small trim rosette)
  g.fillStyle = M.trim.base;
  g.beginPath(); g.arc(9.9, 16.2, 0.62, 0, MOUNT_TAU); g.fill();
  g.fillStyle = M.trim.lit;
  g.beginPath(); g.arc(9.76, 16.05, 0.3, 0, MOUNT_TAU); g.fill();

  // ---- Saddle -------------------------------------------------------------
  const seat = [[17.4, 10.5], [16.0, 10.0], [13.8, 10.1], [12.4, 10.9], [12.2, 12.0], [17.0, 11.9]];
  mPoly(g, seat);
  g.fillStyle = M.leather.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 14.8, 11.1, 3.0, M.leather);
  g.fillRect(11, 9, 8, 4);
  g.restore();
  // pommel arch and cantle — the two structural bumps that say "saddle"
  g.strokeStyle = M.leather.shade; g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(17.3, 11.4); g.quadraticCurveTo(17.7, 10.0, 16.5, 9.85); g.stroke();
  g.beginPath(); g.moveTo(12.4, 11.6); g.quadraticCurveTo(11.7, 10.3, 13.0, 10.0); g.stroke();
  g.strokeStyle = M.leather.edge; g.lineWidth = 0.24;
  g.beginPath(); g.moveTo(17.05, 11.2); g.quadraticCurveTo(17.4, 10.05, 16.5, 9.95); g.stroke();
  g.beginPath(); g.moveTo(13.9, 10.05); g.lineTo(16.1, 10.0); g.stroke();

  // ---- Girth / surcingle --------------------------------------------------
  g.strokeStyle = leather.base; g.lineWidth = 0.75;
  g.beginPath(); g.moveTo(16.3, 11.6); g.quadraticCurveTo(16.9, 14.6, 16.2, 17.2); g.stroke();
  g.strokeStyle = leather.lit; g.lineWidth = 0.22;
  g.beginPath(); g.moveTo(16.0, 11.7); g.quadraticCurveTo(16.6, 14.6, 15.95, 17.25); g.stroke();
  // buckle
  g.fillStyle = M.brass.base;
  g.fillRect(16.15, 13.5, 0.75, 0.62);
  g.fillStyle = M.brass.edge;
  g.fillRect(16.15, 13.5, 0.75, 0.22);

  // ---- Breast collar ------------------------------------------------------
  g.strokeStyle = leather.base; g.lineWidth = 0.62;
  g.beginPath(); g.moveTo(17.9, 11.1); g.quadraticCurveTo(20.2, 12.4, 20.9, 14.1); g.stroke();
  g.strokeStyle = leather.lit; g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(17.9, 10.9); g.quadraticCurveTo(20.1, 12.2, 20.75, 13.95); g.stroke();
  g.fillStyle = M.brass.base;
  g.beginPath(); g.arc(19.7, 12.5, 0.4, 0, MOUNT_TAU); g.fill();
  g.fillStyle = M.brass.edge;
  g.beginPath(); g.arc(19.6, 12.4, 0.18, 0, MOUNT_TAU); g.fill();

  // ---- Crupper over the rump ---------------------------------------------
  g.strokeStyle = leather.shade; g.lineWidth = 0.42;
  g.beginPath(); g.moveTo(12.4, 10.4); g.quadraticCurveTo(9.6, 9.2, 7.0, 10.2); g.stroke();

  // ---- Bridle -------------------------------------------------------------
  g.strokeStyle = leather.base; g.lineWidth = 0.42;
  // cheekpiece: poll → bit
  g.beginPath(); g.moveTo(24.9, 5.3); g.quadraticCurveTo(26.1, 6.6, 26.9, 8.3); g.stroke();
  // browband
  g.beginPath(); g.moveTo(24.6, 5.35); g.lineTo(25.9, 6.35); g.stroke();
  // noseband
  g.beginPath(); g.moveTo(26.6, 7.15); g.quadraticCurveTo(27.5, 7.9, 27.2, 8.9); g.stroke();
  // throatlatch
  g.beginPath(); g.moveTo(24.3, 5.6); g.quadraticCurveTo(23.6, 7.4, 24.3, 8.7); g.stroke();
  g.strokeStyle = leather.lit; g.lineWidth = 0.16;
  g.beginPath(); g.moveTo(24.8, 5.2); g.quadraticCurveTo(25.95, 6.5, 26.75, 8.2); g.stroke();
  // bit ring — small brass circle, catches the light
  g.fillStyle = M.brass.base;
  g.beginPath(); g.arc(27.0, 8.55, 0.46, 0, MOUNT_TAU); g.fill();
  g.fillStyle = M.brass.edge;
  g.beginPath(); g.arc(26.88, 8.42, 0.22, 0, MOUNT_TAU); g.fill();

  // ---- Reins: bit → rider's near hand ------------------------------------
  const sag = stance.pitch < -0.1 ? 0.4 : 1.1;
  g.strokeStyle = leather.shade; g.lineWidth = 0.36;
  g.beginPath();
  g.moveTo(26.9, 8.7);
  g.quadraticCurveTo(23.4, 10.0 + sag, 19.1, 11.3);
  g.stroke();
  g.strokeStyle = leather.lit; g.lineWidth = 0.14;
  g.beginPath();
  g.moveTo(26.85, 8.55);
  g.quadraticCurveTo(23.35, 9.85 + sag, 19.05, 11.15);
  g.stroke();

  // ---- Stirrup leather + iron --------------------------------------------
  g.strokeStyle = leather.base; g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(15.4, 12.2); g.lineTo(15.55, 16.9); g.stroke();
  g.strokeStyle = M.steel.base; g.lineWidth = 0.5;
  g.beginPath(); g.arc(15.6, 17.4, 0.85, Math.PI * 0.86, Math.PI * 0.14, true); g.stroke();
  g.strokeStyle = M.steel.edge; g.lineWidth = 0.2;
  g.beginPath(); g.arc(15.55, 17.32, 0.85, Math.PI * 1.05, Math.PI * 1.5); g.stroke();
  g.strokeStyle = M.steel.base; g.lineWidth = 0.42;
  g.beginPath(); g.moveTo(14.78, 17.55); g.lineTo(16.42, 17.55); g.stroke();

  // Side-colour pennant on the near side of the bridle: a second, small,
  // high-contrast faction cue up at head height where nothing occludes it.
  g.fillStyle = sideHex;
  mPoly(g, [[26.4, 6.9], [27.6, 6.35], [27.4, 7.35]]); g.fill();
  g.fillStyle = sideLitHex;
  mPoly(g, [[26.4, 6.9], [27.1, 6.6], [26.95, 7.05]]); g.fill();
}

/** Seated rider: bent leg, coat tails, hat, sabre. */
function mRider(g, M, pose, stance, side) {
  const lift = stance.riderLift;
  const lean = pose === 'attack' ? -0.10 : (stance.pitch * 0.5);

  g.save();
  g.translate(15.0, 11.6 + lift);
  g.rotate(lean);
  g.translate(-15.0, -11.6);

  const coat = M.coat, trim = M.trim, skin = M.skin;

  // ---- Off (far) arm and sabre, drawn behind the torso --------------------
  const farArm = mFar(coat, 0.34);
  if (pose === 'attack') {
    // Sabre swung forward and down in a cut.
    mLimb(g, [[15.2, 7.3], [17.6, 7.6], [19.9, 9.4]], [1.05, 0.86, 0.66], farArm.base);
    mSabre(g, M, 20.2, 9.7, 0.62, true);
  } else {
    mLimb(g, [[15.0, 7.3], [16.2, 9.4], [17.6, 10.8]], [1.02, 0.82, 0.62], farArm.base);
    mSabre(g, M, 17.6, 10.6, -1.02, false);
  }

  // ---- Coat tails, over the cantle ---------------------------------------
  const tails = [[13.4, 10.2], [12.0, 11.6], [11.0, 13.4], [10.9, 14.6]];
  mLimb(g, tails, [1.55, 1.45, 1.1, 0.55], coat.base);
  g.save();
  mLimbPath(g, tails, [1.55, 1.45, 1.1, 0.55]);
  g.clip();
  g.fillStyle = mFormGrad(g, 12.0, 12.4, 2.6, coat);
  g.fillRect(9, 9, 6, 7);
  g.restore();
  // turnback lining in trim — the classic 18th-century coat detail
  g.strokeStyle = trim.base; g.lineWidth = 0.42;
  g.beginPath(); g.moveTo(12.6, 10.6); g.quadraticCurveTo(11.5, 12.4, 11.3, 14.2); g.stroke();
  g.strokeStyle = trim.lit; g.lineWidth = 0.16;
  g.beginPath(); g.moveTo(12.45, 10.5); g.quadraticCurveTo(11.35, 12.3, 11.15, 14.1); g.stroke();

  // ---- Near leg: thigh forward, knee, calf back, boot in the stirrup ------
  const legPts = [[14.7, 11.3], [16.5, 13.6], [15.9, 16.0], [15.6, 17.4]];
  mLimb(g, legPts, [1.42, 1.02, 0.78, 0.66], M.leather.shade);
  g.save();
  mLimbPath(g, legPts, [1.42, 1.02, 0.78, 0.66]);
  g.clip();
  g.fillStyle = mCylGrad(g, 14.7, 11.3, 15.7, 17.2, 1.5, M.leather);
  g.fillRect(12, 10, 7, 9);
  g.restore();
  // breeches above the boot top
  g.save();
  mLimbPath(g, [[14.7, 11.3], [16.4, 13.4]], [1.42, 1.02]);
  g.clip();
  g.fillStyle = M.buff.base;
  g.fillRect(12, 9, 7, 6);
  g.fillStyle = mA(M.buff.shade, 0.7);
  g.fillRect(12 + MOUNT_SUN.shadow.x * 1.6, 9 + MOUNT_SUN.shadow.y * 1.4, 7, 6);
  g.restore();
  // boot-top flare
  mPoly(g, [[15.55, 13.5], [17.35, 14.05], [17.0, 14.95], [15.35, 14.35]]);
  g.fillStyle = M.leather.mid; g.fill();
  g.strokeStyle = M.leather.edge; g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(15.55, 13.5); g.lineTo(17.35, 14.05); g.stroke();
  // spur
  g.strokeStyle = M.steel.base; g.lineWidth = 0.3;
  g.beginPath(); g.moveTo(15.1, 17.0); g.lineTo(14.2, 17.3); g.stroke();
  g.fillStyle = M.steel.edge;
  g.beginPath(); g.arc(14.05, 17.35, 0.26, 0, MOUNT_TAU); g.fill();

  // ---- Sabretache hanging from the belt ----------------------------------
  mPoly(g, [[12.2, 14.2], [13.9, 14.6], [13.7, 16.6], [12.1, 16.3]]);
  g.fillStyle = M.side; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 13.0, 15.4, 1.3, mRamp(M.side));
  g.fillRect(11, 13, 4, 5);
  g.restore();
  g.strokeStyle = trim.base; g.lineWidth = 0.28;
  mPoly(g, [[12.2, 14.2], [13.9, 14.6], [13.7, 16.6], [12.1, 16.3]]); g.stroke();
  g.strokeStyle = M.strap.shade; g.lineWidth = 0.26;
  g.beginPath(); g.moveTo(12.9, 12.4); g.lineTo(12.6, 14.3); g.stroke();

  // ---- Torso -------------------------------------------------------------
  const torso = [
    [16.6, 6.4], [16.9, 9.0], [16.4, 11.6], [13.5, 11.4],
    [13.5, 8.9], [14.2, 6.5], [15.4, 5.9],
  ];
  mPoly(g, torso);
  g.fillStyle = coat.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 15.2, 8.6, 3.1, coat);
  g.fillRect(12, 5, 6, 8);
  // chest muscle / lapel plane
  mMuscle(g, 15.0, 7.6, 1.5, 2.0, -0.25, coat.lit, 0.28);
  // waist shadow under the sash
  g.fillStyle = mA(coat.deep, 0.3);
  g.fillRect(12, 10.6, 6, 1.4);
  g.restore();

  // lapel / facing in trim, running down the chest
  mPoly(g, [[16.5, 6.5], [16.85, 9.4], [15.85, 9.3], [15.7, 6.4]]);
  g.fillStyle = trim.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 16.2, 7.9, 1.6, trim);
  g.fillRect(15, 6, 2.5, 4);
  g.restore();
  // buttons
  g.fillStyle = M.brass.base;
  for (let i = 0; i < 3; i++) {
    g.beginPath(); g.arc(16.15, 6.9 + i * 0.85, 0.22, 0, MOUNT_TAU); g.fill();
  }
  g.fillStyle = M.brass.edge;
  for (let i = 0; i < 3; i++) {
    g.beginPath(); g.arc(16.08, 6.83 + i * 0.85, 0.1, 0, MOUNT_TAU); g.fill();
  }

  // crossbelt over the near shoulder
  g.strokeStyle = M.buff.base; g.lineWidth = 0.62;
  g.beginPath(); g.moveTo(14.5, 6.4); g.lineTo(16.6, 10.6); g.stroke();
  g.strokeStyle = M.buff.edge; g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(14.35, 6.5); g.lineTo(16.45, 10.7); g.stroke();
  // belt plate
  g.fillStyle = M.brass.base; g.fillRect(15.35, 8.25, 0.62, 0.5);
  g.fillStyle = M.brass.edge; g.fillRect(15.35, 8.25, 0.62, 0.18);

  // waist sash in trim
  mPoly(g, [[13.5, 10.6], [16.5, 10.9], [16.4, 11.7], [13.5, 11.4]]);
  g.fillStyle = trim.mid; g.fill();
  g.fillStyle = mA(trim.lit, 0.7);
  g.fillRect(13.5, 10.65, 3.0, 0.28);

  // shoulder wing / epaulette
  mPoly(g, [[14.0, 6.2], [16.0, 6.0], [16.2, 6.9], [13.9, 7.0]]);
  g.fillStyle = trim.base; g.fill();
  g.fillStyle = mA(trim.edge, 0.8);
  g.fillRect(14.0, 6.1, 2.0, 0.26);

  // ---- Near arm: reins hand (idle) or raised cut (attack) ----------------
  let armPts, handPt;
  if (pose === 'attack') {
    armPts = [[15.7, 6.8], [17.2, 8.6], [18.9, 11.1]];
    handPt = [19.1, 11.4];
  } else {
    armPts = [[15.6, 6.9], [16.9, 9.2], [18.9, 11.1]];
    handPt = [19.1, 11.3];
  }
  mLimb(g, armPts, [1.12, 0.9, 0.66], coat.base);
  g.save();
  mLimbPath(g, armPts, [1.12, 0.9, 0.66]);
  g.clip();
  g.fillStyle = mCylGrad(g, armPts[0][0], armPts[0][1], armPts[2][0], armPts[2][1], 1.2, coat);
  g.fillRect(14, 6, 6, 6);
  g.restore();
  // cuff in trim
  mPoly(g, [[18.15, 10.2], [19.15, 11.0], [18.55, 11.65], [17.6, 10.85]]);
  g.fillStyle = trim.base; g.fill();
  g.fillStyle = mA(trim.lit, 0.7);
  g.fillRect(17.75, 10.35, 0.9, 0.24);
  // chunky visible hand
  g.fillStyle = skin.base;
  g.beginPath(); g.arc(handPt[0], handPt[1], 0.72, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA(skin.lit, 0.8);
  g.beginPath(); g.arc(handPt[0] + MOUNT_SUN.x * 0.24, handPt[1] + MOUNT_SUN.y * 0.24, 0.4, 0, MOUNT_TAU); g.fill();

  // ---- Head --------------------------------------------------------------
  // hy is set so that the tallest headgear (turban + aigrette) still clears
  // y = 0 in the worst-case pose. The gathered-gallop stance lifts the whole
  // horse AND the rider, and at hy = 4.5 the plume was baked off the top of
  // the frame — the same defect as the clipped pikeman spearhead.
  const hx = 15.9, hy = 5.0;
  // neck stock
  g.fillStyle = M.buff.mid;
  g.fillRect(15.1, hy + 1.3, 1.5, 0.9);
  // head
  g.fillStyle = skin.base;
  g.beginPath(); g.ellipse(hx, hy, 1.62, 1.78, 0.06, 0, MOUNT_TAU); g.fill();
  g.save();
  g.beginPath(); g.ellipse(hx, hy, 1.62, 1.78, 0.06, 0, MOUNT_TAU); g.clip();
  g.fillStyle = mFormGrad(g, hx, hy, 1.8, skin);
  g.fillRect(hx - 2, hy - 2, 4, 4);
  g.restore();
  // brow shadow, eye, mouth — enough face to read as a man at 12px
  g.fillStyle = mA(skin.shade, 0.55);
  g.beginPath(); g.ellipse(hx + 0.15, hy - 0.75, 1.35, 0.5, 0.05, 0, MOUNT_TAU); g.fill();
  g.fillStyle = '#191410';
  g.beginPath(); g.arc(hx + 0.95, hy - 0.15, 0.22, 0, MOUNT_TAU); g.fill();
  g.strokeStyle = mA('#3A2118', 0.8); g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(hx + 0.65, hy + 0.95); g.lineTo(hx + 1.25, hy + 0.9); g.stroke();
  // queue (tied hair) at the back
  mLimb(g, [[hx - 1.4, hy + 0.3], [hx - 2.1, hy + 1.4], [hx - 2.3, hy + 2.4]],
    [0.62, 0.44, 0.16], M.hair.base);

  // ---- Headgear: silhouette is what separates the two armies at 8px -------
  if (M.headgear === 'turban') {
    // Wrapped turban: three stacked coils plus a plume.
    const tR = M.white;
    for (let i = 0; i < 3; i++) {
      const yy = hy - 1.55 - i * 0.60;
      const rx = 1.92 - i * 0.24;
      g.fillStyle = tR.base;
      g.beginPath(); g.ellipse(hx, yy, rx, 0.62, -0.06, 0, MOUNT_TAU); g.fill();
      g.fillStyle = mA(tR.lit, 0.75);
      g.beginPath(); g.ellipse(hx + MOUNT_SUN.x * 0.35, yy + MOUNT_SUN.y * 0.22, rx * 0.62, 0.26, -0.06, 0, MOUNT_TAU); g.fill();
      g.fillStyle = mA(tR.shade, 0.5);
      g.beginPath(); g.ellipse(hx + 0.55, yy + 0.34, rx * 0.72, 0.2, -0.06, 0, MOUNT_TAU); g.fill();
    }
    // aigrette / plume socket in trim + side colour
    g.fillStyle = M.trim.base;
    g.fillRect(hx + 0.9, hy - 2.9, 0.42, 0.75);
    mLimb(g, [[hx + 1.1, hy - 2.8], [hx + 1.7, hy - 3.4], [hx + 1.5, hy - 3.7]],
      [0.34, 0.28, 0.1], M.side);
  } else {
    // Tricorn: a broad cocked brim, three corners, a cockade in side colour.
    g.fillStyle = M.hat.base;
    mPoly(g, [
      [hx - 2.55, hy - 1.35], [hx - 1.5, hy - 2.35], [hx + 0.1, hy - 2.9],
      [hx + 1.85, hy - 2.5], [hx + 2.55, hy - 1.5], [hx + 1.9, hy - 0.95],
      [hx + 0.1, hy - 1.55], [hx - 1.7, hy - 0.9],
    ]);
    g.fill();
    g.save(); g.clip();
    g.fillStyle = mFormGrad(g, hx, hy - 1.9, 2.6, M.hat);
    g.fillRect(hx - 3, hy - 3.2, 6, 3);
    g.restore();
    // crown behind the brim
    g.fillStyle = M.hat.mid;
    g.beginPath(); g.ellipse(hx + 0.1, hy - 1.9, 1.25, 0.85, 0, 0, MOUNT_TAU); g.fill();
    // brim edge light along the up-left boundary only
    mEdgeLight(g, [[hx - 2.5, hy - 1.4], [hx - 1.4, hy - 2.3], [hx + 0.1, hy - 2.8], [hx + 1.7, hy - 2.45]],
      M.hat.edge, 0.26, 0.85);
    // lace edging in trim
    g.strokeStyle = mA(M.trim.base, 0.75); g.lineWidth = 0.22;
    g.beginPath();
    g.moveTo(hx - 2.35, hy - 1.28); g.lineTo(hx - 1.42, hy - 2.15);
    g.lineTo(hx + 0.1, hy - 2.68); g.lineTo(hx + 1.75, hy - 2.32);
    g.stroke();
    // cockade in faction colour
    g.fillStyle = M.side;
    g.beginPath(); g.arc(hx + 1.35, hy - 2.05, 0.46, 0, MOUNT_TAU); g.fill();
    g.fillStyle = M.sideLit;
    g.beginPath(); g.arc(hx + 1.24, hy - 2.16, 0.22, 0, MOUNT_TAU); g.fill();
    // small plume
    mLimb(g, [[hx + 1.5, hy - 2.4], [hx + 1.9, hy - 3.0], [hx + 1.7, hy - 3.6]],
      [0.32, 0.26, 0.09], M.trim.base);
  }

  g.restore();
}

/** Curved sabre with a knuckle-bow hilt. angle in radians from +x. */
function mSabre(g, M, x, y, ang, extended) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);

  // grip + knuckle bow
  g.strokeStyle = M.strap.base; g.lineWidth = 0.75;
  g.beginPath(); g.moveTo(-1.5, 0.1); g.lineTo(-0.2, 0.0); g.stroke();
  g.strokeStyle = M.brass.base; g.lineWidth = 0.36;
  g.beginPath(); g.moveTo(-1.4, 0.55); g.quadraticCurveTo(0.35, 0.85, 0.25, -0.15); g.stroke();
  g.strokeStyle = M.brass.edge; g.lineWidth = 0.15;
  g.beginPath(); g.moveTo(-1.4, 0.42); g.quadraticCurveTo(0.2, 0.68, 0.15, -0.1); g.stroke();
  g.fillStyle = M.brass.base; g.fillRect(-0.2, -0.42, 0.42, 0.95);
  g.fillStyle = M.brass.edge; g.fillRect(-0.2, -0.42, 0.42, 0.26);

  // blade — a curved, tapering spine with a single-sided edge light and a
  // bright fuller. Straight grey sticks read as debris; this reads as steel.
  const L = extended ? 7.4 : 6.6;
  const spine = [[0.3, -0.05], [L * 0.4, -0.5], [L * 0.75, -1.1], [L, -1.9]];
  mLimb(g, spine, [0.42, 0.36, 0.28, 0.06], M.steel.base);
  g.save();
  mLimbPath(g, spine, [0.42, 0.36, 0.28, 0.06]);
  g.clip();
  g.fillStyle = mCylGrad(g, 0.3, -0.05, L, -1.9, 0.55, M.steel, '#F4F1E6');
  g.fillRect(-1, -4, L + 2, 6);
  g.restore();
  // back edge, dark
  g.strokeStyle = mA(M.steel.deep, 0.7); g.lineWidth = 0.14;
  g.beginPath();
  mCurve(g, spine.map(function (p, i) { return [p[0] + 0.1, p[1] + [0.3, 0.26, 0.2, 0.04][i]]; }));
  g.stroke();
  // cutting edge, bright
  g.strokeStyle = mA('#F6F2E4', 0.85); g.lineWidth = 0.13;
  g.beginPath();
  mCurve(g, spine.map(function (p, i) { return [p[0] - 0.05, p[1] - [0.3, 0.26, 0.2, 0.04][i]]; }));
  g.stroke();

  g.restore();
}

/**
 * MAIN CAVALRY PAINTER.
 *   g        — frame context, already scaled to sprite units by frameCanvas()
 *   nat      — NATIONS[key]
 *   pose     — 'idle' | 'attack'
 *   legPhase — 0 (stand) | 1 (gallop extended) | 2 (gallop gathered)
 *   side     — OPTIONAL 0/1. Enables baked faction colour. Safe to omit.
 */
function drawCavalry(g, nat, pose, legPhase, side) {
  // Centre the authored geometry in the widened box (see MOUNT_CAV_OX).
  g.translate(MOUNT_CAV_OX, 0);

  const M = mMaterials(nat, side);
  const rng = mRng(M.seed ^ 0x9E3779B9);
  const phase = pose === 'attack' ? 3 : (legPhase | 0);
  const st = mHorseStance(phase);

  g.lineJoin = 'round';
  g.lineCap = 'round';

  const farBody = mFar(M.horseBody, 0.40);
  const farPoints = mFar(M.horsePoints, 0.40);
  const farHoof = mFar(M.hoof, 0.40);
  const sock = (M.seed & 2) !== 0;

  // ---- 1. Contact shadow is deferred to the end (destination-over) --------

  g.save();
  // Body transform: the gallop's vertical oscillation and pitch. This is the
  // difference between a gallop and legs wiggling under a rigid plank.
  g.translate(14, 18);
  g.rotate(st.pitch);
  g.translate(-14, -18 + st.lift);

  // ---- 2. FAR-SIDE LEGS (atmospherically darkened) ------------------------
  mHorseLeg(g, st.hindFar, farBody, farPoints, farHoof, { scale: 0.94 });
  mHorseLeg(g, st.foreFar, farBody, farPoints, farHoof, { scale: 0.94 });

  // ---- 3. TAIL, behind the body ------------------------------------------
  mHorseTail(g, st.tailBlow, M.horseMane, mRng(M.seed ^ 0x51ED270B));

  // ---- 4. HORSE BODY ------------------------------------------------------
  mHorseBodyPath(g);
  g.fillStyle = M.horseBody.base;
  g.fill();

  g.save();
  mHorseBodyPath(g);
  g.clip();

  // Broad form light along the sun axis.
  g.fillStyle = mFormGrad(g, 15.0, 11.6, 8.4, M.horseBody);
  g.globalAlpha = 0.9;
  g.fillRect(4, 3, 26, 16);
  g.globalAlpha = 1;

  // Muscle groups. A horse is a stack of big masses; naming them is what makes
  // the shading read as anatomy rather than as a generic gradient.
  mMuscle(g, 9.6, 11.6, 3.5, 2.9, -0.25, M.horseBody.lit, 0.40);  // haunch / croup
  mMuscle(g, 14.0, 11.2, 4.0, 1.9, -0.08, M.horseBody.lit, 0.24); // barrel top
  mMuscle(g, 19.2, 12.0, 2.2, 2.6, 0.22, M.horseBody.lit, 0.34);  // shoulder
  mMuscle(g, 22.6, 8.4, 1.5, 2.6, -0.55, M.horseBody.lit, 0.26);  // neck crest mass
  mMuscle(g, 25.6, 6.8, 1.6, 1.4, -0.5, M.horseBody.lit, 0.22);   // cheek

  // Belly ambient occlusion — the single strongest "sits in the light" cue.
  const bellyG = g.createLinearGradient(0, 13.0, 0, 17.8);
  bellyG.addColorStop(0, 'rgba(' + MOUNT_SUN.shadowRGB + ',0)');
  bellyG.addColorStop(1, 'rgba(' + MOUNT_SUN.shadowRGB + ',0.42)');
  g.fillStyle = bellyG;
  g.fillRect(4, 13, 20, 6);
  // warm ground bounce along the very bottom edge
  g.fillStyle = mA(MOUNT_SUN.bounce, 0.13);
  g.fillRect(8, 16.3, 12, 1.6);

  // Underside of the neck, in shade.
  g.fillStyle = mA(M.horseBody.shade, 0.4);
  mPoly(g, [[21.9, 9.8], [23.4, 9.0], [22.2, 12.8], [20.6, 13.8]]);
  g.fill();

  // Rib hints and the stifle crease, very low alpha — texture, not stripes.
  g.strokeStyle = mA(M.horseBody.shade, 0.22);
  g.lineWidth = 0.36;
  for (let i = 0; i < 4; i++) {
    const x = 13.4 + i * 1.5;
    g.beginPath();
    g.moveTo(x, 12.4); g.quadraticCurveTo(x - 0.5, 14.6, x - 0.2, 16.6);
    g.stroke();
  }
  // Coat texture: fine directional flecks that survive the 2.4x zoom.
  g.lineWidth = 0.16;
  for (let i = 0; i < 90; i++) {
    const x = 5.5 + rng() * 22, y = 5 + rng() * 12;
    const bright = rng() < 0.45;
    g.strokeStyle = mA(bright ? M.horseBody.lit : M.horseBody.shade, 0.10 + rng() * 0.13);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 0.5 - rng() * 0.5, y + 0.2 + rng() * 0.3);
    g.stroke();
  }
  // Dappling on a grey; harmless on other coats at this alpha.
  if ((M.seed % 4) === 3) {
    for (let i = 0; i < 26; i++) {
      const x = 6.5 + rng() * 14, y = 9 + rng() * 6.5;
      g.fillStyle = mA(M.horseBody.lit, 0.13);
      g.beginPath(); g.arc(x, y, 0.6 + rng() * 0.55, 0, MOUNT_TAU); g.fill();
    }
  }
  // Muzzle and lower legs darken toward the "points" colour.
  g.fillStyle = mA(M.horsePoints.base, 0.28);
  g.beginPath(); g.ellipse(27.6, 9.0, 2.0, 1.5, -0.4, 0, MOUNT_TAU); g.fill();

  g.restore();

  // Anatomical creases, outside the clip so they can slightly break the edge.
  mCrease(g, [[19.9, 10.4], [19.4, 13.2], [19.2, 15.6]], 0.4, 0.34); // behind shoulder
  mCrease(g, [[7.6, 12.3], [8.4, 14.6], [9.4, 16.3]], 0.42, 0.30);   // stifle groove
  mCrease(g, [[22.2, 9.9], [21.6, 11.6], [21.0, 13.2]], 0.3, 0.26);  // jugular furrow

  // Edge light: up-left boundary only — croup, back, crest, poll, brow.
  mEdgeLight(g, [
    [6.5, 10.0], [8.6, 8.6], [11.6, 9.2], [14.0, 10.3],
    [16.0, 9.4], [18.4, 8.5], [21.0, 7.3], [23.4, 5.2],
    [24.9, 4.4], [26.0, 5.4],
  ], M.horseBody.edge, 0.3, 0.8);
  mEdgeLight(g, [[26.4, 6.0], [27.6, 7.2], [28.4, 8.2]], M.horseBody.edge, 0.24, 0.5);

  // ---- 5. MANE + HEAD DETAIL ---------------------------------------------
  mHorseMane(g, st.tailBlow, M.horseMane, mRng(M.seed ^ 0x2545F491));
  mHorseHead(g, M, rng);

  // ---- 6. NEAR-SIDE LEGS --------------------------------------------------
  mHorseLeg(g, st.hindNear, M.horseBody, M.horsePoints, M.hoof, { sock: sock });
  mHorseLeg(g, st.foreNear, M.horseBody, M.horsePoints, M.hoof, {});

  // ---- 7. TACK ------------------------------------------------------------
  mHorseTack(g, M, side, st);

  // ---- 8. RIDER -----------------------------------------------------------
  mRider(g, M, pose, st, side);

  g.restore();

  // ---- 9. WHOLE-FIGURE PASSES + LINING -----------------------------------
  mFinishFigure(g, { tint: M.coat.line });

  // ---- 10. BAKED CONTACT SHADOW (goes underneath everything) -------------
  const sh = st.shadow;
  mContactShadow(g, 14.6 + sh.dx, MOUNT_GY + 0.35, sh.rx, sh.ry, sh.a, M.sideIdx);

  // ---- 11. POST-LINING OVERLAYS (must not acquire a black outline) -------
  if (pose === 'attack') {
    // Sabre motion streak: the arc the blade has just swept.
    g.save();
    g.globalCompositeOperation = 'lighter';
    const arc = g.createLinearGradient(19.0, 5.0, 26.0, 10.5);
    arc.addColorStop(0, 'rgba(255,248,226,0)');
    arc.addColorStop(0.45, 'rgba(255,248,226,0.16)');
    arc.addColorStop(1, 'rgba(255,248,226,0)');
    g.strokeStyle = arc;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(19.2, 5.2);
    g.quadraticCurveTo(25.6, 5.6, 26.6, 10.6);
    g.stroke();
    // blade tip glint
    const gl = g.createRadialGradient(26.4, 10.2, 0, 26.4, 10.2, 1.7);
    gl.addColorStop(0, 'rgba(255,252,238,0.55)');
    gl.addColorStop(1, 'rgba(255,252,238,0)');
    g.fillStyle = gl;
    g.beginPath(); g.arc(26.4, 10.2, 1.7, 0, MOUNT_TAU); g.fill();
    g.restore();
  }
}


// =============================================================================
//  6.  CANNON
//
//  Sprite box:  w = 41, h = 29, ax = 20.5, ay = 23.4
//  A real 18th-century field piece: tapered bronze barrel with base ring,
//  reinforce rings, astragals, muzzle swell, dolphins, trunnions and cascabel;
//  a stepped bracket carriage with iron strapping and an elevating quoin; and
//  fourteen-spoke wheels drawn as RINGS — holes in the silhouette that no
//  other unit type in the game has.
// =============================================================================

// Barrel geometry, at rest.
const MOUNT_C = {
  trunnion: [22.6, 11.5],
  breech: [14.85, 12.90],
  muzzle: [32.10, 10.00],
  wheelNear: [20.4, 16.6, 6.8],
  wheelFar: [18.6, 16.15, 6.4],
};

/**
 * Turned-bronze barrel profile. Radius varies along the axis through the real
 * sequence of a period gun: cascabel, base ring, first reinforce, reinforce
 * ring, second reinforce, astragal, chase, muzzle astragal, muzzle swell.
 */
const MOUNT_C_PROFILE = [
  [0.000, 2.05], [0.020, 2.10], [0.030, 2.42], [0.055, 2.42], [0.065, 2.06],
  [0.300, 1.96], [0.320, 2.26], [0.352, 2.26], [0.372, 1.88],
  [0.540, 1.78], [0.556, 2.02], [0.578, 2.02], [0.596, 1.70],
  [0.880, 1.36], [0.898, 1.60], [0.918, 1.60], [0.934, 1.42],
  [0.960, 1.66], [0.992, 1.72], [1.000, 1.66],
];

function mBarrelPoints(bx, by, mx, my) {
  let dx = mx - bx, dy = my - by;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  const nx = -dy, ny = dx;
  const top = [], bot = [];
  for (let i = 0; i < MOUNT_C_PROFILE.length; i++) {
    const t = MOUNT_C_PROFILE[i][0], r = MOUNT_C_PROFILE[i][1];
    const px = bx + dx * L * t, py = by + dy * L * t;
    top.push([px + nx * r, py + ny * r]);
    bot.push([px - nx * r, py - ny * r]);
  }
  return { top: top, bot: bot, dx: dx, dy: dy, nx: nx, ny: ny, L: L };
}

function mBarrelPath(g, bx, by, mx, my) {
  const P = mBarrelPoints(bx, by, mx, my);
  g.beginPath();
  g.moveTo(P.top[0][0], P.top[0][1]);
  for (let i = 1; i < P.top.length; i++) g.lineTo(P.top[i][0], P.top[i][1]);
  for (let i = P.bot.length - 1; i >= 0; i--) g.lineTo(P.bot[i][0], P.bot[i][1]);
  g.closePath();
  return P;
}

function mPaintBarrel(g, M, bx, by, mx, my) {
  const R = M.bronze;
  const P = mBarrelPath(g, bx, by, mx, my);
  g.fillStyle = R.base;
  g.fill();

  // Normal pointing TOWARD the light (i.e. the barrel's upper, sun-facing
  // flank). P.nx/P.ny is +90 degrees off the axis, which for a muzzle-up-right
  // gun points DOWN into the carriage — so everything that belongs on top of
  // the piece (vent field, dolphins) and every lit edge must use this instead.
  const sgn = (P.nx * mSunX() + P.ny * MOUNT_SUN.y) >= 0 ? 1 : -1;
  const ux = P.nx * sgn, uy = P.ny * sgn;

  g.save();
  mBarrelPath(g, bx, by, mx, my);
  g.clip();

  // Cylinder shading across the axis: specular streak on the sun side,
  // terminator, core shadow, warm bounce lip on the far rim.
  g.fillStyle = mCylGrad(g, bx, by, mx, my, 2.5, R, '#F0DCA4');
  g.fillRect(bx - 5, Math.min(by, my) - 5, P.L + 10, 12);

  // Bronze patina: irregular cool-green mottling in the recesses.
  const rng = mRng(0xB0F1CE);
  for (let i = 0; i < 40; i++) {
    const t = rng();
    const px = bx + P.dx * P.L * t, py = by + P.dy * P.L * t;
    const off = (rng() - 0.35) * 3.2;
    g.fillStyle = mA('#5E7A5E', 0.05 + rng() * 0.07);
    g.beginPath();
    g.ellipse(px + P.nx * off, py + P.ny * off, 0.5 + rng() * 1.1, 0.3 + rng() * 0.5,
      Math.atan2(P.dy, P.dx), 0, MOUNT_TAU);
    g.fill();
  }
  // Turning marks: faint bands perpendicular to the axis.
  g.lineWidth = 0.12;
  for (let i = 0; i < 22; i++) {
    const t = 0.06 + rng() * 0.9;
    const px = bx + P.dx * P.L * t, py = by + P.dy * P.L * t;
    g.strokeStyle = mA(rng() < 0.5 ? R.lit : R.shade, 0.12);
    g.beginPath();
    g.moveTo(px + P.nx * 2.2, py + P.ny * 2.2);
    g.lineTo(px - P.nx * 2.2, py - P.ny * 2.2);
    g.stroke();
  }
  g.restore();

  // ---- Raised rings: each gets its own lit crown and shadow foot ----------
  const rings = [[0.042, 2.42], [0.336, 2.26], [0.567, 2.02], [0.908, 1.60], [0.976, 1.72]];
  for (let i = 0; i < rings.length; i++) {
    const t = rings[i][0], r = rings[i][1];
    const px = bx + P.dx * P.L * t, py = by + P.dy * P.L * t;
    // ring body
    g.save();
    g.beginPath();
    g.moveTo(px + P.nx * r - P.dx * 0.34, py + P.ny * r - P.dy * 0.34);
    g.lineTo(px + P.nx * r + P.dx * 0.34, py + P.ny * r + P.dy * 0.34);
    g.lineTo(px - P.nx * r + P.dx * 0.34, py - P.ny * r + P.dy * 0.34);
    g.lineTo(px - P.nx * r - P.dx * 0.34, py - P.ny * r - P.dy * 0.34);
    g.closePath();
    g.clip();
    g.fillStyle = mCylGrad(g, px - P.dx, py - P.dy, px + P.dx, py + P.dy, r, R, '#FBEDBE');
    g.fillRect(px - 3, py - 3, 6, 6);
    g.restore();
    // crisp lit lip on the sun side of the ring, dark on the other
    g.strokeStyle = mA(R.edge, 0.85); g.lineWidth = 0.2;
    g.beginPath();
    g.moveTo(px + ux * r - P.dx * 0.3, py + uy * r - P.dy * 0.3);
    g.lineTo(px - ux * r * 0.15 - P.dx * 0.3, py - uy * r * 0.15 - P.dy * 0.3);
    g.stroke();
    g.strokeStyle = mA(R.deep, 0.6); g.lineWidth = 0.22;
    g.beginPath();
    g.moveTo(px + ux * r * 0.1 + P.dx * 0.32, py + uy * r * 0.1 + P.dy * 0.32);
    g.lineTo(px - ux * r + P.dx * 0.32, py - uy * r + P.dy * 0.32);
    g.stroke();
  }

  // ---- Cascabel: the knob behind the breech ------------------------------
  const cbx = bx - P.dx * 1.5, cby = by - P.dy * 1.5;
  // neck
  g.strokeStyle = R.shade; g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(bx, by); g.lineTo(cbx + P.dx * 0.35, cby + P.dy * 0.35); g.stroke();
  // knob
  g.fillStyle = R.base;
  g.beginPath(); g.arc(cbx, cby, 1.02, 0, MOUNT_TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(cbx, cby, 1.02, 0, MOUNT_TAU); g.clip();
  g.fillStyle = mBlobGrad(g, cbx + MOUNT_SUN.x * 0.55, cby + MOUNT_SUN.y * 0.55, 1.5, R.edge, 0.85, 0);
  g.fillRect(cbx - 1.2, cby - 1.2, 2.4, 2.4);
  g.fillStyle = mA(R.deep, 0.55);
  g.beginPath(); g.arc(cbx - MOUNT_SUN.x * 0.85, cby - MOUNT_SUN.y * 0.85, 0.72, 0, MOUNT_TAU); g.fill();
  g.restore();

  // ---- Muzzle face and bore ----------------------------------------------
  const mfx = mx + P.dx * 0.12, mfy = my + P.dy * 0.12;
  g.save();
  g.translate(mfx, mfy);
  g.rotate(Math.atan2(P.dy, P.dx));
  g.fillStyle = R.mid;
  g.beginPath(); g.ellipse(0, 0, 0.6, 1.66, 0, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA(R.edge, 0.8);
  g.beginPath(); g.ellipse(-0.1, -0.7, 0.34, 0.8, 0, 0, MOUNT_TAU); g.fill();
  // bore: a real hole, dark, with a lit far wall
  g.fillStyle = '#141210';
  g.beginPath(); g.ellipse(0.05, 0, 0.34, 1.02, 0, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA(R.shade, 0.7);
  g.beginPath(); g.ellipse(0.18, 0.22, 0.2, 0.68, 0, 0, MOUNT_TAU); g.fill();
  g.restore();

  // ---- Vent field: touchhole, priming pan, powder scorch -----------------
  const vt = 0.12;
  const vx = bx + P.dx * P.L * vt + ux * 1.9;
  const vy = by + P.dy * P.L * vt + uy * 1.9;
  g.fillStyle = mA(R.shade, 0.7);
  g.beginPath(); g.ellipse(vx, vy, 0.85, 0.34, Math.atan2(P.dy, P.dx), 0, MOUNT_TAU); g.fill();
  g.fillStyle = '#181410';
  g.beginPath(); g.arc(vx, vy - 0.06, 0.24, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA('#2A231A', 0.34);
  g.beginPath(); g.ellipse(vx + 0.4, vy + 0.1, 1.5, 0.5, Math.atan2(P.dy, P.dx), 0, MOUNT_TAU); g.fill();

  // ---- Dolphins: the lifting handles on top of a bronze gun --------------
  for (let k = 0; k < 2; k++) {
    const t = 0.40 + k * 0.115;
    const px = bx + P.dx * P.L * t, py = by + P.dy * P.L * t;
    const ax0 = px + ux * 1.75, ay0 = py + uy * 1.75;
    g.strokeStyle = R.mid; g.lineWidth = 0.5;
    g.beginPath();
    g.moveTo(ax0 - P.dx * 0.55, ay0 - P.dy * 0.55);
    g.quadraticCurveTo(ax0 + ux * 1.15, ay0 + uy * 1.15, ax0 + P.dx * 0.55, ay0 + P.dy * 0.55);
    g.stroke();
    g.strokeStyle = mA(R.edge, 0.85); g.lineWidth = 0.18;
    g.beginPath();
    g.moveTo(ax0 - P.dx * 0.6 + ux * 0.12, ay0 - P.dy * 0.6 + uy * 0.12);
    g.quadraticCurveTo(ax0 + ux * 1.28, ay0 + uy * 1.28, ax0 + P.dx * 0.2 + ux * 0.2, ay0 + P.dy * 0.2 + uy * 0.2);
    g.stroke();
  }

  return P;
}

/** A wheel drawn as a RING: iron tyre, wooden felloes, gapped spokes, hub. */
function mPaintWheel(g, cx, cy, r, wood, iron, brass, spokes, rot, dim) {
  const k = dim === undefined ? 0 : dim;
  const W = k > 0 ? mFar(wood, k) : wood;
  const I = k > 0 ? mFar(iron, k) : iron;
  const B = k > 0 ? mFar(brass, k) : brass;

  const tyreIn = r - 0.62;
  const felloeIn = r - 1.95;
  const hubR = r * 0.245;

  // --- iron tyre -----------------------------------------------------------
  g.beginPath();
  g.arc(cx, cy, r, 0, MOUNT_TAU);
  g.arc(cx, cy, tyreIn, 0, MOUNT_TAU, true);
  g.fillStyle = I.base;
  g.fill('evenodd');
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, MOUNT_TAU);
  g.arc(cx, cy, tyreIn, 0, MOUNT_TAU, true);
  g.clip('evenodd');
  g.fillStyle = mFormGrad(g, cx, cy, r, I);
  g.fillRect(cx - r - 1, cy - r - 1, r * 2 + 2, r * 2 + 2);
  g.restore();
  // tyre edge light, up-left arc only
  g.strokeStyle = mA(I.edge, 0.8); g.lineWidth = 0.26;
  g.beginPath(); g.arc(cx, cy, r - 0.16, Math.PI * 0.98, Math.PI * 1.72); g.stroke();

  // --- wooden felloes, segmented with visible joints -----------------------
  g.beginPath();
  g.arc(cx, cy, tyreIn, 0, MOUNT_TAU);
  g.arc(cx, cy, felloeIn, 0, MOUNT_TAU, true);
  g.fillStyle = W.base;
  g.fill('evenodd');
  g.save();
  g.beginPath();
  g.arc(cx, cy, tyreIn, 0, MOUNT_TAU);
  g.arc(cx, cy, felloeIn, 0, MOUNT_TAU, true);
  g.clip('evenodd');
  g.fillStyle = mFormGrad(g, cx, cy, r, W);
  g.fillRect(cx - r - 1, cy - r - 1, r * 2 + 2, r * 2 + 2);
  // joint lines between felloes
  g.strokeStyle = mA(W.deep, 0.65); g.lineWidth = 0.2;
  const felloes = 7;
  for (let i = 0; i < felloes; i++) {
    const a = rot + i * MOUNT_TAU / felloes + MOUNT_TAU / (felloes * 2);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (felloeIn - 0.3), cy + Math.sin(a) * (felloeIn - 0.3));
    g.lineTo(cx + Math.cos(a) * (tyreIn + 0.3), cy + Math.sin(a) * (tyreIn + 0.3));
    g.stroke();
  }
  // grain
  const rng = mRng(0xFE110E ^ Math.round(cx * 97));
  g.lineWidth = 0.12;
  for (let i = 0; i < 30; i++) {
    const a = rng() * MOUNT_TAU;
    const rr = felloeIn + rng() * (tyreIn - felloeIn);
    g.strokeStyle = mA(rng() < 0.5 ? W.lit : W.shade, 0.2);
    g.beginPath();
    g.arc(cx, cy, rr, a, a + 0.24);
    g.stroke();
  }
  g.restore();
  // inner AO where the felloe meets the spokes
  g.strokeStyle = 'rgba(' + MOUNT_SUN.shadowRGB + ',0.3)';
  g.lineWidth = 0.3;
  g.beginPath(); g.arc(cx, cy, felloeIn + 0.15, 0, MOUNT_TAU); g.stroke();

  // --- spokes: gaps stay TRANSPARENT, which is the whole point -------------
  for (let i = 0; i < spokes; i++) {
    const a = rot + i * MOUNT_TAU / spokes;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Sun-facing spokes are lit, shade-facing spokes are dark. Free volume.
    const dot = -(ca * MOUNT_SUN.x + sa * MOUNT_SUN.y);
    const t = (dot + 1) * 0.5;
    const face = t < 0.34 ? W.lit : t < 0.62 ? W.base : W.shade;
    const x0 = cx + ca * (hubR - 0.15), y0 = cy + sa * (hubR - 0.15);
    const x1 = cx + ca * (felloeIn + 0.25), y1 = cy + sa * (felloeIn + 0.25);
    mLimb(g, [[x0, y0], [x1, y1]], [0.64, 0.42], face);
    // single-sided highlight on the up-left flank of each spoke
    const px = -sa, py = ca;
    const s = (px * MOUNT_SUN.x + py * MOUNT_SUN.y) > 0 ? 1 : -1;
    g.strokeStyle = mA(W.edge, 0.28 + 0.4 * (1 - t));
    g.lineWidth = 0.14;
    g.beginPath();
    g.moveTo(x0 + px * s * 0.5, y0 + py * s * 0.5);
    g.lineTo(x1 + px * s * 0.32, y1 + py * s * 0.32);
    g.stroke();
  }

  // --- hub / nave: a turned barrel with two iron bands and a linchpin ------
  g.fillStyle = W.base;
  g.beginPath(); g.arc(cx, cy, hubR, 0, MOUNT_TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, hubR, 0, MOUNT_TAU); g.clip();
  g.fillStyle = mFormGrad(g, cx, cy, hubR, W);
  g.fillRect(cx - hubR - 1, cy - hubR - 1, hubR * 2 + 2, hubR * 2 + 2);
  g.restore();
  g.strokeStyle = I.base; g.lineWidth = 0.3;
  g.beginPath(); g.arc(cx, cy, hubR * 0.94, 0, MOUNT_TAU); g.stroke();
  g.beginPath(); g.arc(cx, cy, hubR * 0.55, 0, MOUNT_TAU); g.stroke();
  g.strokeStyle = mA(I.edge, 0.7); g.lineWidth = 0.14;
  g.beginPath(); g.arc(cx, cy, hubR * 0.94, Math.PI * 1.0, Math.PI * 1.7); g.stroke();
  // linchpin cap
  g.fillStyle = B.base;
  g.beginPath(); g.arc(cx, cy, hubR * 0.34, 0, MOUNT_TAU); g.fill();
  g.fillStyle = B.edge;
  g.beginPath(); g.arc(cx + MOUNT_SUN.x * 0.18, cy + MOUNT_SUN.y * 0.18, hubR * 0.16, 0, MOUNT_TAU); g.fill();
}

/** Stepped bracket carriage: cheeks, transoms, axletree, strapping, quoin. */
function mPaintCarriage(g, M, side) {
  const W = M.carriage;
  const I = M.iron;

  const top = [
    [24.2, 11.0], [21.4, 11.6], [21.4, 12.9], [17.8, 14.1],
    [17.8, 15.4], [5.4, 22.0],
  ];
  const bottom = [
    [5.0, 23.2], [12.6, 19.9], [18.4, 17.2], [23.4, 14.2], [24.4, 13.5],
  ];

  g.beginPath();
  g.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) g.lineTo(top[i][0], top[i][1]);
  for (let i = 0; i < bottom.length; i++) g.lineTo(bottom[i][0], bottom[i][1]);
  g.closePath();
  g.fillStyle = W.base;
  g.fill();

  g.save();
  g.beginPath();
  g.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) g.lineTo(top[i][0], top[i][1]);
  for (let i = 0; i < bottom.length; i++) g.lineTo(bottom[i][0], bottom[i][1]);
  g.closePath();
  g.clip();

  // Plank shading along the beam.
  g.fillStyle = mCylGrad(g, 24.2, 11.4, 5.2, 22.6, 1.9, W);
  g.fillRect(3, 9, 24, 16);

  // Wood grain following the beam.
  const rng = mRng(0xCA221A6E);
  g.lineWidth = 0.13;
  for (let i = 0; i < 50; i++) {
    const t = rng();
    const x = 24.2 + (5.2 - 24.2) * t;
    const y = 11.4 + (22.6 - 11.4) * t + (rng() - 0.5) * 2.4;
    g.strokeStyle = mA(rng() < 0.45 ? W.lit : W.deep, 0.14 + rng() * 0.16);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 1.4 - rng() * 1.6, y + 0.8 + rng() * 0.9);
    g.stroke();
  }
  // Chipped paint and mud splash at the trail end.
  for (let i = 0; i < 14; i++) {
    const t = 0.62 + rng() * 0.38;
    const x = 24.2 + (5.2 - 24.2) * t;
    const y = 11.4 + (22.6 - 11.4) * t + (rng() - 0.5) * 1.6;
    g.fillStyle = mA('#4A3826', 0.14 + rng() * 0.16);
    g.beginPath(); g.ellipse(x, y, 0.4 + rng() * 0.9, 0.25 + rng() * 0.4, 0.6, 0, MOUNT_TAU); g.fill();
  }
  g.restore();

  // Edge light along the up-left top edge of the beam only.
  mEdgeLight(g, top.map(function (p) { return [p[0] + 0.06, p[1] + 0.1]; }), W.edge, 0.26, 0.7);
  // AO along the bottom edge.
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.4;
  g.strokeStyle = 'rgb(' + MOUNT_SUN.shadowRGB + ')';
  g.lineWidth = 0.5;
  g.beginPath();
  g.moveTo(bottom[0][0], bottom[0][1]);
  for (let i = 1; i < bottom.length; i++) g.lineTo(bottom[i][0], bottom[i][1]);
  g.stroke();
  g.restore();

  // ---- Faction stripe along the cheek ------------------------------------
  // Painted carriage furniture is how a battery is told apart across a table.
  g.strokeStyle = M.side; g.lineWidth = 0.72;
  g.beginPath();
  g.moveTo(23.2, 12.9); g.lineTo(18.6, 15.6); g.lineTo(6.6, 21.9);
  g.stroke();
  g.strokeStyle = M.sideLit; g.lineWidth = 0.24;
  g.beginPath();
  g.moveTo(23.15, 12.7); g.lineTo(18.55, 15.4); g.lineTo(6.55, 21.7);
  g.stroke();

  // ---- Iron strapping bands + bolt heads ---------------------------------
  const bands = [[22.6, 11.9, 22.9, 14.4], [18.9, 13.6, 19.6, 16.6], [12.0, 18.0, 12.6, 20.3], [7.2, 20.9, 7.7, 22.6]];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    g.strokeStyle = I.base; g.lineWidth = 0.62;
    g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[2], b[3]); g.stroke();
    g.strokeStyle = mA(I.edge, 0.8); g.lineWidth = 0.18;
    g.beginPath(); g.moveTo(b[0] - 0.16, b[1] - 0.16); g.lineTo(b[2] - 0.16, b[3] - 0.16); g.stroke();
    g.fillStyle = I.mid;
    g.beginPath(); g.arc((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0.3, 0, MOUNT_TAU); g.fill();
    g.fillStyle = mA(I.edge, 0.85);
    g.beginPath(); g.arc((b[0] + b[2]) / 2 - 0.1, (b[1] + b[3]) / 2 - 0.11, 0.13, 0, MOUNT_TAU); g.fill();
  }

  // ---- Axletree under the cheeks -----------------------------------------
  g.save();
  g.translate(20.4, 16.6);
  g.rotate(-0.52);
  g.fillStyle = W.shade;
  g.fillRect(-3.2, -0.85, 6.4, 1.7);
  g.fillStyle = mA(W.lit, 0.5);
  g.fillRect(-3.2, -0.85, 6.4, 0.42);
  g.fillStyle = mA(W.deep, 0.6);
  g.fillRect(-3.2, 0.4, 6.4, 0.45);
  g.restore();

  // ---- Elevating quoin: the wooden wedge under the breech ----------------
  mPoly(g, [[15.3, 12.7], [19.5, 13.7], [19.4, 15.0], [15.2, 14.4]]);
  g.fillStyle = M.wood.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 17.3, 13.9, 2.4, M.wood);
  g.fillRect(15, 12, 5, 3.5);
  g.restore();
  g.strokeStyle = mA(M.wood.edge, 0.7); g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(15.3, 12.7); g.lineTo(19.5, 13.7); g.stroke();
  // quoin handle
  g.strokeStyle = M.wood.shade; g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(15.2, 13.5); g.lineTo(13.6, 13.9); g.stroke();

  // ---- Trail furniture: lunette ring, handspike socket -------------------
  g.strokeStyle = I.base; g.lineWidth = 0.42;
  g.beginPath(); g.arc(4.5, 22.5, 0.85, 0, MOUNT_TAU); g.stroke();
  g.strokeStyle = mA(I.edge, 0.75); g.lineWidth = 0.16;
  g.beginPath(); g.arc(4.42, 22.4, 0.85, Math.PI * 0.95, Math.PI * 1.65); g.stroke();
  g.fillStyle = I.mid;
  g.fillRect(5.0, 21.6, 1.5, 1.4);
  g.fillStyle = mA(I.edge, 0.6);
  g.fillRect(5.0, 21.6, 1.5, 0.32);
}

/**
 * A gun crewman: same shading language as the infantry lineage (black-lined,
 * basecoat, shade wash, drybrush, single-sided edge light) but posed working
 * the piece. `role` selects the pose.
 */
function mCrewman(g, M, x, role, flip, dim) {
  const k = dim === undefined ? 0 : dim;
  const coat = k > 0 ? mFar(M.coat, k) : M.coat;
  const trim = k > 0 ? mFar(M.trim, k) : M.trim;
  const skin = k > 0 ? mFar(M.skin, k) : M.skin;
  const hat = k > 0 ? mFar(M.hat, k) : M.hat;
  const buff = k > 0 ? mFar(M.buff, k) : M.buff;
  const wood = k > 0 ? mFar(M.wood, k) : M.wood;
  const steel = k > 0 ? mFar(M.steel, k) : M.steel;
  const leather = k > 0 ? mFar(M.leather, k) : M.leather;

  g.save();
  g.translate(x, 0);
  // A mirrored figure mirrors its own shading with it. Invert the sun's X for
  // the duration so this crewman is still lit from up-LEFT in world space.
  const prevFlip = MOUNT_FLIP;
  if (flip) { g.scale(-1, 1); MOUNT_FLIP = -prevFlip; }
  // Mirror hand-authored "up-left boundary" x-coordinates to match.
  const ex = function (v) { return MOUNT_FLIP < 0 ? -v : v; };

  // ---- Legs: braced, with boot flare -------------------------------------
  let legA, legB;
  if (role === 'handspike') { legA = [[-0.2, 15.6], [0.9, 19.4], [1.5, 22.9]]; legB = [[-0.8, 15.6], [-1.8, 19.2], [-2.6, 22.9]]; }
  else if (role === 'brace') { legA = [[-0.1, 15.6], [1.3, 19.2], [2.2, 22.9]]; legB = [[-0.9, 15.6], [-2.0, 19.3], [-2.8, 22.9]]; }
  else { legA = [[0.1, 15.6], [0.6, 19.4], [0.9, 22.9]]; legB = [[-0.9, 15.6], [-1.3, 19.3], [-1.6, 22.9]]; }

  mLimb(g, legB, [1.05, 0.82, 0.72], mFar(leather, 0.25).shade);
  mLimb(g, legA, [1.1, 0.86, 0.74], leather.base);
  g.save();
  mLimbPath(g, legA, [1.1, 0.86, 0.74]);
  g.clip();
  g.fillStyle = mCylGrad(g, legA[0][0], legA[0][1], legA[2][0], legA[2][1], 1.2, leather);
  g.fillRect(-4, 14, 8, 10);
  g.restore();
  // breeches
  g.save();
  mLimbPath(g, [legA[0], legA[1]], [1.1, 0.86]);
  g.clip();
  g.fillStyle = buff.base;
  g.fillRect(-4, 14.5, 8, 3.2);
  g.restore();
  // boots on the ground
  for (const L of [legB, legA]) {
    const e = L[2];
    mPoly(g, [[e[0] - 0.85, e[1] - 0.4], [e[0] + 1.1, e[1] - 0.4], [e[0] + 1.2, e[1] + 0.45], [e[0] - 0.95, e[1] + 0.45]]);
    g.fillStyle = leather.mid; g.fill();
    g.fillStyle = mA(leather.edge, 0.5);
    g.fillRect(e[0] - 0.85, e[1] - 0.4, 2.0, 0.22);
  }

  // ---- Coat --------------------------------------------------------------
  const body = [[1.85, 8.4], [2.1, 12.6], [2.5, 15.9], [-2.5, 15.9], [-2.1, 12.6], [-1.85, 8.4], [-0.9, 7.5], [0.9, 7.5]];
  mPoly(g, body);
  g.fillStyle = coat.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mFormGrad(g, 0, 11.6, 3.4, coat);
  g.fillRect(-3, 7, 6, 10);
  mMuscle(g, -0.4, 10.0, 1.6, 2.2, -0.2, coat.lit, 0.26);
  g.fillStyle = mA(coat.deep, 0.28);
  g.fillRect(-3, 14.4, 6, 1.6);
  g.restore();
  // skirt flare edge — an edge light, so it belongs on the up-left boundary in
  // WORLD space. ex() flips the authored x for the mirrored crewman; without
  // it this landed on the near crewman's down-right side, lighting him from
  // the opposite quarter to everything else in the frame.
  g.strokeStyle = mA(coat.edge, 0.5); g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(ex(-2.35), 14.2); g.lineTo(ex(-1.9), 12.0); g.stroke();
  // lapel + cuffs in trim
  mPoly(g, [[1.75, 8.5], [2.05, 12.2], [1.05, 12.1], [0.95, 8.4]]);
  g.fillStyle = trim.base; g.fill();
  g.fillStyle = mA(trim.lit, 0.6);
  g.fillRect(1.0, 8.5, 0.34, 3.4);
  // crossbelts
  g.strokeStyle = buff.base; g.lineWidth = 0.68;
  g.beginPath(); g.moveTo(-1.5, 8.5); g.lineTo(1.9, 13.4); g.stroke();
  // Belt highlight: the base strap offset toward the light. The x component of
  // that offset has to flip with the figure (see the skirt edge above), or the
  // near crewman's crossbelt catches the sun on its down-right face.
  const beltEx = ex(-0.18);
  g.strokeStyle = mA(buff.edge, 0.8); g.lineWidth = 0.2;
  g.beginPath(); g.moveTo(-1.5 + beltEx, 8.6); g.lineTo(1.9 + beltEx, 13.5); g.stroke();
  // faction shoulder knot
  g.fillStyle = M.side;
  mPoly(g, [[-1.9, 8.2], [-0.5, 7.9], [-0.35, 8.8], [-1.85, 9.1]]); g.fill();
  g.fillStyle = M.sideLit;
  g.fillRect(-1.85, 8.15, 1.35, 0.26);

  // ---- Arms by role ------------------------------------------------------
  if (role === 'handspike') {
    // Both hands on the handspike, weight forward — the trail man traversing.
    mLimb(g, [[1.4, 8.8], [2.8, 10.8], [3.9, 12.2]], [0.9, 0.72, 0.58], coat.base);
    mLimb(g, [[-1.3, 8.9], [0.4, 11.4], [2.6, 12.6]], [0.86, 0.68, 0.55], mFar(coat, 0.28).base);
    // handspike: a heavy tapered lever, iron-shod
    mLimb(g, [[5.9, 9.4], [2.4, 12.9], [-0.6, 16.3]], [0.44, 0.6, 0.74], wood.base);
    g.save();
    mLimbPath(g, [[5.9, 9.4], [2.4, 12.9], [-0.6, 16.3]], [0.44, 0.6, 0.74]);
    g.clip();
    g.fillStyle = mCylGrad(g, 5.9, 9.4, -0.6, 16.3, 0.8, wood);
    g.fillRect(-2, 8, 9, 10);
    g.restore();
    g.strokeStyle = steel.base; g.lineWidth = 0.5;
    g.beginPath(); g.moveTo(5.9, 9.4); g.lineTo(4.9, 10.4); g.stroke();
    g.fillStyle = skin.base;
    g.beginPath(); g.arc(4.0, 12.3, 0.66, 0, MOUNT_TAU); g.fill();
    g.beginPath(); g.arc(2.7, 12.7, 0.62, 0, MOUNT_TAU); g.fill();
    g.fillStyle = mA(skin.lit, 0.75);
    g.beginPath(); g.arc(3.85, 12.15, 0.34, 0, MOUNT_TAU); g.fill();
  } else if (role === 'rammer') {
    // Sponge/rammer staff held vertical, No.1 standing clear of the muzzle.
    mLimb(g, [[1.4, 8.7], [2.6, 10.6], [2.9, 12.4]], [0.9, 0.72, 0.58], coat.base);
    mLimb(g, [[-1.3, 8.8], [-2.2, 10.8], [-2.0, 12.6]], [0.86, 0.68, 0.55], mFar(coat, 0.28).base);
    mLimb(g, [[2.7, 4.0], [2.9, 13.0], [3.0, 20.6]], [0.34, 0.4, 0.34], wood.base);
    g.save();
    mLimbPath(g, [[2.7, 4.0], [2.9, 13.0], [3.0, 20.6]], [0.34, 0.4, 0.34]);
    g.clip();
    g.fillStyle = mCylGrad(g, 2.7, 4.0, 3.0, 20.6, 0.5, wood);
    g.fillRect(1.5, 3, 3, 19);
    g.restore();
    // sponge head
    g.fillStyle = M.buff.base;
    g.beginPath(); g.ellipse(2.72, 3.4, 0.78, 1.25, 0, 0, MOUNT_TAU); g.fill();
    g.fillStyle = mA(M.buff.lit, 0.7);
    g.beginPath(); g.ellipse(2.5, 3.0, 0.4, 0.75, 0, 0, MOUNT_TAU); g.fill();
    g.fillStyle = skin.base;
    g.beginPath(); g.arc(2.95, 12.6, 0.62, 0, MOUNT_TAU); g.fill();
    g.beginPath(); g.arc(-2.0, 12.7, 0.6, 0, MOUNT_TAU); g.fill();
  } else {
    // 'brace': the instant of firing — turned away, arm up, linstock extended.
    mLimb(g, [[1.4, 8.6], [3.2, 7.4], [4.4, 5.9]], [0.9, 0.72, 0.58], coat.base);
    mLimb(g, [[-1.3, 8.8], [-2.6, 10.4], [-3.4, 12.0]], [0.86, 0.68, 0.55], mFar(coat, 0.28).base);
    mLimb(g, [[5.4, 5.2], [2.0, 8.6], [-1.0, 12.0]], [0.28, 0.34, 0.3], wood.base);
    g.fillStyle = skin.base;
    g.beginPath(); g.arc(4.55, 5.8, 0.64, 0, MOUNT_TAU); g.fill();
    g.beginPath(); g.arc(-3.5, 12.1, 0.6, 0, MOUNT_TAU); g.fill();
    g.fillStyle = mA(skin.lit, 0.75);
    g.beginPath(); g.arc(4.4, 5.65, 0.32, 0, MOUNT_TAU); g.fill();
  }

  // ---- Head + hat --------------------------------------------------------
  const hy = 5.9;
  g.fillStyle = skin.base;
  g.beginPath(); g.ellipse(0.2, hy, 1.5, 1.62, 0.05, 0, MOUNT_TAU); g.fill();
  g.save();
  g.beginPath(); g.ellipse(0.2, hy, 1.5, 1.62, 0.05, 0, MOUNT_TAU); g.clip();
  g.fillStyle = mFormGrad(g, 0.2, hy, 1.7, skin);
  g.fillRect(-2, hy - 2, 4, 4);
  g.restore();
  g.fillStyle = mA(skin.shade, 0.5);
  g.beginPath(); g.ellipse(0.3, hy - 0.65, 1.25, 0.45, 0, 0, MOUNT_TAU); g.fill();
  g.fillStyle = '#191410';
  g.beginPath(); g.arc(0.95, hy - 0.1, 0.2, 0, MOUNT_TAU); g.fill();
  mLimb(g, [[-1.2, hy + 0.3], [-1.9, hy + 1.3], [-2.1, hy + 2.1]], [0.55, 0.4, 0.14], M.hair.base);

  if (M.headgear === 'turban') {
    for (let i = 0; i < 3; i++) {
      const yy = hy - 1.45 - i * 0.66;
      const rx = 1.78 - i * 0.22;
      g.fillStyle = M.white.base;
      g.beginPath(); g.ellipse(0.2, yy, rx, 0.56, -0.05, 0, MOUNT_TAU); g.fill();
      g.fillStyle = mA(M.white.lit, 0.72);
      g.beginPath(); g.ellipse(0.2 + mSunX() * 0.32, yy + MOUNT_SUN.y * 0.2, rx * 0.6, 0.23, -0.05, 0, MOUNT_TAU); g.fill();
      g.fillStyle = mA(M.white.shade, 0.45);
      g.beginPath(); g.ellipse(0.7, yy + 0.3, rx * 0.7, 0.18, -0.05, 0, MOUNT_TAU); g.fill();
    }
  } else {
    g.fillStyle = hat.base;
    mPoly(g, [
      [-2.35, hy - 1.25], [-1.35, hy - 2.2], [0.15, hy - 2.7],
      [1.75, hy - 2.3], [2.35, hy - 1.35], [1.75, hy - 0.85],
      [0.15, hy - 1.4], [-1.55, hy - 0.8],
    ]);
    g.fill();
    g.save(); g.clip();
    g.fillStyle = mFormGrad(g, 0.15, hy - 1.8, 2.4, hat);
    g.fillRect(-2.6, hy - 3, 5.2, 2.8);
    g.restore();
    g.fillStyle = hat.mid;
    g.beginPath(); g.ellipse(0.15, hy - 1.8, 1.15, 0.78, 0, 0, MOUNT_TAU); g.fill();
    mEdgeLight(g, [[ex(-2.3), hy - 1.3], [ex(-1.3), hy - 2.15], [ex(0.15), hy - 2.6], [ex(1.6), hy - 2.25]], hat.edge, 0.24, 0.85);
    g.strokeStyle = mA(trim.base, 0.7); g.lineWidth = 0.2;
    g.beginPath();
    g.moveTo(-2.2, hy - 1.2); g.lineTo(-1.3, hy - 2.0);
    g.lineTo(0.15, hy - 2.5); g.lineTo(1.6, hy - 2.15);
    g.stroke();
    g.fillStyle = M.side;
    g.beginPath(); g.arc(1.25, hy - 1.9, 0.42, 0, MOUNT_TAU); g.fill();
    g.fillStyle = M.sideLit;
    g.beginPath(); g.arc(1.15, hy - 2.0, 0.2, 0, MOUNT_TAU); g.fill();
  }

  MOUNT_FLIP = prevFlip;
  g.restore();
}

/** Ground clutter: shot pile, water bucket, linstock — a served gun position. */
function mGunClutter(g, M) {
  const iron = M.iron, wood = M.wood;

  // Round shot, stacked. Small, dark, unmistakable.
  const shots = [[12.4, 22.5], [13.7, 22.7], [15.0, 22.5], [13.05, 21.5], [14.35, 21.4]];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    g.fillStyle = iron.base;
    g.beginPath(); g.arc(s[0], s[1], 0.86, 0, MOUNT_TAU); g.fill();
    g.save();
    g.beginPath(); g.arc(s[0], s[1], 0.86, 0, MOUNT_TAU); g.clip();
    g.fillStyle = mBlobGrad(g, s[0] + MOUNT_SUN.x * 0.5, s[1] + MOUNT_SUN.y * 0.5, 1.3, iron.edge, 0.7, 0);
    g.fillRect(s[0] - 1, s[1] - 1, 2, 2);
    g.fillStyle = mA(iron.deep, 0.5);
    g.beginPath(); g.arc(s[0] - MOUNT_SUN.x * 0.7, s[1] - MOUNT_SUN.y * 0.7, 0.55, 0, MOUNT_TAU); g.fill();
    g.restore();
  }

  // Water bucket for the sponge.
  mPoly(g, [[9.0, 20.5], [11.1, 20.5], [10.8, 23.1], [9.3, 23.1]]);
  g.fillStyle = wood.base; g.fill();
  g.save(); g.clip();
  g.fillStyle = mCylGrad(g, 10.05, 20.5, 10.05, 23.1, 1.2, wood);
  g.fillRect(8.5, 20, 3, 3.5);
  g.restore();
  g.strokeStyle = iron.base; g.lineWidth = 0.28;
  g.beginPath(); g.moveTo(9.05, 21.2); g.lineTo(11.03, 21.2); g.stroke();
  g.beginPath(); g.moveTo(9.22, 22.4); g.lineTo(10.87, 22.4); g.stroke();
  g.strokeStyle = mA(iron.edge, 0.7); g.lineWidth = 0.12;
  g.beginPath(); g.moveTo(9.05, 21.1); g.lineTo(11.03, 21.1); g.stroke();
  g.fillStyle = mA('#2A3038', 0.55);
  g.beginPath(); g.ellipse(10.05, 20.55, 1.05, 0.3, 0, 0, MOUNT_TAU); g.fill();
  g.fillStyle = mA('#8FA4C4', 0.35);
  g.beginPath(); g.ellipse(9.8, 20.48, 0.5, 0.14, 0, 0, MOUNT_TAU); g.fill();
}

/**
 * MAIN CANNON PAINTER.
 *   g    — frame context, scaled to sprite units by frameCanvas()
 *   nat  — NATIONS[key]
 *   pose — 'idle' | 'fire'
 *   side — OPTIONAL 0/1. Enables baked faction colour. Safe to omit.
 */
function drawCannon(g, nat, pose, side) {
  // Centre the authored geometry in the widened box (see MOUNT_GUN_OX).
  g.translate(MOUNT_GUN_OX, 0);

  const M = mMaterials(nat, side);
  const firing = pose === 'fire';

  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Recoil: the whole piece has run back and the muzzle has jumped.
  const rx = firing ? -2.5 : 0;
  const ry = firing ? -0.35 : 0;
  const elev = firing ? -0.055 : 0;
  const wheelRot = firing ? 0.30 : 0.0;

  // ---- Far-side crewman, behind everything -------------------------------
  mCrewman(g, M, 27.6, firing ? 'brace' : 'rammer', false, 0.34);

  // ---- Ground clutter -----------------------------------------------------
  mGunClutter(g, M);

  // ---- Far wheel ----------------------------------------------------------
  g.save();
  g.translate(rx * 0.9, ry * 0.9);
  mPaintWheel(g, MOUNT_C.wheelFar[0], MOUNT_C.wheelFar[1], MOUNT_C.wheelFar[2],
    M.carriage, M.iron, M.brass, 14, 0.11 + wheelRot, 0.36);
  g.restore();

  // ---- Piece: carriage + barrel, moved together by recoil ----------------
  g.save();
  g.translate(rx, ry);

  mPaintCarriage(g, M, side);

  // Barrel, pivoting about the trunnion when it jumps.
  g.save();
  g.translate(MOUNT_C.trunnion[0], MOUNT_C.trunnion[1]);
  g.rotate(elev);
  g.translate(-MOUNT_C.trunnion[0], -MOUNT_C.trunnion[1]);
  mPaintBarrel(g, M, MOUNT_C.breech[0], MOUNT_C.breech[1], MOUNT_C.muzzle[0], MOUNT_C.muzzle[1]);
  g.restore();

  // Trunnion + capsquare: the iron strap that clamps the gun to the carriage.
  const tx = MOUNT_C.trunnion[0], ty = MOUNT_C.trunnion[1];
  g.fillStyle = M.bronze.mid;
  g.beginPath(); g.arc(tx, ty, 1.15, 0, MOUNT_TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(tx, ty, 1.15, 0, MOUNT_TAU); g.clip();
  g.fillStyle = mBlobGrad(g, tx + MOUNT_SUN.x * 0.6, ty + MOUNT_SUN.y * 0.6, 1.7, M.bronze.edge, 0.8, 0);
  g.fillRect(tx - 1.3, ty - 1.3, 2.6, 2.6);
  g.fillStyle = mA(M.bronze.deep, 0.5);
  g.beginPath(); g.arc(tx - MOUNT_SUN.x * 0.8, ty - MOUNT_SUN.y * 0.8, 0.62, 0, MOUNT_TAU); g.fill();
  g.restore();
  g.strokeStyle = M.iron.base; g.lineWidth = 0.52;
  g.beginPath(); g.arc(tx, ty, 1.5, Math.PI * 1.06, Math.PI * 1.98); g.stroke();
  g.strokeStyle = mA(M.iron.edge, 0.75); g.lineWidth = 0.18;
  g.beginPath(); g.arc(tx - 0.08, ty - 0.1, 1.5, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
  g.fillStyle = M.iron.mid;
  g.fillRect(tx - 1.85, ty - 0.4, 0.55, 1.1);
  g.fillRect(tx + 1.3, ty - 0.5, 0.55, 1.0);

  g.restore();

  // ---- Near wheel, in front of the carriage ------------------------------
  g.save();
  g.translate(rx, ry);
  mPaintWheel(g, MOUNT_C.wheelNear[0], MOUNT_C.wheelNear[1], MOUNT_C.wheelNear[2],
    M.carriage, M.iron, M.brass, 14, wheelRot, 0);
  g.restore();

  // ---- Near crewman at the trail -----------------------------------------
  mCrewman(g, M, 7.3, firing ? 'brace' : 'handspike', true, 0);

  // ---- Whole-figure passes + lining --------------------------------------
  // Tinted from the carriage rather than the coat: a gun is mostly painted
  // timber and bronze, so a coat-tinted outline would read as belonging to the
  // two crewmen rather than to the piece.
  mFinishFigure(g, { tint: M.carriage.line });

  // ---- Baked contact shadows (underneath everything) ---------------------
  // A long shadow under the whole piece, plus tighter pools under each wheel
  // and the trail, so the gun reads as several objects resting on one board.
  mContactShadow(g, 19.0, MOUNT_GY + 0.3, 11.2, 2.4, 0.85, M.sideIdx);
  mContactShadow(g, MOUNT_C.wheelNear[0] + rx, MOUNT_GY + 0.15, 3.0, 1.15, 1.0, -1);
  mContactShadow(g, 6.0, MOUNT_GY - 0.5, 3.2, 1.1, 0.8, -1);
  mContactShadow(g, 7.3, MOUNT_GY + 0.2, 2.6, 1.0, 0.9, -1);
  mContactShadow(g, 27.6, MOUNT_GY - 0.6, 2.4, 0.95, 0.7, -1);

  // ---- Muzzle blast staging (post-lining: must not get a black outline) --
  if (firing) {
    const bx = MOUNT_C.muzzle[0] + rx + 0.9;
    const by = MOUNT_C.muzzle[1] + ry - 0.15;
    let ax = MOUNT_C.muzzle[0] - MOUNT_C.breech[0], ay = MOUNT_C.muzzle[1] - MOUNT_C.breech[1];
    const al = Math.hypot(ax, ay) || 1;
    ax /= al; ay /= al;
    // barrel jump rotates the blast axis too
    const ca = Math.cos(elev), sa = Math.sin(elev);
    const dx = ax * ca - ay * sa, dy = ax * sa + ay * ca;
    mMuzzleBlast(g, bx, by, dx, dy);
  }
}

/** Cone of flame, sparks, powder smoke and a warm ground bounce. */
function mMuzzleBlast(g, x, y, dx, dy) {
  const nx = -dy, ny = dx;
  const ang = Math.atan2(dy, dx);

  // --- 1. Powder smoke first, so the flame sits inside it -----------------
  g.save();
  const rngS = mRng(0x5A0C0E);
  for (let i = 0; i < 7; i++) {
    const t = 0.15 + rngS() * 0.95;
    const off = (rngS() - 0.5) * 3.6;
    const cx = x + dx * t * 5.6 + nx * off;
    const cy = y + dy * t * 5.6 + ny * off - t * 0.9;
    const r = 1.3 + rngS() * 2.1;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, 'rgba(246,242,231,0.30)');
    grd.addColorStop(0.5, 'rgba(212,208,196,0.16)');
    grd.addColorStop(1, 'rgba(198,196,188,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, r, 0, MOUNT_TAU); g.fill();
    // cool underside, obeying the one sun
    const ug = g.createRadialGradient(cx + 0.5, cy + 0.7, 0, cx + 0.5, cy + 0.7, r * 0.8);
    ug.addColorStop(0, 'rgba(122,130,152,0.13)');
    ug.addColorStop(1, 'rgba(122,130,152,0)');
    g.fillStyle = ug;
    g.beginPath(); g.arc(cx + 0.5, cy + 0.7, r * 0.8, 0, MOUNT_TAU); g.fill();
  }
  g.restore();

  // --- 2. Flame, additive so overlapping volleys bloom --------------------
  g.save();
  g.globalCompositeOperation = 'lighter';

  // outer glow
  const glow = g.createRadialGradient(x + dx * 1.6, y + dy * 1.6, 0, x + dx * 1.6, y + dy * 1.6, 4.6);
  glow.addColorStop(0, 'rgba(255,206,120,0.42)');
  glow.addColorStop(0.45, 'rgba(255,150,50,0.18)');
  glow.addColorStop(1, 'rgba(180,60,10,0)');
  g.fillStyle = glow;
  g.beginPath(); g.arc(x + dx * 1.6, y + dy * 1.6, 4.6, 0, MOUNT_TAU); g.fill();

  // the cone: 34 degrees of spread over ~6 units
  const spread = Math.tan(0.297);
  const len = 6.4;
  g.beginPath();
  g.moveTo(x + nx * 0.6, y + ny * 0.6);
  g.quadraticCurveTo(
    x + dx * len * 0.55 + nx * len * spread * 0.9,
    y + dy * len * 0.55 + ny * len * spread * 0.9,
    x + dx * len + nx * len * spread * 0.35,
    y + dy * len + ny * len * spread * 0.35);
  g.lineTo(x + dx * len * 1.18, y + dy * len * 1.18);
  g.lineTo(x + dx * len - nx * len * spread * 0.35, y + dy * len - ny * len * spread * 0.35);
  g.quadraticCurveTo(
    x + dx * len * 0.55 - nx * len * spread * 0.9,
    y + dy * len * 0.55 - ny * len * spread * 0.9,
    x - nx * 0.6, y - ny * 0.6);
  g.closePath();
  const cone = g.createLinearGradient(x, y, x + dx * len * 1.1, y + dy * len * 1.1);
  cone.addColorStop(0.00, 'rgba(255,253,242,0.95)');
  cone.addColorStop(0.30, 'rgba(255,213,122,0.80)');
  cone.addColorStop(0.62, 'rgba(255,138,34,0.42)');
  cone.addColorStop(1.00, 'rgba(180,60,10,0)');
  g.fillStyle = cone;
  g.fill();

  // hot core at the muzzle
  const core = g.createRadialGradient(x + dx * 0.5, y + dy * 0.5, 0, x + dx * 0.5, y + dy * 0.5, 1.7);
  core.addColorStop(0, 'rgba(255,255,250,0.95)');
  core.addColorStop(0.55, 'rgba(255,232,168,0.55)');
  core.addColorStop(1, 'rgba(255,180,60,0)');
  g.fillStyle = core;
  g.beginPath(); g.arc(x + dx * 0.5, y + dy * 0.5, 1.7, 0, MOUNT_TAU); g.fill();

  // spark streaks along the axis
  const rng = mRng(0x5A0C1F);
  g.lineWidth = 0.2;
  g.strokeStyle = 'rgba(255,226,160,0.75)';
  for (let i = 0; i < 9; i++) {
    const a = ang + (rng() - 0.5) * 1.05;
    const l = 2.0 + rng() * 5.0;
    const s = 0.8 + rng() * 1.4;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
    g.lineTo(x + Math.cos(a) * (s + l), y + Math.sin(a) * (s + l));
    g.stroke();
  }

  // warm bounce on the ground under the muzzle: the flash lights the board
  const gy = MOUNT_GY;
  const bg = g.createRadialGradient(x + dx * 2.5, gy, 0, x + dx * 2.5, gy, 6.5);
  bg.addColorStop(0, 'rgba(255,196,110,0.20)');
  bg.addColorStop(1, 'rgba(255,150,60,0)');
  g.save();
  g.translate(x + dx * 2.5, gy);
  g.scale(1, 0.30);
  g.translate(-(x + dx * 2.5), -gy);
  g.fillStyle = bg;
  g.beginPath(); g.arc(x + dx * 2.5, gy, 6.5, 0, MOUNT_TAU); g.fill();
  g.restore();

  g.restore();
}
export { drawCavalry, drawCannon };
