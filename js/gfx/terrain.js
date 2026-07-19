// Terrain subsystem — see gfx/README for the art bible this implements.
// Converted to an ES module: all helpers are module-scoped, so none of the
// bare names here (rnd, ramp, clamp, ...) can collide with render.js.
import { WORLD } from '../config.js';

let terrainCanvas = null;   // 0.25:1 whole-world composite (minimap + fallback)

// ===========================================================================
//  TERRAIN SUBSYSTEM — "Kriegsspiel Table": a modelled 1:72 diorama board
//  under a single warm gallery photoflood mounted up and to the left.
//
//  Everything in this file runs ONCE per battle, inside buildTerrain().
//  The only per-frame code here is drawTerrain(), which is a frustum-culled
//  set of <= ~12 nine-argument drawImage calls. Nothing else.
//
//  Replaces, in render.js:
//      function rnd(a, b)          (kept, identical)
//      function buildTerrain()     (rewritten)
//      function drawTree(g,x,y,r)  (rewritten, signature-compatible)
//
//  MEMORY REASONING (WORLD is 5200 x 3200 = 16.64 Mpx — note this is NOT the
//  4200 x 2600 the art brief assumed; every figure below is the real one):
//    * 1:1 bake = 16.64 Mpx * 4 B = 66.6 MB, held as 32 tile canvases of
//      650 x 800 world px (+2 device px bleed, so 654 x 804 = 2.1 MB each).
//      Tiling means a) Skia samples only the texels actually on screen, and
//      b) no single allocation is huge. 5200/650 = 8 and 3200/800 = 4 divide
//      exactly, so there are no partial edge tiles.
//    * MEASURED steady state: 17.87 Mpx resident = 68.2 MB
//      (32 tiles = 16.83 Mpx, plus the 1300 x 800 composite = 1.04 Mpx).
//    * MEASURED transient peak: 34.51 Mpx = 131.6 MB, during slicing, when
//      the full-size scratch and the finished tiles are both live. The
//      scratch is released (width = height = 1) immediately afterwards, and
//      the peak occurs BEFORE startBattle() allocates decalCanvas (66.6 MB)
//      and the two sprite atlases — so the peaks never coincide.
//      The 0.25:1 composite is built before the tiles so its halving chain
//      does not stack on top of that peak.
//    * Chrome's budget is ~268 Mpx total canvas area; we sit at 17.9 Mpx
//      resident. decalCanvas already costs 66.6 MB today, so both the
//      precedent and the headroom exist.
//    * terrainCanvas is retained as that 1300 x 800 (0.25:1) composite. It
//      feeds the existing minimap bake in startBattle() unchanged, and is a
//      safe whole-world fallback blit.
//    * TERRAIN_SCALE is the single knob for the degradation ladder. It is
//      deliberately LAST-but-one to be reduced: half-res terrain is the exact
//      cause of the current "blurry when zoomed" complaint. At 0.75 the bake
//      drops to 37.4 MB and the 1:1 device-pixel grain overlay (L11) keeps
//      the surface reading crisp at the 2.4x zoom ceiling.
// ===========================================================================

// ---------------------------------------------------------------------------
//  Module-level state (NEW — add these declarations to render.js)
// ---------------------------------------------------------------------------

const TERRAIN_SCALE = 1.0;      // texels per world pixel. Degradation knob.
const TILE_W = 650;             // world px — 5200 / 650 = 8 columns exactly
const TILE_H = 800;             // world px — 3200 / 800 = 4 rows    exactly
const TILE_BLEED = 2;           // device px of overlap, kills seam hairlines

let terrainTiles = null;        // [{c, wx, wy, ww, wh}] frustum-culled blits
let terrainCols = 0, terrainRows = 0;
let terrainField = null;        // Float32Array material field, WORLD/4
let terrainFieldW = 0, terrainFieldH = 0, terrainFieldStep = 4;
let terrainFeatures = null;     // { road, stream, parcels, hedges, woods }

// ---------------------------------------------------------------------------
//  Lighting model — ONE sun for the entire game. Nothing invents its own.
// ---------------------------------------------------------------------------

const SUN = {
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

// ---------------------------------------------------------------------------
//  Palette. PALETTE LAW: no ground pixel exceeds 27% HSL saturation, and
//  ground hue is confined to 24deg..96deg (earth -> straw -> turf). This is
//  an enforced invariant, not a description: it is what stops the warm post
//  grade + additive haze + grain from swallowing the troops into sepia.
//  Foliage is separated from turf by VALUE (much darker), not by hue, so the
//  green-on-green failure is avoided at the ground/tree boundary too.
// ---------------------------------------------------------------------------

const T = {
  PRIME:        '#6E7546',
  TURF_DEEP:    '#39422B',
  TURF_SHADE:   '#4B5535',
  TURF_MID:     '#77804A',
  TURF_LIT:     '#98A25C',
  TURF_DRY:     '#A8A461',
  STRAW:        '#BFA867',
  STRAW_LIGHT:  '#D6C48C',
  EARTH:        '#7A5F3E',
  EARTH_LIGHT:  '#A08059',
  EARTH_DARK:   '#4A3826',
  MUD:          '#634E33',
  ROAD_BED:     '#8A7350',
  ROAD_DUST:    '#B7A57E',
  SCRUB_COOL:   '#5E6E5C',
  ROCK:         '#8A8578',
  ROCK_LIGHT:   '#B5B0A0',
  ROCK_DARK:    '#57544B',
  WATER:        '#4A5A5E',
  WATER_DEEP:   '#33403F',
  WATER_SPEC:   '#7E959A',
  FOLIAGE_DEEP: '#25331F',
  FOLIAGE_BASE: '#37492C',
  FOLIAGE_LIT:  '#576B37',
  FOLIAGE_EDGE: '#7E8F46',
  CONIFER_DEEP: '#1E2B22',
  CONIFER_BASE: '#2C3F30',
  CONIFER_LIT:  '#44573A',
  TRUNK:        '#4A3B2C',
  TRUNK_LIT:    '#6E5940',
  TRUNK_DARK:   '#2B2118',
  BOARD_EDGE:   '#232A1C',
  VOID:         '#161A12',
};

// Grass ramps — six values each, drawn from by local material.
const TUFT_TURF  = ['#414B2C', '#4F5A33', '#616D3B', '#75824A', '#8C9A58', '#A6B26B'];
const TUFT_STRAW = ['#6E6238', '#8A7A44', '#A89253', '#C0A968', '#D2BE84', '#E2D3A2'];
const TUFT_DRY   = ['#514C31', '#63603C', '#787048', '#8C8253', '#A29562', '#B8A876'];
const FLOWERS    = ['#D9D2B0', '#C9A6B4', '#E0C878', '#BFC7D2', '#D8B9A0'];

// Calm zones: the two settlement footprints and the contested centre. Painterly
// density yields to placement legibility where the player actually builds.
const CALM_ZONES = [
  { x: 660, y: 1600, r: 820 },
  { x: 4540, y: 1600, r: 820 },
  { x: 2600, y: 1600, r: 700 },
];

// ---------------------------------------------------------------------------
//  Tiny shared utilities (redeclared so this file stands alone)
// ---------------------------------------------------------------------------

function rnd(a, b) { return a + Math.random() * (b - a); }
function rndi(a, b) { return (a + Math.random() * (b - a + 1)) | 0; }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
//  Colour arithmetic — the acrylic ramp, applied to every terrain material.
// ---------------------------------------------------------------------------

function toRGB(hex) {
  const s = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(s, 16);
  if (s.length === 3) {
    return [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17];
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  const ri = clamp(Math.round(r), 0, 255);
  const gi = clamp(Math.round(g), 0, 255);
  const bi = clamp(Math.round(b), 0, 255);
  return '#' + (0x1000000 + (ri << 16) + (gi << 8) + bi).toString(16).slice(1);
}

function mixHex(a, b, t) {
  const A = toRGB(a), B = toRGB(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

function rgba(hex, a) {
  const c = toRGB(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

function relLum(hex) {
  const c = toRGB(hex);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// Force-clamp: guarantees any lining stays at or below 58 relative luminance,
// so contrast against mid-ground survives no matter what basecoat is fed in.
function clampDark(hex, maxLum) {
  const L = relLum(hex);
  if (L <= maxLum) return hex;
  const c = toRGB(hex), k = maxLum / Math.max(1, L);
  return toHex(c[0] * k, c[1] * k, c[2] * k);
}

// The five-value acrylic ramp expanded from a single basecoat.
function ramp(base) {
  return {
    line:  clampDark(mixHex(base, '#14100C', 0.74), 58),
    shade: mixHex(base, '#1B2033', 0.42),
    base:  base,
    lit:   mixHex(base, '#FFE9BC', 0.30),
    edge:  mixHex(base, '#FFF6DE', 0.60),
  };
}

function rgbToHsl(r, g, b) {
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

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(h, s, l) {
  h = ((h % 1) + 1) % 1;
  s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (s === 0) return toHex(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return toHex(hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255);
}

// Per-instance jitter, so a 300-tree wood is not 300 identical stamps.
function shiftHSL(hex, dh, ds, dl) {
  const c = toRGB(hex);
  const hsl = rgbToHsl(c[0], c[1], c[2]);
  return hslToHex(hsl[0] + dh, hsl[1] + ds, hsl[2] + dl);
}

// PALETTE LAW enforcement helper. Any ground material passes through this.
function lawful(hex) {
  const c = toRGB(hex);
  const hsl = rgbToHsl(c[0], c[1], c[2]);
  const h = clamp(hsl[0], 24 / 360, 96 / 360);
  const s = Math.min(hsl[1], 0.27);
  return hslToHex(h, s, hsl[2]);
}

// ---------------------------------------------------------------------------
//  Value noise / fBm
// ---------------------------------------------------------------------------

function ihash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = ihash(xi, yi, s), b = ihash(xi + 1, yi, s);
  const c = ihash(xi, yi + 1, s), d = ihash(xi + 1, yi + 1, s);
  const t = a + (b - a) * u;
  return t + ((c + (d - c) * u) - t) * v;
}

function fbm(x, y, seed, octaves, wl0, gain) {
  let amp = 1, sum = 0, norm = 0, wl = wl0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x / wl, y / wl, seed + i * 977);
    norm += amp;
    amp *= gain;
    wl *= 0.5;
  }
  return sum / norm;
}

// One-dimensional wobble for road widths, rut wander, furrow waviness.
function n1(t, seed) { return vnoise(t, seed * 0.371, seed) * 2 - 1; }

// ---------------------------------------------------------------------------
//  Geometry helpers
// ---------------------------------------------------------------------------

// A closed, organically irregular blob: N points on a radius-jittered circle,
// smoothed with quadraticCurveTo through segment midpoints. This is what makes
// dirt patches and field parcels read as observed rather than as ellipses.
function blobPoints(cx, cy, rx, ry, n, jitter, rot) {
  const pts = [];
  const phase = Math.random() * 100;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const k = 1 + (vnoise(Math.cos(a) * 2.2 + phase, Math.sin(a) * 2.2 + phase, 7717) * 2 - 1) * jitter;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

function smoothClosedPath(g, pts) {
  const n = pts.length;
  if (n < 3) return;
  let mx = (pts[n - 1][0] + pts[0][0]) / 2;
  let my = (pts[n - 1][1] + pts[0][1]) / 2;
  g.beginPath();
  g.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const cur = pts[i], nxt = pts[(i + 1) % n];
    g.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2);
  }
  g.closePath();
}

function smoothOpenPath(g, pts) {
  const n = pts.length;
  if (n < 2) return;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n - 1; i++) {
    g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  g.lineTo(pts[n - 1][0], pts[n - 1][1]);
}

function polyBounds(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}


function distToPolyline(pts, x, y) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((x - ax) * dx + (y - ay) * dy) / L : 0;
    t = clamp(t, 0, 1);
    const px = ax + dx * t - x, py = ay + dy * t - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Sample a cubic bezier into a dense polyline so it can be measured against.

// 0 = open battlefield (paint freely), 1 = settlement / contested centre
// (keep it calm and low-detail so placement previews and adjacency read).
function calmness(x, y) {
  let m = 0;
  for (const z of CALM_ZONES) {
    const d = Math.hypot(x - z.x, y - z.y);
    const k = 1 - smoothstep(z.r * 0.55, z.r, d);
    if (k > m) m = k;
  }
  return m;
}

// ---------------------------------------------------------------------------
//  Batched stroke accumulator. 60,000 grass tufts become ~20 stroke() calls
//  instead of 60,000 beginPath/stroke pairs. Same pixels, a fraction of the
//  bake. Chunked so no single path grows past ~4,000 segments.
// ---------------------------------------------------------------------------

function makeBatch() { return new Map(); }

function batchSeg(b, style, w, x0, y0, x1, y1) {
  const k = style + '|' + w;
  let a = b.get(k);
  if (a === undefined) { a = { style: style, w: w, pts: [] }; b.set(k, a); }
  a.pts.push(x0, y0, x1, y1);
}

function flushBatch(g, b) {
  for (const a of b.values()) {
    g.strokeStyle = a.style;
    g.lineWidth = a.w;
    const p = a.pts;
    for (let base = 0; base < p.length; base += 16000) {
      const end = Math.min(p.length, base + 16000);
      g.beginPath();
      for (let i = base; i < end; i += 4) {
        g.moveTo(p[i], p[i + 1]);
        g.lineTo(p[i + 2], p[i + 3]);
      }
      g.stroke();
    }
  }
  b.clear();
}

function makeDotBatch() { return new Map(); }

function batchDot(b, style, x, y, r) {
  let a = b.get(style);
  if (a === undefined) { a = []; b.set(style, a); }
  a.push(x, y, r);
}

function flushDotBatch(g, b) {
  for (const [style, p] of b) {
    g.fillStyle = style;
    for (let base = 0; base < p.length; base += 12000) {
      const end = Math.min(p.length, base + 12000);
      g.beginPath();
      for (let i = base; i < end; i += 3) {
        g.moveTo(p[i] + p[i + 2], p[i + 1]);
        g.arc(p[i], p[i + 1], p[i + 2], 0, 6.2831853);
      }
      g.fill();
    }
  }
  b.clear();
}

// ---------------------------------------------------------------------------
//  Contact shadow — the single construction used by every object on the board.
//  Never a flat-alpha ellipse: always a radial gradient, offset along
//  SUN.shadow, in the cool violet shadow colour.
// ---------------------------------------------------------------------------

function contactShadow(g, x, y, rx, height, strength) {
  const off = height * SUN.lenMul;
  const cx = x + SUN.shadow.x * off;
  const cy = y + SUN.shadow.y * off * 0.55;
  const R = rx * 1.5;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  grad.addColorStop(0, 'rgba(' + SUN.shadowRGB + ',' + (0.46 * strength) + ')');
  grad.addColorStop(0.55, 'rgba(' + SUN.shadowRGB + ',' + (0.20 * strength) + ')');
  grad.addColorStop(1, 'rgba(' + SUN.shadowRGB + ',0)');
  g.save();
  g.translate(cx, cy);
  g.scale(1, SUN.squash);
  g.translate(-cx, -cy);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, R, 0, 6.2831853);
  g.fill();
  g.restore();
}

// ===========================================================================
//  L1 — MATERIAL FIELD
//  6-octave fBm generated at 1/4 world resolution via ImageData, then
//  upscaled with imageSmoothingQuality 'high' and a 3px blur so region
//  boundaries are organic rather than banded. This replaces the 110
//  hard-edged giant ellipses that the user correctly called "smudges".
// ===========================================================================

function buildMaterialField(fw, fh, seed) {
  const f = new Float32Array(fw * fh);
  const step = WORLD.w / fw;
  const OCT = [
    [1024, 1.00], [512, 0.55], [256, 0.30], [128, 0.17], [64, 0.09], [32, 0.05],
  ];
  let norm = 0;
  for (let k = 0; k < OCT.length; k++) norm += OCT[k][1];
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < fh; j++) {
    const wy = j * step;
    const row = j * fw;
    for (let i = 0; i < fw; i++) {
      const wx = i * step;
      let v = 0;
      for (let k = 0; k < OCT.length; k++) {
        const wl = OCT[k][0];
        v += OCT[k][1] * vnoise(wx / wl, wy / wl, seed + k * 977);
      }
      v /= norm;
      f[row + i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  // Renormalise so the whole 0..1 range is actually used and every material
  // band gets real coverage instead of clustering around 0.5.
  const span = hi - lo || 1;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) / span;
  return f;
}

function sampleField(x, y) {
  if (!terrainField) return 0.5;
  const i = clamp((x / terrainFieldStep) | 0, 0, terrainFieldW - 1);
  const j = clamp((y / terrainFieldStep) | 0, 0, terrainFieldH - 1);
  return terrainField[j * terrainFieldW + i];
}


function paintMaterialField(g, fw, fh) {
  const scratch = document.createElement('canvas');
  scratch.width = fw; scratch.height = fh;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  const img = sg.createImageData(fw, fh);
  const d = img.data;

  // Precompute the five band colours once instead of parsing hex per pixel.
  const bands = [T.TURF_SHADE, T.TURF_MID, T.TURF_LIT, T.STRAW, T.STRAW_LIGHT].map(function (h) {
    return toRGB(lawful(h));
  });
  // Blend across each band edge so the upscale has soft, organic transitions
  // even before the blur.
  const edges = [0.30, 0.52, 0.70, 0.84];
  const feather = 0.055;

  for (let p = 0, i = 0; p < terrainField.length; p++, i += 4) {
    const n = terrainField[p];
    let bi = 0;
    while (bi < 4 && n >= edges[bi]) bi++;
    let r, gr, b;
    const c0 = bands[bi];
    // Feather toward the neighbouring band when close to an edge.
    let mixT = 0, c1 = c0;
    if (bi > 0 && n - edges[bi - 1] < feather) {
      mixT = 0.5 * (1 - (n - edges[bi - 1]) / feather);
      c1 = bands[bi - 1];
    } else if (bi < 4 && edges[bi] - n < feather) {
      mixT = 0.5 * (1 - (edges[bi] - n) / feather);
      c1 = bands[bi + 1];
    }
    r = c0[0] + (c1[0] - c0[0]) * mixT;
    gr = c0[1] + (c1[1] - c0[1]) * mixT;
    b = c0[2] + (c1[2] - c0[2]) * mixT;
    d[i] = r; d[i + 1] = gr; d[i + 2] = b; d[i + 3] = 255;
  }
  sg.putImageData(img, 0, 0);

  // Blur on the SMALL canvas (1300x800), never on the 16.6 Mpx world surface.
  const soft = document.createElement('canvas');
  soft.width = fw; soft.height = fh;
  const fg = soft.getContext('2d');
  fg.filter = 'blur(3px)';
  fg.drawImage(scratch, 0, 0);
  fg.filter = 'none';

  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(soft, 0, 0, WORLD.w, WORLD.h);

  scratch.width = 1; scratch.height = 1;
  soft.width = 1; soft.height = 1;
}

// ===========================================================================
//  L2 — PARCEL MAP
//  14-20 enclosed farmland parcels. This is the structure that makes a
//  European battlefield legible: "hold the ploughed field", "anchor on the
//  hedge". Noise is the break-up layer ON TOP of parcel geometry, never a
//  replacement for it.
// ===========================================================================

const PARCEL_KINDS = [
  { kind: 'plough', weight: 0.26 },
  { kind: 'pasture', weight: 0.26 },
  { kind: 'wheat', weight: 0.18 },
  { kind: 'fallow', weight: 0.16 },
  { kind: 'root', weight: 0.14 },
];

function pickParcelKind() {
  let r = Math.random(), acc = 0;
  for (const k of PARCEL_KINDS) {
    acc += k.weight;
    if (r <= acc) return k.kind;
  }
  return 'pasture';
}

function generateParcels() {
  const parcels = [];
  const want = rndi(15, 20);
  let guard = 0;
  while (parcels.length < want && guard++ < 900) {
    const rx = rnd(210, 470);
    const ry = rx * rnd(0.58, 1.05);
    const x = rnd(rx + 90, WORLD.w - rx - 90);
    const y = rnd(ry + 90, WORLD.h - ry - 90);
    if (calmness(x, y) > 0.34) continue;
    let clash = false;
    for (const p of parcels) {
      if (Math.hypot(p.cx - x, p.cy - y) < (p.rx + rx) * 0.82) { clash = true; break; }
    }
    if (clash) continue;
    const pts = blobPoints(x, y, rx, ry, rndi(9, 14), 0.17, rnd(0, 6.283));
    parcels.push({
      cx: x, cy: y, rx: rx, ry: ry, pts: pts,
      kind: pickParcelKind(),
      ang: rnd(0, Math.PI * 2),
      seed: rnd(0, 9999),
    });
  }
  return parcels;
}

function paintParcel(g, p) {
  const b = polyBounds(p.pts);
  const R = Math.hypot(b.w, b.h) * 0.62;

  g.save();
  smoothClosedPath(g, p.pts);
  g.clip();

  if (p.kind === 'plough') paintPloughed(g, p, b, R, T.EARTH, T.EARTH_DARK, T.EARTH_LIGHT, 7);
  else if (p.kind === 'root') paintPloughed(g, p, b, R, T.MUD, T.EARTH_DARK, mixHex(T.EARTH_LIGHT, T.TURF_MID, 0.3), 11, true);
  else if (p.kind === 'wheat') paintWheat(g, p, b, R);
  else if (p.kind === 'fallow') paintFallow(g, p, b, R);
  else paintPasture(g, p, b, R);

  g.restore();

  // Parcel lip: a 1.5px sunlit crest on the up-left boundary and a soft cool
  // shadow on the down-right, so the field reads as a modelled plane with an
  // edge rather than as a painted decal.
  g.save();
  smoothClosedPath(g, p.pts);
  g.clip();
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(' + SUN.shadowRGB + ',0.16)';
  g.save();
  g.translate(SUN.shadow.x * 2.6, SUN.shadow.y * 2.6);
  smoothClosedPath(g, p.pts);
  g.stroke();
  g.restore();
  g.restore();

  // Sunlit crest on the parcel lip. Clipping to the parcel while offsetting
  // the stroke toward the sun leaves only the up-left arc visible, which is
  // the single-sided edge highlight the lighting model requires — a fully
  // closed outline would read as a drawn border instead of a lit form.
  g.save();
  smoothClosedPath(g, p.pts);
  g.clip();
  g.lineWidth = 1.4;
  g.strokeStyle = rgba(T.STRAW_LIGHT, 0.22);
  g.translate(SUN.x * 1.3, SUN.y * 1.3);
  smoothClosedPath(g, p.pts);
  g.stroke();
  g.restore();
}

function paintPloughed(g, p, b, R, soil, dark, lightC, pitch, crossRows) {
  g.fillStyle = soil;
  g.fillRect(b.x0 - 8, b.y0 - 8, b.w + 16, b.h + 16);

  // Soil mottle: broad irregular tone shifts so the earth is not a flat slab.
  for (let i = 0; i < 26; i++) {
    const mx = rnd(b.x0, b.x1), my = rnd(b.y0, b.y1);
    const pts = blobPoints(mx, my, rnd(40, 130), rnd(30, 90), 8, 0.35, rnd(0, 6.28));
    g.fillStyle = Math.random() < 0.5
      ? rgba(dark, rnd(0.10, 0.22))
      : rgba(lightC, rnd(0.08, 0.18));
    smoothClosedPath(g, pts);
    g.fill();
  }

  // Furrows. Each is a wavy polyline, not a ruled line: a dark bottom with a
  // lit ridge crest offset 1.5px toward the sun.
  g.save();
  g.translate(b.cx, b.cy);
  g.rotate(p.ang);
  const sunOffX = SUN.x * 1.5, sunOffY = SUN.y * 1.5;
  const segs = 10;
  const bottoms = makeBatch();
  const crests = makeBatch();
  for (let y = -R; y <= R; y += pitch) {
    const wob = 3.2;
    let px = -R, py = y + n1(y * 0.03, p.seed) * wob;
    for (let s = 1; s <= segs; s++) {
      const nx = -R + (2 * R) * (s / segs);
      const ny = y + n1(y * 0.03 + nx * 0.004, p.seed) * wob;
      batchSeg(bottoms, rgba(dark, 0.72), 2.4, px, py, nx, ny);
      batchSeg(crests, rgba(lightC, 0.55), 1.5, px + sunOffX, py + sunOffY, nx + sunOffX, ny + sunOffY);
      px = nx; py = ny;
    }
  }
  flushBatch(g, bottoms);
  flushBatch(g, crests);

  if (crossRows) {
    const cross = makeBatch();
    for (let x = -R; x <= R; x += pitch * 2.4) {
      batchSeg(cross, rgba(dark, 0.28), 1.6, x, -R, x, R);
    }
    flushBatch(g, cross);
    // Root-crop leaf clumps sitting in the drills.
    const dots = makeDotBatch();
    for (let i = 0; i < 900; i++) {
      const x = rnd(-R, R);
      const y = Math.round(rnd(-R, R) / pitch) * pitch;
      batchDot(dots, rgba(T.TURF_SHADE, 0.55), x, y + rnd(-1, 1), rnd(1.2, 2.6));
    }
    flushDotBatch(g, dots);
  }
  g.restore();

  // Clods and stones turned up by the plough.
  const clods = makeDotBatch();
  for (let i = 0; i < 520; i++) {
    const x = rnd(b.x0, b.x1), y = rnd(b.y0, b.y1);
    batchDot(clods, Math.random() < 0.6 ? rgba(T.EARTH_DARK, 0.5) : rgba(T.EARTH_LIGHT, 0.45), x, y, rnd(0.6, 1.8));
  }
  flushDotBatch(g, clods);
}

function paintWheat(g, p, b, R) {
  g.fillStyle = T.STRAW;
  g.fillRect(b.x0 - 8, b.y0 - 8, b.w + 16, b.h + 16);
  for (let i = 0; i < 22; i++) {
    const pts = blobPoints(rnd(b.x0, b.x1), rnd(b.y0, b.y1), rnd(50, 150), rnd(35, 100), 8, 0.34, rnd(0, 6.28));
    g.fillStyle = Math.random() < 0.5
      ? rgba(T.STRAW_LIGHT, rnd(0.12, 0.26))
      : rgba(T.TURF_DRY, rnd(0.10, 0.20));
    smoothClosedPath(g, pts);
    g.fill();
  }
  // Crop rows: alternating lit stem bands and shadow gaps.
  g.save();
  g.translate(b.cx, b.cy);
  g.rotate(p.ang);
  const rows = makeBatch();
  for (let y = -R; y <= R; y += 9) {
    let px = -R, py = y;
    for (let s = 1; s <= 8; s++) {
      const nx = -R + (2 * R) * (s / 8);
      const ny = y + n1(y * 0.02 + nx * 0.003, p.seed) * 2.6;
      batchSeg(rows, rgba(T.EARTH, 0.22), 2.2, px, py + 2.5, nx, ny + 2.5);
      batchSeg(rows, rgba(T.STRAW_LIGHT, 0.42), 2.6, px, py, nx, ny);
      px = nx; py = ny;
    }
  }
  flushBatch(g, rows);
  // Standing ears — short vertical ticks catching the key light.
  const ears = makeBatch();
  for (let i = 0; i < 5200; i++) {
    const x = rnd(-R, R), y = rnd(-R, R);
    const len = rnd(2.4, 4.6);
    const a = -Math.PI / 2 + rnd(-0.30, 0.30);
    batchSeg(ears, i % 5 === 0 ? rgba(T.STRAW_LIGHT, 0.55) : rgba('#C9B476', 0.42),
      0.8, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  flushBatch(g, ears);
  g.restore();
}

function paintFallow(g, p, b, R) {
  g.fillStyle = mixHex(T.TURF_MID, T.EARTH, 0.35);
  g.fillRect(b.x0 - 8, b.y0 - 8, b.w + 16, b.h + 16);
  for (let i = 0; i < 34; i++) {
    const pts = blobPoints(rnd(b.x0, b.x1), rnd(b.y0, b.y1), rnd(30, 120), rnd(22, 80), 9, 0.42, rnd(0, 6.28));
    const c = Math.random();
    g.fillStyle = c < 0.34 ? rgba(T.TURF_SHADE, rnd(0.14, 0.28))
      : c < 0.68 ? rgba(T.EARTH, rnd(0.10, 0.22))
        : rgba(T.STRAW, rnd(0.10, 0.20));
    smoothClosedPath(g, pts);
    g.fill();
  }
  // Weedy clumps and thistle.
  const w = makeBatch();
  for (let i = 0; i < 2600; i++) {
    const x = rnd(b.x0, b.x1), y = rnd(b.y0, b.y1);
    const a = -Math.PI / 2 + rnd(-0.7, 0.7);
    const len = rnd(2.5, 5.5);
    batchSeg(w, pick(TUFT_DRY), 0.9, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  flushBatch(g, w);
}

function paintPasture(g, p, b, R) {
  // Pasture is deliberately quiet — it is where troops will stand and must
  // not fight the figures for attention. Value variation only.
  for (let i = 0; i < 16; i++) {
    const pts = blobPoints(rnd(b.x0, b.x1), rnd(b.y0, b.y1), rnd(70, 190), rnd(50, 130), 8, 0.30, rnd(0, 6.28));
    g.fillStyle = Math.random() < 0.55
      ? rgba(T.TURF_LIT, rnd(0.08, 0.16))
      : rgba(T.TURF_SHADE, rnd(0.07, 0.14));
    smoothClosedPath(g, pts);
    g.fill();
  }
  // Grazing scars and a few bare patches where stock has trampled.
  for (let i = 0; i < 9; i++) {
    const pts = blobPoints(rnd(b.x0, b.x1), rnd(b.y0, b.y1), rnd(14, 40), rnd(10, 28), 9, 0.5, rnd(0, 6.28));
    g.fillStyle = rgba(T.EARTH, rnd(0.16, 0.30));
    smoothClosedPath(g, pts);
    g.fill();
  }
}

// ===========================================================================
//  L3 — DIRT / MUD PATCHES with organic edges (not plain ellipses)
// ===========================================================================

function paintDirtPatches(g, count) {
  for (let i = 0; i < count; i++) {
    const x = rnd(60, WORLD.w - 60), y = rnd(60, WORLD.h - 60);
    if (calmness(x, y) > 0.6) continue;
    const rx = rnd(26, 96), ry = rx * rnd(0.5, 0.95);
    const pts = blobPoints(x, y, rx, ry, rndi(10, 15), 0.42, rnd(0, 6.28));

    // Cool contact shade on the down-right side of the depression.
    g.save();
    g.translate(SUN.shadow.x * 2.2, SUN.shadow.y * 2.2);
    g.fillStyle = 'rgba(' + SUN.shadowRGB + ',0.14)';
    smoothClosedPath(g, pts);
    g.fill();
    g.restore();

    g.fillStyle = rgba(Math.random() < 0.5 ? T.EARTH : T.MUD, rnd(0.55, 0.85));
    smoothClosedPath(g, pts);
    g.fill();

    // Inner darker core, offset so it does not read as concentric.
    const inner = blobPoints(x + rnd(-6, 6), y + rnd(-4, 4), rx * 0.55, ry * 0.55, 11, 0.5, rnd(0, 6.28));
    g.fillStyle = rgba(T.EARTH_DARK, rnd(0.22, 0.42));
    smoothClosedPath(g, inner);
    g.fill();

    // Sunlit crumb rim on the up-left arc only.
    g.save();
    smoothClosedPath(g, pts);
    g.clip();
    g.lineWidth = 2.2;
    g.strokeStyle = rgba(T.EARTH_LIGHT, 0.35);
    g.translate(SUN.x * 1.6, SUN.y * 1.6);
    smoothClosedPath(g, pts);
    g.stroke();
    g.restore();

    // Grass fringing back in over the edge so the boundary is not a hard line.
    const fr = makeBatch();
    const n = pts.length;
    for (let k = 0; k < 90; k++) {
      const t = Math.random() * n;
      const a0 = pts[t | 0], a1 = pts[((t | 0) + 1) % n];
      const f = t - (t | 0);
      const px = a0[0] + (a1[0] - a0[0]) * f + rnd(-4, 4);
      const py = a0[1] + (a1[1] - a0[1]) * f + rnd(-4, 4);
      const ang = -Math.PI / 2 + rnd(-0.5, 0.5);
      const len = rnd(2, 4.6);
      batchSeg(fr, pick(TUFT_TURF), 0.85, px, py, px + Math.cos(ang) * len, py + Math.sin(ang) * len);
    }
    flushBatch(g, fr);
  }
}

// ===========================================================================
//  L4 — HEDGEROWS, FIELD BOUNDARIES, FENCES
// ===========================================================================

// Arc-length walker. The hedge painter samples a polyline thousands of times,
// so the cumulative-distance table is built once and binary-searched, rather
// than re-measuring the whole line per sample.
function makeWalker(pts) {
  const cum = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    cum.push(cum[i] + Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  }
  const total = cum[cum.length - 1] || 1;
  return function (t) {
    const want = clamp(t, 0, 1) * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= want) lo = mid; else hi = mid;
    }
    const seg = cum[lo + 1] - cum[lo];
    const f = seg > 0 ? (want - cum[lo]) / seg : 0;
    return {
      x: pts[lo][0] + (pts[lo + 1][0] - pts[lo][0]) * f,
      y: pts[lo][1] + (pts[lo + 1][1] - pts[lo][1]) * f,
      total: total,
    };
  };
}

function paintHedges(g, parcels, road, stream) {
  const hedges = [];
  for (const p of parcels) {
    if (Math.random() > 0.62) continue;
    // Trace part of the parcel outline, not all of it: real field boundaries
    // are broken by gates, gaps and grubbed-out sections.
    const n = p.pts.length;
    const start = rndi(0, n - 1);
    const runLen = rndi(Math.max(3, (n * 0.35) | 0), n - 1);
    const line = [];
    for (let i = 0; i <= runLen; i++) {
      const a = p.pts[(start + i) % n];
      line.push([a[0] + rnd(-6, 6), a[1] + rnd(-6, 6)]);
    }
    // Skip if it would sit on the road or the ford.
    if (distToPolyline(road, line[0][0], line[0][1]) < 60) continue;
    hedges.push({ pts: line, width: rnd(0.85, 1.25), dense: rnd(0.9, 1.4) });
  }

  // A few long independent boundaries crossing open ground for landmarks.
  for (let i = 0; i < 5; i++) {
    const x0 = rnd(300, WORLD.w - 300), y0 = rnd(240, WORLD.h - 240);
    if (calmness(x0, y0) > 0.4) continue;
    const a = rnd(0, Math.PI * 2);
    const line = [];
    let x = x0, y = y0, ang = a;
    const segs = rndi(6, 12);
    for (let s = 0; s <= segs; s++) {
      line.push([x, y]);
      ang += rnd(-0.28, 0.28);
      x += Math.cos(ang) * rnd(90, 170);
      y += Math.sin(ang) * rnd(90, 170);
      if (x < 120 || x > WORLD.w - 120 || y < 120 || y > WORLD.h - 120) break;
    }
    if (line.length > 3) hedges.push({ pts: line, width: rnd(0.9, 1.3), dense: rnd(1.0, 1.5) });
  }

  for (const h of hedges) paintHedgeFast(g, h.pts, h);
  return hedges;
}

// A hedgerow: ditch band, cast shadow, fence stakes, then a chain of
// overlapping foliage lobes with sun-facing lit lobes, an up-left-only edge
// rim, and twiggy break-up so the mass never reads as a smooth sausage.
function paintHedgeFast(g, pts, opts) {
  const dense = opts.dense || 1;
  const width = opts.width || 1;
  const walk = makeWalker(pts);
  const len = walk(1).total;

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  g.save();
  g.translate(SUN.shadow.x * 10, SUN.shadow.y * 10);
  g.strokeStyle = 'rgba(' + SUN.shadowRGB + ',0.28)';
  g.lineWidth = 15 * width;
  smoothOpenPath(g, pts);
  g.stroke();
  g.restore();

  g.save();
  g.translate(SUN.shadow.x * 5, SUN.shadow.y * 5);
  g.strokeStyle = rgba(T.TURF_DEEP, 0.60);
  g.lineWidth = 9 * width;
  smoothOpenPath(g, pts);
  g.stroke();
  g.restore();

  const stakes = makeBatch();
  for (let d = 0; d < len; d += rnd(40, 70)) {
    const q = walk(d / len);
    batchSeg(stakes, T.TRUNK, 3, q.x, q.y + 4, q.x + rnd(-0.8, 0.8), q.y - rnd(9, 15));
    batchSeg(stakes, T.TRUNK_LIT, 1, q.x - 1, q.y + 3, q.x - 1 + rnd(-0.6, 0.6), q.y - rnd(8, 13));
  }
  flushBatch(g, stakes);

  const count = Math.max(8, Math.round(len / (6 / dense)));
  // Per-lobe shiftHSL would mint a unique colour string per lobe, and the dot
  // batcher keys on colour — so every lobe would become its own single-element
  // bucket and batching would be defeated entirely. Quantise into two small
  // palettes instead: visually identical, ~14 buckets instead of ~200.
  const bodyPal = [], litPal = [];
  for (let i = 0; i < 8; i++) {
    bodyPal.push(shiftHSL(T.FOLIAGE_BASE, rnd(-0.022, 0.022), rnd(-0.03, 0.03), rnd(-0.035, 0.035)));
  }
  for (let i = 0; i < 6; i++) {
    litPal.push(shiftHSL(T.FOLIAGE_LIT, rnd(-0.02, 0.02), 0, rnd(-0.04, 0.04)));
  }
  const deep = makeDotBatch(), body = makeDotBatch(), lit = makeDotBatch(), rim = makeDotBatch();
  for (let i = 0; i < count; i++) {
    const q = walk(i / count);
    const jx = q.x + rnd(-4.5, 4.5) * width;
    const jy = q.y + rnd(-5, 4) * width;
    const r = rnd(7, 13) * width;
    batchDot(deep, T.FOLIAGE_DEEP, jx + 1.4, jy + 2.0, r);
    batchDot(body, pick(bodyPal), jx, jy, r * 0.94);
    if (Math.random() < 0.6) {
      batchDot(lit, pick(litPal), jx - 1.6 * width, jy - 2.1 * width, r * 0.56);
    }
    if (Math.random() < 0.30) {
      batchDot(rim, rgba(T.FOLIAGE_EDGE, 0.72), jx - r * 0.55, jy - r * 0.62, rnd(1.1, 2.2) * width);
    }
  }
  flushDotBatch(g, deep);
  flushDotBatch(g, body);
  flushDotBatch(g, lit);
  flushDotBatch(g, rim);

  const twigs = makeBatch();
  const tn = Math.round(count * 0.75);
  for (let i = 0; i < tn; i++) {
    const q = walk(Math.random());
    const a = rnd(-2.7, -0.4);
    const L = rnd(4, 12) * width;
    batchSeg(twigs, rgba(T.FOLIAGE_DEEP, 0.7), 1,
      q.x + rnd(-5, 5), q.y + rnd(-5, 5), q.x + Math.cos(a) * L, q.y + Math.sin(a) * L);
  }
  flushBatch(g, twigs);
  g.restore();
}

// ===========================================================================
//  L5 — THE ROAD. Opaque earth material, never a translucent stroke.
// ===========================================================================

// Chaikin corner-cutting: turns a handful of waypoints into a smooth,
// naturally-curved polyline. Four iterations is visually indistinguishable
// from a spline here and cannot overshoot the control hull.
function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

function resamplePolyline(pts, n) {
  const walk = makeWalker(pts);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const q = walk(i / n);
    out.push([q.x, q.y]);
  }
  return out;
}

function polylineYAt(pts, x) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((x >= a[0] && x <= b[0]) || (x <= a[0] && x >= b[0])) {
      const dx = b[0] - a[0];
      const t = dx !== 0 ? (x - a[0]) / dx : 0;
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

// The road is routed to CROSS the stream at a ford. A road that never meets
// the water has no reason to bend, and the crossing is the single clearest
// landmark on an otherwise open 5200x3200 field. The stream must therefore be
// built first and passed in.
function buildRoadPath(stream) {
  const fordX = WORLD.w * rnd(0.44, 0.58);
  const fordY = polylineYAt(stream, fordX);
  const wps = [
    [-60, WORLD.h * rnd(0.38, 0.44)],
    [WORLD.w * 0.12, WORLD.h * rnd(0.36, 0.44)],
    [fordX - rnd(1150, 1500), WORLD.h * rnd(0.44, 0.52)],
    [fordX - rnd(520, 700), lerp(WORLD.h * 0.50, fordY, 0.52)],
    [fordX - rnd(150, 230), lerp(WORLD.h * 0.50, fordY, 0.90)],
    [fordX, fordY],
    [fordX + rnd(150, 230), lerp(WORLD.h * 0.52, fordY, 0.90)],
    [fordX + rnd(520, 700), lerp(WORLD.h * 0.52, fordY, 0.50)],
    [fordX + rnd(1150, 1500), WORLD.h * rnd(0.42, 0.50)],
    [WORLD.w + 60, WORLD.h * rnd(0.38, 0.48)],
  ];
  return resamplePolyline(chaikin(wps, 4), 280);
}

function roadWidthAt(t, seed) {
  return 30 + 10 * n1(t * 6, seed);
}

function strokeVarying(g, pts, widthFn, style, offX, offY) {
  // Draw a variable-width band as a series of short overlapping round-capped
  // segments. Round caps mean the joins are invisible.
  g.strokeStyle = style;
  g.lineCap = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    g.lineWidth = Math.max(0.5, widthFn(t));
    g.beginPath();
    g.moveTo(pts[i][0] + offX, pts[i][1] + offY);
    g.lineTo(pts[i + 1][0] + offX, pts[i + 1][1] + offY);
    g.stroke();
  }
}

function offsetPolyline(pts, dist, wobbleSeed, wobbleAmp) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    const w = wobbleAmp ? n1(i * 0.12, wobbleSeed) * wobbleAmp : 0;
    out.push([pts[i][0] - dy * (dist + w), pts[i][1] + dx * (dist + w)]);
  }
  return out;
}

function paintRoad(g, road, seed) {
  const wf = function (t) { return roadWidthAt(t, seed); };

  g.save();
  g.lineJoin = 'round';

  // (a) Dust halo thrown out either side by traffic.
  strokeVarying(g, road, function (t) { return wf(t) + 20; }, rgba(T.ROAD_DUST, 0.11), 0, 0);
  strokeVarying(g, road, function (t) { return wf(t) + 11; }, rgba(T.ROAD_DUST, 0.13), 0, 0);

  // (b) Verge shadow offset along the sun's shadow axis.
  strokeVarying(g, road, function (t) { return wf(t) + 7; }, rgba(T.TURF_DEEP, 0.50),
    SUN.shadow.x * 2, SUN.shadow.y * 2);

  // (c) The road bed itself — solid packed earth.
  strokeVarying(g, road, wf, T.ROAD_BED, 0, 0);

  // (d) Earth mottle clipped into the road mask, so the bed is not a flat slab.
  g.save();
  g.beginPath();
  for (let i = 0; i < road.length - 1; i++) {
    // Build the clip as a fat polyline approximation.
    const t = i / (road.length - 1);
    const w = wf(t) * 0.5 + 1;
    const a = road[i], b = road[i + 1];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    g.moveTo(a[0] - dy * w, a[1] + dx * w);
    g.lineTo(b[0] - dy * w, b[1] + dx * w);
    g.lineTo(b[0] + dy * w, b[1] - dx * w);
    g.lineTo(a[0] + dy * w, a[1] - dx * w);
    g.closePath();
  }
  g.clip();
  for (let i = 0; i < 420; i++) {
    const q = road[(Math.random() * road.length) | 0];
    const pts = blobPoints(q[0] + rnd(-24, 24), q[1] + rnd(-24, 24), rnd(6, 26), rnd(4, 16), 8, 0.45, rnd(0, 6.28));
    const c = Math.random();
    g.fillStyle = c < 0.4 ? rgba(T.EARTH_DARK, rnd(0.10, 0.24))
      : c < 0.75 ? rgba(T.EARTH_LIGHT, rnd(0.10, 0.22))
        : rgba(T.MUD, rnd(0.10, 0.20));
    smoothClosedPath(g, pts);
    g.fill();
  }
  g.restore();

  // (e) Crown highlight — the road's cambered centre catching the key light.
  strokeVarying(g, road, function (t) { return wf(t) * 0.45; }, rgba(T.EARTH_LIGHT, 0.42),
    SUN.x * 1.5, SUN.y * 1.5);

  // (f) Two wheel ruts, each wandering independently, with a lit lip on the
  //     sun side. This is what makes it a rutted road rather than a stripe.
  for (const side of [-1, 1]) {
    const base = [];
    for (let i = 0; i < road.length; i++) {
      const t = i / (road.length - 1);
      const w = wf(t);
      const a = road[Math.max(0, i - 1)], b = road[Math.min(road.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L; dy /= L;
      const off = side * w * 0.26 + n1(i * 0.09, seed + (side > 0 ? 31 : 77)) * 4;
      base.push([road[i][0] - dy * off, road[i][1] + dx * off]);
    }
    g.strokeStyle = rgba('#5B4530', 0.82);
    g.lineWidth = 5;
    smoothOpenPath(g, base);
    g.stroke();
    // Lit lip on the SUN side of each rut.
    g.strokeStyle = rgba(T.TRUNK_LIT, 0.40);
    g.lineWidth = 1.2;
    g.save();
    g.translate(SUN.x * 2.2, SUN.y * 2.2);
    smoothOpenPath(g, base);
    g.stroke();
    g.restore();
    // Cool shadow inside the rut bottom.
    g.strokeStyle = 'rgba(' + SUN.shadowRGB + ',0.22)';
    g.lineWidth = 2.2;
    g.save();
    g.translate(SUN.shadow.x * 0.9, SUN.shadow.y * 0.9);
    smoothOpenPath(g, base);
    g.stroke();
    g.restore();
  }

  // Occasional third rut / hoof-worn centre track.
  const centre = offsetPolyline(road, 0, seed + 13, 3);
  g.strokeStyle = rgba(T.EARTH_DARK, 0.20);
  g.lineWidth = 3;
  smoothOpenPath(g, centre);
  g.stroke();

  // (g) Gravel and loose stone.
  const stones = makeDotBatch();
  for (let i = 0; i < 900; i++) {
    const idx = (Math.random() * (road.length - 1)) | 0;
    const t = idx / (road.length - 1);
    const w = wf(t) * 0.5;
    const a = road[idx], b = road[idx + 1];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    const off = rnd(-w, w);
    const x = a[0] - dy * off, y = a[1] + dx * off;
    const r = rnd(0.7, 2.4);
    batchDot(stones, rgba(T.ROCK_DARK, 0.5), x + 0.5, y + 0.6, r);
    batchDot(stones, Math.random() < 0.5 ? rgba(T.ROCK, 0.75) : rgba(T.ROCK_LIGHT, 0.7), x, y, r * 0.9);
  }
  flushDotBatch(g, stones);

  // (h) Edge scuffing — earth spilling irregularly into the grass, and grass
  //     encroaching back. Kills the "one clean stroke" look at the boundary.
  for (let i = 0; i < 260; i++) {
    const idx = (Math.random() * (road.length - 1)) | 0;
    const t = idx / (road.length - 1);
    const w = wf(t) * 0.5;
    const a = road[idx], b = road[idx + 1];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    const s = Math.random() < 0.5 ? -1 : 1;
    const off = s * (w + rnd(-2, 7));
    const x = a[0] - dy * off, y = a[1] + dx * off;
    const pts = blobPoints(x, y, rnd(4, 14), rnd(3, 9), 8, 0.5, rnd(0, 6.28));
    g.fillStyle = Math.random() < 0.6 ? rgba(T.EARTH, rnd(0.30, 0.6)) : rgba(T.TURF_SHADE, rnd(0.25, 0.5));
    smoothClosedPath(g, pts);
    g.fill();
  }

  // Grass fringe reclaiming the verges.
  const fringe = makeBatch();
  for (let i = 0; i < 2600; i++) {
    const idx = (Math.random() * (road.length - 1)) | 0;
    const t = idx / (road.length - 1);
    const w = wf(t) * 0.5;
    const a = road[idx], b = road[idx + 1];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    const s = Math.random() < 0.5 ? -1 : 1;
    const off = s * (w + rnd(-3, 10));
    const x = a[0] - dy * off, y = a[1] + dx * off;
    const ang = -Math.PI / 2 + rnd(-0.45, 0.45);
    const len = rnd(2.4, 5.2);
    batchSeg(fringe, pick(TUFT_DRY), 0.85, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
  }
  flushBatch(g, fringe);

  g.restore();
}

// Puddles with a sky glint on the up-left edge — small, cheap, and exactly the
// kind of specific incident that makes baked terrain look observed.
function paintPuddles(g, road, seed, near) {
  for (let i = 0; i < 26; i++) {
    let x, y;
    if (near && Math.random() < 0.6) {
      x = near.x + rnd(-190, 190);
      y = near.y + rnd(-110, 110);
    } else {
      const idx = (Math.random() * (road.length - 1)) | 0;
      x = road[idx][0] + rnd(-12, 12);
      y = road[idx][1] + rnd(-9, 9);
    }
    if (x < 30 || x > WORLD.w - 30 || y < 30 || y > WORLD.h - 30) continue;
    const rx = rnd(5, 17), ry = rx * rnd(0.34, 0.6);
    const pts = blobPoints(x, y, rx, ry, 10, 0.4, rnd(0, 6.28));

    g.fillStyle = rgba(T.EARTH_DARK, 0.55);
    smoothClosedPath(g, blobPoints(x, y, rx * 1.22, ry * 1.25, 10, 0.42, rnd(0, 6.28)));
    g.fill();

    const wg = g.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
    wg.addColorStop(0, rgba(T.WATER_SPEC, 0.85));
    wg.addColorStop(0.4, rgba(T.WATER, 0.9));
    wg.addColorStop(1, rgba(T.WATER_DEEP, 0.92));
    g.fillStyle = wg;
    smoothClosedPath(g, pts);
    g.fill();

    // Sky glint: a bright arc on the up-left edge only.
    g.save();
    smoothClosedPath(g, pts);
    g.clip();
    g.strokeStyle = 'rgba(214,226,236,0.75)';
    g.lineWidth = 1.1;
    g.translate(SUN.x * 1.1, SUN.y * 1.1);
    smoothClosedPath(g, pts);
    g.stroke();
    g.restore();
  }
}

// ===========================================================================
//  L6 — STREAM, with banks, reeds, a specular streak, and a plank bridge
//  where the road crosses. The ford is the map's clearest landmark.
// ===========================================================================

function buildStream() {
  const pts = [];
  const y0 = WORLD.h * rnd(0.68, 0.76);
  let x = -40, y = y0;
  while (x < WORLD.w + 60) {
    pts.push([x, y]);
    x += rnd(70, 130);
    y += n1(x * 0.0018, 4242) * 46 + rnd(-16, 16);
    y = clamp(y, WORLD.h * 0.60, WORLD.h * 0.90);
  }
  return pts;
}

function paintStream(g, stream, seed) {
  const wf = function (t) { return 20 + 6 * n1(t * 5, seed); };

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Cut shadow: the channel is below the board surface.
  strokeVarying(g, stream, function (t) { return wf(t) + 14; },
    'rgba(' + SUN.shadowRGB + ',0.22)', SUN.shadow.x * 2.5, SUN.shadow.y * 2.5);

  // Damp earth banks.
  strokeVarying(g, stream, function (t) { return wf(t) + 9; }, rgba(T.EARTH_DARK, 0.85), 0, 0);
  strokeVarying(g, stream, function (t) { return wf(t) + 4.5; }, rgba(T.MUD, 0.9), 0, 0);

  // Water body.
  strokeVarying(g, stream, wf, T.WATER, 0, 0);
  strokeVarying(g, stream, function (t) { return wf(t) * 0.62; }, T.WATER_DEEP, 0, 0);

  // Specular streak on the sun side.
  strokeVarying(g, stream, function (t) { return wf(t) * 0.20; }, rgba(T.WATER_SPEC, 0.75),
    SUN.x * (wf(0.5) * 0.28), SUN.y * (wf(0.5) * 0.28));

  // Ripple ticks catching light.
  // Five quantised alpha steps rather than a continuous random alpha: the
  // batcher keys on the style string, so a per-ripple alpha would produce
  // 1,500 single-element buckets and 1,500 stroke() calls.
  const rippleCols = [];
  for (let i = 0; i < 5; i++) rippleCols.push(rgba(T.WATER_SPEC, 0.16 + i * 0.065));
  const ripples = makeBatch();
  const walk = makeWalker(stream);
  const L = walk(1).total;
  for (let i = 0; i < 1500; i++) {
    const t = Math.random();
    const q = walk(t);
    const w = wf(t) * 0.5;
    const ox = rnd(-w, w) * 0.85, oy = rnd(-w, w) * 0.5;
    batchSeg(ripples, pick(rippleCols), 0.8,
      q.x + ox, q.y + oy, q.x + ox + rnd(2, 6), q.y + oy + rnd(-0.6, 0.6));
  }
  flushBatch(g, ripples);

  // Reed fringe: short vertical strokes crowding both banks.
  const reeds = makeBatch();
  for (let i = 0; i < 3400; i++) {
    const t = Math.random();
    const q = walk(t);
    const w = wf(t) * 0.5;
    const s = Math.random() < 0.5 ? -1 : 1;
    const x = q.x + rnd(-4, 4);
    const y = q.y + s * (w + rnd(0, 9));
    const len = rnd(4, 10);
    const a = -Math.PI / 2 + rnd(-0.32, 0.32);
    batchSeg(reeds, Math.random() < 0.3 ? rgba(T.STRAW, 0.7) : rgba(T.TURF_DEEP, 0.85),
      0.9, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
  }
  flushBatch(g, reeds);

  // Stones in the shallows.
  const st = makeDotBatch();
  for (let i = 0; i < 260; i++) {
    const t = Math.random();
    const q = walk(t);
    const w = wf(t) * 0.5;
    const x = q.x + rnd(-w, w), y = q.y + rnd(-w * 0.6, w * 0.6);
    const r = rnd(1, 3);
    batchDot(st, rgba(T.ROCK_DARK, 0.6), x + 0.6, y + 0.7, r);
    batchDot(st, rgba(T.ROCK, 0.7), x, y, r * 0.85);
    batchDot(st, rgba(T.ROCK_LIGHT, 0.6), x - r * 0.3, y - r * 0.35, r * 0.4);
  }
  flushDotBatch(g, st);

  g.restore();
}

function findFord(road, stream) {
  let best = Infinity, bx = 0, by = 0;
  for (let i = 0; i < road.length; i += 2) {
    const d = distToPolyline(stream, road[i][0], road[i][1]);
    if (d < best) { best = d; bx = road[i][0]; by = road[i][1]; }
  }
  return best < 260 ? { x: bx, y: by, dist: best } : null;
}

function paintBridge(g, ford, road, stream) {
  if (!ford) return;
  // Orient the bridge along the road at the crossing point.
  let idx = 0, best = Infinity;
  for (let i = 0; i < road.length; i++) {
    const d = Math.hypot(road[i][0] - ford.x, road[i][1] - ford.y);
    if (d < best) { best = d; idx = i; }
  }
  const a = road[Math.max(0, idx - 3)], b = road[Math.min(road.length - 1, idx + 3)];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);

  g.save();
  g.translate(ford.x, ford.y);
  g.rotate(ang);

  const bw = 78, bh = 40;

  // Cast shadow on the water and banks.
  g.save();
  g.translate(SUN.shadow.x * 7, SUN.shadow.y * 7);
  g.fillStyle = 'rgba(' + SUN.shadowRGB + ',0.38)';
  g.fillRect(-bw / 2, -bh / 2, bw, bh);
  g.restore();

  // Deck planks running across the span.
  const wood = ramp(T.TRUNK_LIT);
  g.fillStyle = wood.shade;
  g.fillRect(-bw / 2, -bh / 2, bw, bh);
  for (let x = -bw / 2; x < bw / 2; x += 6.5) {
    const v = Math.random();
    g.fillStyle = v < 0.34 ? wood.base : v < 0.72 ? mixHex(wood.base, wood.lit, 0.45) : wood.shade;
    g.fillRect(x, -bh / 2, 5.4, bh);
    g.fillStyle = rgba(T.TRUNK_DARK, 0.5);
    g.fillRect(x + 5.4, -bh / 2, 1.1, bh);
  }
  // Lit top-left plane of the deck.
  const dg = g.createLinearGradient(0, -bh / 2, 0, bh / 2);
  dg.addColorStop(0, rgba(wood.edge, 0.30));
  dg.addColorStop(0.45, 'rgba(0,0,0,0)');
  dg.addColorStop(1, 'rgba(' + SUN.shadowRGB + ',0.26)');
  g.fillStyle = dg;
  g.fillRect(-bw / 2, -bh / 2, bw, bh);

  // Hand rails.
  for (const s of [-1, 1]) {
    g.strokeStyle = wood.line;
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(-bw / 2 + 2, s * (bh / 2 - 1));
    g.lineTo(bw / 2 - 2, s * (bh / 2 - 1));
    g.stroke();
    g.strokeStyle = s < 0 ? wood.lit : wood.shade;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-bw / 2 + 2, s * (bh / 2 - 1) - 1);
    g.lineTo(bw / 2 - 2, s * (bh / 2 - 1) - 1);
    g.stroke();
    for (let x = -bw / 2 + 6; x < bw / 2 - 4; x += 16) {
      g.fillStyle = wood.line;
      g.fillRect(x, s * (bh / 2 - 3), 2.6, s * 4);
    }
  }
  g.restore();
}

// ===========================================================================
//  L7 — STATIC GRASS / FLOCK at 1:1. This is the layer that survives the
//  2.4x zoom ceiling. Delivered as six pre-baked tileable 512x512 tuft
//  canvases stamped in a randomised grid (6 tiles x 4 orientations = 24
//  distinct block appearances, so the repeat never reads), plus ~34,000
//  individually placed hero tufts coloured by the local material field.
// ===========================================================================

function makeTuftTile(size, ramp1, ramp2, density, seed) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  const b = makeBatch();
  const dots = makeDotBatch();
  const margin = 8;
  const n = density;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const useA = Math.random() < 0.72;
    const pal = useA ? ramp1 : ramp2;
    // Weight toward the middle of the ramp so extremes stay as accents.
    const w = Math.random();
    const gi = w < 0.10 ? 0 : w < 0.30 ? 1 : w < 0.58 ? 2 : w < 0.80 ? 3 : w < 0.94 ? 4 : 5;
    const col = pal[gi];
    const len = rnd(2.2, 4.5);
    const ang = (-100 + rnd(-22, 22)) * Math.PI / 180;
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    // Wrap near-edge tufts so the tile is genuinely seamless (and stays
    // seamless under the flips used when stamping).
    const xs = (x < margin) ? [x, x + size] : (x > size - margin) ? [x, x - size] : [x];
    const ys = (y < margin) ? [y, y + size] : (y > size - margin) ? [y, y - size] : [y];
    for (const px of xs) {
      for (const py of ys) {
        batchSeg(b, col, 0.8, px, py, px + dx, py + dy);
        if (i % 3 === 0) batchDot(dots, rgba(T.TURF_DEEP, 0.30), px, py, 0.55);
      }
    }
  }
  flushBatch(g, b);
  flushDotBatch(g, dots);
  return c;
}

function paintFlock(g) {
  const TILE = 512;
  const tiles = [
    makeTuftTile(TILE, TUFT_TURF, TUFT_DRY, 6200, 1),
    makeTuftTile(TILE, TUFT_TURF, TUFT_TURF, 7400, 2),
    makeTuftTile(TILE, TUFT_DRY, TUFT_STRAW, 5600, 3),
    makeTuftTile(TILE, TUFT_TURF, TUFT_STRAW, 6600, 4),
    makeTuftTile(TILE, TUFT_STRAW, TUFT_DRY, 5200, 5),
    makeTuftTile(TILE, TUFT_TURF, TUFT_DRY, 7000, 6),
  ];

  const cols = Math.ceil(WORLD.w / TILE);
  const rows = Math.ceil(WORLD.h / TILE);
  g.save();
  g.globalAlpha = 0.86;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const t = tiles[(Math.random() * tiles.length) | 0];
      const fx = Math.random() < 0.5 ? 1 : -1;
      const fy = Math.random() < 0.5 ? 1 : -1;
      g.save();
      g.translate(i * TILE + (fx < 0 ? TILE : 0), j * TILE + (fy < 0 ? TILE : 0));
      g.scale(fx, fy);
      g.drawImage(t, 0, 0);
      g.restore();
    }
  }
  g.restore();

  for (const t of tiles) { t.width = 1; t.height = 1; }
}

function paintHeroTufts(g, count) {
  const b = makeBatch();
  const roots = makeDotBatch();
  const flowers = makeDotBatch();
  for (let i = 0; i < count; i++) {
    const x = Math.random() * WORLD.w;
    const y = Math.random() * WORLD.h;
    const n = sampleField(x, y);
    // Thin the accent layer over settlement ground so placement stays legible.
    if (Math.random() < calmness(x, y) * 0.45) continue;
    const pal = n > 0.80 ? TUFT_STRAW : n > 0.64 ? TUFT_DRY : TUFT_TURF;
    const w = Math.random();
    const gi = w < 0.08 ? 0 : w < 0.26 ? 1 : w < 0.54 ? 2 : w < 0.78 ? 3 : w < 0.93 ? 4 : 5;
    const len = rnd(2.6, 5.4);
    const ang = (-100 + rnd(-24, 24)) * Math.PI / 180;
    const lw = Math.random() < 0.18 ? 1.1 : 0.8;
    batchSeg(b, pal[gi], lw, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    // Blade pair: a second shorter leaf leaning the other way reads as a clump.
    if (Math.random() < 0.45) {
      const a2 = (-100 + rnd(-40, 40)) * Math.PI / 180;
      const l2 = len * rnd(0.5, 0.8);
      batchSeg(b, pal[Math.max(0, gi - 1)], 0.8, x + rnd(-0.8, 0.8), y, x + Math.cos(a2) * l2, y + Math.sin(a2) * l2);
    }
    if (i % 4 === 0) batchDot(roots, rgba(T.TURF_DEEP, 0.30), x, y, 0.6);
    if (Math.random() < 0.0026) batchDot(flowers, pick(FLOWERS), x + rnd(-1, 1), y - len * rnd(0.7, 1.0), rnd(0.7, 1.3));
  }
  flushBatch(g, b);
  flushDotBatch(g, roots);
  flushDotBatch(g, flowers);
}

// ===========================================================================
//  L8 — TREES, COPSES, BUSHES, ROCKS, SCRUB
//  drawTree keeps its (g, x, y, r) signature; a fifth optional options object
//  adds species / jitter / shadow control. All existing call sites work.
// ===========================================================================

// Foliage colour variants, built once and indexed per instance. Deriving four
// shiftHSL colours per tree would mean ~3,500 rgbToHsl/hslToHex round trips and
// as many unique colour strings across a 900-tree bake, for a variation the eye
// cannot distinguish from 16 pre-mixed sets.
let foliagePal = null;

function buildFoliagePalettes() {
  const mk = function (deepC, baseC, litC) {
    const out = [];
    for (let i = 0; i < 16; i++) {
      const h = rnd(-0.022, 0.022), sat = rnd(-0.04, 0.04), l = rnd(-0.05, 0.05);
      out.push({
        deep: shiftHSL(deepC, h, sat, l * 0.5),
        body: shiftHSL(baseC, h, sat, l),
        lit: shiftHSL(litC, h, sat, l),
        edge: shiftHSL(T.FOLIAGE_EDGE, h, sat, l),
      });
    }
    return out;
  };
  foliagePal = {
    broadleaf: mk(T.FOLIAGE_DEEP, T.FOLIAGE_BASE, T.FOLIAGE_LIT),
    conifer: mk(T.CONIFER_DEEP, T.CONIFER_BASE, T.CONIFER_LIT),
  };
}

function drawTree(g, x, y, r, opts) {
  const o = opts || {};
  if (!foliagePal) buildFoliagePalettes();
  const species = o.species || (Math.random() < 0.13 ? 'conifer' : Math.random() < 0.07 ? 'bare' : Math.random() < 0.10 ? 'poplar' : 'broadleaf');
  const variant = o.variant !== undefined ? (o.variant & 15) : ((Math.random() * 16) | 0);
  const shadow = o.shadow !== undefined ? o.shadow : true;
  const trunkH = r * (species === 'poplar' ? 1.05 : species === 'conifer' ? 0.5 : 0.72);
  const height = r * 2.1;

  // ---- cast shadow, obeying the one sun -----------------------------------
  if (shadow) {
    const off = height * SUN.lenMul;
    const sx = x + SUN.shadow.x * off;
    const sy = y + SUN.shadow.y * off * 0.62;
    const R = r * 1.35;
    const grad = g.createRadialGradient(sx, sy, r * 0.15, sx, sy, R);
    grad.addColorStop(0, 'rgba(' + SUN.shadowRGB + ',0.50)');
    grad.addColorStop(0.55, 'rgba(' + SUN.shadowRGB + ',0.26)');
    grad.addColorStop(1, 'rgba(' + SUN.shadowRGB + ',0)');
    g.save();
    g.translate(sx, sy);
    g.scale(1, SUN.squash + 0.08);
    g.translate(-sx, -sy);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(sx, sy, R, 0, 6.2831853);
    g.fill();
    g.restore();
  }

  // ---- contact / ambient-occlusion pool at the base ------------------------
  const ao = g.createRadialGradient(x, y, 0, x, y, r * 0.62);
  ao.addColorStop(0, 'rgba(' + SUN.shadowRGB + ',0.42)');
  ao.addColorStop(1, 'rgba(' + SUN.shadowRGB + ',0)');
  g.save();
  g.translate(x, y);
  g.scale(1, 0.46);
  g.translate(-x, -y);
  g.fillStyle = ao;
  g.beginPath();
  g.arc(x, y, r * 0.62, 0, 6.2831853);
  g.fill();
  g.restore();

  // ---- trunk ---------------------------------------------------------------
  const tw = Math.max(1.6, r * (species === 'poplar' ? 0.11 : 0.17));
  const trunk = ramp(T.TRUNK);
  g.fillStyle = trunk.line;
  g.fillRect(x - tw / 2 - 0.6, y - trunkH - 0.6, tw + 1.2, trunkH + 1.2);
  g.fillStyle = trunk.base;
  g.fillRect(x - tw / 2, y - trunkH, tw, trunkH);
  g.fillStyle = T.TRUNK_LIT;
  g.fillRect(x - tw / 2, y - trunkH, Math.max(0.7, tw * 0.34), trunkH);
  g.fillStyle = trunk.shade;
  g.fillRect(x + tw / 2 - Math.max(0.6, tw * 0.26), y - trunkH, Math.max(0.6, tw * 0.26), trunkH);
  // Root flare.
  g.fillStyle = trunk.shade;
  g.beginPath();
  g.moveTo(x - tw * 1.5, y + 1);
  g.lineTo(x - tw * 0.5, y - trunkH * 0.28);
  g.lineTo(x + tw * 0.5, y - trunkH * 0.28);
  g.lineTo(x + tw * 1.5, y + 1);
  g.closePath();
  g.fill();

  if (species === 'bare') {
    // Winter/dead specimen: branch structure only. A strong silhouette
    // landmark that costs almost nothing.
    g.strokeStyle = trunk.base;
    g.lineCap = 'round';
    const branches = rndi(5, 8);
    for (let i = 0; i < branches; i++) {
      const a = -Math.PI / 2 + rnd(-1.15, 1.15);
      const L = r * rnd(0.7, 1.25);
      const bx = x + Math.cos(a) * L, by = y - trunkH + Math.sin(a) * L;
      g.lineWidth = Math.max(0.9, tw * 0.45);
      g.beginPath();
      g.moveTo(x, y - trunkH);
      g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + rnd(-3, 3), y - trunkH + Math.sin(a) * L * 0.5, bx, by);
      g.stroke();
      g.lineWidth = Math.max(0.6, tw * 0.24);
      for (let k = 0; k < 2; k++) {
        const a2 = a + rnd(-0.7, 0.7);
        g.beginPath();
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(a2) * L * 0.45, by + Math.sin(a2) * L * 0.45);
        g.stroke();
      }
    }
    g.strokeStyle = T.TRUNK_LIT;
    g.lineWidth = Math.max(0.5, tw * 0.2);
    g.beginPath();
    g.moveTo(x - tw * 0.2, y - trunkH);
    g.lineTo(x - r * 0.5, y - trunkH - r * 0.7);
    g.stroke();
    return;
  }

  const isConifer = species === 'conifer';
  const set = (isConifer ? foliagePal.conifer : foliagePal.broadleaf)[variant];
  const deep = set.deep, body = set.body, lit = set.lit, edge = set.edge;

  const cy = y - trunkH - r * (isConifer ? 0.55 : 0.42);
  const squashX = species === 'poplar' ? 0.55 : 1;
  const squashY = species === 'poplar' ? 1.45 : isConifer ? 1.22 : 1;

  // Lobe layout: an irregular cluster, densest at the core.
  const lobeN = rndi(7, 11);
  const lobes = [];
  for (let i = 0; i < lobeN; i++) {
    const a = (i / lobeN) * Math.PI * 2 + rnd(-0.4, 0.4);
    const d = (i === 0 ? 0 : rnd(0.18, 0.62)) * r;
    lobes.push({
      x: cx_(x, a, d, squashX),
      y: cy + Math.sin(a) * d * squashY - (isConifer ? d * 0.3 : 0),
      r: (i === 0 ? rnd(0.62, 0.78) : rnd(0.34, 0.58)) * r,
    });
  }

  // 1. Underside / core mass.
  g.fillStyle = deep;
  for (const L of lobes) {
    g.beginPath();
    g.ellipse(L.x + r * 0.06, L.y + r * 0.09, L.r * squashX, L.r * squashY, 0, 0, 6.2831853);
    g.fill();
  }
  // 2. Body.
  g.fillStyle = body;
  for (const L of lobes) {
    g.beginPath();
    g.ellipse(L.x, L.y, L.r * 0.94 * squashX, L.r * 0.94 * squashY, 0, 0, 6.2831853);
    g.fill();
  }
  // 3. Sun-facing lobes only.
  g.fillStyle = lit;
  for (const L of lobes) {
    const rel = (L.x - x) * SUN.x + (L.y - cy) * SUN.y;
    if (rel < -r * 0.05) continue;
    g.beginPath();
    g.ellipse(L.x + SUN.x * L.r * 0.30, L.y + SUN.y * L.r * 0.30,
      L.r * 0.60 * squashX, L.r * 0.60 * squashY, 0, 0, 6.2831853);
    g.fill();
  }
  // 4. Edge light, up-left boundary only, 1px.
  g.strokeStyle = edge;
  g.lineWidth = 1.1;
  for (const L of lobes) {
    const rel = (L.x - x) * SUN.x + (L.y - cy) * SUN.y;
    if (rel < r * 0.08) continue;
    g.beginPath();
    g.ellipse(L.x + SUN.x * 0.9, L.y + SUN.y * 0.9,
      L.r * 0.92 * squashX, L.r * 0.92 * squashY,
      0, Math.PI * 0.72, Math.PI * 1.72);
    g.stroke();
  }
  // 5. Leaf-clump speckle so the canopy is not a set of smooth discs.
  const spec = makeDotBatch();
  const specN = Math.round(r * 2.6);
  for (let i = 0; i < specN; i++) {
    const L = lobes[(Math.random() * lobes.length) | 0];
    const a = Math.random() * 6.2831853;
    const d = Math.sqrt(Math.random()) * L.r * 0.92;
    const px = L.x + Math.cos(a) * d * squashX;
    const py = L.y + Math.sin(a) * d * squashY;
    const rel = (px - x) * SUN.x + (py - cy) * SUN.y;
    const col = rel > r * 0.2 ? edge : rel > -r * 0.1 ? lit : deep;
    batchDot(spec, rgba(col, rel > r * 0.2 ? 0.5 : 0.42), px, py, rnd(0.7, 1.9));
  }
  flushDotBatch(g, spec);

  // 6. Underside ambient occlusion, multiplied so it darkens rather than veils.
  g.save();
  g.globalCompositeOperation = 'multiply';
  const ug = g.createRadialGradient(
    x - SUN.x * r * 0.4, cy - SUN.y * r * 0.4, r * 0.1,
    x, cy + r * 0.35, r * 1.25);
  ug.addColorStop(0, 'rgba(255,255,255,0)');
  ug.addColorStop(0.55, 'rgba(210,214,226,0.10)');
  ug.addColorStop(1, 'rgba(120,128,152,0.42)');
  g.fillStyle = ug;
  g.beginPath();
  g.ellipse(x, cy, r * 1.3 * squashX, r * 1.3 * squashY, 0, 0, 6.2831853);
  g.fill();
  g.restore();
}

function cx_(x, a, d, sx) { return x + Math.cos(a) * d * sx; }

function drawBush(g, x, y, r) {
  contactShadow(g, x, y, r * 0.9, r * 1.4, 1);
  if (!foliagePal) buildFoliagePalettes();
  const set = foliagePal.broadleaf[(Math.random() * 16) | 0];
  const deep = set.deep, body = set.body, lit = set.lit;
  const n = rndi(4, 7);
  const lobes = [];
  for (let i = 0; i < n; i++) {
    lobes.push({
      x: x + rnd(-r * 0.6, r * 0.6),
      y: y + rnd(-r * 0.85, -r * 0.05),
      r: rnd(0.42, 0.72) * r,
    });
  }
  g.fillStyle = deep;
  for (const L of lobes) { g.beginPath(); g.arc(L.x + 0.8, L.y + 1.1, L.r, 0, 6.2831853); g.fill(); }
  g.fillStyle = body;
  for (const L of lobes) { g.beginPath(); g.arc(L.x, L.y, L.r * 0.92, 0, 6.2831853); g.fill(); }
  g.fillStyle = lit;
  for (const L of lobes) {
    if ((L.x - x) * SUN.x + (L.y - y) * SUN.y < 0) continue;
    g.beginPath(); g.arc(L.x + SUN.x * L.r * 0.28, L.y + SUN.y * L.r * 0.28, L.r * 0.55, 0, 6.2831853); g.fill();
  }
  g.strokeStyle = rgba(T.FOLIAGE_EDGE, 0.8);
  g.lineWidth = 1;
  for (const L of lobes) {
    if ((L.x - x) * SUN.x + (L.y - y) * SUN.y < r * 0.1) continue;
    g.beginPath();
    g.arc(L.x + SUN.x, L.y + SUN.y, L.r * 0.9, Math.PI * 0.72, Math.PI * 1.72);
    g.stroke();
  }
  // Bare twigs poking out of the mass.
  g.strokeStyle = rgba(T.TRUNK, 0.75);
  g.lineWidth = 0.9;
  for (let i = 0; i < 4; i++) {
    const a = rnd(-2.6, -0.5);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * r * rnd(0.8, 1.15), y + Math.sin(a) * r * rnd(0.8, 1.15));
    g.stroke();
  }
}

let rockPal = null;

function drawRock(g, x, y, r) {
  contactShadow(g, x, y, r * 1.05, r * 1.1, 1);
  if (!rockPal) {
    rockPal = [];
    for (let i = 0; i < 12; i++) {
      rockPal.push(ramp(shiftHSL(T.ROCK, rnd(-0.03, 0.03), rnd(-0.02, 0.02), rnd(-0.06, 0.06))));
    }
  }
  const R = rockPal[(Math.random() * 12) | 0];
  const n = rndi(5, 8);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.18, 0.18);
    const d = r * rnd(0.72, 1.12);
    pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d * 0.72]);
  }
  // Lining first, as a dilated silhouette.
  g.fillStyle = R.line;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1] + 1);
  for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1] + 1);
  g.closePath();
  g.fill();
  g.fillStyle = R.base;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fill();
  // Lit facet: the up-left half of the form.
  g.save();
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.clip();
  g.fillStyle = R.lit;
  g.beginPath();
  g.moveTo(x - r * 1.4, y - r * 1.4);
  g.lineTo(x + r * 1.4, y - r * 1.4);
  g.lineTo(x + r * 1.4, y - r * 0.05);
  g.lineTo(x - r * 1.4, y - r * 0.45);
  g.closePath();
  g.fill();
  g.fillStyle = R.shade;
  g.beginPath();
  g.moveTo(x - r * 1.4, y + r * 0.35);
  g.lineTo(x + r * 1.4, y + r * 0.15);
  g.lineTo(x + r * 1.4, y + r * 1.4);
  g.lineTo(x - r * 1.4, y + r * 1.4);
  g.closePath();
  g.fill();
  g.restore();
  // Extreme edge highlight on the up-left boundary only.
  g.strokeStyle = R.edge;
  g.lineWidth = 0.9;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const rel = (p[0] - x) * SUN.x + (p[1] - y) * SUN.y;
    if (rel > 0) {
      if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    } else {
      g.moveTo(p[0], p[1]);
    }
  }
  g.stroke();
  // Lichen.
  if (Math.random() < 0.6) {
    const dots = makeDotBatch();
    for (let i = 0; i < 6; i++) {
      batchDot(dots, rgba(T.SCRUB_COOL, 0.5), x + rnd(-r * 0.7, r * 0.7), y + rnd(-r * 0.5, r * 0.4), rnd(0.7, 2));
    }
    flushDotBatch(g, dots);
  }
}

function drawScrub(g, x, y, r) {
  const b = makeBatch();
  const n = Math.round(r * 2.4);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.2831853;
    const d = Math.sqrt(Math.random()) * r;
    const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.6;
    const ang = (-95 + rnd(-40, 40)) * Math.PI / 180;
    const L = rnd(3, 8);
    batchSeg(b, Math.random() < 0.4 ? T.SCRUB_COOL : T.FOLIAGE_BASE, 1,
      px, py, px + Math.cos(ang) * L, py + Math.sin(ang) * L);
  }
  flushBatch(g, b);
}

// ---- placement -------------------------------------------------------------

function placeWoods(g, road, stream, parcels) {
  const trees = [];
  const forbid = function (x, y) {
    if (x < 10 || x > WORLD.w - 10 || y < 10 || y > WORLD.h - 10) return true;
    if (calmness(x, y) > 0.30) return true;
    if (distToPolyline(road, x, y) < 60) return true;
    if (distToPolyline(stream, x, y) < 34) return true;
    return false;
  };

  const push = function (x, y, r, species) {
    if (forbid(x, y)) return;
    trees.push({ x: x, y: y, r: r, species: species });
  };

  // -- North and south treelines: dense, overlapping, irregular outer edge,
  //    darker interior, scrub at the margin. --------------------------------
  for (const edge of [0, 1]) {
    const baseY = edge === 0 ? 0 : WORLD.h;
    const dirY = edge === 0 ? 1 : -1;
    for (let x = -60; x < WORLD.w + 60; x += rnd(30, 62)) {
      // Depth of the belt wanders so the wood's edge is not a ruled line.
      const depth = 130 + n1(x * 0.0016, edge === 0 ? 31 : 61) * 82 + rnd(-24, 24);
      const rows = clamp(Math.round(depth / 48), 1, 4);
      for (let k = 0; k < rows; k++) {
        const y = baseY + dirY * (rnd(8, depth));
        const inner = k / rows;
        const r = rnd(26, 54) * (1 - inner * 0.22);
        const sp = Math.random() < 0.22 ? 'conifer' : Math.random() < 0.06 ? 'bare' : 'broadleaf';
        push(x + rnd(-24, 24), y, r, sp);
      }
    }
  }

  // -- A diagonal wood in the NE quadrant, the map's biggest landmark. ------
  {
    const ax = WORLD.w * 0.66, ay = WORLD.h * 0.10;
    const bx = WORLD.w * 0.90, by = WORLD.h * 0.40;
    for (let i = 0; i < 240; i++) {
      const t = Math.random();
      const jx = rnd(-150, 150), jy = rnd(-120, 120);
      const x = ax + (bx - ax) * t + jx;
      const y = ay + (by - ay) * t + jy;
      const edgeFade = 1 - Math.min(1, (Math.abs(jx) / 150 + Math.abs(jy) / 120) * 0.5);
      if (Math.random() > 0.35 + edgeFade * 0.6) continue;
      push(x, y, rnd(28, 58), Math.random() < 0.3 ? 'conifer' : 'broadleaf');
    }
  }

  // -- Scattered copses, avoiding the settlement footprints. ----------------
  for (let c = 0; c < 22; c++) {
    const cx = rnd(320, WORLD.w - 320);
    const cy = rnd(240, WORLD.h - 240);
    if (calmness(cx, cy) > 0.25) continue;
    const n = rndi(4, 12);
    const spread = rnd(50, 130);
    for (let i = 0; i < n; i++) {
      push(cx + rnd(-spread, spread), cy + rnd(-spread * 0.7, spread * 0.7),
        rnd(24, 46), Math.random() < 0.18 ? 'conifer' : 'broadleaf');
    }
  }

  // -- Isolated specimens as navigational landmarks. ------------------------
  for (let i = 0; i < 34; i++) {
    push(rnd(200, WORLD.w - 200), rnd(180, WORLD.h - 180),
      rnd(34, 62), Math.random() < 0.18 ? 'poplar' : Math.random() < 0.12 ? 'bare' : 'broadleaf');
  }

  // Painter's algorithm within the whole set: back to front, so every tree's
  // cast shadow is correctly overlaid by whatever stands in front of it.
  trees.sort(function (a, b) { return a.y - b.y; });
  for (const t of trees) {
    drawTree(g, t.x, t.y, t.r, { species: t.species });
  }
  return trees;
}

function placeUndergrowth(g, road, stream, trees) {
  const items = [];
  const ok = function (x, y) {
    return !(x < 12 || x > WORLD.w - 12 || y < 12 || y > WORLD.h - 12
      || calmness(x, y) > 0.5 || distToPolyline(road, x, y) < 26);
  };

  // Scrub crowding the margin of every wood.
  for (const t of trees) {
    if (Math.random() < 0.4) {
      const x = t.x + rnd(-t.r, t.r), y = t.y + rnd(2, t.r * 0.8);
      if (ok(x, y)) items.push({ k: 'scrub', x: x, y: y, r: rnd(8, 20) });
    }
  }
  // Free-standing bushes.
  for (let i = 0; i < 340; i++) {
    const x = rnd(40, WORLD.w - 40), y = rnd(40, WORLD.h - 40);
    if (!ok(x, y)) continue;
    items.push({ k: 'bush', x: x, y: y, r: rnd(7, 17) });
  }
  // Rocks and outcrops, clustered so they read as geology not confetti.
  for (let c = 0; c < 42; c++) {
    const cx = rnd(120, WORLD.w - 120), cy = rnd(120, WORLD.h - 120);
    if (!ok(cx, cy)) continue;
    const n = rndi(2, 7);
    for (let i = 0; i < n; i++) {
      const x = cx + rnd(-46, 46), y = cy + rnd(-28, 28);
      if (!ok(x, y)) continue;
      items.push({ k: 'rock', x: x, y: y, r: rnd(3.5, 13) });
    }
  }
  // Loose stones near the stream and along field edges.
  for (let i = 0; i < 260; i++) {
    const t = Math.random();
    const q = stream[(t * (stream.length - 1)) | 0];
    const x = q[0] + rnd(-70, 70), y = q[1] + rnd(-52, 52);
    if (!ok(x, y)) continue;
    items.push({ k: 'rock', x: x, y: y, r: rnd(2.5, 7) });
  }

  items.sort(function (a, b) { return a.y - b.y; });
  for (const it of items) {
    if (it.k === 'bush') drawBush(g, it.x, it.y, it.r);
    else if (it.k === 'rock') drawRock(g, it.x, it.y, it.r);
    else drawScrub(g, it.x, it.y, it.r);
  }
}

// ===========================================================================
//  L9 — BOARD AO: large-scale tonal variation with no analytic edges.
//  A low-frequency field blurred hard, multiplied for the hollows, then its
//  inverse screened for the sunlit crests. This is the "landform" read.
// ===========================================================================

function paintBoardAO(g, fw, fh, seed) {
  // 1. Raw low-frequency field.
  const lo = document.createElement('canvas');
  lo.width = fw; lo.height = fh;
  const lg = lo.getContext('2d', { willReadFrequently: true });
  const img = lg.createImageData(fw, fh);
  const d = img.data;
  const step = WORLD.w / fw;
  for (let j = 0, p = 0; j < fh; j++) {
    for (let i = 0; i < fw; i++, p += 4) {
      const v = fbm(i * step, j * step, seed, 3, 1400, 0.5);
      const c = clamp(v, 0, 1) * 255;
      d[p] = c; d[p + 1] = c; d[p + 2] = c; d[p + 3] = 255;
    }
  }
  lg.putImageData(img, 0, 0);

  // 2. Blur it hard on the SMALL canvas. 24px here becomes ~480 world px
  //    once upscaled, which is exactly the landform scale we want.
  const blurred = document.createElement('canvas');
  blurred.width = fw; blurred.height = fh;
  const bg = blurred.getContext('2d', { willReadFrequently: true });
  bg.filter = 'blur(24px)';
  bg.drawImage(lo, 0, 0);
  bg.filter = 'none';
  const bd = bg.getImageData(0, 0, fw, fh).data;

  // 3. Build the two tinted layers directly from the blurred values. Doing
  //    this arithmetically (rather than via source-in, which preserves the
  //    destination ALPHA and would flatten an opaque field to a solid colour)
  //    is the only way to get a tinted *luminance* ramp out of a grey field.
  const hollowC = document.createElement('canvas');
  hollowC.width = fw; hollowC.height = fh;
  const hc = hollowC.getContext('2d');
  const hImg = hc.createImageData(fw, fh);
  const hD = hImg.data;

  const crestC = document.createElement('canvas');
  crestC.width = fw; crestC.height = fh;
  const cc = crestC.getContext('2d');
  const cImg = cc.createImageData(fw, fh);
  const cD = cImg.data;

  const olive = toRGB(T.TURF_SHADE);   // multiply target for the hollows
  const warm = toRGB('#FFE9BC');       // screen target for the sunlit crests

  for (let p = 0; p < hD.length; p += 4) {
    const v = bd[p] / 255;             // 0 = hollow, 1 = crest
    // multiply layer: white where crest (no change), olive where hollow
    hD[p] = lerp(olive[0], 255, v);
    hD[p + 1] = lerp(olive[1], 255, v);
    hD[p + 2] = lerp(olive[2], 255, v);
    hD[p + 3] = 255;
    // screen layer: black where hollow (no change), warm key where crest
    cD[p] = warm[0] * v;
    cD[p + 1] = warm[1] * v;
    cD[p + 2] = warm[2] * v;
    cD[p + 3] = 255;
  }
  hc.putImageData(hImg, 0, 0);
  cc.putImageData(cImg, 0, 0);

  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.30;
  g.drawImage(hollowC, 0, 0, WORLD.w, WORLD.h);
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.13;
  g.drawImage(crestC, 0, 0, WORLD.w, WORLD.h);
  g.restore();

  lo.width = 1; lo.height = 1;
  blurred.width = 1; blurred.height = 1;
  hollowC.width = 1; hollowC.height = 1;
  crestC.width = 1; crestC.height = 1;
}

// ===========================================================================
//  L10 — TABLE-EDGE FALLOFF. The board falls away from the spotlight, which
//  turns the "canvas ran out" boundary into a diorama edge.
// ===========================================================================

function paintEdgeFalloff(g) {
  const D = 240;
  g.save();
  g.globalCompositeOperation = 'multiply';
  const sides = [
    [0, 0, D, 0],                       // left   -> x+
    [WORLD.w, 0, WORLD.w - D, 0],       // right  -> x-
    [0, 0, 0, D],                       // top    -> y+
    [0, WORLD.h, 0, WORLD.h - D],       // bottom -> y-
  ];
  const rects = [
    [0, 0, D, WORLD.h],
    [WORLD.w - D, 0, D, WORLD.h],
    [0, 0, WORLD.w, D],
    [0, WORLD.h - D, WORLD.w, D],
  ];
  for (let i = 0; i < 4; i++) {
    const s = sides[i];
    // multiply wants WHITE for "no change", so the ramp runs board-edge to
    // white rather than board-edge to transparent.
    const g2 = g.createLinearGradient(s[0], s[1], s[2], s[3]);
    const e = toRGB(T.BOARD_EDGE);
    g2.addColorStop(0, 'rgb(' + e[0] + ',' + e[1] + ',' + e[2] + ')');
    g2.addColorStop(0.42, 'rgb(' + Math.round(lerp(e[0], 255, 0.62)) + ',' +
      Math.round(lerp(e[1], 255, 0.62)) + ',' + Math.round(lerp(e[2], 255, 0.62)) + ')');
    g2.addColorStop(1, '#ffffff');
    g.fillStyle = g2;
    g.fillRect(rects[i][0], rects[i][1], rects[i][2], rects[i][3]);
  }
  g.restore();
}

// ===========================================================================
//  L11 — 1:1 TACTILE GRAIN. This is what makes the ground feel like flocked
//  board rather than painted paper at the 2.4x zoom ceiling. Two instances at
//  different scales/rotations so the 256px repeat never reads.
// ===========================================================================

function makeGrainTile(size, seed, contrast) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let j = 0, p = 0; j < size; j++) {
    for (let i = 0; i < size; i++, p += 4) {
      // Toroidal noise so the tile is seamless: sample a wrapped lattice.
      const a = vnoise(i * 0.5, j * 0.5, seed);
      const b = vnoise(i * 0.13, j * 0.13, seed + 71);
      const w = i / size, h = j / size;
      const a2 = vnoise((i - size) * 0.5, j * 0.5, seed);
      const b2 = vnoise(i * 0.13, (j - size) * 0.13, seed + 71);
      const va = lerp(a, a2, w * w);
      const vb = lerp(b, b2, h * h);
      let v = 0.5 + (va - 0.5) * 0.75 + (vb - 0.5) * 0.45;
      v = 0.5 + (v - 0.5) * contrast;
      const k = clamp(v, 0, 1) * 255;
      d[p] = k; d[p + 1] = k; d[p + 2] = k; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function paintGrain(g, scale) {
  const tile = makeGrainTile(256, 9091, 1.0);
  const p1 = g.createPattern(tile, 'repeat');
  const p2 = g.createPattern(tile, 'repeat');
  // The canvas is under a scale(S) transform; undo it so the grain lands at
  // exactly one texel per pattern pixel.
  const inv = 1 / scale;
  try {
    p1.setTransform(new DOMMatrix().scaleSelf(inv, inv));
    p2.setTransform(new DOMMatrix().scaleSelf(inv * 2.7, inv * 2.7).rotateSelf(37));
  } catch (e) { /* pattern transforms unsupported: fall back to 1:1 repeat */ }

  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.30;
  g.fillStyle = p1;
  g.fillRect(0, 0, WORLD.w, WORLD.h);
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.18;
  g.fillStyle = p2;
  g.fillRect(0, 0, WORLD.w, WORLD.h);
  g.restore();

  tile.width = 1; tile.height = 1;
}

// ===========================================================================
//  BUILD
// ===========================================================================

function buildTerrain() {
  const S = TERRAIN_SCALE;
  const bigW = Math.round(WORLD.w * S);
  const bigH = Math.round(WORLD.h * S);

  const big = document.createElement('canvas');
  big.width = bigW;
  big.height = bigH;
  const g = big.getContext('2d', { alpha: false });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // From here on, every painter works in WORLD coordinates.
  g.setTransform(S, 0, 0, S, 0, 0);

  const seed = (Math.random() * 100000) | 0;

  // ---- L0  PRIMED BOARD ---------------------------------------------------
  g.fillStyle = T.PRIME;
  g.fillRect(0, 0, WORLD.w, WORLD.h);

  // ---- L1  MATERIAL FIELD -------------------------------------------------
  terrainFieldStep = 4;
  terrainFieldW = Math.round(WORLD.w / terrainFieldStep);
  terrainFieldH = Math.round(WORLD.h / terrainFieldStep);
  terrainField = buildMaterialField(terrainFieldW, terrainFieldH, seed);
  paintMaterialField(g, terrainFieldW, terrainFieldH);

  // ---- geometry that later layers need ------------------------------------
  const stream = buildStream();
  const road = buildRoadPath(stream);
  const parcels = generateParcels();

  // ---- L2  PLOUGHED / CROPPED / FALLOW PARCELS ----------------------------
  for (const p of parcels) paintParcel(g, p);

  // ---- L3  DIRT AND MUD PATCHES -------------------------------------------
  paintDirtPatches(g, 130);

  // ---- L4  HEDGEROWS AND FIELD BOUNDARIES (under the road) ----------------
  const hedges = paintHedges(g, parcels, road, stream);

  // ---- L5  THE ROAD -------------------------------------------------------
  paintRoad(g, road, seed);

  // ---- L6  STREAM, FORD, BRIDGE -------------------------------------------
  paintStream(g, stream, seed + 5);
  const ford = findFord(road, stream);
  paintPuddles(g, road, seed, ford);
  paintBridge(g, ford, road, stream);

  // ---- L7  STATIC GRASS / FLOCK -------------------------------------------
  paintFlock(g);
  paintHeroTufts(g, 34000);

  // ---- L8  TREES, BUSHES, ROCKS, SCRUB ------------------------------------
  const trees = placeWoods(g, road, stream, parcels);
  placeUndergrowth(g, road, stream, trees);

  // ---- L9  BOARD AO -------------------------------------------------------
  paintBoardAO(g, 260, 160, seed + 17);

  // ---- L10 TABLE-EDGE FALLOFF ---------------------------------------------
  paintEdgeFalloff(g);

  // ---- L11 1:1 TACTILE GRAIN ----------------------------------------------
  paintGrain(g, S);

  terrainFeatures = {
    road: road, stream: stream, parcels: parcels,
    hedges: hedges, trees: trees, ford: ford,
  };

  // ---- retain a small composite as `terrainCanvas` -------------------------
  // Feeds the minimap bake in startBattle() and is a safe whole-world blit.
  // Built BEFORE the tiles are allocated so the halving chain does not stack
  // on top of the big+tiles peak.
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = Math.round(WORLD.w * 0.25);
  terrainCanvas.height = Math.round(WORLD.h * 0.25);
  const tg = terrainCanvas.getContext('2d', { alpha: false });
  tg.imageSmoothingEnabled = true;
  tg.imageSmoothingQuality = 'high';
  // Iterative halving is the correct box filter; a one-shot downscale is not.
  let src = big, sw = bigW, sh = bigH;
  while (sw > terrainCanvas.width * 2) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, sw >> 1);
    half.height = Math.max(1, sh >> 1);
    const hg = half.getContext('2d', { alpha: false });
    hg.imageSmoothingEnabled = true;
    hg.imageSmoothingQuality = 'high';
    hg.drawImage(src, 0, 0, half.width, half.height);
    if (src !== big) { src.width = 1; src.height = 1; }
    src = half; sw = half.width; sh = half.height;
  }
  tg.drawImage(src, 0, 0, terrainCanvas.width, terrainCanvas.height);
  if (src !== big) { src.width = 1; src.height = 1; }

  // ---- slice into frustum-cullable tiles ----------------------------------
  sliceTerrain(big, bigW, bigH, S);

  // Release the 66 MB scratch immediately, before startBattle() allocates
  // decalCanvas and the two sprite atlases.
  big.width = 1;
  big.height = 1;
}

function sliceTerrain(big, bigW, bigH, S) {
  terrainCols = Math.ceil(WORLD.w / TILE_W);
  terrainRows = Math.ceil(WORLD.h / TILE_H);
  terrainTiles = [];
  const tpw = Math.round(TILE_W * S);
  const tph = Math.round(TILE_H * S);

  for (let j = 0; j < terrainRows; j++) {
    for (let i = 0; i < terrainCols; i++) {
      const c = document.createElement('canvas');
      c.width = tpw + TILE_BLEED * 2;
      c.height = tph + TILE_BLEED * 2;
      const cg = c.getContext('2d', { alpha: false });
      cg.imageSmoothingEnabled = false;

      let sx = i * tpw - TILE_BLEED;
      let sy = j * tph - TILE_BLEED;
      let sw = tpw + TILE_BLEED * 2;
      let sh = tph + TILE_BLEED * 2;
      let dx = 0, dy = 0;
      if (sx < 0) { dx = -sx; sw += sx; sx = 0; }
      if (sy < 0) { dy = -sy; sh += sy; sy = 0; }
      if (sx + sw > bigW) sw = bigW - sx;
      if (sy + sh > bigH) sh = bigH - sy;

      // Fill first so the bleed outside the world is board-edge, not black.
      cg.fillStyle = T.BOARD_EDGE;
      cg.fillRect(0, 0, c.width, c.height);
      if (sw > 0 && sh > 0) cg.drawImage(big, sx, sy, sw, sh, dx, dy, sw, sh);

      terrainTiles.push({
        c: c,
        wx: i * TILE_W - TILE_BLEED / S,
        wy: j * TILE_H - TILE_BLEED / S,
        ww: (tpw + TILE_BLEED * 2) / S,
        wh: (tph + TILE_BLEED * 2) / S,
        x0: i * TILE_W, y0: j * TILE_H,
        x1: i * TILE_W + TILE_W, y1: j * TILE_H + TILE_H,
      });
    }
  }
}

// ===========================================================================
//  PER-FRAME: frustum-culled tile blits. This is the ONLY hot-path code in
//  the terrain subsystem. Typical visible tile count at zoom 0.45 with a
//  1920x1080 viewport is 12; at zoom 2.4 it is 2.
//  No state changes, no allocation, no gradients, no filters.
// ===========================================================================

function drawTerrain(g2, camX, camY, viewW, viewH) {
  const tiles = terrainTiles;
  if (tiles === null) return;            // one null check per FRAME, not per unit
  const l = camX - viewW / 2, r = camX + viewW / 2;
  const t = camY - viewH / 2, b = camY + viewH / 2;
  for (let i = 0; i < tiles.length; i++) {
    const tl = tiles[i];
    if (tl.x1 < l || tl.x0 > r || tl.y1 < t || tl.y0 > b) continue;
    g2.drawImage(tl.c, tl.wx, tl.wy, tl.ww, tl.wh);
  }
}

// ===========================================================================
//  MINIMAP BASE — a deliberate stylised tactical map baked from the same
//  geometry, not a photographic downscale. Optional; call from startBattle().
// ===========================================================================

function buildMinimapTerrain(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { alpha: false });
  const sx = w / WORLD.w, sy = h / WORLD.h;

  g.fillStyle = '#5E6A3C';
  g.fillRect(0, 0, w, h);

  if (terrainFeatures) {
    g.save();
    g.scale(sx, sy);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    for (const p of terrainFeatures.parcels) {
      g.fillStyle = p.kind === 'plough' || p.kind === 'root' ? '#6B563A'
        : p.kind === 'wheat' ? '#8E8250'
          : p.kind === 'fallow' ? '#67693F' : '#66723F';
      smoothClosedPath(g, p.pts);
      g.fill();
    }

    g.strokeStyle = '#33422A';
    g.lineWidth = 46;
    for (const hd of terrainFeatures.hedges) {
      smoothOpenPath(g, hd.pts);
      g.stroke();
    }
    // Treelines as a band along the north and south edges plus the NE wood.
    g.fillStyle = '#33422A';
    g.globalAlpha = 0.9;
    for (const t of terrainFeatures.trees) {
      g.beginPath();
      g.arc(t.x, t.y, t.r * 1.5, 0, 6.2831853);
      g.fill();
    }
    g.globalAlpha = 1;

    g.strokeStyle = '#42525A';
    g.lineWidth = 34;
    smoothOpenPath(g, terrainFeatures.stream);
    g.stroke();

    g.strokeStyle = '#8A7350';
    g.lineWidth = 26;
    smoothOpenPath(g, terrainFeatures.road);
    g.stroke();
    g.restore();
  }

  // HUD-matching frame: 3px parchment-dark border with a 1px inner bevel.
  g.strokeStyle = '#4A4432';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, w - 3, h - 3);
  g.strokeStyle = '#8A8055';
  g.lineWidth = 1;
  g.strokeRect(3.5, 3.5, w - 7, h - 7);
  return c;
}

export { buildTerrain, drawTerrain, drawTree, drawBush, drawRock, drawScrub, buildMinimapTerrain };
export function getTerrainCanvas() { return terrainCanvas; }
