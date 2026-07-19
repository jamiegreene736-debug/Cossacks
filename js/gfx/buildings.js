// Settlement art: buildings, foundations, farms and resource nodes as
// painted terrain pieces on the same board the troops stand on.
// Building stamps are baked once per (type|side|nation|variant) and then
// blitted, so the runtime cost is one drawImage per building. Foundations
// stay immediate-mode because construction progress is continuous and
// baking would quantise the one value the art exists to show.
import { BUILDING_TYPES, NATIONS } from '../config.js';

let ctx = null;
let camera = { zoom: 1 };
function setBuildingRefs(refs) {
  if (refs.ctx) ctx = refs.ctx;
  if (refs.camera) camera = refs.camera;
}

/* ============================================================================
   COSSACKS: LINE OF FIRE  —  SETTLEMENT PAINTER
   Subsystem: drawResourceNode / drawFarm / drawFoundation /
              drawCompleteBuilding / drawBuilding
   Direction: KRIEGSSPIEL TABLE — painted terrain pieces on a modelled board
              under one warm gallery photoflood, up and to the left.

   THE ONE IDEA: a building is a scenery piece on the same diorama board the
   troops stand on. Same lamp, same acrylic ramp, same material-tinted lining,
   same cool-violet contact shadow. If the men are painted miniatures and the
   ground is flocked board, a town centre cannot be four flat fillRects.

   PERFORMANCE DECISION — BAKE, DO NOT DRAW LIVE. Reasoning in full at
   section 8; the short version is that these painters cost 400-900 canvas ops
   each and construct gradients, so running them per building per frame would
   put ~40,000 ops and hundreds of gradient allocations into draw(). Baking
   also buys the 8-way lining dilation and the whole-piece light passes, which
   are simply not expressible in immediate mode. Cache keys are exact, the
   caches are lazy, and the runtime path becomes ONE drawImage per building.

   All helpers are prefixed `bd` so this fragment can be spliced into
   render.js alongside the infantry / terrain painters without collision.
   ========================================================================== */


/* ---------------------------------------------------------------------------
   0. THE ONE SUN + THE PALETTE
   Values copied verbatim from terrain.js so a building is lit by exactly the
   lamp that lit the ground it stands on. Nothing here invents a light.
   ------------------------------------------------------------------------ */

// Bake oversampling. The settlement is the player's visual reward for growing
// an economy, so it gets the same 4x source density as the miniature atlas.
// At input.js's 2.5x zoom ceiling and a 2x display, this retains the 0.45-0.8
// world-pixel joints, nails, leadwork and patina marks instead of smearing them
// through a 2.5x bitmap upscale. A lazy cache keeps the practical footprint
// bounded: only placed building types are baked, while damage and mill frames
// appear on demand. A town-centre surface is about 3 MB and a normal settlement
// remains comfortably below a modern browser's graphics-memory budget.
// Resource nodes use 3x because their organic silhouettes contain many fine
// twigs, ore veins, berry highlights and cut-stump rings.
const BD_SCALE     = 4;
const BD_RES_SCALE = 3;
const BD_MILL_FRAMES = 8;

const bdSUN = {
  x: -0.64, y: -0.77,             // unit vector TOWARD the light (up-left)
  elevDeg: 38,
  shadow: { x: 0.64, y: 0.77 },   // direction shadows fall (down-right)
  lenMul: 0.55,                   // shadow offset = objectHeight * lenMul
  squash: 0.42,                   // shadow ellipse ry / rx
  key: '#FFF1CE',                 // warm photoflood
  fill: '#8FA4C4',                // cool room bounce
  bounce: '#B9A277',              // warm kick off the board
  shadowRGB: '26,30,48',          // cool violet — never pure black
};

// THE PAINTED BASE RIM colours. A building does not stand on a base, so the
// side colour is carried on banners, pennants, door lintels and a side-tinted
// trodden apron at the footing instead. Same two hues as the unit bases, so
// field and minimap agree.
const BD_SIDE = [
  { rim: '#3E78B8', lit: '#6FA3DC' },   // side 0 — Prussian blue
  { rim: '#B8483E', lit: '#DC7A6F' },   // side 1 — oxide red
];

// Board palette, from terrain.js. PALETTE LAW: nothing painted onto the ground
// plane (aprons, spoil heaps, farm soil, scree) exceeds 27% HSL saturation.
const BT = {
  TURF_DEEP:    '#39422B',
  TURF_SHADE:   '#4B5535',
  TURF_MID:     '#77804A',
  TURF_LIT:     '#98A25C',
  STRAW:        '#BFA867',
  STRAW_LIGHT:  '#D6C48C',
  EARTH:        '#7A5F3E',
  EARTH_LIGHT:  '#A08059',
  EARTH_DARK:   '#4A3826',
  MUD:          '#634E33',
  ROAD_BED:     '#8A7350',
  SCRUB_COOL:   '#5E6E5C',
  ROCK:         '#8A8578',
  ROCK_LIGHT:   '#B5B0A0',
  ROCK_DARK:    '#57544B',
  FOLIAGE_DEEP: '#25331F',
  FOLIAGE_BASE: '#37492C',
  FOLIAGE_LIT:  '#576B37',
  FOLIAGE_EDGE: '#7E8F46',
  TRUNK:        '#4A3B2C',
  TRUNK_LIT:    '#6E5940',
  TRUNK_DARK:   '#2B2118',
};

// Building materials. Timber-framed plaster, thatch, tile, quarried stone —
// the vernacular a 1:72 European board is modelled in.
const BMAT = {
  PLASTER:     '#C6BCA2',   // limewashed daub panel
  PLASTER_WARM:'#CFC2A0',
  TIMBER:      '#5E4A34',   // oak framing, weathered
  TIMBER_DARK: '#3E3122',
  LOG:         '#7A6144',   // stacked-log walling (lumber camp)
  THATCH:      '#B39A5E',   // straw thatch
  THATCH_OLD:  '#8E7A4A',
  TILE:        '#8A5A46',   // clay pantile
  SLATE:       '#5A6068',   // slate / lead
  SHINGLE:     '#6B5942',   // split wooden shingle
  STONE:       '#9A9384',   // dressed ashlar
  STONE_ROUGH: '#867E70',   // rubble footing
  BRICK:       '#8C5642',   // chimney and furnace stack
  BRICK_RED:   '#9B5544',   // Georgian colonial red brick
  CLAPBOARD:   '#D2C8AE',   // painted colonial weatherboard
  LIMESTONE:   '#C0B9A8',   // columns, quoins, sills and civic trim
  DOOR:        '#4A3A28',
  GLASS:       '#3A4650',   // small leaded panes
  IRON:        '#4E535A',
  FORGE:       '#E07A2A',   // furnace glow — the one saturated non-team colour
  CANVAS:      '#C9BFA4',
};

const BD_TAU = 6.2831853;


/* ---------------------------------------------------------------------------
   1. COLOUR ARITHMETIC — the acrylic ramp, identical to terrain.js's
   ------------------------------------------------------------------------ */

function bdClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function bdRGB(hex) {
  const s = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(s, 16);
  if (s.length === 3) {
    return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17];
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bdHex(r, g, b) {
  const ri = bdClamp(Math.round(r), 0, 255);
  const gi = bdClamp(Math.round(g), 0, 255);
  const bi = bdClamp(Math.round(b), 0, 255);
  return '#' + (0x1000000 + (ri << 16) + (gi << 8) + bi).toString(16).slice(1);
}

function bdMix(a, b, t) {
  const A = bdRGB(a), B = bdRGB(b);
  return bdHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

function bdRgba(hex, a) {
  const c = bdRGB(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

function bdShadow(a) { return 'rgba(' + bdSUN.shadowRGB + ',' + a + ')'; }

function bdRelLum(hex) {
  const c = bdRGB(hex);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Force-clamp the lining below relative luminance 58. A fixed blend fraction
 * gives a lining whose contrast varies with the input colour; the clamp is the
 * actual guarantee that ANY material — including a very dark slate roof or a
 * near-white limewash — still yields a legible painted outline.
 */
function bdClampDark(hex, maxLum) {
  const L = bdRelLum(hex);
  if (L <= maxLum) return hex;
  const c = bdRGB(hex), k = maxLum / Math.max(1, L);
  return bdHex(c[0] * k, c[1] * k, c[2] * k);
}

/** The five-value acrylic ramp expanded from a single basecoat. */
function bdRamp(base) {
  return {
    line:  bdClampDark(bdMix(base, '#14100C', 0.74), 58),
    shade: bdMix(base, '#1B2033', 0.42),
    base:  base,
    lit:   bdMix(base, '#FFE9BC', 0.30),
    edge:  bdMix(base, '#FFF6DE', 0.60),
  };
}

function bdRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function bdHue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function bdHslToHex(h, s, l) {
  h = ((h % 1) + 1) % 1;
  s = bdClamp(s, 0, 1); l = bdClamp(l, 0, 1);
  if (s === 0) return bdHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return bdHex(bdHue2rgb(p, q, h + 1 / 3) * 255, bdHue2rgb(p, q, h) * 255,
    bdHue2rgb(p, q, h - 1 / 3) * 255);
}

function bdShiftHSL(hex, dh, ds, dl) {
  const c = bdRGB(hex);
  const hsl = bdRgbToHsl(c[0], c[1], c[2]);
  return bdHslToHex(hsl[0] + dh, hsl[1] + ds, hsl[2] + dl);
}

/**
 * PALETTE LAW enforcement. Anything painted onto the ground plane — trodden
 * aprons, spoil heaps, farm soil, quarry scree — passes through this. Hue is
 * confined to the earth/straw/turf band and saturation capped at 27%, which is
 * what stops the settlement from competing with the figures for chroma.
 */
function bdLawful(hex) {
  const c = bdRGB(hex);
  const hsl = bdRgbToHsl(c[0], c[1], c[2]);
  const h = bdClamp(hsl[0], 24 / 360, 96 / 360);
  const s = Math.min(hsl[1], 0.27);
  return bdHslToHex(h, s, hsl[2]);
}

/**
 * DETERMINISTIC noise. Every mark on a building must be reproducible: the
 * sprite is baked once and blitted for the building's whole life, but it may
 * be RE-baked when a farm's crop stage or a resource node's depletion step
 * changes. If placement used Math.random() the stones and thatch would visibly
 * reshuffle at each step change. Seeded from the cache key, so they do not.
 */
function bdRnd(seed) {
  let s = (seed | 0) || 1;
  return function (a, b) {
    s = (s * 1664525 + 1013904223) | 0;
    return a + ((s >>> 8) / 16777216) * (b - a);
  };
}


/* ---------------------------------------------------------------------------
   2. LIT-FORM PRIMITIVES
   Every plane in a building obeys one rule: a material-tinted lining
   underneath, a flat BASE fill, a HARD-EDGED shade block occupying the
   down-right region, and a single-sided LIT band on the up-left boundary
   only. Hard edges, never gradients inside a material — graphic clarity is
   the direction, and a gradient inside a wall panel reads as airbrush, not as
   a painted scenery piece.
   ------------------------------------------------------------------------ */

/**
 * THE RIM CONSTRUCTION, borrowed exactly from infantry.js's litPath.
 * Clip to the form, then stroke the SAME outline with a fat pen whose centre
 * has been pushed along the shadow axis (AWAY from the light). On the up-left
 * boundary the displaced pen falls INSIDE the clip and survives; on the
 * down-right boundary it falls outside and is erased. A single-sided highlight
 * is what makes a plane read as lit; a two-sided one reads as an outline.
 */
function bdLitPath(g, pathFn, R, opts) {
  const o = opts || {};

  if (o.line !== false) {
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.lineWidth = o.lineW || 1.2;
    g.strokeStyle = o.lineC || R.line;
    g.beginPath(); pathFn(g); g.stroke();
    g.restore();
  }

  g.beginPath(); pathFn(g);
  g.fillStyle = o.fill || R.base;
  g.fill();

  const b = o.bbox;
  if (b && o.shade !== false) {
    g.save();
    g.beginPath(); pathFn(g); g.clip();
    g.fillStyle = R.shade;
    if (o.shadeA != null) g.globalAlpha = o.shadeA;
    const fx = o.shadeX == null ? 0.66 : o.shadeX;
    const fy = o.shadeY == null ? 0.74 : o.shadeY;
    if (fx < 1) {
      const sx = b[0] + b[2] * fx;
      g.fillRect(sx, b[1] - 2, b[0] + b[2] - sx + 3, b[3] + 4);
    }
    if (fy < 1) {
      const sy = b[1] + b[3] * fy;
      g.fillRect(b[0] - 2, sy, b[2] + 4, b[1] + b[3] - sy + 3);
    }
    g.restore();
  }

  if (o.lit !== false) {
    const wdt = o.litW || 1.4;
    g.save();
    g.beginPath(); pathFn(g); g.clip();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.lineWidth = wdt * 2;
    g.strokeStyle = R.lit;
    g.globalAlpha = o.litA == null ? 1 : o.litA;
    g.translate(bdSUN.shadow.x * wdt, bdSUN.shadow.y * wdt);
    g.beginPath(); pathFn(g); g.stroke();
    g.restore();
  }

  if (o.edge) {
    const wdt = o.edgeW || 0.55;
    g.save();
    g.beginPath(); pathFn(g); g.clip();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.lineWidth = wdt * 2;
    g.strokeStyle = R.edge;
    g.globalAlpha = o.edgeA == null ? 0.9 : o.edgeA;
    g.translate(bdSUN.shadow.x * wdt, bdSUN.shadow.y * wdt);
    g.beginPath(); pathFn(g); g.stroke();
    g.restore();
  }
}

/** Rectangular plane. */
function bdRect(g, x, y, w, h, R, opts) {
  const o = opts || {};
  o.bbox = [x, y, w, h];
  bdLitPath(g, function (c) { c.rect(x, y, w, h); }, R, o);
}

/** Convex polygon plane from a flat [x,y,x,y,...] list. */
function bdPoly(g, pts, R, opts) {
  const o = opts || {};
  if (!o.bbox) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i];
      if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < y0) y0 = pts[i + 1];
      if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    o.bbox = [x0, y0, x1 - x0, y1 - y0];
  }
  bdLitPath(g, function (c) {
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
  }, R, o);
}

/** Elliptical plane — domes, cart wheels, barrel ends, log end-grain. */
function bdEllipse(g, cx, cy, rx, ry, R, opts) {
  const o = opts || {};
  o.bbox = [cx - rx, cy - ry, rx * 2, ry * 2];
  bdLitPath(g, function (c) { c.ellipse(cx, cy, rx, ry, 0, 0, BD_TAU); }, R, o);
}

/**
 * A round-capped structural member — post, rafter, rail, scaffold pole. Takes
 * the sun gradient as a hard two-tone split across its width rather than a
 * true gradient: the sunward half is LIT, the lee half is SHADE.
 */
function bdBeam(g, R, x0, y0, x1, y1, w, opts) {
  const o = opts || {};
  const dx = x1 - x0, dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  if (nx * bdSUN.x + ny * bdSUN.y < 0) { nx = -nx; ny = -ny; }  // sunward normal

  g.save();
  g.lineCap = o.cap || 'round';
  g.lineJoin = 'round';

  // lining
  g.lineWidth = w + 1.6;
  g.strokeStyle = R.line;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();

  // body
  g.lineWidth = w;
  g.strokeStyle = R.base;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();

  // lee half in shade
  g.lineWidth = w * 0.42;
  g.strokeStyle = R.shade;
  const so = w * 0.28;
  g.beginPath();
  g.moveTo(x0 - nx * so, y0 - ny * so);
  g.lineTo(x1 - nx * so, y1 - ny * so);
  g.stroke();

  // sunward edge light
  if (o.edge !== false) {
    g.lineWidth = Math.max(0.35, w * 0.26);
    g.strokeStyle = o.edgeC || R.lit;
    g.globalAlpha = o.edgeA == null ? 0.95 : o.edgeA;
    const eo = w * 0.5 - w * 0.15;
    g.beginPath();
    g.moveTo(x0 + nx * eo, y0 + ny * eo);
    g.lineTo(x1 + nx * eo, y1 + ny * eo);
    g.stroke();
  }
  g.restore();
}

/**
 * Contact shadow — the single construction used by every object on the board,
 * copied from terrain.js. Never a flat-alpha ellipse: always a radial gradient
 * offset along +SUN.shadow, in the cool violet shadow colour, squashed 0.42.
 */
function bdContactShadow(g, x, y, rx, height, strength) {
  const off = height * bdSUN.lenMul;
  const cx = x + bdSUN.shadow.x * off;
  const cy = y + bdSUN.shadow.y * off * 0.55;
  const R = rx * 1.5;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0, bdShadow(0.46 * strength));
  grad.addColorStop(0.55, bdShadow(0.20 * strength));
  grad.addColorStop(1, bdShadow(0));
  g.save();
  g.translate(cx, cy);
  g.scale(1, bdSUN.squash);
  g.translate(-cx, -cy);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, R, 0, BD_TAU);
  g.fill();
  g.restore();
}

/**
 * A HARD cast shadow — the shape of the building's own mass thrown down-right
 * onto the board. The soft radial contact shadow alone reads as a smudge under
 * a 132px object; what makes a building look like it is SITTING on the table
 * is a shadow with the silhouette's actual shape and a defined edge.
 * Skewed along +SUN.shadow and flattened by the 38-degree elevation.
 */
function bdCastShadow(g, pathFn, height) {
  const off = height * bdSUN.lenMul;
  g.save();
  g.globalAlpha = 0.42;
  g.fillStyle = bdShadow(1);
  g.transform(1, 0, bdSUN.shadow.x * 1.15, bdSUN.squash,
    bdSUN.shadow.x * off * 0.35, bdSUN.shadow.y * off * 0.30);
  g.beginPath(); pathFn(g); g.fill();
  g.restore();
}

/**
 * Local ambient occlusion pooled where two forms meet — under an eave, inside
 * a doorway reveal, where a wall meets its footing.
 *
 * NOTE the compositing mode: 'source-atop', not 'multiply'. On a mostly
 * transparent bake canvas a separable blend mode falls back to source-over
 * wherever the backdrop is transparent, so a multiply blob would paint solid
 * darkness into the empty air beside the building — and the lining pass would
 * then bake that darkness in as a permanent ghost halo.
 */
function bdAO(g, cx, cy, rx, ry, a) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, 'rgba(30,26,34,' + a + ')');
  gr.addColorStop(0.55, 'rgba(30,26,34,' + (a * 0.45) + ')');
  gr.addColorStop(1, 'rgba(30,26,34,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, rx, 0, BD_TAU); g.fill();
  g.restore();
}


/* ---------------------------------------------------------------------------
   3. WHOLE-PIECE PASSES
   The three passes that make a stack of independently painted planes read as
   one physical object under one lamp, plus the lining that guarantees the
   piece survives against any board colour. Identical in construction to
   infantry.js's passes, retuned for objects 5-10x larger.
   ------------------------------------------------------------------------ */

function bdSilhouetteOf(src, fill) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const s = c.getContext('2d');
  s.drawImage(src, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = fill;
  s.fillRect(0, 0, c.width, c.height);
  return c;
}

/** PASS A — unifying gallery light, clipped to painted pixels by source-atop. */
function bdPassGalleryLight(g, box) {
  const L = box[2] * Math.abs(bdSUN.shadow.x) + box[3] * Math.abs(bdSUN.shadow.y);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(box[0], box[1],
    box[0] + L * bdSUN.shadow.x, box[1] + L * bdSUN.shadow.y);
  gr.addColorStop(0.00, 'rgba(255,236,190,0.24)');
  gr.addColorStop(0.42, 'rgba(255,236,190,0)');
  gr.addColorStop(0.62, 'rgba(24,20,42,0)');
  gr.addColorStop(1.00, 'rgba(24,20,42,0.30)');
  g.fillStyle = gr;
  g.fillRect(box[0] - 2, box[1] - 2, box[2] + 4, box[3] + 4);
  g.restore();
}

/**
 * PASS B — recess wash. Multiply the piece's own blurred silhouette back over
 * itself so darkness pools in interior crevices: under the eave, between the
 * chimney and the roof, inside the arch.
 *
 * The blur is masked back to the piece with 'destination-in' BEFORE it is
 * composited. Without that mask the blur halo extends past the silhouette, and
 * multiply-over-transparent degenerates to source-over, so the building would
 * acquire a dark smudge ring that the lining pass then bakes in permanently.
 */
function bdPassRecessWash(g, scale) {
  const src = g.canvas;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const s = c.getContext('2d');
  s.filter = 'blur(' + (scale * 1.1).toFixed(2) + 'px)';
  s.drawImage(bdSilhouetteOf(src, '#151322'), 0, 0);
  s.filter = 'none';
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(src, 0, 0);

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.24;
  g.drawImage(c, 0, 0);
  g.restore();
}

/** PASS C — matte varnish. Kills gloss, pulls every material into one family. */
function bdPassMatteVarnish(g, box) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(238,232,214,0.040)';
  g.fillRect(box[0] - 2, box[1] - 2, box[2] + 4, box[3] + 4);
  g.restore();
}

/**
 * PASS D — LINING. An 8-way dilation of the silhouette painted UNDERNEATH the
 * artwork via 'destination-over'. This is what keeps a settlement of eight
 * adjacent buildings reading as eight buildings rather than one beige mass,
 * and it is why baking is not optional — immediate mode cannot express it.
 */
function bdPassLining(g, scale, tintHex) {
  const sil = bdSilhouetteOf(g.canvas, tintHex || '#141118');
  const d = Math.max(1, Math.round(scale * 0.55));
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  const ring = [
    [-d, 0], [d, 0], [0, -d], [0, d],
    [-d, -d], [d, -d], [-d, d], [d, d],
  ];
  for (let i = 0; i < ring.length; i++) g.drawImage(sil, ring[i][0], ring[i][1]);
  // asymmetric second ring along the shadow axis — reads as ambient occlusion
  g.globalAlpha = 0.34;
  const d2 = d * 2.2;
  g.drawImage(sil, Math.round(bdSUN.shadow.x * d2), Math.round(bdSUN.shadow.y * d2));
  g.restore();
}

/**
 * PASS E — the side-tinted trodden apron and the soft ground bed, painted
 * under everything with 'destination-over' so they are not swept into the
 * lining silhouette.
 *
 * The apron is the building's share of the base-rim mechanism: worn earth
 * around the footing, warmed toward oxide red or cooled toward Prussian blue
 * at ~40% chroma, then forced through bdLawful so it obeys the palette law and
 * still reads as ground rather than as a coloured plinth. It is a large,
 * never-occluded block of side colour at the exact point the eye lands.
 */
function bdPassGroundApron(g, cx, cy, rx, sideHex) {
  g.save();
  g.globalCompositeOperation = 'destination-over';

  // ORDER MATTERS AND IS INVERTED HERE. Under 'destination-over' each draw goes
  // BEHIND the previous one, so this block is painted front-to-back: the soft
  // bed shadow first (it must end up ON TOP of the trodden earth, because a
  // shadow falls onto ground), then the clods and the lit crescent, then the
  // apron body last so it sits underneath its own detail. Painting these in
  // reading order — as the obvious version does — buries the contact shadow and
  // the clods beneath a 78%-opaque disc and throws both away.

  // 1. soft ground bed. Radii are deliberately held to 1.12x: at 1.45x the
  // falloff ran past the stamp box on town_center / barracks / stable / foundry
  // and the blit edge cut a dead-straight line across a soft shadow.
  const ox = cx + rx * 0.24, oy = cy + rx * 0.14;
  g.save();
  g.translate(ox, oy);
  g.scale(1, bdSUN.squash);
  const R = rx * 1.12;
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, R);
  sh.addColorStop(0.00, bdShadow(0.40));
  sh.addColorStop(0.55, bdShadow(0.18));
  sh.addColorStop(1.00, bdShadow(0));
  g.fillStyle = sh;
  g.beginPath(); g.arc(0, 0, R, 0, BD_TAU); g.fill();
  g.restore();

  if (sideHex) {
    const worn = bdLawful(bdMix(BT.EARTH, sideHex, 0.40));
    const wornLit = bdLawful(bdMix(worn, bdSUN.bounce, 0.32));
    g.save();
    g.translate(cx, cy);
    g.scale(1, bdSUN.squash);

    // 2. clods, seeded so they never reshuffle between re-bakes
    const rr = bdRnd(0xB0D | (rx * 7));
    for (let i = 0; i < 26; i++) {
      const a = rr(0, BD_TAU);
      const dd = Math.sqrt(rr(0, 1)) * rx * 1.1;
      const px = Math.cos(a) * dd, py = Math.sin(a) * dd;
      const lit = (Math.cos(a) * bdSUN.x + Math.sin(a) * bdSUN.y) > 0.2;
      g.fillStyle = bdRgba(lit ? wornLit : bdMix(worn, '#141008', 0.35), rr(0.18, 0.46));
      g.beginPath(); g.arc(px, py, rr(0.6, 1.9), 0, BD_TAU); g.fill();
    }

    // 3. dry lit crescent on the sunward edge — the apron catching the lamp
    g.lineWidth = rx * 0.17;
    g.strokeStyle = bdRgba(wornLit, 0.5);
    g.beginPath();
    g.arc(0, 0, rx * 0.9, Math.PI * 0.92, Math.PI * 1.92);
    g.stroke();

    // 4. the apron body, last and therefore lowest
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.16);
    sg.addColorStop(0.00, bdRgba(worn, 0.78));
    sg.addColorStop(0.55, bdRgba(worn, 0.56));
    sg.addColorStop(0.84, bdRgba(worn, 0.22));
    sg.addColorStop(1.00, bdRgba(worn, 0));
    g.fillStyle = sg;
    g.beginPath(); g.arc(0, 0, rx * 1.16, 0, BD_TAU); g.fill();
    g.restore();
  }

  g.restore();
}


/* ---------------------------------------------------------------------------
   4. THE ARCHITECTURAL DETAIL KIT
   Courses, framing, openings and furniture. Every one of these obeys the sun
   the same way: a dark joint line on the down-right side of a raised element
   and a light one on the up-left, which is what turns a flat panel into a
   modelled surface without a single gradient.
   ------------------------------------------------------------------------ */

/**
 * Rubble / ashlar coursing clipped to an arbitrary region. Individual stones,
 * not a hatch: a stone wall reads as a stone wall because of the irregular
 * bond pattern, and that pattern is the whole point of the material.
 */
function bdStoneCourses(g, clipFn, x, y, w, h, R, seed, course, opts) {
  const o = opts || {};
  const rr = bdRnd(seed);
  g.save();
  g.beginPath(); clipFn(g); g.clip();
  const rows = Math.max(1, Math.round(h / course));
  for (let r = 0; r < rows; r++) {
    const ry = y + r * course;
    let sx = x - (r % 2 ? course * 0.55 : 0) - rr(0, course * 0.4);
    while (sx < x + w) {
      const sw = course * rr(1.0, 2.1);
      const sh = course * rr(0.78, 0.96);
      const tone = rr(0, 1);
      g.fillStyle = tone > 0.72 ? R.lit : tone > 0.34 ? R.base : R.shade;
      g.fillRect(sx, ry, sw - course * 0.16, sh - course * 0.16);
      // joint shadow on the down-right of each stone
      g.fillStyle = bdRgba(R.line, 0.55);
      g.fillRect(sx + sw - course * 0.16, ry, course * 0.16, sh);
      g.fillRect(sx, ry + sh - course * 0.16, sw, course * 0.16);
      // lit chamfer on the up-left
      if (tone > 0.5) {
        g.fillStyle = bdRgba(R.edge, 0.45);
        g.fillRect(sx, ry, sw - course * 0.16, course * 0.16);
      }
      sx += sw;
    }
  }
  if (o.ao !== false) {
    g.fillStyle = bdShadow(0.18);
    g.fillRect(x - 2, y + h * 0.72, w + 4, h * 0.28 + 2);
  }
  g.restore();
}

/**
 * Roof courses — the single most important detail on the whole settlement.
 * A roof without visible courses reads as a coloured triangle; with them it
 * reads as a made object. Each course gets a shadow line along its lower
 * (down-right) edge and a light line along its upper (up-left) edge, so the
 * courses themselves declare the light direction.
 *
 * kind: 'tile' adds staggered vertical joints, 'thatch' adds a scalloped
 * bottom edge and long straw combing, 'slate' uses tighter flatter courses,
 * 'shingle' splits each course into irregular tabs.
 */
function bdRoofCourses(g, clipFn, x, y, w, h, R, kind, seed, pitch) {
  const rr = bdRnd(seed);
  g.save();
  g.beginPath(); clipFn(g); g.clip();
  const step = pitch || (kind === 'slate' ? 3.4 : kind === 'tile' ? 4.6 : 5.6);
  for (let cy = y + h; cy > y - step; cy -= step) {
    if (kind === 'thatch') {
      // scalloped, irregular course line — thatch has no straight edges
      g.strokeStyle = bdRgba(R.shade, 0.68);
      g.lineWidth = 1.5;
      g.beginPath();
      let px = x - 4;
      g.moveTo(px, cy);
      while (px < x + w + 4) {
        const sw = rr(5, 11);
        g.quadraticCurveTo(px + sw * 0.5, cy + rr(1.0, 2.4), px + sw, cy + rr(-0.6, 0.6));
        px += sw;
      }
      g.stroke();
      g.strokeStyle = bdRgba(R.lit, 0.5);
      g.lineWidth = 0.9;
      g.beginPath();
      g.moveTo(x - 4, cy - 1.5);
      g.lineTo(x + w + 4, cy - 1.5 + rr(-1, 1));
      g.stroke();
    } else {
      g.fillStyle = bdRgba(R.line, kind === 'slate' ? 0.42 : 0.52);
      g.fillRect(x - 4, cy, w + 8, kind === 'slate' ? 0.8 : 1.2);
      g.fillStyle = bdRgba(R.lit, 0.42);
      g.fillRect(x - 4, cy - 1.1, w + 8, 0.9);
    }
    if (kind === 'tile' || kind === 'shingle') {
      // staggered vertical joints, offset per course so no column lines up
      const jw = kind === 'tile' ? 5.2 : rr(4, 9);
      let jx = x + rr(0, jw);
      g.fillStyle = bdRgba(R.line, 0.34);
      while (jx < x + w) {
        g.fillRect(jx, cy - step + 1, 0.8, step - 1.4);
        jx += kind === 'tile' ? jw : rr(4, 10);
      }
    }
  }
  if (kind === 'thatch') {
    // long combing strokes down the slope — the fibre direction
    g.strokeStyle = bdRgba(R.lit, 0.22);
    g.lineWidth = 0.7;
    for (let i = 0; i < 40; i++) {
      const sx = x + rr(0, w);
      const sy = y + rr(0, h * 0.9);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + rr(-1.5, 1.5), sy + rr(4, 9));
      g.stroke();
    }
  }
  g.restore();
}

/**
 * Timber framing over a plaster panel. Posts, rails and a brace, each with a
 * lit up-left edge and a shadow cast onto the plaster down-right — which is
 * what makes the frame sit PROUD of the panel rather than being painted on it.
 */
function bdTimberFrame(g, x, y, w, h, seed, bays) {
  const T = bdRamp(BMAT.TIMBER);
  const rr = bdRnd(seed);
  const n = bays || Math.max(2, Math.round(w / 16));
  const tw = Math.max(1.8, h * 0.075);

  // shadow the frame throws onto the panel, offset down-right
  g.fillStyle = bdShadow(0.22);
  for (let i = 0; i <= n; i++) {
    const px = x + (w / n) * i - tw * 0.5;
    g.fillRect(px + 1.4, y + 1.6, tw, h);
  }
  g.fillRect(x + 1.4, y + h * 0.52 + 1.6, w, tw);

  // sill and wall plate
  g.fillStyle = T.base; g.fillRect(x - 1, y + h - tw, w + 2, tw);
  g.fillStyle = T.lit;  g.fillRect(x - 1, y + h - tw, w + 2, tw * 0.34);
  g.fillStyle = T.base; g.fillRect(x - 1, y, w + 2, tw);
  g.fillStyle = T.lit;  g.fillRect(x - 1, y, w + 2, tw * 0.34);

  // studs
  for (let i = 0; i <= n; i++) {
    const px = x + (w / n) * i - tw * 0.5;
    g.fillStyle = T.base; g.fillRect(px, y, tw, h);
    g.fillStyle = T.lit;  g.fillRect(px, y, tw * 0.34, h);
    g.fillStyle = T.shade; g.fillRect(px + tw * 0.72, y, tw * 0.28, h);
  }
  // mid rail
  g.fillStyle = T.base; g.fillRect(x, y + h * 0.52, w, tw);
  g.fillStyle = T.lit;  g.fillRect(x, y + h * 0.52, w, tw * 0.34);

  // one diagonal brace in a random bay — asymmetry is what stops the frame
  // reading as a printed grid
  const bay = Math.floor(rr(0, n));
  const bx0 = x + (w / n) * bay + tw, bx1 = x + (w / n) * (bay + 1);
  bdBeam(g, T, bx0, y + h * 0.52, bx1, y + tw, tw * 0.85, { cap: 'butt' });
}

/** A plank / batten wall — vertical boards with shadowed gaps. */
function bdPlankWall(g, x, y, w, h, R, seed) {
  const rr = bdRnd(seed);
  let px = x;
  while (px < x + w) {
    const pw = rr(3.4, 6.2);
    const tone = rr(0, 1);
    g.fillStyle = tone > 0.66 ? R.lit : tone > 0.3 ? R.base : R.shade;
    g.fillRect(px, y, pw, h);
    g.fillStyle = bdRgba(R.line, 0.5);
    g.fillRect(px + pw - 0.7, y, 0.7, h);
    px += pw;
  }
}

/**
 * A doorway. Recessed reveal (dark), the door leaf itself, iron strap hinges,
 * and — on every building — a LINTEL painted in the owner's side colour. That
 * lintel is the guaranteed team read at close zoom; the banner is the read at
 * command altitude.
 */
function bdDoor(g, cx, yBot, w, h, sideHex, opts) {
  const o = opts || {};
  const D = bdRamp(BMAT.DOOR);
  const x = cx - w / 2, y = yBot - h;

  // reveal: the dark hole the door sits inside
  g.fillStyle = bdShadow(0.72);
  g.fillRect(x - 1.4, y - 1.4, w + 2.8, h + 1.4);

  if (o.arch) {
    bdLitPath(g, function (c) {
      c.moveTo(x, yBot);
      c.lineTo(x, y + w * 0.5);
      c.arc(cx, y + w * 0.5, w * 0.5, Math.PI, 0);
      c.lineTo(x + w, yBot);
      c.closePath();
    }, D, { bbox: [x, y, w, h], litW: 1.0 });
  } else {
    bdRect(g, x, y, w, h, D, { litW: 1.0 });
  }

  // vertical plank joints
  g.fillStyle = bdRgba(D.line, 0.62);
  for (let i = 1; i < 4; i++) g.fillRect(x + (w / 4) * i, y + 1, 0.8, h - 1.5);

  // iron strap hinges, catching the lamp on their upper edge
  const I = bdRamp(BMAT.IRON);
  g.fillStyle = I.base;
  g.fillRect(x + 0.5, y + h * 0.22, w * 0.62, 1.5);
  g.fillRect(x + 0.5, y + h * 0.68, w * 0.62, 1.5);
  g.fillStyle = I.lit;
  g.fillRect(x + 0.5, y + h * 0.22, w * 0.62, 0.6);
  g.fillRect(x + 0.5, y + h * 0.68, w * 0.62, 0.6);

  // THE SIDE-COLOUR LINTEL
  const S = bdRamp(sideHex);
  g.fillStyle = S.base;
  g.fillRect(x - 2.2, y - 3.0, w + 4.4, 3.0);
  g.fillStyle = S.lit;
  g.fillRect(x - 2.2, y - 3.0, w + 4.4, 1.0);
  g.fillStyle = bdRgba(S.line, 0.7);
  g.fillRect(x - 2.2, y - 0.5, w + 4.4, 0.5);

  // occlusion pooling in the doorway
  bdAO(g, cx, yBot - h * 0.2, w * 0.8, h * 0.5, 0.34);
}

/** A small leaded window with a stone surround and a lit sill. */
function bdWindow(g, cx, cy, w, h, opts) {
  const o = opts || {};
  const G = bdRamp(BMAT.GLASS);
  const S = bdRamp(BMAT.STONE);
  const x = cx - w / 2, y = cy - h / 2;

  // surround
  g.fillStyle = S.base; g.fillRect(x - 1.4, y - 1.4, w + 2.8, h + 2.8);
  g.fillStyle = S.lit;  g.fillRect(x - 1.4, y - 1.4, w + 2.8, 1.1);
  g.fillStyle = S.shade; g.fillRect(x + w + 0.3, y - 1.4, 1.1, h + 2.8);

  // glass: dark, with one bright specular streak on the up-left pane only
  g.fillStyle = G.shade; g.fillRect(x, y, w, h);
  g.fillStyle = bdRgba('#FFF1CE', 0.30);
  g.fillRect(x + 0.6, y + 0.6, w * 0.42, h * 0.38);

  // leading
  g.fillStyle = bdRgba(G.line, 0.85);
  g.fillRect(x + w * 0.5 - 0.4, y, 0.8, h);
  g.fillRect(x, y + h * 0.5 - 0.4, w, 0.8);

  // lit sill
  g.fillStyle = S.edge;
  g.fillRect(x - 2.0, y + h + 0.4, w + 4.0, 1.2);

  if (o.shutter) {
    const W = bdRamp(BMAT.SHINGLE);
    g.fillStyle = W.base;  g.fillRect(x - 3.6, y - 1, 2.4, h + 2);
    g.fillStyle = W.lit;   g.fillRect(x - 3.6, y - 1, 0.8, h + 2);
  }
}

/** A Georgian six-over-six sash with a projecting limestone surround. */
function bdSashWindow(g, cx, cy, w, h, opts) {
  const o = opts || {};
  const Glass = bdRamp(BMAT.GLASS);
  const Trim = bdRamp(o.trim || BMAT.LIMESTONE);
  const Frame = bdRamp(o.frame || '#E4DEC8');
  const x = cx - w / 2, y = cy - h / 2;

  // Architrave, keystone and projecting sill make the window legible even
  // after the baked sprite is reduced to command zoom.
  bdRect(g, x - 2.0, y - 2.1, w + 4.0, h + 4.2, Trim, { litW: 0.9, edge: true });
  g.fillStyle = Glass.shade;
  g.fillRect(x, y, w, h);
  g.fillStyle = bdRgba('#FFF1CE', 0.26);
  g.fillRect(x + 0.6, y + 0.6, w * 0.44, h * 0.28);

  // Twelve small panes: three across, two vertically in each sash.
  g.fillStyle = Frame.base;
  g.fillRect(x + w / 3 - 0.35, y, 0.7, h);
  g.fillRect(x + w * 2 / 3 - 0.35, y, 0.7, h);
  for (const fy of [0.25, 0.5, 0.75]) g.fillRect(x, y + h * fy - 0.35, w, 0.7);
  g.fillStyle = Frame.lit;
  g.fillRect(x, y, w, 0.7);
  g.fillRect(x, y, 0.7, h);
  bdRect(g, x - 2.8, y + h + 1.1, w + 5.6, 1.8, Trim, { litW: 0.7, edge: true });

  if (o.keystone !== false) {
    bdPoly(g, [cx - 1.7, y - 2.2, cx + 1.7, y - 2.2,
      cx + 2.3, y + 1.5, cx - 2.3, y + 1.5], Trim, { litW: 0.55, edge: true });
  }
}

/** A narrow Ottoman window with a pointed arch, stone hood and lattice. */
function bdArchedWindow(g, cx, cy, w, h) {
  const Trim = bdRamp(BMAT.LIMESTONE);
  const Glass = bdRamp(BMAT.GLASS);
  const x = cx - w / 2, y = cy - h / 2;
  const spring = y + w * 0.46;
  bdLitPath(g, function (c) {
    c.moveTo(x - 1.6, y + h + 1.6);
    c.lineTo(x - 1.6, spring);
    c.quadraticCurveTo(cx - w * 0.32, y + 1, cx, y - 2.2);
    c.quadraticCurveTo(cx + w * 0.32, y + 1, x + w + 1.6, spring);
    c.lineTo(x + w + 1.6, y + h + 1.6);
    c.closePath();
  }, Trim, { bbox: [x - 2, y - 3, w + 4, h + 5], litW: 0.9, edge: true });
  g.fillStyle = Glass.shade;
  g.beginPath();
  g.moveTo(x, y + h); g.lineTo(x, spring);
  g.quadraticCurveTo(cx - w * 0.25, y + 2, cx, y);
  g.quadraticCurveTo(cx + w * 0.25, y + 2, x + w, spring);
  g.lineTo(x + w, y + h); g.closePath(); g.fill();
  g.strokeStyle = bdRgba(Trim.shade, 0.78); g.lineWidth = 0.65;
  for (let i = 1; i < 3; i++) {
    g.beginPath(); g.moveTo(x + w * i / 3, spring - 1); g.lineTo(x + w * i / 3, y + h); g.stroke();
  }
  for (let fy = spring + 3; fy < y + h; fy += 3.2) {
    g.beginPath(); g.moveTo(x, fy); g.lineTo(x + w, fy); g.stroke();
  }
  bdRect(g, x - 2.2, y + h + 1.0, w + 4.4, 1.6, Trim, { litW: 0.6 });
}

/** Fine brick joints baked once into the façade. */
function bdBrickCourses(g, x, y, w, h, material, seed) {
  const rr = bdRnd(seed || 1);
  const course = Math.max(2.7, h * 0.085);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = bdRgba(material.line, 0.45);
  g.lineWidth = 0.55;
  for (let row = 0, cy = y + course; cy < y + h; row++, cy += course) {
    g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
    const brickW = course * 2.15;
    const offset = row % 2 ? brickW * 0.5 : 0;
    for (let bx = x - offset; bx < x + w; bx += brickW) {
      const joint = bx + rr(-0.35, 0.35);
      g.beginPath(); g.moveTo(joint, cy - course); g.lineTo(joint, cy); g.stroke();
    }
  }
  g.strokeStyle = bdRgba(material.edge, 0.20);
  g.lineWidth = 0.45;
  for (let cy = y + 0.7; cy < y + h; cy += course) {
    g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
  }
  g.restore();
}

/** Fluted classical column with a tapered shaft, moulded base and Doric capital. */
function bdClassicalColumn(g, cx, yTop, yBot, width, material) {
  const M = material || bdRamp(BMAT.LIMESTONE);
  const shaftTop = yTop + width * 0.72;
  const shaftBot = yBot - width * 0.62;
  bdRect(g, cx - width * 0.72, yBot - width * 0.55, width * 1.44, width * 0.55, M,
    { litW: 0.65, edge: true });
  bdRect(g, cx - width * 0.58, yBot - width * 0.88, width * 1.16, width * 0.34, M,
    { litW: 0.6 });
  bdPoly(g, [cx - width * 0.42, shaftBot, cx - width * 0.33, shaftTop,
    cx + width * 0.33, shaftTop, cx + width * 0.42, shaftBot], M,
    { litW: 0.8, edge: true, shadeX: 0.69 });
  g.strokeStyle = bdRgba(M.shade, 0.56); g.lineWidth = 0.48;
  for (const k of [-0.22, 0, 0.22]) {
    g.beginPath();
    g.moveTo(cx + width * k * 0.78, shaftTop + 1);
    g.lineTo(cx + width * k, shaftBot - 1);
    g.stroke();
  }
  bdPoly(g, [cx - width * 0.36, shaftTop, cx - width * 0.58, yTop + width * 0.34,
    cx + width * 0.58, yTop + width * 0.34, cx + width * 0.36, shaftTop], M,
    { litW: 0.65, edge: true });
  bdRect(g, cx - width * 0.76, yTop, width * 1.52, width * 0.36, M,
    { litW: 0.7, edge: true });
}

function bdDentilCourse(g, x, y, w, material, count) {
  const M = material || bdRamp(BMAT.LIMESTONE);
  const n = count || 12;
  bdRect(g, x, y, w, 2.2, M, { litW: 0.65, edge: true });
  g.fillStyle = M.base;
  const step = w / n;
  for (let i = 0; i < n; i++) g.fillRect(x + i * step + step * 0.18, y + 2.0, step * 0.52, 1.8);
  g.fillStyle = M.lit;
  for (let i = 0; i < n; i++) g.fillRect(x + i * step + step * 0.18, y + 2.0, step * 0.52, 0.55);
}

/** A brick chimney stack with a corbelled cap and a soot-darkened flue. */
function bdChimney(g, cx, yBot, w, h) {
  const B = bdRamp(BMAT.BRICK);
  bdRect(g, cx - w / 2, yBot - h, w, h, B, { litW: 1.1, edge: true });
  bdStoneCourses(g, function (c) { c.rect(cx - w / 2, yBot - h, w, h); },
    cx - w / 2, yBot - h, w, h, B, (cx * 31 + h) | 0, 2.6, { ao: false });
  // corbelled cap, oversailing the stack on both sides
  const C = bdRamp(bdMix(BMAT.BRICK, BMAT.STONE, 0.4));
  bdRect(g, cx - w * 0.72, yBot - h - 3.2, w * 1.44, 3.2, C, { litW: 1.0, edge: true });
  // flue mouth — a genuine hole, dark and slightly offset for perspective
  g.fillStyle = bdShadow(0.85);
  g.beginPath();
  g.ellipse(cx + 0.4, yBot - h - 3.0, w * 0.28, w * 0.13, 0, 0, BD_TAU);
  g.fill();
  g.strokeStyle = bdRgba('#1A1614', 0.7);
  g.lineWidth = 0.8;
  g.stroke();
}

/**
 * A pole with a side-colour banner. This is the read at command altitude:
 * a large block of pure team colour raised clear of the roofline where
 * nothing can occlude it.
 */
function bdBanner(g, x, yBase, poleH, side, opts) {
  const o = opts || {};
  const P = bdRamp(BMAT.TIMBER);
  const S = bdRamp(BD_SIDE[side].rim);
  const yTop = yBase - poleH;
  const dir = o.dir || 1;

  bdBeam(g, P, x, yBase, x, yTop, 2.0, { cap: 'butt' });
  // finial
  g.fillStyle = bdRamp(BMAT.IRON).lit;
  g.beginPath(); g.arc(x, yTop - 1.2, 1.5, 0, BD_TAU); g.fill();

  const fw = o.w || 15, fh = o.h || 11;
  // cloth: a swallow-tail pennant with a waved trailing edge, so it reads as
  // fabric rather than as a rectangle of colour
  bdLitPath(g, function (c) {
    c.moveTo(x, yTop + 1);
    c.lineTo(x + dir * fw, yTop + 1 + fh * 0.18);
    c.lineTo(x + dir * fw * 0.72, yTop + 1 + fh * 0.5);
    c.lineTo(x + dir * fw, yTop + 1 + fh * 0.86);
    c.lineTo(x, yTop + 1 + fh);
    c.closePath();
  }, S, {
    bbox: [Math.min(x, x + dir * fw), yTop + 1, fw, fh],
    litW: 1.2, edge: true, edgeA: 0.8,
  });
  // fold shadow so the cloth has volume
  g.strokeStyle = bdRgba(S.shade, 0.6);
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(x + dir * fw * 0.34, yTop + 1.6);
  g.quadraticCurveTo(x + dir * fw * 0.42, yTop + 1 + fh * 0.5, x + dir * fw * 0.30, yTop + fh);
  g.stroke();
  // side-lit edge on the hoist
  g.fillStyle = BD_SIDE[side].lit;
  g.fillRect(x - 0.4, yTop + 1, 1.4, fh);
}

/** A small roof-ridge pennant, for buildings too humble for a full banner. */
function bdRidgePennant(g, x, yRidge, side, dir) {
  const P = bdRamp(BMAT.TIMBER);
  const S = bdRamp(BD_SIDE[side].rim);
  bdBeam(g, P, x, yRidge + 1, x, yRidge - 11, 1.3, { cap: 'butt' });
  bdLitPath(g, function (c) {
    c.moveTo(x, yRidge - 11);
    c.lineTo(x + dir * 9, yRidge - 8.6);
    c.lineTo(x, yRidge - 5.6);
    c.closePath();
  }, S, { bbox: [Math.min(x, x + dir * 9), yRidge - 11, 9, 5.4], litW: 0.9, edge: true });
}

/** Fence / paddock rails on posts, with a cast shadow on the ground. */
function bdFence(g, x0, x1, y, h, seed, spacing) {
  const P = bdRamp(BT.TRUNK);
  const rr = bdRnd(seed);
  const step = spacing || 14;
  // ground shadow of the whole run
  g.fillStyle = bdShadow(0.22);
  g.fillRect(x0 + 2, y - 1, x1 - x0, 2.4);
  // rails
  for (let i = 0; i < 2; i++) {
    const ry = y - h * (0.42 + i * 0.38);
    g.fillStyle = P.base; g.fillRect(x0, ry, x1 - x0, 1.8);
    g.fillStyle = P.lit;  g.fillRect(x0, ry, x1 - x0, 0.7);
  }
  // posts
  for (let px = x0; px <= x1; px += step) {
    const ph = h * rr(0.9, 1.08);
    bdBeam(g, P, px, y, px, y - ph, 2.2, { cap: 'butt' });
  }
}

/** A stacked log pile — end-grain rings facing the viewer. */
function bdLogPile(g, cx, yBot, w, rows, seed) {
  const rr = bdRnd(seed);
  const L = bdRamp(BMAT.LOG);
  const r = w / 9;
  for (let row = 0; row < rows; row++) {
    const n = Math.floor(w / (r * 2)) - (row % 2);
    const y = yBot - r - row * r * 1.72;
    const x0 = cx - (n * r * 2) / 2 + r + (row % 2 ? r : 0);
    for (let i = 0; i < n; i++) {
      const x = x0 + i * r * 2 + rr(-0.5, 0.5);
      bdEllipse(g, x, y, r, r * 0.94, L, { litW: 0.7, edge: true, edgeA: 0.7 });
      // heartwood rings, offset up-left so the end grain catches the lamp
      g.strokeStyle = bdRgba(L.shade, 0.55);
      g.lineWidth = 0.7;
      for (let k = 1; k <= 2; k++) {
        g.beginPath();
        g.arc(x + bdSUN.x * r * 0.12, y + bdSUN.y * r * 0.12, r * (0.26 * k), 0, BD_TAU);
        g.stroke();
      }
      g.fillStyle = bdRgba(L.edge, 0.5);
      g.beginPath(); g.arc(x + bdSUN.x * r * 0.2, y + bdSUN.y * r * 0.2, r * 0.14, 0, BD_TAU); g.fill();
    }
  }
}

/**
 * A spoked wheel drawn as a RING — a genuine hole in the silhouette, which
 * nothing else in the settlement has. This is the mine's and the mill's
 * signature at the 8-pixel black-shape test.
 */
function bdWheelRing(g, cx, cy, r, R, spokes) {
  g.save();
  g.lineCap = 'butt';
  // lining
  g.strokeStyle = R.line; g.lineWidth = r * 0.42;
  g.beginPath(); g.arc(cx, cy, r, 0, BD_TAU); g.stroke();
  // rim
  g.strokeStyle = R.base; g.lineWidth = r * 0.28;
  g.beginPath(); g.arc(cx, cy, r, 0, BD_TAU); g.stroke();
  // sunward arc lit, lee arc shaded
  g.strokeStyle = R.lit; g.lineWidth = r * 0.18;
  g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.72, Math.PI * 1.72); g.stroke();
  g.strokeStyle = R.shade; g.lineWidth = r * 0.16;
  g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.78, Math.PI * 0.66); g.stroke();
  // spokes
  const n = spokes || 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * BD_TAU;
    const lit = (Math.cos(a) * bdSUN.x + Math.sin(a) * bdSUN.y) > 0;
    g.strokeStyle = lit ? R.lit : R.shade;
    g.lineWidth = r * 0.12;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stroke();
  }
  // hub
  g.fillStyle = R.base;
  g.beginPath(); g.arc(cx, cy, r * 0.2, 0, BD_TAU); g.fill();
  g.fillStyle = R.lit;
  g.beginPath(); g.arc(cx + bdSUN.x * r * 0.06, cy + bdSUN.y * r * 0.06, r * 0.1, 0, BD_TAU); g.fill();
  g.restore();
}

/** A coopered barrel with iron hoops and an end-grain ellipse. */
function bdBarrel(g, cx, yBot, w, h) {
  const W = bdRamp(BMAT.LOG), I = bdRamp(BMAT.IRON);
  bdContactShadow(g, cx, yBot + 1, w * 0.72, h * 0.8, 0.78);
  bdLitPath(g, function (c) {
    c.moveTo(cx - w * 0.42, yBot);
    c.quadraticCurveTo(cx - w * 0.58, yBot - h * 0.5, cx - w * 0.38, yBot - h);
    c.lineTo(cx + w * 0.38, yBot - h);
    c.quadraticCurveTo(cx + w * 0.58, yBot - h * 0.5, cx + w * 0.42, yBot);
    c.closePath();
  }, W, { bbox: [cx - w * 0.6, yBot - h, w * 1.2, h], litW: 0.8, edge: true });
  g.strokeStyle = I.base; g.lineWidth = 1.15;
  for (const fy of [0.20, 0.51, 0.82]) {
    g.beginPath();
    g.moveTo(cx - w * 0.47, yBot - h * fy);
    g.quadraticCurveTo(cx, yBot - h * fy + 1.0, cx + w * 0.47, yBot - h * fy);
    g.stroke();
  }
  g.strokeStyle = I.lit; g.lineWidth = 0.45;
  g.beginPath(); g.moveTo(cx - w * 0.43, yBot - h * 0.84);
  g.lineTo(cx + w * 0.34, yBot - h * 0.84); g.stroke();
  bdEllipse(g, cx, yBot - h, w * 0.38, w * 0.15, W, { litW: 0.55, edge: true });
}

/** A nailed packing crate. Cross-bracing prevents it reading as a plain box. */
function bdCrate(g, cx, yBot, w, h, seed) {
  const P = bdRamp(BMAT.SHINGLE), I = bdRamp(BMAT.IRON);
  bdContactShadow(g, cx, yBot + 1, w * 0.72, h * 0.68, 0.72);
  bdRect(g, cx - w / 2, yBot - h, w, h, P, { litW: 0.85, edge: true });
  g.strokeStyle = bdRgba(P.shade, 0.72); g.lineWidth = 1.05;
  g.beginPath(); g.moveTo(cx - w * 0.38, yBot - h * 0.84); g.lineTo(cx + w * 0.38, yBot - h * 0.16); g.stroke();
  g.beginPath(); g.moveTo(cx + w * 0.38, yBot - h * 0.84); g.lineTo(cx - w * 0.38, yBot - h * 0.16); g.stroke();
  g.fillStyle = P.lit;
  g.fillRect(cx - w / 2, yBot - h, w, 1.2);
  g.fillRect(cx - w / 2, yBot - h, 1.2, h);
  const rr = bdRnd(seed || 1);
  g.fillStyle = I.lit;
  for (let i = 0; i < 5; i++) {
    g.beginPath(); g.arc(cx + rr(-w * 0.36, w * 0.36), yBot - rr(h * 0.12, h * 0.88), 0.55, 0, BD_TAU); g.fill();
  }
}

/** A tied grain or powder sack, deliberately soft among all the hard joinery. */
function bdSack(g, cx, yBot, w, h, seed) {
  const C = bdRamp(BMAT.CANVAS), rr = bdRnd(seed || 1);
  bdContactShadow(g, cx, yBot + 1, w * 0.72, h * 0.65, 0.68);
  bdLitPath(g, function (c) {
    c.moveTo(cx - w * 0.48, yBot);
    c.quadraticCurveTo(cx - w * 0.66, yBot - h * 0.34, cx - w * 0.28, yBot - h * 0.84);
    c.lineTo(cx - w * 0.12, yBot - h);
    c.lineTo(cx + w * 0.12, yBot - h);
    c.lineTo(cx + w * 0.28, yBot - h * 0.84);
    c.quadraticCurveTo(cx + w * 0.66, yBot - h * 0.34, cx + w * 0.48, yBot);
    c.closePath();
  }, C, { bbox: [cx - w * 0.7, yBot - h, w * 1.4, h], litW: 0.75, edge: true });
  g.strokeStyle = bdRgba(C.shade, 0.55); g.lineWidth = 0.7;
  g.beginPath(); g.moveTo(cx - w * 0.22, yBot - h * 0.80); g.quadraticCurveTo(cx + rr(-1, 1), yBot - h * 0.52, cx + w * 0.20, yBot - h * 0.10); g.stroke();
  g.strokeStyle = bdRgba(BMAT.TIMBER_DARK, 0.75); g.lineWidth = 0.9;
  g.beginPath(); g.moveTo(cx - w * 0.24, yBot - h * 0.83); g.lineTo(cx + w * 0.24, yBot - h * 0.83); g.stroke();
}

/** A two-wheel utility cart. Its voids and diagonals remain legible at 8px. */
function bdCart(g, cx, yBot, scale, seed) {
  const k = scale || 1, P = bdRamp(BMAT.TIMBER), I = bdRamp(BMAT.IRON);
  bdContactShadow(g, cx, yBot + 2, 20 * k, 14 * k, 0.84);
  bdPoly(g, [cx - 14 * k, yBot - 15 * k, cx + 11 * k, yBot - 13 * k,
    cx + 8 * k, yBot - 4 * k, cx - 11 * k, yBot - 5 * k], P,
    { litW: 1.0, edge: true, shadeX: 0.70 });
  // separate plank lines and corner ironwork
  g.strokeStyle = bdRgba(P.shade, 0.64); g.lineWidth = 0.75 * k;
  for (let i = 1; i <= 3; i++) {
    const y = yBot - (5 + i * 2.25) * k;
    g.beginPath(); g.moveTo(cx - 11 * k, y); g.lineTo(cx + 8 * k, y - 0.8 * k); g.stroke();
  }
  bdWheelRing(g, cx - 8 * k, yBot - 2 * k, 6.6 * k, I, 8);
  bdWheelRing(g, cx + 7 * k, yBot - 2 * k, 6.6 * k, I, 8);
  bdBeam(g, P, cx + 10 * k, yBot - 8 * k, cx + 30 * k, yBot - 1 * k, 2.0 * k, { cap: 'butt' });
  bdBeam(g, P, cx + 10 * k, yBot - 11 * k, cx + 30 * k, yBot - 4 * k, 1.5 * k, { cap: 'butt' });
  const rr = bdRnd(seed || 1);
  g.fillStyle = I.lit;
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.arc(cx + rr(-10, 7) * k, yBot - rr(6, 13) * k, 0.55 * k, 0, BD_TAU); g.fill();
  }
}

/** Wall lantern with a small warm glass note and a wrought bracket. */
function bdLantern(g, cx, cy, side) {
  const I = bdRamp(BMAT.IRON), S = bdRamp(BD_SIDE[side].rim);
  bdBeam(g, I, cx - 6, cy - 7, cx, cy, 1.25, { cap: 'butt' });
  bdBeam(g, I, cx - 6, cy - 7, cx - 6, cy - 12, 1.25, { cap: 'butt' });
  bdPoly(g, [cx - 9, cy - 5, cx - 3, cy - 5, cx - 4, cy + 3, cx - 8, cy + 3],
    bdRamp('#C9A24E'), { litW: 0.65, edge: true });
  g.fillStyle = bdRgba('#FFE3A0', 0.78);
  g.fillRect(cx - 7.6, cy - 3.7, 2.6, 5.2);
  g.fillStyle = S.base;
  g.fillRect(cx - 9, cy - 6.2, 6, 1.2);
}

/** Stone trough used by stable yards and civic water points. */
function bdTrough(g, cx, yBot, w) {
  const S = bdRamp(BMAT.STONE), water = bdRamp('#667C82');
  bdContactShadow(g, cx, yBot + 1, w * 0.62, 10, 0.72);
  bdPoly(g, [cx - w / 2, yBot - 8, cx + w / 2, yBot - 8,
    cx + w * 0.42, yBot, cx - w * 0.42, yBot], S, { litW: 0.9, edge: true });
  bdEllipse(g, cx, yBot - 8, w * 0.43, 2.1, water, { litW: 0.55, edge: true });
  g.strokeStyle = bdRgba('#FFF1CE', 0.42); g.lineWidth = 0.55;
  g.beginPath(); g.moveTo(cx - w * 0.22, yBot - 8.5); g.lineTo(cx + w * 0.18, yBot - 8.2); g.stroke();
}

/** Low clipped planting bed, with flowers held away from team-colour hues. */
function bdGardenBed(g, cx, cy, w, seed) {
  const rr = bdRnd(seed || 1), S = bdRamp(BMAT.STONE_ROUGH);
  bdLitPath(g, function (c) {
    c.ellipse(cx, cy, w * 0.5, 7, 0, 0, BD_TAU);
  }, S, { bbox: [cx - w / 2, cy - 7, w, 14], litW: 0.65 });
  g.fillStyle = bdLawful(BT.EARTH_DARK);
  g.beginPath(); g.ellipse(cx, cy - 1, w * 0.42, 4.6, 0, 0, BD_TAU); g.fill();
  for (let i = 0; i < Math.round(w * 0.7); i++) {
    const x = cx + rr(-w * 0.38, w * 0.38), y = cy + rr(-3.2, 2.5);
    g.strokeStyle = bdRgba(BT.FOLIAGE_LIT, 0.75); g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-1, 1), y - rr(2.5, 6)); g.stroke();
    if (i % 4 === 0) {
      g.fillStyle = i % 8 ? '#D4B35C' : '#E6D9BA';
      g.beginPath(); g.arc(x, y - rr(3.8, 6.2), 0.85, 0, BD_TAU); g.fill();
    }
  }
}

/** Irregular dressed-stone apron / lane, painted behind the structure. */
function bdCobblePatch(g, cx, cy, rx, ry, seed, muddy) {
  const rr = bdRnd(seed || 1);
  const base = bdRamp(bdLawful(muddy ? bdMix(BT.ROAD_BED, BT.MUD, 0.48) : bdMix(BT.ROCK, BT.ROAD_BED, 0.34)));
  g.save();
  g.globalCompositeOperation = 'destination-over';
  // A scalloped, hand-laid perimeter. A perfect ellipse reads as a plastic
  // wargame base at close zoom; this irregular edge dissolves into the board.
  const edge = [];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * BD_TAU;
    const k = rr(0.92, 1.05);
    edge.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  g.beginPath();
  g.moveTo((edge[0][0] + edge[27][0]) / 2, (edge[0][1] + edge[27][1]) / 2);
  for (let i = 0; i < edge.length; i++) {
    const p = edge[i], q = edge[(i + 1) % edge.length];
    g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  g.closePath();
  g.clip();
  g.fillStyle = bdRgba(base.shade, 0.76);
  g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  const rowH = muddy ? 5.2 : 4.2;
  for (let row = -Math.ceil(ry / rowH); row <= Math.ceil(ry / rowH); row++) {
    const y = cy + row * rowH + rr(-0.5, 0.5);
    let x = cx - rx - (row & 1 ? 5 : 0);
    while (x < cx + rx) {
      const w = rr(muddy ? 6 : 5, muddy ? 12 : 10), h = rowH - 1;
      const tone = rr(0, 1);
      g.fillStyle = bdRgba(tone > 0.72 ? base.lit : tone > 0.23 ? base.base : base.shade, muddy ? 0.52 : 0.84);
      g.fillRect(x + 0.7, y - h / 2, w - 1.1, h);
      g.fillStyle = bdRgba(base.edge, muddy ? 0.18 : 0.36);
      g.fillRect(x + 0.8, y - h / 2, w - 1.4, 0.55);
      x += w;
    }
  }
  if (muddy) {
    g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.54); g.lineWidth = 1.5;
    for (const dx of [-rx * 0.24, rx * 0.24]) {
      g.beginPath(); g.moveTo(cx + dx - rx * 0.18, cy - ry); g.quadraticCurveTo(cx + dx + 2, cy, cx + dx + rx * 0.16, cy + ry); g.stroke();
    }
  }
  g.restore();
}

/** A compact blacksmith tool rack: tongs, hammers and a lit anvil edge. */
function bdToolRack(g, cx, yBot, scale) {
  const k = scale || 1, W = bdRamp(BMAT.TIMBER), I = bdRamp(BMAT.IRON);
  bdBeam(g, W, cx - 11 * k, yBot, cx - 11 * k, yBot - 20 * k, 2 * k, { cap: 'butt' });
  bdBeam(g, W, cx + 11 * k, yBot, cx + 11 * k, yBot - 20 * k, 2 * k, { cap: 'butt' });
  bdBeam(g, W, cx - 12 * k, yBot - 17 * k, cx + 12 * k, yBot - 17 * k, 2 * k, { cap: 'butt' });
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * 7 * k;
    bdBeam(g, I, x, yBot - 16 * k, x + i * 1.5 * k, yBot - 4 * k, 1.1 * k, { cap: 'round' });
    g.strokeStyle = I.lit; g.lineWidth = 0.7 * k;
    g.beginPath(); g.arc(x, yBot - 3 * k, 2.2 * k, 0, BD_TAU); g.stroke();
  }
}

/**
 * Functional yard dressing. Every type gets a distinct foreground story and
 * a worked ground surface, but everything remains part of its once-baked
 * sprite. This is the visual-density pass that turns isolated icons into a
 * lived-in 18th-century settlement without touching the per-frame hot path.
 */
function bdPaintSceneDressing(g, G, o) {
  const w = o.def.w, h = o.def.h, y = G.yG + h * 0.10;
  const left = -w * 0.43, right = w * 0.43;
  const seed = o.seed ^ 0x51f15e;

  if (o.type === 'town_center') {
    bdCobblePatch(g, 0, y + 6, w * 0.62, h * 0.23, seed, false);
    bdGardenBed(g, left * 0.92, y + 3, w * 0.24, seed + 1);
    bdGardenBed(g, right * 0.92, y + 3, w * 0.24, seed + 2);
    bdLantern(g, -G.bw * 0.56, G.yG - h * 0.19, o.side);
    bdLantern(g, G.bw * 0.56, G.yG - h * 0.19, o.side);
    bdCrate(g, right + 2, y + 4, 13, 10, seed + 3);
    bdBarrel(g, right - 11, y + 5, 9, 13);
  } else if (o.type === 'house') {
    bdCobblePatch(g, 0, y + 2, w * 0.54, h * 0.18, seed, false);
    bdGardenBed(g, right * 0.88, y + 3, w * 0.30, seed + 4);
    bdBarrel(g, left, y + 4, 9, 14);
    bdCrate(g, left + 10, y + 5, 10, 8, seed + 5);
    bdLantern(g, G.bw * 0.38, G.yG - h * 0.16, o.side);
  } else if (o.type === 'mill') {
    bdCobblePatch(g, 0, y + 4, w * 0.58, h * 0.22, seed, true);
    bdCart(g, right - 4, y + 4, 0.72, seed + 6);
    bdSack(g, left + 2, y + 4, 9, 13, seed + 7);
    bdSack(g, left + 11, y + 5, 10, 15, seed + 8);
    bdSack(g, left + 19, y + 4, 8, 11, seed + 9);
  } else if (o.type === 'lumber_camp') {
    bdCobblePatch(g, 0, y + 5, w * 0.62, h * 0.22, seed, true);
    bdCart(g, right - 16, y + 5, 0.66, seed + 10);
    bdToolRack(g, left + 4, y + 3, 0.72);
  } else if (o.type === 'mine') {
    bdCobblePatch(g, 0, y + 5, w * 0.62, h * 0.24, seed, true);
    const I = bdRamp(BMAT.IRON), T = bdRamp(BMAT.TIMBER);
    for (const dx of [-7, 7]) bdBeam(g, I, dx - 24, y + 5, dx + 30, y + 1, 1.25, { cap: 'butt' });
    for (let x = -22; x <= 28; x += 8) bdBeam(g, T, x, y + 8, x + 1, y - 1, 1.6, { cap: 'butt' });
    bdToolRack(g, left + 4, y + 3, 0.68);
    bdBarrel(g, right - 2, y + 5, 9, 12);
  } else if (o.type === 'barracks') {
    bdCobblePatch(g, 0, y + 4, w * 0.60, h * 0.20, seed, false);
    bdCrate(g, right - 5, y + 5, 15, 11, seed + 11);
    bdCrate(g, right - 18, y + 4, 12, 9, seed + 12);
    bdBarrel(g, left + 3, y + 5, 9, 13);
    bdLantern(g, G.bw * 0.36, G.yG - h * 0.18, o.side);
  } else if (o.type === 'stable') {
    bdCobblePatch(g, 0, y + 5, w * 0.62, h * 0.22, seed, true);
    bdTrough(g, left + 7, y + 5, 25);
    bdCart(g, right - 12, y + 5, 0.75, seed + 13);
    bdSack(g, right - 29, y + 5, 10, 14, seed + 14);
  } else if (o.type === 'foundry') {
    bdCobblePatch(g, 0, y + 5, w * 0.60, h * 0.22, seed, false);
    bdToolRack(g, right - 5, y + 4, 0.78);
    bdCrate(g, left + 2, y + 5, 14, 10, seed + 15);
    bdBarrel(g, left + 15, y + 4, 9, 13);
    const rr = bdRnd(seed + 16);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = bdRgba(i % 3 ? '#292A2A' : '#4A4338', rr(0.55, 0.9));
      g.beginPath(); g.arc(right + rr(-13, 12), y + rr(-2, 5), rr(1.2, 3.2), 0, BD_TAU); g.fill();
    }
  } else if (o.type === 'tower') {
    bdCobblePatch(g, 0, y + 4, w * 0.58, h * 0.18, seed, false);
    bdBarrel(g, right - 3, y + 5, 9, 13);
    bdBarrel(g, right - 12, y + 4, 8, 11);
    bdCrate(g, left + 5, y + 5, 12, 9, seed + 17);
    bdLantern(g, G.bw * 0.52, G.yG - h * 0.16, o.side);
  }
}

/** Sub-pixel pigment, soot and rain marks, clipped to already-painted pixels. */
function bdPassSurfacePatina(g, box, seed) {
  const rr = bdRnd(seed ^ 0x6ac690c5);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 320; i++) {
    const x = rr(box[0], box[0] + box[2]), y = rr(box[1], box[1] + box[3]);
    const light = rr(0, 1) > 0.72;
    g.fillStyle = light ? 'rgba(255,241,206,0.055)' : 'rgba(38,35,38,0.045)';
    g.beginPath(); g.arc(x, y, rr(0.18, 0.72), 0, BD_TAU); g.fill();
  }
  // Vertical rain streaks are sparse and faint; repetition would look printed.
  g.strokeStyle = 'rgba(44,42,43,0.065)'; g.lineWidth = 0.42;
  for (let i = 0; i < 24; i++) {
    const x = rr(box[0], box[0] + box[2]), y = rr(box[1], box[1] + box[3] * 0.72);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + rr(-0.3, 0.3), y + rr(3, 11)); g.stroke();
  }
  g.restore();
}

/** Cached structural damage: cracks, soot, broken glazing and foreground debris. */
function bdPaintDamage(g, G, o, stage) {
  if (!stage) return;
  const rr = bdRnd(o.seed ^ (stage * 0x45d9f3b));
  const yTop = G.yE + 4, yBot = G.yG - G.plinth;
  const cracks = stage === 1 ? 4 : 9;
  g.save();
  g.strokeStyle = bdShadow(stage === 1 ? 0.52 : 0.76);
  g.lineWidth = stage === 1 ? 0.8 : 1.15;
  for (let i = 0; i < cracks; i++) {
    const x = rr(-G.bw * 0.82, G.bw * 0.82), y = rr(yTop, yBot - 5);
    g.beginPath(); g.moveTo(x, y);
    let px = x, py = y;
    for (let k = 0; k < (stage === 1 ? 3 : 5); k++) {
      px += rr(-4.2, 4.2); py += rr(2.0, 5.8); g.lineTo(px, py);
    }
    g.stroke();
    if (stage === 2 && i % 2 === 0) {
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + rr(-6, 6), py + rr(2, 5)); g.stroke();
    }
  }
  // smoke-blackened roof holes and shattered windows read clearly from above
  g.fillStyle = bdRgba('#1B181A', stage === 1 ? 0.28 : 0.58);
  for (let i = 0; i < stage + 1; i++) {
    g.beginPath();
    g.ellipse(rr(-G.rr * 0.62, G.rr * 0.62), rr(G.yR + 4, G.yE - 3), rr(3, 7), rr(1.8, 3.8), rr(-0.3, 0.3), 0, BD_TAU);
    g.fill();
  }
  if (stage === 2) {
    const P = bdRamp(BMAT.SHINGLE), stone = bdRamp(BMAT.STONE_ROUGH);
    // emergency boarding over one front opening
    const bx = rr(-G.bw * 0.55, G.bw * 0.55), by = yTop + (yBot - yTop) * 0.44;
    for (let i = -1; i <= 1; i++) bdBeam(g, P, bx - 8, by + i * 4, bx + 8, by + i * 2, 1.8, { cap: 'butt' });
    // masonry rubble accumulated on the near edge
    for (let i = 0; i < 18; i++) {
      const x = rr(-G.bw, G.bw), y = G.yG + rr(-1, 8), r = rr(1.1, 3.1);
      bdPoly(g, [x - r, y, x - r * 0.45, y - r, x + r * 0.7, y - r * 0.65, x + r, y],
        stone, { litW: 0.45, line: false });
    }
  }
  g.restore();
}


/* ---------------------------------------------------------------------------
   5. THE SHELL — walls and roof
   Local coordinates: origin at the building's centre (drawBuilding has already
   translated), +y down. Everything is derived from def.w / def.h so a type's
   proportions follow its footprint automatically.

   ROOF GEOMETRY. The ridge runs left-to-right and the roof is HIPPED, so the
   piece presents three planes at once: a left hip facing up-left (full LIT),
   the main slope (BASE, with the shade block over its down-right region), and
   a right hip facing down-right (SHADE). Plus a thin band of the back slope
   visible above the ridge, which faces up and therefore also catches the lamp.
   Four distinct values on one roof is what gives a building volume, and it is
   exactly the bible's per-shape application rule applied to a solid.
   ------------------------------------------------------------------------ */

function bdGeometry(o) {
  const w = o.w, h = o.h;
  const bw    = w * (o.bwK    == null ? 0.40 : o.bwK);      // wall half-width
  const yG    = h * (o.groundK == null ? 0.42 : o.groundK); // front ground line
  const wallH = h * (o.wallK  == null ? 0.52 : o.wallK);
  const yE    = yG - wallH;                                  // eave line
  const over  = w * (o.overK  == null ? 0.06 : o.overK);     // eave overhang
  const rw    = bw + over;                                   // roof half-width
  const roofH = h * (o.roofK  == null ? 0.46 : o.roofK);
  const yR    = yE - roofH;                                  // ridge
  const rr    = rw * (o.hipK  == null ? 0.55 : o.hipK);      // ridge half-length
  const plinth = h * (o.plinthK == null ? 0.11 : o.plinthK);
  return {
    w: w, h: h, bw: bw, yG: yG, wallH: wallH, yE: yE,
    over: over, rw: rw, roofH: roofH, yR: yR, rr: rr, plinth: plinth,
    height: yG - yR,                                          // for shadow length
  };
}

/**
 * The silhouette path of the whole shell, used for the hard cast shadow.
 */
function bdShellSilhouette(G) {
  return function (c) {
    c.moveTo(-G.bw, G.yG);
    c.lineTo(-G.bw, G.yE);
    c.lineTo(-G.rw, G.yE);
    c.lineTo(-G.rr, G.yR);
    c.lineTo(G.rr, G.yR);
    c.lineTo(G.rw, G.yE);
    c.lineTo(G.bw, G.yE);
    c.lineTo(G.bw, G.yG);
    c.closePath();
  };
}

/** Stone footing, wall body, framing or coursing, and the eave shadow. */
function bdWalls(g, G, o) {
  const wall = o.wall || bdRamp(BMAT.PLASTER);
  const seed = o.seed || 1;

  // --- footing / plinth: every building meets the board through stone. This
  // is what stops a wall looking like it was pushed into the grass.
  if (o.plinth !== false) {
    const F = bdRamp(BMAT.STONE_ROUGH);
    const px = -G.bw - 1.6, pw = G.bw * 2 + 3.2;
    bdRect(g, px, G.yG - G.plinth, pw, G.plinth, F, { litW: 1.1 });
    bdStoneCourses(g, function (c) { c.rect(px, G.yG - G.plinth, pw, G.plinth); },
      px, G.yG - G.plinth, pw, G.plinth, F, seed * 7 + 3, G.plinth * 0.52);
  }

  // --- wall body
  const wy = G.yE, wh = G.yG - G.plinth - G.yE;
  bdRect(g, -G.bw, wy, G.bw * 2, wh + 1, wall, { litW: 1.5, edge: true, edgeA: 0.75 });

  if (o.material === 'stone') {
    bdStoneCourses(g, function (c) { c.rect(-G.bw, wy, G.bw * 2, wh); },
      -G.bw, wy, G.bw * 2, wh, wall, seed * 13 + 1, Math.max(3, wh * 0.13));
  } else if (o.material === 'plank') {
    bdPlankWall(g, -G.bw, wy, G.bw * 2, wh, wall, seed * 17 + 5);
  } else if (o.material === 'log') {
    // horizontal log courses with cross-lapped corner notches
    const rr2 = bdRnd(seed * 19);
    const ch = Math.max(3.2, wh * 0.15);
    for (let cy = wy; cy < wy + wh; cy += ch) {
      const tone = rr2(0, 1);
      g.fillStyle = tone > 0.6 ? wall.lit : tone > 0.28 ? wall.base : wall.shade;
      g.fillRect(-G.bw, cy, G.bw * 2, ch - 0.9);
      g.fillStyle = bdRgba(wall.line, 0.6);
      g.fillRect(-G.bw, cy + ch - 1.2, G.bw * 2, 1.2);
      g.fillStyle = bdRgba(wall.edge, 0.35);
      g.fillRect(-G.bw, cy, G.bw * 2, 0.7);
    }
    // protruding notched log ends at both corners
    for (let cy = wy; cy < wy + wh; cy += ch * 2) {
      bdEllipse(g, -G.bw - 1.6, cy + ch * 0.5, 2.0, ch * 0.42, wall, { litW: 0.6 });
      bdEllipse(g, G.bw + 1.6, cy + ch * 0.5, 2.0, ch * 0.42, wall, { litW: 0.6 });
    }
  } else if (o.material !== 'plain') {
    bdTimberFrame(g, -G.bw + 1, wy + 1, G.bw * 2 - 2, wh - 2, seed * 23 + 9, o.bays);
  }

  // --- the eave shadow the roof overhang throws onto the wall. Offset
  // down-right and clipped to the wall, so it declares the sun on the one
  // surface the player looks at most.
  g.save();
  g.beginPath(); g.rect(-G.bw, wy, G.bw * 2, wh + 1); g.clip();
  const eg = g.createLinearGradient(0, wy, 0, wy + G.h * 0.16);
  eg.addColorStop(0, bdShadow(0.46));
  eg.addColorStop(1, bdShadow(0));
  g.fillStyle = eg;
  g.fillRect(-G.bw - 1, wy, G.bw * 2 + 2, G.h * 0.16);
  g.restore();

  // --- ground-line occlusion where wall meets board
  bdAO(g, 0, G.yG, G.bw * 1.05, G.h * 0.09, 0.30);
}

/** The hipped roof: four planes, visible courses, ridge cap and rake boards. */
function bdRoof(g, G, o) {
  const R = o.roof || bdRamp(BMAT.TILE);
  const kind = o.roofKind || 'tile';
  const seed = o.seed || 1;
  const rw = G.rw, rr = G.rr, yE = G.yE, yR = G.yR;
  const backH = (o.backK == null ? 0.17 : o.backK) * (yE - yR);

  // --- back slope, visible as a band above the ridge. Faces up, so LIT.
  bdPoly(g, [-rr, yR, rr, yR, rr * 0.86, yR - backH, -rr * 0.86, yR - backH],
    R, { fill: R.lit, shade: false, litW: 1.0, edge: true, edgeA: 0.85 });

  // --- main slope as one solid, then the two hips carved out of it by tone
  const slope = function (c) {
    c.moveTo(-rw, yE);
    c.lineTo(rw, yE);
    c.lineTo(rr, yR);
    c.lineTo(-rr, yR);
    c.closePath();
  };
  bdLitPath(g, slope, R, {
    bbox: [-rw, yR, rw * 2, yE - yR],
    shadeX: 0.70, shadeY: 0.82, litW: 1.6, lineW: 1.4,
  });

  // left hip — faces up-left, full LIT
  g.save();
  g.beginPath(); slope(g); g.clip();
  g.fillStyle = R.lit;
  g.beginPath();
  g.moveTo(-rw - 2, yE + 2);
  g.lineTo(-rr, yR - 2);
  g.lineTo(-rr - (rw - rr) * 0.30, yR - 2);
  g.lineTo(-rw - 2, yE + 2);
  g.closePath();
  g.fill();
  // right hip — faces down-right, SHADE
  g.fillStyle = R.shade;
  g.beginPath();
  g.moveTo(rw + 2, yE + 2);
  g.lineTo(rr, yR - 2);
  g.lineTo(rr + (rw - rr) * 0.30, yR - 2);
  g.lineTo(rw + 2, yE + 2);
  g.closePath();
  g.fill();
  g.restore();

  // --- courses over everything, so the hip creases read as folds in one
  // continuous covering rather than as three separate panels
  bdRoofCourses(g, slope, -rw, yR, rw * 2, yE - yR, R, kind, seed * 29 + 11, o.pitch);

  // --- hip creases: a dark line with a lit lip on its sunward side
  g.save();
  g.beginPath(); slope(g); g.clip();
  g.lineCap = 'round';
  g.strokeStyle = bdRgba(R.line, 0.8); g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(-rw, yE); g.lineTo(-rr, yR); g.stroke();
  g.beginPath(); g.moveTo(rw, yE); g.lineTo(rr, yR); g.stroke();
  g.strokeStyle = bdRgba(R.edge, 0.55); g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-rw + 1.2, yE); g.lineTo(-rr + 1.0, yR); g.stroke();
  g.restore();

  // --- ridge cap: a raised capping course, lit along its top edge
  const C = bdRamp(o.ridgeHex || bdMix(R.base, BMAT.STONE, 0.22));
  bdRect(g, -rr - 1.4, yR - 2.2, rr * 2 + 2.8, 2.8, C, { litW: 0.9, edge: true });

  // --- eave course: the thick bottom edge of the covering, plus the fascia
  // board beneath it and the shadow it throws
  g.fillStyle = bdRgba(R.shade, 0.85);
  g.fillRect(-rw, yE - 1.6, rw * 2, 2.4);
  const F = bdRamp(BMAT.TIMBER);
  g.fillStyle = F.base; g.fillRect(-rw, yE + 0.6, rw * 2, 1.9);
  g.fillStyle = F.lit;  g.fillRect(-rw, yE + 0.6, rw * 2, 0.7);
  g.fillStyle = bdRgba(R.edge, 0.5);
  g.fillRect(-rw, yE - 1.8, rw * 1.1, 0.8);

  // --- rafter feet showing under the overhang, at both ends only (cheap, and
  // it is the detail that reads as "built" at 2x zoom)
  g.fillStyle = bdRgba(F.shade, 0.9);
  for (let i = 0; i < 3; i++) {
    g.fillRect(-rw + 2 + i * 3.4, yE + 2.4, 1.6, 1.6);
    g.fillRect(rw - 5.6 - i * 3.4, yE + 2.4, 1.6, 1.6);
  }
}

/** Ottoman variant: a lead dome on a drum, in place of a hipped roof. */
function bdDome(g, G, o) {
  const R = o.roof || bdRamp(BMAT.SLATE);
  const cx = 0, base = G.yE + 1;
  const dr = G.rw * 0.82;

  // drum
  const D = bdRamp(bdMix(BMAT.STONE, R.base, 0.25));
  bdRect(g, -dr * 0.92, base - G.h * 0.10, dr * 1.84, G.h * 0.10 + 1, D, { litW: 1.2 });

  // dome as a half-ellipse: base fill, a hard shade crescent on the down-right,
  // and a lit crescent up-left. No gradient — hard-edged, like everything else.
  const dy = base - G.h * 0.10;
  const dh = G.roofH * 1.05;
  bdLitPath(g, function (c) {
    c.moveTo(-dr, dy);
    c.bezierCurveTo(-dr, dy - dh * 1.28, dr, dy - dh * 1.28, dr, dy);
    c.closePath();
  }, R, { bbox: [-dr, dy - dh, dr * 2, dh], shadeX: 0.64, shadeY: 1, litW: 1.8, edge: true });

  // ribbing — meridian lines, each with a lit lip on its sunward side
  g.save();
  g.beginPath();
  g.moveTo(-dr, dy);
  g.bezierCurveTo(-dr, dy - dh * 1.28, dr, dy - dh * 1.28, dr, dy);
  g.closePath();
  g.clip();
  for (let i = -3; i <= 3; i++) {
    const t = i / 3.4;
    g.strokeStyle = bdRgba(R.line, 0.45); g.lineWidth = 1.0;
    g.beginPath();
    g.moveTo(dr * t, dy);
    g.quadraticCurveTo(dr * t * 0.6, dy - dh * 0.75, 0, dy - dh * 0.96);
    g.stroke();
  }
  g.restore();

  // finial and crescent
  const M = bdRamp('#C9A24E');
  bdBeam(g, M, cx, dy - dh * 0.94, cx, dy - dh * 1.18, 1.6, { cap: 'butt' });
  g.strokeStyle = M.lit; g.lineWidth = 1.8;
  g.beginPath();
  g.arc(cx + 1.2, dy - dh * 1.30, 3.2, Math.PI * 0.42, Math.PI * 1.52);
  g.stroke();
  g.strokeStyle = M.edge; g.lineWidth = 0.7;
  g.beginPath();
  g.arc(cx + 1.0, dy - dh * 1.32, 3.2, Math.PI * 0.72, Math.PI * 1.42);
  g.stroke();
}


/* ---------------------------------------------------------------------------
   6. THE TEN BUILDING PAINTERS
   ACCEPTANCE TEST — the 8-pixel black-shape gate, applied to the building set
   as the bible requires. Rendered as pure black at 8px height these must all
   remain tellable apart, so each type is given ONE structural signature that
   lives in the outline, not in its colour:
     town_center  tall belfry spike offset up-left of a very wide mass
     house        small, plain, single gable + one chimney
     farm         flat — no vertical mass at all, the only such piece
     mill         a CROSS of four sails, unmistakable at any size
     lumber_camp  low mono-pitch lean-to + a stepped stack of log ends
     mine         A-frame headframe triangle with a RING (pulley) in it
     barracks     long low mass fronted by a row of sharpened stakes
     stable       long mass pierced by a large arched HOLE
     foundry      wide mass with a tall chimney hard against its right edge
     tower        narrow, tall, with a notched (crenellated) crown
   ------------------------------------------------------------------------ */

/** Shared: roof material tinted a few points toward the nation's roof colour,
 *  so a settlement reads as one nation without every roof being identical. */
function bdRoofMat(baseHex, natRoof, t) {
  return bdRamp(bdMix(baseHex, natRoof, t == null ? 0.22 : t));
}

function bdPaintTownCenter(g, o) {
  const def = o.def;
  const ottoman = o.nation === 'ottoman';
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.40, groundK: 0.40, wallK: 0.50,
    overK: 0.055, roofK: 0.36, hipK: 0.58, plinthK: 0.13,
  });
  const wall = bdRamp(ottoman ? BMAT.PLASTER_WARM : BMAT.BRICK_RED);
  const roof = ottoman
    ? bdRamp(bdMix(BMAT.SLATE, o.natRoof, 0.55))
    : bdRoofMat(BMAT.SLATE, o.natRoof, 0.48);

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'plain' });
  if (!ottoman) {
    bdBrickCourses(g, -G.bw, G.yE, G.bw * 2, G.yG - G.plinth - G.yE, wall, o.seed * 17);
  } else {
    // A restrained limestone string course binds the Ottoman civic façade.
    const band = bdRamp(BMAT.LIMESTONE);
    bdRect(g, -G.bw, G.yE + G.wallH * 0.45, G.bw * 2, 2.3, band, { litW: 0.7, edge: true });
  }

  // Ashlar quoins at both corners — a civic building is dressed in stone
  const Q = bdRamp(BMAT.LIMESTONE);
  const qh = (G.yG - G.plinth - G.yE) / 7;
  for (let i = 0; i < 7; i++) {
    const inset = i % 2 ? 1.5 : 0;
    bdRect(g, -G.bw - 1, G.yE + i * qh, 8.5 - inset, qh - 0.5, Q, { litW: 0.65 });
    bdRect(g, G.bw - 7.5 + inset, G.yE + i * qh, 8.5 - inset, qh - 0.5, Q, { litW: 0.65 });
  }

  // Symmetrical upper storey: sash windows for England, pointed lattice for
  // the Ottoman seat. This is the strongest nation read below roof height.
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    if (ottoman) bdArchedWindow(g, i * G.bw * 0.36, G.yE + G.h * 0.16, 8, 13);
    else bdSashWindow(g, i * G.bw * 0.36, G.yE + G.h * 0.16, 9, 13, {});
  }

  // The English portico is genuinely classical rather than a row of stone
  // rectangles: four tapered, fluted columns, moulded capitals, dentils and a
  // deep pediment. The Ottoman front substitutes an arcaded loggia.
  const pW = G.bw * 0.62, pTop = G.yE + G.h * 0.30, pBot = G.yG - G.plinth * 0.4;
  g.fillStyle = bdShadow(0.34);
  g.fillRect(-pW + 2, pTop + 2, pW * 2, pBot - pTop);
  bdDoor(g, 0, pBot, 15, G.h * 0.22, BD_SIDE[o.side].rim, { arch: ottoman });
  if (ottoman) {
    const archY = pTop + 5.5;
    g.strokeStyle = Q.base; g.lineWidth = 2.4;
    for (let bay = -1; bay <= 1; bay++) {
      const cx = bay * pW * 0.62;
      g.beginPath();
      g.moveTo(cx - pW * 0.28, pBot - 1);
      g.lineTo(cx - pW * 0.28, archY + 8);
      g.quadraticCurveTo(cx - pW * 0.16, archY, cx, archY - 4);
      g.quadraticCurveTo(cx + pW * 0.16, archY, cx + pW * 0.28, archY + 8);
      g.lineTo(cx + pW * 0.28, pBot - 1);
      g.stroke();
    }
    for (const cx of [-pW, -pW * 0.34, pW * 0.34, pW]) {
      bdClassicalColumn(g, cx, pTop - 1, pBot, 5.4, Q);
    }
    bdDentilCourse(g, -pW - 3, pTop - 4, pW * 2 + 6, Q, 15);
  } else {
    for (const cx of [-pW * 0.78, -pW * 0.26, pW * 0.26, pW * 0.78]) {
      bdClassicalColumn(g, cx, pTop, pBot, 6.2, Q);
    }
    bdDentilCourse(g, -pW - 3, pTop - 4.2, pW * 2 + 6, Q, 16);
    bdPoly(g, [-pW - 4, pTop - 4.2, 0, pTop - G.h * 0.15, pW + 4, pTop - 4.2],
      Q, { litW: 1.2, edge: true, shadeX: 0.66 });
    // Recessed tympanum and round civic seal give the pediment real depth.
    bdPoly(g, [-pW * 0.76, pTop - 6.4, 0, pTop - G.h * 0.12, pW * 0.76, pTop - 6.4],
      bdRamp(bdMix(BMAT.LIMESTONE, BMAT.PLASTER_WARM, 0.55)), { litW: 0.65, edge: true });
    bdEllipse(g, 0, pTop - G.h * 0.072, 3.2, 3.2, bdRamp(BD_SIDE[o.side].rim),
      { litW: 0.7, edge: true });
  }

  // Steps down to the board
  const St = bdRamp(bdMix(BMAT.STONE, BT.EARTH, 0.18));
  for (let i = 0; i < 3; i++) {
    bdRect(g, -pW * 0.7 - i * 5, G.yG - 6 + i * 2.6, pW * 1.4 + i * 10, 3.0, St, { litW: 0.8 });
  }

  if (ottoman) bdDome(g, G, { roof: roof });
  else bdRoof(g, G, { roof: roof, roofKind: 'slate', seed: o.seed, pitch: 3.5 });

  // BELFRY — the silhouette signature. Deliberately offset up-LEFT of centre
  // so the mass is asymmetric and the tower catches the lamp on its own face.
  const bx = -G.rr * 0.52, bBot = G.yR + 3, bH = G.h * 0.30, bW = def.w * 0.11;
  bdRect(g, bx - bW, bBot - bH, bW * 2, bH, wall, { litW: 1.3, edge: true });
  bdStoneCourses(g, function (c) { c.rect(bx - bW, bBot - bH, bW * 2, bH); },
    bx - bW, bBot - bH, bW * 2, bH, wall, o.seed * 3 + 7, bH * 0.2);
  // Belfry / Ottoman clock pavilion — a real hole, with the bell hanging in it
  g.fillStyle = bdShadow(0.86);
  if (ottoman) {
    g.beginPath();
    g.moveTo(bx - bW * 0.46, bBot - bH * 0.28);
    g.lineTo(bx - bW * 0.46, bBot - bH * 0.68);
    g.quadraticCurveTo(bx, bBot - bH * 0.96, bx + bW * 0.46, bBot - bH * 0.68);
    g.lineTo(bx + bW * 0.46, bBot - bH * 0.28); g.closePath(); g.fill();
  } else {
    g.fillRect(bx - bW * 0.45, bBot - bH * 0.78, bW * 0.9, bH * 0.5);
  }
  const Bell = bdRamp('#AE8737');
  bdEllipse(g, bx, bBot - bH * 0.50, bW * 0.30, bW * 0.34, Bell, { litW: 0.6, edge: true });
  if (ottoman) {
    bdEllipse(g, bx, bBot - bH - 1, bW + 2, bW * 0.52, roof, { litW: 1.0, edge: true });
    const Gold = bdRamp('#C9A24E');
    bdBeam(g, Gold, bx, bBot - bH - 2, bx, bBot - bH - G.h * 0.13, 1.4, { cap: 'butt' });
    g.strokeStyle = Gold.lit; g.lineWidth = 1.5;
    g.beginPath(); g.arc(bx + 1, bBot - bH - G.h * 0.15, 3.0, Math.PI * 0.42, Math.PI * 1.5); g.stroke();
  } else {
    bdPoly(g, [bx - bW - 2, bBot - bH, bx, bBot - bH - G.h * 0.19, bx + bW + 2, bBot - bH],
      roof, { litW: 1.2, edge: true, shadeX: 0.62 });
  }

  // BANNER on the opposite side of the ridge, clear of the belfry
  bdBanner(g, G.rr * 0.66, G.yR + 2, G.h * 0.34, o.side,
    { w: 20, h: 14, dir: o.side === 0 ? 1 : -1 });
  return G;
}

function bdPaintHouse(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const ottoman = o.nation === 'ottoman';
  const brickHouse = !ottoman && o.variant % 2 === 0;
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.40, groundK: 0.42, wallK: 0.54,
    overK: 0.07, roofK: ottoman ? 0.42 : 0.38, hipK: 0.68, plinthK: 0.13,
  });
  const wallHex = ottoman ? BMAT.PLASTER_WARM
    : brickHouse ? bdShiftHSL(BMAT.BRICK_RED, s(-0.015, 0.015), 0, s(-0.05, 0.04))
      : bdShiftHSL(BMAT.CLAPBOARD, s(-0.01, 0.01), 0, s(-0.05, 0.03));
  const wall = bdRamp(wallHex);
  const roof = bdRoofMat(ottoman ? BMAT.TILE : BMAT.SLATE, o.natRoof, ottoman ? 0.30 : 0.45);

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'plain' });
  const facadeH = G.yG - G.plinth - G.yE;
  if (brickHouse) {
    bdBrickCourses(g, -G.bw, G.yE, G.bw * 2, facadeH, wall, o.seed * 13);
  } else if (!ottoman) {
    // Narrow lapped weatherboards with a bright upper lip.
    for (let y = G.yE + 3; y < G.yG - G.plinth; y += 3.4) {
      g.fillStyle = bdRgba(wall.shade, 0.45); g.fillRect(-G.bw, y, G.bw * 2, 0.7);
      g.fillStyle = bdRgba(wall.lit, 0.22); g.fillRect(-G.bw, y + 0.7, G.bw * 2, 0.45);
    }
  }

  if (ottoman) {
    bdArchedWindow(g, -G.bw * 0.52, G.yE + G.h * 0.22, 7.5, 11);
    bdArchedWindow(g, G.bw * 0.52, G.yE + G.h * 0.22, 7.5, 11);
  } else {
    bdSashWindow(g, -G.bw * 0.52, G.yE + G.h * 0.22, 8, 11, { keystone: brickHouse });
    bdSashWindow(g, G.bw * 0.52, G.yE + G.h * 0.22, 8, 11, { keystone: brickHouse });
  }
  bdDoor(g, 0, G.yG - G.plinth, 10, G.h * 0.29, BD_SIDE[o.side].rim, { arch: ottoman });

  if (!ottoman) {
    // A tiny but complete columned doorcase: bases, fluted shafts, a dentil
    // cornice and shallow pediment. It makes even the humble house colonial.
    const P = bdRamp(BMAT.LIMESTONE);
    const porchTop = G.yG - G.plinth - G.h * 0.30;
    const porchBot = G.yG - G.plinth + 0.5;
    bdClassicalColumn(g, -8.2, porchTop, porchBot, 3.2, P);
    bdClassicalColumn(g, 8.2, porchTop, porchBot, 3.2, P);
    bdDentilCourse(g, -11.5, porchTop - 2.0, 23, P, 7);
    bdPoly(g, [-12, porchTop - 2, 0, porchTop - 8, 12, porchTop - 2], P,
      { litW: 0.65, edge: true });
  } else {
    const band = bdRamp(BMAT.LIMESTONE);
    bdDentilCourse(g, -G.bw * 0.62, G.yE - 1.5, G.bw * 1.24, band, 9);
  }

  bdRoof(g, G, { roof: roof, roofKind: ottoman ? 'tile' : 'slate', seed: o.seed, pitch: ottoman ? 4.1 : 3.3 });

  bdChimney(g, G.bw * 0.62, G.yE + 2, 7.5, G.h * 0.38);
  bdRidgePennant(g, -G.rr * 0.5, G.yR - 1, o.side, o.side === 0 ? 1 : -1);

  // A woodpile and a water butt against the wall — lived-in, and they break
  // the rectangle of the footprint
  bdLogPile(g, -G.bw * 0.72, G.yG - 1, 16, 2, o.seed * 5);
  return G;
}

function bdPaintMill(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const ottoman = o.nation === 'ottoman';
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.26, groundK: 0.40, wallK: 0.76,
    overK: 0.05, roofK: 0.26, hipK: 0.30, plinthK: 0.14,
  });
  const wall = bdRamp(ottoman ? BMAT.STONE : BMAT.BRICK_RED);
  const roof = bdRoofMat(ottoman ? BMAT.TILE : BMAT.SLATE, o.natRoof, 0.38);

  // A tapered tower mill: the body narrows as it rises, which is both correct
  // and gives the silhouette a shape a plain box does not have.
  const yTop = G.yE, yBot = G.yG - G.plinth;
  const wTop = G.bw * 0.74, wBot = G.bw;
  bdWalls(g, G, { wall: wall, seed: o.seed, plinth: true, material: 'plain' });
  bdPoly(g, [-wBot, yBot, -wTop, yTop, wTop, yTop, wBot, yBot], wall,
    { litW: 1.6, edge: true, shadeX: 0.66, bbox: [-wBot, yTop, wBot * 2, yBot - yTop] });
  if (ottoman) {
    bdStoneCourses(g, function (c) {
      c.moveTo(-wBot, yBot); c.lineTo(-wTop, yTop); c.lineTo(wTop, yTop);
      c.lineTo(wBot, yBot); c.closePath();
    }, -wBot, yTop, wBot * 2, yBot - yTop, wall, o.seed * 11, (yBot - yTop) * 0.11);
    bdArchedWindow(g, -wBot * 0.3, yTop + (yBot - yTop) * 0.30, 6.5, 9);
    bdArchedWindow(g, wBot * 0.3, yTop + (yBot - yTop) * 0.62, 6.5, 9);
  } else {
    bdBrickCourses(g, -wBot, yTop, wBot * 2, yBot - yTop, wall, o.seed * 11);
    bdSashWindow(g, -wBot * 0.3, yTop + (yBot - yTop) * 0.30, 6.5, 8.5, { keystone: true });
    bdSashWindow(g, wBot * 0.3, yTop + (yBot - yTop) * 0.62, 6.5, 8.5, { keystone: true });
  }
  bdDoor(g, 0, yBot, 10, (yBot - yTop) * 0.34, BD_SIDE[o.side].rim, { arch: true });

  // Conical cap
  bdPoly(g, [-wTop - 3, yTop + 1, 0, G.yR - G.h * 0.10, wTop + 3, yTop + 1],
    roof, { litW: 1.4, edge: true, shadeX: 0.62 });
  bdRoofCourses(g, function (c) {
    c.moveTo(-wTop - 3, yTop + 1); c.lineTo(0, G.yR - G.h * 0.10);
    c.lineTo(wTop + 3, yTop + 1); c.closePath();
  }, -wTop - 3, G.yR - G.h * 0.10, wTop * 2 + 6, yTop - G.yR + G.h * 0.10,
    roof, ottoman ? 'tile' : 'slate', o.seed * 13, 3.6);

  // THE SAILS — the silhouette. Four lattice arms on a hub, set at an angle
  // so the cross is dynamic rather than a plus sign, with the two up-left arms
  // catching the lamp and the two down-right arms in shade.
  const hx = 0, hy = yTop + (yBot - yTop) * 0.14, armL = def.w * 0.52;
  const W = bdRamp(BMAT.TIMBER);
  const C = bdRamp(BMAT.CANVAS);
  // Only eight angles are needed for convincing motion because the four sails
  // are rotationally symmetric. The complete frame is baked lazily, so this
  // still costs exactly one drawImage at runtime.
  const tilt = 0.42 + ((o.animFrame || 0) / BD_MILL_FRAMES) * (Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = tilt + i * Math.PI / 2;
    const ex = hx + Math.cos(a) * armL, ey = hy + Math.sin(a) * armL;
    const lit = (Math.cos(a) * bdSUN.x + Math.sin(a) * bdSUN.y) > 0;
    // whip
    bdBeam(g, W, hx, hy, ex, ey, 2.4, { cap: 'butt', edgeA: lit ? 1 : 0.35 });
    // sail cloth on the trailing side of each whip, as a ladder of bars
    const nx = -Math.sin(a), ny = Math.cos(a);
    g.strokeStyle = lit ? C.lit : C.shade;
    g.lineWidth = 1.5;
    for (let k = 3; k <= 9; k++) {
      const t = k / 10;
      const bx0 = hx + Math.cos(a) * armL * t, by0 = hy + Math.sin(a) * armL * t;
      g.beginPath();
      g.moveTo(bx0, by0);
      g.lineTo(bx0 + nx * armL * 0.20, by0 + ny * armL * 0.20);
      g.stroke();
    }
    g.strokeStyle = lit ? C.edge : C.base;
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(hx + Math.cos(a) * armL * 0.28 + nx * armL * 0.20,
      hy + Math.sin(a) * armL * 0.28 + ny * armL * 0.20);
    g.lineTo(ex + nx * armL * 0.20, ey + ny * armL * 0.20);
    g.stroke();
  }
  // hub
  const I = bdRamp(BMAT.IRON);
  bdEllipse(g, hx, hy, 4.2, 4.2, I, { litW: 1.0, edge: true });

  bdRidgePennant(g, wTop * 0.9, yTop, o.side, o.side === 0 ? 1 : -1);
  return G;
}

function bdPaintLumberCamp(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.42, groundK: 0.44, wallK: 0.38,
    overK: 0.10, roofK: 0.30, hipK: 0.70, plinthK: 0.06,
  });
  const wall = bdRamp(BMAT.LOG);
  const roof = bdRamp(BMAT.SHINGLE);

  // An OPEN-SIDED lean-to: back wall only, four posts, and a single-pitch roof
  // whose high edge is up-LEFT so the whole plane faces the lamp.
  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'log', plinth: false });

  const yHigh = G.yE - G.h * 0.16, yLow = G.yE + G.h * 0.10;
  // posts, drawn before the roof so the roof visibly rests on them
  const P = bdRamp(BT.TRUNK);
  bdBeam(g, P, -G.bw + 4, G.yG, -G.bw + 4, yHigh + 3, 3.4, { cap: 'butt' });
  bdBeam(g, P, G.bw - 4, G.yG, G.bw - 4, yLow + 3, 3.4, { cap: 'butt' });

  // mono-pitch roof plane
  const rw = G.rw;
  bdPoly(g, [-rw, yHigh, rw, yLow, rw, yLow + 4.5, -rw, yHigh + 4.5],
    roof, { litW: 1.6, edge: true, shadeX: 0.68, shadeY: 0.62 });
  bdRoofCourses(g, function (c) {
    c.moveTo(-rw, yHigh); c.lineTo(rw, yLow); c.lineTo(rw, yLow + 4.5);
    c.lineTo(-rw, yHigh + 4.5); c.closePath();
  }, -rw, yHigh, rw * 2, yLow - yHigh + 5, roof, 'shingle', o.seed * 7, 3.8);
  // deep shadow in the open bay under the roof
  g.fillStyle = bdShadow(0.50);
  g.fillRect(-G.bw + 5, yHigh + 5, G.bw * 2 - 10, G.h * 0.14);

  // THE LOG STACK — the second half of the silhouette, a stepped block of
  // circles that no other building has
  bdLogPile(g, -G.bw * 0.44, G.yG + 1, 30, 3, o.seed * 3);
  bdLogPile(g, G.bw * 0.60, G.yG - 1, 20, 2, o.seed * 5);

  // Chopping block with an axe buried in it, and a heap of chips
  const B = bdRamp(BMAT.LOG);
  bdEllipse(g, G.bw * 0.10, G.yG - 3, 6.5, 5.5, B, { litW: 0.9, edge: true });
  const St = bdRamp(BMAT.IRON), Hf = bdRamp(BMAT.TIMBER);
  bdBeam(g, Hf, G.bw * 0.10, G.yG - 7, G.bw * 0.10 + 8, G.yG - 17, 1.8, { cap: 'butt' });
  bdPoly(g, [G.bw * 0.10 + 7, G.yG - 16, G.bw * 0.10 + 13, G.yG - 20,
    G.bw * 0.10 + 14, G.yG - 15, G.bw * 0.10 + 9, G.yG - 13], St,
    { litW: 0.7, edge: true });
  const chips = bdRnd(o.seed * 9);
  for (let i = 0; i < 22; i++) {
    g.fillStyle = bdRgba(chips(0, 1) > 0.5 ? BT.STRAW : BT.EARTH_LIGHT, chips(0.3, 0.7));
    g.fillRect(G.bw * 0.10 + chips(-14, 14), G.yG + chips(-2, 5), chips(1, 3), 1.4);
  }

  bdRidgePennant(g, -G.bw * 0.72, yHigh, o.side, o.side === 0 ? 1 : -1);
  return G;
}

function bdPaintMine(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.30, groundK: 0.44, wallK: 0.30,
    overK: 0.08, roofK: 0.24, hipK: 0.60, plinthK: 0.10,
  });
  const rockR = bdRamp(BT.ROCK);

  // SPOIL HEAP behind the workings — irregular, palette-lawful, and it is what
  // makes the adit read as cut INTO something rather than stuck on the grass.
  const spoil = bdRamp(bdLawful(bdMix(BT.EARTH, BT.ROCK, 0.35)));
  bdLitPath(g, function (c) {
    c.moveTo(-G.w * 0.44, G.yG + 2);
    c.quadraticCurveTo(-G.w * 0.30, G.yG - G.h * 0.44, 0, G.yG - G.h * 0.40);
    c.quadraticCurveTo(G.w * 0.34, G.yG - G.h * 0.36, G.w * 0.46, G.yG + 3);
    c.closePath();
  }, spoil, {
    bbox: [-G.w * 0.44, G.yG - G.h * 0.44, G.w * 0.9, G.h * 0.44],
    litW: 1.6, shadeX: 0.62,
  });
  const rr2 = bdRnd(o.seed * 3);
  for (let i = 0; i < 30; i++) {
    const px = rr2(-G.w * 0.4, G.w * 0.42), py = G.yG - rr2(0, G.h * 0.34);
    const lit = px < 0;
    g.fillStyle = bdRgba(lit ? BT.ROCK_LIGHT : BT.ROCK_DARK, rr2(0.3, 0.7));
    g.beginPath(); g.arc(px, py, rr2(0.8, 2.4), 0, BD_TAU); g.fill();
  }

  // THE ADIT — a shored tunnel mouth. A true black hole in the silhouette.
  const aw = G.w * 0.17, ah = G.h * 0.30, ay = G.yG - G.h * 0.04;
  g.fillStyle = '#0E0C10';
  g.beginPath();
  g.moveTo(-aw, ay);
  g.lineTo(-aw, ay - ah * 0.6);
  g.quadraticCurveTo(0, ay - ah * 1.25, aw, ay - ah * 0.6);
  g.lineTo(aw, ay);
  g.closePath();
  g.fill();
  // shoring timbers framing the mouth
  const T = bdRamp(BMAT.TIMBER);
  bdBeam(g, T, -aw - 2, ay + 2, -aw - 2, ay - ah * 0.72, 3.6, { cap: 'butt' });
  bdBeam(g, T, aw + 2, ay + 2, aw + 2, ay - ah * 0.72, 3.6, { cap: 'butt' });
  bdBeam(g, T, -aw - 4, ay - ah * 0.72, aw + 4, ay - ah * 0.72, 3.6, { cap: 'butt' });

  // HEADFRAME — an A-frame of timbers carrying a pulley RING. Triangle plus
  // hole: the strongest possible small silhouette, and unique in the set.
  const hy = G.yG - G.h * 0.86, hw = G.w * 0.22;
  bdBeam(g, T, -hw, G.yG - 2, 0, hy, 3.4, { cap: 'butt' });
  bdBeam(g, T, hw, G.yG - 2, 0, hy, 3.4, { cap: 'butt' });
  bdBeam(g, T, -hw * 0.55, G.yG - G.h * 0.42, hw * 0.55, G.yG - G.h * 0.42, 2.6, { cap: 'butt' });
  bdWheelRing(g, 0, hy + 2, G.w * 0.085, bdRamp(BMAT.IRON), 6);
  // hoist rope down into the adit
  g.strokeStyle = bdRgba('#3A3128', 0.9); g.lineWidth = 1.0;
  g.beginPath(); g.moveTo(1.5, hy + 2); g.lineTo(1.5, ay - ah * 0.5); g.stroke();

  // An ore tub on rails at the mouth
  const I = bdRamp(BMAT.IRON);
  bdRect(g, aw + 6, G.yG - 11, 15, 8, bdRamp(BMAT.TIMBER), { litW: 0.9, edge: true });
  bdWheelRing(g, aw + 10, G.yG - 2.5, 3.2, I, 4);
  bdWheelRing(g, aw + 18, G.yG - 2.5, 3.2, I, 4);
  // ore spilling out, warm against the cool rock
  const oreR = bdRnd(o.seed * 7);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = bdRgba(oreR(0, 1) > 0.5 ? '#B99535' : '#8A7A52', oreR(0.5, 0.9));
    g.beginPath();
    g.arc(aw + oreR(6, 22), G.yG - oreR(6, 10), oreR(0.9, 2.0), 0, BD_TAU);
    g.fill();
  }

  bdBanner(g, -hw - 5, G.yG - 2, G.h * 0.62, o.side,
    { w: 13, h: 10, dir: o.side === 0 ? -1 : 1 });
  return G;
}

function bdPaintBarracks(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const ottoman = o.nation === 'ottoman';
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.44, groundK: 0.40, wallK: 0.44,
    overK: 0.05, roofK: 0.34, hipK: 0.68, plinthK: 0.12,
  });
  const wall = bdRamp(ottoman ? BMAT.PLASTER_WARM : BMAT.BRICK_RED);
  const roof = bdRoofMat(ottoman ? BMAT.TILE : BMAT.SLATE, o.natRoof, 0.44);

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'plain' });
  if (ottoman) {
    const band = bdRamp(BMAT.LIMESTONE);
    bdRect(g, -G.bw, G.yE + G.wallH * 0.49, G.bw * 2, 2.0, band, { litW: 0.6, edge: true });
  } else {
    bdBrickCourses(g, -G.bw, G.yE, G.bw * 2, G.yG - G.plinth - G.yE, wall, o.seed * 19);
  }

  // A long regular range of shuttered barrack windows — repetition IS the
  // character of a barracks, exactly as irregularity is the character of a
  // cottage. The rhythm is the read.
  for (let i = -3; i <= 3; i++) {
    if (ottoman) bdArchedWindow(g, i * G.bw * 0.27, G.yE + G.h * 0.19, 7, 11);
    else bdSashWindow(g, i * G.bw * 0.27, G.yE + G.h * 0.19, 7, 10.5, { keystone: true });
  }
  bdDoor(g, 0, G.yG - G.plinth, 16, G.h * 0.26, BD_SIDE[o.side].rim, { arch: ottoman });

  if (!ottoman) {
    // Regimental entrance portico with paired Doric columns and a pediment.
    const P = bdRamp(BMAT.LIMESTONE);
    const top = G.yG - G.plinth - G.h * 0.29;
    const bot = G.yG - G.plinth + 1;
    bdClassicalColumn(g, -13, top, bot, 4.5, P);
    bdClassicalColumn(g, 13, top, bot, 4.5, P);
    bdDentilCourse(g, -18, top - 2.5, 36, P, 9);
    bdPoly(g, [-19, top - 2.5, 0, top - 12, 19, top - 2.5], P,
      { litW: 0.85, edge: true });
    bdEllipse(g, 0, top - 6.5, 2.3, 2.3, bdRamp(BD_SIDE[o.side].rim), { litW: 0.5, edge: true });
  }

  bdRoof(g, G, { roof: roof, roofKind: ottoman ? 'tile' : 'slate', seed: o.seed, pitch: ottoman ? 4.2 : 3.3 });

  // Two dormer windows breaking the roofline — cheap, and they stop a long
  // roof reading as one dead slab
  for (const dx of [-G.rr * 0.55, G.rr * 0.55]) {
    const dy = G.yR + (G.yE - G.yR) * 0.42;
    bdPoly(g, [dx - 6, dy + 6, dx - 6, dy - 1, dx, dy - 6, dx + 6, dy - 1, dx + 6, dy + 6],
      roof, { litW: 1.0, edge: true });
    if (ottoman) bdArchedWindow(g, dx, dy + 1, 5.5, 6.5);
    else bdSashWindow(g, dx, dy + 1, 5.5, 6.5, { keystone: false });
  }

  // PALISADE — a row of sharpened stakes across the front. This is the
  // silhouette signature: a saw-tooth fringe at the base that only the
  // barracks has.
  const P = bdRamp(BT.TRUNK);
  const py = G.yG + G.h * 0.10;
  for (let i = -6; i <= 6; i++) {
    const px = i * def.w * 0.075 + s(-1.2, 1.2);
    const ph = def.h * 0.20 * s(0.88, 1.1);
    bdBeam(g, P, px, py, px, py - ph, 3.6, { cap: 'butt' });
    // sharpened tip
    bdPoly(g, [px - 1.8, py - ph, px, py - ph - 3.4, px + 1.8, py - ph], P,
      { litW: 0.6, line: false });
  }
  // horizontal binding rail across the stakes
  g.fillStyle = P.shade; g.fillRect(-def.w * 0.47, py - def.h * 0.10, def.w * 0.94, 2.2);
  g.fillStyle = P.lit;   g.fillRect(-def.w * 0.47, py - def.h * 0.10, def.w * 0.94, 0.8);

  // A rack of muskets leaning in a tripod beside the door
  const W = bdRamp('#6B4A28'), Stl = bdRamp('#8A9099');
  for (let i = 0; i < 3; i++) {
    const bx = G.bw * 0.62 + i * 2.4;
    bdBeam(g, W, bx - 4 + i * 3, G.yG - 1, bx + 1, G.yG - 22, 1.5, { cap: 'butt' });
    g.fillStyle = Stl.lit;
    g.fillRect(bx + 0.4, G.yG - 24, 1.1, 3);
  }

  bdBanner(g, -G.rr * 0.72, G.yR + 1, G.h * 0.40, o.side,
    { w: 18, h: 13, dir: o.side === 0 ? -1 : 1 });
  return G;
}

function bdPaintStable(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const ottoman = o.nation === 'ottoman';
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.44, groundK: 0.40, wallK: 0.46,
    overK: 0.06, roofK: 0.36, hipK: 0.60, plinthK: 0.10,
  });
  const wall = bdRamp(ottoman ? BMAT.PLASTER_WARM : bdMix(BMAT.BRICK_RED, BMAT.STONE, 0.08));
  const roof = bdRoofMat(ottoman ? BMAT.TILE : BMAT.SLATE, o.natRoof, 0.38);

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'plain' });
  if (!ottoman) {
    bdBrickCourses(g, -G.bw, G.yE, G.bw * 2, G.yG - G.plinth - G.yE, wall, o.seed * 23);
  }

  // THE ARCH — a big carriage opening, genuinely void. A hole this size in a
  // long low mass is the stable's signature and nothing else in the set has it.
  const aw = G.bw * 0.42, ay = G.yG - G.plinth;
  const ah = (ay - G.yE) * 0.92;
  g.fillStyle = '#100E12';
  g.beginPath();
  g.moveTo(-aw, ay);
  g.lineTo(-aw, ay - ah + aw);
  g.arc(0, ay - ah + aw, aw, Math.PI, 0);
  g.lineTo(aw, ay);
  g.closePath();
  g.fill();
  // voussoir arch ring in dressed stone
  const Q = bdRamp(BMAT.STONE);
  g.save();
  g.lineCap = 'butt';
  g.strokeStyle = Q.base; g.lineWidth = 4.4;
  g.beginPath();
  g.moveTo(-aw, ay); g.lineTo(-aw, ay - ah + aw);
  g.arc(0, ay - ah + aw, aw, Math.PI, 0);
  g.lineTo(aw, ay);
  g.stroke();
  g.strokeStyle = Q.lit; g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, ay - ah + aw, aw + 1.4, Math.PI * 0.98, Math.PI * 1.55);
  g.stroke();
  g.restore();
  bdAO(g, 0, ay - ah * 0.4, aw * 1.2, ah * 0.5, 0.40);
  // side-colour lintel keystone
  const S = bdRamp(BD_SIDE[o.side].rim);
  bdPoly(g, [-4.2, ay - ah + aw - aw * 0.98, 4.2, ay - ah + aw - aw * 0.98,
    3.0, ay - ah + aw - aw * 0.72, -3.0, ay - ah + aw - aw * 0.72], S,
    { litW: 0.8, edge: true });

  // Dutch (split) stall doors either side, top halves open onto darkness
  for (const dx of [-G.bw * 0.66, G.bw * 0.66]) {
    g.fillStyle = bdShadow(0.80);
    g.fillRect(dx - 6, G.yE + G.h * 0.10, 12, G.h * 0.14);
    bdRect(g, dx - 6, G.yE + G.h * 0.24, 12, G.h * 0.16, bdRamp(BMAT.DOOR),
      { litW: 0.9, edge: true });
    if (ottoman) bdArchedWindow(g, dx, G.yE + G.h * 0.12, 7, 9);
    else bdSashWindow(g, dx, G.yE + G.h * 0.12, 7, 8, { keystone: true });
  }

  bdRoof(g, G, { roof: roof, roofKind: ottoman ? 'tile' : 'slate', seed: o.seed, pitch: ottoman ? 4.2 : 3.4 });

  // HAY LOFT: a gable door high in the roof with a projecting hoist beam and a
  // dangling block — the detail that says "horses live here"
  const T = bdRamp(BMAT.TIMBER);
  const ly = G.yR + (G.yE - G.yR) * 0.34;
  g.fillStyle = bdShadow(0.82);
  g.fillRect(-7, ly, 14, 12);
  bdBeam(g, T, 0, ly - 1, 0, ly - 12, 2.6, { cap: 'butt' });
  bdBeam(g, T, -1, ly - 11, 14, ly - 13, 2.6, { cap: 'butt' });
  g.strokeStyle = bdRgba('#3A3128', 0.9); g.lineWidth = 1.0;
  g.beginPath(); g.moveTo(13, ly - 12.7); g.lineTo(13, ly - 4); g.stroke();
  const H = bdRamp(BT.STRAW);
  bdEllipse(g, 13, ly - 1.5, 3.4, 2.8, H, { litW: 0.7, edge: true });
  // loose hay spilling from the loft door
  const hay = bdRnd(o.seed * 11);
  g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.7); g.lineWidth = 0.8;
  for (let i = 0; i < 14; i++) {
    const hx0 = hay(-6, 6);
    g.beginPath();
    g.moveTo(hx0, ly + hay(0, 11));
    g.lineTo(hx0 + hay(-2, 2), ly + hay(2, 13));
    g.stroke();
  }

  // Paddock rail running off the up-left corner onto the board
  bdFence(g, -def.w * 0.52, -G.bw * 0.5, G.yG + G.h * 0.14, 12, o.seed * 3, 15);

  bdBanner(g, G.rr * 0.70, G.yR + 1, G.h * 0.36, o.side,
    { w: 17, h: 12, dir: o.side === 0 ? 1 : -1 });
  return G;
}

function bdPaintFoundry(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const ottoman = o.nation === 'ottoman';
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.40, groundK: 0.40, wallK: 0.50,
    overK: 0.05, roofK: 0.30, hipK: 0.66, plinthK: 0.14,
  });
  const wall = bdRamp(ottoman ? BMAT.STONE_ROUGH : bdMix(BMAT.BRICK_RED, '#744234', 0.18));
  const roof = bdRoofMat(BMAT.SLATE, o.natRoof, 0.45);

  // English foundries use fire-resistant Georgian brick; the Ottoman works
  // retain massive coursed stone. Both read as industrial mass.
  bdWalls(g, G, { wall: wall, seed: o.seed, material: ottoman ? 'stone' : 'plain' });
  if (!ottoman) {
    bdBrickCourses(g, -G.bw, G.yE, G.bw * 2, G.yG - G.plinth - G.yE, wall, o.seed * 29);
  }

  // Buttresses either side, battered (wider at the base)
  const Q = bdRamp(BMAT.STONE);
  for (const bx of [-G.bw * 0.74, G.bw * 0.30]) {
    bdPoly(g, [bx - 5, G.yG - G.plinth, bx - 3.2, G.yE + 3,
      bx + 3.2, G.yE + 3, bx + 5, G.yG - G.plinth], Q,
      { litW: 1.1, edge: true, shadeX: 0.62 });
  }

  for (const wx of [-G.bw * 0.58, G.bw * 0.56]) {
    if (ottoman) bdArchedWindow(g, wx, G.yE + G.h * 0.18, 8, 12);
    else bdSashWindow(g, wx, G.yE + G.h * 0.18, 8, 12, { keystone: true });
  }

  // THE FURNACE MOUTH — the one saturated non-team colour in the settlement,
  // and the only light source on the board that is not the sun. Kept small and
  // deep inside an arch so it reads as heat rather than as a decal.
  const fw = G.bw * 0.28, fy = G.yG - G.plinth;
  const fh = G.h * 0.26;
  g.fillStyle = '#120C0A';
  g.beginPath();
  g.moveTo(-fw, fy); g.lineTo(-fw, fy - fh + fw);
  g.arc(0, fy - fh + fw, fw, Math.PI, 0);
  g.lineTo(fw, fy); g.closePath();
  g.fill();
  const glow = g.createRadialGradient(0, fy - fh * 0.42, 0, 0, fy - fh * 0.42, fw * 1.5);
  glow.addColorStop(0, bdRgba('#FFD98A', 0.95));
  glow.addColorStop(0.35, bdRgba(BMAT.FORGE, 0.80));
  glow.addColorStop(1, bdRgba('#7A2A08', 0));
  g.fillStyle = glow;
  g.beginPath();
  g.moveTo(-fw, fy); g.lineTo(-fw, fy - fh + fw);
  g.arc(0, fy - fh + fw, fw, Math.PI, 0);
  g.lineTo(fw, fy); g.closePath();
  g.fill();
  // warm spill licking out onto the ground and up the arch stones
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const spill = g.createRadialGradient(0, fy, 0, 0, fy, fw * 3.2);
  spill.addColorStop(0, bdRgba(BMAT.FORGE, 0.34));
  spill.addColorStop(1, bdRgba(BMAT.FORGE, 0));
  g.fillStyle = spill;
  g.fillRect(-fw * 3.2, fy - fw * 3.2, fw * 6.4, fw * 4.0);
  g.restore();

  bdRoof(g, G, { roof: roof, roofKind: 'slate', seed: o.seed, pitch: 3.4 });

  // THE STACK — a tall brick chimney hard against the right edge of the mass.
  // Offset, not centred: an asymmetric spike is far more identifiable at 8px
  // than a symmetric one.
  bdChimney(g, G.bw * 0.78, G.yE + 4, 13, G.h * 0.86);
  // soot staining the roof beside the stack
  g.fillStyle = bdRgba('#241E1A', 0.34);
  g.beginPath();
  g.ellipse(G.bw * 0.78, G.yE - 2, 13, 5, 0, 0, BD_TAU);
  g.fill();

  // A finished cannon barrel on a trestle outside — the product on display
  const I = bdRamp('#3C4148'), T = bdRamp(BMAT.TIMBER);
  bdBeam(g, T, -G.bw * 0.90, G.yG + 6, -G.bw * 0.90, G.yG - 4, 2.4, { cap: 'butt' });
  bdBeam(g, T, -G.bw * 0.44, G.yG + 6, -G.bw * 0.44, G.yG - 4, 2.4, { cap: 'butt' });
  bdBeam(g, I, -G.bw * 1.00, G.yG - 5, -G.bw * 0.34, G.yG - 8, 6.4, { cap: 'butt' });
  bdEllipse(g, -G.bw * 1.00, G.yG - 5, 2.0, 3.4, I, { litW: 0.7, edge: true });
  // cast-iron pigs stacked by the door
  const P = bdRamp(BMAT.IRON);
  for (let i = 0; i < 4; i++) {
    bdRect(g, G.bw * 0.20 + (i % 2) * 3, G.yG - 3 - Math.floor(i / 2) * 4.2, 13, 4.0, P,
      { litW: 0.7, edge: true });
  }

  bdBanner(g, -G.rr * 0.66, G.yR + 1, G.h * 0.34, o.side,
    { w: 17, h: 12, dir: o.side === 0 ? -1 : 1 });
  return G;
}

function bdPaintTower(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  // A tower is all vertical: the footprint is small but the mass rises far
  // above it, so the geometry is driven off w rather than h.
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.36, groundK: 0.42, wallK: 1.42,
    overK: 0.14, roofK: 0.22, hipK: 0.40, plinthK: 0.16,
  });
  const wall = bdRamp(BMAT.STONE);
  const roof = bdRoofMat(BMAT.SLATE, o.natRoof, 0.40);

  // Battered base — the wall flares out where it meets the board
  const yBot = G.yG - G.plinth;
  bdPoly(g, [-G.bw * 1.22, G.yG, -G.bw, yBot - G.h * 0.20,
    G.bw, yBot - G.h * 0.20, G.bw * 1.22, G.yG], wall,
    { litW: 1.4, edge: true, shadeX: 0.64 });

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'stone' });

  // Arrow slits — tall thin voids, and their verticality reinforces the mass
  for (let i = 0; i < 3; i++) {
    const sy = G.yE + G.h * (0.22 + i * 0.34);
    g.fillStyle = '#0F0D11';
    g.fillRect(-2.0, sy, 4.0, G.h * 0.18);
    g.fillStyle = bdRgba(wall.edge, 0.5);
    g.fillRect(-2.6, sy - 0.8, 5.2, 0.9);
    g.fillStyle = bdRgba(wall.shade, 0.8);
    g.fillRect(2.0, sy, 1.0, G.h * 0.18);
  }
  bdDoor(g, 0, G.yG - G.plinth, 10, G.h * 0.26, BD_SIDE[o.side].rim, { arch: true });

  // MACHICOLATION — corbels carrying an oversailing fighting platform. The
  // outward step is what makes a tower read as a tower and not as a chimney.
  const my = G.yE + 2;
  const mw = G.bw * 1.30;
  const C = bdRamp(bdMix(BMAT.STONE, BMAT.STONE_ROUGH, 0.4));
  for (let i = -4; i <= 4; i++) {
    bdPoly(g, [i * mw * 0.22 - 2.4, my, i * mw * 0.22 + 2.4, my,
      i * mw * 0.22 + 1.4, my + 4.6, i * mw * 0.22 - 1.4, my + 4.6], C,
      { litW: 0.6, edge: true });
  }
  bdRect(g, -mw, my - 6.0, mw * 2, 6.4, C, { litW: 1.3, edge: true });

  // CRENELLATIONS — the notched crown, this piece's silhouette signature.
  // Real gaps, drawn as separate merlons with a shadowed embrasure between.
  const cy = my - 6.0;
  const merlonW = mw * 0.30, gap = mw * 0.14;
  for (let i = -2; i <= 2; i++) {
    const mx = i * (merlonW + gap);
    bdRect(g, mx - merlonW * 0.5, cy - 9, merlonW, 9.4, wall,
      { litW: 1.0, edge: true, shadeX: 0.64 });
  }
  // shadow inside the embrasures, so the notches read as depth not as paint
  g.fillStyle = bdShadow(0.44);
  for (let i = -2; i < 2; i++) {
    const mx = (i + 0.5) * (merlonW + gap);
    g.fillRect(mx - gap * 0.5, cy - 3.4, gap, 3.6);
  }

  // A small conical cap set back behind the crenellations
  bdPoly(g, [-mw * 0.52, cy - 8, 0, cy - G.h * 0.36, mw * 0.52, cy - 8],
    roof, { litW: 1.2, edge: true, shadeX: 0.60 });

  bdBanner(g, mw * 0.62, cy - 6, G.h * 0.44, o.side,
    { w: 14, h: 10, dir: o.side === 0 ? 1 : -1 });
  return G;
}

/* ---------------------------------------------------------------------------
   7. RESOURCE-NODE PROPS
   These are TERRAIN, not architecture, so they are painted in terrain.js's
   language exactly: the same foliage palette construction, the same lobe
   layout, the same "sun-facing lobes only" rule, the same 1px up-left edge
   light, the same speckle pass and the same multiply underside AO. A gatherable
   wood must be indistinguishable in handling from the woods on the board edge —
   if the player can tell which trees are harvestable by their paint job, the
   illusion of one modelled board is gone.
   ------------------------------------------------------------------------ */

let bdFoliagePal = null;

function bdBuildFoliagePalettes() {
  const rr = bdRnd(0x0F01A6E);
  const mk = function (deepC, baseC, litC) {
    const out = [];
    for (let i = 0; i < 16; i++) {
      const h = rr(-0.022, 0.022), sat = rr(-0.04, 0.04), l = rr(-0.05, 0.05);
      out.push({
        deep: bdShiftHSL(deepC, h, sat, l * 0.5),
        body: bdShiftHSL(baseC, h, sat, l),
        lit:  bdShiftHSL(litC, h, sat, l),
        edge: bdShiftHSL(BT.FOLIAGE_EDGE, h, sat, l),
      });
    }
    return out;
  };
  bdFoliagePal = {
    broadleaf: mk(BT.FOLIAGE_DEEP, BT.FOLIAGE_BASE, BT.FOLIAGE_LIT),
    conifer:   mk('#1E2B22', '#2C3F30', '#44573A'),
  };
}

/**
 * A tree, painted exactly as terrain.js paints one. `rr` is a seeded random so
 * a given node's trees never move between re-bakes at different depletion
 * steps — only their COUNT changes, so a wood visibly thins rather than
 * reshuffling.
 */
function bdTree(g, x, y, r, rr, species) {
  if (!bdFoliagePal) bdBuildFoliagePalettes();
  const sp = species || (rr(0, 1) < 0.14 ? 'conifer' : 'broadleaf');
  const variant = (rr(0, 16) | 0) & 15;
  const trunkH = r * (sp === 'conifer' ? 0.5 : 0.72);
  const height = r * 2.1;

  // cast shadow, obeying the one sun
  const off = height * bdSUN.lenMul;
  const sx = x + bdSUN.shadow.x * off;
  const sy = y + bdSUN.shadow.y * off * 0.62;
  const SR = r * 1.35;
  const grad = g.createRadialGradient(sx, sy, r * 0.15, sx, sy, SR);
  grad.addColorStop(0, bdShadow(0.50));
  grad.addColorStop(0.55, bdShadow(0.26));
  grad.addColorStop(1, bdShadow(0));
  g.save();
  g.translate(sx, sy); g.scale(1, bdSUN.squash + 0.08); g.translate(-sx, -sy);
  g.fillStyle = grad;
  g.beginPath(); g.arc(sx, sy, SR, 0, BD_TAU); g.fill();
  g.restore();

  // contact / AO pool at the base
  const ao = g.createRadialGradient(x, y, 0, x, y, r * 0.62);
  ao.addColorStop(0, bdShadow(0.42));
  ao.addColorStop(1, bdShadow(0));
  g.save();
  g.translate(x, y); g.scale(1, 0.46); g.translate(-x, -y);
  g.fillStyle = ao;
  g.beginPath(); g.arc(x, y, r * 0.62, 0, BD_TAU); g.fill();
  g.restore();

  // trunk, with a lit up-left band, a shaded lee band and a root flare
  const tw = Math.max(1.6, r * 0.17);
  const trunk = bdRamp(BT.TRUNK);
  g.fillStyle = trunk.line;
  g.fillRect(x - tw / 2 - 0.6, y - trunkH - 0.6, tw + 1.2, trunkH + 1.2);
  g.fillStyle = trunk.base;
  g.fillRect(x - tw / 2, y - trunkH, tw, trunkH);
  g.fillStyle = BT.TRUNK_LIT;
  g.fillRect(x - tw / 2, y - trunkH, Math.max(0.7, tw * 0.34), trunkH);
  g.fillStyle = trunk.shade;
  g.fillRect(x + tw / 2 - Math.max(0.6, tw * 0.26), y - trunkH, Math.max(0.6, tw * 0.26), trunkH);
  g.fillStyle = trunk.shade;
  g.beginPath();
  g.moveTo(x - tw * 1.5, y + 1);
  g.lineTo(x - tw * 0.5, y - trunkH * 0.28);
  g.lineTo(x + tw * 0.5, y - trunkH * 0.28);
  g.lineTo(x + tw * 1.5, y + 1);
  g.closePath(); g.fill();

  const isConifer = sp === 'conifer';
  const set = (isConifer ? bdFoliagePal.conifer : bdFoliagePal.broadleaf)[variant];
  const deep = set.deep, body = set.body, lit = set.lit, edge = set.edge;
  const cy = y - trunkH - r * (isConifer ? 0.55 : 0.42);
  const sqY = isConifer ? 1.22 : 1;

  const lobeN = (rr(7, 11.99)) | 0;
  const lobes = [];
  for (let i = 0; i < lobeN; i++) {
    const a = (i / lobeN) * BD_TAU + rr(-0.4, 0.4);
    const d = (i === 0 ? 0 : rr(0.18, 0.62)) * r;
    lobes.push({
      x: x + Math.cos(a) * d,
      y: cy + Math.sin(a) * d * sqY - (isConifer ? d * 0.3 : 0),
      r: (i === 0 ? rr(0.62, 0.78) : rr(0.34, 0.58)) * r,
    });
  }

  g.fillStyle = deep;
  for (const L of lobes) {
    g.beginPath(); g.ellipse(L.x + r * 0.06, L.y + r * 0.09, L.r, L.r * sqY, 0, 0, BD_TAU); g.fill();
  }
  g.fillStyle = body;
  for (const L of lobes) {
    g.beginPath(); g.ellipse(L.x, L.y, L.r * 0.94, L.r * 0.94 * sqY, 0, 0, BD_TAU); g.fill();
  }
  g.fillStyle = lit;
  for (const L of lobes) {
    if ((L.x - x) * bdSUN.x + (L.y - cy) * bdSUN.y < -r * 0.05) continue;
    g.beginPath();
    g.ellipse(L.x + bdSUN.x * L.r * 0.30, L.y + bdSUN.y * L.r * 0.30,
      L.r * 0.60, L.r * 0.60 * sqY, 0, 0, BD_TAU);
    g.fill();
  }
  g.strokeStyle = edge; g.lineWidth = 1.1;
  for (const L of lobes) {
    if ((L.x - x) * bdSUN.x + (L.y - cy) * bdSUN.y < r * 0.08) continue;
    g.beginPath();
    g.ellipse(L.x + bdSUN.x * 0.9, L.y + bdSUN.y * 0.9,
      L.r * 0.92, L.r * 0.92 * sqY, 0, Math.PI * 0.72, Math.PI * 1.72);
    g.stroke();
  }
  // leaf-clump speckle so the canopy is not a set of smooth discs
  const specN = Math.round(r * 2.6);
  for (let i = 0; i < specN; i++) {
    const L = lobes[(rr(0, lobes.length)) | 0];
    if (!L) continue;
    const a = rr(0, BD_TAU), d = Math.sqrt(rr(0, 1)) * L.r * 0.92;
    const px = L.x + Math.cos(a) * d, py = L.y + Math.sin(a) * d * sqY;
    const rel = (px - x) * bdSUN.x + (py - cy) * bdSUN.y;
    const col = rel > r * 0.2 ? edge : rel > -r * 0.1 ? lit : deep;
    g.fillStyle = bdRgba(col, rel > r * 0.2 ? 0.5 : 0.42);
    g.beginPath(); g.arc(px, py, rr(0.7, 1.9), 0, BD_TAU); g.fill();
  }
  // underside AO, multiplied so it darkens rather than veils
  g.save();
  g.globalCompositeOperation = 'multiply';
  const ug = g.createRadialGradient(
    x - bdSUN.x * r * 0.4, cy - bdSUN.y * r * 0.4, r * 0.1, x, cy + r * 0.35, r * 1.25);
  ug.addColorStop(0, 'rgba(255,255,255,0)');
  ug.addColorStop(0.55, 'rgba(210,214,226,0.10)');
  ug.addColorStop(1, 'rgba(120,128,152,0.42)');
  g.fillStyle = ug;
  g.beginPath(); g.ellipse(x, cy, r * 1.3, r * 1.3 * sqY, 0, 0, BD_TAU); g.fill();
  g.restore();
}

/** A berry bush, in terrain.js's drawBush language plus fruit. */
function bdBush(g, x, y, r, rr, berry) {
  bdContactShadow(g, x, y, r * 0.9, r * 1.4, 1);
  if (!bdFoliagePal) bdBuildFoliagePalettes();
  const set = bdFoliagePal.broadleaf[(rr(0, 16) | 0) & 15];
  const deep = set.deep, body = set.body, lit = set.lit;
  const n = (rr(4, 7.99)) | 0;
  const lobes = [];
  for (let i = 0; i < n; i++) {
    lobes.push({ x: x + rr(-r * 0.6, r * 0.6), y: y + rr(-r * 0.85, -r * 0.05), r: rr(0.42, 0.72) * r });
  }
  g.fillStyle = deep;
  for (const L of lobes) { g.beginPath(); g.arc(L.x + 0.8, L.y + 1.1, L.r, 0, BD_TAU); g.fill(); }
  g.fillStyle = body;
  for (const L of lobes) { g.beginPath(); g.arc(L.x, L.y, L.r * 0.92, 0, BD_TAU); g.fill(); }
  g.fillStyle = lit;
  for (const L of lobes) {
    if ((L.x - x) * bdSUN.x + (L.y - y) * bdSUN.y < 0) continue;
    g.beginPath();
    g.arc(L.x + bdSUN.x * L.r * 0.28, L.y + bdSUN.y * L.r * 0.28, L.r * 0.55, 0, BD_TAU);
    g.fill();
  }
  g.strokeStyle = bdRgba(BT.FOLIAGE_EDGE, 0.8); g.lineWidth = 1;
  for (const L of lobes) {
    if ((L.x - x) * bdSUN.x + (L.y - y) * bdSUN.y < r * 0.1) continue;
    g.beginPath();
    g.arc(L.x + bdSUN.x, L.y + bdSUN.y, L.r * 0.9, Math.PI * 0.72, Math.PI * 1.72);
    g.stroke();
  }
  // fruit: a dark base dot with a tiny specular pip on its up-left shoulder,
  // which is what makes a 2px dot read as a round berry rather than a speck
  if (berry) {
    const B = bdRamp(berry);
    for (let i = 0; i < 11; i++) {
      const L = lobes[(rr(0, lobes.length)) | 0];
      if (!L) continue;
      const a = rr(0, BD_TAU), d = Math.sqrt(rr(0, 1)) * L.r * 0.8;
      const px = L.x + Math.cos(a) * d, py = L.y + Math.sin(a) * d;
      g.fillStyle = B.shade;
      g.beginPath(); g.arc(px, py, rr(1.2, 2.0), 0, BD_TAU); g.fill();
      g.fillStyle = B.base;
      g.beginPath(); g.arc(px + bdSUN.x * 0.4, py + bdSUN.y * 0.4, rr(0.8, 1.3), 0, BD_TAU); g.fill();
      g.fillStyle = B.edge;
      g.beginPath(); g.arc(px + bdSUN.x * 0.8, py + bdSUN.y * 0.8, 0.45, 0, BD_TAU); g.fill();
    }
  }
}

/** A boulder, in terrain.js's drawRock language. `vein` adds ore. */
function bdRock(g, x, y, r, rr, baseHex, vein) {
  bdContactShadow(g, x, y, r * 1.05, r * 1.1, 1);
  const R = bdRamp(bdShiftHSL(baseHex, rr(-0.03, 0.03), rr(-0.02, 0.02), rr(-0.06, 0.06)));
  const n = (rr(5, 8.99)) | 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * BD_TAU + rr(-0.18, 0.18);
    const d = r * rr(0.72, 1.12);
    pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d * 0.72]);
  }
  const facet = function (c) {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
  };
  // lining first, as a dilated silhouette
  g.fillStyle = R.line;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1] + 1);
  for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1] + 1);
  g.closePath(); g.fill();
  g.fillStyle = R.base;
  g.beginPath(); facet(g); g.fill();
  // lit facet up-left, shade facet down-right — hard-edged, no gradient
  g.save();
  g.beginPath(); facet(g); g.clip();
  g.fillStyle = R.lit;
  g.beginPath();
  g.moveTo(x - r * 1.4, y - r * 1.4); g.lineTo(x + r * 1.4, y - r * 1.4);
  g.lineTo(x + r * 1.4, y - r * 0.05); g.lineTo(x - r * 1.4, y - r * 0.45);
  g.closePath(); g.fill();
  g.fillStyle = R.shade;
  g.beginPath();
  g.moveTo(x - r * 1.4, y + r * 0.35); g.lineTo(x + r * 1.4, y + r * 0.15);
  g.lineTo(x + r * 1.4, y + r * 1.4); g.lineTo(x - r * 1.4, y + r * 1.4);
  g.closePath(); g.fill();
  // ore veins, drawn INSIDE the clip so they follow the facet planes and only
  // glint where the lamp actually reaches
  if (vein) {
    const V = bdRamp(vein);
    for (let i = 0; i < 5; i++) {
      const vy = y + rr(-r * 0.6, r * 0.4);
      g.strokeStyle = bdRgba(V.base, 0.85);
      g.lineWidth = rr(0.9, 2.0);
      g.beginPath();
      g.moveTo(x - r, vy);
      g.quadraticCurveTo(x + rr(-r * 0.4, r * 0.4), vy + rr(-r * 0.3, r * 0.3), x + r, vy + rr(-2, 2));
      g.stroke();
      g.strokeStyle = bdRgba(V.edge, 0.7);
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x - r, vy - 0.9);
      g.quadraticCurveTo(x + rr(-r * 0.4, r * 0.4), vy - 0.9 + rr(-r * 0.3, r * 0.3), x + r, vy - 0.9);
      g.stroke();
    }
  }
  g.restore();
  // Extreme edge highlight on the up-left boundary ONLY. `run` tracks whether
  // the previous vertex was also sunward: without it the first sunward vertex
  // after a shaded one issued a lineTo from the shaded vertex, drawing a
  // highlight segment across the lee side — a two-sided edge light, which is
  // precisely what the single-sided rule exists to avoid.
  g.strokeStyle = R.edge; g.lineWidth = 0.9;
  g.beginPath();
  let run = false;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const sunward = (p[0] - x) * bdSUN.x + (p[1] - y) * bdSUN.y > 0;
    if (sunward) {
      if (run) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
    }
    run = sunward;
  }
  g.stroke();
  // lichen
  if (rr(0, 1) < 0.6) {
    for (let i = 0; i < 6; i++) {
      g.fillStyle = bdRgba(BT.SCRUB_COOL, 0.5);
      g.beginPath();
      g.arc(x + rr(-r * 0.7, r * 0.7), y + rr(-r * 0.5, r * 0.4), rr(0.7, 2), 0, BD_TAU);
      g.fill();
    }
  }
}

/** A cut stump with a bright sawn face — the record of harvesting. */
function bdStump(g, x, y, r, rr) {
  bdContactShadow(g, x, y, r * 1.1, r * 0.9, 0.8);
  const T = bdRamp(BT.TRUNK);
  bdRect(g, x - r, y - r * 0.9, r * 2, r * 0.9, T, { litW: 0.7 });
  // sawn top: pale heartwood, the brightest note in a depleted wood
  const S = bdRamp(bdMix(BT.TRUNK_LIT, BT.STRAW_LIGHT, 0.45));
  bdEllipse(g, x, y - r * 0.9, r, r * 0.44, S, { litW: 0.6, edge: true });
  g.strokeStyle = bdRgba(T.shade, 0.5); g.lineWidth = 0.6;
  for (let k = 1; k <= 2; k++) {
    g.beginPath();
    g.ellipse(x + bdSUN.x * 0.5, y - r * 0.9 + bdSUN.y * 0.3, r * 0.3 * k, r * 0.13 * k, 0, 0, BD_TAU);
    g.stroke();
  }
  // chips around the base
  for (let i = 0; i < 5; i++) {
    g.fillStyle = bdRgba(BT.STRAW, rr(0.35, 0.7));
    g.fillRect(x + rr(-r * 1.8, r * 1.8), y + rr(-1, 3), rr(1, 3), 1.2);
  }
}

/* ---------------------------------------------------------------------------
   8. THE FARM — a ploughed parcel, not a building
   Farms carry no shell at all: they are a sculpted plough parcel in exactly
   the idiom terrain.js uses for its own parcels, so a player's farm and the
   board's field are the same modelled material. What distinguishes a farm is
   that it is ENCLOSED (a post-and-rail boundary), MARKED (a side-colour stake)
   and that its crop visibly depletes.

   Growth reads backwards from `amount`: a farm is built ripe and is eaten down
   to stubble, so stage 3 is full-standing corn and stage 0 is bare earth.
   ------------------------------------------------------------------------ */

function bdPaintFarm(g, def, side, stage, seed) {
  const w = def.w, h = def.h;
  const hw = w * 0.5, hh = h * 0.5;
  const rr = bdRnd(seed);
  const soil = bdRamp(bdLawful(BT.EARTH));
  const ang = -0.26;                       // furrow direction, off-axis
  const ca = Math.cos(ang), sa = Math.sin(ang);

  // --- the parcel outline: an irregular closed path, never a clean rect. A
  // mathematically exact rectangle is the single loudest "generated" tell on a
  // modelled board.
  const pts = [];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const t = i / N * BD_TAU;
    const ex = Math.cos(t), ey = Math.sin(t);
    const m = Math.max(Math.abs(ex), Math.abs(ey)) || 1;
    const k = 1 + rr(-0.05, 0.05);
    pts.push([ex / m * hw * 0.96 * k, ey / m * hh * 0.96 * k]);
  }
  const parcel = function (c) {
    c.moveTo((pts[0][0] + pts[N - 1][0]) / 2, (pts[0][1] + pts[N - 1][1]) / 2);
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[(i + 1) % N];
      c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    c.closePath();
  };

  bdLitPath(g, parcel, soil, {
    bbox: [-hw, -hh, w, h], shadeX: 0.78, shadeY: 0.80, litW: 1.2, lineW: 1.6,
  });

  // --- FURROWS. Each is a shadowed trough with a sunlit ridge crest offset
  // toward the light — the pair is what makes corrugation read as relief. A
  // single line per furrow reads as hatching.
  g.save();
  g.beginPath(); parcel(g); g.clip();
  const pitch = 7.0;
  const span = (Math.abs(hw * ca) + Math.abs(hh * sa)) * 2.2;
  for (let d = -span; d < span; d += pitch) {
    const x0 = -sa * d - ca * span, y0 = ca * d - sa * span;
    const x1 = -sa * d + ca * span, y1 = ca * d + sa * span;
    // trough
    g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.62); g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    // lit crest, offset toward the sun
    g.strokeStyle = bdRgba(BT.EARTH_LIGHT, 0.55); g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x0 + bdSUN.x * 1.9, y0 + bdSUN.y * 1.9);
    g.lineTo(x1 + bdSUN.x * 1.9, y1 + bdSUN.y * 1.9);
    g.stroke();
  }
  // clods and stones turned up by the plough
  for (let i = 0; i < 60; i++) {
    const px = rr(-hw, hw), py = rr(-hh, hh);
    const lit = rr(0, 1) > 0.5;
    g.fillStyle = bdRgba(lit ? BT.EARTH_LIGHT : BT.EARTH_DARK, rr(0.25, 0.6));
    g.beginPath(); g.arc(px, py, rr(0.6, 1.8), 0, BD_TAU); g.fill();
  }

  // --- THE CROP. Height, density and colour all key off the stage, so a farm
  // being worked visibly empties. Each stalk gets a lit up-left side.
  if (stage > 0) {
    const density = [0, 90, 200, 330][stage];
    const hgt     = [0, 3.2, 6.0, 9.0][stage];
    const bodyC   = ['', '#7E8A46', BT.STRAW, BT.STRAW][stage];
    const litC    = ['', '#98A25C', BT.STRAW_LIGHT, BT.STRAW_LIGHT][stage];
    for (let i = 0; i < density; i++) {
      const px = rr(-hw * 0.97, hw * 0.97), py = rr(-hh * 0.97, hh * 0.97);
      const L = hgt * rr(0.75, 1.15);
      const lean = rr(-0.24, 0.24);
      g.strokeStyle = bdRgba(bodyC, rr(0.55, 0.9));
      g.lineWidth = 1.0;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + lean * L, py - L); g.stroke();
      g.strokeStyle = bdRgba(litC, rr(0.4, 0.75));
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(px - 0.6, py - 0.4); g.lineTo(px + lean * L - 0.6, py - L - 0.4);
      g.stroke();
      // ripe ears on the tallest stage
      if (stage === 3 && rr(0, 1) < 0.4) {
        g.fillStyle = bdRgba(BT.STRAW_LIGHT, 0.8);
        g.beginPath();
        g.ellipse(px + lean * L, py - L - 1, 0.9, 1.8, lean, 0, BD_TAU);
        g.fill();
      }
    }
  } else {
    // harvested: cut stubble rows and a scatter of loose straw
    for (let i = 0; i < 150; i++) {
      const px = rr(-hw * 0.95, hw * 0.95), py = rr(-hh * 0.95, hh * 0.95);
      g.strokeStyle = bdRgba(BT.STRAW, rr(0.3, 0.6));
      g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + rr(-0.5, 0.5), py - rr(1.2, 2.4)); g.stroke();
    }
  }
  g.restore();

  // --- STOOKS: sheaves stood up to dry, appearing as the crop comes in. They
  // are the clearest possible signal that a farm is producing.
  const stooks = [0, 3, 2, 0][stage];
  for (let i = 0; i < stooks; i++) {
    const sx = -hw * 0.62 + i * w * 0.30, sy = hh * 0.60;
    const S = bdRamp(BT.STRAW);
    bdContactShadow(g, sx, sy, 6, 11, 0.9);
    bdLitPath(g, function (c) {
      c.moveTo(sx - 5.5, sy);
      c.quadraticCurveTo(sx - 2.2, sy - 13, sx, sy - 14);
      c.quadraticCurveTo(sx + 2.2, sy - 13, sx + 5.5, sy);
      c.closePath();
    }, S, { bbox: [sx - 5.5, sy - 14, 11, 14], litW: 1.0, edge: true });
    g.strokeStyle = bdRgba(S.shade, 0.6); g.lineWidth = 0.7;
    for (let k = -2; k <= 2; k++) {
      g.beginPath(); g.moveTo(sx + k * 1.6, sy - 1); g.lineTo(sx + k * 0.7, sy - 12); g.stroke();
    }
    // binding cord
    g.strokeStyle = bdRgba(BT.TRUNK, 0.8); g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(sx - 4, sy - 7); g.lineTo(sx + 4, sy - 7.6); g.stroke();
  }

  // Harvest furniture makes the parcel feel worked rather than decorative.
  // The cart arrives as the crop is cut; full fields retain only water and
  // empty sacks at the boundary so the grain remains the visual focus.
  bdBarrel(g, -hw * 0.77, hh * 0.72, 8, 12);
  if (stage <= 2) {
    bdCart(g, hw * 0.56, hh * 0.70, 0.56, seed * 17 + stage);
    bdSack(g, hw * 0.28, hh * 0.73, 8, 11, seed * 19 + stage);
    if (stage <= 1) bdSack(g, hw * 0.39, hh * 0.75, 9, 13, seed * 23 + stage);
  }

  // --- boundary: post and rail on the two near sides only, so the parcel is
  // enclosed without walling off the villagers' approach
  bdFence(g, -hw, hw, hh + 1, 9, seed * 3, 16);

  // --- THE MARKER STAKE, up-left where nothing occludes it. This is the farm's
  // whole team read: farms have no roof to fly a banner from.
  bdBanner(g, -hw + 5, -hh + 6, 20, side, { w: 12, h: 9, dir: side === 0 ? 1 : -1 });

  // a scarecrow on the far side, purely for silhouette interest
  const T = bdRamp(BMAT.TIMBER);
  const scx = hw * 0.52, scy = -hh * 0.30;
  bdBeam(g, T, scx, scy, scx, scy - 16, 1.6, { cap: 'butt' });
  bdBeam(g, T, scx - 6, scy - 11, scx + 6, scy - 12, 1.3, { cap: 'butt' });
  const R = bdRamp(BMAT.CANVAS);
  bdEllipse(g, scx, scy - 18, 3.0, 2.6, R, { litW: 0.6, edge: true });
  bdPoly(g, [scx - 5, scy - 19, scx + 5, scy - 19.4, scx + 4, scy - 21, scx - 4, scy - 20.6],
    bdRamp(BT.STRAW), { litW: 0.6 });
}


/* ---------------------------------------------------------------------------
   9. BAKE AND CACHE
   ------------------------------------------------------------------------ */

/**
 * Local-space box each type's art occupies, as [ox, oy, ow, oh] relative to
 * the building centre. Roofs, belfries, chimneys, sails and banners all rise
 * well above the nominal footprint, and the cast shadow runs down-right past
 * it, so the box is NOT def.w x def.h.
 *
 * The bible documents a live clipping bug — every idle pikeman's spearhead is
 * cut off because the painter draws outside the frame. These boxes are sized
 * from the tallest thing each painter actually draws (measured, not guessed),
 * plus 26 units of margin for the lining dilation, the soft contact shadow and
 * the hard cast shadow's down-right throw. Nothing here clips.
 */
const BD_TOP_EXTRA = {
  town_center: 112, house: 62, farm: 30, mill: 104, lumber_camp: 54,
  mine: 74, barracks: 78, stable: 72, foundry: 108, tower: 106,
};

function bdBoxFor(type, def) {
  const topExtra = BD_TOP_EXTRA[type] == null ? 60 : BD_TOP_EXTRA[type];
  // The side and bottom margins are sized off def.w rather than being a flat 26
  // because the trodden apron and its soft ground bed scale with the footprint:
  // at a flat margin the bed's outer falloff ran past the stamp edge on the four
  // largest types and the blit cut a dead-straight line through a soft shadow.
  // bdPassGroundApron's reach is 0.707*w to the right of centre and
  // yG + 0.06h + 0.318w below it, which is what these two terms cover.
  const sideExtra = Math.max(26, def.w * 0.22, type === 'mill' ? def.w * 0.30 : 0);
  const botExtra = Math.max(42, def.h * 0.06 + def.w * 0.32);
  const ox = -(def.w * 0.5 + sideExtra);
  const ow = def.w + sideExtra * 2;
  const oy = -(def.h * 0.5 + topExtra);
  const oh = (def.h * 0.5 + topExtra) + (def.h * 0.5 + botExtra);
  return [ox, oy, ow, oh];
}

/**
 * Bake a painter into an offscreen canvas and return a blit record.
 * The whole-piece passes run here and only here, which is the entire argument
 * for baking: the 8-way lining dilation, the source-atop gallery light, the
 * blurred recess wash and the hard cast shadow are all multi-canvas or
 * filter-based operations that cannot legally appear in draw().
 */
function bdBake(box, scale, paint) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(box[2] * scale));
  c.height = Math.max(1, Math.ceil(box[3] * scale));
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.translate(-box[0], -box[1]);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  paint(g, scale);
  return { c: c, x: box[0], y: box[1], w: box[2], h: box[3] };
}

const bdBuildingCache = new Map();
const bdFarmCache = new Map();
const bdResourceCache = new Map();

/** Called from startBattle(). Frees every baked surface between battles. */
function bdResetCaches() {
  bdBuildingCache.clear();
  bdFarmCache.clear();
  bdResourceCache.clear();
  bdFoliagePal = null;
}

const BD_VARIANTS = {
  town_center: 1, tower: 2, farm: 1, house: 3,
  mill: 2, lumber_camp: 2, mine: 2, barracks: 2, stable: 2, foundry: 2,
};

const BD_PAINTERS = {
  town_center: bdPaintTownCenter, house: bdPaintHouse, mill: bdPaintMill,
  lumber_camp: bdPaintLumberCamp, mine: bdPaintMine, barracks: bdPaintBarracks,
  stable: bdPaintStable, foundry: bdPaintFoundry, tower: bdPaintTower,
};

function bdBuildingSprite(type, def, side, nation, natRoof, variant, damageStage, animFrame) {
  const frame = type === 'mill' ? (animFrame || 0) : 0;
  const damage = damageStage || 0;
  const key = type + '|' + side + '|' + nation + '|' + variant + '|' + damage + '|' + frame;
  let s = bdBuildingCache.get(key);
  if (s) return s;

  const painter = BD_PAINTERS[type];
  if (!painter) return null;
  const box = bdBoxFor(type, def);
  // Seed from the key so a re-bake is byte-identical, and so the three house
  // variants differ in their timber bracing, thatch and stonework rather than
  // being the same house three times.
  let seed = variant * 7919 + side * 104729 + 1;
  for (let i = 0; i < type.length; i++) seed = (seed * 31 + type.charCodeAt(i)) | 0;

  s = bdBake(box, BD_SCALE, function (g, scale) {
    const opts = {
      def: def, type: type, side: side, nation: nation,
      natRoof: natRoof, variant: variant, seed: seed, animFrame: frame,
    };
    const G = painter(g, opts);
    bdPaintSceneDressing(g, G, opts);
    bdPaintDamage(g, G, opts, damage);
    bdPassSurfacePatina(g, box, seed + damage * 101 + frame * 17);
    bdPassGalleryLight(g, box);
    bdPassRecessWash(g, scale);
    bdPassMatteVarnish(g, box);
    // lining: material-tinted, luminance-clamped, dilated 8 ways
    bdPassLining(g, scale, bdRamp(BMAT.TIMBER).line);
    // the hard, shaped cast shadow — destination-over so the lining pass has
    // already finished and will not outline the shadow itself
    g.save();
    g.globalCompositeOperation = 'destination-over';
    bdCastShadow(g, bdShellSilhouette(G), G.height);
    g.restore();
    // trodden apron + soft bed, beneath everything
    bdPassGroundApron(g, 0, G.yG + def.h * 0.06, def.w * 0.52, BD_SIDE[side].rim);
  });
  bdBuildingCache.set(key, s);
  return s;
}

function bdFarmSprite(def, side, stage) {
  const key = side + '|' + stage;
  let s = bdFarmCache.get(key);
  if (s) return s;
  const box = bdBoxFor('farm', def);
  s = bdBake(box, BD_SCALE, function (g, scale) {
    bdPaintFarm(g, def, side, stage, side * 613 + stage * 71 + 3);
    bdPassSurfacePatina(g, box, side * 613 + stage * 71 + 3);
    bdPassGalleryLight(g, box);
    bdPassMatteVarnish(g, box);
  });
  bdFarmCache.set(key, s);
  return s;
}

/**
 * Resource clusters. Baked per node and per DEPLETION STEP, so a wood
 * physically thins as it is felled — trees are replaced by stumps rather than
 * the whole cluster simply fading, which is what the current painter does and
 * why gathering currently has no visual consequence.
 */
const BD_RES_STEPS = 5;

function bdResourceSprite(res) {
  const step = Math.max(0, Math.min(BD_RES_STEPS - 1,
    Math.round((res.amount / Math.max(1, res.maxAmount)) * (BD_RES_STEPS - 1))));
  // Keyed by node id, NOT by id|step: a node only ever depletes, so the
  // previous step's stamp is dead the moment a new one is baked. Keying on
  // id|step kept all five alive for the node's whole life, and the two central
  // r=95 woods alone are ~0.9 MB per step, so the settlement's resource stamps
  // held roughly 40 MB of surfaces that could never be drawn again.
  const prev = bdResourceCache.get(res.id);
  if (prev && prev.step === step) return prev.s;

  const r = res.radius;
  const box = [-(r * 0.86 + 42), -(r * 0.52 + 76), (r * 0.86 + 42) * 2, r * 1.04 + 76 + 46];
  const frac = step / (BD_RES_STEPS - 1);

  const s = bdBake(box, BD_RES_SCALE, function (g) {
    // Seeded from the node's own seed, so props keep their positions across
    // every depletion step and only their COUNT changes.
    const rr = bdRnd((res.seed * 1000) | 0);
    const full = res.type === 'wood' ? 17 : res.type === 'food' ? 19 : 15;
    const props = [];
    for (let i = 0; i < full; i++) {
      const a = rr(0, BD_TAU);
      const d = Math.sqrt(rr(0, 1)) * r * 0.74;
      props.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.62,
        s: rr(0, 1),
      });
    }
    // paint back-to-front so nearer props overlap farther ones correctly
    props.sort(function (a, b) { return a.y - b.y; });
    const live = Math.max(1, Math.round(full * (0.28 + 0.72 * frac)));

    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const alive = i >= props.length - live;
      const pr = bdRnd(((res.seed * 100 + i * 37) | 0));
      if (res.type === 'wood') {
        if (alive) bdTree(g, p.x, p.y, 15 + p.s * 11, pr);
        else bdStump(g, p.x, p.y, 4.5 + p.s * 2, pr);
      } else if (res.type === 'food') {
        if (alive) bdBush(g, p.x, p.y, 9 + p.s * 5, pr, '#8E2F33');
        else {
          // picked over: the bush survives but carries no fruit
          bdBush(g, p.x, p.y, 7 + p.s * 3, pr, null);
        }
      } else {
        const gold = res.type === 'gold';
        if (alive) {
          bdRock(g, p.x, p.y, 9 + p.s * 9, pr,
            gold ? bdMix(BT.ROCK, '#8A7038', 0.32) : BT.ROCK,
            gold ? '#C9A24E' : null);
        } else {
          // worked out: a shallow scar and loose scree where the rock was
          g.fillStyle = bdRgba(bdLawful(bdMix(BT.EARTH_DARK, BT.ROCK, 0.3)), 0.55);
          g.beginPath();
          g.ellipse(p.x, p.y, 9 + p.s * 5, (9 + p.s * 5) * 0.42, 0, 0, BD_TAU);
          g.fill();
          for (let k = 0; k < 6; k++) {
            g.fillStyle = bdRgba(BT.ROCK_DARK, pr(0.35, 0.7));
            g.beginPath();
            g.arc(p.x + pr(-9, 9), p.y + pr(-4, 4), pr(0.8, 2.2), 0, BD_TAU);
            g.fill();
          }
        }
      }
    }
    // Human-scale clues on the near edge communicate both use and scale. They
    // are sparse enough that an untouched resource still reads as landscape.
    if (res.type === 'wood') {
      const L = bdRamp(BMAT.LOG);
      bdBeam(g, L, -r * 0.54, r * 0.38, -r * 0.14, r * 0.31, 7.5, { cap: 'round' });
      bdEllipse(g, -r * 0.14, r * 0.31, 3.8, 4.8, L, { litW: 0.7, edge: true });
      const chips = bdRnd(((res.seed * 43) | 0));
      for (let i = 0; i < 18; i++) {
        g.fillStyle = bdRgba(i % 2 ? BT.STRAW : BT.TRUNK_LIT, chips(0.30, 0.68));
        g.fillRect(-r * 0.34 + chips(-16, 16), r * 0.37 + chips(-4, 5), chips(1, 3.2), 1.1);
      }
    } else if (res.type === 'food') {
      const B = bdRamp(BMAT.SHINGLE);
      bdLitPath(g, function (c) {
        c.moveTo(-r * 0.50, r * 0.42); c.lineTo(-r * 0.34, r * 0.42);
        c.lineTo(-r * 0.37, r * 0.30); c.lineTo(-r * 0.47, r * 0.30); c.closePath();
      }, B, { bbox: [-r * 0.50, r * 0.30, r * 0.16, r * 0.12], litW: 0.65, edge: true });
      g.strokeStyle = B.lit; g.lineWidth = 0.75;
      for (let i = 0; i < 4; i++) {
        const y = r * (0.32 + i * 0.026);
        g.beginPath(); g.moveTo(-r * 0.48, y); g.lineTo(-r * 0.36, y); g.stroke();
      }
      g.fillStyle = '#8E2F33';
      for (let i = 0; i < 12; i++) {
        g.beginPath(); g.arc(-r * 0.47 + rr(0, r * 0.10), r * 0.31 + rr(-2, 2), rr(0.8, 1.4), 0, BD_TAU); g.fill();
      }
    } else {
      const I = bdRamp(BMAT.IRON), T = bdRamp(BMAT.TIMBER);
      bdBeam(g, T, -r * 0.52, r * 0.40, -r * 0.37, r * 0.18, 2.0, { cap: 'butt' });
      bdPoly(g, [-r * 0.41, r * 0.17, -r * 0.31, r * 0.19,
        -r * 0.33, r * 0.24, -r * 0.43, r * 0.22], I, { litW: 0.55, edge: true });
      bdCrate(g, r * 0.40, r * 0.43, 12, 9, (res.seed * 59) | 0);
    }
    // A quarry face / cut bank for the mineral nodes, so stone and gold sit IN
    // the board rather than on it.
    if (res.type === 'gold' || res.type === 'stone') {
      const scree = bdRnd(((res.seed * 3) | 0));
      for (let i = 0; i < 26; i++) {
        const a = scree(0, BD_TAU), d = Math.sqrt(scree(0, 1)) * r * 0.95;
        g.fillStyle = bdRgba(scree(0, 1) > 0.5 ? BT.ROCK_LIGHT : BT.ROCK_DARK, scree(0.25, 0.55));
        g.beginPath();
        g.arc(Math.cos(a) * d, Math.sin(a) * d * 0.6, scree(0.8, 2.6), 0, BD_TAU);
        g.fill();
      }
    }
    bdPassSurfacePatina(g, box, (res.seed * 97 + step * 13) | 0);
  });
  bdResourceCache.set(res.id, { step: step, s: s });
  return s;
}


/* ---------------------------------------------------------------------------
   10. THE FIVE ENTRY POINTS
   Call signatures preserved exactly as render.js has them today. `ctx` and
   `camera` are render.js module state; BUILDING_TYPES and NATIONS are already
   imported there.
   ------------------------------------------------------------------------ */

/**
 * FOUNDATIONS stay IMMEDIATE-MODE, deliberately, and this is the one place the
 * bake argument does not apply. Progress is continuous, foundations are few
 * (typically 0-6 alive at once) and short-lived (7-20 s), and the entire point
 * of the art is a value that changes every frame. Baking would mean quantising
 * progress into steps and holding ~120 extra canvases for objects that are
 * gone before the player looks twice.
 *
 * PROGRESS IS READ THREE WAYS, so it is legible at any zoom:
 *   1. how far the stone footing has been laid around the perimeter
 *   2. how tall the wall studs have risen
 *   3. whether the roof truss is up (the last quarter)
 */
function drawFoundation(building) {
  const w = building.w, h = building.h;
  const p = Math.max(0, Math.min(1, building.progress));
  const hw = w * 0.44, hh = h * 0.40;
  const yG = h * 0.40;
  // ONE STREAM PER SECTION, NOT ONE PER FOUNDATION. This is immediate-mode code
  // re-run every frame, and the number of rr() calls the footing loop consumes
  // depends on `progress` (it breaks early, and its colour ternary draws either
  // one or two samples). A single shared stream therefore hands the studs and
  // the material pile a different sequence every time a stone is added, so
  // their heights and positions visibly pop at each of the 26 footing
  // thresholds. Independent streams keyed off the building id are stable for
  // the object's whole life.
  const base = (building.id * 2654435761) | 0;
  const rr = bdRnd(base);                    // the earth pad only
  const rrFoot = bdRnd(base ^ 0x5bf03635);   // footing stones
  const rrStud = bdRnd(base ^ 0x27d4eb2f);   // wall studs
  const rrPile = bdRnd(base ^ 0x165667b1);   // material pile
  const g = ctx;

  // --- levelled and pegged-out ground: a scraped earth pad, irregular
  g.fillStyle = bdRgba(bdLawful(BT.EARTH), 0.85);
  g.beginPath();
  for (let i = 0; i <= 14; i++) {
    const t = i / 14 * BD_TAU;
    const ex = Math.cos(t), ey = Math.sin(t);
    const m = Math.max(Math.abs(ex), Math.abs(ey)) || 1;
    const k = 1 + rr(-0.07, 0.07);
    const px = ex / m * hw * 1.10 * k, py = ey / m * hh * 1.10 * k + yG * 0.18;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.55);
  g.lineWidth = 1.6;
  g.stroke();

  // --- 1. STONE FOOTING, laid progressively clockwise from the up-left corner
  const F = bdRamp(BMAT.STONE_ROUGH);
  const laid = Math.min(1, p * 2.4);
  const perim = [];
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    // walk the rectangle: top, right, bottom, left
    let px, py;
    if (t < 0.28) { px = -hw + (t / 0.28) * hw * 2; py = yG - hh * 1.55; }
    else if (t < 0.5) { px = hw; py = yG - hh * 1.55 + ((t - 0.28) / 0.22) * hh * 1.55; }
    else if (t < 0.78) { px = hw - ((t - 0.5) / 0.28) * hw * 2; py = yG; }
    else { px = -hw; py = yG - ((t - 0.78) / 0.22) * hh * 1.55; }
    perim.push([px, py]);
  }
  for (let i = 0; i < steps; i++) {
    if (i / steps > laid) break;
    const q = perim[i];
    const sw = rrFoot(5, 8), sh = rrFoot(3.4, 5);
    const tone = rrFoot(0, 1);
    g.fillStyle = tone > 0.6 ? F.lit : tone > 0.3 ? F.base : F.shade;
    g.fillRect(q[0] - sw / 2, q[1] - sh / 2, sw, sh);
    g.fillStyle = bdRgba(F.line, 0.6);
    g.fillRect(q[0] - sw / 2, q[1] + sh / 2 - 1, sw, 1.2);
    g.fillStyle = bdRgba(F.edge, 0.4);
    g.fillRect(q[0] - sw / 2, q[1] - sh / 2, sw, 0.9);
  }

  // --- 2. WALL STUDS rising out of the footing
  const T = bdRamp(BMAT.TIMBER);
  const studH = h * 0.46 * Math.max(0, (p - 0.15) / 0.85);
  if (studH > 1) {
    for (let i = -3; i <= 3; i++) {
      const sx = i * hw * 0.31;
      bdBeam(g, T, sx, yG, sx, yG - studH * rrStud(0.9, 1.05), 3.0, { cap: 'butt' });
    }
    // a sole plate along the base and a rail once they are tall enough
    g.fillStyle = T.base; g.fillRect(-hw, yG - 2.4, hw * 2, 2.6);
    g.fillStyle = T.lit;  g.fillRect(-hw, yG - 2.4, hw * 2, 0.9);
    if (studH > h * 0.20) {
      g.fillStyle = T.base; g.fillRect(-hw, yG - studH * 0.62, hw * 2, 2.4);
      g.fillStyle = T.lit;  g.fillRect(-hw, yG - studH * 0.62, hw * 2, 0.8);
    }
  }

  // --- 3. ROOF TRUSS, the last quarter. Its appearance is the clearest
  // possible "nearly done" signal.
  if (p > 0.72) {
    const ty = yG - studH;
    const k = (p - 0.72) / 0.28;
    bdBeam(g, T, -hw, ty, 0, ty - h * 0.30 * k, 2.8, { cap: 'butt' });
    bdBeam(g, T, hw, ty, 0, ty - h * 0.30 * k, 2.8, { cap: 'butt' });
    if (k > 0.5) bdBeam(g, T, -hw * 0.5, ty - h * 0.15 * k, hw * 0.5, ty - h * 0.15 * k, 2.2, { cap: 'butt' });
  }

  // --- SCAFFOLD: four poles, two ledgers and a diagonal brace. Lashed poles
  // read as construction at any zoom, and the diagonal is what stops the
  // structure looking like a finished frame.
  const S = bdRamp(BT.TRUNK);
  const poleH = h * 0.62;
  for (const sx of [-hw - 6, hw + 6]) {
    bdBeam(g, S, sx, yG + 4, sx, yG - poleH, 2.6, { cap: 'butt' });
  }
  for (let i = 0; i < 2; i++) {
    const ly = yG - poleH * (0.42 + i * 0.40);
    g.fillStyle = S.base; g.fillRect(-hw - 7, ly, hw * 2 + 14, 2.2);
    g.fillStyle = S.lit;  g.fillRect(-hw - 7, ly, hw * 2 + 14, 0.8);
  }
  bdBeam(g, S, -hw - 6, yG - 2, hw + 6, yG - poleH * 0.82, 2.0, { cap: 'butt' });
  // a plank walkway on the upper ledger
  const Pl = bdRamp(BMAT.SHINGLE);
  g.fillStyle = Pl.base; g.fillRect(-hw * 0.7, yG - poleH * 0.82 - 2.4, hw * 1.4, 2.6);
  g.fillStyle = Pl.lit;  g.fillRect(-hw * 0.7, yG - poleH * 0.82 - 2.4, hw * 1.4, 0.9);

  // --- MATERIAL PILE beside the site, shrinking as the work is consumed
  const remain = 1 - p;
  if (remain > 0.08) {
    const px = -hw - 20, py = yG + 6;
    const rows = Math.max(1, Math.round(remain * 3));
    bdLogPile(g, px, py, 16 * (0.5 + remain * 0.5), rows, building.id * 13);
    for (let i = 0; i < Math.round(remain * 5); i++) {
      g.fillStyle = i % 2 ? F.base : F.lit;
      g.fillRect(px + 12 + rrPile(-3, 3), py - 3 - i * 3.4, 12, 3.2);
    }
  }

  // --- SIDE-COLOUR RIBBON on the up-left scaffold pole. A site under
  // construction is at its most vulnerable, so whose it is must be unmissable.
  bdBanner(g, -hw - 6, yG - poleH, h * 0.16, building.side,
    { w: 11, h: 8, dir: building.side === 0 ? -1 : 1 });

  // --- soft bed so the site does not float
  bdContactShadow(g, 0, yG + 2, hw * 1.15, h * 0.30, 0.9);
}

/** FARMS — one blit of the parcel at its current crop stage. */
function drawFarm(building) {
  const def = BUILDING_TYPES.farm;
  const maxAmount = Math.max(1, def.amount || 1);
  // NOTE: createBuilding() in economy.js sets `amount` but NOT `maxAmount` on
  // buildings — only resource nodes carry maxAmount. Verified in source; the
  // ceiling has to come from BUILDING_TYPES.
  const frac = Math.max(0, Math.min(1, (building.amount || 0) / maxAmount));
  const stage = frac > 0.66 ? 3 : frac > 0.33 ? 2 : frac > 0.04 ? 1 : 0;
  const s = bdFarmSprite(def, building.side, stage);
  if (s) ctx.drawImage(s.c, s.x, s.y, s.w, s.h);
}

/** COMPLETED BUILDINGS — one blit, plus the two live overlays. */
function drawCompleteBuilding(building, nation, worldTime) {
  const def = BUILDING_TYPES[building.type];
  if (building.type === 'farm') { drawFarm(building); return; }

  const nat = NATIONS[nation];
  const variants = BD_VARIANTS[building.type] || 1;
  const variant = ((building.id % variants) + variants) % variants;
  const hpFraction = building.hp / Math.max(1, building.maxHp);
  const damageStage = hpFraction < 0.30 ? 2 : hpFraction < 0.66 ? 1 : 0;
  const animFrame = building.type === 'mill'
    ? Math.floor(((worldTime || 0) * 0.42 + building.id * 0.17) * BD_MILL_FRAMES) % BD_MILL_FRAMES
    : 0;
  const s = bdBuildingSprite(building.type, def, building.side, nation,
    (nat && nat.roof) || BMAT.SLATE, variant, damageStage, animFrame);
  if (s) ctx.drawImage(s.c, s.x, s.y, s.w, s.h);

  // Live overlay: the training queue. Kept OUT of the bake because it changes
  // every tick. Drawn in the reserved UI parchment/gold family so it never
  // competes with the side colours.
  if (def.trains && building.queue.length) {
    const progress = 1 - building.queue[0].remaining / building.queue[0].total;
    const bw = Math.min(90, building.w * 0.76);
    ctx.fillStyle = 'rgba(74,68,50,0.78)';
    ctx.fillRect(-bw / 2, building.h * 0.30, bw, 4.5);
    ctx.fillStyle = bdBarColour(BD_PROG_BAR, progress);
    ctx.fillRect(-bw / 2, building.h * 0.30, bw * progress, 4.5);
    ctx.fillStyle = 'rgba(240,233,207,0.5)';
    ctx.fillRect(-bw / 2, building.h * 0.30, bw * progress, 1.2);
  }
}

/**
 * RESOURCE NODES — one blit of the cluster at its current depletion step.
 *
 * NOTE the coordinate contract, which differs from drawFarm /
 * drawCompleteBuilding: those two are called from drawBuilding(), which has
 * already translated to the building anchor, so they blit at the stamp's
 * anchor-relative offset directly. draw() calls drawResourceNode() with NO
 * transform applied, so the node's world position has to be added here. Doing
 * it by addition rather than by save/translate/restore keeps this to exactly
 * one canvas call per node with zero state changes.
 */
function drawResourceNode(resource) {
  const s = bdResourceSprite(resource);
  if (!s) return;
  ctx.drawImage(s.c, resource.x + s.x, resource.y + s.y, s.w, s.h);
}

/**
 * BAR RAMPS. These are value-identical to composite.js's cHealthRamp and
 * cProgressRamp, deliberately: composite.js paints the UNIT bars and this file
 * paints the BUILDING bars, and a bar must mean the same thing wherever it
 * appears. The previous three-stop set here (#D4B860 / #C0692E / #A03028) was
 * a second, unrelated ramp, and its low-health red sat 11 RGB points from
 * england's coat #b33a38 and 22 from the side-1 rim #B8483E — exactly the
 * team-colour collision the bible's reserved-hue rule exists to prevent.
 *
 * Baked into 17-entry tables at module load so the runtime path is an array
 * index: no bdMix, no hex parsing and no string allocation per frame.
 */
function bdHealthRamp(frac) {
  if (frac > 0.55) return bdMix('#C9AE4A', '#7FB259', (frac - 0.55) / 0.45);
  if (frac > 0.28) return bdMix('#C4653C', '#C9AE4A', (frac - 0.28) / 0.27);
  return bdMix('#A6362C', '#C4653C', frac / 0.28);
}

const BD_BAR_STEPS = 16;
const BD_HP_BAR = [];
const BD_PROG_BAR = [];
for (let i = 0; i <= BD_BAR_STEPS; i++) {
  const f = i / BD_BAR_STEPS;
  BD_HP_BAR.push(bdHealthRamp(f));
  // construction and training are never danger, so they stay inside the
  // parchment/gold family and only gain warmth and value as they fill
  BD_PROG_BAR.push(bdMix('#A89A68', '#F4EAC4', f * 0.85 + 0.15));
}

function bdBarColour(table, frac) {
  const i = (frac * BD_BAR_STEPS + 0.5) | 0;
  return table[i < 0 ? 0 : i > BD_BAR_STEPS ? BD_BAR_STEPS : i];
}

/**
 * The per-building entry point. One blit for the piece, plus selection and
 * health, both in the reserved UI hue family.
 */
function drawBuilding(building, world) {
  ctx.save();
  ctx.translate(building.x, building.y);

  if (building.selected) {
    ctx.strokeStyle = '#E8DCA8';
    ctx.lineWidth = 2 / camera.zoom;
    ctx.beginPath();
    ctx.ellipse(0, building.h * 0.22, building.radius, building.radius * 0.48, 0, 0, BD_TAU);
    ctx.stroke();
  }

  if (building.complete) drawCompleteBuilding(building, world.sides[building.side].nation, world.time);
  else drawFoundation(building);

  if (building.selected || building.hp < building.maxHp || !building.complete) {
    const width = Math.min(90, building.w * 0.75);
    const y = -building.h * 0.82 - 10;
    const fraction = building.complete ? building.hp / building.maxHp : building.progress;
    ctx.fillStyle = 'rgba(26,23,15,0.72)';
    ctx.fillRect(-width / 2, y, width, 5);
    ctx.fillStyle = building.complete
      ? bdBarColour(BD_HP_BAR, fraction)
      : bdBarColour(BD_PROG_BAR, fraction);
    ctx.fillRect(-width / 2, y, width * Math.max(0, fraction), 5);
    ctx.strokeStyle = 'rgba(74,68,50,0.9)';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(-width / 2, y, width, 5);
  }

  ctx.restore();
}


/* ---------------------------------------------------------------------------
   11. MODULE WRAPPER  (see the report — the integration target moved)
   The brief asked for a self-contained fragment to splice into render.js, and
   everything above is exactly that. But render.js was refactored into real ES
   modules mid-task: it is now 517 lines and imports terrain / infantry /
   decals / effects / mounted / villager / composite from ./gfx/*.js. buildings
   is the only subsystem still inlined.

   To land this as js/gfx/buildings.js instead of a splice, add the four lines
   marked ADD below and delete nothing else. `ctx` and `camera` are injected
   the same way decals.js takes setDecalCtx and composite.js takes
   setCompositeRefs, so the five call signatures stay byte-identical.

   ADD at the top of the file:
     import { BUILDING_TYPES, NATIONS } from '../config.js';
     let ctx = null;
     let camera = { zoom: 1 };
     function setBuildingRefs(refs) {
       if (refs.ctx) ctx = refs.ctx;
       if (refs.camera) camera = refs.camera;
     }

   ADD at the bottom:
     export {
       setBuildingRefs, bdResetCaches,
       drawResourceNode, drawFarm, drawFoundation,
       drawCompleteBuilding, drawBuilding,
     };

   THEN in render.js:
     import { setBuildingRefs, bdResetCaches, drawResourceNode, drawFarm,
              drawFoundation, drawCompleteBuilding, drawBuilding }
       from './gfx/buildings.js';
     - delete the five inline painters (currently at ~183, 237, 257, 272, 398)
       and the now-unused `seeded()` helper above them
     - in initRender(): setBuildingRefs({ ctx, camera });
     - in startBattle(): bdResetCaches();   // frees baked stamps between battles
   ------------------------------------------------------------------------ */

export {
  setBuildingRefs, bdResetCaches,
  drawResourceNode, drawFarm, drawFoundation,
  drawCompleteBuilding, drawBuilding,
};
