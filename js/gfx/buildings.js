// Settlement art: buildings, foundations, farms and resource nodes as
// painted terrain pieces on the same board the troops stand on.
// Building stamps are baked once per (type|side|nation|variant) and then
// blitted, so the runtime cost is one drawImage per building. Foundations
// stay immediate-mode because construction progress is continuous and
// baking would quantise the one value the art exists to show.
import { BUILDING_TYPES, NATIONS } from '../config.js';
import {
  fortificationAxis, fortificationEndpoints, fortificationInteriorSide,
  fortificationsShareEndpoint, getGateOpenProgress, isFortificationType,
  normalizeFortificationOrientation, WALL_WALK_ELEVATION,
} from '../fortifications.js';
import { viewMirrorsHorizontalFacing } from '../camera.js';
import { createResourceVisualLayout, getResourceVisualProfile } from '../resource-visuals.js';
import { getProductionArt } from './art-assets.js';

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
  { rim: '#4FAE8B', lit: '#7CD9B4' },   // side 2 — allied green
  { rim: '#C67A2F', lit: '#E5A35F' },   // side 3 — rival ochre
  { rim: '#7365D6', lit: '#A39BFF' },   // side 4 — allied violet
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
 * Generates one deterministic brick courtyard in an unsquashed ground plane.
 * Rendering later compresses Y to the building's isometric apron depth. A
 * zig-zag of alternating 45-degree pavers forms a true 90-degree herringbone
 * field, while tangent header pavers bind the whole perimeter.
 *
 * Keeping layout independent of Canvas makes the bond, weathering density and
 * full-circumference border regression-testable without a browser.
 */
function getBuildingPavingLayout(rx, ry, seed) {
  const safeRx = Math.max(16, Number.isFinite(rx) ? rx : 16);
  const safeRy = Math.max(8, Number.isFinite(ry) ? ry : safeRx * bdSUN.squash);
  const rr = bdRnd(seed || ((safeRx * 71 + safeRy * 131) | 0));
  const brickWidth = bdClamp(safeRx * 0.050, 3.45, 4.85);
  const brickLength = brickWidth * 2.08;
  const joint = bdClamp(brickWidth * 0.16, 0.54, 0.78);
  const borderRadius = safeRx * 0.930;
  const borderWidth = brickWidth * 1.18;
  const borderCount = Math.max(28, Math.round(BD_TAU * borderRadius / (brickLength * 0.92)));
  const borderLength = BD_TAU * borderRadius / borderCount - joint * 0.55;
  const fieldRadius = borderRadius - borderWidth * 0.78 - joint;
  const pavers = [];

  function addPaver(kind, x, y, angle, length, width) {
    const weather = rr(0, 1);
    pavers.push({
      kind,
      x,
      y,
      angle: angle + rr(-0.018, 0.018),
      length,
      width,
      settle: rr(-0.22, 0.34),
      tone: Math.min(4, Math.floor(rr(0, 5))),
      chip: weather > 0.72 ? Math.floor(rr(0, 4)) : -1,
      moss: weather < (kind === 'border' ? 0.28 : 0.18),
      mossEdge: Math.floor(rr(0, 4)),
      patina: rr(0, 1) < 0.24,
      markX: rr(-0.28, 0.28),
      markY: rr(-0.22, 0.22),
    });
  }

  // The alternating diagonal pair is a repeating V. Successive offset rows
  // lock into those Vs, giving a legible herringbone even on the smallest hut.
  const diagonal = brickLength / Math.SQRT2;
  const pairAdvance = diagonal * 2;
  const rowStep = diagonal + joint * 0.48;
  const rowLimit = Math.ceil(fieldRadius / rowStep) + 2;
  const pairLimit = Math.ceil(fieldRadius * 2 / pairAdvance) + 3;
  for (let row = -rowLimit; row <= rowLimit; row++) {
    const baseline = row * rowStep - diagonal * 0.5;
    const phase = Math.abs(row) % 2 ? diagonal : 0;
    for (let pair = -pairLimit; pair <= pairLimit; pair++) {
      const start = pair * pairAdvance + phase;
      const centerY = baseline + diagonal * 0.5;
      const candidates = [
        { x: start + diagonal * 0.5, angle: Math.PI / 4 },
        { x: start + diagonal * 1.5, angle: -Math.PI / 4 },
      ];
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (Math.hypot(candidate.x, centerY) <= fieldRadius - brickWidth * 0.24) {
          addPaver('field', candidate.x, centerY, candidate.angle, brickLength, brickWidth);
        }
      }
    }
  }

  // A continuous header course makes it unmistakable that the paving wraps
  // the entire building instead of being a decorative patch at the entrance.
  for (let index = 0; index < borderCount; index++) {
    const angle = index / borderCount * BD_TAU;
    addPaver('border', Math.cos(angle) * borderRadius, Math.sin(angle) * borderRadius,
      angle + Math.PI / 2, borderLength, borderWidth);
  }

  const perimeter = [];
  const perimeterPoints = 48;
  const waveA = rr(0, BD_TAU);
  const waveB = rr(0, BD_TAU);
  for (let index = 0; index < perimeterPoints; index++) {
    const angle = index / perimeterPoints * BD_TAU;
    const radius = safeRx * (0.978
      + Math.sin(angle * 3 + waveA) * 0.018
      + Math.sin(angle * 7 + waveB) * 0.011
      + rr(-0.007, 0.007));
    perimeter.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }

  return {
    rx: safeRx,
    ry: safeRy,
    yScale: safeRy / safeRx,
    brickLength,
    brickWidth,
    joint,
    fieldRadius,
    borderRadius,
    borderCount,
    pavers,
    perimeter,
  };
}

function bdPavingPerimeterPath(g, points) {
  g.beginPath();
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (index === 0) g.moveTo(point.x, point.y);
    else g.lineTo(point.x, point.y);
  }
  g.closePath();
}

function bdPaverPath(g, paver, grow) {
  const extra = grow || 0;
  const halfLength = paver.length * 0.5 + extra;
  const halfWidth = paver.width * 0.5 + extra;
  const chamfer = Math.min(0.72, paver.width * 0.14 + extra * 0.18);
  g.beginPath();
  g.moveTo(-halfLength + chamfer, -halfWidth);
  g.lineTo(halfLength - chamfer, -halfWidth);
  g.lineTo(halfLength, -halfWidth + chamfer);
  g.lineTo(halfLength, halfWidth - chamfer);
  g.lineTo(halfLength - chamfer, halfWidth);
  g.lineTo(-halfLength + chamfer, halfWidth);
  g.lineTo(-halfLength, halfWidth - chamfer);
  g.lineTo(-halfLength, -halfWidth + chamfer);
  g.closePath();
}

function bdAtPaver(g, paver, paint) {
  g.save();
  g.translate(paver.x, paver.y + paver.settle);
  g.rotate(paver.angle);
  paint();
  g.restore();
}

/**
 * PASS E — a complete, weathered brick courtyard and soft ground bed, painted
 * below the building with 'destination-over'. The stamp is still baked once,
 * so individual pavers add no per-frame rendering cost.
 *
 * Under destination-over, calls are deliberately made from visual foreground
 * to background: moss/chips/bevels, joint shadows, brick bodies, mortar, then
 * the earth feather. This preserves real recessed joints without ever drawing
 * paving over the building artwork.
 */
function bdPassGroundApron(g, cx, cy, rx, sideHex, options) {
  const o = options || {};
  const ry = o.ry || rx * bdSUN.squash;
  const seed = o.seed || ((rx * 71 + ry * 131) | 0);
  const layout = getBuildingPavingLayout(rx, ry, seed);
  const worn = bdLawful(bdMix(BT.EARTH, sideHex || BT.EARTH, 0.10));
  const mortar = bdLawful(bdMix(BT.ROCK_DARK, BT.EARTH, 0.54));
  const paverBase = bdLawful(bdMix(BMAT.BRICK_RED, BT.EARTH_LIGHT, 0.20));
  const paverPalette = [
    paverBase,
    bdLawful(bdMix(BMAT.BRICK, BT.EARTH, 0.12)),
    bdLawful(bdMix(BMAT.BRICK_RED, BT.ROCK, 0.12)),
    bdLawful(bdMix(BMAT.BRICK, BT.EARTH_DARK, 0.28)),
    bdLawful(bdMix(BMAT.BRICK_RED, BT.STRAW, 0.18)),
  ];
  const jointShadow = bdMix(mortar, '#171512', 0.38);
  const bevelLight = bdLawful(bdMix(paverBase, bdSUN.key, 0.34));
  const bevelShade = bdLawful(bdMix(paverBase, BT.EARTH_DARK, 0.42));
  const mossDeep = bdLawful(BT.FOLIAGE_DEEP);
  const mossBase = bdLawful(BT.FOLIAGE_BASE);
  const mossLit = bdLawful(BT.FOLIAGE_LIT);

  g.save();
  g.globalCompositeOperation = 'destination-over';
  g.translate(cx, cy);
  g.scale(1, layout.yScale);

  // Contact and edge shadows sit on top of the masonry, darkest down-right.
  const shadowX = layout.rx * 0.12;
  const shadowY = layout.rx * 0.10;
  const bed = g.createRadialGradient(shadowX, shadowY, layout.rx * 0.08,
    shadowX, shadowY, layout.rx * 1.10);
  bed.addColorStop(0.00, bdShadow(0.22));
  bed.addColorStop(0.58, bdShadow(0.06));
  bed.addColorStop(1.00, bdShadow(0));
  g.fillStyle = bed;
  g.beginPath(); g.arc(shadowX, shadowY, layout.rx * 1.10, 0, BD_TAU); g.fill();
  g.save();
  bdPavingPerimeterPath(g, layout.perimeter);
  g.clip();

  // Sparse moss occupies joints only. Small light flecks are painted first so
  // they remain above the broader green growth under destination-over.
  for (let index = 0; index < layout.pavers.length; index++) {
    const paver = layout.pavers[index];
    if (!paver.moss) continue;
    bdAtPaver(g, paver, function () {
      const horizontal = paver.mossEdge % 2 === 0;
      const positive = paver.mossEdge > 1;
      const edge = positive ? 1 : -1;
      const length = horizontal ? paver.length : paver.width;
      const offset = (horizontal ? paver.width : paver.length) * 0.5 * edge;
      g.fillStyle = bdRgba(mossLit, 0.72);
      for (let dot = -1; dot <= 1; dot++) {
        const along = length * (dot * 0.18 + paver.markX * 0.12);
        g.beginPath();
        if (horizontal) g.ellipse(along, offset, 0.54, 0.34, 0, 0, BD_TAU);
        else g.ellipse(offset, along, 0.34, 0.54, 0, 0, BD_TAU);
        g.fill();
      }
      g.strokeStyle = bdRgba(mossBase, 0.82);
      g.lineWidth = 0.90;
      g.beginPath();
      if (horizontal) {
        g.moveTo(-length * 0.31, offset);
        g.lineTo(length * 0.28, offset + paver.markY * 0.18);
      } else {
        g.moveTo(offset, -length * 0.31);
        g.lineTo(offset + paver.markX * 0.18, length * 0.28);
      }
      g.stroke();
      g.strokeStyle = bdRgba(mossDeep, 0.78);
      g.lineWidth = 1.32;
      g.stroke();
    });
  }

  // Chips, mineral speckle and opposing bevel lines model depth on every
  // paver. The dark bevel follows the same down-right light law as buildings.
  for (let index = 0; index < layout.pavers.length; index++) {
    const paver = layout.pavers[index];
    bdAtPaver(g, paver, function () {
      const halfLength = paver.length * 0.5;
      const halfWidth = paver.width * 0.5;
      if (paver.patina) {
        g.fillStyle = bdRgba(bdMix(paverPalette[paver.tone], BT.ROCK_LIGHT, 0.44), 0.40);
        g.beginPath();
        g.ellipse(paver.markX * paver.length, paver.markY * paver.width,
          0.58, 0.24, -0.3, 0, BD_TAU);
        g.fill();
      }
      if (paver.chip >= 0) {
        const right = paver.chip === 1 || paver.chip === 2;
        const bottom = paver.chip >= 2;
        const sx = right ? 1 : -1;
        const sy = bottom ? 1 : -1;
        g.fillStyle = bdRgba(bdMix(mortar, BT.EARTH_DARK, 0.34), 0.88);
        g.beginPath();
        g.moveTo(sx * halfLength, sy * (halfWidth - 0.20));
        g.lineTo(sx * (halfLength - 1.25), sy * halfWidth);
        g.lineTo(sx * (halfLength - 0.32), sy * (halfWidth - 0.92));
        g.closePath();
        g.fill();
      }
      g.strokeStyle = bdRgba(bevelLight, 0.62);
      g.lineWidth = 0.46;
      g.beginPath();
      g.moveTo(-halfLength + 0.72, -halfWidth + 0.25);
      g.lineTo(halfLength - 0.72, -halfWidth + 0.25);
      g.moveTo(-halfLength + 0.25, -halfWidth + 0.72);
      g.lineTo(-halfLength + 0.25, halfWidth - 0.72);
      g.stroke();
      g.strokeStyle = bdRgba(bevelShade, 0.72);
      g.lineWidth = 0.58;
      g.beginPath();
      g.moveTo(-halfLength + 0.72, halfWidth - 0.22);
      g.lineTo(halfLength - 0.72, halfWidth - 0.22);
      g.moveTo(halfLength - 0.22, -halfWidth + 0.72);
      g.lineTo(halfLength - 0.22, halfWidth - 0.72);
      g.stroke();
    });
  }

  // Slightly enlarged dark silhouettes form narrow, consistently recessed
  // joints. They are separate from the mortar bed so every brick has depth.
  for (let index = 0; index < layout.pavers.length; index++) {
    const paver = layout.pavers[index];
    bdAtPaver(g, paver, function () {
      g.fillStyle = bdRgba(jointShadow, paver.kind === 'border' ? 0.92 : 0.84);
      bdPaverPath(g, paver, layout.joint * 0.54);
      g.fill();
    });
  }

  // Individual clay bodies provide the muted red/brown variation seen in worn
  // historic paving. Only the border receives a tiny side-colour trace.
  for (let index = 0; index < layout.pavers.length; index++) {
    const paver = layout.pavers[index];
    bdAtPaver(g, paver, function () {
      const clay = paver.kind === 'border'
        ? bdLawful(bdMix(paverPalette[paver.tone], sideHex || paverBase, 0.10))
        : paverPalette[paver.tone];
      g.fillStyle = bdRgba(clay, 0.97);
      bdPaverPath(g, paver, 0);
      g.fill();
    });
  }

  // The compacted mortar bed only fills the hairline gaps left by pavers.
  g.fillStyle = bdRgba(mortar, 0.96);
  bdPavingPerimeterPath(g, layout.perimeter);
  g.fill();
  g.restore();

  // A narrow irregular soil feather seats the complete masonry field into the
  // terrain without washing translucent brown over its centre.
  const earthFeather = g.createRadialGradient(0, 0, layout.rx * 0.90,
    0, 0, layout.rx * 1.15);
  earthFeather.addColorStop(0.00, bdRgba(worn, 0.44));
  earthFeather.addColorStop(0.54, bdRgba(worn, 0.30));
  earthFeather.addColorStop(1.00, bdRgba(worn, 0));
  g.fillStyle = earthFeather;
  g.beginPath(); g.arc(0, 0, layout.rx * 1.15, 0, BD_TAU); g.fill();

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

/** Open stone balustrade used by the British civic roof and stair landings. */
function bdCivicBalustrade(g, x0, x1, yBase, h, material, count) {
  const M = material || bdRamp(BMAT.LIMESTONE);
  const n = Math.max(2, count || 8);
  bdRect(g, x0 - 1.2, yBase - h, x1 - x0 + 2.4, 2.0, M, { litW: 0.55, edge: true });
  bdRect(g, x0 - 1.5, yBase - 2.0, x1 - x0 + 3.0, 2.2, M, { litW: 0.60, edge: true });
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    bdRect(g, x - 0.75, yBase - h + 2.0, 1.5, h - 4.0, M, { litW: 0.38, lineW: 0.65 });
    bdEllipse(g, x, yBase - h * 0.52, 1.15, 1.55, M, { litW: 0.38, lineW: 0.6 });
  }
}

/** Balustrade receding across an isometric side plane. */
function bdCivicIsoBalustrade(g, x0, y0, x1, y1, h, material, count) {
  const M = material || bdRamp(BMAT.LIMESTONE);
  const n = Math.max(2, count || 4);
  bdBeam(g, M, x0, y0 - h, x1, y1 - h, 2.0, { cap: 'butt' });
  bdBeam(g, M, x0, y0, x1, y1, 2.2, { cap: 'butt' });
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    bdBeam(g, M, x, y - 1, x, y - h + 1, 1.45, { cap: 'butt' });
    bdEllipse(g, x, y - h * 0.50, 1.0, 1.35, M, { litW: 0.35, lineW: 0.55 });
  }
}

/** Dressed-stone urn and finial, deliberately oversized at command zoom. */
function bdCivicUrn(g, cx, yBase, material, scale) {
  const M = material || bdRamp(BMAT.LIMESTONE), k = scale || 1;
  bdRect(g, cx - 2.3 * k, yBase - 2.2 * k, 4.6 * k, 2.2 * k, M, { litW: 0.45 });
  bdLitPath(g, function (c) {
    c.moveTo(cx - 1.7 * k, yBase - 2.2 * k);
    c.quadraticCurveTo(cx - 3.0 * k, yBase - 5.4 * k, cx - 1.2 * k, yBase - 7.1 * k);
    c.lineTo(cx + 1.2 * k, yBase - 7.1 * k);
    c.quadraticCurveTo(cx + 3.0 * k, yBase - 5.4 * k, cx + 1.7 * k, yBase - 2.2 * k);
    c.closePath();
  }, M, { bbox: [cx - 3 * k, yBase - 7.1 * k, 6 * k, 5 * k], litW: 0.55, edge: true });
  bdEllipse(g, cx, yBase - 7.4 * k, 1.7 * k, 0.85 * k, M, { litW: 0.4 });
}

/** Small extruded block for the clock cupola's stacked masonry stages. */
function bdCivicIsoBlock(g, cx, yBot, w, h, depth, rise, material) {
  const M = material || bdRamp(BMAT.LIMESTONE), x0 = cx - w / 2, x1 = cx + w / 2;
  bdPoly(g, [x1, yBot - h, x1 + depth, yBot - h - rise,
    x1 + depth, yBot - rise, x1, yBot], M,
  { fill: M.shade, shade: false, litW: 0.55, edge: true });
  bdRect(g, x0, yBot - h, w, h, M, { litW: 0.9, edge: true });
  bdPoly(g, [x0, yBot - h, x1, yBot - h, x1 + depth, yBot - h - rise,
    x0 + depth, yBot - h - rise], M,
  { fill: M.lit, shade: false, litW: 0.5, edge: true });
}

/** Clock face with a raised bezel and readable hands at 2x zoom. */
function bdCivicClock(g, cx, cy, r, material) {
  const M = material || bdRamp(BMAT.LIMESTONE), I = bdRamp(BMAT.IRON);
  bdEllipse(g, cx, cy, r + 1.8, r + 1.8, M, { litW: 0.65, edge: true });
  bdEllipse(g, cx, cy, r, r, bdRamp('#E5DDC6'), { litW: 0.55, edge: true });
  g.strokeStyle = bdRgba(I.shade, 0.90); g.lineWidth = 0.7;
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * BD_TAU - Math.PI / 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    g.lineTo(cx + Math.cos(a) * r * 0.90, cy + Math.sin(a) * r * 0.90);
    g.stroke();
  }
  g.strokeStyle = I.line; g.lineCap = 'round';
  g.lineWidth = 1.05; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy - r * 0.60); g.stroke();
  g.lineWidth = 0.85; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * 0.48, cy + r * 0.17); g.stroke();
  g.fillStyle = I.lit; g.beginPath(); g.arc(cx, cy, 1.0, 0, BD_TAU); g.fill();
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
    bdLantern(g, -G.bw * 0.56, G.yG - h * 0.19, o.side);
    bdLantern(g, G.bw * 0.56, G.yG - h * 0.19, o.side);
    if (o.nation === 'england') {
      // A formal civic forecourt keeps the grand British hall uncluttered.
      bdGardenBed(g, left * 1.02, y + 5, w * 0.18, seed + 1);
      bdGardenBed(g, right * 1.02, y + 5, w * 0.18, seed + 2);
    } else {
      bdGardenBed(g, left * 0.92, y + 3, w * 0.24, seed + 1);
      bdGardenBed(g, right * 0.92, y + 3, w * 0.24, seed + 2);
      bdCrate(g, right + 2, y + 4, 13, 10, seed + 3);
      bdBarrel(g, right - 11, y + 5, 9, 13);
    }
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
  // Every shell has a real down-right volume, projected obliquely into the
  // world. The older façade-only stamps had excellent surface painting but
  // still read as theatre flats; these two values expose a second wall and
  // roof face while keeping the simulation's top-down footprint unchanged.
  const depth = w * (o.depthK == null ? 0.165 : o.depthK);
  const rise = depth * (o.riseK == null ? 0.46 : o.riseK);
  return {
    w: w, h: h, bw: bw, yG: yG, wallH: wallH, yE: yE,
    over: over, rw: rw, roofH: roofH, yR: yR, rr: rr, plinth: plinth,
    depth: depth, rise: rise,
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
    c.lineTo(G.rr + G.depth, G.yR - G.rise);
    c.lineTo(G.rw + G.depth, G.yE - G.rise);
    c.lineTo(G.bw + G.depth, G.yG - G.rise);
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
    bdPoly(g, [G.bw + 1.6, G.yG - G.plinth, G.bw + G.depth + 1.6, G.yG - G.plinth - G.rise,
      G.bw + G.depth + 1.6, G.yG - G.rise, G.bw + 1.6, G.yG], F,
    { fill: F.shade, shade: false, litW: 0.65, edge: true });
    bdRect(g, px, G.yG - G.plinth, pw, G.plinth, F, { litW: 1.1 });
    bdStoneCourses(g, function (c) { c.rect(px, G.yG - G.plinth, pw, G.plinth); },
      px, G.yG - G.plinth, pw, G.plinth, F, seed * 7 + 3, G.plinth * 0.52);
  }

  // --- wall body
  const wy = G.yE, wh = G.yG - G.plinth - G.yE;
  const sidePath = function (c) {
    c.moveTo(G.bw, wy);
    c.lineTo(G.bw + G.depth, wy - G.rise);
    c.lineTo(G.bw + G.depth, wy + wh - G.rise);
    c.lineTo(G.bw, wy + wh);
    c.closePath();
  };
  bdLitPath(g, sidePath, wall, {
    bbox: [G.bw, wy - G.rise, G.depth, wh + G.rise],
    fill: wall.shade, shade: false, litW: 0.7, edge: true, edgeA: 0.58,
  });
  // Perspective joints make the extra face read as masonry/timber instead of
  // a single darker polygon. They are clipped and baked once, so the added
  // architectural depth has no per-frame cost.
  g.save();
  g.beginPath(); sidePath(g); g.clip();
  g.strokeStyle = bdRgba(wall.line, 0.48);
  g.lineWidth = 0.65;
  const course = Math.max(3.2, wh * 0.13);
  for (let cy = wy + course; cy < wy + wh; cy += course) {
    const t = (cy - wy) / Math.max(1, wh);
    g.beginPath();
    g.moveTo(G.bw, cy);
    g.lineTo(G.bw + G.depth, cy - G.rise);
    g.stroke();
    if (o.material === 'stone' || o.material === 'log') {
      const jointT = ((Math.floor(t * 20) & 1) ? 0.35 : 0.68);
      const jx = G.bw + G.depth * jointT;
      const jy = cy - G.rise * jointT;
      g.beginPath(); g.moveTo(jx, jy - course); g.lineTo(jx, jy); g.stroke();
    }
  }
  for (let t = 0.32; t < 0.9; t += 0.32) {
    g.beginPath();
    g.moveTo(G.bw + G.depth * t, wy - G.rise * t);
    g.lineTo(G.bw + G.depth * t, wy + wh - G.rise * t);
    g.stroke();
  }
  g.restore();
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

  // Down-right roof plane of the extruded shell. Its colder, darker value and
  // converging tile seams establish the same oblique volume as the side wall.
  const sideRoof = [rr, yR, rr + G.depth, yR - G.rise,
    rw + G.depth, yE - G.rise, rw, yE];
  bdPoly(g, sideRoof, R, {
    fill: R.shade, shade: false, litW: 0.65, edge: true, edgeA: 0.65,
  });
  g.save();
  g.beginPath();
  g.moveTo(sideRoof[0], sideRoof[1]);
  for (let i = 2; i < sideRoof.length; i += 2) g.lineTo(sideRoof[i], sideRoof[i + 1]);
  g.closePath(); g.clip();
  g.strokeStyle = bdRgba(R.line, 0.58); g.lineWidth = 0.65;
  for (let t = 0.18; t < 0.92; t += 0.18) {
    const ax = rr + (rw - rr) * t, ay = yR + (yE - yR) * t;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + G.depth, ay - G.rise); g.stroke();
  }
  g.strokeStyle = bdRgba(R.edge, 0.38); g.lineWidth = 0.55;
  for (let t = 0.25; t < 0.9; t += 0.25) {
    g.beginPath();
    g.moveTo(rr + G.depth * t, yR - G.rise * t);
    g.lineTo(rw + G.depth * t, yE - G.rise * t);
    g.stroke();
  }
  g.restore();

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
     town_center  centered clock cupola over a flat balustraded civic roof
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

function bdPaintEnglishTownCenter(g, o) {
  const def = o.def;
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.37, groundK: 0.42, wallK: 0.70,
    overK: 0.025, roofK: 0.06, hipK: 0.90, plinthK: 0.15,
    depthK: 0.18, riseK: 0.46,
  });
  const wall = bdRamp('#C7B58E');
  const panel = bdRamp('#D6C18F');
  const Q = bdRamp('#D9D3C3');
  const glass = bdRamp(BMAT.GLASS);
  const roof = bdRamp(bdMix(BMAT.SLATE, '#77756E', 0.48));

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'plain' });

  // Deep sash windows on the visible side elevation. Their skew follows the
  // same projection as the wall, so they remain embedded in the architecture.
  for (const t of [0.28, 0.73]) {
    const half = 0.13;
    const x0 = G.bw + G.depth * (t - half), x1 = G.bw + G.depth * (t + half);
    const y0 = G.yE + 12 - G.rise * (t - half), y1 = G.yE + 12 - G.rise * (t + half);
    bdPoly(g, [x0 - 1.2, y0 - 1.3, x1 + 1.2, y1 - 1.3,
      x1 + 1.2, y1 + 16.3, x0 - 1.2, y0 + 16.3], Q,
    { fill: Q.base, shade: false, litW: 0.5, edge: true });
    bdPoly(g, [x0, y0, x1, y1, x1, y1 + 14, x0, y0 + 14], glass,
      { fill: glass.shade, shade: false, litW: 0.35 });
    g.strokeStyle = bdRgba(Q.lit, 0.78); g.lineWidth = 0.55;
    g.beginPath(); g.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
    g.lineTo((x0 + x1) / 2, (y0 + y1) / 2 + 14); g.stroke();
  }

  const facadeBottom = G.yG - G.plinth;
  const facadeH = facadeBottom - G.yE;
  const lowerTop = G.yE + facadeH * 0.66;

  // Warm recessed bays behind the pale monumental order reproduce the deep
  // gold-and-stone rhythm of the reference without flattening into stripes.
  for (const cx of [-G.bw * 0.62, 0, G.bw * 0.62]) {
    bdRect(g, cx - G.bw * 0.19, G.yE + 4.5, G.bw * 0.38, lowerTop - G.yE - 7,
      panel, { litW: 0.55, edge: true, edgeA: 0.45 });
    bdSashWindow(g, cx, G.yE + facadeH * 0.35, 10.5, 23, {
      trim: '#DED8C8', frame: '#E7E1D3', keystone: true,
    });
  }

  // Rusticated ground floor and a projecting string course support the tall
  // upper order. The reference building is visibly raised above the street.
  bdStoneCourses(g, function (c) { c.rect(-G.bw, lowerTop, G.bw * 2, facadeBottom - lowerTop); },
    -G.bw, lowerTop, G.bw * 2, facadeBottom - lowerTop, Q, o.seed * 17, 4.0, { ao: false });
  bdRect(g, -G.bw - 2.2, lowerTop - 1.2, G.bw * 2 + 4.4, 3.4, Q, { litW: 0.8, edge: true });
  bdSashWindow(g, -G.bw * 0.58, lowerTop + 8.0, 8.2, 9.0, { keystone: false });
  bdSashWindow(g, G.bw * 0.58, lowerTop + 8.0, 8.2, 9.0, { keystone: false });
  bdDoor(g, 0, facadeBottom, 12.5, facadeBottom - lowerTop - 1.5, BD_SIDE[o.side].rim, {});

  // Ashlar corners run the full height, alternating long and short blocks.
  const qh = facadeH / 9;
  for (let i = 0; i < 9; i++) {
    const inset = i % 2 ? 1.5 : 0;
    bdRect(g, -G.bw - 1.2, G.yE + i * qh, 8.0 - inset, qh - 0.45, Q, { litW: 0.6 });
    bdRect(g, G.bw - 6.8 + inset, G.yE + i * qh, 8.0 - inset, qh - 0.45, Q, { litW: 0.6 });
  }

  // Four colossal fluted columns carry a continuous entablature, matching the
  // reference's unmistakable three-bay neoclassical front.
  for (const cx of [-G.bw * 0.86, -G.bw * 0.29, G.bw * 0.29, G.bw * 0.86]) {
    bdClassicalColumn(g, cx, G.yE + 1.2, lowerTop + 2.2, 5.8, Q);
  }
  bdDentilCourse(g, -G.bw - 3.2, G.yE - 3.4, G.bw * 2 + 6.4, Q, 22);
  bdRect(g, -G.bw - 4, G.yE - 6.3, G.bw * 2 + 8, 3.1, Q, { litW: 0.8, edge: true });

  // Flat lead roof deck, then the full perimeter balustrade and urns. This is
  // the defining break from the previous pitched-roof Georgian model.
  const deckY = G.yE - 6.0;
  bdPoly(g, [-G.bw - 4, deckY, G.bw + 4, deckY,
    G.bw + G.depth + 4, deckY - G.rise, -G.bw + G.depth - 4, deckY - G.rise], roof,
  { fill: roof.lit, shade: false, litW: 0.8, edge: true });
  bdRect(g, -G.bw - 4.5, deckY - 0.5, G.bw * 2 + 9, 4.2, Q, { litW: 0.8, edge: true });
  bdCivicBalustrade(g, -G.bw + G.depth, G.bw + G.depth, deckY - G.rise, 8.0, Q, 12);
  bdCivicIsoBalustrade(g, G.bw, deckY, G.bw + G.depth, deckY - G.rise, 8.0, Q, 5);
  bdCivicBalustrade(g, -G.bw, G.bw, deckY, 8.5, Q, 13);
  for (const [x, y] of [[-G.bw, deckY], [G.bw, deckY],
    [-G.bw + G.depth, deckY - G.rise], [G.bw + G.depth, deckY - G.rise]]) {
    bdCivicUrn(g, x, y - 7.4, Q, 0.74);
  }

  // Broad ceremonial stair with stone cheek walls and open iron handrails.
  const St = bdRamp(bdMix(BMAT.STONE, BT.EARTH, 0.18));
  const stairTop = G.yG - 6.0;
  for (let i = 0; i < 6; i++) {
    const sw = 30 + i * 6.5, sy = stairTop + i * 3.0;
    bdRect(g, -sw / 2, sy, sw, 3.2, St, { litW: 0.75, edge: true, lineW: 0.75 });
  }
  const iron = bdRamp(BMAT.IRON);
  for (const side of [-1, 1]) {
    bdBeam(g, iron, side * 13.5, stairTop - 2.5, side * 31, stairTop + 15, 1.15, { cap: 'round' });
    for (let i = 0; i < 4; i++) {
      const t = i / 3, x = side * (13.5 + 17.5 * t), y = stairTop + 15 * t;
      bdBeam(g, iron, x, y + 2, x, y - 5.5, 0.9, { cap: 'butt' });
    }
  }

  // Centered square clock cupola: stepped base, clock stage, open bell lantern,
  // shallow lead cap and a final weather-vane needle.
  const bx = -6, baseBot = deckY - G.rise * 0.26;
  bdCivicIsoBlock(g, bx, baseBot, 26, 7, 6.0, 2.8, Q);
  const clockBot = baseBot - 6.0;
  bdCivicIsoBlock(g, bx, clockBot, 19, 22, 5.0, 2.3, Q);
  bdCivicClock(g, bx, clockBot - 11.5, 5.3, Q);
  bdDentilCourse(g, bx - 11.5, clockBot - 24.5, 23, Q, 8);
  const lanternBot = clockBot - 25.0, lanternH = 14.5;
  g.fillStyle = bdShadow(0.88);
  g.fillRect(bx - 7.0, lanternBot - lanternH, 14.0, lanternH);
  for (const cx of [bx - 6.0, bx + 6.0]) bdClassicalColumn(g, cx, lanternBot - lanternH, lanternBot, 2.4, Q);
  const bell = bdRamp('#A9893D');
  bdEllipse(g, bx, lanternBot - 5.4, 3.2, 3.6, bell, { litW: 0.55, edge: true });
  bdRect(g, bx - 9.0, lanternBot - lanternH - 2.5, 18.0, 3.0, Q, { litW: 0.7, edge: true });
  const capY = lanternBot - lanternH - 2.3;
  bdPoly(g, [bx - 10.5, capY, bx + 10.5, capY, bx + 6.8, capY - 5.2, bx - 6.8, capY - 5.2],
    roof, { litW: 0.8, edge: true, shadeX: 0.64 });
  bdCivicIsoBlock(g, bx, capY - 5.0, 6.2, 6.6, 2.0, 0.9, Q);
  bdPoly(g, [bx - 4.2, capY - 11.5, bx + 4.2, capY - 11.5, bx, capY - 16.0],
    roof, { litW: 0.7, edge: true });
  const finial = bdRamp('#A58942');
  bdBeam(g, finial, bx, capY - 15.2, bx, capY - 24.5, 1.1, { cap: 'butt' });
  bdEllipse(g, bx, capY - 17.2, 1.8, 1.8, finial, { litW: 0.4 });
  g.strokeStyle = finial.lit; g.lineWidth = 0.75;
  g.beginPath(); g.moveTo(bx - 4.5, capY - 22.5); g.lineTo(bx + 4.5, capY - 22.5); g.stroke();

  // A compact gameplay banner keeps faction ownership legible without
  // overwhelming the reference's restrained civic silhouette.
  bdBanner(g, G.bw + G.depth * 0.76, deckY - G.rise * 0.76, 24, o.side,
    { w: 13, h: 9, dir: o.side === 0 ? 1 : -1 });
  return G;
}

function bdPaintOttomanTownCenter(g, o) {
  const def = o.def;
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.40, groundK: 0.40, wallK: 0.50,
    overK: 0.055, roofK: 0.36, hipK: 0.58, plinthK: 0.13,
  });
  const wall = bdRamp(BMAT.PLASTER_WARM);
  const roof = bdRamp(bdMix(BMAT.SLATE, o.natRoof, 0.55));
  const Q = bdRamp(BMAT.LIMESTONE);

  bdWalls(g, G, { wall: wall, seed: o.seed, material: 'plain' });
  bdRect(g, -G.bw, G.yE + G.wallH * 0.45, G.bw * 2, 2.3, Q, { litW: 0.7, edge: true });
  const qh = (G.yG - G.plinth - G.yE) / 7;
  for (let i = 0; i < 7; i++) {
    const inset = i % 2 ? 1.5 : 0;
    bdRect(g, -G.bw - 1, G.yE + i * qh, 8.5 - inset, qh - 0.5, Q, { litW: 0.65 });
    bdRect(g, G.bw - 7.5 + inset, G.yE + i * qh, 8.5 - inset, qh - 0.5, Q, { litW: 0.65 });
  }
  for (let i = -2; i <= 2; i++) {
    if (i !== 0) bdArchedWindow(g, i * G.bw * 0.36, G.yE + G.h * 0.16, 8, 13);
  }

  const pW = G.bw * 0.62, pTop = G.yE + G.h * 0.30, pBot = G.yG - G.plinth * 0.4;
  g.fillStyle = bdShadow(0.34); g.fillRect(-pW + 2, pTop + 2, pW * 2, pBot - pTop);
  bdDoor(g, 0, pBot, 15, G.h * 0.22, BD_SIDE[o.side].rim, { arch: true });
  const archY = pTop + 5.5;
  g.strokeStyle = Q.base; g.lineWidth = 2.4;
  for (let bay = -1; bay <= 1; bay++) {
    const cx = bay * pW * 0.62;
    g.beginPath();
    g.moveTo(cx - pW * 0.28, pBot - 1); g.lineTo(cx - pW * 0.28, archY + 8);
    g.quadraticCurveTo(cx - pW * 0.16, archY, cx, archY - 4);
    g.quadraticCurveTo(cx + pW * 0.16, archY, cx + pW * 0.28, archY + 8);
    g.lineTo(cx + pW * 0.28, pBot - 1); g.stroke();
  }
  for (const cx of [-pW, -pW * 0.34, pW * 0.34, pW]) bdClassicalColumn(g, cx, pTop - 1, pBot, 5.4, Q);
  bdDentilCourse(g, -pW - 3, pTop - 4, pW * 2 + 6, Q, 15);

  const St = bdRamp(bdMix(BMAT.STONE, BT.EARTH, 0.18));
  for (let i = 0; i < 3; i++) {
    bdRect(g, -pW * 0.7 - i * 5, G.yG - 6 + i * 2.6, pW * 1.4 + i * 10, 3.0, St, { litW: 0.8 });
  }
  bdDome(g, G, { roof: roof });

  const bx = -G.rr * 0.52, bBot = G.yR + 3, bH = G.h * 0.30, bW = def.w * 0.11;
  bdRect(g, bx - bW, bBot - bH, bW * 2, bH, wall, { litW: 1.3, edge: true });
  bdStoneCourses(g, function (c) { c.rect(bx - bW, bBot - bH, bW * 2, bH); },
    bx - bW, bBot - bH, bW * 2, bH, wall, o.seed * 3 + 7, bH * 0.2);
  g.fillStyle = bdShadow(0.86);
  g.beginPath();
  g.moveTo(bx - bW * 0.46, bBot - bH * 0.28); g.lineTo(bx - bW * 0.46, bBot - bH * 0.68);
  g.quadraticCurveTo(bx, bBot - bH * 0.96, bx + bW * 0.46, bBot - bH * 0.68);
  g.lineTo(bx + bW * 0.46, bBot - bH * 0.28); g.closePath(); g.fill();
  const Bell = bdRamp('#AE8737');
  bdEllipse(g, bx, bBot - bH * 0.50, bW * 0.30, bW * 0.34, Bell, { litW: 0.6, edge: true });
  bdEllipse(g, bx, bBot - bH - 1, bW + 2, bW * 0.52, roof, { litW: 1.0, edge: true });
  const Gold = bdRamp('#C9A24E');
  bdBeam(g, Gold, bx, bBot - bH - 2, bx, bBot - bH - G.h * 0.13, 1.4, { cap: 'butt' });
  g.strokeStyle = Gold.lit; g.lineWidth = 1.5;
  g.beginPath(); g.arc(bx + 1, bBot - bH - G.h * 0.15, 3.0, Math.PI * 0.42, Math.PI * 1.5); g.stroke();
  bdBanner(g, G.rr * 0.66, G.yR + 2, G.h * 0.34, o.side,
    { w: 20, h: 14, dir: o.side === 0 ? 1 : -1 });
  return G;
}

function bdPaintTownCenter(g, o) {
  return o.nation === 'ottoman' ? bdPaintOttomanTownCenter(g, o) : bdPaintEnglishTownCenter(g, o);
}

function bdPaintHouse(g, o) {
  const def = o.def, s = bdRnd(o.seed);
  const ottoman = o.nation === 'ottoman';
  const namedFlavor = {
    english_cottage: 7,
    english_townhouse: 2,
    english_mansion: 5,
    spooky_house: 5,
  }[o.type];
  const flavor = namedFlavor ?? (o.variant % 8);
  const mansion = flavor === 5;
  const spooky = o.type === 'spooky_house';
  const estate = flavor === 3 || flavor === 4 || flavor === 6;
  const rowHouse = flavor === 2;
  const cottage = flavor === 7;
  const brickHouse = !ottoman && (rowHouse || estate || flavor % 2 === 0);
  const scaleW = mansion ? 1.58 : estate ? 1.46 : rowHouse ? 1.34 : cottage ? 1.18 : 1;
  const scaleH = mansion ? 1.62 : estate ? 1.46 : rowHouse ? 1.18 : cottage ? 1.12 : 1;
  const G = bdGeometry({
    w: def.w * scaleW, h: def.h * scaleH,
    bwK: mansion ? 0.42 : estate ? 0.43 : rowHouse ? 0.46 : 0.40,
    groundK: 0.42,
    wallK: mansion ? 0.60 : estate ? 0.58 : rowHouse ? 0.57 : 0.54,
    overK: mansion ? 0.08 : 0.07,
    roofK: mansion ? 0.34 : ottoman ? 0.42 : 0.38,
    hipK: mansion ? 0.50 : estate ? 0.62 : 0.68,
    plinthK: mansion ? 0.15 : 0.13,
    depthK: estate || mansion ? 0.19 : 0.165,
  });
  const sideRim = (BD_SIDE[o.side] || BD_SIDE[0]).rim;
  const wallHex = spooky ? '#39363F'
    : mansion ? '#4D4951'
    : ottoman ? BMAT.PLASTER_WARM
    : brickHouse ? bdShiftHSL(BMAT.BRICK_RED, s(-0.015, 0.015), 0, s(-0.05, 0.04))
      : bdShiftHSL(BMAT.CLAPBOARD, s(-0.01, 0.01), 0, s(-0.05, 0.03));
  const wall = bdRamp(wallHex);
  const roof = bdRoofMat(spooky ? '#262834' : mansion ? '#434650' : ottoman ? BMAT.TILE : BMAT.SLATE,
    o.natRoof, mansion ? 0.18 : ottoman ? 0.30 : 0.45);

  bdWalls(g, G, { wall: wall, seed: o.seed, material: mansion ? 'stone' : 'plain' });
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

  if (estate || mansion) {
    const wing = bdRamp(mansion ? '#403D46' : wallHex);
    const yBot = G.yG - G.plinth + 0.5;
    const yTop = yBot - facadeH * (mansion ? 0.78 : 0.72);
    const wingW = G.bw * (mansion ? 0.46 : 0.38);
    const offset = G.bw * (mansion ? 0.76 : 0.72);
    for (const dir of [-1, 1]) {
      bdRect(g, dir * offset - wingW / 2, yTop, wingW, yBot - yTop, wing,
        { litW: 1.05, edge: true });
      if (mansion) {
        bdStoneCourses(g, function (c) {
          c.rect(dir * offset - wingW / 2, yTop, wingW, yBot - yTop);
        }, dir * offset - wingW / 2, yTop, wingW, yBot - yTop, wing, o.seed * 31 + dir, 4.2);
      } else {
        bdBrickCourses(g, dir * offset - wingW / 2, yTop, wingW, yBot - yTop, wing, o.seed * 29 + dir);
      }
      bdPoly(g, [
        dir * offset - wingW * 0.62, yTop + 2,
        dir * offset, yTop - G.h * 0.16,
        dir * offset + wingW * 0.62, yTop + 2,
      ], roof, { litW: 0.7, edge: true });
      if (mansion || dir === -1) {
        bdSashWindow(g, dir * offset, yTop + (yBot - yTop) * 0.42,
          wingW * 0.34, mansion ? 12 : 10, { trim: mansion ? '#7B7580' : BMAT.LIMESTONE });
      }
    }
  }

  const firstFloorY = G.yE + facadeH * 0.40;
  const secondFloorY = G.yE + facadeH * 0.70;
  const windowXs = estate || mansion || rowHouse
    ? [-G.bw * 0.66, -G.bw * 0.25, G.bw * 0.25, G.bw * 0.66]
    : [-G.bw * 0.52, G.bw * 0.52];
  const windowTrim = mansion ? '#7D7681' : BMAT.LIMESTONE;
  for (const wx of windowXs) {
    if (ottoman && !mansion) bdArchedWindow(g, wx, firstFloorY, 7.5, 11);
    else bdSashWindow(g, wx, firstFloorY, estate || mansion ? 7.2 : 8, estate || mansion ? 10.5 : 11,
      { trim: windowTrim, keystone: brickHouse || mansion });
  }
  if (estate || mansion || rowHouse) {
    for (const wx of mansion ? [-G.bw * 0.45, 0, G.bw * 0.45] : [-G.bw * 0.42, G.bw * 0.42]) {
      if (ottoman && !mansion) bdArchedWindow(g, wx, secondFloorY, 7.2, 10.5);
      else bdSashWindow(g, wx, secondFloorY, 7.0, 10,
        { trim: windowTrim, keystone: mansion });
      if (mansion && wx !== 0) {
        const P = bdRamp(BMAT.TIMBER_DARK);
        bdBeam(g, P, wx - 6, secondFloorY - 4, wx + 6, secondFloorY + 4, 1.5, { cap: 'butt' });
        bdBeam(g, P, wx + 6, secondFloorY - 4, wx - 6, secondFloorY + 4, 1.5, { cap: 'butt' });
      }
    }
  }

  if (mansion) {
    const tower = bdRamp('#3F3D47');
    const tw = G.bw * 0.26;
    const tBot = G.yG - G.plinth + 1;
    const tTop = G.yE - G.h * 0.36;
    const tx = -G.bw * 0.78;
    bdRect(g, tx - tw / 2, tTop, tw, tBot - tTop, tower, { litW: 1.0, edge: true });
    bdStoneCourses(g, function (c) { c.rect(tx - tw / 2, tTop, tw, tBot - tTop); },
      tx - tw / 2, tTop, tw, tBot - tTop, tower, o.seed * 41, 4.1);
    bdArchedWindow(g, tx, tTop + (tBot - tTop) * 0.35, tw * 0.36, 10);
    bdPoly(g, [tx - tw * 0.72, tTop + 2, tx, tTop - G.h * 0.22, tx + tw * 0.72, tTop + 2],
      roof, { litW: 0.85, edge: true });
  }

  if (mansion) {
    bdDoor(g, 0, G.yG - G.plinth, 12, G.h * 0.31, sideRim, { arch: true });
  } else {
    bdDoor(g, 0, G.yG - G.plinth, rowHouse || estate ? 11 : 10, G.h * 0.29, sideRim, { arch: ottoman });
  }

  if (!ottoman && !mansion) {
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

  if (estate || mansion || rowHouse) {
    const dormers = mansion ? [-G.rr * 0.50, 0, G.rr * 0.50] : [-G.rr * 0.35, G.rr * 0.35];
    const D = bdRamp(mansion ? '#6F6973' : BMAT.CLAPBOARD);
    for (const dx of dormers) {
      const dw = mansion ? 11 : 10;
      const dh = mansion ? 13 : 11;
      const yBot = G.yE - G.roofH * 0.18;
      bdRect(g, dx - dw / 2, yBot - dh, dw, dh, D, { litW: 0.75, edge: true });
      bdPoly(g, [dx - dw * 0.62, yBot - dh + 1, dx, yBot - dh - 7, dx + dw * 0.62, yBot - dh + 1],
        roof, { litW: 0.65, edge: true });
      if (mansion) bdArchedWindow(g, dx, yBot - dh * 0.47, 4.2, 6.4);
      else bdSashWindow(g, dx, yBot - dh * 0.47, 4.2, 6.2, { keystone: false });
    }
  }

  bdChimney(g, G.bw * 0.62, G.yE + 2, estate || mansion ? 8.5 : 7.5, G.h * (mansion ? 0.44 : 0.38));
  if (estate || mansion) bdChimney(g, -G.bw * 0.52, G.yE + 5, 7.2, G.h * 0.34);
  bdRidgePennant(g, -G.rr * 0.5, G.yR - 1, o.side, o.side % 2 === 0 ? 1 : -1);

  // A woodpile and a water butt against the wall — lived-in, and they break
  // the rectangle of the footprint
  bdLogPile(g, -G.bw * 0.72, G.yG - 1, estate || mansion ? 23 : 16, estate || mansion ? 3 : 2, o.seed * 5);
  if (estate || mansion) {
    bdFence(g, -G.bw * 1.12, G.bw * 1.14, G.yG + 11, 13, o.seed * 7, mansion ? 11 : 14);
    bdCart(g, G.bw * 0.92, G.yG + 9, 0.56, o.seed * 9);
  }
  if (mansion) {
    const Dead = bdRamp(spooky ? '#18151B' : BMAT.TIMBER_DARK);
    const bx = -G.bw * 1.22, by = G.yG + 5;
    bdBeam(g, Dead, bx, by, bx + 7, G.yE - G.h * 0.24, 2.5, { cap: 'butt' });
    bdBeam(g, Dead, bx + 5, G.yE - G.h * 0.02, bx - 9, G.yE - G.h * 0.18, 1.5, { cap: 'butt' });
    bdBeam(g, Dead, bx + 6, G.yE - G.h * 0.10, bx + 20, G.yE - G.h * 0.24, 1.4, { cap: 'butt' });
    const moon = bdRamp('#B9B19C');
    bdEllipse(g, G.bw * 0.96, G.yR - G.h * 0.07, 3.5, 3.5, moon, { litW: 0.7, edge: true });
  }
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

function bdCastleBastion(g, cx, yBase, width, height, stone, seed) {
  const top = yBase - height;
  const rr = bdRnd(seed);
  const outline = [
    cx - width * 0.58, yBase,
    cx - width * 0.52, top + height * 0.22,
    cx - width * 0.34, top,
    cx + width * 0.34, top,
    cx + width * 0.52, top + height * 0.22,
    cx + width * 0.58, yBase,
  ];
  bdPoly(g, outline, stone, { litW: 1.1, edge: true, shadeX: 0.64 });

  // A separate down-light face makes every bastion project from the curtain
  // wall instead of reading as a flat badge pasted onto it.
  bdPoly(g, [
    cx + width * 0.14, top,
    cx + width * 0.34, top,
    cx + width * 0.52, top + height * 0.22,
    cx + width * 0.58, yBase,
    cx + width * 0.12, yBase,
  ], stone, { fill: stone.shade, shade: false, litW: 0.55, edge: true });

  g.save();
  g.beginPath();
  g.moveTo(outline[0], outline[1]);
  for (let index = 2; index < outline.length; index += 2) {
    g.lineTo(outline[index], outline[index + 1]);
  }
  g.closePath();
  g.clip();
  g.strokeStyle = bdRgba(stone.line, 0.48);
  g.lineWidth = 0.62;
  const course = Math.max(4, height / 7);
  for (let y = top + course; y < yBase; y += course) {
    g.beginPath();
    g.moveTo(cx - width * 0.6, y + rr(-0.3, 0.3));
    g.lineTo(cx + width * 0.6, y + rr(-0.3, 0.3));
    g.stroke();
  }
  g.restore();

  const deck = bdRamp(bdMix(BMAT.STONE, BMAT.LIMESTONE, 0.18));
  bdPoly(g, [
    cx - width * 0.34, top,
    cx - width * 0.16, top - height * 0.11,
    cx + width * 0.33, top - height * 0.08,
    cx + width * 0.34, top,
  ], deck, { fill: deck.lit, shade: false, litW: 0.6, edge: true });

  // Merlons and true dark embrasures form the stepped artillery silhouette.
  const merlonWidth = width * 0.13;
  for (let index = -2; index <= 2; index++) {
    const x = cx + index * width * 0.17;
    bdRect(g, x - merlonWidth * 0.5, top - 8.5, merlonWidth, 9,
      stone, { litW: 0.65, edge: true, lineW: 0.72 });
  }
  g.fillStyle = bdShadow(0.74);
  for (let index = -2; index < 2; index++) {
    const x = cx + (index + 0.5) * width * 0.17;
    g.fillRect(x - width * 0.025, top - 4.2, width * 0.05, 4.4);
  }
  return { top, width };
}

function bdCastleCannon(g, x, y, direction, scale) {
  const k = scale || 1;
  const dir = direction < 0 ? -1 : 1;
  const iron = bdRamp('#343941');
  const timber = bdRamp(BMAT.TIMBER);
  const bronze = bdRamp('#665238');

  bdBeam(g, timber, x - dir * 3 * k, y + 5 * k, x + dir * 11 * k, y + 1.5 * k,
    3.8 * k, { cap: 'butt' });
  bdEllipse(g, x - dir * 1.5 * k, y + 6.3 * k, 4.5 * k, 4.5 * k,
    timber, { litW: 0.65, edge: true });
  bdEllipse(g, x - dir * 1.5 * k, y + 6.3 * k, 1.4 * k, 1.4 * k,
    iron, { litW: 0.35, edge: true });
  bdBeam(g, bronze, x, y, x + dir * 22 * k, y - 5.2 * k,
    5.2 * k, { cap: 'butt' });
  bdEllipse(g, x + dir * 22 * k, y - 5.2 * k, 2.2 * k, 3.2 * k,
    iron, { litW: 0.6, edge: true });
  bdEllipse(g, x - dir * 1.5 * k, y + 0.4 * k, 3.3 * k, 3.8 * k,
    bronze, { litW: 0.55, edge: true });
}

function bdCastleCurtain(g, x, yTop, width, height, stone, seed) {
  bdRect(g, x, yTop, width, height, stone, { litW: 1.0, edge: true });
  bdStoneCourses(g, function (path) { path.rect(x, yTop, width, height); },
    x, yTop, width, height, stone, seed, Math.max(4, height / 7), { ao: false });

  const count = Math.max(5, Math.floor(width / 18));
  const step = width / count;
  for (let index = 0; index < count; index++) {
    const mx = x + step * index + step * 0.12;
    bdRect(g, mx, yTop - 8, step * 0.58, 8.5, stone,
      { litW: 0.58, edge: true, lineW: 0.68 });
  }
  g.fillStyle = bdShadow(0.76);
  for (let index = 0; index < count - 1; index++) {
    const ex = x + step * (index + 0.78);
    g.fillRect(ex - step * 0.09, yTop - 3.7, step * 0.18, 3.9);
  }
}

function bdPaintCastle(g, o) {
  const def = o.def;
  const G = bdGeometry({
    w: def.w, h: def.h, bwK: 0.47, groundK: 0.42, wallK: 0.52,
    overK: 0.01, roofK: 0.34, hipK: 0.62, plinthK: 0.12,
  });
  const ottoman = o.nation === 'ottoman';
  const stone = bdRamp(ottoman ? bdMix(BMAT.STONE_ROUGH, '#AD9873', 0.20) : BMAT.STONE_ROUGH);
  const dressed = bdRamp(ottoman ? bdMix(BMAT.LIMESTONE, '#C6A873', 0.18) : BMAT.LIMESTONE);
  const roof = bdRoofMat(ottoman ? BMAT.TILE : BMAT.SLATE, o.natRoof, 0.46);
  const iron = bdRamp(BMAT.IRON);

  // A broad dry ditch and revetted glacis frame the fortress before any wall
  // rises. The broken double ellipse gives the mass a deep defensive shelf.
  g.save();
  g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.72);
  g.lineWidth = 14;
  g.beginPath();
  g.ellipse(0, G.yG + 7, def.w * 0.55, def.h * 0.31, 0, Math.PI * 1.03, Math.PI * 1.97);
  g.stroke();
  g.strokeStyle = bdRgba(dressed.base, 0.62);
  g.lineWidth = 3.2;
  g.beginPath();
  g.ellipse(0, G.yG + 4, def.w * 0.54, def.h * 0.29, 0, Math.PI * 1.02, Math.PI * 1.98);
  g.stroke();
  g.restore();

  // Rear works are painted first; their upper decks remain visible through
  // the central courtyard, establishing three distinct depth layers.
  bdCastleCurtain(g, -78, -10, 156, 34, stone, o.seed * 7 + 1);
  const rearLeft = bdCastleBastion(g, -79, 22, 62, 39, stone, o.seed * 11 + 3);
  const rearRight = bdCastleBastion(g, 79, 22, 62, 39, stone, o.seed * 13 + 5);

  // Barracks and arsenal blocks form the inner ward. The courtyard gap stays
  // genuinely open between their side wings instead of becoming a flat wall.
  const keep = bdGeometry({
    w: def.w * 0.54, h: def.h * 0.82, bwK: 0.39, groundK: 0.13,
    wallK: 0.43, overK: 0.04, roofK: ottoman ? 0.31 : 0.23,
    hipK: 0.64, plinthK: 0.12, depthK: 0.14,
  });
  const keepWall = bdRamp(ottoman ? BMAT.PLASTER_WARM : bdMix(BMAT.BRICK_RED, BMAT.STONE, 0.42));
  bdWalls(g, keep, { wall: keepWall, seed: o.seed * 17, material: ottoman ? 'plain' : 'stone' });
  for (const x of [-keep.bw * 0.58, keep.bw * 0.58]) {
    if (ottoman) bdArchedWindow(g, x, keep.yE + keep.wallH * 0.36, 8.5, 14);
    else bdSashWindow(g, x, keep.yE + keep.wallH * 0.36, 8.5, 14, { keystone: true });
  }
  bdDoor(g, 0, keep.yG - keep.plinth, 15, keep.wallH * 0.44, BD_SIDE[o.side].rim, { arch: true });
  if (ottoman) bdDome(g, keep, { roof });
  else bdRoof(g, keep, { roof, roofKind: 'slate', seed: o.seed * 19, pitch: 3.6 });

  // Twin powder-magazine wings step forward from the keep and expose their
  // shaded side planes. Their roofs sit below the command block's ridge.
  for (const side of [-1, 1]) {
    const cx = side * 61;
    bdCivicIsoBlock(g, cx, 24, 43, 31, side < 0 ? -9 : 9, side < 0 ? 4 : -4, stone);
    bdPoly(g, [cx - 25, -7, cx + 25, -7, cx + 18, -21, cx - 18, -21],
      roof, { litW: 0.75, edge: true, shadeX: side < 0 ? 0.76 : 0.58 });
    g.fillStyle = bdShadow(0.83);
    g.fillRect(cx - 3.4, 4, 6.8, 12);
    bdRect(g, cx - 5.3, 2.3, 10.6, 2.2, dressed, { litW: 0.5, edge: true });
  }

  // Side curtains enclose the ward before the nearer gatehouse is layered in.
  bdCastleCurtain(g, -99, 16, 34, 43, stone, o.seed * 23 + 7);
  bdCastleCurtain(g, 65, 16, 34, 43, stone, o.seed * 29 + 11);
  bdCastleCurtain(g, -70, 25, 140, 43, stone, o.seed * 31 + 13);

  // A deep arched gate, portcullis, voussoirs and drawbridge occupy the front
  // curtain. The layered dark reveal is intentionally the focal depth cue.
  const gateY = 68;
  const gateW = 28;
  const gateH = 36;
  g.fillStyle = bdShadow(0.92);
  g.beginPath();
  g.moveTo(-gateW / 2, gateY);
  g.lineTo(-gateW / 2, gateY - gateH + gateW * 0.5);
  g.arc(0, gateY - gateH + gateW * 0.5, gateW * 0.5, Math.PI, 0);
  g.lineTo(gateW / 2, gateY);
  g.closePath();
  g.fill();
  g.strokeStyle = dressed.lit;
  g.lineWidth = 2.5;
  g.stroke();
  g.strokeStyle = bdRgba(iron.lit, 0.84);
  g.lineWidth = 1;
  for (let x = -10; x <= 10; x += 5) {
    g.beginPath(); g.moveTo(x, gateY - 25); g.lineTo(x, gateY); g.stroke();
  }
  for (let y = gateY - 20; y <= gateY - 5; y += 5) {
    g.beginPath(); g.moveTo(-12, y); g.lineTo(12, y); g.stroke();
  }
  const bridge = bdRamp(BMAT.TIMBER);
  bdPoly(g, [-15, gateY - 1, 15, gateY - 1, 28, gateY + 24, -28, gateY + 24],
    bridge, { litW: 0.85, edge: true, shadeY: 0.68 });
  g.strokeStyle = bdRgba(bridge.line, 0.72);
  g.lineWidth = 0.8;
  for (let y = gateY + 3; y < gateY + 23; y += 4) {
    g.beginPath(); g.moveTo(-18 - (y - gateY) * 0.4, y); g.lineTo(18 + (y - gateY) * 0.4, y); g.stroke();
  }

  const frontLeft = bdCastleBastion(g, -88, 72, 70, 50, stone, o.seed * 37 + 17);
  const frontRight = bdCastleBastion(g, 88, 72, 70, 50, stone, o.seed * 41 + 19);

  // The actual ordnance is visible on every projecting work: bronze barrels,
  // trucks, wheels and dark muzzles aimed across overlapping approaches.
  bdCastleCannon(g, -82, rearLeft.top - 5, -1, 0.82);
  bdCastleCannon(g, 82, rearRight.top - 5, 1, 0.82);
  bdCastleCannon(g, -91, frontLeft.top - 5, -1, 0.96);
  bdCastleCannon(g, 91, frontRight.top - 5, 1, 0.96);
  bdCastleCannon(g, -29, 20, -1, 0.72);
  bdCastleCannon(g, 29, 20, 1, 0.72);

  // Powder barrels, shot pyramids, sentry lamps and two standards make the
  // fortress feel occupied while preserving clear faction recognition.
  bdBarrel(g, -52, 59, 10, 15);
  bdBarrel(g, -42, 61, 9, 13);
  for (const baseX of [43, 51]) {
    for (let row = 0; row < 3; row++) {
      for (let ball = 0; ball < 3 - row; ball++) {
        bdEllipse(g, baseX + ball * 3 + row * 1.5, 60 - row * 2.6,
          1.6, 1.6, iron, { litW: 0.3, edge: true, lineW: 0.4 });
      }
    }
  }
  bdLantern(g, -19, 48, o.side);
  bdLantern(g, 19, 48, o.side);
  bdBanner(g, -62, -12, 62, o.side, { w: 23, h: 16, dir: -1 });
  bdBanner(g, 62, -12, 62, o.side, { w: 23, h: 16, dir: 1 });
  bdBanner(g, 0, keep.yR - 2, 58, o.side, { w: 28, h: 19, dir: o.side === 0 ? 1 : -1 });

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
  const points = [
    [-hw * 0.94, -hh * 0.56], [-hw * 0.42, -hh * 0.88], [hw * 0.26, -hh * 0.91],
    [hw * 0.91, -hh * 0.67], [hw * 0.98, -hh * 0.08], [hw * 0.90, hh * 0.68],
    [hw * 0.35, hh * 0.91], [-hw * 0.34, hh * 0.88], [-hw * 0.94, hh * 0.58],
    [-hw, -hh * 0.02],
  ].map(([x, y]) => [x + rr(-1.8, 1.8), y + rr(-1.4, 1.4)]);
  const parcel = c => {
    c.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index++) c.lineTo(points[index][0], points[index][1]);
    c.closePath();
  };

  // A soft compressed shadow and grass-darkened verge seat the field in the
  // terrain. The previous hard outlined rounded rectangle read as a UI card.
  bdContactShadow(g, 3, 7, hw * 0.92, hh * 0.55, 0.62);
  g.save();
  g.beginPath(); parcel(g);
  g.fillStyle = bdRgba(BT.TURF_DEEP, 0.55);
  g.fill();
  g.translate(-1.3, -1.2);
  g.scale(0.975, 0.955);
  g.beginPath(); parcel(g);
  const earth = g.createLinearGradient(-hw, -hh, hw, hh);
  earth.addColorStop(0, '#786044');
  earth.addColorStop(0.44, '#59452F');
  earth.addColorStop(1, '#35291F');
  g.fillStyle = earth;
  g.fill();
  g.restore();

  g.save();
  g.beginPath(); parcel(g); g.clip();

  // Broad ridge/trough pairs establish actual relief. Crop is planted on the
  // crests below; the darker gaps stay visible instead of becoming flat straw
  // hatching. Slightly bowed lines keep the parcel hand-worked.
  const rowPitch = 7.2;
  for (let row = -5; row <= 5; row++) {
    const y = row * rowPitch + 1;
    const bend = (row % 3 - 1) * 1.1;
    g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.72);
    g.lineWidth = 3.7;
    g.beginPath();
    g.moveTo(-hw - 12, y + 9);
    g.quadraticCurveTo(0, y + bend, hw + 12, y - 9);
    g.stroke();
    g.strokeStyle = bdRgba(BT.EARTH_LIGHT, 0.28);
    g.lineWidth = 1.25;
    g.beginPath();
    g.moveTo(-hw - 12, y + 6.9);
    g.quadraticCurveTo(0, y + bend - 2.1, hw + 12, y - 11.1);
    g.stroke();
  }

  // Wheel ruts form a muted headland on the near edge and visually point back
  // toward the mill complex without drawing a bright gameplay connector.
  for (const offset of [-2.6, 2.6]) {
    g.strokeStyle = bdRgba(BT.MUD, 0.48);
    g.lineWidth = 1.25;
    g.beginPath();
    g.moveTo(-hw, hh * 0.66 + offset);
    g.bezierCurveTo(-hw * 0.25, hh * 0.55 + offset, hw * 0.3, hh * 0.72 + offset, hw, hh * 0.56 + offset);
    g.stroke();
  }

  // Crops grow in coherent rows. Layering dim lower stalks, warm stems and
  // sparse lit ears produces depth at normal zoom while retaining soil lanes.
  if (stage > 0) {
    const stemStep = [99, 5, 4, 3][stage];
    const height = [0, 4.0, 6.3, 8.4][stage];
    const canopyWidth = [0, 0.8, 1.1, 1.45][stage];
    const body = stage === 1 ? '#667746' : stage === 2 ? '#8B7D4A' : '#9D8948';
    const light = stage === 1 ? '#94A25A' : BT.STRAW_LIGHT;
    for (let row = -5; row <= 5; row++) {
      const rowY = row * rowPitch - 1;
      const depth = (row + 5) / 10;
      const halfColumns = 17 - Math.floor(Math.abs(row) * 1.25);
      const span = halfColumns * 3.25;
      const bend = (row % 3 - 1) * 1.1;

      // A shadowed canopy ribbon makes the crop read as a planted row at game
      // scale. The previous isolated marks looked like laid bricks once crop
      // density dropped below full growth.
      g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.32);
      g.lineWidth = canopyWidth + 1.3;
      g.beginPath(); g.moveTo(-span, rowY + span * 0.15 + 1.2);
      g.quadraticCurveTo(0, rowY + bend + 1.2, span, rowY - span * 0.15 + 1.2); g.stroke();
      const canopy = g.createLinearGradient(-span, rowY, span, rowY);
      canopy.addColorStop(0, bdRgba(bdMix(body, BT.EARTH_DARK, 0.34), 0.46));
      canopy.addColorStop(0.48, bdRgba(body, 0.54));
      canopy.addColorStop(1, bdRgba(bdMix(body, light, 0.18), 0.46));
      g.strokeStyle = canopy;
      g.lineWidth = canopyWidth;
      g.beginPath(); g.moveTo(-span, rowY + span * 0.15);
      g.quadraticCurveTo(0, rowY + bend, span, rowY - span * 0.15); g.stroke();
      g.strokeStyle = bdRgba(light, 0.28);
      g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(-span, rowY + span * 0.15 - canopyWidth * 0.38);
      g.quadraticCurveTo(0, rowY + bend - canopyWidth * 0.38,
        span, rowY - span * 0.15 - canopyWidth * 0.38); g.stroke();

      for (let column = -halfColumns; column <= halfColumns; column += stemStep) {
        const px = column * 3.25 + rr(-0.9, 0.9);
        const py = rowY - px * 0.15 + rr(-0.8, 0.8);
        const stalkHeight = height * (0.82 + depth * 0.2) * rr(0.82, 1.12);
        const lean = rr(-0.14, 0.20);
        g.strokeStyle = bdRgba(BT.EARTH_DARK, 0.20);
        g.lineWidth = 1.7;
        g.beginPath(); g.moveTo(px + 0.8, py + 0.8); g.lineTo(px + lean * stalkHeight + 0.8, py - stalkHeight + 0.8); g.stroke();
        g.strokeStyle = bdRgba(body, 0.80);
        g.lineWidth = 0.95;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + lean * stalkHeight, py - stalkHeight); g.stroke();
        g.strokeStyle = bdRgba(light, 0.55);
        g.lineWidth = 0.42;
        g.beginPath(); g.moveTo(px - 0.45, py - 0.5); g.lineTo(px + lean * stalkHeight - 0.45, py - stalkHeight); g.stroke();
        // A second shorter blade turns each mark into a small fan of wheat,
        // avoiding both hay-hatching and the brick-like look of thick bands.
        g.strokeStyle = bdRgba(body, 0.60);
        g.lineWidth = 0.62;
        g.beginPath(); g.moveTo(px + 0.6, py + 0.2);
        g.lineTo(px - lean * stalkHeight * 0.55 + 1.1, py - stalkHeight * 0.72); g.stroke();
        if (stage >= 2 && (column + row) % (stage === 3 ? 2 : 4) === 0) {
          g.fillStyle = bdRgba(light, 0.72);
          g.beginPath();
          g.ellipse(px + lean * stalkHeight, py - stalkHeight - 0.7, 0.62, 1.5, lean, 0, BD_TAU);
          g.fill();
        }
      }
    }
  } else {
    for (let row = -5; row <= 5; row++) {
      for (let column = -16; column <= 16; column += 2) {
        const px = column * 3.25 + rr(-0.7, 0.7);
        const py = row * rowPitch - px * 0.15 + rr(-0.5, 0.5);
        g.strokeStyle = bdRgba(BT.STRAW, 0.46);
        g.lineWidth = 0.75;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + rr(-0.4, 0.4), py - rr(1.2, 2.5)); g.stroke();
      }
    }
  }

  // Turned clods, flints and weeds break the repeated rows at the margins.
  for (let index = 0; index < 44; index++) {
    const edge = rr(0, 1) > 0.5;
    const px = edge ? rr(-hw, hw) : (rr(0, 1) > 0.5 ? -hw : hw) + rr(-4, 4);
    const py = edge ? (rr(0, 1) > 0.5 ? -hh : hh) + rr(-3, 3) : rr(-hh, hh);
    g.fillStyle = bdRgba(rr(0, 1) > 0.35 ? BT.EARTH_DARK : BT.ROCK_LIGHT, rr(0.2, 0.48));
    g.beginPath(); g.ellipse(px, py, rr(0.5, 1.5), rr(0.35, 1.0), rr(-0.5, 0.5), 0, BD_TAU); g.fill();
  }
  g.restore();

  // Low survey stakes keep ownership legible without fencing the whole parcel
  // or turning it back into a freestanding cartoon object.
  const timber = bdRamp(BMAT.TIMBER);
  for (const [sx, sy] of [[-hw * 0.88, hh * 0.48], [hw * 0.86, -hh * 0.49]]) {
    bdBeam(g, timber, sx, sy + 2, sx, sy - 6, 1.05, { cap: 'butt' });
  }
  g.fillStyle = BD_SIDE[side].rim;
  g.fillRect(-hw * 0.88 + 1, hh * 0.48 - 6, 5.5, 2.2);

  if (stage <= 2) {
    bdSack(g, hw * 0.68, hh * 0.56, 6.5, 8.5, seed * 19 + stage);
    if (stage <= 1) bdSack(g, hw * 0.77, hh * 0.55, 6, 7.5, seed * 23 + stage);
  }
}

// The foreground pass is composited after units. Only the near crop rows are
// repeated here, so a farmer's boots and lower legs disappear naturally among
// the wheat while the torso, arms and hoe remain readable.
function bdPaintFarmForeground(g, def, stage, seed) {
  if (stage <= 0) return;
  const hw = def.w * 0.5, hh = def.h * 0.5;
  const rr = bdRnd(seed + 991);
  const rowPitch = 7.2;
  const stemStep = [99, 5, 4, 3][stage];
  const height = [0, 4.0, 6.3, 8.4][stage];
  const canopyWidth = [0, 0.8, 1.1, 1.45][stage];
  const body = stage === 1 ? '#667746' : stage === 2 ? '#8B7D4A' : '#9D8948';
  const light = stage === 1 ? '#94A25A' : BT.STRAW_LIGHT;
  g.save();
  g.beginPath();
  g.moveTo(-hw * 0.96, 1); g.lineTo(hw * 0.97, -7);
  g.lineTo(hw * 0.88, hh * 0.72); g.lineTo(-hw * 0.92, hh * 0.78); g.closePath();
  g.clip();
  for (let row = 0; row <= 5; row++) {
    const rowY = row * rowPitch + 1;
    const halfColumns = 17 - Math.floor(Math.abs(row) * 1.25);
    const span = halfColumns * 3.25;
    const bend = (row % 3 - 1) * 1.1;
    g.strokeStyle = bdRgba(body, 0.48);
    g.lineWidth = canopyWidth;
    g.beginPath(); g.moveTo(-span, rowY + span * 0.15);
    g.quadraticCurveTo(0, rowY + bend, span, rowY - span * 0.15); g.stroke();
    g.strokeStyle = bdRgba(light, 0.28);
    g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(-span, rowY + span * 0.15 - canopyWidth * 0.38);
    g.quadraticCurveTo(0, rowY + bend - canopyWidth * 0.38,
      span, rowY - span * 0.15 - canopyWidth * 0.38); g.stroke();
    for (let column = -halfColumns; column <= halfColumns; column += stemStep) {
      const px = column * 3.25 + rr(-0.8, 0.8);
      const py = rowY - px * 0.15 + rr(-0.65, 0.65);
      const stalkHeight = height * (0.9 + row * 0.025) * rr(0.86, 1.12);
      const lean = rr(-0.12, 0.18);
      g.strokeStyle = bdRgba(body, 0.88);
      g.lineWidth = 1.05;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + lean * stalkHeight, py - stalkHeight); g.stroke();
      g.strokeStyle = bdRgba(light, 0.62);
      g.lineWidth = 0.45;
      g.beginPath(); g.moveTo(px - 0.4, py - 0.4); g.lineTo(px + lean * stalkHeight - 0.4, py - stalkHeight); g.stroke();
      g.strokeStyle = bdRgba(body, 0.66);
      g.lineWidth = 0.65;
      g.beginPath(); g.moveTo(px + 0.6, py + 0.2);
      g.lineTo(px - lean * stalkHeight * 0.55 + 1.1, py - stalkHeight * 0.72); g.stroke();
    }
  }
  g.restore();
}


/* ---------------------------------------------------------------------------
   8B. STONE FORTIFICATIONS

   Walls and gates are long, oriented terrain pieces rather than house shells.
   Their painter therefore builds every visible plane from the same axis used
   by placement and collision. Stone courses, merlons and gate ironwork remain
   individually modelled at close zoom instead of being stamped-on texture.
   ------------------------------------------------------------------------ */

function bdFortPoint(axis, normal, along, across, elevation) {
  return {
    x: axis.x * along + normal.x * across,
    y: axis.y * along + normal.y * across - (elevation || 0),
  };
}

function bdFortFlat(points) {
  const flat = [];
  for (const point of points) flat.push(point.x, point.y);
  return flat;
}

function bdFortBlock(g, axis, normal, along, across, halfLength, halfThickness,
  height, baseElevation, material, options) {
  const o = options || {};
  const R = material;
  const l = along - halfLength, r = along + halfLength;
  const back = across - halfThickness, front = across + halfThickness;
  const bottom = baseElevation || 0, top = bottom + Math.max(0.5, height);
  const bl = bdFortPoint(axis, normal, l, back, bottom);
  const br = bdFortPoint(axis, normal, r, back, bottom);
  const fr = bdFortPoint(axis, normal, r, front, bottom);
  const fl = bdFortPoint(axis, normal, l, front, bottom);
  const tbl = bdFortPoint(axis, normal, l, back, top);
  const tbr = bdFortPoint(axis, normal, r, back, top);
  const tfr = bdFortPoint(axis, normal, r, front, top);
  const tfl = bdFortPoint(axis, normal, l, front, top);

  // The end plane is painted before the long face, then capped by the lit top.
  // That overlap order keeps connected sections visually continuous.
  if (o.endPlane !== false) {
    bdPoly(g, bdFortFlat([br, fr, tfr, tbr]), bdRamp(R.shade), {
      litW: o.litW || 0.65, edge: true, edgeW: 0.32, lineW: o.lineW || 0.8,
    });
  }
  bdPoly(g, bdFortFlat([fl, fr, tfr, tfl]), R, {
    litW: o.litW || 0.75, edge: true, edgeW: 0.38, lineW: o.lineW || 0.9,
    shadeY: 0.82,
  });
  bdPoly(g, bdFortFlat([tbl, tbr, tfr, tfl]), o.topMaterial || bdRamp(R.lit), {
    litW: o.litW || 0.65, edge: true, edgeW: 0.34, lineW: o.lineW || 0.8,
    shade: false,
  });
  return { l, r, back, front, bottom, top, fl, fr, tfl, tfr };
}

function bdFortStoneFace(g, axis, normal, along, across, halfLength,
  baseElevation, height, seed, coarse) {
  const rr = bdRnd(seed || 1);
  const courseHeight = coarse ? 6.2 : 5.1;
  const courses = Math.max(1, Math.floor(height / courseHeight));
  const left = along - halfLength, right = along + halfLength;
  const mortar = bdRgba('#A7A69C', 0.34);
  const darkMortar = bdRgba('#242623', 0.90);
  const stones = [
    bdRamp('#666862'),
    bdRamp('#555851'),
    bdRamp('#74746C'),
    bdRamp('#484B47'),
  ];

  for (let row = 0; row < courses; row++) {
    const e0 = baseElevation + row * height / courses;
    const e1 = baseElevation + (row + 1) * height / courses;
    const blocks = Math.max(4, Math.round((halfLength * 2) / (coarse ? 13 : 10.5)));
    const offset = row & 1 ? 0.5 : 0;
    for (let index = -1; index <= blocks; index++) {
      const s0 = left + (index + offset) * (right - left) / blocks + rr(-0.5, 0.5);
      const s1 = left + (index + 1 + offset) * (right - left) / blocks + rr(-0.5, 0.5);
      const lo = Math.max(left, s0 + 0.35), hi = Math.min(right, s1 - 0.35);
      if (hi <= lo) continue;
      const material = stones[Math.floor(rr(0, stones.length)) % stones.length];
      const p0 = bdFortPoint(axis, normal, lo, across + 0.08, e0 + 0.3);
      const p1 = bdFortPoint(axis, normal, hi, across + 0.08, e0 + 0.3);
      const p2 = bdFortPoint(axis, normal, hi, across + 0.08, e1 - 0.3);
      const p3 = bdFortPoint(axis, normal, lo, across + 0.08, e1 - 0.3);
      bdPoly(g, bdFortFlat([p0, p1, p2, p3]), material, {
        line: false, lit: false, shade: false,
      });
      if ((row + index) % 3 === 0) {
        const pit = bdFortPoint(axis, normal,
          (lo + hi) * 0.5 + rr(-1.4, 1.4), across + 0.22,
          (e0 + e1) * 0.5 + rr(-0.8, 0.8));
        g.strokeStyle = bdRgba('#484641', 0.38);
        g.lineWidth = 0.46;
        g.beginPath();
        g.moveTo(pit.x - axis.x * 1.0, pit.y - axis.y * 1.0);
        g.lineTo(pit.x + axis.x * 1.0, pit.y + axis.y * 1.0);
        g.stroke();
      }
      if (index >= 0 && index < blocks) {
        const joint = bdFortPoint(axis, normal, hi, across + 0.14, e1 - 0.35);
        const jointBottom = bdFortPoint(axis, normal, hi, across + 0.14, e0 + 0.35);
        g.strokeStyle = index % 3 ? darkMortar : mortar;
        g.lineWidth = 0.86;
        g.beginPath(); g.moveTo(joint.x, joint.y); g.lineTo(jointBottom.x, jointBottom.y); g.stroke();
      }
    }
    const leftCourse = bdFortPoint(axis, normal, left, across + 0.15, e1);
    const rightCourse = bdFortPoint(axis, normal, right, across + 0.15, e1);
    g.strokeStyle = row & 1 ? darkMortar : mortar;
    g.lineWidth = 1.04;
    g.beginPath(); g.moveTo(leftCourse.x, leftCourse.y); g.lineTo(rightCourse.x, rightCourse.y); g.stroke();
    const leftHighlight = bdFortPoint(axis, normal, left, across + 0.22, e1 - 0.72);
    const rightHighlight = bdFortPoint(axis, normal, right, across + 0.22, e1 - 0.72);
    g.strokeStyle = mortar;
    g.lineWidth = 0.42;
    g.beginPath(); g.moveTo(leftHighlight.x, leftHighlight.y);
    g.lineTo(rightHighlight.x, rightHighlight.y); g.stroke();
  }
}

export function getFortificationMasonryDetailProfile(type = 'wall', joinedEnds = [false, false]) {
  const gate = type === 'gate';
  return Object.freeze({
    faceCourses: gate ? 8 : 7,
    plinthCourses: gate ? 3 : 2,
    capSpacing: gate ? 8.5 : 9,
    reliefBlocks: gate ? 18 : 14,
    exposedEnds: joinedEnds.map(joined => !joined),
    hasBatteredPlinth: !gate,
    supportsCurvedRuns: true,
    supportsGateAttachment: true,
    supportsStairAttachment: !gate,
  });
}

function bdFortTexturedStoneFace(
  g,
  axis,
  normal,
  along,
  across,
  halfLength,
  fullHalfLength,
  baseElevation,
  height,
  seed,
) {
  const image = getProductionArt('fortificationMasonry');
  if (!image || height <= 0.5 || halfLength <= 0.5) return;

  const left = along - halfLength;
  const right = along + halfLength;
  const bottomLeft = bdFortPoint(axis, normal, left, across + 0.18, baseElevation);
  const bottomRight = bdFortPoint(axis, normal, right, across + 0.18, baseElevation);
  const topRight = bdFortPoint(axis, normal, right, across + 0.18, baseElevation + height);
  const topLeft = bdFortPoint(axis, normal, left, across + 0.18, baseElevation + height);
  const widthFraction = bdClamp(halfLength / Math.max(halfLength, fullHalfLength), 0.04, 1);
  // Sample a close crop rather than crushing the entire source sheet into a
  // 30-pixel-high facade. Six readable ashlar courses retain pores, chipped
  // corners and joint depth at gameplay zoom; the old full-sheet projection
  // averaged that information into a nearly uniform beige rectangle.
  const sourceWidth = Math.max(64, image.naturalWidth * widthFraction * 0.62);
  const sourceHeight = Math.max(64,
    image.naturalHeight * bdClamp(height / 50, 0.16, 0.72));
  const variant = (Math.abs(seed | 0) % 997) / 997;
  const sourceX = (image.naturalWidth - sourceWidth) * variant;
  const sourceY = image.naturalHeight - sourceHeight;

  g.save();
  g.beginPath();
  g.moveTo(bottomLeft.x, bottomLeft.y);
  g.lineTo(bottomRight.x, bottomRight.y);
  g.lineTo(topRight.x, topRight.y);
  g.lineTo(topLeft.x, topLeft.y);
  g.closePath();
  g.clip();
  g.transform(
    (topRight.x - topLeft.x) / sourceWidth,
    (topRight.y - topLeft.y) / sourceWidth,
    (bottomLeft.x - topLeft.x) / sourceHeight,
    (bottomLeft.y - topLeft.y) / sourceHeight,
    topLeft.x,
    topLeft.y,
  );
  // The authored masonry supplies the chips, stains and recessed mortar that
  // make the fixed-angle production wall convincing. Keep that surface detail
  // intact when it is projected onto a curved/free-angle section.
  g.globalCompositeOperation = 'source-over';
  // This is the visible finish, not a faint colour wash over the old broad
  // procedural courses. Keeping it opaque preserves the source's recessed
  // mortar, chipped arrises and mineral variation after the cached stamp is
  // reduced to gameplay scale.
  g.globalAlpha = 1;
  g.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight);
  g.restore();
}

function bdFortDressedEndCap(g, axis, normal, along, halfThickness, height, seed) {
  if (height <= 8) return;
  const rr = bdRnd(seed || 1);
  const limestone = bdRamp('#777970');
  const darkJoint = bdRgba('#262824', 0.78);
  const courses = Math.max(3, Math.floor(height / 7.2));
  for (let row = 0; row < courses; row++) {
    const e0 = row * height / courses;
    const e1 = (row + 1) * height / courses;
    const inset = row & 1 ? 0.35 : -0.15;
    bdFortBlock(g, axis, normal, along + inset, halfThickness - 0.25,
      1.95 + rr(-0.18, 0.18), 2.65, Math.max(0.8, e1 - e0 - 0.25), e0 + 0.1,
      limestone, { lineW: 0.44, litW: 0.38, endPlane: false });
    const jointA = bdFortPoint(axis, normal, along + inset - 2.2, halfThickness + 2.58, e1);
    const jointB = bdFortPoint(axis, normal, along + inset + 2.2, halfThickness + 2.58, e1);
    g.strokeStyle = darkJoint;
    g.lineWidth = 0.46;
    g.beginPath(); g.moveTo(jointA.x, jointA.y); g.lineTo(jointB.x, jointB.y); g.stroke();
  }
}

function bdFortMasonryRelief(g, axis, normal, halfLength, halfThickness, height, seed, detail) {
  if (height <= 7 || halfLength <= 5) return;
  const rr = bdRnd(seed ^ 0x5f3759df);
  const count = Math.max(6, Math.round(detail.reliefBlocks * bdClamp(halfLength / 44, 0.38, 1.25)));
  const faceAcross = halfThickness + 0.48;
  for (let index = 0; index < count; index++) {
    const along = rr(-halfLength * 0.90, halfLength * 0.90);
    const elevation = rr(height * 0.12, height * 0.86);
    const width = rr(2.4, 6.8);
    const blockHeight = rr(1.1, 2.4);
    const litA = bdFortPoint(axis, normal, along - width * 0.5, faceAcross, elevation + blockHeight);
    const litB = bdFortPoint(axis, normal, along + width * 0.5, faceAcross, elevation + blockHeight);
    const shadeA = bdFortPoint(axis, normal, along - width * 0.5, faceAcross + 0.12, elevation);
    const shadeB = bdFortPoint(axis, normal, along + width * 0.5, faceAcross + 0.12, elevation);

    g.strokeStyle = bdRgba(index % 4 ? '#B9BAB1' : '#8E9087', rr(0.16, 0.30));
    g.lineWidth = rr(0.32, 0.58);
    g.beginPath(); g.moveTo(litA.x, litA.y); g.lineTo(litB.x, litB.y); g.stroke();
    g.strokeStyle = bdRgba('#2E2D2A', rr(0.16, 0.32));
    g.lineWidth = rr(0.44, 0.78);
    g.beginPath(); g.moveTo(shadeA.x, shadeA.y); g.lineTo(shadeB.x, shadeB.y); g.stroke();
  }

  // Broad damp seams and lime streaks break the flat rectangular read without
  // changing the fortification frame used by placement, pathing or collision.
  for (let index = 0; index < 5; index++) {
    const along = rr(-halfLength * 0.84, halfLength * 0.84);
    const top = rr(height * 0.45, height * 0.94);
    const bottom = rr(2.6, Math.min(height * 0.36, 10));
    const a = bdFortPoint(axis, normal, along, faceAcross + 0.2, top);
    const b = bdFortPoint(axis, normal, along + rr(-1.2, 1.2), faceAcross + 0.2, bottom);
    g.strokeStyle = index % 2
      ? bdRgba('#AFB1AA', rr(0.10, 0.20))
      : bdRgba('#252925', rr(0.22, 0.34));
    g.lineWidth = rr(0.42, 0.78);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
}

function bdFortBatteredPlinth(g, axis, normal, halfLength, halfThickness, height, seed) {
  if (height <= 5 || halfLength <= 3) return;
  const plinth = bdRamp('#3D403C');
  const lip = bdRamp('#696B64');
  const plinthHeight = Math.min(6.6, height * 0.30);
  bdFortBlock(g, axis, normal, 0, halfThickness + 0.95,
    Math.max(0.8, halfLength - 0.7), 2.25, plinthHeight, 0, plinth,
    { lineW: 0.5, litW: 0.34, endPlane: false, topMaterial: bdRamp('#50534E') });
  bdFortStoneFace(g, axis, normal, 0, halfThickness + 3.12,
    Math.max(0.8, halfLength - 1.2), 0, plinthHeight, seed ^ 0x4219, true);
  bdFortBlock(g, axis, normal, 0, halfThickness + 1.1,
    Math.max(0.8, halfLength - 0.2), 0.72, 0.9, plinthHeight - 0.1, lip,
    { lineW: 0.35, litW: 0.36, endPlane: false, topMaterial: bdRamp('#85877E') });
}

function bdFortFacePatina(
  g, axis, normal, halfLength, across, baseElevation, height, seed,
) {
  if (halfLength <= 2 || height <= 5) return;
  const rr = bdRnd(seed ^ 0x6d2b79f5);

  // Water-darkened mortar and sparse moss collect at the plinth. The broken
  // silhouette avoids the airbrushed green band that made older walls feel
  // like a single flat card.
  g.save();
  for (let index = 0; index < 9; index++) {
    const along = rr(-halfLength * 0.92, halfLength * 0.92);
    const elevation = rr(0.6, Math.min(6.8, height * 0.22));
    const point = bdFortPoint(axis, normal, along, across + 0.34, elevation);
    g.fillStyle = index % 3 === 0
      ? bdRgba('#777A4E', rr(0.18, 0.32))
      : bdRgba('#4D5244', rr(0.10, 0.22));
    g.beginPath();
    g.ellipse(point.x, point.y, rr(1.0, 3.3), rr(0.35, 1.0),
      Math.atan2(axis.y, axis.x), 0, BD_TAU);
    g.fill();
  }

  // Fine cracks branch through only a few blocks. They are deliberately
  // sub-pixel at final scale and read as surface age, never black outlines.
  g.strokeStyle = bdRgba('#3D3A34', 0.40);
  g.lineWidth = 0.42;
  for (let index = 0; index < 4; index++) {
    const along = rr(-halfLength * 0.78, halfLength * 0.78);
    const elevation = rr(height * 0.20, height * 0.82);
    let point = bdFortPoint(axis, normal, along, across + 0.40, elevation);
    g.beginPath(); g.moveTo(point.x, point.y);
    for (let branch = 1; branch <= 3; branch++) {
      point = bdFortPoint(axis, normal,
        along + rr(-1.4, 1.4) * branch, across + 0.40,
        elevation - branch * rr(1.0, 1.8));
      g.lineTo(point.x, point.y);
    }
    g.stroke();
  }

  // A cool occlusion line and warm upper lip state the sun direction even on
  // freely rotated sections where a fixed-angle painting cannot be used.
  const footA = bdFortPoint(axis, normal, -halfLength, across + 0.43, baseElevation + 0.5);
  const footB = bdFortPoint(axis, normal, halfLength, across + 0.43, baseElevation + 0.5);
  g.strokeStyle = bdRgba('#343631', 0.48);
  g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(footA.x, footA.y); g.lineTo(footB.x, footB.y); g.stroke();
  const lipA = bdFortPoint(axis, normal, -halfLength, across + 0.43, baseElevation + height - 0.45);
  const lipB = bdFortPoint(axis, normal, halfLength, across + 0.43, baseElevation + height - 0.45);
  g.strokeStyle = bdRgba('#C2C3B9', 0.32);
  g.lineWidth = 0.62;
  g.beginPath(); g.moveTo(lipA.x, lipA.y); g.lineTo(lipB.x, lipB.y); g.stroke();
  g.restore();
}

function bdFortTexturedStoneTop(
  g, axis, normal, halfLength, halfThickness, elevation, seed,
) {
  const image = getProductionArt('fortificationMasonry');
  if (!image || halfLength <= 0.5 || halfThickness <= 0.5) return;
  const left = -halfLength;
  const right = halfLength;
  const back = -halfThickness;
  const front = halfThickness;
  const topLeft = bdFortPoint(axis, normal, left, back, elevation);
  const topRight = bdFortPoint(axis, normal, right, back, elevation);
  const bottomRight = bdFortPoint(axis, normal, right, front, elevation);
  const bottomLeft = bdFortPoint(axis, normal, left, front, elevation);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = Math.max(64, image.naturalHeight * 0.42);
  const sourceY = (Math.abs(seed | 0) % 2) * (image.naturalHeight - sourceHeight);

  g.save();
  g.beginPath();
  g.moveTo(topLeft.x, topLeft.y);
  g.lineTo(topRight.x, topRight.y);
  g.lineTo(bottomRight.x, bottomRight.y);
  g.lineTo(bottomLeft.x, bottomLeft.y);
  g.closePath();
  g.clip();
  g.transform(
    (topRight.x - topLeft.x) / sourceWidth,
    (topRight.y - topLeft.y) / sourceWidth,
    (bottomLeft.x - topLeft.x) / sourceHeight,
    (bottomLeft.y - topLeft.y) / sourceHeight,
    topLeft.x,
    topLeft.y,
  );
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.90;
  g.drawImage(image, 0, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight);
  g.restore();
}

function bdFortTexturedTopSurface(
  g, axis, normal, along, across, halfLength, halfThickness,
  elevation, sourceYFraction, sourceHeightFraction,
) {
  const image = getProductionArt('fortificationWalkway');
  if (!image || halfLength <= 0.5 || halfThickness <= 0.35) return;
  const topLeft = bdFortPoint(axis, normal,
    along - halfLength, across - halfThickness, elevation);
  const topRight = bdFortPoint(axis, normal,
    along + halfLength, across - halfThickness, elevation);
  const bottomRight = bdFortPoint(axis, normal,
    along + halfLength, across + halfThickness, elevation);
  const bottomLeft = bdFortPoint(axis, normal,
    along - halfLength, across + halfThickness, elevation);
  const sourceWidth = image.naturalWidth;
  const sourceY = image.naturalHeight * sourceYFraction;
  const sourceHeight = image.naturalHeight * sourceHeightFraction;

  g.save();
  g.beginPath();
  g.moveTo(topLeft.x, topLeft.y);
  g.lineTo(topRight.x, topRight.y);
  g.lineTo(bottomRight.x, bottomRight.y);
  g.lineTo(bottomLeft.x, bottomLeft.y);
  g.closePath();
  g.clip();
  g.transform(
    (topRight.x - topLeft.x) / sourceWidth,
    (topRight.y - topLeft.y) / sourceWidth,
    (bottomLeft.x - topLeft.x) / sourceHeight,
    (bottomLeft.y - topLeft.y) / sourceHeight,
    topLeft.x,
    topLeft.y,
  );
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 0.96;
  g.drawImage(image, 0, sourceY, sourceWidth, sourceHeight,
    0, 0, sourceWidth, sourceHeight);
  g.restore();
}

function bdFortCrenels(g, axis, normal, centers, across, halfThickness,
  elevation, side, seed) {
  const stone = bdRamp(BMAT.STONE);
  for (let index = 0; index < centers.length; index++) {
    bdFortBlock(g, axis, normal, centers[index], across, 4.2, halfThickness,
      8.2 + (index + seed) % 2 * 0.7, elevation, stone,
      { lineW: 0.72, litW: 0.58 });
  }
  const pennant = bdFortPoint(axis, normal, centers[0], across, elevation + 8);
  if (centers.length <= 3) {
    bdBanner(g, pennant.x, pennant.y + 2, 14, side,
      { w: 9, h: 6.5, dir: side === 0 ? 1 : -1 });
  }
}

function bdFortWallCrown(
  g,
  axis,
  normal,
  halfLength,
  halfThickness,
  elevation,
  completion,
  side,
  seed,
  interiorSide = 1,
) {
  const built = bdClamp(completion, 0, 1);
  if (built <= 0) return;
  const crownHalfLength = Math.max(3, halfLength * built);
  const dressed = bdRamp('#555853');
  const capStone = bdRamp('#85877F');
  const walkway = bdRamp('#353936');

  // A dark recessed wall walk separates the two parapets. The old renderer
  // filled the entire depth with pale merlons, producing the repeated row of
  // oversized teeth visible in the reported screenshot.
  bdFortBlock(g, axis, normal, 0, 0, crownHalfLength, halfThickness - 3.4,
    1.1, elevation - 0.15, walkway, { lineW: 0.48, litW: 0.36 });
  bdFortTexturedTopSurface(g, axis, normal, 0, 0,
    crownHalfLength - 0.5, halfThickness - 3.7, elevation + 0.92,
    0.40, 0.18);

  // The outer defensive face carries the tall firing parapet. The settlement
  // face has only a low safety kerb, leaving the wall walk and its defenders
  // visible from behind. This asymmetry is physical geometry, never a mirrored
  // camera trick, so rotating the map always puts the crown on the correct side.
  for (const edge of [-1, 1]) {
    const across = edge * (halfThickness - 2.15);
    const isInterior = edge === interiorSide;
    const parapetHeight = isInterior ? 2.25 : 10.2;
    const parapetHalfThickness = isInterior ? 1.35 : 2.15;
    bdFortBlock(g, axis, normal, 0, across, crownHalfLength, 1.75,
      parapetHeight, elevation, dressed, {
        lineW: 0.58, litW: 0.44, topMaterial: capStone,
      });
    bdFortStoneFace(g, axis, normal, 0,
      across + edge * 1.78, crownHalfLength - 0.45,
      elevation, parapetHeight, 0x5a71 ^ (edge > 0 ? 0x2711 : 0x1187), false);
    bdFortTexturedStoneFace(g, axis, normal, 0,
      across + edge * 1.78, Math.max(0.8, crownHalfLength - 0.45),
      Math.max(0.8, crownHalfLength - 0.45), elevation, parapetHeight,
      seed ^ (edge > 0 ? 0x25a1 : 0x6c13));
    bdFortFacePatina(g, axis, normal, Math.max(0.8, crownHalfLength - 0.6),
      across + edge * 1.84, elevation, parapetHeight,
      seed ^ (edge > 0 ? 0x12d7 : 0x73b9));
    const capWidth = 9;
    for (let center = -crownHalfLength + capWidth * 0.5;
      center < crownHalfLength; center += capWidth) {
      const segmentHalfLength = Math.min(capWidth * 0.5,
        crownHalfLength - Math.abs(center));
      if (segmentHalfLength <= 0.35) continue;
      bdFortBlock(g, axis, normal, center, across, segmentHalfLength,
        parapetHalfThickness, 0.85, elevation + parapetHeight - 0.2, capStone, {
          lineW: 0.48, litW: 0.34, topMaterial: capStone,
        });
    }
    bdFortTexturedTopSurface(g, axis, normal, 0, across,
      crownHalfLength - 0.35, parapetHalfThickness - 0.12,
      elevation + parapetHeight + 0.68,
      edge > 0 ? 0.02 : 0.74, 0.22);
    for (let joint = -crownHalfLength + capWidth;
      joint < crownHalfLength; joint += capWidth) {
      const back = bdFortPoint(axis, normal, joint, across - parapetHalfThickness,
        elevation + parapetHeight + 0.78);
      const front = bdFortPoint(axis, normal, joint, across + parapetHalfThickness,
        elevation + parapetHeight + 0.78);
      g.strokeStyle = bdRgba('#292C29', 0.76);
      g.lineWidth = 0.52;
      g.beginPath(); g.moveTo(back.x, back.y); g.lineTo(front.x, front.y); g.stroke();
    }
  }

  // A projecting corbel table throws many small individual shadows below the
  // wall walk, translating the Town Center's deep cornice work into military
  // masonry without turning the crown into oversized cartoon battlements.
  if (built > 0.88) {
    const corbel = bdRamp('#61635D');
    const corbelSpacing = 12.5;
    for (let center = -crownHalfLength + corbelSpacing * 0.5;
      center < crownHalfLength; center += corbelSpacing) {
      const segmentHalfLength = Math.min(2.35,
        crownHalfLength - Math.abs(center));
      if (segmentHalfLength <= 0.35) continue;
      bdFortBlock(g, axis, normal, center, halfThickness - 0.7,
        segmentHalfLength, 2.0, 1.8, elevation - 2.1, corbel, {
          lineW: 0.42, litW: 0.38, endPlane: false,
          topMaterial: bdRamp('#898B82'),
        });
    }
  }

  if (built < 0.72 && crownHalfLength <= 20) {
    const pennant = bdFortPoint(axis, normal, -crownHalfLength, -halfThickness, elevation + 7);
    bdBanner(g, pennant.x, pennant.y + 2, 14, side,
      { w: 9, h: 6.5, dir: side === 0 ? 1 : -1 });
  }
}

export function getFortificationConstructionStage(progress) {
  const p = bdClamp(progress == null ? 0 : progress, 0, 1);
  return {
    length: bdClamp((p - 0.015) / 0.19, 0, 1),
    height: bdClamp((p - 0.10) / 0.72, 0, 1),
    scaffold: bdClamp((p - 0.07) / 0.30, 0, 1),
    crown: bdClamp((p - 0.82) / 0.18, 0, 1),
  };
}

function bdFortArrowSlit(g, axis, normal, along, across, elevation, height) {
  const top = bdFortPoint(axis, normal, along, across + 0.25, elevation + height * 0.5);
  const bottom = bdFortPoint(axis, normal, along, across + 0.25, elevation - height * 0.5);
  g.strokeStyle = bdShadow(0.88);
  g.lineWidth = 2.25;
  g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(bottom.x, bottom.y); g.stroke();
  g.strokeStyle = bdRgba('#EEE5CF', 0.42);
  g.lineWidth = 0.48;
  g.beginPath(); g.moveTo(top.x - 0.6, top.y); g.lineTo(bottom.x - 0.6, bottom.y); g.stroke();
  const sillLeft = bdFortPoint(axis, normal, along - 2.2, across + 0.34,
    elevation - height * 0.5 - 0.7);
  const sillRight = bdFortPoint(axis, normal, along + 2.2, across + 0.34,
    elevation - height * 0.5 - 0.7);
  g.strokeStyle = bdRgba('#3A3935', 0.66);
  g.lineWidth = 1.15;
  g.beginPath(); g.moveTo(sillLeft.x, sillLeft.y); g.lineTo(sillRight.x, sillRight.y); g.stroke();
  g.strokeStyle = bdRgba('#E9D7B9', 0.60);
  g.lineWidth = 0.55;
  g.beginPath(); g.moveTo(sillLeft.x, sillLeft.y - 0.9);
  g.lineTo(sillRight.x, sillRight.y - 0.9); g.stroke();
}

function bdFortGateLeaf(g, axis, normal, sideSign, front, seed) {
  const center = sideSign * 15.5;
  const half = 6.6;
  const bottom = 3.5, top = 27;
  const T = bdRamp(BMAT.DOOR), I = bdRamp(BMAT.IRON);
  const points = [
    bdFortPoint(axis, normal, center - half, front + 0.5, bottom),
    bdFortPoint(axis, normal, center + half, front + 0.5, bottom),
    bdFortPoint(axis, normal, center + half, front + 0.5, top),
    bdFortPoint(axis, normal, center - half, front + 0.5, top),
  ];
  bdPoly(g, bdFortFlat(points), T, { litW: 0.6, edge: true, lineW: 0.78 });
  for (let plank = -2; plank <= 2; plank++) {
    const s = center + plank * half * 0.38;
    const a = bdFortPoint(axis, normal, s, front + 0.62, bottom + 1);
    const b = bdFortPoint(axis, normal, s, front + 0.62, top - 1);
    g.strokeStyle = bdRgba(T.shade, 0.72); g.lineWidth = 0.56;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
  for (const elevation of [8, 21]) {
    const a = bdFortPoint(axis, normal, center - half + 0.8, front + 0.72, elevation);
    const b = bdFortPoint(axis, normal, center + half - 0.8, front + 0.72, elevation);
    bdBeam(g, I, a.x, a.y, b.x, b.y, 1.3, { cap: 'butt', edgeA: 0.7 });
  }
  const hinge = bdFortPoint(axis, normal, center + sideSign * half * 0.78, front + 0.8, 14);
  g.fillStyle = I.lit;
  g.beginPath(); g.arc(hinge.x, hinge.y, 1.25 + (seed & 1) * 0.1, 0, BD_TAU); g.fill();
}

function bdFortArch(g, axis, normal, front, seed) {
  const outerX = 22, innerX = 16.5, outerY = 15.5, innerY = 10.5;
  const spring = 22;
  const stone = bdRamp(BMAT.LIMESTONE);
  const segments = 11;
  for (let index = 0; index < segments; index++) {
    const a0 = index / segments * Math.PI;
    const a1 = (index + 1) / segments * Math.PI;
    const points = [
      bdFortPoint(axis, normal, Math.cos(a0) * outerX, front + 0.3, spring + Math.sin(a0) * outerY),
      bdFortPoint(axis, normal, Math.cos(a1) * outerX, front + 0.3, spring + Math.sin(a1) * outerY),
      bdFortPoint(axis, normal, Math.cos(a1) * innerX, front + 0.45, spring + Math.sin(a1) * innerY),
      bdFortPoint(axis, normal, Math.cos(a0) * innerX, front + 0.45, spring + Math.sin(a0) * innerY),
    ];
    bdPoly(g, bdFortFlat(points), index === (segments >> 1)
      ? bdRamp(BMAT.LIMESTONE) : stone, {
      litW: 0.42, edge: true, edgeW: 0.25, lineW: 0.58,
    });
  }
  const inner = [];
  for (let index = 0; index <= 20; index++) {
    const a = index / 20 * Math.PI;
    inner.push(bdFortPoint(axis, normal, Math.cos(a) * innerX, front + 0.7,
      spring + Math.sin(a) * innerY));
  }
  g.strokeStyle = bdShadow(0.78); g.lineWidth = 1.05;
  g.beginPath(); g.moveTo(inner[0].x, inner[0].y);
  for (let index = 1; index < inner.length; index++) g.lineTo(inner[index].x, inner[index].y);
  g.stroke();
}

function bdFortConstructionDressing(g, axis, normal, type, halfLength,
  halfThickness, builtHeight, progress, side, seed) {
  const stage = getFortificationConstructionStage(progress);
  const timber = bdRamp(BMAT.TIMBER), stone = bdRamp(BMAT.STONE_ROUGH);
  const front = halfThickness + 7;

  // Stone waits beside a surveyed trench before the scaffold is erected. A
  // queued wall therefore reads as a real masonry worksite instead of a fully
  // formed pale roof with a decorative ladder attached to it.
  const remaining = 1 - progress;
  const pieces = Math.max(2, Math.round(remaining * 15));
  for (let index = 0; index < pieces; index++) {
    const along = -Math.min(halfLength * 0.72, 18) + (index % 5) * 5.8;
    const across = halfThickness + 17 + Math.floor(index / 5) * 4.1;
    bdFortBlock(g, axis, normal, along, across, 2.6, 1.9,
      2.2 + (index % 3) * 0.55, Math.floor(index / 5) * 1.6,
      index % 4 === 0 ? bdRamp(BMAT.STONE) : stone,
      { lineW: 0.42, litW: 0.35 });
  }
  const mortarTub = bdFortPoint(axis, normal,
    Math.min(Math.max(halfLength * 0.36, 7), 19), halfThickness + 19, 0);
  bdEllipse(g, mortarTub.x, mortarTub.y, 4.8, 2.7, bdRamp('#77634A'),
    { litW: 0.45, edge: true });

  if (stage.scaffold <= 0.02) return;

  const scaffoldHalfLength = Math.max(type === 'gate' ? 40 : 7, halfLength - 2);
  const poles = type === 'gate'
    ? [-scaffoldHalfLength, -scaffoldHalfLength * 0.45,
      scaffoldHalfLength * 0.45, scaffoldHalfLength]
    : [-scaffoldHalfLength, 0, scaffoldHalfLength];
  const scaffoldTop = Math.max(8, builtHeight + 4 + stage.scaffold * 4);
  for (const along of poles) {
    const foot = bdFortPoint(axis, normal, along, front, -1);
    const top = bdFortPoint(axis, normal, along, front, scaffoldTop);
    bdBeam(g, timber, foot.x, foot.y, top.x, top.y, 1.8, { cap: 'butt' });
  }
  const levels = Math.max(1, Math.ceil(scaffoldTop / 15));
  for (let level = 1; level <= levels; level++) {
    const elevation = Math.min(scaffoldTop - 2, level * scaffoldTop / (levels + 0.25));
    const left = bdFortPoint(axis, normal, -scaffoldHalfLength - 3, front, elevation);
    const right = bdFortPoint(axis, normal, scaffoldHalfLength + 3, front, elevation);
    bdBeam(g, timber, left.x, left.y, right.x, right.y, 2.1, { cap: 'butt' });

    // Broad plank decks expose a lit upper plane, a dark outer edge and a
    // second receding edge. Those three planes retain depth at gameplay zoom.
    const farLeft = bdFortPoint(axis, normal, -scaffoldHalfLength - 2, front - 3.6, elevation + 0.7);
    const farRight = bdFortPoint(axis, normal, scaffoldHalfLength + 2, front - 3.6, elevation + 0.7);
    bdPoly(g, bdFortFlat([left, right, farRight, farLeft]), bdRamp(BMAT.SHINGLE), {
      litW: 0.48, edge: true, edgeW: 0.32, lineW: 0.52, shadeY: 0.62,
    });
    const grainA = bdFortPoint(axis, normal, -scaffoldHalfLength * 0.72, front - 1.6, elevation + 0.95);
    const grainB = bdFortPoint(axis, normal, scaffoldHalfLength * 0.76, front - 1.6, elevation + 0.95);
    g.strokeStyle = bdRgba(timber.lit, 0.36); g.lineWidth = 0.42;
    g.beginPath(); g.moveTo(grainA.x, grainA.y); g.lineTo(grainB.x, grainB.y); g.stroke();
  }
  for (let index = 0; index < poles.length - 1; index++) {
    const low = bdFortPoint(axis, normal, poles[index] + 2, front + 0.3, 2);
    const high = bdFortPoint(axis, normal, poles[index + 1] - 2, front + 0.3, scaffoldTop - 3);
    bdBeam(g, timber, low.x, low.y, high.x, high.y, 1.25, { cap: 'butt' });
  }

  // Stable rope lashings, ladder rungs and the shrinking dressed-stone stack.
  g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.74); g.lineWidth = 0.65;
  for (const along of poles) {
    for (let level = 1; level <= levels; level++) {
      const knot = bdFortPoint(axis, normal, along, front + 0.5,
        level * scaffoldTop / (levels + 0.25));
      g.beginPath(); g.ellipse(knot.x, knot.y, 2.0, 0.9, -0.3, 0, BD_TAU); g.stroke();
    }
  }
  if (stage.scaffold > 0.28) {
    const ladderA = bdFortPoint(axis, normal, -scaffoldHalfLength * 0.46, front + 1, 0);
    const ladderB = bdFortPoint(axis, normal, -scaffoldHalfLength * 0.24, front + 1, scaffoldTop - 1);
    const lx = ladderB.x - ladderA.x, ly = ladderB.y - ladderA.y;
    const ll = Math.hypot(lx, ly) || 1, nx = -ly / ll * 2.2, ny = lx / ll * 2.2;
    bdBeam(g, timber, ladderA.x + nx, ladderA.y + ny,
      ladderB.x + nx, ladderB.y + ny, 1.15, { cap: 'butt' });
    bdBeam(g, timber, ladderA.x - nx, ladderA.y - ny,
      ladderB.x - nx, ladderB.y - ny, 1.15, { cap: 'butt' });
    for (let rung = 1; rung < 7; rung++) {
      const t = rung / 7;
      const x = ladderA.x + lx * t, y = ladderA.y + ly * t;
      bdBeam(g, timber, x - nx, y - ny, x + nx, y + ny, 0.8, { cap: 'butt' });
    }
  }

  const flag = bdFortPoint(axis, normal, poles[0], front, scaffoldTop);
  bdBanner(g, flag.x, flag.y + 2, 16, side, { w: 10, h: 7, dir: side === 0 ? -1 : 1 });

  if (type === 'gate' && progress > 0.25 && progress < 0.92) {
    // Timber centering holds the arch ring while the voussoirs are laid.
    const spring = 21;
    const arch = [];
    for (let index = 0; index <= 14; index++) {
      const a = index / 14 * Math.PI;
      arch.push(bdFortPoint(axis, normal, Math.cos(a) * 15.2, front - 5,
        spring + Math.sin(a) * 10));
    }
    g.strokeStyle = timber.lit; g.lineWidth = 2.0;
    g.beginPath(); g.moveTo(arch[0].x, arch[0].y);
    for (let index = 1; index < arch.length; index++) g.lineTo(arch[index].x, arch[index].y);
    g.stroke();
    for (const along of [-14, 0, 14]) {
      const foot = bdFortPoint(axis, normal, along, front - 5, 0);
      const head = bdFortPoint(axis, normal, along, front - 5, along ? spring + 3 : spring + 10);
      bdBeam(g, timber, foot.x, foot.y, head.x, head.y, 1.5, { cap: 'butt' });
    }
    // Small masonry hoist with a visible rope and suspended stone bucket.
    const mastFoot = bdFortPoint(axis, normal, 32, front + 1, 0);
    const mastTop = bdFortPoint(axis, normal, 32, front + 1, scaffoldTop + 13);
    const boom = bdFortPoint(axis, normal, 14, front + 1, scaffoldTop + 13);
    bdBeam(g, timber, mastFoot.x, mastFoot.y, mastTop.x, mastTop.y, 2.1, { cap: 'butt' });
    bdBeam(g, timber, mastTop.x, mastTop.y, boom.x, boom.y, 2.0, { cap: 'butt' });
    const bucket = bdFortPoint(axis, normal, 14, front + 1, scaffoldTop * 0.58);
    g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.78); g.lineWidth = 0.72;
    g.beginPath(); g.moveTo(boom.x, boom.y); g.lineTo(bucket.x, bucket.y); g.stroke();
    bdRect(g, bucket.x - 3.5, bucket.y, 7, 5, bdRamp(BMAT.IRON), { litW: 0.4, edge: true, lineW: 0.5 });
  }
}

function bdPaintWallStairs(g, building, progress, construction) {
  const axis = fortificationAxis(building.orientation);
  const sideSign = building.stairSide === -1 ? -1 : 1;
  const normal = { x: -axis.y * sideSign, y: axis.x * sideSign };
  const p = bdClamp(progress == null ? 1 : progress, 0, 1);
  const built = construction ? bdClamp((p - 0.04) / 0.82, 0, 1) : 1;
  const halfWidth = BUILDING_TYPES.wall_stairs.w * 0.48;
  // The stair projects beyond its collision pad just enough to expose broad,
  // individually readable treads at gameplay scale. The landing still meets
  // the host wall while the lowest step remains inside the settlement face.
  const run = BUILDING_TYPES.wall_stairs.h * 1.18;
  const steps = 9;
  const tread = run / steps;
  const rise = WALL_WALK_ELEVATION / steps;
  const stone = bdRamp('#5B5E58');
  const rough = bdRamp('#424541');
  const limestone = bdRamp('#7A7C73');
  const timber = bdRamp(BMAT.TIMBER);
  const rr = bdRnd((building.id * 2654435761) | 0);

  const footprint = [
    bdFortPoint(axis, normal, -halfWidth - 5, -run * 0.5 - 3, 0),
    bdFortPoint(axis, normal, halfWidth + 5, -run * 0.5 - 3, 0),
    bdFortPoint(axis, normal, halfWidth + 5, run * 0.5 + 4, 0),
    bdFortPoint(axis, normal, -halfWidth - 5, run * 0.5 + 4, 0),
  ];
  g.save();
  g.globalCompositeOperation = 'destination-over';
  bdCastShadow(g, function (c) {
    c.moveTo(footprint[0].x, footprint[0].y);
    for (let i = 1; i < footprint.length; i++) c.lineTo(footprint[i].x, footprint[i].y);
    c.closePath();
  }, WALL_WALK_ELEVATION);
  bdContactShadow(g, normal.x * 5, normal.y * 5, run * 0.66, WALL_WALK_ELEVATION, 0.86);
  g.restore();

  bdCobblePatch(g, 0, 5 * normal.y, halfWidth * 1.45, run * 0.42,
    building.id ^ 0x4c21, construction);

  // A broad dressed landing receives troops before they step onto the firing
  // walk. It appears late, after the stair barrel can carry its weight.
  if (!construction || p > 0.72) {
    const landingProgress = construction ? bdClamp((p - 0.72) / 0.18, 0, 1) : 1;
    bdFortBlock(g, axis, normal, 0, -run * 0.51, halfWidth + 2.2, tread * 0.82,
      Math.max(1, 4.2 * landingProgress), WALL_WALK_ELEVATION - 3.2, limestone,
      { lineW: 0.72, litW: 0.62 });
  }

  const completedSteps = built * steps;
  for (let index = 0; index < steps; index++) {
    const completion = bdClamp(completedSteps - index, 0, 1);
    if (completion <= 0) break;
    const across = run * 0.5 - (index + 0.5) * tread;
    const height = rise * (index + completion);
    const material = index % 4 === 0 ? limestone : index % 3 === 0 ? rough : stone;
    bdFortBlock(g, axis, normal, 0, across, halfWidth, tread * 0.54,
      Math.max(0.8, height), 0, material, { lineW: 0.7, litW: 0.56 });
    bdFortTexturedTopSurface(g, axis, normal, 0, across,
      halfWidth - 0.7, tread * 0.48, height + 0.24,
      (index % 4) * 0.18, 0.18);
    bdFortStoneFace(g, axis, normal, 0, across + tread * 0.55,
      halfWidth - 0.7, 0, Math.max(0.8, height),
      (building.id * 193 + index * 977) | 0, false);

    // Worn tread centres, sharp nosing and irregular mortar make every course
    // read as a physical step instead of a striped ramp.
    const left = bdFortPoint(axis, normal, -halfWidth + 1.2, across + tread * 0.52, height + 0.12);
    const right = bdFortPoint(axis, normal, halfWidth - 1.2, across + tread * 0.52, height + 0.12);
    g.strokeStyle = bdRgba(index & 1 ? stone.line : rough.line, 0.70);
    g.lineWidth = 0.92;
    g.beginPath(); g.moveTo(left.x, left.y); g.lineTo(right.x, right.y); g.stroke();
    const wearLeft = bdFortPoint(axis, normal, -halfWidth * 0.38, across, height + 0.22);
    const wearRight = bdFortPoint(axis, normal, halfWidth * 0.34, across, height + 0.22);
    g.strokeStyle = bdRgba('#B8BAB0', 0.20 + (index % 3) * 0.04);
    g.lineWidth = 1.05;
    g.beginPath(); g.moveTo(wearLeft.x, wearLeft.y); g.lineTo(wearRight.x, wearRight.y); g.stroke();

    // Three dressed tread slabs with staggered joints. The seams follow the
    // actual sloping top plane rather than being stamped horizontal stripes.
    for (const jointAlong of [-halfWidth * 0.34, halfWidth * 0.31]) {
      const jointBack = bdFortPoint(axis, normal, jointAlong,
        across - tread * 0.43, height + 0.26);
      const jointFront = bdFortPoint(axis, normal, jointAlong + (index & 1 ? 0.55 : -0.35),
        across + tread * 0.43, height + 0.26);
      g.strokeStyle = bdRgba('#5E594D', 0.54);
      g.lineWidth = 0.48;
      g.beginPath(); g.moveTo(jointBack.x, jointBack.y); g.lineTo(jointFront.x, jointFront.y); g.stroke();
      g.strokeStyle = bdRgba('#F1E5C7', 0.26);
      g.lineWidth = 0.34;
      g.beginPath(); g.moveTo(jointBack.x - 0.45, jointBack.y - 0.2);
      g.lineTo(jointFront.x - 0.45, jointFront.y - 0.2); g.stroke();
    }

    // Stepped cheek walls expose rough masonry sides and dressed coping stones.
    for (const edge of [-1, 1]) {
      bdFortBlock(g, axis, normal, edge * (halfWidth + 1.45), across,
        1.65, tread * 0.56, Math.max(1.2, height + 3.3), 0, rough,
        { lineW: 0.54, litW: 0.42 });
      const cheekFront = bdFortPoint(axis, normal, edge * (halfWidth + 1.48),
        across + tread * 0.56, Math.max(1.2, height + 2.8));
      const cheekFoot = bdFortPoint(axis, normal, edge * (halfWidth + 1.48),
        across + tread * 0.56, 0.5);
      g.strokeStyle = bdRgba(index & 1 ? '#6F6857' : '#E0D3B3', 0.48);
      g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(cheekFoot.x, cheekFoot.y); g.lineTo(cheekFront.x, cheekFront.y); g.stroke();
      if (completion > 0.72) {
        bdFortBlock(g, axis, normal, edge * (halfWidth + 1.45), across,
          1.9, tread * 0.58, 1.15, height + 3.15, limestone,
          { lineW: 0.44, litW: 0.4 });
      }
    }
  }

  // Lime staining, chipped arrises and a few moss-dark joints keep the stone
  // in the same weathered material family as the main wall.
  if (built > 0.45) {
    g.save();
    g.globalAlpha = 0.62;
    for (let index = 0; index < Math.floor(7 * built); index++) {
      const across = run * 0.42 - index * run * 0.11;
      const elevation = Math.min(WALL_WALK_ELEVATION - 3, (index + 1) * rise * 1.15);
      const point = bdFortPoint(axis, normal,
        (index % 2 ? -1 : 1) * (halfWidth + 1.8), across, elevation * 0.54);
      g.fillStyle = index % 3 ? bdRgba('#73785A', 0.48) : bdRgba('#E8DFC8', 0.38);
      g.beginPath(); g.ellipse(point.x, point.y, 1.6 + (index % 2), 0.7, -0.3, 0, BD_TAU); g.fill();
    }
    g.restore();
  }

  if (!construction) return { axis, normal, halfWidth, run };

  // Construction is an active masonry site: braced scaffold, lashed rails,
  // survey cord, a block hoist, wet mortar tub and a shrinking stone stock.
  const scaffoldHeight = Math.max(8, WALL_WALK_ELEVATION * built + 7);
  for (const edge of [-1, 1]) {
    for (const across of [-run * 0.38, run * 0.38]) {
      const foot = bdFortPoint(axis, normal, edge * (halfWidth + 7), across, -1);
      const top = bdFortPoint(axis, normal, edge * (halfWidth + 7), across, scaffoldHeight);
      bdBeam(g, timber, foot.x, foot.y, top.x, top.y, 1.65, { cap: 'butt' });
    }
    const low = bdFortPoint(axis, normal, edge * (halfWidth + 7), run * 0.38, 3);
    const high = bdFortPoint(axis, normal, edge * (halfWidth + 7), -run * 0.38, scaffoldHeight - 2);
    bdBeam(g, timber, low.x, low.y, high.x, high.y, 1.12, { cap: 'butt' });
  }
  for (const level of [scaffoldHeight * 0.42, scaffoldHeight * 0.82]) {
    const left = bdFortPoint(axis, normal, -halfWidth - 8, 0, level);
    const right = bdFortPoint(axis, normal, halfWidth + 8, 0, level);
    bdBeam(g, timber, left.x, left.y, right.x, right.y, 1.9, { cap: 'butt' });
  }
  g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.74);
  g.lineWidth = 0.62;
  g.setLineDash([3, 2]);
  const cordA = bdFortPoint(axis, normal, -halfWidth - 2, run * 0.48, 2);
  const cordB = bdFortPoint(axis, normal, halfWidth + 2, -run * 0.48, WALL_WALK_ELEVATION + 1);
  g.beginPath(); g.moveTo(cordA.x, cordA.y); g.lineTo(cordB.x, cordB.y); g.stroke();
  g.setLineDash([]);

  const mastFoot = bdFortPoint(axis, normal, halfWidth + 8, -run * 0.25, 0);
  const mastTop = bdFortPoint(axis, normal, halfWidth + 8, -run * 0.25, scaffoldHeight + 9);
  const boom = bdFortPoint(axis, normal, 2, -run * 0.25, scaffoldHeight + 9);
  bdBeam(g, timber, mastFoot.x, mastFoot.y, mastTop.x, mastTop.y, 1.9, { cap: 'butt' });
  bdBeam(g, timber, mastTop.x, mastTop.y, boom.x, boom.y, 1.7, { cap: 'butt' });
  const load = bdFortPoint(axis, normal, 2, -run * 0.25, scaffoldHeight * 0.56);
  g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.78); g.lineWidth = 0.65;
  g.beginPath(); g.moveTo(boom.x, boom.y); g.lineTo(load.x, load.y); g.stroke();
  bdRect(g, load.x - 3.1, load.y - 1.4, 6.2, 4.8, rough,
    { litW: 0.42, edge: true, lineW: 0.5 });

  const remaining = Math.max(2, Math.round((1 - p) * 13));
  for (let index = 0; index < remaining; index++) {
    bdFortBlock(g, axis, normal, -halfWidth + (index % 4) * 6.2,
      run * 0.72 + Math.floor(index / 4) * 4.2, 2.5, 1.8,
      2 + index % 3 * 0.55, Math.floor(index / 4) * 1.2,
      index % 4 ? rough : limestone, { lineW: 0.4, litW: 0.34 });
  }
  const tub = bdFortPoint(axis, normal, halfWidth + 10, run * 0.55, 0);
  bdEllipse(g, tub.x, tub.y, 5.2, 3.0, bdRamp('#7E6848'), { litW: 0.55, edge: true });
  bdBanner(g, mastTop.x, mastTop.y + 2, 14, building.side,
    { w: 9, h: 6, dir: building.side === 0 ? -1 : 1 });
  return { axis, normal, halfWidth, run };
}

function bdPaintFortification(
  g, type, side, orientation, progress, seed, construction, joinedEnds = [false, false],
  interiorSide = 1, gateOpenProgress = 1,
) {
  const axis = fortificationAxis(orientation);
  const normal = { x: -axis.y, y: axis.x };
  const isGate = type === 'gate';
  const nominalHalfLength = BUILDING_TYPES[type].w * 0.5;
  const connectedWall = !isGate && joinedEnds.some(Boolean);
  const detail = getFortificationMasonryDetailProfile(type, joinedEnds);
  // Adjacent sections overlap by a few pixels. Their thick top walks then
  // mitre cleanly through a bend instead of exposing a triangular grass gap.
  const halfLength = nominalHalfLength + (connectedWall ? 3 : 0);
  const halfThickness = BUILDING_TYPES[type].h * 0.5;
  const p = bdClamp(progress == null ? 1 : progress, 0, 1);
  const stone = bdRamp('#595C56');
  const rough = bdRamp('#383B37');
  const unfinishedCrown = bdRamp('#30332F');

  // A fitted cobble lane and shallow trench visually weld adjacent stamps into
  // one defensive work while remaining beneath the modelled masonry.
  bdCobblePatch(g, 0, normal.y * 3, halfLength * 1.08,
    isGate ? halfThickness * 0.92 : halfThickness * 0.70, seed ^ 0x7712, construction);
  bdContactShadow(g, 0, normal.y * halfThickness + 3,
    halfLength * 0.83, isGate ? 54 : 36, 0.92);

  if (!isGate) {
    const stage = construction
      ? getFortificationConstructionStage(p)
      : { length: 1, height: 1, scaffold: 1, crown: 1 };
    const masonryHalfLength = halfLength * stage.length;
    const builtHeight = masonryHalfLength > 0.5 ? 2.2 + 29.8 * stage.height : 0;
    const seamlessEnd = { endPlane: !joinedEnds[1] };
    if (masonryHalfLength > 0.5) {
      bdFortBlock(g, axis, normal, 0, 0, masonryHalfLength, halfThickness,
        Math.min(5.5, builtHeight), 0, rough, {
          ...seamlessEnd,
          topMaterial: construction && stage.crown < 0.96 ? unfinishedCrown : undefined,
        });
      if (builtHeight > 4) {
        bdFortBlock(g, axis, normal, 0, -0.6,
          Math.max(0.8, masonryHalfLength - 1.2), halfThickness - 1.4,
          builtHeight - 4, 4, stone, {
            ...seamlessEnd,
            topMaterial: construction && stage.crown < 0.96 ? unfinishedCrown : undefined,
          });
      }
      bdFortStoneFace(g, axis, normal, 0, halfThickness - 1.8,
        Math.max(0.8, masonryHalfLength - 1.0), 0, builtHeight,
        seed ^ 0x35a9, false);
      bdFortTexturedStoneFace(g, axis, normal, 0, halfThickness - 1.65,
        Math.max(0.8, masonryHalfLength - 1.0), halfLength - 1.0,
        0, builtHeight, seed ^ 0x2947);
      bdFortFacePatina(g, axis, normal,
        Math.max(0.8, masonryHalfLength - 1.0), halfThickness - 1.52,
        0, builtHeight, seed ^ 0x19f3);
      if (detail.hasBatteredPlinth) {
        bdFortBatteredPlinth(g, axis, normal,
          Math.max(0.8, masonryHalfLength - 1.0), halfThickness, builtHeight,
          seed ^ 0x684f);
      }
      bdFortMasonryRelief(g, axis, normal,
        Math.max(0.8, masonryHalfLength - 1.0), halfThickness, builtHeight,
        seed ^ 0x13579, detail);
      if (detail.exposedEnds[0]) {
        bdFortDressedEndCap(g, axis, normal, -masonryHalfLength,
          halfThickness, builtHeight, seed ^ 0x5129);
      }
      if (detail.exposedEnds[1]) {
        bdFortDressedEndCap(g, axis, normal, masonryHalfLength,
          halfThickness, builtHeight, seed ^ 0x9ad3);
      }

      // Deeply modelled string courses divide the battered base, ashlar face
      // and firing walk. Their separate top/front planes survive zoom-out and
      // give the wall the same architectural hierarchy as the Town Center.
      if (builtHeight > 11) {
        const dressedBand = bdRamp('#777A72');
        for (const elevation of [5.2, Math.max(8, builtHeight - 5.8)]) {
          bdFortBlock(g, axis, normal, 0, halfThickness - 1.0,
            Math.max(0.8, masonryHalfLength - 0.4), 1.15,
            1.25, elevation, dressedBand, {
              lineW: 0.38, litW: 0.46, endPlane: false,
              topMaterial: bdRamp('#96988E'),
            });
        }
      }

      // The unfinished crown exposes a dark rubble core and irregular loose
      // stones instead of one unbroken cream top plane.
      if (construction && stage.crown < 0.96) {
        const coreHalfLength = Math.max(0.5, masonryHalfLength - 1.8);
        bdFortBlock(g, axis, normal, 0, -0.2, coreHalfLength,
          halfThickness * 0.82, 0.9, Math.max(0, builtHeight - 0.35), rough,
          {
            lineW: 0.42, litW: 0.32, endPlane: false,
            topMaterial: bdRamp('#3F403B'),
          });
        bdFortTexturedStoneTop(g, axis, normal, coreHalfLength,
          halfThickness * 0.78, builtHeight + 0.58, seed ^ 0x2b41);

        const looseStone = bdRamp('#716D65');
        const rubbleRnd = bdRnd(seed ^ 0x71a3);
        const looseCount = 3 + Math.floor(stage.height * 3);
        for (let index = 0; index < looseCount; index++) {
          bdFortBlock(g, axis, normal,
            rubbleRnd(coreHalfLength * 0.38, coreHalfLength * 0.88),
            rubbleRnd(-halfThickness * 0.38, halfThickness * 0.38),
            rubbleRnd(1.25, 2.1), rubbleRnd(0.75, 1.15), rubbleRnd(0.65, 1.1),
            builtHeight + 0.55 + rubbleRnd(-0.08, 0.12), looseStone, {
              lineW: 0.28, litW: 0.22, topMaterial: looseStone,
            });
        }
      }
    }
    const supports = masonryHalfLength <= 7 ? [] : construction && stage.length < 0.98
      ? [-masonryHalfLength + 4, 0, masonryHalfLength - 4]
      : connectedWall
        ? [
          ...(!joinedEnds[0] ? [-nominalHalfLength + 5] : []),
          ...(!joinedEnds[1] ? [nominalHalfLength - 5] : []),
        ]
        : [-halfLength + 7, -halfLength * 0.28, halfLength * 0.28, halfLength - 7];
    for (const along of supports) {
      bdFortBlock(g, axis, normal, along, 2.1, 3.4, halfThickness + 2.5,
        Math.max(4, builtHeight - 1.5), 0, rough, { lineW: 0.68, litW: 0.5 });
      if (builtHeight > 8) {
        bdFortTexturedStoneFace(g, axis, normal, along, halfThickness + 4.45,
          2.8, 2.8, 0, builtHeight - 1.8, seed ^ Math.round(along * 193));
        bdFortBlock(g, axis, normal, along, 2.1, 3.75, halfThickness + 2.75,
          1.15, builtHeight - 1.4, bdRamp('#73766E'), {
            lineW: 0.42, litW: 0.42, topMaterial: bdRamp('#95978D'),
          });
      }
    }
    bdFortWallCrown(g, axis, normal, masonryHalfLength, halfThickness,
      builtHeight, stage.crown, side, seed, interiorSide);
    if (builtHeight > 16) {
      for (const along of [-26, 0, 26]) {
        if (Math.abs(along) < masonryHalfLength - 3) {
          bdFortArrowSlit(g, axis, normal, along,
            halfThickness + 0.4, Math.min(builtHeight - 6, 18), 5.5);
        }
      }
    }
    if (construction) {
      bdFortConstructionDressing(g, axis, normal, type, masonryHalfLength, halfThickness,
        builtHeight, p, side, seed);
    }
    return { axis, normal, height: builtHeight, halfLength, halfThickness };
  }

  const rise = construction ? bdClamp((p - 0.04) / 0.78, 0, 1) : 1;
  const towerHeight = 5 + 47 * rise;
  for (const along of [-37, 37]) {
    bdFortBlock(g, axis, normal, along, 0, 15, halfThickness, Math.min(6, towerHeight), 0, rough);
    if (towerHeight > 5) {
      bdFortBlock(g, axis, normal, along, -0.4, 13.8, halfThickness - 1.4,
        towerHeight - 4.5, 4.5, stone);
      bdFortStoneFace(g, axis, normal, along, halfThickness - 1.5, 13.8,
        4.5, towerHeight - 4.5, seed ^ (along < 0 ? 0x9421 : 0x4291), true);
      bdFortTexturedStoneFace(g, axis, normal, along, halfThickness - 1.35,
        13.4, 13.4, 4.5, towerHeight - 4.5,
        seed ^ (along < 0 ? 0x18d3 : 0x6a91));
      bdFortMasonryRelief(g, axis, normal, 13.0, halfThickness,
        towerHeight - 4.5, seed ^ (along < 0 ? 0x64af : 0x48d2), detail);
      bdFortFacePatina(g, axis, normal, 13.0, halfThickness - 1.2,
        4.5, towerHeight - 4.5, seed ^ (along < 0 ? 0x77c1 : 0x1ad5));
    }
    bdFortBlock(g, axis, normal, along, 2.8, 3.8, halfThickness + 3,
      Math.max(4, towerHeight - 2), 0, rough, { lineW: 0.65, litW: 0.5 });
    if (towerHeight > 27) bdFortArrowSlit(g, axis, normal, along,
      halfThickness + 0.5, Math.min(towerHeight - 9, 30), 8);
  }

  const archReady = construction ? bdClamp((p - 0.55) / 0.30, 0, 1) : 1;
  if (archReady > 0) {
    const bridgeHeight = 15 * archReady;
    bdFortBlock(g, axis, normal, 0, -0.5, 21, halfThickness - 1,
      bridgeHeight, 37, stone, { lineW: 0.72, litW: 0.58 });
    bdFortStoneFace(g, axis, normal, 0, halfThickness - 1.4, 21,
      37, bridgeHeight, seed ^ 0x2017, true);
    bdFortTexturedStoneFace(g, axis, normal, 0, halfThickness - 1.25,
      20.5, 20.5, 37, bridgeHeight, seed ^ 0x4b17);
    bdFortMasonryRelief(g, axis, normal, 20.4, halfThickness,
      bridgeHeight, seed ^ 0x3105, detail);
    bdFortArch(g, axis, normal, halfThickness + 0.2, seed);

    // A restrained classical pediment and projecting cornice distinguish the
    // gatehouse from an enlarged wall opening without turning it into fantasy
    // castle architecture.
    const gateFront = halfThickness + 0.72;
    const pediment = [
      bdFortPoint(axis, normal, -24, gateFront, 50),
      bdFortPoint(axis, normal, 0, gateFront, 63),
      bdFortPoint(axis, normal, 24, gateFront, 50),
    ];
    bdPoly(g, bdFortFlat(pediment), bdRamp('#70736C'), {
      litW: 0.48, edge: true, edgeW: 0.36, lineW: 0.72,
    });
    bdFortBlock(g, axis, normal, 0, halfThickness - 0.2,
      26, 2.2, 2.2, 48.4, bdRamp('#85877F'), {
        lineW: 0.52, litW: 0.46, topMaterial: bdRamp('#A0A198'),
      });
  }
  if (!construction || p > 0.90) {
    bdFortWallCrown(g, axis, normal, halfLength - 2, halfThickness,
      towerHeight, 1, side, seed ^ 0x7a51, interiorSide);
  }
  if (!construction || p > 0.86) {
    bdFortGateLeaf(g, axis, normal, -1, halfThickness + 0.4, seed);
    bdFortGateLeaf(g, axis, normal, 1, halfThickness + 0.4, seed + 1);
    // The heavy portcullis travels vertically into the gatehouse. Its lower
    // teeth remain readable at both limits and during the drop.
    const iron = bdRamp(BMAT.IRON);
    const lift = bdClamp(gateOpenProgress, 0, 1);
    const bottomElevation = 3.5 + lift * 25.5;
    const topElevation = bottomElevation + 25;
    for (let along = -13; along <= 13; along += 4.3) {
      const top = bdFortPoint(axis, normal, along, halfThickness + 1.1, topElevation);
      const bottom = bdFortPoint(axis, normal, along, halfThickness + 1.1,
        bottomElevation - Math.abs(along) * 0.08);
      bdBeam(g, iron, top.x, top.y, bottom.x, bottom.y, 0.9, { cap: 'butt', edgeA: 0.65 });
    }
    for (let elevation = bottomElevation + 5; elevation < topElevation - 2; elevation += 6.2) {
      const left = bdFortPoint(axis, normal, -14, halfThickness + 1.2, elevation);
      const right = bdFortPoint(axis, normal, 14, halfThickness + 1.2, elevation);
      bdBeam(g, iron, left.x, left.y, right.x, right.y, 0.72, {
        cap: 'butt', edgeA: 0.58,
      });
    }
  }
  if (construction) {
    bdFortConstructionDressing(g, axis, normal, type, halfLength, halfThickness,
      towerHeight, p, side, seed);
  }
  return { axis, normal, height: towerHeight + 8, halfLength, halfThickness };
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
  town_center: 112, house: 118, english_cottage: 108, english_townhouse: 116,
  english_mansion: 148, spooky_house: 146, farm: 30, mill: 104, lumber_camp: 54,
  mine: 74, barracks: 78, stable: 72, foundry: 108, tower: 106,
  marketplace: 162, castle: 162,
  wall: 72, gate: 94, wall_stairs: 92,
};

function bdBoxFor(type, def) {
  const topExtra = BD_TOP_EXTRA[type] == null ? 60 : BD_TOP_EXTRA[type];
  const presentation = getBuildingPresentation(type, def);
  // The side and bottom margins are sized off def.w rather than being a flat 26
  // because the trodden apron and its soft ground bed scale with the footprint:
  // at a flat margin the bed's outer falloff ran past the stamp edge on the four
  // largest types and the blit cut a dead-straight line through a soft shadow.
  // The current paving reach comes directly from the shared presentation
  // profile so a wider yard can never outgrow the cached procedural stamp.
  const sideExtra = Math.max(
    28,
    presentation.apronRx * 1.18 - def.w * 0.5 + 4,
    type === 'mill' ? def.w * 0.34 : 0,
  );
  const botExtra = Math.max(42, presentation.apronRy * 1.20 + def.h * 0.08);
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
const bdFarmForegroundCache = new Map();
const bdResourceCache = new Map();

/** Called from startBattle(). Frees every baked surface between battles. */
function bdResetCaches() {
  bdBuildingCache.clear();
  bdFarmCache.clear();
  bdFarmForegroundCache.clear();
  bdResourceCache.clear();
  bdFoliagePal = null;
}

const BD_VARIANTS = {
  town_center: 1, tower: 2, castle: 2, farm: 1, house: 1,
  english_cottage: 1, english_townhouse: 1, english_mansion: 1, spooky_house: 1,
  mill: 2, lumber_camp: 2, mine: 2, barracks: 2, stable: 2, foundry: 2,
  marketplace: 1, school: 1, pool: 1, beach: 1, park: 5, playground: 1,
  wall: 3, gate: 3, wall_stairs: 3,
};

const BD_PAINTERS = {
  town_center: bdPaintTownCenter, house: bdPaintHouse, english_cottage: bdPaintHouse,
  english_townhouse: bdPaintHouse, english_mansion: bdPaintHouse,
  spooky_house: bdPaintHouse, mill: bdPaintMill,
  lumber_camp: bdPaintLumberCamp, mine: bdPaintMine, barracks: bdPaintBarracks,
  marketplace: bdPaintTownCenter, stable: bdPaintStable, foundry: bdPaintFoundry, tower: bdPaintTower,
  castle: bdPaintCastle, school: bdPaintBarracks, pool: bdPaintMill,
  beach: bdPaintLumberCamp, park: bdPaintHouse, playground: bdPaintHouse,
};

const BD_ENGLISH_BUILDING_ART = Object.freeze({
  town_center: { key: 'englishTownCenter' },
  house: { key: 'englishHouse' },
  english_cottage: { key: 'englishCottage' },
  english_townhouse: { key: 'englishTownhouse' },
  english_mansion: { key: 'englishMansion' },
  spooky_house: { key: 'englishSpookyHouse' },
  mill: { key: 'englishMill' },
  lumber_camp: { key: 'englishLumberCamp' },
  mine: { key: 'englishMine' },
  marketplace: { key: 'englishMarketplace' },
  barracks: { key: 'englishBarracks' },
  stable: { key: 'englishStable' },
  foundry: { key: 'englishFoundry' },
  tower: { key: 'englishTower' },
  castle: { key: 'englishCastle' },
});

const BD_OTTOMAN_BUILDING_ART = Object.freeze({
  town_center: { key: 'ottomanTownCenter' },
  house: { key: 'ottomanHouse' },
  mill: { key: 'ottomanMill' },
  lumber_camp: { key: 'ottomanLumberCamp' },
  mine: { key: 'ottomanMine' },
  barracks: { key: 'ottomanBarracks' },
  stable: { key: 'ottomanStable' },
  foundry: { key: 'ottomanFoundry' },
  tower: { key: 'ottomanTower' },
  castle: { key: 'ottomanCastle' },
});

const BD_HOGWARTS_BUILDING_ART = Object.freeze({
  town_center: { key: 'hogwartsTownCenter' },
  house: { key: 'hogwartsHouse' }, mill: { key: 'hogwartsMill' },
  lumber_camp: { key: 'hogwartsLumberCamp' }, mine: { key: 'hogwartsMine' },
  barracks: { key: 'hogwartsBarracks' }, stable: { key: 'hogwartsStable' },
  foundry: { key: 'hogwartsFoundry' }, tower: { key: 'hogwartsTower' },
  castle: { key: 'hogwartsCastle' }, school: { key: 'hogwartsGreatHall' },
  pool: { key: 'hogwartsPool' }, beach: { key: 'hogwartsBeach' },
});

const BD_STARWARS_BUILDING_ART = Object.freeze({
  // These assets share a 720x560 authoring canvas, but their painted
  // silhouettes occupy very different fractions of it. The tower, for
  // example, is only 262 pixels wide while the mine is 659 pixels wide.
  // Rendering the full transparent canvas made the tower less than half a
  // house high. Source rectangles keep each silhouette on the role-based
  // world scale while retaining a soft fringe around shadows and antennas.
  town_center: { key: 'starwarsTownCenter' },
  house: { key: 'starwarsHouse' },
  mill: { key: 'starwarsMill' },
  lumber_camp: { key: 'starwarsLumberCamp' },
  mine: { key: 'starwarsMine' },
  barracks: { key: 'starwarsBarracks' },
  stable: { key: 'starwarsStable' },
  foundry: { key: 'starwarsFoundry' },
  tower: { key: 'starwarsTower' },
  castle: { key: 'starwarsCastle' },
});

const BD_BUILDING_SOURCE_RECT_BY_NATION = Object.freeze({
  hogwarts: Object.freeze({
    // The castle source is intentionally high-detail but carries a large empty
    // transparent sky above the masonry. Trim only transparent canvas so the
    // renderer scales and anchors the actual building instead of pushing it
    // down into the lower HUD.
    castle: [28, 482, 712, 514],
  }),
  starwars: Object.freeze({
    town_center: [48, 52, 624, 500],
    house: [112, 96, 496, 432],
    mill: [80, 52, 560, 488],
    lumber_camp: [26, 52, 668, 490],
    mine: [22, 26, 674, 512],
    barracks: [48, 58, 622, 483],
    stable: [22, 68, 674, 437],
    foundry: [42, 28, 632, 514],
    tower: [220, 48, 280, 512],
    castle: [28, 28, 664, 528],
  }),
});

const BD_CIRCUS_BUILDING_ART = Object.freeze({
  town_center: { key: 'circusTownCenter' }, house: { key: 'circusHouse' },
  mill: { key: 'circusHouse' }, lumber_camp: { key: 'circusHouse' },
  mine: { key: 'circusFoundry' }, barracks: { key: 'circusBarracks' },
  stable: { key: 'circusBarracks' }, foundry: { key: 'circusFoundry' },
  tower: { key: 'circusFoundry' }, castle: { key: 'circusCastle' },
});

const BD_WORLD_PARK_ART = Object.freeze([
  { key: 'parkEnglish' }, { key: 'parkEastAsian' }, { key: 'parkTropical' },
  { key: 'parkOasis' }, { key: 'parkAlpine' },
]);

const BD_BUILDING_ART_BY_NATION = Object.freeze({
  england: BD_ENGLISH_BUILDING_ART,
  ottoman: BD_OTTOMAN_BUILDING_ART,
  hogwarts: BD_HOGWARTS_BUILDING_ART,
  starwars: BD_STARWARS_BUILDING_ART,
  nightmare_circus: BD_CIRCUS_BUILDING_ART,
});

export function getBuildingProductionArtSpec(nation, type, variant = 0) {
  if (type === 'park') return BD_WORLD_PARK_ART[variant % BD_WORLD_PARK_ART.length];
  if (type === 'playground') return { key: 'worldPlayground' };
  if (type === 'school' || type === 'pool' || type === 'beach') {
    return BD_HOGWARTS_BUILDING_ART[type];
  }
  return BD_BUILDING_ART_BY_NATION[nation]?.[type] || null;
}

const BD_ARCHITECTURE_SUPPORT_ART_BY_NATION = Object.freeze({
  england: Object.freeze({
    construction: 'englishConstruction',
    fortifications: 'englishFortifications',
    fortificationConstruction: 'englishFortificationConstruction',
    gateClosed: 'englishGateClosed',
  }),
  ottoman: Object.freeze({
    construction: 'ottomanConstruction',
    fortifications: 'ottomanFortifications',
    fortificationConstruction: 'ottomanFortificationConstruction',
    gateClosed: 'ottomanGateClosed',
  }),
  hogwarts: Object.freeze({
    construction: 'englishConstruction', fortifications: 'englishFortifications',
    fortificationConstruction: 'englishFortificationConstruction', gateClosed: 'englishGateClosed',
  }),
  starwars: Object.freeze({
    construction: 'englishConstruction', fortifications: 'englishFortifications',
    fortificationConstruction: 'englishFortificationConstruction', gateClosed: 'englishGateClosed',
  }),
  nightmare_circus: Object.freeze({
    construction: 'ottomanConstruction', fortifications: 'ottomanFortifications',
    fortificationConstruction: 'ottomanFortificationConstruction', gateClosed: 'ottomanGateClosed',
  }),
});

export function getArchitectureProductionArtSpec(nation) {
  return BD_ARCHITECTURE_SUPPORT_ART_BY_NATION[nation] || null;
}

// Production sprites previously used unrelated hard-coded heights. Since the
// sources have very different aspect ratios, that made the narrow mill and
// tower nearly as wide as the stable. These profiles derive visible width and
// paving from the gameplay footprint, preserving the intended hierarchy for
// every building type while still allowing roof overhang and vertical mass.
// The tallest ordinary infantry frame is the shared yardstick: architecture
// must read as usable space around people, regardless of the source-art canvas.
export const BUILDING_HUMAN_REFERENCE_HEIGHT = 50;

const BD_BUILDING_PRESENTATION = Object.freeze({
  town_center: { artWidthScale: 1.48, apronWidthScale: 0.98, apronDepthScale: 0.62 },
  house: { artWidthScale: 1.36, apronWidthScale: 1.12, apronDepthScale: 0.66 },
  english_cottage: { artWidthScale: 1.42, apronWidthScale: 1.12, apronDepthScale: 0.66 },
  english_townhouse: { artWidthScale: 1.46, apronWidthScale: 1.10, apronDepthScale: 0.66 },
  english_mansion: { artWidthScale: 1.58, apronWidthScale: 1.02, apronDepthScale: 0.64 },
  spooky_house: { artWidthScale: 1.54, apronWidthScale: 1.06, apronDepthScale: 0.66 },
  mill: { artWidthScale: 1.42, apronWidthScale: 0.86, apronDepthScale: 0.58 },
  lumber_camp: { artWidthScale: 1.44, apronWidthScale: 0.86, apronDepthScale: 0.58 },
  mine: { artWidthScale: 1.42, apronWidthScale: 0.86, apronDepthScale: 0.58 },
  marketplace: { artWidthScale: 2.12, apronWidthScale: 1.18, apronDepthScale: 0.72 },
  barracks: { artWidthScale: 1.44, apronWidthScale: 0.90, apronDepthScale: 0.60 },
  stable: { artWidthScale: 1.48, apronWidthScale: 0.94, apronDepthScale: 0.62 },
  foundry: { artWidthScale: 1.40, apronWidthScale: 0.92, apronDepthScale: 0.60 },
  // A watch tower has a compact collision footprint but a tall architectural
  // silhouette. Its art width is deliberately broader than its pathing width
  // so naturally proportioned source art rises above housing without being
  // stretched vertically.
  tower: { artWidthScale: 1.84, apronWidthScale: 0.80, apronDepthScale: 0.56 },
  castle: { artWidthScale: 1.58, apronWidthScale: 0.80, apronDepthScale: 0.58 },
  school: { artWidthScale: 1.48, apronWidthScale: 0.88, apronDepthScale: 0.58 },
  pool: { artWidthScale: 1.48, apronWidthScale: 0.92, apronDepthScale: 0.62 },
  beach: { artWidthScale: 1.50, apronWidthScale: 0.94, apronDepthScale: 0.64 },
  park: { artWidthScale: 1.44, apronWidthScale: 0.96, apronDepthScale: 0.66 },
  playground: { artWidthScale: 1.44, apronWidthScale: 0.96, apronDepthScale: 0.66 },
  wall_stairs: { artWidthScale: 1.58, apronWidthScale: 0.94, apronDepthScale: 0.62 },
});

const BD_MINIMUM_HUMAN_HEIGHTS = Object.freeze({
  town_center: 3.25,
  house: 2.35,
  english_cottage: 2.35,
  english_townhouse: 2.75,
  english_mansion: 3,
  spooky_house: 3,
  mill: 2.35,
  lumber_camp: 2.35,
  mine: 2.35,
  marketplace: 3,
  barracks: 2.8,
  stable: 2.8,
  foundry: 2.8,
  tower: 4,
  castle: 5,
  school: 3.5,
  pool: 0.8,
  beach: 1.5,
  park: 1.8,
  playground: 1.5,
  wall_stairs: 1.4,
});

const BD_NATION_MINIMUM_HUMAN_HEIGHTS = Object.freeze({
  starwars: Object.freeze({
    // The StarWars village uses broad cinematic silhouettes with very small
    // painted doors and vents. Give that faction a taller human yardstick so
    // soldiers read as people standing beside real structures, not peers of
    // the buildings themselves.
    town_center: 5.55,
    house: 3.45,
    mill: 3.55,
    lumber_camp: 3.55,
    mine: 3.55,
    barracks: 4.15,
    stable: 4.15,
    foundry: 4.25,
    tower: 5.15,
    castle: 8.60,
  }),
});

const BD_NATION_PRESENTATION_SCALE = Object.freeze({
  // Themed architecture used to receive one blanket reduction. That flattened
  // its hierarchy: a cottage, utility shed and tower all lost the same share
  // of their stature even though only the monumental pieces needed restraint.
  // Role-specific factors keep allied settlements readable beside normal-size
  // workers while preventing the castle and Town Center from swallowing the
  // battlefield.
  hogwarts: Object.freeze({
    default: 0.90,
    town_center: 0.86,
    house: 0.92,
    mill: 0.92,
    lumber_camp: 0.92,
    mine: 0.92,
    barracks: 0.90,
    stable: 0.90,
    foundry: 0.90,
    tower: 1,
    castle: 0.86,
    school: 0.86,
    pool: 0.90,
    beach: 0.90,
  }),
  starwars: Object.freeze({
    default: 0.92,
    town_center: 0.88,
    house: 0.94,
    mill: 0.94,
    lumber_camp: 0.94,
    mine: 0.94,
    barracks: 0.92,
    stable: 0.92,
    foundry: 0.92,
    tower: 1,
    castle: 0.88,
  }),
});

function getBuildingPresentation(type, def = BUILDING_TYPES[type], nation = null) {
  if (!def) return null;
  const profile = BD_BUILDING_PRESENTATION[type] || {
    artWidthScale: 1.4, apronWidthScale: 0.76, apronDepthScale: 0.48,
  };
  const nationProfile = BD_NATION_PRESENTATION_SCALE[nation];
  const nationScale = nationProfile?.[type] ?? nationProfile?.default ?? 1;
  const visualScale = Math.max(1, (def.visualScale || 1) * nationScale);
  const artWidth = def.w * profile.artWidthScale;
  const minimumHumanHeights = BD_NATION_MINIMUM_HUMAN_HEIGHTS[nation]?.[type]
    ?? BD_MINIMUM_HUMAN_HEIGHTS[type] ?? 0;
  return {
    visualScale,
    artWidth,
    displayArtWidth: artWidth * visualScale,
    minimumHumanHeights,
    minimumDisplayHeight: minimumHumanHeights * BUILDING_HUMAN_REFERENCE_HEIGHT,
    apronRx: def.w * profile.apronWidthScale,
    apronRy: def.h * profile.apronDepthScale,
    // The selection footprint is the shared visual centre of the structure
    // and its courtyard. Keeping this in the presentation contract prevents
    // production sprites and procedural painters from independently anchoring
    // paving to their front wall, which leaves most bricks below the building.
    pavingCenterY: def.h * 0.22,
  };
}

function bdProductionSourceRect(nation, type, naturalWidth, naturalHeight) {
  const requested = BD_BUILDING_SOURCE_RECT_BY_NATION[nation]?.[type]
    || [0, 0, naturalWidth, naturalHeight];
  const x = bdClamp(requested[0], 0, naturalWidth);
  const y = bdClamp(requested[1], 0, naturalHeight);
  const width = bdClamp(requested[2], 1, naturalWidth - x);
  const height = bdClamp(requested[3], 1, naturalHeight - y);
  return { x, y, width, height };
}

/**
 * Visible painted size after transparent-canvas trimming and role scaling.
 * Keeping this calculation public gives tests and future asset passes the
 * exact same contract as the renderer instead of comparing gameplay radii to
 * image files by eye.
 */
function getProductionBuildingVisibleSize(type, nation, naturalWidth, naturalHeight) {
  const def = BUILDING_TYPES[type];
  if (!def || !(naturalWidth > 0) || !(naturalHeight > 0)) return null;
  const source = bdProductionSourceRect(nation, type, naturalWidth, naturalHeight);
  const presentation = getBuildingPresentation(type, def, nation);
  const aspect = source.height / source.width;
  const displayWidth = Math.max(
    presentation.displayArtWidth,
    presentation.minimumDisplayHeight / aspect,
  );
  return {
    width: displayWidth,
    height: displayWidth * aspect,
    unscaledWidth: displayWidth / presentation.visualScale,
    unscaledHeight: displayWidth * aspect / presentation.visualScale,
    minimumDisplayHeight: presentation.minimumDisplayHeight,
    humanHeightRatio: displayWidth * aspect / BUILDING_HUMAN_REFERENCE_HEIGHT,
    sourceRect: source,
  };
}

function getBuildingConstructionArtWidth(type, nation, naturalWidth, naturalHeight) {
  const def = BUILDING_TYPES[type];
  if (!def) return 0;
  const visible = getProductionBuildingVisibleSize(type, nation, naturalWidth, naturalHeight);
  const targetWidth = visible?.unscaledWidth || getBuildingPresentation(type, def, nation).artWidth;
  return Math.max(def.w * 1.12, targetWidth * 1.04);
}

function bdVisualGroundY(building) {
  if (building.type === 'gate') return building.h * 0.52 + 11;
  if (building.type === 'wall') return building.h * 0.52 + 8;
  return building.h * 0.48 + 8;
}

const BD_ARCHITECTURE_SHEET_COLUMNS = 2;
const BD_ARCHITECTURE_SHEET_ROWS = 2;

function bdArchitectureSheetCell(image, index) {
  const width = image.naturalWidth / BD_ARCHITECTURE_SHEET_COLUMNS;
  const height = image.naturalHeight / BD_ARCHITECTURE_SHEET_ROWS;
  return {
    sx: (index % BD_ARCHITECTURE_SHEET_COLUMNS) * width,
    sy: Math.floor(index / BD_ARCHITECTURE_SHEET_COLUMNS) * height,
    sw: width,
    sh: height,
  };
}

function bdConstructionArtFrame(progress) {
  const position = bdClamp(progress, 0, 1) * 4;
  const from = Math.min(3, Math.floor(position));
  const to = Math.min(3, from + 1);
  // Keep one physical site fully opaque for most of each quarter. The short
  // handoff at its end prevents a pop without creating a ghosted double
  // building from two structurally different stages.
  const rawMix = bdClamp(((position - Math.floor(position)) - 0.74) / 0.26, 0, 1);
  const mix = rawMix * rawMix * (3 - 2 * rawMix);
  return { from, to, mix };
}

function bdDrawArchitectureCell(g, image, index, x, y, width, height, alpha, mirror) {
  const cell = bdArchitectureSheetCell(image, index);
  g.save();
  g.globalAlpha *= alpha == null ? 1 : alpha;
  if (mirror) {
    g.translate(x + width, 0);
    g.scale(-1, 1);
    g.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, 0, y, width, height);
  } else {
    g.drawImage(image, cell.sx, cell.sy, cell.sw, cell.sh, x, y, width, height);
  }
  g.restore();
}

function bdDrawHorizontalSheetCell(g, image, index, x, y, width, height, alpha, mirror) {
  const cellWidth = image.naturalWidth / 2;
  g.save();
  g.globalAlpha *= alpha == null ? 1 : alpha;
  if (mirror) {
    g.translate(x + width, 0);
    g.scale(-1, 1);
    g.drawImage(image, index * cellWidth, 0, cellWidth, image.naturalHeight,
      0, y, width, height);
  } else {
    g.drawImage(image, index * cellWidth, 0, cellWidth, image.naturalHeight,
      x, y, width, height);
  }
  g.restore();
}

function bdTargetConstructionArtWidth(building, nation) {
  const variant = Number.isInteger(building.visualVariant) ? building.visualVariant : 0;
  const completedSpec = getBuildingProductionArtSpec(nation, building.type, variant);
  const completedImage = completedSpec ? getProductionArt(completedSpec.key) : null;
  return getBuildingConstructionArtWidth(
    building.type,
    nation,
    completedImage?.naturalWidth || 0,
    completedImage?.naturalHeight || 0,
  );
}

function bdDrawConstructionSheet(g, image, building, nation, alpha) {
  const artWidth = bdTargetConstructionArtWidth(building, nation);
  const ground = building.h * 0.46 + 15;
  const top = ground - artWidth * 0.89;
  const frame = bdConstructionArtFrame(building.progress);
  const opacity = alpha == null ? 1 : alpha;
  bdDrawArchitectureCell(g, image, frame.from, -artWidth / 2, top,
    artWidth, artWidth, (1 - frame.mix) * opacity, false);
  if (frame.to !== frame.from && frame.mix > 0.001) {
    bdDrawArchitectureCell(g, image, frame.to, -artWidth / 2, top,
      artWidth, artWidth, frame.mix * opacity, false);
  }
}

function bdFortificationArtGeometry(building) {
  const isGate = building.type === 'gate';
  const artWidth = building.w * (isGate ? 1.72 : 1.78);
  const ground = building.h * 0.52 + (isGate ? 11 : 8);
  const anchor = isGate ? 0.90 : 0.84;
  return { artWidth, top: ground - artWidth * anchor };
}

function bdFortificationArtView(building) {
  const rearView = viewMirrorsHorizontalFacing(camera.rotation);
  if (building.orientation === 'diagonal') {
    return { orientationIndex: 1, mirror: rearView };
  }
  if (!Number.isFinite(building.orientation)) {
    return { orientationIndex: 0, mirror: rearView };
  }
  let angle = normalizeFortificationOrientation(building.orientation);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  const diagonal = Math.abs(angle) > 0.27;
  return { orientationIndex: diagonal ? 1 : 0, mirror: (angle < -0.27) !== rearView };
}

function bdDrawProductionFortification(g, building, image, closedImage, alpha) {
  const { orientationIndex, mirror } = bdFortificationArtView(building);
  const index = building.type === 'gate' ? 2 + orientationIndex : orientationIndex;
  const geometry = bdFortificationArtGeometry(building);
  if (building.type === 'gate' && building.gateOpen === false) {
    if (closedImage) {
      bdDrawHorizontalSheetCell(g, closedImage, orientationIndex,
        -geometry.artWidth / 2, geometry.top,
        geometry.artWidth, geometry.artWidth, alpha == null ? 1 : alpha, mirror);
      return;
    }
  }
  bdDrawArchitectureCell(g, image, index, -geometry.artWidth / 2, geometry.top,
    geometry.artWidth, geometry.artWidth, alpha == null ? 1 : alpha, mirror);
}

function bdDrawProductionFortificationConstruction(
  g,
  building,
  image,
  completedImage,
  closedImage,
) {
  const isGate = building.type === 'gate';
  const early = isGate ? 2 : 0;
  const late = early + 1;
  const geometry = bdFortificationArtGeometry(building);
  const p = bdClamp(building.progress, 0, 1);
  const transition = bdClamp((p - 0.42) / 0.28, 0, 1);
  const mix = transition * transition * (3 - 2 * transition);
  const finish = completedImage && p > 0.80 ? bdClamp((p - 0.80) / 0.20, 0, 1) : 0;
  const constructionAlpha = 1 - finish;
  const mirror = bdFortificationArtView(building).mirror;
  bdDrawArchitectureCell(g, image, early, -geometry.artWidth / 2, geometry.top,
    geometry.artWidth, geometry.artWidth, (1 - mix) * constructionAlpha, mirror);
  bdDrawArchitectureCell(g, image, late, -geometry.artWidth / 2, geometry.top,
    geometry.artWidth, geometry.artWidth, mix * constructionAlpha, mirror);

  // The authored late construction state hands off to the exact finished
  // fortification during the final fifth, preventing a one-frame silhouette
  // swap when the building becomes complete.
  if (completedImage && finish > 0) {
    bdDrawProductionFortification(g, building, completedImage, closedImage, finish);
  }
}

export function usesFixedFortificationFrameArt(building) {
  return !Number.isFinite(normalizeFortificationOrientation(building?.orientation));
}

function bdJoinedFortificationEnds(building, world, includeIncomplete = false) {
  const endpoints = fortificationEndpoints(building);
  if (!world || endpoints.length !== 2) return [false, false];
  const neighbors = world.buildings.filter(candidate => candidate !== building
    && candidate.alive && (includeIncomplete || candidate.complete)
    && candidate.side === building.side
    && isFortificationType(candidate.type));
  return endpoints.map(endpoint => neighbors.some(neighbor => fortificationEndpoints(neighbor)
    .some(candidate => Math.hypot(candidate.x - endpoint.x, candidate.y - endpoint.y) <= 3.5)));
}

export function getFortificationRenderProfile(building, world) {
  const joinedEnds = bdJoinedFortificationEnds(building, world);
  const nation = world?.sides?.[building?.side]?.nation;
  const connectedWall = building?.type === 'wall' && joinedEnds.some(Boolean);
  return {
    joinedEnds,
    // English authored frames cannot represent a physical near/far side:
    // mirroring keeps the tall parapet on the rear face. Its detailed
    // procedural masonry is now the shared contract for straight, curved and
    // gated runs. Keep the Ottoman faction's distinct fixed-angle production
    // art when it does not need to flow through a connected curve.
    useProductionFrame: nation === 'ottoman'
      && usesFixedFortificationFrameArt(building) && !connectedWall,
    interiorSide: fortificationInteriorSide(world, building),
  };
}

/**
 * Production buildings use pre-rendered sources rather than the general
 * material-lining pipeline. Passing this art through bdPassLining or the hard
 * gallery-light bands would destroy the sub-pixel masonry, glazing and carved
 * stone detail that the authored assets supply.
 */
function bdPaintProductionDamage(g, left, top, imageW, imageH, damageStage, seed) {
  if (!damageStage) return;
  const rr = bdRnd(seed ^ (damageStage * 0x45d9f3b));
  g.save();
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < damageStage + 1; i++) {
    const x = rr(left + imageW * 0.14, left + imageW * 0.86);
    const y = rr(top + imageH * 0.22, top + imageH * 0.76);
    const radius = rr(9, 18) * damageStage;
    const soot = g.createRadialGradient(x, y, 0, x, y, radius);
    soot.addColorStop(0, `rgba(27,24,26,${damageStage === 1 ? 0.24 : 0.42})`);
    soot.addColorStop(1, 'rgba(27,24,26,0)');
    g.fillStyle = soot;
    g.beginPath();
    g.ellipse(x, y, radius, radius * 0.62, rr(-0.35, 0.35), 0, BD_TAU);
    g.fill();
  }
  g.strokeStyle = bdShadow(damageStage === 1 ? 0.48 : 0.68);
  g.lineWidth = damageStage === 1 ? 0.48 : 0.72;
  for (let i = 0; i < damageStage * 3; i++) {
    let x = rr(left + imageW * 0.20, left + imageW * 0.80);
    let y = rr(top + imageH * 0.48, top + imageH * 0.82);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += rr(-3.2, 3.2);
      y += rr(2.0, 5.0);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

function bdHouseVariantPlan(def, image, variant) {
  const presentation = getBuildingPresentation('house', def);
  const baseW = presentation.artWidth;
  const bottom = def.h * 0.48 + 8;
  const flavor = variant % 8;
  const mansionTint = 'rgba(23,22,28,0.32)';
  const estateTint = 'rgba(73,64,56,0.10)';
  const part = (cx, width, bottomOffset = 0, opts = {}) => ({
    cx, width, bottom: bottom + bottomOffset,
    alpha: opts.alpha == null ? 1 : opts.alpha,
    tint: opts.tint || null,
  });
  const plans = [
    { apron: 1.00, shadow: 1.00, parts: [part(0, baseW)] },
    { apron: 0.96, shadow: 0.92, parts: [part(0, baseW * 0.92, 1)] },
    {
      apron: 1.34, shadow: 1.16,
      parts: [
        part(-baseW * 0.28, baseW * 0.78, 2),
        part(baseW * 0.28, baseW * 0.78, 0),
      ],
    },
    {
      apron: 1.62, shadow: 1.34,
      parts: [
        part(-baseW * 0.52, baseW * 0.68, 5, { tint: estateTint }),
        part(baseW * 0.52, baseW * 0.68, 5, { tint: estateTint }),
        part(0, baseW * 1.14, 0),
      ],
    },
    {
      apron: 1.78, shadow: 1.44,
      parts: [
        part(-baseW * 0.62, baseW * 0.76, 7, { tint: estateTint }),
        part(baseW * 0.62, baseW * 0.76, 7, { tint: estateTint }),
        part(0, baseW * 1.28, 0),
      ],
    },
    {
      apron: 1.86, shadow: 1.48,
      parts: [
        part(-baseW * 0.66, baseW * 0.78, 7, { tint: mansionTint }),
        part(baseW * 0.66, baseW * 0.78, 7, { tint: mansionTint }),
        part(0, baseW * 1.30, 0, { tint: mansionTint }),
      ],
    },
    {
      apron: 2.05, shadow: 1.62,
      parts: [
        part(-baseW * 0.82, baseW * 0.72, 9, { tint: estateTint }),
        part(baseW * 0.82, baseW * 0.72, 9, { tint: estateTint }),
        part(-baseW * 0.34, baseW * 0.82, 4),
        part(baseW * 0.34, baseW * 0.82, 4),
        part(0, baseW * 1.36, 0),
      ],
    },
    { apron: 0.86, shadow: 0.82, parts: [part(0, baseW * 0.82, 2)] },
  ];
  const plan = plans[flavor];
  const aspect = image.naturalHeight / image.naturalWidth;
  const parts = plan.parts.map(entry => ({
    ...entry,
    height: entry.width * aspect,
    left: entry.cx - entry.width / 2,
    right: entry.cx + entry.width / 2,
    top: entry.bottom - entry.width * aspect,
  }));
  return {
    apron: plan.apron,
    shadow: plan.shadow,
    parts,
    bounds: {
      left: Math.min(...parts.map(entry => entry.left)),
      right: Math.max(...parts.map(entry => entry.right)),
      top: Math.min(...parts.map(entry => entry.top)),
      bottom: Math.max(...parts.map(entry => entry.bottom)),
    },
    presentation,
  };
}

function bdDrawProductionHousePart(g, image, part) {
  g.save();
  g.globalAlpha *= part.alpha;
  g.drawImage(image, part.left, part.top, part.width, part.height);
  if (part.tint) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = part.tint;
    g.fillRect(part.left, part.top, part.width, part.height);
  }
  g.restore();
}

function bdProductionHouseSprite(def, image, side, variant, damageStage, seed) {
  const plan = bdHouseVariantPlan(def, image, variant);
  const { presentation, bounds } = plan;
  const apronRx = presentation.apronRx * plan.apron;
  const apronRy = presentation.apronRy * Math.min(1.55, 0.88 + plan.apron * 0.28);
  const boxLeft = Math.min(bounds.left - 24, -apronRx * 1.18 - 4);
  const boxRight = Math.max(bounds.right + 24, apronRx * 1.18 + 4);
  const boxBottom = Math.max(
    bounds.bottom + 60,
    presentation.pavingCenterY + apronRy * 1.20 + 8,
  );
  const box = [boxLeft, bounds.top - 18, boxRight - boxLeft, boxBottom - (bounds.top - 18)];

  return bdBake(box, BD_SCALE, function (g) {
    for (const entry of plan.parts) bdDrawProductionHousePart(g, image, entry);
    for (let index = 0; index < plan.parts.length; index++) {
      const entry = plan.parts[index];
      bdPaintProductionDamage(
        g, entry.left, entry.top, entry.width, entry.height,
        damageStage, seed + index * 92821,
      );
    }

    g.save();
    g.globalCompositeOperation = 'destination-over';
    for (const entry of plan.parts) {
      bdContactShadow(g, entry.cx, entry.bottom - 8,
        def.w * 0.44 * plan.shadow, def.h * 0.46, 0.54);
    }
    g.restore();

    bdPassGroundApron(g, 0, presentation.pavingCenterY,
      apronRx, BD_SIDE[side].rim, {
      ry: apronRy,
      seed,
    });
  });
}

function bdProductionBuildingSprite(type, def, image, nation, side, damageStage, seed) {
  const presentation = getBuildingPresentation(type, def, nation);
  const visible = getProductionBuildingVisibleSize(
    type,
    nation,
    image.naturalWidth,
    image.naturalHeight,
  );
  const source = visible.sourceRect;
  const imageW = visible.unscaledWidth;
  const imageH = visible.unscaledHeight;
  const bottom = def.h * 0.48 + 8;
  const left = -imageW / 2;
  const top = bottom - imageH;
  const boxLeft = Math.min(left - 24, -presentation.apronRx * 1.18 - 4);
  const boxRight = Math.max(left + imageW + 24, presentation.apronRx * 1.18 + 4);
  const boxBottom = Math.max(
    bottom + 60,
    presentation.pavingCenterY + presentation.apronRy * 1.20 + 8,
  );
  const box = [boxLeft, top - 18, boxRight - boxLeft, boxBottom - (top - 18)];

  return bdBake(box, BD_SCALE, function (g) {
    g.drawImage(
      image,
      source.x, source.y, source.width, source.height,
      left, top, imageW, imageH,
    );

    // Damage remains cached with the sprite. Low-opacity soot and hairline
    // fractures preserve the pre-rendered material response instead of
    // replacing it with the procedural renderer's broad damage marks.
    bdPaintProductionDamage(g, left, top, imageW, imageH, damageStage, seed);

    // A soft, cool ambient bed ties the isolated sprite to the terrain. It is
    // destination-over so no shadow pigment can muddy the stone stair or base.
    g.save();
    g.globalCompositeOperation = 'destination-over';
    bdContactShadow(g, 0, bottom - 8, def.w * 0.58, def.h * 0.54, 0.74);
    g.restore();

    bdPassGroundApron(g, 0, presentation.pavingCenterY,
      presentation.apronRx, BD_SIDE[side].rim, {
      ry: presentation.apronRy,
      seed,
    });
  });
}

function bdLoop(value) {
  return ((value % 1) + 1) % 1;
}

function bdLerp(a, b, t) {
  return a + (b - a) * t;
}

function bdEaseInOut(t) {
  return t * t * (3 - 2 * t);
}

function bdPlayPathPoint(points, progress) {
  const wrapped = bdLoop(progress);
  const scaled = wrapped * points.length;
  const index = Math.floor(scaled);
  const next = (index + 1) % points.length;
  const mix = bdEaseInOut(scaled - index);
  const a = points[index], b = points[next];
  return {
    x: bdLerp(a[0], b[0], mix),
    y: bdLerp(a[1], b[1], mix),
    facing: b[0] >= a[0] ? 1 : -1,
  };
}

export function getWizardPlaygroundChildLayout(worldTime = 0, buildingId = 0) {
  const t = Number(worldTime) || 0;
  const seed = (Number(buildingId) || 0) * 0.173;
  const chaseA = bdPlayPathPoint([
    [-44, 18], [-18, 5], [8, 15], [-3, 35], [-36, 34],
  ], t * 0.080 + seed);
  const chaseB = bdPlayPathPoint([
    [30, 8], [52, 20], [35, 40], [9, 32], [18, 12],
  ], t * 0.092 + seed + 0.42);
  const bridge = bdPlayPathPoint([
    [-14, -25], [14, -28], [38, -20], [7, -18],
  ], t * 0.052 + seed + 0.18);
  const sandbox = bdPlayPathPoint([
    [-8, 32], [8, 36], [19, 28], [4, 24],
  ], t * 0.060 + seed + 0.62);
  const slide = bdLoop(t * 0.105 + seed + 0.27);
  const slideEase = slide < 0.46
    ? slide / 0.46
    : bdEaseInOut((slide - 0.46) / 0.54);
  const slider = slide < 0.46
    ? { x: 43 - slideEase * 14, y: -18 + slideEase * 18, facing: -1 }
    : { x: 29 + slideEase * 23, y: 0 + slideEase * 24, facing: 1 };
  const swingPhase = Math.sin(t * 2.6 + seed * 11);
  const spinnerPhase = t * 1.8 + seed * 7;
  return [
    {
      id: 'chaser-girl', gender: 'girl', play: 'wand-chase',
      x: chaseA.x, y: chaseA.y, facing: chaseA.facing,
      robe: '#4a315f', trim: '#d8b457', hat: '#251c35',
      hair: '#6d4425', skin: '#c9936f', scale: 1.00,
      bob: Math.sin(t * 8.2 + seed) * 1.5, wandAngle: -0.65,
      sparkle: bdLoop(t * 0.9 + 0.10),
    },
    {
      id: 'chaser-boy', gender: 'boy', play: 'wand-chase',
      x: chaseB.x, y: chaseB.y, facing: chaseB.facing,
      robe: '#273f62', trim: '#bfcfe2', hat: '#1f2a3a',
      hair: '#2f2117', skin: '#d6a67e', scale: 0.98,
      bob: Math.sin(t * 8.8 + 1.7 + seed) * 1.45, wandAngle: -0.40,
      sparkle: bdLoop(t * 0.85 + 0.34),
    },
    {
      id: 'bridge-girl', gender: 'girl', play: 'rope-bridge',
      x: bridge.x, y: bridge.y, facing: bridge.facing,
      robe: '#31583f', trim: '#d8c96a', hat: '#223528',
      hair: '#8a6039', skin: '#b77b57', scale: 0.94,
      bob: Math.sin(t * 6.5 + 0.8) * 0.9, wandAngle: -0.95,
      sparkle: bdLoop(t * 0.72 + 0.56),
    },
    {
      id: 'slide-boy', gender: 'boy', play: 'slide',
      x: slider.x, y: slider.y, facing: slider.facing,
      robe: '#6a3b2b', trim: '#f0c878', hat: '#3b231f',
      hair: '#583823', skin: '#c68663', scale: 0.96,
      bob: slide < 0.46 ? Math.sin(slideEase * Math.PI) * 0.7
        : -Math.sin(slideEase * Math.PI) * 1.7,
      wandAngle: slide < 0.46 ? -1.0 : 0.35,
      sparkle: bdLoop(t * 1.12 + 0.72),
    },
    {
      id: 'swing-girl', gender: 'girl', play: 'swing',
      x: -54 + swingPhase * 2.2, y: 9 + Math.abs(swingPhase) * 6.8,
      facing: swingPhase >= 0 ? 1 : -1,
      robe: '#5f3147', trim: '#f0d6df', hat: '#332030',
      hair: '#3d271a', skin: '#a96f52', scale: 0.92,
      bob: -Math.abs(swingPhase) * 2.4, wandAngle: swingPhase * 0.55,
      swing: swingPhase, sparkle: bdLoop(t * 0.78 + 0.22),
    },
    {
      id: 'sandbox-boy', gender: 'boy', play: 'sandbox-spell',
      x: sandbox.x, y: sandbox.y, facing: sandbox.facing,
      robe: '#3c4758', trim: '#d0b679', hat: '#202736',
      hair: '#17120e', skin: '#7f513d', scale: 0.90,
      bob: Math.sin(t * 5.0 + 1.1) * 0.45, wandAngle: -1.2,
      sparkle: bdLoop(t * 1.05 + 0.48),
    },
    {
      id: 'spinner-girl', gender: 'girl', play: 'spell-circle',
      x: 56 + Math.cos(spinnerPhase) * 7.4,
      y: -8 + Math.sin(spinnerPhase) * 4.5,
      facing: Math.cos(spinnerPhase) >= 0 ? 1 : -1,
      robe: '#654778', trim: '#ddd0ff', hat: '#352543',
      hair: '#c08a44', skin: '#d2a174', scale: 0.86,
      bob: Math.sin(t * 7.2) * 1.0, wandAngle: -0.7 + Math.sin(spinnerPhase) * 0.55,
      sparkle: bdLoop(t * 1.35 + 0.05),
    },
    {
      id: 'lookout-boy', gender: 'boy', play: 'tower-lookout',
      x: 57 + Math.sin(t * 1.4 + seed) * 4.8,
      y: -31 + Math.sin(t * 3.2 + 0.6) * 1.2,
      facing: Math.sin(t * 1.4 + seed) >= 0 ? 1 : -1,
      robe: '#2f4f59', trim: '#a7e1d7', hat: '#21333a',
      hair: '#5b3b22', skin: '#c79268', scale: 0.76,
      bob: Math.sin(t * 5.2 + 0.3) * 0.6, wandAngle: -0.25,
      sparkle: bdLoop(t * 0.95 + 0.81),
    },
  ].sort((a, b) => a.y - b.y);
}

function bdWizardChildShadow(g, child) {
  g.fillStyle = bdShadow(0.30);
  g.beginPath();
  g.ellipse(child.x + 1.0, child.y + 2.4, 4.9 * child.scale, 1.8 * child.scale, 0, 0, BD_TAU);
  g.fill();
}

function bdWizardSpark(g, child, worldTime) {
  const pulse = Math.sin((worldTime || 0) * 8 + child.sparkle * BD_TAU) * 0.5 + 0.5;
  const facing = child.facing >= 0 ? 1 : -1;
  const sx = child.x + facing * (5.2 + Math.cos(child.wandAngle) * 3.2) * child.scale;
  const sy = child.y - (12.5 + Math.sin(child.wandAngle) * 2.8) * child.scale + child.bob;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = bdRgba(child.trim, 0.28 + pulse * 0.34);
  g.lineWidth = 0.55 * child.scale;
  for (let index = 0; index < 3; index++) {
    const a = child.sparkle * BD_TAU + index * 2.1 + worldTime * 1.7;
    const r = (2.1 + index * 0.8 + pulse * 1.2) * child.scale;
    g.beginPath();
    g.moveTo(sx + Math.cos(a) * r * 0.35, sy + Math.sin(a) * r * 0.35);
    g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
    g.stroke();
  }
  g.fillStyle = bdRgba('#fff6d8', 0.72 + pulse * 0.22);
  g.beginPath();
  g.arc(sx, sy, (0.9 + pulse * 0.6) * child.scale, 0, BD_TAU);
  g.fill();
  g.restore();
}

function bdDrawWizardChild(g, child, side, worldTime) {
  const s = child.scale;
  const facing = child.facing >= 0 ? 1 : -1;
  const robe = bdRamp(child.robe);
  const trim = bdRamp(child.trim);
  const skin = bdRamp(child.skin);
  const hair = bdRamp(child.hair);
  const hat = bdRamp(child.hat);
  const stride = Math.sin((worldTime || 0) * 8.4 + child.x * 0.07);
  const bob = child.bob || 0;
  const baseX = child.x;
  const baseY = child.y + bob;

  bdWizardChildShadow(g, child);
  if (child.play === 'swing') {
    g.save();
    g.strokeStyle = bdRgba(BMAT.TIMBER_DARK, 0.65);
    g.lineWidth = 0.55;
    g.beginPath();
    g.moveTo(-58, -29);
    g.lineTo(baseX - 2, baseY - 7);
    g.moveTo(-48, -29);
    g.lineTo(baseX + 2, baseY - 7);
    g.stroke();
    g.restore();
  }

  g.save();
  g.translate(baseX, baseY);
  g.scale(facing * s, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  g.strokeStyle = robe.line;
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-2.6, -7.0);
  g.lineTo(-4.2 - stride * 0.8, 0.2);
  g.moveTo(2.5, -7.0);
  g.lineTo(4.0 + stride * 0.8, 0.2);
  g.stroke();
  g.strokeStyle = bdMix(robe.base, BMAT.TIMBER_DARK, 0.16);
  g.lineWidth = 0.9;
  g.stroke();

  g.fillStyle = robe.shade;
  g.strokeStyle = robe.line;
  g.lineWidth = 0.85;
  g.beginPath();
  if (child.gender === 'girl') {
    g.moveTo(-4.8, -13.2);
    g.lineTo(4.4, -13.2);
    g.lineTo(6.1, -2.4);
    g.lineTo(-6.0, -2.4);
  } else {
    g.moveTo(-4.3, -13.1);
    g.lineTo(4.3, -13.1);
    g.lineTo(4.7, -2.7);
    g.lineTo(-4.8, -2.7);
  }
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = robe.base;
  g.beginPath();
  g.moveTo(-3.1, -12.2);
  g.lineTo(3.4, -12.4);
  g.lineTo(3.2, -3.6);
  g.lineTo(-3.8, -3.8);
  g.closePath();
  g.fill();
  g.fillStyle = bdRgba(trim.base, 0.88);
  g.fillRect(-4.4, -8.1, 8.8, 1.05);
  g.strokeStyle = bdRgba(trim.edge, 0.82);
  g.lineWidth = 0.42;
  g.beginPath();
  g.moveTo(0, -12.5);
  g.lineTo(0, -3.8);
  g.stroke();

  const wandAngle = child.wandAngle || -0.5;
  const wandHandX = 4.0;
  const wandHandY = -10.8;
  g.strokeStyle = skin.line;
  g.lineWidth = 1.45;
  g.beginPath();
  g.moveTo(-3.8, -11.2);
  g.lineTo(-6.1, -7.9 + stride * 0.35);
  g.moveTo(3.8, -11.2);
  g.lineTo(wandHandX, wandHandY);
  g.stroke();
  g.strokeStyle = skin.base;
  g.lineWidth = 0.82;
  g.stroke();
  g.strokeStyle = '#2c2117';
  g.lineWidth = 0.58;
  g.beginPath();
  g.moveTo(wandHandX, wandHandY);
  g.lineTo(wandHandX + Math.cos(wandAngle) * 8.0, wandHandY + Math.sin(wandAngle) * 8.0);
  g.stroke();

  g.fillStyle = skin.base;
  g.strokeStyle = skin.line;
  g.lineWidth = 0.72;
  g.beginPath();
  g.ellipse(0.15, -17.1, 3.2, 3.45, 0, 0, BD_TAU);
  g.fill();
  g.stroke();
  g.fillStyle = hair.shade;
  if (child.gender === 'girl') {
    g.beginPath();
    g.ellipse(-2.9, -15.6, 1.2, 3.9, -0.25, 0, BD_TAU);
    g.ellipse(2.8, -15.7, 1.0, 3.4, 0.22, 0, BD_TAU);
    g.fill();
  } else {
    g.beginPath();
    g.arc(0, -18.2, 3.1, Math.PI * 1.03, Math.PI * 1.95);
    g.lineTo(2.9, -16.5);
    g.quadraticCurveTo(0, -15.4, -3.0, -16.5);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#201712';
  g.beginPath(); g.arc(-1.1, -17.0, 0.34, 0, BD_TAU); g.fill();
  g.beginPath(); g.arc(1.3, -17.0, 0.34, 0, BD_TAU); g.fill();
  g.strokeStyle = bdRgba(skin.shade, 0.72);
  g.lineWidth = 0.35;
  g.beginPath();
  g.arc(0.2, -15.8, 1.2, 0.2, Math.PI - 0.2);
  g.stroke();

  g.fillStyle = hat.shade;
  g.strokeStyle = hat.line;
  g.lineWidth = 0.8;
  g.beginPath();
  g.ellipse(0.1, -20.1, 5.5, 1.25, 0.03, 0, BD_TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(-3.3, -20.4);
  g.quadraticCurveTo(-1.3, -26.6, 1.8, -29.9);
  g.quadraticCurveTo(3.8, -25.0, 2.6, -20.4);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = hat.lit;
  g.beginPath();
  g.moveTo(-1.6, -21.0);
  g.quadraticCurveTo(-0.6, -25.1, 1.1, -27.5);
  g.quadraticCurveTo(1.7, -24.2, 1.2, -20.9);
  g.closePath();
  g.fill();
  g.fillStyle = BD_SIDE[side]?.lit || '#e8dca8';
  g.globalAlpha = 0.82;
  g.fillRect(-3.2, -20.4, 6.2, 0.72);
  g.globalAlpha = 1;
  g.restore();

  bdWizardSpark(g, child, worldTime || 0);
}

function bdDrawWizardPlaygroundChildren(g, building, worldTime) {
  if (building.type !== 'playground' || !building.complete) return;
  const children = getWizardPlaygroundChildLayout(worldTime, building.id);
  g.save();
  g.globalAlpha = 0.98;
  for (const child of children) bdDrawWizardChild(g, child, building.side, worldTime);
  g.restore();
}

function bdBuildingSprite(type, def, side, nation, natRoof, variant, damageStage, animFrame) {
  const art = getBuildingProductionArtSpec(nation, type, variant);
  const image = art ? getProductionArt(art.key) : null;
  const frame = type === 'mill' && !image ? (animFrame || 0) : 0;
  const damage = damageStage || 0;
  const key = type + '|' + side + '|' + nation + '|' + variant + '|' + damage + '|' + frame;
  let s = bdBuildingCache.get(key);
  if (s) return s;

  if (image) {
    const seed = variant * 7919 + side * 104729 + 1;
    s = bdProductionBuildingSprite(type, def, image, nation, side, damage, seed);
    bdBuildingCache.set(key, s);
    return s;
  }

  const painter = BD_PAINTERS[type];
  if (!painter) return null;
  const box = bdBoxFor(type, def);
  // Seed from the key so a re-bake is byte-identical, and so the house
  // variants differ in their timber bracing, thatch and stonework rather than
  // being the same house over and over.
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
    bdPassRecessWash(g, scale);
    if (type !== 'wall') {
      bdPassGalleryLight(g, box);
      bdPassMatteVarnish(g, box);
    }
    // lining: material-tinted, luminance-clamped, dilated 8 ways
    bdPassLining(g, scale, bdRamp(BMAT.TIMBER).line);
    // the hard, shaped cast shadow — destination-over so the lining pass has
    // already finished and will not outline the shadow itself
    g.save();
    g.globalCompositeOperation = 'destination-over';
    bdCastShadow(g, bdShellSilhouette(G), G.height);
    g.restore();
    // trodden apron + soft bed, beneath everything
    const presentation = getBuildingPresentation(type, def);
    bdPassGroundApron(g, 0, presentation.pavingCenterY,
      presentation.apronRx, BD_SIDE[side].rim, {
      ry: presentation.apronRy,
      seed,
    });
  });
  bdBuildingCache.set(key, s);
  return s;
}

function bdFortificationDamage(g, structure, stage, seed) {
  if (!stage) return;
  const rr = bdRnd(seed ^ (stage * 0x45d9f3b));
  const { axis, normal, halfLength, halfThickness, height } = structure;
  const front = halfThickness + 0.9;
  g.save();
  g.strokeStyle = bdShadow(stage === 1 ? 0.62 : 0.82);
  g.lineWidth = stage === 1 ? 0.72 : 1.05;
  const cracks = stage === 1 ? 3 : 7;
  for (let index = 0; index < cracks; index++) {
    const along = rr(-halfLength * 0.82, halfLength * 0.82);
    const elevation = rr(8, Math.max(10, height - 8));
    let point = bdFortPoint(axis, normal, along, front, elevation);
    g.beginPath(); g.moveTo(point.x, point.y);
    for (let branch = 0; branch < (stage === 1 ? 3 : 5); branch++) {
      point = bdFortPoint(axis, normal, along + rr(-3.5, 3.5), front,
        elevation - branch * rr(2.0, 3.8));
      g.lineTo(point.x, point.y);
    }
    g.stroke();
  }
  g.restore();
  if (stage === 2) {
    const rubble = bdRamp(BMAT.STONE_ROUGH);
    for (let index = 0; index < 14; index++) {
      bdFortBlock(g, axis, normal, rr(-halfLength, halfLength),
        halfThickness + rr(4, 13), rr(1.5, 3.4), rr(1.2, 2.4), rr(1.5, 4.0),
        0, rubble, { lineW: 0.4, litW: 0.32 });
    }
  }
}

function bdFortificationSprite(
  building, damageStage, joinedEnds = [false, false], interiorSide = 1,
  gateOpenProgress = 1,
) {
  const type = building.type;
  const def = BUILDING_TYPES[type];
  const normalized = normalizeFortificationOrientation(building.orientation);
  const orientation = Number.isFinite(normalized) ? Math.round(normalized * 1000) / 1000 : normalized;
  const variant = ((building.id % 3) + 3) % 3;
  const joinMask = joinedEnds.map(joined => Number(Boolean(joined))).join('');
  const gateFrame = type === 'gate' ? Math.round(bdClamp(gateOpenProgress, 0, 1) * 10) : 10;
  const key = `fort|${type}|${building.side}|${orientation}|${variant}|${damageStage}|${joinMask}|${interiorSide}|${gateFrame}`;
  let sprite = bdBuildingCache.get(key);
  if (sprite) return sprite;
  const box = bdBoxFor(type, def);
  const seed = variant * 7919 + building.side * 104729 + (type === 'gate' ? 9109 : 3011);
  sprite = bdBake(box, BD_SCALE, function (g, scale) {
    const structure = bdPaintFortification(
      g, type, building.side, orientation, 1, seed, false, joinedEnds,
      interiorSide, gateFrame / 10,
    );
    bdFortificationDamage(g, structure, damageStage, seed);
    bdPassSurfacePatina(g, box, seed + damageStage * 101);
    // The projected masonry already contains its own directional light,
    // recess shading and matte stone response. Whole-stamp gallery/varnish
    // passes averaged that authored microcontrast back into a flat beige card.
    // Retain the source relief and add only the silhouette lining below.
    bdPassLining(g, scale, bdRamp(BMAT.STONE_ROUGH).line);

    const axis = structure.axis, normal = structure.normal;
    const corners = [
      bdFortPoint(axis, normal, -structure.halfLength, -structure.halfThickness, 0),
      bdFortPoint(axis, normal, structure.halfLength, -structure.halfThickness, 0),
      bdFortPoint(axis, normal, structure.halfLength, structure.halfThickness, 0),
      bdFortPoint(axis, normal, -structure.halfLength, structure.halfThickness, 0),
    ];
    g.save();
    g.globalCompositeOperation = 'destination-over';
    bdCastShadow(g, function (c) {
      c.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index++) c.lineTo(corners[index].x, corners[index].y);
      c.closePath();
    }, structure.height);
    bdContactShadow(g, 0, normal.y * structure.halfThickness + 3,
      structure.halfLength * 0.84, structure.height, 0.96);
    g.restore();
  });
  bdBuildingCache.set(key, sprite);
  return sprite;
}

function bdWallStairSprite(building, damageStage) {
  const variant = ((building.id % 3) + 3) % 3;
  const normalized = normalizeFortificationOrientation(building.orientation);
  const orientation = Number.isFinite(normalized) ? Math.round(normalized * 1000) / 1000 : normalized;
  const sideSign = building.stairSide === -1 ? -1 : 1;
  const key = `stairs|${building.side}|${orientation}|${sideSign}|${variant}|${damageStage}`;
  let sprite = bdBuildingCache.get(key);
  if (sprite) return sprite;
  const def = BUILDING_TYPES.wall_stairs;
  const box = bdBoxFor('wall_stairs', def);
  const model = { ...building, id: variant + 1, orientation, stairSide: sideSign };
  sprite = bdBake(box, BD_SCALE, function (g, scale) {
    bdPaintWallStairs(g, model, 1, false);
    if (damageStage) {
      const rr = bdRnd(variant * 7919 + damageStage * 131);
      g.strokeStyle = bdShadow(damageStage === 1 ? 0.50 : 0.72);
      g.lineWidth = damageStage === 1 ? 0.65 : 1.0;
      for (let crack = 0; crack < damageStage * 3; crack++) {
        let x = rr(-13, 13), y = rr(-32, 8);
        g.beginPath(); g.moveTo(x, y);
        for (let branch = 0; branch < 4; branch++) {
          x += rr(-2.4, 2.4); y += rr(2.2, 4.8); g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    bdPassSurfacePatina(g, box, variant * 3011 + damageStage * 101);
    bdPassGalleryLight(g, box);
    bdPassRecessWash(g, scale);
    bdPassMatteVarnish(g, box);
    bdPassLining(g, scale, bdRamp(BMAT.STONE_ROUGH).line);
  });
  bdBuildingCache.set(key, sprite);
  return sprite;
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

function bdFarmForegroundSprite(def, side, stage) {
  const key = side + '|' + stage;
  let sprite = bdFarmForegroundCache.get(key);
  if (sprite) return sprite;
  const box = bdBoxFor('farm', def);
  sprite = bdBake(box, BD_SCALE, function (g) {
    bdPaintFarmForeground(g, def, stage, side * 613 + stage * 71 + 3);
  });
  bdFarmForegroundCache.set(key, sprite);
  return sprite;
}

/**
 * Resource clusters. Baked per node and per DEPLETION STEP, so a wood
 * physically thins as it is felled — trees are replaced by stumps rather than
 * the whole cluster simply fading, which is what the current painter does and
 * why gathering currently has no visual consequence.
 */
const BD_RES_STEPS = 5;

const BD_RESOURCE_ART = Object.freeze({
  stone: { key: 'stoneOutcrop', widthK: 2.24 },
  gold: { key: 'goldOutcrop', widthK: 2.24 },
});

const BD_VEGETATION_CELL = 512;

function bdVegetationFramePath(g, left, top, width, height) {
  const cx = left + width * 0.5;
  const crownTop = top + height * 0.025;
  const shoulderY = top + height * 0.30;
  const waistY = top + height * 0.67;
  const baseY = top + height;
  g.beginPath();
  g.moveTo(cx, crownTop);
  g.bezierCurveTo(
    left + width * 0.20, top + height * 0.05,
    left + width * 0.065, shoulderY,
    left + width * 0.15, waistY,
  );
  g.quadraticCurveTo(left + width * 0.24, top + height * 0.93, cx, baseY);
  g.quadraticCurveTo(left + width * 0.76, top + height * 0.93, left + width * 0.85, waistY);
  g.bezierCurveTo(
    left + width * 0.935, shoulderY,
    left + width * 0.80, top + height * 0.05,
    cx, crownTop,
  );
  g.closePath();
}

function bdDrawSoftSourceRect(g, image, sx, sy, sw, sh, dx, dy, dw, dh, insetK = 0.055, fadeK = 0.10) {
  const canvasWidth = Math.max(1, Math.ceil(dw));
  const canvasHeight = Math.max(1, Math.ceil(dh));
  const c = document.createElement('canvas');
  c.width = canvasWidth;
  c.height = canvasHeight;
  const s = c.getContext('2d');
  const insetX = Math.round(sw * insetK);
  const sourceWidth = Math.max(1, sw - insetX * 2);
  s.drawImage(
    image,
    sx + insetX, sy, sourceWidth, sh,
    0, 0, canvasWidth, canvasHeight,
  );

  const fade = Math.max(10, canvasWidth * fadeK);
  const mask = s.createLinearGradient(0, 0, canvasWidth, 0);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(Math.min(0.5, fade / canvasWidth), 'rgba(0,0,0,1)');
  mask.addColorStop(Math.max(0.5, 1 - fade / canvasWidth), 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  s.globalCompositeOperation = 'destination-in';
  s.fillStyle = mask;
  s.fillRect(0, 0, canvasWidth, canvasHeight);
  g.drawImage(c, dx, dy, dw, dh);
}

function bdDrawVegetationFrame(g, image, frame, x, baseY, width, flip, alpha = 1) {
  if (!image) return false;
  const height = width;
  const left = x - width / 2;
  const top = baseY - height;
  g.save();
  g.globalAlpha *= alpha;
  bdVegetationFramePath(g, left, top, width, height);
  g.clip();
  if (flip) {
    g.translate(x, 0);
    g.scale(-1, 1);
    bdDrawSoftSourceRect(g, image, frame * BD_VEGETATION_CELL, 0,
      BD_VEGETATION_CELL, BD_VEGETATION_CELL, -width / 2, baseY - width,
      width, width, 0.045, 0.09);
  } else {
    bdDrawSoftSourceRect(g, image, frame * BD_VEGETATION_CELL, 0,
      BD_VEGETATION_CELL, BD_VEGETATION_CELL, x - width / 2, baseY - width,
      width, width, 0.045, 0.09);
  }
  g.restore();
  return true;
}

function bdDrawSoftOrganicStamp(g, image, x, y, width, height) {
  bdDrawSoftSourceRect(
    g, image, 0, 0, image.naturalWidth, image.naturalHeight,
    x, y, width, height, 0.065, 0.12,
  );
}

function bdPaintResourceFloor(g, res, profile, rr) {
  const radius = res.radius;
  const isWood = profile.type === 'wood';
  const floor = profile.floor;
  const earth = floor === 'needle_litter'
    ? bdMix(BT.EARTH_DARK, BT.TRUNK_DARK, 0.36)
    : floor === 'light_litter'
      ? bdMix(BT.EARTH, BT.STRAW, 0.26)
      : bdMix(BT.EARTH_DARK, BT.TRUNK_LIT, 0.24);
  const ground = bdRamp(bdLawful(isWood ? earth : bdMix(BT.EARTH, BT.TURF_MID, 0.34)));
  const rx = radius * (isWood ? 0.96 : profile.crop === 'orchard' ? 1.32 : 0.90);
  const ry = radius * (isWood ? 0.52 : 0.46);

  g.save();
  g.globalAlpha = isWood ? 0.40 : 0.44;
  bdEllipse(g, 0, radius * 0.12, rx, ry, ground, { litW: 0.75, edge: true });
  g.restore();

  const marks = isWood ? 76 : 42;
  for (let index = 0; index < marks; index++) {
    const angle = rr(0, BD_TAU);
    const distance = Math.sqrt(rr(0, 1));
    const x = Math.cos(angle) * distance * rx * 0.92;
    const y = radius * 0.12 + Math.sin(angle) * distance * ry * 0.84;
    const pine = floor === 'needle_litter';
    g.strokeStyle = bdRgba(
      pine ? BT.TRUNK_LIT : index % 3 ? BT.STRAW : BT.SCRUB_COOL,
      rr(0.22, 0.52),
    );
    g.lineWidth = rr(0.45, 0.9);
    g.beginPath();
    g.moveTo(x - rr(0.8, 2.4), y - rr(0.2, 0.8));
    g.lineTo(x + rr(1.0, pine ? 4.6 : 2.8), y + rr(-0.4, 1.0));
    g.stroke();
  }

  if (profile.crop === 'orchard') {
    g.save();
    g.strokeStyle = bdRgba(BT.EARTH_LIGHT, 0.48);
    g.lineWidth = 1.2;
    g.setLineDash([3.5, 3]);
    for (const y of [-radius * 0.24, radius * 0.20]) {
      g.beginPath();
      g.moveTo(-radius * 0.68, y);
      g.quadraticCurveTo(0, y + radius * 0.08, radius * 0.68, y);
      g.stroke();
    }
    g.restore();
  }
}

function bdDrawDetailedWoodNode(g, res, profile, frac, rr) {
  const trees = getProductionArt('countryTrees');
  const layout = createResourceVisualLayout(res);
  const liveCount = Math.max(2, Math.round(layout.length * (0.18 + frac * 0.82)));
  const survivors = new Set([...layout]
    .sort((a, b) => a.harvestRank - b.harvestRank)
    .slice(0, liveCount));

  bdPaintResourceFloor(g, res, profile, rr);
  for (const item of layout) {
    if (!survivors.has(item)) continue;
    const width = res.radius * profile.treeWidth * item.scale;
    bdContactShadow(g, item.x, item.y + 3, width * 0.44, width * 0.72, 0.68);
  }

  for (const item of layout) {
    const local = bdRnd(((res.seed * 1000 + item.x * 41 + item.y * 67) | 0));
    if (!survivors.has(item)) {
      bdStump(g, item.x, item.y + 3, res.radius * (0.045 + item.scale * 0.018), local);
      continue;
    }
    const width = res.radius * profile.treeWidth * item.scale;
    if (!bdDrawVegetationFrame(
      g, trees, profile.treeFrame, item.x, item.y + 5, width, item.flip,
    )) {
      bdTree(
        g, item.x, item.y + 3, width * 0.31, local,
        profile.treeFrame === 2 ? 'conifer' : 'broadleaf',
      );
    }
  }

  // Forestry evidence belongs only on a wood node: split logs, a mossed
  // windfall and fresh stumps. No fruit or crop props can enter this painter.
  const bottom = res.radius * 0.58 + 12;
  bdLogPile(g, -res.radius * 0.50, bottom, res.radius * 0.34, 2, res.id + 61);
  const log = bdRamp(BMAT.LOG);
  bdBeam(
    g, log, res.radius * 0.18, bottom - 3, res.radius * 0.61, bottom + 3,
    Math.max(4, res.radius * 0.075), { cap: 'round' },
  );
  bdEllipse(
    g, res.radius * 0.61, bottom + 3, Math.max(2, res.radius * 0.038),
    Math.max(3, res.radius * 0.052), log, { litW: 0.65, edge: true },
  );
}

function bdDrawBerryGarden(g, res, frac, rr) {
  const image = getProductionArt('berryBushes');
  const bottom = res.radius * 0.54 + 10;
  const maxWidth = res.radius * 3.15;
  const scale = 0.84 + frac * 0.16;
  const width = maxWidth * scale;
  if (image) {
    const height = width * image.naturalHeight / image.naturalWidth;
    bdContactShadow(g, 0, bottom - 5, width * 0.39, height * 0.38, 0.72);
    g.save();
    g.globalAlpha = 0.68 + frac * 0.32;
    bdDrawSoftOrganicStamp(g, image, -width / 2, bottom - height, width, height);
    g.restore();
  } else {
    for (let index = 0; index < 9; index++) {
      const row = Math.floor(index / 3), column = index % 3;
      bdBush(
        g,
        (column - 1) * res.radius * 0.42,
        (row - 1) * res.radius * 0.24,
        res.radius * 0.19,
        bdRnd((res.id * 97 + index * 311) | 0),
        frac > index / 12 ? '#8E2F33' : null,
      );
    }
  }
  if (frac > 0.18) {
    bdProduceBasket(g, -res.radius * 0.42, bottom + 4, 12 + res.radius * 0.07, '#8E2F33', rr);
  }
}

function bdDrawAppleOrchard(g, res, profile, frac, rr) {
  const trees = getProductionArt('countryTrees');
  const layout = createResourceVisualLayout(res);
  for (const item of layout) {
    const width = res.radius * profile.treeWidth * item.scale;
    bdContactShadow(g, item.x, item.y + 4, width * 0.42, width * 0.72, 0.64);
  }
  for (let index = 0; index < layout.length; index++) {
    const item = layout[index];
    const local = bdRnd((res.id * 193 + index * 997) | 0);
    const width = res.radius * profile.treeWidth * item.scale;
    if (!bdDrawVegetationFrame(
      g, trees, profile.treeFrame, item.x, item.y + 5, width, item.flip,
    )) {
      bdTree(g, item.x, item.y + 3, width * 0.31, local, 'broadleaf');
    }
    const fruitCount = Math.round(10 * frac);
    const apples = bdRamp(index % 2 ? '#A84434' : '#C18A34');
    for (let fruit = 0; fruit < fruitCount; fruit++) {
      const x = item.x + local(-width * 0.28, width * 0.28);
      const y = item.y - local(width * 0.28, width * 0.68);
      g.fillStyle = apples.shade;
      g.beginPath(); g.arc(x, y, local(1.55, 2.35), 0, BD_TAU); g.fill();
      g.fillStyle = apples.edge;
      g.beginPath(); g.arc(x - 0.55, y - 0.55, 0.52, 0, BD_TAU); g.fill();
    }
  }
  if (frac > 0.12) {
    bdProduceBasket(
      g, res.radius * 0.40, res.radius * 0.62 + 11,
      12 + res.radius * 0.08, '#A84434', rr,
    );
  }
}

function bdDetailedOrganicResourceSprite(res, step) {
  const profile = getResourceVisualProfile(res);
  if (!profile) return null;
  const frac = step / (BD_RES_STEPS - 1);
  const radius = res.radius;
  const box = [
    -(radius * 1.95 + 54),
    -(radius * 1.75 + 80),
    (radius * 1.95 + 54) * 2,
    radius * 3 + 140,
  ];
  const rr = bdRnd((res.seed * 1000) | 0);
  return bdBake(box, BD_RES_SCALE, function (g) {
    if (profile.type === 'wood') {
      bdDrawDetailedWoodNode(g, res, profile, frac, rr);
    } else {
      bdPaintResourceFloor(g, res, profile, rr);
      if (profile.crop === 'orchard') bdDrawAppleOrchard(g, res, profile, frac, rr);
      else bdDrawBerryGarden(g, res, frac, rr);
    }
    bdPassSurfacePatina(g, box, (res.seed * 97 + step * 13) | 0);
  });
}

function bdProduceBasket(g, cx, yBot, w, fruitHex, rr) {
  const B = bdRamp(BMAT.SHINGLE);
  const F = bdRamp(fruitHex);
  bdContactShadow(g, cx, yBot + 1, w * 0.65, w * 0.30, 0.55);
  bdPoly(g, [
    cx - w * 0.50, yBot - w * 0.12,
    cx - w * 0.34, yBot - w * 0.44,
    cx + w * 0.34, yBot - w * 0.44,
    cx + w * 0.50, yBot - w * 0.12,
    cx + w * 0.38, yBot,
    cx - w * 0.38, yBot,
  ], B, { litW: 0.7, edge: true });
  g.strokeStyle = bdRgba(B.shade, 0.70);
  g.lineWidth = 0.85;
  g.beginPath();
  g.arc(cx, yBot - w * 0.43, w * 0.36, Math.PI * 1.05, Math.PI * 1.95);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const x = cx + rr(-w * 0.30, w * 0.30);
    const y = yBot - rr(w * 0.20, w * 0.43);
    g.fillStyle = F.shade;
    g.beginPath(); g.arc(x, y, rr(1.0, 1.8), 0, BD_TAU); g.fill();
    g.fillStyle = F.edge;
    g.beginPath(); g.arc(x + bdSUN.x * 0.5, y + bdSUN.y * 0.5, 0.45, 0, BD_TAU); g.fill();
  }
}

function bdProductionResourceSprite(res, step, image, art) {
  const frac = step / (BD_RES_STEPS - 1);
  const maxW = res.radius * art.widthK;
  const maxH = maxW * image.naturalHeight / image.naturalWidth;
  const bottom = res.radius * 0.62 + 12;
  const box = [-maxW / 2 - 34, bottom - maxH - 36, maxW + 68, maxH + 104];
  const scale = 0.58 + frac * 0.42;
  const width = maxW * scale;
  const height = maxH * scale;
  const left = -width / 2;
  const top = bottom - height;
  const rr = bdRnd((res.seed * 1000) | 0);

  return bdBake(box, BD_RES_SCALE, function (g) {
    g.save();
    g.globalAlpha = 0.76 + frac * 0.24;
    if ((((res.seed * 17) | 0) & 1) === 1) {
      g.translate(width / 2, 0);
      g.scale(-1, 1);
      g.drawImage(image, 0, top, width, height);
    } else {
      g.drawImage(image, left, top, width, height);
    }
    g.restore();

    // The cluster contracts as it is gathered. Persistent stumps and quarry
    // scars keep depletion physical rather than turning it into transparency.
    const removed = Math.round((1 - frac) * 8);
    for (let i = 0; i < removed; i++) {
      const x = rr(-maxW * 0.36, maxW * 0.36);
      const y = bottom + rr(-8, 6);
      g.fillStyle = bdRgba(BT.EARTH_DARK, 0.30 + (1 - frac) * 0.24);
      g.beginPath();
      g.ellipse(x, y, rr(5, 11), rr(2.2, 4.8), rr(-0.3, 0.3), 0, BD_TAU);
      g.fill();
    }

    g.save();
    g.globalCompositeOperation = 'destination-over';
    bdContactShadow(g, 0, bottom - 5, maxW * 0.38, maxH * 0.24, 0.62);
    g.restore();
  });
}

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

  if (res.type === 'wood' || res.type === 'food') {
    const organic = bdDetailedOrganicResourceSprite(res, step);
    bdResourceCache.set(res.id, { step: step, s: organic });
    return organic;
  }

  const art = BD_RESOURCE_ART[res.type];
  const image = art ? getProductionArt(art.key) : null;
  if (image) {
    const production = bdProductionResourceSprite(res, step, image, art);
    bdResourceCache.set(res.id, { step: step, s: production });
    return production;
  }

  const r = res.radius;
  const box = [-(r * 0.86 + 42), -(r * 0.52 + 76), (r * 0.86 + 42) * 2, r * 1.04 + 76 + 46];
  const frac = step / (BD_RES_STEPS - 1);

  const s = bdBake(box, BD_RES_SCALE, function (g) {
    // Seeded from the node's own seed, so props keep their positions across
    // every depletion step and only their COUNT changes.
    const rr = bdRnd((res.seed * 1000) | 0);
    const full = 15;
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
      const gold = res.type === 'gold';
      if (alive) {
        bdRock(g, p.x, p.y, 9 + p.s * 9, pr,
          gold ? bdMix(BT.ROCK, '#8A7038', 0.32) : BT.ROCK,
          gold ? '#C9A24E' : null);
      } else {
        // Worked out: a shallow scar and loose scree where the rock was.
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
    // Human-scale clues on the near edge communicate both use and scale. They
    // are sparse enough that an untouched resource still reads as landscape.
    const I = bdRamp(BMAT.IRON), timber = bdRamp(BMAT.TIMBER);
    bdBeam(g, timber, -r * 0.52, r * 0.40, -r * 0.37, r * 0.18, 2.0, { cap: 'butt' });
    bdPoly(g, [-r * 0.41, r * 0.17, -r * 0.31, r * 0.19,
      -r * 0.33, r * 0.24, -r * 0.43, r * 0.22], I, { litW: 0.55, edge: true });
    bdCrate(g, r * 0.40, r * 0.43, 12, 9, (res.seed * 59) | 0);
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
 * Construction stays immediate-mode around one cached building blit. The
 * finished sprite is revealed from the footing upward, so every site inherits
 * the real building's silhouette, masonry, glazing and nation-specific depth
 * instead of temporarily becoming the same generic timber hut. Scaffolding,
 * survey work and material piles remain live because their height and volume
 * communicate continuous progress without creating a cache per percentage.
 */
function bdConstructionSprite(building, nation, worldTime) {
  const def = BUILDING_TYPES[building.type];
  if (!def) return null;
  if (building.type === 'farm') {
    const stage = building.progress > 0.88 ? 2 : building.progress > 0.58 ? 1 : 0;
    return bdFarmSprite(def, building.side, stage);
  }

  const nat = NATIONS[nation] || NATIONS.england;
  const variants = BD_VARIANTS[building.type] || 1;
  const variant = Number.isInteger(building.visualVariant)
    ? ((building.visualVariant % variants) + variants) % variants
    : ((building.id % variants) + variants) % variants;
  const animFrame = building.type === 'mill'
    ? Math.floor(((worldTime || 0) * 0.18 + building.id * 0.17) * BD_MILL_FRAMES) % BD_MILL_FRAMES
    : 0;
  return bdBuildingSprite(
    building.type, def, building.side, nation, nat.roof, variant, 0, animFrame,
  );
}

function bdDrawConstructionReveal(g, building, sprite, structureTop, structureBottom) {
  if (!sprite) return;
  const p = bdClamp(building.progress, 0, 1);
  const shellProgress = bdClamp((p - 0.08) / 0.86, 0, 1);
  if (shellProgress <= 0) return;

  const eased = Math.pow(shellProgress, 0.82);
  const revealTop = structureBottom - (structureBottom - structureTop) * eased;
  g.save();
  g.beginPath();
  g.rect(sprite.x, revealTop, sprite.w, structureBottom - revealTop + 2.5);
  g.clip();
  g.globalAlpha = 0.82 + shellProgress * 0.18;
  g.drawImage(sprite.c, sprite.x, sprite.y, sprite.w, sprite.h);
  g.restore();

  // The active lift line hides the hard reveal edge and reads as a wall plate
  // or masonry working course rather than a sprite wipe.
  if (shellProgress < 0.985) {
    const course = bdRamp(
      building.type === 'tower' || building.type === 'castle'
        || building.type === 'mine' || building.type === 'foundry'
        ? BMAT.STONE_ROUGH
        : BMAT.TIMBER,
    );
    const half = building.w * (0.28 + shellProgress * 0.13);
    bdBeam(g, course, -half, revealTop + 0.8, half, revealTop + 0.8, 2.1, { cap: 'butt' });
  }
}

function bdDrawConstructionScaffold(g, building, structureTop, structureBottom, progress = building.progress) {
  const p = bdClamp(progress, 0, 1);
  const w = building.w;
  const targetH = Math.max(24, structureBottom - structureTop);
  const scaffoldFraction = bdClamp(0.20 + p * 1.08, 0.20, 1);
  const top = structureBottom - targetH * scaffoldFraction;
  const frontL = -w * 0.46 - 6;
  const frontR = w * 0.46 + 6;
  const depth = Math.max(8, w * 0.13);
  const rise = depth * 0.46;
  const rearR = frontR + depth;
  const rearBase = structureBottom - rise;
  const rearTop = top - rise;
  const S = bdRamp(bdMix(BT.TRUNK, BMAT.TIMBER, 0.38));
  const Pl = bdRamp(BMAT.SHINGLE);

  // The receding right-hand scaffold plane gives the site the same oblique
  // volume as the finished architecture instead of a flat ladder silhouette.
  bdBeam(g, S, rearR, rearBase + 4, rearR, rearTop, 2.35, { cap: 'butt' });
  bdBeam(g, S, frontR, structureBottom + 4, rearR, rearBase + 4, 2.0, { cap: 'butt' });
  bdBeam(g, S, frontR, top, rearR, rearTop, 2.0, { cap: 'butt' });
  bdBeam(g, S, frontR, structureBottom, rearR, rearTop, 1.65, { cap: 'butt' });

  for (const x of [frontL, frontR]) {
    bdBeam(g, S, x, structureBottom + 5, x, top, 2.65, { cap: 'butt' });
  }

  const levels = targetH > 155 ? 4 : targetH > 92 ? 3 : 2;
  for (let i = 1; i <= levels; i++) {
    const t = i / (levels + 0.35);
    const y = structureBottom - (structureBottom - top) * t;
    const sy = y - rise * t;
    bdBeam(g, S, frontL - 1, y, frontR + 1, y, 2.05, { cap: 'butt' });
    bdBeam(g, S, frontR, y, rearR, sy, 1.8, { cap: 'butt' });

    // Planks have a visible upper plane and a dark outer edge. Alternating
    // widths prevent the repeated horizontal bars from reading as an icon.
    if (i > 1 || levels === 2) {
      const inset = i % 2 ? 7 : 13;
      bdPoly(g, [frontL + inset, y - 2.7, frontR - 2, y - 2.7,
        rearR - 3, sy - 2.7, frontL + inset + depth * 0.35, y - 2.7 - rise * 0.35],
      Pl, { litW: 0.65, edge: true, edgeW: 0.38, shadeY: 0.58 });
      g.fillStyle = Pl.shade;
      g.fillRect(frontL + inset, y - 0.8, frontR - frontL - inset - 2, 1.35);
    }
  }

  // Crossing braces and a working ladder break the boxy grid and provide a
  // human scale beside tall civic and defensive construction.
  bdBeam(g, S, frontL, structureBottom - 1, frontR, top + (structureBottom - top) * 0.15,
    1.75, { cap: 'butt' });
  if (targetH > 76) {
    const ladderL = frontL + 8;
    const ladderR = ladderL + 7;
    const ladderTop = Math.max(top + 5, structureBottom - Math.min(targetH * 0.72, 82));
    bdBeam(g, S, ladderL, structureBottom + 2, ladderL + 4, ladderTop, 1.25, { cap: 'butt' });
    bdBeam(g, S, ladderR, structureBottom + 2, ladderR + 4, ladderTop, 1.25, { cap: 'butt' });
    const rungs = Math.max(3, Math.floor((structureBottom - ladderTop) / 7));
    for (let i = 1; i < rungs; i++) {
      const t = i / rungs;
      const y = structureBottom + 2 + (ladderTop - structureBottom - 2) * t;
      bdBeam(g, S, ladderL + 4 * t, y, ladderR + 4 * t, y, 0.9, { cap: 'butt' });
    }
  }

  // Rope lashings make the joins read as assembled timber, not clean vector
  // intersections. They use the canvas stroke rather than more filled boxes.
  g.save();
  g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.72);
  g.lineWidth = 0.72;
  for (const x of [frontL, frontR]) {
    for (let i = 1; i <= levels; i++) {
      const t = i / (levels + 0.35);
      const y = structureBottom - (structureBottom - top) * t;
      g.beginPath();
      g.ellipse(x, y, 2.15, 1.05, -0.28, 0, BD_TAU);
      g.stroke();
    }
  }
  g.restore();
}

function bdDrawRepairOverlay(building, worldTime) {
  if (!building.repairing || building.repairProgress >= 1) return;
  const p = bdClamp(building.repairProgress || 0, 0, 1);
  const structureBottom = building.h * 0.40 + 3;
  const structureTop = -(building.h * 0.5
    + (BD_TOP_EXTRA[building.type] || building.h * 0.75)) + 18;
  const height = Math.max(24, structureBottom - structureTop);
  const workingY = structureBottom - height * (0.14 + p * 0.80);
  const masonry = building.type === 'tower' || building.type === 'castle' || building.type === 'mine'
    || building.type === 'foundry' || building.type === 'town_center'
    || isFortificationType(building.type) || building.type === 'wall_stairs';
  const course = bdRamp(masonry ? BMAT.STONE_ROUGH : BMAT.TIMBER);

  ctx.save();
  ctx.globalAlpha = 0.92 - p * 0.46;
  bdDrawConstructionScaffold(ctx, building, structureTop, structureBottom, 1);
  bdBeam(
    ctx,
    course,
    -building.w * 0.43,
    workingY,
    building.w * 0.43,
    workingY,
    2.5,
    { cap: 'butt' },
  );

  // Small lime-and-dust motes climb with the active course. The intact sprite
  // underneath changes damage stages as HP returns, so the building visibly
  // closes up while this temporary worksite fades away.
  const phase = (worldTime || 0) * 2.2 + building.id * 0.17;
  ctx.fillStyle = bdRgba(masonry ? BT.ROCK_LIGHT : BT.STRAW_LIGHT, 0.58);
  for (let index = 0; index < 3; index++) {
    const x = Math.sin(phase + index * 2.1) * building.w * (0.16 + index * 0.04);
    const y = workingY - 4 - ((phase * 5 + index * 9) % 14);
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + index * 0.28, 0, BD_TAU);
    ctx.fill();
  }
  ctx.restore();
}

function bdDrawFarmFoundation(g, building, sprite) {
  const p = bdClamp(building.progress, 0, 1);
  const w = building.w, h = building.h;
  const hw = w * 0.5, hh = h * 0.5;
  const worked = bdClamp((p - 0.04) / 0.90, 0, 1);

  if (sprite && worked > 0) {
    const left = -hw - 12;
    const right = hw + 12;
    g.save();
    g.beginPath();
    g.rect(left, sprite.y, (right - left) * worked, sprite.h);
    g.clip();
    g.globalAlpha = 0.88 + worked * 0.12;
    g.drawImage(sprite.c, sprite.x, sprite.y, sprite.w, sprite.h);
    g.restore();
  }

  // Survey stakes, taut cord, a staged rail stack and a plough trace describe
  // field construction without erecting the house-like scaffold farms used to
  // inherit from every other building.
  const T = bdRamp(BMAT.TIMBER);
  const cord = bdRgba(BT.STRAW_LIGHT, 0.72);
  const stakes = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ];
  for (const [x, y] of stakes) bdBeam(g, T, x, y + 3, x, y - 6, 1.45, { cap: 'butt' });
  g.save();
  g.strokeStyle = cord;
  g.lineWidth = 0.65;
  g.setLineDash([3, 2]);
  g.strokeRect(-hw, -hh - 4, w, h + 4);
  g.restore();

  const railY = hh + 8;
  const rails = Math.max(1, Math.round((1 - p) * 5));
  for (let i = 0; i < rails; i++) {
    bdBeam(g, T, hw * 0.15 - i * 1.2, railY - i * 2.5,
      hw * 0.80 - i * 0.8, railY - i * 3.0, 2.0, { cap: 'butt' });
  }
  if (worked > 0.08 && worked < 0.98) {
    const x = -hw + w * worked;
    const I = bdRamp(BMAT.IRON);
    bdBeam(g, T, x - 7, hh * 0.48, x + 3, hh * 0.28, 1.6, { cap: 'butt' });
    bdPoly(g, [x + 1, hh * 0.23, x + 9, hh * 0.28, x + 7, hh * 0.35, x - 1, hh * 0.30],
      I, { litW: 0.5, edge: true });
  }

  bdBanner(g, -hw + 5, -hh + 6, 20, building.side,
    { w: 12, h: 9, dir: building.side === 0 ? 1 : -1 });
}

function bdDrawFortificationFoundation(g, building, world) {
  const def = BUILDING_TYPES[building.type];
  const axis = fortificationAxis(building.orientation);
  const normal = { x: -axis.y, y: axis.x };
  const halfLength = def.w * 0.5, halfThickness = def.h * 0.5;
  const earth = bdRamp(bdLawful(BT.EARTH));
  const timber = bdRamp(BMAT.TIMBER);
  const corners = [
    bdFortPoint(axis, normal, -halfLength - 3, -halfThickness - 2, 0),
    bdFortPoint(axis, normal, halfLength + 3, -halfThickness - 2, 0),
    bdFortPoint(axis, normal, halfLength + 3, halfThickness + 3, 0),
    bdFortPoint(axis, normal, -halfLength - 3, halfThickness + 3, 0),
  ];

  bdPoly(g, bdFortFlat(corners), earth, {
    fill: bdLawful(BT.EARTH_DARK), lineW: 1.1, litW: 0.8, edge: true,
  });
  g.save();
  g.strokeStyle = bdRgba(BT.STRAW_LIGHT, 0.76);
  g.lineWidth = 0.62;
  g.setLineDash([3, 2]);
  g.beginPath(); g.moveTo(corners[0].x, corners[0].y);
  for (let index = 1; index < corners.length; index++) g.lineTo(corners[index].x, corners[index].y);
  g.closePath(); g.stroke();
  g.restore();
  for (const corner of corners) {
    bdBeam(g, timber, corner.x, corner.y + 2, corner.x, corner.y - 6, 1.25, { cap: 'butt' });
  }

  // The modelled wall rises course by course, with its own foreground scaffold,
  // centering frame, hoist, ladder, lashings and unconsumed stone stock.
  bdPaintFortification(
    g,
    building.type,
    building.side,
    building.orientation,
    building.progress,
    (building.id * 2654435761) | 0,
    true,
    bdJoinedFortificationEnds(building, world, true),
  );
}

function drawFoundation(building, nation, worldTime, world) {
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
  const rr = bdRnd(base);                    // the earth pad and spoil only
  const rrFoot = bdRnd(base ^ 0x5bf03635);   // footing stones
  const rrPile = bdRnd(base ^ 0x165667b1);   // material pile
  const g = ctx;
  if (building.type === 'wall_stairs') {
    bdPaintWallStairs(g, building, building.progress, true);
    return;
  }
  if (isFortificationType(building.type)) {
    const artSpec = getArchitectureProductionArtSpec(nation);
    const constructionArt = artSpec ? getProductionArt(artSpec.fortificationConstruction) : null;
    const completedArt = artSpec ? getProductionArt(artSpec.fortifications) : null;
    const closedGateArt = artSpec ? getProductionArt(artSpec.gateClosed) : null;
    // England's rebuilt fieldstone system must be visible from the first
    // course onward, including legacy saves whose wall orientation is stored
    // as a fixed frame name. Ottoman construction retains its authored sheet.
    if (nation !== 'england' && constructionArt && usesFixedFortificationFrameArt(building)) {
      bdDrawProductionFortificationConstruction(
        g, building, constructionArt, completedArt, closedGateArt,
      );
      return;
    }
    bdDrawFortificationFoundation(g, building, world);
    return;
  }
  const sprite = bdConstructionSprite(building, nation, worldTime);

  if (building.type === 'farm') {
    bdDrawFarmFoundation(g, building, sprite);
    return;
  }

  const artSpec = getArchitectureProductionArtSpec(nation);
  const constructionArt = artSpec ? getProductionArt(artSpec.construction) : null;
  if (constructionArt) {
    const finish = sprite && p > 0.84 ? bdClamp((p - 0.84) / 0.16, 0, 1) : 0;
    bdDrawConstructionSheet(g, constructionArt, building, nation, 1 - finish);
    if (sprite && finish > 0) {
      g.save();
      g.globalAlpha = finish;
      g.drawImage(sprite.c, sprite.x, sprite.y, sprite.w, sprite.h);
      g.restore();
    }
    const artWidth = bdTargetConstructionArtWidth(building, nation);
    const bannerTop = building.h * 0.46 + 15 - artWidth * 0.82;
    bdBanner(g, -artWidth * 0.39, bannerTop, Math.max(16, building.h * 0.18), building.side,
      { w: 11, h: 8, dir: building.side === 0 ? -1 : 1 });
    return;
  }

  const structureBottom = yG + 3;
  const fallbackTop = -(h * 0.5 + (BD_TOP_EXTRA[building.type] || h * 0.75)) + 18;
  const structureTop = sprite ? Math.min(structureBottom - h * 0.72, sprite.y + 18) : fallbackTop;

  // The shadow and excavation belong below every other form. Drawing the old
  // contact bed last washed a translucent violet haze over the scaffold and
  // made the whole site look like a flat cartoon decal.
  bdContactShadow(g, 0, yG + 3, hw * 1.24, h * 0.34, 0.92);

  // --- levelled and pegged-out ground: a shallow, lit excavation rather than
  // a single brown fill. The same irregular path is reused for fill and edge.
  const padPts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14 * BD_TAU;
    const ex = Math.cos(t), ey = Math.sin(t);
    const m = Math.max(Math.abs(ex), Math.abs(ey)) || 1;
    const k = 1 + rr(-0.07, 0.07);
    const px = ex / m * hw * 1.10 * k, py = ey / m * hh * 1.10 * k + yG * 0.18;
    padPts.push([px, py]);
  }
  const padPath = function (c) {
    c.moveTo(padPts[0][0], padPts[0][1]);
    for (let i = 1; i < padPts.length; i++) c.lineTo(padPts[i][0], padPts[i][1]);
    c.closePath();
  };
  bdLitPath(g, padPath, bdRamp(bdLawful(BT.EARTH)), {
    bbox: [-hw * 1.14, -hh + yG * 0.18, hw * 2.28, hh * 2.18],
    fill: bdLawful(BT.EARTH), lineW: 1.55, litW: 1.1, shadeX: 0.72, shadeY: 0.72,
  });
  for (let i = 0; i < 22; i++) {
    const x = rr(-hw * 1.02, hw * 1.02);
    const y = rr(yG - hh * 0.72, yG + hh * 0.88);
    const r = rr(0.65, 1.85);
    g.fillStyle = bdRgba(i % 3 ? BT.EARTH_DARK : BT.ROCK_LIGHT, rr(0.28, 0.52));
    g.beginPath();
    g.ellipse(x, y, r, r * rr(0.42, 0.72), rr(-0.35, 0.35), 0, BD_TAU);
    g.fill();
  }

  // The detailed real structure rises behind the working course and scaffold.
  bdDrawConstructionReveal(g, building, sprite, structureTop, structureBottom);

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
    const stone = tone > 0.6 ? bdRamp(F.lit) : tone > 0.3 ? F : bdRamp(F.shade);
    bdRect(g, q[0] - sw / 2, q[1] - sh / 2, sw, sh, stone,
      { litW: 0.55, edge: true, edgeW: 0.32, lineW: 0.55, shadeX: 0.68 });
  }

  bdDrawConstructionScaffold(g, building, structureTop, structureBottom);

  // --- MATERIAL PILE beside the site, shrinking as the work is consumed
  const remain = 1 - p;
  if (remain > 0.08) {
    const px = -hw - 20, py = yG + 6;
    const rows = Math.max(1, Math.round(remain * 3));
    bdLogPile(g, px, py, 16 * (0.5 + remain * 0.5), rows, building.id * 13);
    const masonry = building.type === 'tower' || building.type === 'castle' || building.type === 'mine'
      || building.type === 'foundry' || building.type === 'town_center';
    const pieces = Math.max(1, Math.round(remain * (masonry ? 9 : 5)));
    for (let i = 0; i < pieces; i++) {
      const x = px + 13 + (i % 3) * 5.2 + rrPile(-1.2, 1.2);
      const y = py - 2 - Math.floor(i / 3) * 4.0 + rrPile(-0.5, 0.5);
      if (masonry) {
        bdRect(g, x, y, rrPile(5.2, 7.2), rrPile(3.1, 4.4), F,
          { litW: 0.45, edge: true, edgeW: 0.3, lineW: 0.5 });
      } else {
        bdBeam(g, bdRamp(BMAT.SHINGLE), x, y, x + rrPile(9, 14), y - rrPile(0, 1.5),
          2.4, { cap: 'butt' });
      }
    }
  }

  // --- SIDE-COLOUR RIBBON on the up-left scaffold pole. A site under
  // construction is at its most vulnerable, so whose it is must be unmissable.
  const bannerTop = Math.max(structureTop, structureBottom - (structureBottom - structureTop) * bdClamp(0.20 + p * 1.08, 0.20, 1));
  bdBanner(g, -w * 0.46 - 6, bannerTop, h * 0.16, building.side,
    { w: 11, h: 8, dir: building.side === 0 ? -1 : 1 });
}

function bdFarmStage(building) {
  const def = BUILDING_TYPES.farm;
  const maxAmount = Math.max(1, def.amount || 1);
  // NOTE: createBuilding() in economy.js sets `amount` but NOT `maxAmount` on
  // buildings — only resource nodes carry maxAmount. Verified in source; the
  // ceiling has to come from BUILDING_TYPES.
  const frac = Math.max(0, Math.min(1, (building.amount || 0) / maxAmount));
  return frac > 0.66 ? 3 : frac > 0.33 ? 2 : frac > 0.04 ? 1 : 0;
}

/** FARMS — one blit of the parcel at its current crop stage. */
function drawFarm(building) {
  const def = BUILDING_TYPES.farm;
  const stage = bdFarmStage(building);
  const s = bdFarmSprite(def, building.side, stage);
  if (s) ctx.drawImage(s.c, s.x, s.y, s.w, s.h);
}

/** Near crop rows are redrawn after units so farmers stand within the wheat. */
function drawFarmForeground(building) {
  if (!building?.alive || !building.complete || building.type !== 'farm') return;
  const def = BUILDING_TYPES.farm;
  const sprite = bdFarmForegroundSprite(def, building.side, bdFarmStage(building));
  if (!sprite) return;
  ctx.drawImage(sprite.c, building.x + sprite.x, building.y + sprite.y,
    sprite.w, sprite.h);
}

/** COMPLETED BUILDINGS — one blit, plus the two live overlays. */
function bdDrawWavingBritishFlag(g, worldTime) {
  const poleX = 72;
  const poleBaseY = -94;
  const poleTopY = -170;
  const clothX = poleX + 1;
  const clothY = poleTopY + 5;
  const clothW = 32;
  const clothH = 18;
  const phase = worldTime * 2.7;
  const crest = Math.sin(phase) * 2.1;
  const tail = Math.sin(phase + 1.35) * 3.2;
  const tipX = clothX + clothW - 1.2 + Math.sin(phase * 0.73) * 1.4;

  g.save();
  const pole = g.createLinearGradient(poleX - 2, 0, poleX + 2, 0);
  pole.addColorStop(0, '#574527');
  pole.addColorStop(0.42, '#C4A664');
  pole.addColorStop(1, '#4A3822');
  g.strokeStyle = pole;
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(poleX, poleBaseY);
  g.lineTo(poleX, poleTopY);
  g.stroke();
  g.fillStyle = '#C6A763';
  g.beginPath();
  g.arc(poleX, poleTopY - 1.5, 2.1, 0, BD_TAU);
  g.fill();

  const cloth = new Path2D();
  cloth.moveTo(clothX, clothY);
  cloth.bezierCurveTo(
    clothX + clothW * 0.30, clothY + crest,
    clothX + clothW * 0.64, clothY - crest * 0.45,
    tipX, clothY + tail,
  );
  cloth.lineTo(tipX - 0.6, clothY + clothH + tail * 0.48);
  cloth.bezierCurveTo(
    clothX + clothW * 0.66, clothY + clothH - crest * 0.25,
    clothX + clothW * 0.30, clothY + clothH + crest * 0.55,
    clothX, clothY + clothH,
  );
  cloth.closePath();

  // A restrained Union flag rendered inside the moving cloth silhouette. The
  // soft edge and internal value variation keep it fabric rather than a UI icon.
  g.save();
  g.clip(cloth);
  const blue = g.createLinearGradient(clothX, clothY, tipX, clothY + clothH);
  blue.addColorStop(0, '#28395C');
  blue.addColorStop(0.55, '#314970');
  blue.addColorStop(1, '#1E2D4A');
  g.fillStyle = blue;
  g.fillRect(clothX - 2, clothY - 5, clothW + 8, clothH + 12);

  g.lineCap = 'butt';
  g.strokeStyle = 'rgba(238,232,210,0.92)';
  g.lineWidth = 4.8;
  g.beginPath();
  g.moveTo(clothX - 2, clothY - 2);
  g.lineTo(tipX + 3, clothY + clothH + 4);
  g.moveTo(clothX - 2, clothY + clothH + 3);
  g.lineTo(tipX + 3, clothY - 3);
  g.stroke();
  g.strokeStyle = '#A63A36';
  g.lineWidth = 1.7;
  g.stroke();

  g.strokeStyle = 'rgba(242,236,216,0.96)';
  g.lineWidth = 5.4;
  g.beginPath();
  g.moveTo(clothX - 2, clothY + clothH * 0.50);
  g.lineTo(tipX + 3, clothY + clothH * 0.50 + tail * 0.25);
  g.moveTo(clothX + clothW * 0.43, clothY - 3);
  g.lineTo(clothX + clothW * 0.43, clothY + clothH + 4);
  g.stroke();
  g.strokeStyle = '#A92F31';
  g.lineWidth = 2.6;
  g.stroke();

  const fold = g.createLinearGradient(clothX, 0, tipX, 0);
  fold.addColorStop(0, 'rgba(255,255,255,0.10)');
  fold.addColorStop(0.38, 'rgba(255,255,255,0.20)');
  fold.addColorStop(0.68, 'rgba(15,20,31,0.18)');
  fold.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = fold;
  g.fillRect(clothX, clothY - 4, clothW + 4, clothH + 10);
  g.restore();

  g.strokeStyle = 'rgba(235,224,193,0.48)';
  g.lineWidth = 0.6;
  g.stroke(cloth);
  g.restore();
}

function drawCompleteBuilding(building, nation, worldTime, world = null) {
  const def = BUILDING_TYPES[building.type];
  if (building.type === 'farm') { drawFarm(building); return; }

  const hpFraction = building.hp / Math.max(1, building.maxHp);
  const damageStage = hpFraction < 0.30 ? 2 : hpFraction < 0.66 ? 1 : 0;
  if (building.type === 'wall_stairs') {
    const stairs = bdWallStairSprite(building, damageStage);
    if (stairs) ctx.drawImage(stairs.c, stairs.x, stairs.y, stairs.w, stairs.h);
    return;
  }
  if (isFortificationType(building.type)) {
    const artSpec = getArchitectureProductionArtSpec(nation);
    const productionArt = artSpec ? getProductionArt(artSpec.fortifications) : null;
    const closedGateArt = artSpec ? getProductionArt(artSpec.gateClosed) : null;
    const renderProfile = getFortificationRenderProfile(building, world);
    // Never fall back to the old pale English sheet: existing saved straight
    // walls should receive the same deep masonry as newly placed curved walls.
    if (nation !== 'england' && productionArt && renderProfile.useProductionFrame) {
      bdDrawProductionFortification(ctx, building, productionArt, closedGateArt, 1);
      return;
    }
    const gateOpenProgress = building.type === 'gate'
      ? getGateOpenProgress(building, worldTime)
      : 1;
    const fortification = bdFortificationSprite(
      building,
      damageStage,
      renderProfile.joinedEnds,
      renderProfile.interiorSide,
      gateOpenProgress,
    );
    if (fortification) {
      ctx.drawImage(fortification.c, fortification.x, fortification.y,
        fortification.w, fortification.h);
    }
    return;
  }

  const nat = NATIONS[nation];
  const variants = BD_VARIANTS[building.type] || 1;
  const variant = Number.isInteger(building.visualVariant)
    ? ((building.visualVariant % variants) + variants) % variants
    : ((building.id % variants) + variants) % variants;
  const animFrame = building.type === 'mill'
    ? Math.floor(((worldTime || 0) * 0.42 + building.id * 0.17) * BD_MILL_FRAMES) % BD_MILL_FRAMES
    : 0;
  const s = bdBuildingSprite(building.type, def, building.side, nation,
    (nat && nat.roof) || BMAT.SLATE, variant, damageStage, animFrame);
  if (s) ctx.drawImage(s.c, s.x, s.y, s.w, s.h);

  bdDrawWizardPlaygroundChildren(ctx, building, worldTime || 0);

  if (building.type === 'town_center' && nation === 'england') {
    bdDrawWavingBritishFlag(ctx, worldTime || 0);
  }

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

function bdDrawFortificationJunctions(building, world) {
  if (!building.complete || !isFortificationType(building.type)) return;
  // Connected wall sprites overlap their body and walk at the exact shared
  // endpoint, so adding another pier here would reintroduce a visible break.
  if (building.type === 'wall' && bdJoinedFortificationEnds(building, world).some(Boolean)) return;
  const nation = world?.sides?.[building.side]?.nation;
  const artSpec = getArchitectureProductionArtSpec(nation);
  if (nation !== 'england' && artSpec && getProductionArt(artSpec.fortifications)
      && usesFixedFortificationFrameArt(building)) return;
  const neighbors = world.buildings.filter(candidate => candidate !== building
    && candidate.alive && candidate.complete && candidate.side === building.side
    && isFortificationType(candidate.type)
    && fortificationsShareEndpoint(building, candidate, 3.5));
  if (!neighbors.length) return;
  const axis = fortificationAxis(building.orientation);
  const normal = { x: -axis.y, y: axis.x };
  const halfThickness = building.h * 0.5;
  const height = building.type === 'gate' ? 47 : 32;
  const rough = bdRamp(BMAT.STONE_ROUGH);
  const stone = bdRamp(BMAT.STONE);
  const endpoints = fortificationEndpoints(building);

  for (const endpoint of endpoints) {
    const joined = neighbors.some(neighbor => fortificationEndpoints(neighbor)
      .some(candidate => Math.hypot(candidate.x - endpoint.x, candidate.y - endpoint.y) <= 3.5));
    if (!joined) continue;
    const along = (endpoint.x - building.x) * axis.x + (endpoint.y - building.y) * axis.y;
    bdFortBlock(ctx, axis, normal, along, 0, 7.5, halfThickness + 2.4,
      height, 0, rough, { lineW: 0.68, litW: 0.52 });
    bdFortStoneFace(ctx, axis, normal, along, halfThickness + 2.45, 7.1,
      3, height - 3, (building.id * 4099 + Math.round(along) * 131) | 0, true);
    bdFortBlock(ctx, axis, normal, along, 0, 8.2, halfThickness + 3,
      2.2, height - 0.4, stone, { lineW: 0.5, litW: 0.46 });
    for (const offset of [-4.5, 4.5]) {
      bdFortBlock(ctx, axis, normal, along + offset, 0, 1.8, halfThickness + 3.4,
        4.8, height + 1.2, rough, { lineW: 0.46, litW: 0.4 });
    }
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
  ctx.save();
  ctx.translate(resource.x, resource.y);
  ctx.rotate(-(camera.rotation || 0));
  ctx.drawImage(s.c, s.x, s.y, s.w, s.h);
  ctx.restore();
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
  const nation = world.sides[building.side].nation;

  if (building.selected) {
    ctx.strokeStyle = '#E8DCA8';
    ctx.lineWidth = 2 / camera.zoom;
    if (isFortificationType(building.type)) {
      const axis = fortificationAxis(building.orientation);
      const normal = { x: -axis.y, y: axis.x };
      const corners = [
        bdFortPoint(axis, normal, -building.w * 0.5, -building.h * 0.5, 0),
        bdFortPoint(axis, normal, building.w * 0.5, -building.h * 0.5, 0),
        bdFortPoint(axis, normal, building.w * 0.5, building.h * 0.5, 0),
        bdFortPoint(axis, normal, -building.w * 0.5, building.h * 0.5, 0),
      ];
      ctx.beginPath(); ctx.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < corners.length; index++) ctx.lineTo(corners[index].x, corners[index].y);
      ctx.closePath(); ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(0, building.h * 0.22, building.radius, building.radius * 0.48, 0, 0, BD_TAU);
      ctx.stroke();
    }
  }

  const baseRotation = building.type !== 'farm' ? -(camera.rotation || 0) : 0;
  if (baseRotation) ctx.rotate(baseRotation);
  const buildingRotation = Number.isFinite(building.rotation) ? building.rotation : 0;

  // Gameplay footprints stay compact enough for mass-army pathfinding, while
  // the painted architecture is enlarged around its contact line. Scaling
  // from the origin would push the whole building down the board; this pivot
  // keeps foundations planted and sends the added mass upward into the roof,
  // tower and rampart where it belongs.
  const presentation = getBuildingPresentation(building.type, BUILDING_TYPES[building.type], nation);
  const visualScale = presentation?.visualScale || 1;
  const visualGroundY = bdVisualGroundY(building);
  ctx.save();
  if (buildingRotation) ctx.rotate(buildingRotation);
  if (visualScale !== 1) {
    ctx.translate(0, visualGroundY);
    ctx.scale(visualScale, visualScale);
    ctx.translate(0, -visualGroundY);
  }
  if (building.complete) drawCompleteBuilding(building, nation, world.time, world);
  else drawFoundation(building, nation, world.time, world);
  if (building.complete) bdDrawRepairOverlay(building, world.time);
  bdDrawFortificationJunctions(building, world);
  ctx.restore();

  if (building.selected || building.hp < building.maxHp || !building.complete) {
    const width = Math.min(110, building.w * 0.75 * visualScale);
    const unscaledY = isFortificationType(building.type)
      ? (building.type === 'gate' ? -76 : -57)
      : building.type === 'wall_stairs' ? -68
      : -building.h * 0.82 - 10;
    const y = visualGroundY + (unscaledY - visualGroundY) * visualScale;
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

function drawBuildingCollapse(destruction, worldTime) {
  if (!destruction || destruction.duration <= 0) return;
  const progress = Math.max(0, Math.min(1, destruction.age / destruction.duration));
  const fall = Math.max(0, (progress - 0.12) / 0.88);
  const shake = Math.sin(progress * Math.PI * 16 + destruction.id) * (1 - progress) * 2.8;
  const squash = Math.max(0.18, 1 - fall * 0.82);
  const fade = progress < 0.58 ? 1 : 1 - (progress - 0.58) / 0.42;

  ctx.save();
  const presentation = getBuildingPresentation(
    destruction.type,
    BUILDING_TYPES[destruction.type],
    destruction.nation,
  );
  const visualScale = presentation?.visualScale || 1;
  const visualGroundY = bdVisualGroundY(destruction);
  ctx.translate(destruction.x + shake,
    destruction.y + fall * destruction.h * 0.12 * visualScale);
  ctx.globalAlpha = Math.max(0, fade);
  ctx.transform(1 + fall * 0.05, 0, -fall * 0.08, squash, 0,
    destruction.h * fall * 0.2 * visualScale);
  if (visualScale !== 1) {
    ctx.translate(0, visualGroundY);
    ctx.scale(visualScale, visualScale);
    ctx.translate(0, -visualGroundY);
  }
  drawCompleteBuilding(destruction, destruction.nation, worldTime);
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
  setBuildingRefs, bdResetCaches, getBuildingPresentation, getBuildingPavingLayout,
  getProductionBuildingVisibleSize, getBuildingConstructionArtWidth,
  bdConstructionArtFrame,
  drawResourceNode, drawFarm, drawFarmForeground, drawFoundation,
  drawCompleteBuilding, drawBuilding, drawBuildingCollapse,
};
