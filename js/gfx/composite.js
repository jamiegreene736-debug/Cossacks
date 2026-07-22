// Frame composition: haze, grade, vignette, selection, HUD marks, minimap.
import { WORLD, BUILDING_TYPES } from '../config.js';
import { shouldRenderUnitHealthBar } from '../render-performance.js';
import { isPlayerTeam, sideFrontDirection } from '../teams.js';
let camera = { x: 0, y: 0, zoom: 1 };
let cw = 0, ch = 0, dpr = 1;
let mmCanvas = null, mmCtx = null, mmTerrain = null;
function setCompositeRefs(refs) {
  if (refs.camera) camera = refs.camera;
  if (refs.mmCanvas) mmCanvas = refs.mmCanvas;
  if (refs.mmCtx) mmCtx = refs.mmCtx;
  if (refs.mmTerrain !== undefined) mmTerrain = refs.mmTerrain;
}
function setCompositeView(w, h, d) { cw = w; ch = h; dpr = d; }
// ============================================================================
//  COMPOSITE SUBSYSTEM — "Kriegsspiel Table" frame composition
// ----------------------------------------------------------------------------
//  Owns: global lighting / grade / vignette / atmospheric haze, cloud shadow,
//        selection visuals, health bars, order flags, drag-select box, minimap.
//
//  PERF CONTRACT
//    * Every gradient, ring, bar, pennant and noise field in here is baked ONCE
//      (or once per window resize) into an offscreen canvas.
//    * The full-screen passes are 3 drawImage + 1 fillRect + 1 pattern fillRect.
//      Their cost is a function of viewport pixels, NOT of unit count.
//    * Per selected unit: exactly ONE drawImage (baked ring or baked pip).
//    * Per visible soldier: exactly ONE drawImage from the baked HP-bar atlas,
//      source-rect indexed — no fillStyle assignment, path, or gradient work.
//    * Minimap unit plotting is density accumulation into Int16Arrays:
//      ~6 integer ops per unit, then ONE putImageData + ONE drawImage.
//    * ctx.filter / ctx.shadowBlur appear ONLY inside cBuild* bake functions.
//
//  NAMING: everything here is prefixed `c` / `C_` / `cmp` so this fragment can
//  be pasted into render.js without colliding with existing module-level
//  identifiers (rnd, SCALE, SUN, drawMinimap, mmTerrain, ...).
//
//  ---------------------------------------------------------------------------
//  ADAPTED for the settlement-economy render.js.
//  ---------------------------------------------------------------------------
//  This fragment was written against a draw() that knew only about terrain,
//  decals and units. The economy PR added eleven building types, four resource
//  node types, construction foundations, farm parcels, a training queue and a
//  build-placement ghost. Five things changed here as a result:
//
//  1. PALETTE UNIFICATION. The file now owns every selection ring and every bar
//     in the game. Before, five unrelated palettes coexisted — unit rings
//     rgba(140,235,140,0.85), building rings rgba(145,235,145,0.9), the drag box
//     rgba(140,235,140,0.9), unit HP #7fd67f/#e0c34a/#d65f4a and building HP
//     #6ec36e/#d3674e/#d1b454 — three greens and two ramps that meant the same
//     thing. All of them now derive from C_UI plus two ramp functions.
//
//  2. BUILDINGS GET THEIR OWN VOCABULARY, not a scaled-up unit's. A town centre
//     has radius 70 against a musketeer's 5, so drawBuildingSelection() uses a
//     dashed surveyor's plot mark rather than a 14x-magnified creature ring,
//     and drawBuildingBars() proportions its bar to the footprint with a
//     screen-space floor.
//
//  3. PROGRESS IS NOT HEALTH. A foundation starts at 8% hp (economy.js
//     makeBuilding), so feeding construction progress through the health ramp
//     showed every new building as critically wounded. There are now two baked
//     bar atlases: health (green->ochre->oxide) and progress (parchment->gold),
//     and construction and the training queue both use the latter.
//
//  4. THE PLACEMENT GHOST BECAME REAL UI. drawPlacementPreview() replaces the
//     flat translucent rectangle and, critically, draws the clearance circle at
//     def.radius + 35 that economy.js validatePlacement() actually enforces —
//     so a refused placement now shows the player WHY.
//
//  5. THE MINIMAP ANSWERS THE ECONOMY. Resource nodes are sized by radius and
//     dimmed by depletion; buildings are separated by SILHOUETTE (diamond /
//     chevron / bar / square) rather than by a side hue that is indistinguish-
//     able at 5 px; and the wear layer now works with the shipped codebase via
//     a battle-heat accumulator fed from the existing decal stream, instead of
//     silently doing nothing until decals.js lands.
//
//  See the block comment on drawLightingPass() for the in-canvas-UI ordering
//  rule, which is what keeps the grade from eating the health bars.
// ============================================================================

// ---------------------------------------------------------------------------
// 0. Local constants & tiny utilities (deliberately redeclared, not imported)
// ---------------------------------------------------------------------------

// The single gallery photoflood. Must match the terrain/sprite subsystems.
const C_SUN = {
  x: -0.64, y: -0.77,            // unit vector TOWARD the light (up-left)
  shadow: { x: 0.64, y: 0.77 },  // direction shadows fall
  lenMul: 0.55,
  squash: 0.42,
  key: '#FFF1CE',
  fill: '#8FA4C4',
  bounce: '#B9A277',
  shadowRGB: '26,30,48',
};

// Reserved UI hue family — parchment & gold. Appears nowhere in the world art.
const C_UI = {
  gold: '#E8DCA8',
  goldBright: '#F4EAC4',
  goldDim: '#C9B87A',
  goldDeep: '#A89A68',
  frame: '#4A4432',
  frameLit: '#8A8055',
  ink: '#14120C',
  paper: '#F0E9CF',
};

// Side identity. These exact values are shared with the sprite base rims so
// the field and the minimap finally agree on what "blue" and "red" mean.
const C_SIDE_RIM = ['#3E78B8', '#B8483E', '#4FAE8B', '#C67A2F'];
const C_SIDE_RIM_LIT = ['#6FA3DC', '#DC7A6F', '#7CD9B4', '#E5A35F'];
// Minimap plot colours: dim (sparse) -> lit (dense mass).
const C_MM_SIDE_DIM = [[54, 104, 166], [166, 60, 52]];
const C_MM_SIDE_LIT = [[142, 194, 246], [246, 152, 132]];
const C_MM_CONTEST = [255, 218, 138];

const CS = 6;             // oversample for small baked UI art (rings, flags)
const C_GRADE_MAX = 640;  // longest side of the baked full-screen gradients
const C_HP_STEPS = 32;    // health-bar atlas resolution (33 rows: 0..32)
// Atlas CELLS are deliberately larger than the bar they contain. A 9-argument
// drawImage that downscales 4:1 with imageSmoothingQuality 'high' samples a
// neighbourhood, and Chrome does NOT reliably clamp that neighbourhood to the
// source rect — with under 1 device px of margin the row above bleeds into the
// row below and every bar picks up a sliver of a different fill level. 3.4 px
// of margin on all four sides makes the rows independent.
const C_HP_ROW = 20;      // device px per atlas cell (bar content is 13.6)
const C_HP_COL = 64;      // device px per atlas cell (bar content is 56)
const C_BAR_W = 16;       // world px at zoom 1 for the whole CELL
const C_BAR_H = 5;        // (the visible bar inside it is ~14 x 2.4)
const C_HP_MIN_ZOOM = 0.70;  // below this, health bars are unreadable noise
const C_RING_MIN_ZOOM = 0.62; // below this, rings collapse to pips + group hull

function cRnd(a, b) { return a + Math.random() * (b - a); }
function cClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function cLerp(a, b, t) { return a + (b - a) * t; }

function cHex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function cRgb(r, g, b) {
  return '#' + (((1 << 24) | (r << 16) | (g << 8) | b) >>> 0).toString(16).slice(1);
}
function cMix(a, b, t) {
  const A = cHex(a), B = cHex(b);
  return cRgb(
    Math.round(cLerp(A[0], B[0], t)),
    Math.round(cLerp(A[1], B[1], t)),
    Math.round(cLerp(A[2], B[2], t)));
}
function cRgba(hex, a) {
  const c = cHex(hex);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

function cCanvas(w, h, opaque) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d', opaque ? { alpha: false } : undefined);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return [c, g];
}

// ---------------------------------------------------------------------------
// 1. Module-level baked assets
// ---------------------------------------------------------------------------

const cmp = {
  built: false,        // static (viewport-independent) assets baked?
  gradeW: 0, gradeH: 0,

  grade: null,         // multiply : cool vertical bias x spotlight vignette
  warm: null,          // soft-light : warm key hotspot up-left of centre
  haze: null,          // lighter : additive aerial perspective (north = far)

  cloudTile: null,     // 1024^2 seamless blurred noise
  cloudPattern: null,
  cloudMat: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },

  rings: null,         // baked selection rings, indexed by |radius|
  ringFallback: null,
  pip: null,           // low-zoom selection mark
  hp: null,            // health-bar atlas   (33 rows, green->ochre->oxide)
  prog: null,          // progress-bar atlas (33 rows, parchment->gold)
  rout: null,          // "unit is routing" chevron
  flags: null,         // { move|attack|gather|rally : [4 flutter frames] }
  flagPulse: null,     // expanding ground ring for a fresh order

  bRings: null,        // baked BUILDING footprint rings (surveyor's marks)
  bRingSizes: null,
  hatchOk: null,       // placement-preview hatch tiles + cached patterns
  hatchBad: null,
  patOk: null,
  patBad: null,

  mmBase: null,        // stylised tactical terrain (full bleed)
  mmFrame: null,       // frame + bevel, transparent centre, drawn last
  mmUnits: null,       // density canvas (C_MM_DW x C_MM_DH)
  mmUnitsCtx: null,
  mmImg: null,
  mmD0: null, mmD1: null,
  mmHeat: null,        // Float32 "where has the fighting been" accumulator
  mmHeatCv: null,      // its canvas + ImageData, blitted under the unit layer
  mmHeatCtx: null,
  mmHeatImg: null,
  mmHeatDirty: false,
};

// Frame thickness in minimap px. The frame is an OVERLAY drawn on top of a
// full-bleed map — it must never inset the map content.
//
// WHY: render.js's minimapToWorld() maps a click as mx / mmCanvas.width *
// WORLD.w, i.e. it assumes the map fills the canvas edge to edge. Insetting
// the content by 3px silently desynchronises every minimap click from what the
// player sees under the cursor — worst case ~130 world px of error at the far
// edge on a 244px minimap, which is more than a formation's frontage. Since
// this fragment cannot change minimapToWorld, the map stays full-bleed and the
// frame simply covers the outermost 3px of it.
const C_MM_FRAME = 3;

// Minimap density grid: one cell per 2x2 minimap pixels.
let C_MM_DW = 122, C_MM_DH = 75;

// Trample / wear layer, injected by the decal subsystem if it exists
// (decals.js getTrampleCanvas()). Optional: the heat accumulator below covers
// the same question with what the SHIPPED codebase already provides.
let cTrampleRef = null;
function setCompositeTrampleLayer(canvasOrNull) { cTrampleRef = canvasOrNull; }

// Combat ping ring buffer for the minimap.
const C_PING_MAX = 32;
const cPings = new Float32Array(C_PING_MAX * 4); // x, y, bornMs, kind
let cPingHead = 0;

/**
 * Record a combat event so the minimap can flash it, AND stain it permanently.
 * Kind: 0 = death, 1 = shell burst, 2 = building lost (brighter / larger).
 *
 * TWO separate outputs from one call:
 *
 *   the PING   — a decaying additive ring, 1.4 s, answering "where is the
 *                fighting RIGHT NOW" without looking away from the field.
 *   the HEAT   — a permanent saturating accumulation into a low-res grid,
 *                answering "where HAS the fighting been". This is the wear/mud
 *                layer the Art Bible calls the single highest storytelling-per-
 *                CPU opportunity in the codebase, and this version of it needs
 *                no new canvas, no per-tick stamping and no sim change: it is
 *                driven entirely by decal events that already exist.
 *
 * Wire it from render.js's pendingDecals flush (see fxNoteDecal in effects.js,
 * which calls this for every decal kind). No sim.js edit is required.
 */
function mmNoteEvent(x, y, kind) {
  const k = kind || 0;
  const i = (cPingHead++ % C_PING_MAX) * 4;
  cPings[i] = x; cPings[i + 1] = y;
  cPings[i + 2] = performance.now();
  cPings[i + 3] = k;

  const heat = cmp.mmHeat;
  if (!heat) return;                      // minimap base not built yet
  const gx = (x / WORLD.w * C_MM_DW) | 0;
  const gy = (y / WORLD.h * C_MM_DH) | 0;
  if (gx < 0 || gy < 0 || gx >= C_MM_DW || gy >= C_MM_DH) return;
  // A lost building scars far more ground than a lost man. Saturating add, so
  // a five-minute grind reaches a deep stain and then stops rather than
  // clipping to black and losing all internal structure.
  const add = k === 2 ? 9 : k === 1 ? 2.2 : 1;
  const idx = gy * C_MM_DW + gx;
  const v = heat[idx] + add;
  heat[idx] = v > 120 ? 120 : v;
  // bleed a little into the 4-neighbourhood so a firing line reads as a band
  // of churned ground rather than as a row of isolated dots
  if (gx > 0) heat[idx - 1] = Math.min(120, heat[idx - 1] + add * 0.30);
  if (gx < C_MM_DW - 1) heat[idx + 1] = Math.min(120, heat[idx + 1] + add * 0.30);
  if (gy > 0) heat[idx - C_MM_DW] = Math.min(120, heat[idx - C_MM_DW] + add * 0.30);
  if (gy < C_MM_DH - 1) heat[idx + C_MM_DW] = Math.min(120, heat[idx + C_MM_DW] + add * 0.30);
  cmp.mmHeatDirty = true;
}

// ---------------------------------------------------------------------------
// 2. buildCompositeTextures() — bake everything once, re-bake screen-sized
//    gradients on resize.
// ---------------------------------------------------------------------------

/**
 * Bakes (or re-bakes) every composite texture.
 * Viewport-sized gradients are rebuilt whenever cw/ch change; the small UI art
 * is baked exactly once. Safe to call from initRender() and from resize().
 *
 * Reads module-level `cw`, `ch` from render.js.
 */
function buildCompositeTextures() {
  if (!cmp.built) {
    cBuildCloudTile();
    cBuildRings();
    cBuildBuildingRings();
    cBuildBarAtlases();
    cBuildPlacementArt();
    cBuildRoutMark();
    cBuildFlags();
    cmp.built = true;
  }
  const vw = Math.max(1, cw | 0), vh = Math.max(1, ch | 0);
  if (vw === cmp.gradeW && vh === cmp.gradeH && cmp.grade) return;
  cmp.gradeW = vw; cmp.gradeH = vh;
  cBuildGrade(vw, vh);
}

// ---- 2a. The gallery photoflood: grade + vignette (multiply) ---------------

function cBuildGrade(vw, vh) {
  // Gradients are perfectly smooth, so a low-res bake upscaled with high-quality
  // smoothing is pixel-indistinguishable from a full-res one and costs ~1 MB
  // instead of ~33 MB per pass at 2x DPR.
  const k = C_GRADE_MAX / Math.max(vw, vh);
  const w = Math.max(64, Math.round(vw * Math.min(1, k)));
  const h = Math.max(64, Math.round(vh * Math.min(1, k)));
  const halfDiag = Math.hypot(w, h) * 0.5;

  // --- PASS 1 : multiply grade -------------------------------------------
  {
    const [c, g] = cCanvas(w, h, true);

    // (a) vertical cool bias — the near edge of the table falls slightly cooler
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0.00, '#FFFFFF');
    v.addColorStop(0.55, '#EDEEF4');
    v.addColorStop(1.00, '#DCDFEC');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);

    // (b) spotlight falloff. Centre is nudged up from geometric centre because
    //     the eye reads the action slightly above middle in a top-down view.
    //
    //     GEOMETRY MATTERS MORE THAN THE STOPS HERE. A viewport corner always
    //     sits at ~1.03 halfDiag from this centre, so the outer radius decides
    //     how much of the ramp the visible area actually traverses. With an
    //     outer radius of 1.06 halfDiag the corner lands at t=0.96 — i.e.
    //     almost the darkest stop — which crushes corner units to ~0.52
    //     brightness and makes a flanking force at the edge of the screen hard
    //     to read. Pushing the outer radius out to 1.30 puts the corner at
    //     t=0.69 and ~0.72 brightness: still unmistakably a lit table with a
    //     falloff, but troops at the frame edge stay legible.
    const cx = w * 0.5, cy = h * 0.44;
    const r = g.createRadialGradient(cx, cy, halfDiag * 0.42, cx, cy, halfDiag * 1.30);
    r.addColorStop(0.00, '#FFFFFF');
    r.addColorStop(0.28, '#F4F1E6');
    r.addColorStop(0.55, '#D6D2C4');
    r.addColorStop(0.85, '#8A8878');
    r.addColorStop(1.00, '#5E5F52');
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';

    cmp.grade = c;
  }

  // --- PASS 2 : warm key wash (soft-light) --------------------------------
  {
    const [c, g] = cCanvas(w, h, true);
    // #838383 is a near no-op under soft-light, so the wash falls off cleanly
    // to "no change" instead of to a grey haze.
    const hx = w * 0.42, hy = h * 0.30;
    const r = g.createRadialGradient(hx, hy, 0, hx, hy, halfDiag * 1.25);
    r.addColorStop(0.00, '#FFD98A');
    r.addColorStop(0.30, '#EFC98D');
    r.addColorStop(0.62, '#AEA492');
    r.addColorStop(1.00, '#838383');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);

    // Cool counter-bounce in the lower-right, opposite the key. Below neutral
    // under soft-light, so it deepens and cools the shadow side of the table.
    const bx = w * 0.86, by = h * 0.92;
    const b = g.createRadialGradient(bx, by, 0, bx, by, halfDiag * 0.85);
    b.addColorStop(0.0, 'rgba(96,108,140,0.55)');
    b.addColorStop(1.0, 'rgba(131,131,131,0)');
    g.fillStyle = b;
    g.fillRect(0, 0, w, h);

    cmp.warm = c;
  }

  // --- PASS 3 : additive aerial perspective (lighter) ---------------------
  // A multiply can only darken; it physically cannot make the far edge of the
  // field recede into lit dust. Distance haze has to LIFT. Because the camera
  // is top-down and north is up, "screen top" is "further away" — so a single
  // vertical additive gradient is simultaneously the atmosphere and the depth
  // cue the 5200x3200 field currently has none of.
  {
    const [c, g] = cCanvas(w, h, false);
    // Amplitudes are baked at FULL strength, because the runtime multiplier is
    // clamped to <= 1 (globalAlpha above 1 is not an error, it is silently
    // ignored — see drawLightingPass).
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0.00, 'rgba(208,197,163,0.128)');
    v.addColorStop(0.18, 'rgba(203,193,163,0.086)');
    v.addColorStop(0.38, 'rgba(196,189,166,0.039)');
    v.addColorStop(0.62, 'rgba(190,186,168,0.008)');
    v.addColorStop(1.00, 'rgba(190,186,168,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);

    // A faint warm bloom hugging the top corners, where the board falls away
    // fastest from the spotlight and the dust catches the most light.
    const t = g.createRadialGradient(w * 0.5, -h * 0.15, 0, w * 0.5, -h * 0.15, h * 1.0);
    t.addColorStop(0.0, 'rgba(255,232,183,0.075)');
    t.addColorStop(1.0, 'rgba(255,232,183,0)');
    g.fillStyle = t;
    g.fillRect(0, 0, w, h);

    cmp.haze = c;
  }
}

// ---- 2b. Seamless cloud-shadow tile ---------------------------------------

/**
 * Seamless cloud tile, built from wrapping-lattice value noise.
 *
 * NOTE ON THE APPROACH: the obvious construction — white noise, tiled 3x3,
 * blurred hard, centre cropped — does not work, and it fails silently. A
 * gaussian blur is a low-pass filter, and white noise has essentially no
 * energy at low frequencies: blurring 256px white noise by 11px then 19px
 * leaves a standard deviation under 1/255 (measured). The result is a flat
 * grey tile, which under a 0.20 multiply is a uniform darkening — no clouds,
 * no edges, no movement, and no way to tell from reading the code that the
 * pass is doing nothing.
 *
 * Instead we synthesise the low frequencies directly. Three octaves of value
 * noise on lattices of 4, 8 and 16 cells, interpolated with smoothstep, with
 * the lattice indices taken modulo the lattice size so the tile wraps exactly.
 * Amplitude is then normalised to fill the range, so contrast is a chosen
 * number rather than an accident of the filter.
 */
function cBuildCloudTile() {
  const N = 128;   // field resolution: smooth enough to upscale 8x cleanly
  const T = 1024;  // tile size, so pattern features stay large

  const OCT = [[4, 1.0], [8, 0.52], [16, 0.26]];
  let norm = 0;
  const grids = [];
  for (const [G, amp] of OCT) {
    norm += amp;
    const a = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) a[i] = Math.random();
    grids.push(a);
  }

  const field = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (let o = 0; o < OCT.length; o++) {
        const G = OCT[o][0], amp = OCT[o][1], grid = grids[o];
        const fx = x / N * G, fy = y / N * G;
        const x0 = fx | 0, y0 = fy | 0;
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const x1 = (x0 + 1) % G, y1 = (y0 + 1) % G;   // modulo => seamless wrap
        const r0 = y0 * G, r1 = y1 * G;
        const a = grid[r0 + x0], b = grid[r0 + x1];
        const c0 = grid[r1 + x0], c1 = grid[r1 + x1];
        const top = a + (b - a) * sx, bot = c0 + (c1 - c0) * sx;
        v += amp * (top + (bot - top) * sy);
      }
      v /= norm;
      field[y * N + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const [nc, ng] = cCanvas(N, N, false);
  const img = ng.createImageData(N, N);
  const d = img.data;
  const inv = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < N * N; i++) {
    let v = (field[i] - lo) * inv;           // normalised 0..1
    v = v * v * (3 - 2 * v);                 // widen the clear flats, tighten edges
    // Clouds graze the board, they do not stain it: 0.58..1.00 under multiply.
    const lum = 148 + v * 107;
    const p = i << 2;
    d[p] = d[p + 1] = d[p + 2] = lum;
    d[p + 3] = 255;
  }
  ng.putImageData(img, 0, 0);

  // 8x smooth upscale. The field's highest octave has a 8px period at N=128,
  // so nothing here is near the sampling limit and no lattice shows through.
  const [c, g] = cCanvas(T, T, true);
  g.drawImage(nc, 0, 0, T, T);
  cmp.cloudTile = c;
}

// ---- 2c. Selection rings ---------------------------------------------------

/**
 * A selection ring in this direction is not a screen-primary green hairline —
 * it is a painted gold ring on the board with a warm pool of spotlight inside
 * it, a cool contact line under it (obeying C_SUN) so it reads on straw as
 * well as on turf, and a brighter arc on the up-left quadrant where the key
 * light catches the rim.
 */
function cBakeRing(rWorld) {
  const rx = rWorld + 3.6;
  const ry = rx * 0.52;
  const pad = 4.2;
  const w = (rx + pad) * 2, h = (ry + pad) * 2;
  const [c, g] = cCanvas(w * CS, h * CS, false);
  g.scale(CS, CS);
  g.translate(w / 2, h / 2);
  g.lineCap = 'round';

  // (1) warm pool of light inside the ring — sells "this figure is lit"
  g.save();
  g.scale(1, ry / rx);
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.02);
  pool.addColorStop(0.00, 'rgba(255,238,186,0.00)');
  pool.addColorStop(0.55, 'rgba(255,236,182,0.055)');
  pool.addColorStop(0.88, 'rgba(255,231,170,0.155)');
  pool.addColorStop(1.00, 'rgba(255,231,170,0.00)');
  g.fillStyle = pool;
  g.beginPath(); g.arc(0, 0, rx * 1.02, 0, 6.2832); g.fill();
  g.restore();

  // (2) cool contact line, offset down-right along the sun's shadow vector.
  //     This is what keeps the gold legible over pale straw and road dust.
  g.strokeStyle = 'rgba(' + C_SUN.shadowRGB + ',0.55)';
  g.lineWidth = 1.55;
  g.beginPath();
  g.ellipse(C_SUN.shadow.x * 0.55, C_SUN.shadow.y * 0.55, rx, ry, 0, 0, 6.2832);
  g.stroke();

  // (3) the ring proper
  g.strokeStyle = C_UI.goldDim;
  g.lineWidth = 1.05;
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.stroke();

  // (4) key-lit arc across the upper-left 150 degrees only. Single-sided edge
  //     light is what makes a form read as lit rather than merely outlined.
  g.strokeStyle = C_UI.goldBright;
  g.lineWidth = 1.35;
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.90); g.stroke();

  // (5) four bright ticks on the diagonals: gives the ring a deliberate,
  //     instrument-like read instead of a plain hoop.
  g.strokeStyle = '#FFF6DE';
  g.lineWidth = 1.7;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.25 + i * Math.PI * 0.5;
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, a - 0.20, a + 0.20);
    g.stroke();
  }

  // (6) tiny corner pips just outside the ring on the cardinal axes
  g.fillStyle = C_UI.goldBright;
  const pips = [[rx + 1.5, 0], [-rx - 1.5, 0], [0, -ry - 1.4], [0, ry + 1.4]];
  for (const [px, py] of pips) {
    g.beginPath(); g.arc(px, py, 0.52, 0, 6.2832); g.fill();
  }

  return { c, w, h, ax: w / 2, ay: h / 2 };
}

function cBuildRings() {
  // UNIT_TYPES radii in play: villager/musk/pike 5, cav 7, gun 11.
  // Bake every integer radius up to 16 so a config change never falls through.
  cmp.rings = new Array(17).fill(null);
  for (const r of [4, 5, 6, 7, 8, 9, 11, 13, 16]) cmp.rings[r] = cBakeRing(r);
  // Fill the gaps by pointing at the nearest baked size (no extra memory).
  let last = cmp.rings[4];
  for (let i = 0; i < 17; i++) {
    if (cmp.rings[i]) last = cmp.rings[i];
    else cmp.rings[i] = last;
  }
  cmp.ringFallback = cmp.rings[16];

  // Low-zoom mark: at 0.45x a ring is a 4px smudge.
  //
  // SIZING IS NOT COSMETIC HERE. The pip draws UNDER the sprite. A soldier
  // sprite is 18 world px wide and 20 tall, which at the 0.45 zoom floor is
  // ~8 screen px covering roughly iy-7.9 .. iy+1.1. A 7px pip centred on the
  // unit's feet therefore sits almost entirely behind the figure it is meant
  // to mark, and selection becomes invisible at exactly the zoom where the
  // player is commanding the most men. So the lozenge is made wider than the
  // sprite's footprint (13 units vs 8 screen px) and dropped ~1.2 units below
  // the contact point, leaving gold protruding on both flanks and below.
  const pw = 13, ph = 8;
  const Lx = pw / 2, Ly = 4.0;      // lozenge centre inside the frame
  const [pc, pg] = cCanvas(pw * CS, ph * CS, false);
  pg.scale(CS, CS);
  pg.translate(Lx, Ly);
  pg.fillStyle = 'rgba(' + C_SUN.shadowRGB + ',0.62)';
  pg.beginPath(); pg.ellipse(0.4, 0.5, 5.6, 2.25, 0, 0, 6.2832); pg.fill();
  pg.fillStyle = C_UI.goldDim;
  pg.beginPath(); pg.ellipse(0, 0, 5.2, 1.9, 0, 0, 6.2832); pg.fill();
  pg.fillStyle = C_UI.gold;
  pg.beginPath(); pg.ellipse(0, -0.15, 4.4, 1.35, 0, 0, 6.2832); pg.fill();
  // single-sided key-lit crescent on the up-left arc, as everything else here
  pg.fillStyle = '#FFF6DE';
  pg.beginPath(); pg.ellipse(-0.5, -0.55, 2.6, 0.72, 0, 0, 6.2832); pg.fill();
  // ax/ay place the lozenge centre 1.2 units BELOW the unit's ground point
  cmp.pip = { c: pc, w: pw, h: ph, ax: Lx, ay: Ly - 1.2 };
}

// ---- 2d. Bar atlases (health + progress) -----------------------------------

/**
 * Colour ramps for the two bar atlases.
 *
 * Before this adaptation the codebase carried FIVE unrelated bar/ring palettes:
 * unit HP #7fd67f/#e0c34a/#d65f4a, building HP #6ec36e/#d3674e/#d1b454, the
 * training-queue bar #d1b454, unit selection rgba(140,235,140,0.85) and building
 * selection rgba(145,235,145,0.9) — three different greens, two different
 * three-stop ramps, and a gold that doubled as both "low health" and "progress".
 * All of them are now derived from these two functions and C_UI, so a bar means
 * the same thing wherever it appears and none of them can be confused with
 * england's #b33a38 coat or with a team colour.
 */
function cHealthRamp(frac) {
  // healthy sap green -> ochre -> oxide red. Deliberately desaturated relative
  // to a game-UI green so it stays inside the painted palette.
  if (frac > 0.55) return cMix('#C9AE4A', '#7FB259', (frac - 0.55) / 0.45);
  if (frac > 0.28) return cMix('#C4653C', '#C9AE4A', (frac - 0.28) / 0.27);
  return cMix('#A6362C', '#C4653C', frac / 0.28);
}

function cProgressRamp(frac) {
  // Construction and training are not health: they never mean danger, so the
  // ramp stays inside the parchment/gold family and only gains warmth and
  // value as it fills. A player must never read a half-built house as a
  // half-dead one.
  return cMix(C_UI.goldDeep, C_UI.goldBright, frac * 0.85 + 0.15);
}

/**
 * 33 pre-baked bars (0/32 .. 32/32 full). Drawing a bar is one 9-argument
 * drawImage against a single bound texture: no fillStyle, no fillRect, no
 * colour-bucket branch in the hot path.
 */
function cBakeBarAtlas(rampFn) {
  const rows = C_HP_STEPS + 1;
  const [c, g] = cCanvas(C_HP_COL, C_HP_ROW * rows, false);
  const S = 4;                 // device px per sprite unit
  const uw = C_HP_COL / S;     // 16 sprite units wide
  const uh = C_HP_ROW / S;     // 5 sprite units tall

  for (let i = 0; i < rows; i++) {
    const frac = i / C_HP_STEPS;
    g.save();
    g.translate(0, i * C_HP_ROW);
    g.scale(S, S);

    // Content is inset 1.0 / 1.3 units so the lining (which extends 0.45
    // further) still leaves ~0.85 units = 3.4 device px of empty margin on
    // every side of the cell. See the C_HP_ROW comment.
    const x0 = 1.0, y0 = 1.3, bw = uw - 2.0, bh = 2.4;

    // lining — a painted black line, not a vector hairline
    g.fillStyle = 'rgba(16,14,10,0.90)';
    g.fillRect(x0 - 0.45, y0 - 0.45, bw + 0.9, bh + 0.9);
    // empty track, cool and recessed
    g.fillStyle = 'rgba(38,36,44,0.92)';
    g.fillRect(x0, y0, bw, bh);
    // track inner shade along +SUN.shadow, so the trough reads concave
    g.fillStyle = 'rgba(' + C_SUN.shadowRGB + ',0.45)';
    g.fillRect(x0, y0 + bh * 0.55, bw, bh * 0.45);

    if (frac > 0) {
      const col = rampFn(frac);
      const fw = bw * frac;
      // base
      g.fillStyle = col;
      g.fillRect(x0, y0, fw, bh);
      // drybrushed lit band along the top (0-32% of the bar height)
      g.fillStyle = cMix(col, '#FFE9BC', 0.42);
      g.fillRect(x0, y0, fw, bh * 0.32);
      // shade wash along the bottom (62-100%)
      g.fillStyle = cMix(col, '#1B2033', 0.38);
      g.fillRect(x0, y0 + bh * 0.68, fw, bh * 0.32);
      // bright leading edge — reads as a liquid level
      if (fw > 0.6) {
        g.fillStyle = cMix(col, '#FFF6DE', 0.60);
        g.fillRect(x0 + fw - 0.45, y0, 0.45, bh);
      }
    }

    // quarter ticks, cut through everything so the bar is readable at a glance
    g.fillStyle = 'rgba(14,12,8,0.55)';
    for (let q = 1; q < 4; q++) g.fillRect(x0 + bw * q * 0.25 - 0.14, y0, 0.28, bh);

    // 1px specular on the top lining — the varnish catching the photoflood
    g.fillStyle = 'rgba(255,246,222,0.28)';
    g.fillRect(x0, y0 - 0.45, bw, 0.28);

    g.restore();
  }
  return c;
}

function cBuildBarAtlases() {
  cmp.hp = cBakeBarAtlas(cHealthRamp);
  cmp.prog = cBakeBarAtlas(cProgressRamp);
}

// ---- 2d-bis. Building footprint rings --------------------------------------

/**
 * A building is not a man, and it must not wear a man's selection ring.
 *
 * BUILDING_TYPES radii run 29 (watch tower) to 70 (town centre) — up to
 * fourteen times a musketeer's 5. Scaling cBakeRing() up to 70 would produce a
 * gold hoop 147 world px across with the same 1.05 px stroke, which at any zoom
 * reads as a thin wire lassoing the roof rather than as a footprint drawn on
 * the ground.
 *
 * So buildings get a surveyor's mark instead: a heavier dashed ellipse with
 * solid quadrant arcs on the diagonals, a cool contact line offset down-right
 * along C_SUN, and four cardinal ticks. The dash is what separates "this is a
 * measured plot on the board" from "this thing is glowing".
 */
const C_BRING_CS = 3;             // oversample: these are large, 3 is plenty

function cBakeBuildingRing(rWorld) {
  const rx = rWorld + 5.0;
  const ry = rx * 0.50;
  const pad = 7.0;
  const w = (rx + pad) * 2, h = (ry + pad) * 2;
  const [c, g] = cCanvas(w * C_BRING_CS, h * C_BRING_CS, false);
  g.scale(C_BRING_CS, C_BRING_CS);
  g.translate(w / 2, h / 2);
  g.lineCap = 'butt';

  // (1) a wide, very faint warm pool so the plot reads as lit ground, not as
  //     a decal floating over it
  g.save();
  g.scale(1, ry / rx);
  const pool = g.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx * 1.03);
  pool.addColorStop(0.00, 'rgba(255,236,182,0.00)');
  pool.addColorStop(0.80, 'rgba(255,234,176,0.050)');
  pool.addColorStop(1.00, 'rgba(255,231,170,0.00)');
  g.fillStyle = pool;
  g.beginPath(); g.arc(0, 0, rx * 1.03, 0, 6.2832); g.fill();
  g.restore();

  // (2) cool contact line, offset down-right along the sun's shadow vector
  g.strokeStyle = 'rgba(' + C_SUN.shadowRGB + ',0.58)';
  g.lineWidth = 2.6;
  g.beginPath();
  g.ellipse(C_SUN.shadow.x * 1.3, C_SUN.shadow.y * 1.3, rx, ry, 0, 0, 6.2832);
  g.stroke();

  // (3) the dashed plot line
  g.strokeStyle = C_UI.goldDim;
  g.lineWidth = 1.7;
  g.setLineDash([7, 5.5]);
  g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.stroke();
  g.setLineDash([]);

  // (4) solid quadrant arcs on the diagonals — the corners of the plot
  const arc = 0.30;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * 0.25 + i * Math.PI * 0.5;
    // key-lit on the up-left pair, plain gold on the down-right pair
    const up = Math.cos(a) * C_SUN.x + Math.sin(a) * C_SUN.y > 0;
    g.strokeStyle = up ? C_UI.goldBright : C_UI.goldDim;
    g.lineWidth = up ? 2.3 : 1.9;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, a - arc, a + arc); g.stroke();
  }

  // (5) cardinal ticks, pointing outward off the plot line
  g.strokeStyle = '#FFF6DE';
  g.lineWidth = 1.6;
  const ticks = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [tx, ty] of ticks) {
    g.beginPath();
    g.moveTo(tx * rx, ty * ry);
    g.lineTo(tx * (rx + 3.4), ty * (ry + 3.4));
    g.stroke();
  }

  return { c, w, h, ax: w / 2, ay: h / 2 };
}

/**
 * Baked for the exact radii BUILDING_TYPES declares (29, 34, 38, 39, 40, 48,
 * 56, 60, 62, 70) plus a couple of spares, then gap-filled to the nearest
 * baked size so a future building type can never fall through to nothing.
 */
function cBuildBuildingRings() {
  const SIZES = [24, 29, 34, 38, 40, 44, 48, 56, 62, 70, 80, 92];
  cmp.bRings = [];
  cmp.bRingSizes = SIZES;
  for (const r of SIZES) cmp.bRings.push(cBakeBuildingRing(r));
}

function cBuildingRingFor(r) {
  const sizes = cmp.bRingSizes;
  for (let i = 0; i < sizes.length; i++) if (r <= sizes[i]) return cmp.bRings[i];
  return cmp.bRings[cmp.bRings.length - 1];
}

// ---- 2d-ter. Placement-preview hatch ---------------------------------------

/**
 * The build ghost is the one piece of UI the player stares at continuously
 * while spending three hundred wood, and today it is a flat 58%-alpha green or
 * red rectangle with no indication of the clearance rule that will reject it
 * (economy.js validatePlacement uses def.radius + 35, which the rectangle does
 * not show at all — so an invalid placement gives the player a red box and no
 * reason).
 *
 * Two 16x16 hatch tiles are baked here, one per state. Only ONE preview can be
 * on screen at a time, so the rest of the ghost is drawn as paths; the pattern
 * is cached on cmp so createPattern never runs inside a frame.
 */
function cBakeHatch(ink, back) {
  const T = 16;
  const [c, g] = cCanvas(T, T, false);
  g.fillStyle = back;
  g.fillRect(0, 0, T, T);
  g.strokeStyle = ink;
  g.lineWidth = 2.2;
  g.lineCap = 'square';
  // 45-degree rule, drawn three times so the tile wraps seamlessly
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(-T + i * T, T);
    g.lineTo(T + i * T, -T);
    g.stroke();
  }
  return c;
}

function cBuildPlacementArt() {
  cmp.hatchOk = cBakeHatch('rgba(232,220,168,0.30)', 'rgba(232,220,168,0.055)');
  cmp.hatchBad = cBakeHatch('rgba(190,74,58,0.42)', 'rgba(150,48,38,0.10)');
  cmp.patOk = null;
  cmp.patBad = null;
}

// ---- 2e. Rout marker -------------------------------------------------------

function cBuildRoutMark() {
  const w = 9, h = 9;
  const [c, g] = cCanvas(w * CS, h * CS, false);
  g.scale(CS, CS);
  g.translate(w / 2, h / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // dark lining beneath
  g.strokeStyle = 'rgba(16,14,10,0.85)';
  g.lineWidth = 2.3;
  g.beginPath();
  g.moveTo(-2.4, -1.5); g.lineTo(0, 1.4); g.lineTo(2.4, -1.5);
  g.stroke();
  g.beginPath();
  g.moveTo(-2.4, -3.3); g.lineTo(0, -0.4); g.lineTo(2.4, -3.3);
  g.stroke();
  // the mark itself — a cool, drained white so a routing mass reads as
  // "colour draining out of the unit"
  g.strokeStyle = '#D9D2C0';
  g.lineWidth = 1.0;
  g.beginPath();
  g.moveTo(-2.4, -1.5); g.lineTo(0, 1.4); g.lineTo(2.4, -1.5);
  g.stroke();
  g.strokeStyle = '#F2ECD8';
  g.beginPath();
  g.moveTo(-2.4, -3.3); g.lineTo(0, -0.4); g.lineTo(2.4, -3.3);
  g.stroke();
  cmp.rout = { c, w, h, ax: w / 2, ay: h / 2 };
}

// ---- 2f. Order flags -------------------------------------------------------

/**
 * Four order kinds differentiated by SILHOUETTE first and colour second,
 * exactly as the unit types are: a triangular pennant (move), a swallowtail
 * (attack), a square banner (gather) and a forked streamer (rally). All four
 * live in the reserved parchment/gold UI family plus one cool accent, so none
 * of them can be mistaken for england's #b33a38 coat — which is the one real
 * collision in the shipped config (the old order flag was #c03a30, twelve RGB
 * points away from an English musketeer).
 */
const C_FLAG_KINDS = {
  move: { cloth: '#F0E9CF', band: '#D4B860', glyph: '#6E6142', shape: 'pennant' },
  attack: { cloth: '#E39A3A', band: '#8A3A1C', glyph: '#4A1C0E', shape: 'swallow' },
  gather: { cloth: '#D4B860', band: '#6E6142', glyph: '#40391F', shape: 'banner' },
  rally: { cloth: '#C3D6E2', band: '#4A6A7C', glyph: '#2E4552', shape: 'fork' },
};

function cBakeFlagFrame(kind, phase) {
  const w = 30, h = 36;
  const ax = 9, ay = 33;          // pole base = the world order point
  const [c, g] = cCanvas(w * CS, h * CS, false);
  g.scale(CS, CS);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  const k = C_FLAG_KINDS[kind];
  const poleTop = 8, poleBot = 32;
  const wave = Math.sin(phase * Math.PI * 0.5);
  const wave2 = Math.sin(phase * Math.PI * 0.5 + 1.9);

  // (0) contact shadow on the board — a real radial, obeying C_SUN
  const sx = ax + 2.0, sy = ay + 0.9;
  const cs = g.createRadialGradient(sx, sy, 0, sx, sy, 7.4);
  cs.addColorStop(0.00, 'rgba(' + C_SUN.shadowRGB + ',0.46)');
  cs.addColorStop(0.55, 'rgba(' + C_SUN.shadowRGB + ',0.20)');
  cs.addColorStop(1.00, 'rgba(' + C_SUN.shadowRGB + ',0)');
  g.save();
  g.translate(sx, sy); g.scale(1, C_SUN.squash); g.translate(-sx, -sy);
  g.fillStyle = cs;
  g.beginPath(); g.arc(sx, sy, 7.4, 0, 6.2832); g.fill();
  g.restore();

  // (1) the pole's own cast shadow, laid down the board along +SUN.shadow
  g.strokeStyle = 'rgba(' + C_SUN.shadowRGB + ',0.30)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(ax + (poleBot - poleTop) * C_SUN.shadow.x * C_SUN.lenMul,
    ay + (poleBot - poleTop) * C_SUN.shadow.y * C_SUN.lenMul * C_SUN.squash);
  g.stroke();

  // (2) the cloth
  const fx = ax + 1.0, fy = poleTop + 0.4;
  const fly = 15.5, drop = 8.6;
  const path = new Path2D();
  if (k.shape === 'pennant') {
    path.moveTo(fx, fy);
    path.quadraticCurveTo(fx + fly * 0.55, fy - 1.4 + wave * 1.5, fx + fly, fy + drop * 0.36 + wave * 1.9);
    path.quadraticCurveTo(fx + fly * 0.5, fy + drop * 0.62 + wave2 * 1.2, fx, fy + drop * 0.86);
    path.closePath();
  } else if (k.shape === 'swallow') {
    path.moveTo(fx, fy);
    path.quadraticCurveTo(fx + fly * 0.5, fy - 1.2 + wave * 1.6, fx + fly, fy - 0.4 + wave * 2.1);
    path.lineTo(fx + fly * 0.62, fy + drop * 0.46 + wave2 * 0.9);
    path.lineTo(fx + fly, fy + drop * 0.95 + wave * 1.4);
    path.quadraticCurveTo(fx + fly * 0.45, fy + drop * 0.9 + wave2 * 1.0, fx, fy + drop);
    path.closePath();
  } else if (k.shape === 'banner') {
    path.moveTo(fx, fy);
    path.quadraticCurveTo(fx + fly * 0.55, fy - 1.0 + wave * 1.7, fx + fly * 0.94, fy + 0.4 + wave * 2.0);
    path.quadraticCurveTo(fx + fly * 1.0, fy + drop * 0.55, fx + fly * 0.94, fy + drop + wave2 * 1.3);
    path.quadraticCurveTo(fx + fly * 0.5, fy + drop * 1.06 + wave * 1.1, fx, fy + drop);
    path.closePath();
  } else { // fork
    path.moveTo(fx, fy);
    path.quadraticCurveTo(fx + fly * 0.5, fy - 1.5 + wave * 1.5, fx + fly * 1.02, fy - 1.0 + wave * 2.2);
    path.lineTo(fx + fly * 0.55, fy + drop * 0.5 + wave2 * 0.8);
    path.lineTo(fx + fly * 1.02, fy + drop * 1.05 + wave * 1.6);
    path.quadraticCurveTo(fx + fly * 0.42, fy + drop * 0.98, fx, fy + drop * 0.94);
    path.closePath();
  }

  // lining first (dilated silhouette), so the cloth is black-lined like a
  // painted miniature rather than floating as a flat vector shape
  g.save();
  g.strokeStyle = 'rgba(18,15,10,0.92)';
  g.lineWidth = 1.5;
  g.stroke(path);
  g.restore();

  g.fillStyle = k.cloth;
  g.fill(path);

  // acrylic ramp on the cloth: shade in the trailing 40%, drybrush in the
  // leading 26%, both clipped to the cloth
  g.save();
  g.clip(path);
  const shade = g.createLinearGradient(fx, fy, fx + fly * C_SUN.shadow.x + drop * C_SUN.shadow.y,
    fy + fly * C_SUN.shadow.y + drop * C_SUN.shadow.x);
  shade.addColorStop(0.00, cRgba(cMix(k.cloth, '#FFE9BC', 0.34), 0.85));
  shade.addColorStop(0.26, cRgba(k.cloth, 0));
  shade.addColorStop(0.62, cRgba(k.cloth, 0));
  shade.addColorStop(1.00, cRgba(cMix(k.cloth, '#1B2033', 0.44), 0.85));
  g.fillStyle = shade;
  g.fillRect(0, 0, w, h);

  // fold ripples driven by the same wave that drives the outline, so the cloth
  // reads as one piece of moving fabric
  g.strokeStyle = cRgba(cMix(k.cloth, '#1B2033', 0.30), 0.42);
  g.lineWidth = 0.55;
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    g.beginPath();
    g.moveTo(fx + fly * t, fy - 1.5);
    g.quadraticCurveTo(fx + fly * t + wave * 1.2 * i, fy + drop * 0.5,
      fx + fly * t - wave2 * 0.9 * i, fy + drop + 1.5);
    g.stroke();
  }

  // hoist band + glyph
  g.fillStyle = k.band;
  g.fillRect(fx, fy - 0.4, 2.4, drop + 0.9);
  if (k.shape === 'banner') {
    // sheaf glyph for a gather order
    g.strokeStyle = k.glyph;
    g.lineWidth = 0.85;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(fx + 7.6 + i * 2.0, fy + drop * 0.92);
      g.lineTo(fx + 7.6 + i * 3.0, fy + drop * 0.18);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(fx + 4.9, fy + drop * 0.62); g.lineTo(fx + 10.3, fy + drop * 0.62);
    g.stroke();
  } else if (k.shape === 'swallow') {
    // two aggressive chevrons for an attack order
    g.strokeStyle = k.glyph;
    g.lineWidth = 1.15;
    for (let i = 0; i < 2; i++) {
      g.beginPath();
      g.moveTo(fx + 4.0 + i * 3.6, fy + 0.9);
      g.lineTo(fx + 7.0 + i * 3.6, fy + drop * 0.5);
      g.lineTo(fx + 4.0 + i * 3.6, fy + drop - 0.9);
      g.stroke();
    }
  } else if (k.shape === 'fork') {
    g.fillStyle = k.glyph;
    g.fillRect(fx + 4.6, fy + drop * 0.36, 6.4, 1.5);
  }
  g.restore();

  // (3) the pole — lined, then base, then a sun-side edge light
  g.strokeStyle = 'rgba(18,15,10,0.92)';
  g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(ax, poleBot); g.lineTo(ax, poleTop - 1.6); g.stroke();
  g.strokeStyle = '#6E5940';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(ax, poleBot); g.lineTo(ax, poleTop - 1.6); g.stroke();
  g.strokeStyle = 'rgba(255,241,206,0.55)';
  g.lineWidth = 0.5;
  g.beginPath(); g.moveTo(ax - 0.5, poleBot - 1); g.lineTo(ax - 0.5, poleTop - 1.2); g.stroke();

  // (4) finial
  g.fillStyle = 'rgba(18,15,10,0.9)';
  g.beginPath(); g.arc(ax, poleTop - 2.1, 1.5, 0, 6.2832); g.fill();
  g.fillStyle = C_UI.goldDim;
  g.beginPath(); g.arc(ax, poleTop - 2.1, 1.05, 0, 6.2832); g.fill();
  g.fillStyle = '#FFF6DE';
  g.beginPath(); g.arc(ax - 0.32, poleTop - 2.42, 0.42, 0, 6.2832); g.fill();

  // (5) matte varnish — the same flat scattering film every painted object in
  //     this game gets, so the UI belongs to the same physical world
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(238,232,214,0.045)';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';

  return { c, w, h, ax, ay };
}

function cBuildFlags() {
  cmp.flags = {};
  for (const kind of Object.keys(C_FLAG_KINDS)) {
    const frames = [];
    for (let i = 0; i < 4; i++) frames.push(cBakeFlagFrame(kind, i));
    cmp.flags[kind] = frames;
  }

  // Expanding ground pulse. Baked as a TRUE CIRCLE; the ground squash is
  // applied at draw time by the destination height, exactly like every other
  // flat-on-the-board element. Baking the squash in as well would apply it
  // twice and collapse the ring into a wire.
  const R = 24;
  const [c, g] = cCanvas(R * 2 * 3, R * 2 * 3, false);
  g.scale(3, 3);
  g.translate(R, R);
  g.strokeStyle = 'rgba(240,233,207,0.9)';
  g.lineWidth = 2.0;
  g.beginPath(); g.arc(0, 0, R - 2.6, 0, 6.2832); g.stroke();
  g.strokeStyle = 'rgba(232,220,168,0.45)';
  g.lineWidth = 5.0;
  g.beginPath(); g.arc(0, 0, R - 4.2, 0, 6.2832); g.stroke();
  const glow = g.createRadialGradient(0, 0, R * 0.35, 0, 0, R);
  glow.addColorStop(0, 'rgba(255,238,186,0)');
  glow.addColorStop(0.82, 'rgba(255,238,186,0.13)');
  glow.addColorStop(1, 'rgba(255,238,186,0)');
  g.fillStyle = glow;
  g.beginPath(); g.arc(0, 0, R, 0, 6.2832); g.fill();
  cmp.flagPulse = { c, w: R * 2, h: R * 2, ax: R, ay: R };
}

// ===========================================================================
// 3. RUNTIME — world-space passes
// ===========================================================================

/**
 * PASS 0 — drifting cloud shadow, in WORLD space.
 * One pattern fillRect over the visible world rect. Cost is viewport-bound,
 * not unit-bound, and it is what turns a static baked board into a landscape
 * that breathes.
 *
 * Call immediately AFTER terrain + decals are blitted and BEFORE units, so the
 * clouds shade the ground the troops stand on rather than the troops.
 */
function drawCloudShadow(ctx, timeSec) {
  if (!cmp.cloudTile) return;
  if (!cmp.cloudPattern) cmp.cloudPattern = ctx.createPattern(cmp.cloudTile, 'repeat');
  const z = camera.zoom;
  const hw = cw / 2 / z + 8, hh = ch / 2 / z + 8;
  const s = 2.6;                       // cloud features ~2,660 world px across
  const m = cmp.cloudMat;
  m.a = s; m.b = 0; m.c = 0; m.d = s;
  m.e = (timeSec * 7) % (1024 * s);    // wind drift, +7 px/s east
  m.f = (timeSec * 2) % (1024 * s);    //             +2 px/s south
  cmp.cloudPattern.setTransform(m);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = cmp.cloudPattern;
  ctx.fillRect(camera.x - hw, camera.y - hh, hw * 2, hh * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  // Do not leave a CanvasPattern installed as the context fillStyle. Every
  // downstream painter in draw() happens to set its own fill today, but a
  // pattern left bound is an invisible trap for the next one that does not.
  ctx.fillStyle = '#000000';
}

/**
 * Selection rings, drawn UNDER the unit sprites, in world space.
 *
 * `units` is the already-culled, y-sorted visible buffer (render.js sortBuf).
 * Per selected unit this is exactly one drawImage of a baked ring — no
 * beginPath, no ellipse, no stroke, no state change inside the loop.
 *
 * At command altitude (zoom < 0.62) an ellipse is sub-pixel noise, so we swap
 * to a baked gold pip plus ONE bracket box around the whole selected group:
 * you stop being able to see which individual is selected, which is fine,
 * because at that zoom you are commanding a mass, not a man.
 */
function drawSelection(ctx, units, alpha) {
  if (!cmp.rings || !cmp.pip) return;   // buildCompositeTextures() not wired yet
  const z = camera.zoom;
  const n = units.length;
  const lowZoom = z < C_RING_MIN_ZOOM;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let count = 0;

  if (lowZoom) {
    const p = cmp.pip;
    const s = 1 / z;                            // constant screen size
    const pax = p.ax * s, pay = p.ay * s, pw = p.w * s, ph = p.h * s;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (!u.selected) continue;
      const ix = u.px + (u.x - u.px) * alpha;
      const iy = u.py + (u.y - u.py) * alpha - (u.wallElevation || 0);
      ctx.drawImage(p.c, ix - pax, iy - pay, pw, ph);
      if (ix < minX) minX = ix; if (ix > maxX) maxX = ix;
      if (iy < minY) minY = iy; if (iy > maxY) maxY = iy;
      count++;
    }
  } else {
    const rings = cmp.rings;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (!u.selected) continue;
      const ix = u.px + (u.x - u.px) * alpha;
      const iy = u.py + (u.y - u.py) * alpha - (u.wallElevation || 0);
      const r = u.radius | 0;
      const g = (r >= 0 && r < 17) ? rings[r] : cmp.ringFallback;
      ctx.drawImage(g.c, ix - g.ax, iy - g.ay, g.w, g.h);
      if (ix < minX) minX = ix; if (ix > maxX) maxX = ix;
      if (iy < minY) minY = iy; if (iy > maxY) maxY = iy;
      count++;
    }
  }

  // Group bracket: ONE path total, regardless of how many thousand are
  // selected. Only worth drawing for a real formation, and only when the
  // individual rings have stopped carrying the information.
  if (count > 3 && (lowZoom || count > 24)) {
    const pad = 9 / z;
    const x0 = minX - pad, y0 = minY - pad * 0.6;
    const x1 = maxX + pad, y1 = maxY + pad * 0.6;
    const arm = Math.min((x1 - x0) * 0.22, (y1 - y0) * 0.30, 26 / z);
    ctx.lineWidth = 2.4 / z;
    ctx.strokeStyle = 'rgba(16,14,10,0.5)';
    cBracketPath(ctx, x0, y0, x1, y1, arm);
    ctx.stroke();
    ctx.lineWidth = 1.1 / z;
    ctx.strokeStyle = 'rgba(232,220,168,0.85)';
    cBracketPath(ctx, x0, y0, x1, y1, arm);
    ctx.stroke();
  }
}

function cBracketPath(ctx, x0, y0, x1, y1, a) {
  ctx.beginPath();
  ctx.moveTo(x0, y0 + a); ctx.lineTo(x0, y0); ctx.lineTo(x0 + a, y0);
  ctx.moveTo(x1 - a, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + a);
  ctx.moveTo(x1, y1 - a); ctx.lineTo(x1, y1); ctx.lineTo(x1 - a, y1);
  ctx.moveTo(x0 + a, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - a);
}

function visibleTowerAttackRange(building) {
  if (!building?.alive || !building.complete || !building.selected || building.type !== 'tower') {
    return 0;
  }
  return BUILDING_TYPES.tower.range;
}

/**
 * Exact watch-tower attack radius, drawn as a measured artillery plot beneath
 * all scenery. The translucent field explains coverage without masking terrain;
 * the animated dashed boundary and cardinal range ticks make the limit precise.
 */
function drawTowerAttackRanges(ctx, buildings, time) {
  const z = Math.max(0.25, camera.zoom);
  let active = false;
  for (let index = 0; index < buildings.length; index++) {
    if (visibleTowerAttackRange(buildings[index]) > 0) { active = true; break; }
  }
  if (!active) return;

  ctx.save();
  ctx.lineCap = 'butt';
  for (let index = 0; index < buildings.length; index++) {
    const tower = buildings[index];
    const range = visibleTowerAttackRange(tower);
    if (!range) continue;

    ctx.fillStyle = cRgba(C_SIDE_RIM[tower.side] || C_UI.goldDim, 0.055);
    ctx.beginPath(); ctx.arc(tower.x, tower.y, range, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(16,14,10,0.68)';
    ctx.lineWidth = 3.6 / z;
    ctx.beginPath(); ctx.arc(tower.x, tower.y, range, 0, Math.PI * 2); ctx.stroke();

    ctx.strokeStyle = cRgba(C_UI.goldBright, 0.88);
    ctx.lineWidth = 1.45 / z;
    ctx.setLineDash([13 / z, 8 / z]);
    ctx.lineDashOffset = -(time * 10 / z);
    ctx.beginPath(); ctx.arc(tower.x, tower.y, range, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    const tick = 8 / z;
    ctx.strokeStyle = cRgba(C_UI.goldBright, 0.92);
    ctx.lineWidth = 1.8 / z;
    for (let mark = 0; mark < 8; mark++) {
      const angle = mark * Math.PI / 4;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(tower.x + cos * (range - tick), tower.y + sin * (range - tick));
      ctx.lineTo(tower.x + cos * (range + tick), tower.y + sin * (range + tick));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Building footprint rings, world space, drawn UNDER the building pass.
 *
 * Replaces the inline ellipse at render.js drawBuilding() — which used a THIRD
 * green, rgba(145,235,145,0.9), unrelated to both the unit ring and the drag
 * box, and rebuilt its path with a lineWidth = 2 / camera.zoom compensation on
 * every selected building on every frame.
 *
 * One drawImage per selected building. Buildings are few (tens, not thousands),
 * so this pass is not a hot loop — but it does have to be a SEPARATE pass from
 * the building painters, because drawBuilding() runs inside its own
 * translate(), and a ring drawn there would be occluded by the next building
 * in the y-sort. Drawn as a batch first, every ring is under every building.
 */
function drawBuildingSelection(ctx, buildings) {
  if (!cmp.bRings) return;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b.alive || !b.selected) continue;
    const g = cBuildingRingFor(b.radius);
    // Footprint rings sit ON the ground, so they are anchored slightly below
    // the entity origin, matching the contact shadow the building painters use.
    ctx.drawImage(g.c, b.x - g.ax, b.y + 5 - g.ay, g.w, g.h);
  }
}

/**
 * Building placement ghost, world space, drawn after the buildings.
 *
 * `preview` is render.js's placementPreview: { type, x, y, valid }.
 * `def` is BUILDING_TYPES[preview.type] — passed in so this fragment does not
 * need the config import.
 *
 * Three pieces of information, none of which the old flat rectangle carried:
 *   1. the FOOTPRINT, hatched, so it reads as a survey chalked on the ground
 *      rather than as a coloured pane of glass floating above it;
 *   2. the CLEARANCE circle at def.radius + 35 — the actual rule
 *      economy.js validatePlacement() enforces. Without it an invalid placement
 *      turns the box red and gives the player no reason, which is the single
 *      most common "why won't it let me build" complaint in the genre;
 *   3. a CENTRE MARK, so the player can line the plot up on a resource node.
 *
 * At most one preview exists at a time, so the path work here is free. The only
 * per-frame allocation risk — createPattern — is cached on cmp.
 */
const C_PLACE_CLEARANCE = 35;   // mirrors economy.js validatePlacement()

function drawPlacementPreview(ctx, preview, def) {
  if (!preview || !def || !cmp.hatchOk) return;
  const z = camera.zoom;
  const ok = preview.valid !== false;
  const x = preview.x, y = preview.y;
  const w = def.w, h = def.h;

  // ---- cached hatch pattern -----------------------------------------------
  let pat = ok ? cmp.patOk : cmp.patBad;
  if (!pat) {
    pat = ctx.createPattern(ok ? cmp.hatchOk : cmp.hatchBad, 'repeat');
    if (ok) cmp.patOk = pat; else cmp.patBad = pat;
  }

  const ink = ok ? C_UI.gold : '#C0563F';
  const inkLit = ok ? C_UI.goldBright : '#E8846A';

  // ---- 1. clearance circle -------------------------------------------------
  // Drawn FIRST and faintest: it is the rule, not the object.
  const cr = (def.radius || Math.max(w, h) * 0.5) + C_PLACE_CLEARANCE;
  ctx.lineWidth = 1.4 / z;
  ctx.strokeStyle = ok ? 'rgba(232,220,168,0.34)' : 'rgba(200,90,70,0.52)';
  ctx.setLineDash([6 / z, 6 / z]);
  ctx.beginPath();
  ctx.ellipse(x, y + 5, cr, cr * 0.50, 0, 0, 6.2832);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- 2. footprint --------------------------------------------------------
  const x0 = x - w / 2, y0 = y - h / 2;
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // dark lining under the gold rule, so the plot survives over straw and road
  ctx.lineWidth = 3 / z;
  ctx.strokeStyle = 'rgba(14,12,8,0.45)';
  ctx.strokeRect(x0, y0, w, h);
  ctx.lineWidth = 1.3 / z;
  ctx.strokeStyle = ink;
  ctx.strokeRect(x0, y0, w, h);

  // solid corner brackets — the extent stays unambiguous through the hatch
  const arm = Math.min(w * 0.26, h * 0.26, 22);
  ctx.lineWidth = 2.6 / z;
  ctx.strokeStyle = inkLit;
  cBracketPath(ctx, x0, y0, x0 + w, y0 + h, arm);
  ctx.stroke();

  // ---- 3. centre mark ------------------------------------------------------
  const t = 7;
  ctx.lineWidth = 1.2 / z;
  ctx.strokeStyle = inkLit;
  ctx.beginPath();
  ctx.moveTo(x - t, y); ctx.lineTo(x + t, y);
  ctx.moveTo(x, y - t); ctx.lineTo(x, y + t);
  ctx.stroke();

  // ---- 4. refusal slash ----------------------------------------------------
  // An invalid plot gets an unmistakable graphic NO, not merely a hue change:
  // ~8% of players cannot reliably separate this red from this gold.
  if (!ok) {
    ctx.lineWidth = 4.5 / z;
    ctx.strokeStyle = 'rgba(14,12,8,0.42)';
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0 + h);
    ctx.moveTo(x0 + w, y0); ctx.lineTo(x0, y0 + h);
    ctx.stroke();
    ctx.lineWidth = 2.2 / z;
    ctx.strokeStyle = inkLit;
    ctx.stroke();
  }
}

/**
 * Building health / construction / training bars, world space.
 *
 * MUST be drawn AFTER drawLightingPass has re-established the world transform
 * (see the note on drawLightingPass): these are instruments, not scenery, and
 * a vignette that drops a corner to 0.5 multiply must not be allowed to eat
 * them.
 *
 * Replaces render.js drawBuilding()'s inline bar, which used a fourth colour
 * ramp (#6ec36e / #d3674e / #d1b454) and a fifth for the training queue.
 * Both now come out of the two baked atlases, so a bar reads identically
 * whether it is over a musketeer or over an artillery foundry.
 */
function drawBuildingBars(ctx, buildings) {
  if (!cmp.hp) return;
  const z = camera.zoom;
  if (z < C_HP_MIN_ZOOM * 0.62) return;   // buildings are big: show bars lower

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b.alive) continue;
    const damaged = b.hp < b.maxHp;
    const building = !b.complete;
    const queued = b.queue !== undefined && b.queue.length > 0;
    if (!b.selected && !damaged && !building && !queued) continue;

    // The bar is proportioned to the footprint but floored in SCREEN px, so a
    // 52 px watch tower is still readable when the camera is pulled back.
    let bw = b.w * 0.62;
    const floor = 52 / z;
    if (bw < floor) bw = floor;
    if (bw > 132) bw = 132;
    const bh = bw * (C_BAR_H / C_BAR_W);
    let top = b.y - b.h * 0.82 - 10 - bh;

    if (building) {
      // Under construction: progress, in the gold ramp. Never the health ramp —
      // a fresh foundation is at 8% hp and would otherwise show solid red.
      let step = (b.progress * C_HP_STEPS + 0.5) | 0;
      if (step < 0) step = 0; else if (step > C_HP_STEPS) step = C_HP_STEPS;
      ctx.drawImage(cmp.prog, 0, step * C_HP_ROW, C_HP_COL, C_HP_ROW,
        b.x - bw * 0.5, top, bw, bh);
      top -= bh * 0.92;
    } else if (b.selected || damaged) {
      let step = (b.hp / b.maxHp * C_HP_STEPS + 0.5) | 0;
      if (step < 0) step = 0; else if (step > C_HP_STEPS) step = C_HP_STEPS;
      ctx.drawImage(cmp.hp, 0, step * C_HP_ROW, C_HP_COL, C_HP_ROW,
        b.x - bw * 0.5, top, bw, bh);
      top -= bh * 0.92;
    }

    // Training queue: same instrument, gold ramp, stacked directly above the
    // health bar so the two read as one panel rather than as two unrelated
    // widgets at opposite ends of the building.
    if (queued) {
      const q = b.queue[0];
      const frac = q.total > 0 ? 1 - q.remaining / q.total : 0;
      let step = (frac * C_HP_STEPS + 0.5) | 0;
      if (step < 0) step = 0; else if (step > C_HP_STEPS) step = C_HP_STEPS;
      const qw = bw * 0.78, qh = bh * 0.8;
      ctx.drawImage(cmp.prog, 0, step * C_HP_ROW, C_HP_COL, C_HP_ROW,
        b.x - qw * 0.5, top, qw, qh);
    }
  }
}

/**
 * Health bars + rout marks, drawn ABOVE the unit sprites, in world space.
 * One 9-argument drawImage per bar out of a single baked atlas. The bar is
 * sized 1/zoom so it stays a constant, readable size on screen. Every living
 * military unit receives one; civilians retain only their rout mark.
 *
 * `units` is the same visible buffer passed to drawSelection.
 */
function drawHealthBars(ctx, units, alpha, spritesRef) {
  const z = camera.zoom;
  if (!cmp.hp || !cmp.rout || !spritesRef) return;
  const atlas = cmp.hp;
  const w = C_BAR_W / z, h = C_BAR_H / z;
  const rm = cmp.rout;
  const rw = rm.w / z, rh = rm.h / z;
  const n = units.length;

  for (let i = 0; i < n; i++) {
    const u = units[i];
    // Soldiers always expose their status on both sides. The baked atlas keeps
    // this to one draw call per visible soldier even in mass battles.
    const routing = u.state === 'flee';
    const showBar = shouldRenderUnitHealthBar(u);
    if (!routing && !showBar) continue;

    const ix = u.px + (u.x - u.px) * alpha;
    const iy = u.py + (u.y - u.py) * alpha - (u.wallElevation || 0);
    const sp = spritesRef[u.side][u.type];
    let top = -sp.ay - 2;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(-(camera.rotation || 0));

    if (routing) {
      ctx.drawImage(rm.c, -rw * 0.5, top - rh, rw, rh);
      top -= rh + 0.6 / z;
    }
    if (showBar) {
      let step = (u.hp / u.maxHp * C_HP_STEPS + 0.5) | 0;
      if (step < 0) step = 0; else if (step > C_HP_STEPS) step = C_HP_STEPS;
      ctx.drawImage(atlas, 0, step * C_HP_ROW, C_HP_COL, C_HP_ROW,
        -w * 0.5, top - h, w, h);
    }
    ctx.restore();
  }
}

/**
 * Order flags, world space, drawn above units.
 * `world.flags` is capped by a 1.2s lifetime, so this list is tiny (typically
 * 1-8 entries); the per-flag alpha writes here are irrelevant to frame cost
 * and are NOT in the unit loop.
 */
function cDrawMoveRoute(ctx, flag, scale, life, age) {
  if (!flag.route || !Number.isFinite(flag.fromX) || !Number.isFinite(flag.fromY)) return;
  const dx = flag.x - flag.fromX;
  const dy = flag.y - flag.fromY;
  const distance = Math.hypot(dx, dy);
  if (distance < 18) return;

  const ux = dx / distance;
  const uy = dy / distance;
  const bend = Math.min(34, distance * 0.07);
  const controlX = (flag.fromX + flag.x) * 0.5 - uy * bend;
  const controlY = (flag.fromY + flag.y) * 0.5 + ux * bend;
  const fade = life > 0.25 ? 1 : life / 0.25;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = fade * 0.62;
  ctx.strokeStyle = 'rgba(22,18,11,0.82)';
  ctx.lineWidth = 3.7 * scale;
  ctx.setLineDash([7 * scale, 7 * scale]);
  ctx.lineDashOffset = -age * 18 * scale;
  ctx.beginPath();
  ctx.moveTo(flag.fromX, flag.fromY);
  ctx.quadraticCurveTo(controlX, controlY, flag.x, flag.y);
  ctx.stroke();

  ctx.globalAlpha = fade * 0.85;
  ctx.strokeStyle = '#d4b860';
  ctx.lineWidth = 1.55 * scale;
  ctx.beginPath();
  ctx.moveTo(flag.fromX, flag.fromY);
  ctx.quadraticCurveTo(controlX, controlY, flag.x, flag.y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const t of [0.3, 0.55, 0.78]) {
    const oneMinusT = 1 - t;
    const x = oneMinusT * oneMinusT * flag.fromX
      + 2 * oneMinusT * t * controlX + t * t * flag.x;
    const y = oneMinusT * oneMinusT * flag.fromY
      + 2 * oneMinusT * t * controlY + t * t * flag.y;
    const tangentX = 2 * oneMinusT * (controlX - flag.fromX) + 2 * t * (flag.x - controlX);
    const tangentY = 2 * oneMinusT * (controlY - flag.fromY) + 2 * t * (flag.y - controlY);
    const tangentLength = Math.hypot(tangentX, tangentY) || 1;
    const tx = tangentX / tangentLength;
    const ty = tangentY / tangentLength;
    const px = -ty;
    const py = tx;
    const backX = x - tx * 6 * scale;
    const backY = y - ty * 6 * scale;
    ctx.beginPath();
    ctx.moveTo(backX + px * 3.2 * scale, backY + py * 3.2 * scale);
    ctx.lineTo(x, y);
    ctx.lineTo(backX - px * 3.2 * scale, backY - py * 3.2 * scale);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOrderFlags(ctx, world) {
  const flags = world.flags;
  if (!flags.length || !cmp.flags || !cmp.flagPulse) return;
  const z = camera.zoom;
  const s = 1 / Math.max(0.62, Math.min(1.45, z)); // readable at every zoom
  const pulse = cmp.flagPulse;

  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const life = cClamp(f.life / f.max, 0, 1);
    const age = 1 - life;

    cDrawMoveRoute(ctx, f, s, life, f.max - f.life);

    // (a) ground pulse over the first ~40% of the flag's life
    if (age < 0.42) {
      const k = age / 0.42;
      const r = (10 + k * 30) * s;
      ctx.globalAlpha = (1 - k) * (1 - k) * 0.85;
      ctx.drawImage(pulse.c, f.x - r, f.y - r * 0.46, r * 2, r * 2 * 0.46);
    }

    // (b) the pennant, fluttering, with a short plant-in hop at spawn
    const kind = f.kind || (f.attack ? 'attack' : f.gather ? 'gather' : f.rally ? 'rally' : 'move');
    const set = cmp.flags[kind] || cmp.flags.move;
    const fr = set[((f.max - f.life) * 13) & 3];
    const hop = age < 0.14 ? (1 - age / 0.14) * 5 * s : 0;
    // fade out over the last 35% only, so the flag is solid while it matters
    ctx.globalAlpha = life > 0.35 ? 1 : life / 0.35;
    ctx.drawImage(fr.c, f.x - fr.ax * s, f.y - fr.ay * s - hop, fr.w * s, fr.h * s);
  }
  ctx.globalAlpha = 1;
}

// ===========================================================================
// 4. RUNTIME — screen-space passes
// ===========================================================================

/**
 * The whole atmosphere, in 3 drawImage + 1 fillRect. Cost is independent of
 * unit count, particle count and everything else in the scene.
 *
 * Must be called with the transform already reset to screen space:
 *   ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
 * (it re-asserts that itself, defensively).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PASS MAY AND MAY NOT TOUCH  (read before reordering draw())
 * ---------------------------------------------------------------------------
 * PASS 2 is a multiply whose corners reach #7E8175 — a ~0.5 multiply — and
 * PASS 3 is a soft-light. Anything drawn BEFORE this call is graded by them.
 * That is exactly right for SCENERY and exactly wrong for INSTRUMENTS, so
 * draw() splits the in-canvas UI in two:
 *
 *   BEFORE (graded — these are painted ON the board and must sit in its light)
 *     cloud shadow, unit selection rings, building footprint rings,
 *     the placement ghost, order flags
 *
 *   AFTER (ungraded — these are read, not looked at)
 *     unit health bars + rout marks, building health / progress / queue bars,
 *     the drag-select box
 *
 * The "after" group is world-space but must outlive the grade, so draw() simply
 * re-asserts the world transform once after this call, draws them, and resets
 * to screen space for the drag box. That is two extra setTransform calls per
 * frame — free — and it is the whole fix for "the composite pass washes out
 * the HUD".
 *
 * The DOM HUD (#hud-top, #panel, #minimap in index.html) is unaffected either
 * way: it lives outside this canvas entirely. Only in-canvas UI is at risk.
 */
function drawLightingPass(ctx, viewW, viewH, devicePR) {
  if (!cmp.grade) return;
  ctx.setTransform(devicePR, 0, 0, devicePR, 0, 0);

  const z = camera.zoom;

  // --- PASS 1 : aerial perspective (additive). Runs FIRST because it is the
  // only pass that can LIFT the far field; a multiply after it will still
  // shape it, which is the correct physical order (scattered light in the air
  // between the viewer and the board, then the board's own falloff).
  // More haze when pulled back = aerial perspective; it is what makes the far
  // corner of a 5200x3200 map recede instead of merely being smaller.
  // The ceiling here MUST be 1. globalAlpha outside [0,1] is not clamped and
  // does not throw — the assignment is discarded and the context keeps its
  // previous value, so an out-of-range multiplier silently produces whatever
  // alpha the last caller happened to leave behind. The old 1.35 ceiling was
  // out of range for every zoom below ~0.88, which is most of the game.
  // Full strength now lives in the baked gradient instead.
  // ATMOS_STRENGTH scales the whole aerial-perspective pass. At full strength
  // the haze washed the board to a flat pale olive and buried the terrain
  // texture underneath it, so it is dialled back to a film of air rather than
  // a fog bank. Tuned by eye against the baked terrain.
  const ATMOS_STRENGTH = 0.34;
  const hazeMul = ATMOS_STRENGTH * cClamp(1.55 - z * 0.62, 0.42, 1)
    // ...and less haze when the camera is already at the north edge, because
    // there is no distance up there left to lose.
    * cClamp((camera.y - ch / 2 / z) / 900, 0.30, 1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = hazeMul;
  ctx.drawImage(cmp.haze, 0, 0, viewW, viewH);
  ctx.globalAlpha = 1;

  // --- PASS 2 : the gallery photoflood's falloff across the board.
  // Simultaneously the grade, the vignette, the depth cue and the reason the
  // world has a frame instead of "running out".
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(cmp.grade, 0, 0, viewW, viewH);

  // --- PASS 3 : warm key / cool fill split. Gives the frame a single tonal
  // identity instead of "whatever each fillStyle happened to be".
  ctx.globalCompositeOperation = 'soft-light';
  ctx.drawImage(cmp.warm, 0, 0, viewW, viewH);

  // --- PASS 4 : table haze. Flat and tiny, but it lifts the blacks off pure
  // and adds the film of air that ties the image together.
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = z < 0.7 ? 'rgba(202,196,170,0.058)' : 'rgba(202,196,170,0.034)';
  ctx.fillRect(0, 0, viewW, viewH);
}

/**
 * Drag-select box, screen space. One rect fill + two strokes + one bracket
 * path. Coordinates are snapped to half-pixels so the 1px lines stay crisp
 * instead of smearing across two device pixels.
 */
function drawDragRect(ctx, dragRect) {
  if (!dragRect) return;
  let x = dragRect.x, y = dragRect.y, w = dragRect.w, h = dragRect.h;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  if (w < 1 || h < 1) return;
  x = Math.round(x) + 0.5; y = Math.round(y) + 0.5;
  w = Math.round(w); h = Math.round(h);

  // interior: a barely-there warm tint, so the box reads as a lit region of
  // the table rather than as a coloured overlay
  ctx.fillStyle = 'rgba(232,220,168,0.055)';
  ctx.fillRect(x, y, w, h);

  // dark halo under the gold, so the box survives over straw, road and sky
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(14,12,8,0.42)';
  ctx.strokeRect(x, y, w, h);

  // the gold rule itself, marching slowly so it reads as active
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(232,220,168,0.92)';
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -(performance.now() * 0.018) % 12;
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // corner brackets — solid, so the extent is unambiguous even mid-dash
  const a = Math.min(16, w * 0.34, h * 0.34);
  if (a > 3) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(244,234,196,0.98)';
    cBracketPath(ctx, x, y, x + w, y + h, a);
    ctx.stroke();
  }
}

// ===========================================================================
// 5. MINIMAP
// ===========================================================================

/**
 * Bake the minimap base. Call ONCE at the end of startBattle(), after
 * buildTerrain() has produced terrainCanvas. Replaces the old `mmTerrain`
 * squashed-thumbnail approach entirely.
 *
 * A photographic downscale of a 5200x3200 painted board turns to mud at
 * 244x150. So instead we posterize it into a five-tone tactical map palette
 * keyed off luminance, with earth and water pulled out by hue. The result is
 * a map that says "wood / field / plough / road / stream" at a glance and is
 * completely independent of how the terrain subsystem happens to be built.
 */
function buildMinimapBase(sourceCanvas) {
  const W = mmCanvas.width, H = mmCanvas.height;
  const inset = 0;                 // map is full-bleed; see C_MM_FRAME
  const iw = W, ih = H;

  C_MM_DW = Math.max(8, iw >> 1);
  C_MM_DH = Math.max(8, ih >> 1);

  // --- scratch: downscale the world board ---------------------------------
  // `sourceCanvas` defaults to render.js's module-level terrainCanvas, but is
  // accepted explicitly so this works whatever the terrain subsystem produces:
  // the current half-res 2600x1600 sheet, a 0.25-res fallback composite, or a
  // purpose-built minimap sheet. Only the ASPECT has to match the world; the
  // resolution is irrelevant because we are posterizing, not photographing.
  const src = sourceCanvas || (typeof terrainCanvas !== 'undefined' ? terrainCanvas : null);
  const sc = document.createElement('canvas');
  sc.width = iw; sc.height = ih;
  // willReadFrequently: the posterize pass below is a getImageData round-trip,
  // and without the hint Chrome keeps this on the GPU and stalls on the read.
  const sg = sc.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'high';
  if (src && src.width) sg.drawImage(src, 0, 0, iw, ih);
  else { sg.fillStyle = '#55613A'; sg.fillRect(0, 0, iw, ih); }

  // --- posterize into the tactical palette --------------------------------
  const img = sg.getImageData(0, 0, iw, ih);
  const d = img.data;
  const TONES = [
    cHex('#2A3520'), // deep wood
    cHex('#3C4A2C'), // wood / hedge
    cHex('#4E5A36'), // shaded field
    cHex('#5F6B3E'), // field
    cHex('#727B49'), // open pasture
    cHex('#87884F'), // dry / straw
  ];
  const EARTH = cHex('#6B563A');
  const WATER = cHex('#42525A');
  const NT = TONES.length - 1;

  for (let p = 0; p < d.length; p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    let out;
    if (b > g + 6 && b > r + 10) {
      // cool + blue-dominant => stream / standing water
      out = WATER;
    } else if (r > g + 8) {
      // warm + red-dominant => road bed, ploughed parcel, bare earth
      const k = cClamp((lum - 0.20) / 0.42, 0, 1);
      out = [
        Math.round(cLerp(EARTH[0] * 0.72, EARTH[0] * 1.28, k)),
        Math.round(cLerp(EARTH[1] * 0.72, EARTH[1] * 1.28, k)),
        Math.round(cLerp(EARTH[2] * 0.72, EARTH[2] * 1.28, k)),
      ];
    } else {
      const t = cClamp((lum - 0.11) / 0.44, 0, 1) * NT;
      const i0 = t | 0, i1 = i0 >= NT ? NT : i0 + 1, f = t - i0;
      const A = TONES[i0], B = TONES[i1];
      out = [
        Math.round(cLerp(A[0], B[0], f)),
        Math.round(cLerp(A[1], B[1], f)),
        Math.round(cLerp(A[2], B[2], f)),
      ];
    }
    d[p] = out[0]; d[p + 1] = out[1]; d[p + 2] = out[2]; d[p + 3] = 255;
  }
  sg.putImageData(img, 0, 0);

  // A whisper of blur knits the posterized tones into regions instead of
  // leaving them as per-pixel confetti, then a light sharpen-by-overlay puts
  // the region edges back.
  sg.filter = 'blur(0.6px)';
  sg.drawImage(sc, 0, 0);
  sg.filter = 'none';

  // --- assemble the base canvas ------------------------------------------
  const [bc, bg] = cCanvas(W, H, false);
  bg.drawImage(sc, inset, inset);

  // paper grain, so the map reads as a printed staff map on the table
  bg.globalCompositeOperation = 'overlay';
  bg.globalAlpha = 0.16;
  for (let i = 0; i < 900; i++) {
    bg.fillStyle = Math.random() < 0.5 ? '#000000' : '#FFFFFF';
    bg.fillRect(cRnd(inset, inset + iw), cRnd(inset, inset + ih), 1, 1);
  }
  bg.globalAlpha = 1;
  bg.globalCompositeOperation = 'source-over';

  // the same spotlight falloff the main view gets, so the two agree
  const vg = bg.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.30,
    W * 0.5, H * 0.46, Math.hypot(W, H) * 0.62);
  vg.addColorStop(0, 'rgba(255,241,206,0.07)');
  vg.addColorStop(0.6, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,24,14,0.34)');
  bg.fillStyle = vg;
  bg.fillRect(inset, inset, iw, ih);

  cmp.mmBase = bc;

  // --- frame overlay, drawn LAST every redraw so nothing spills onto it ----
  const [fc, fg] = cCanvas(W, H, false);
  const fw = C_MM_FRAME;
  fg.strokeStyle = C_UI.frame;
  fg.lineWidth = fw;
  fg.strokeRect(fw / 2, fw / 2, W - fw, H - fw);
  fg.strokeStyle = C_UI.frameLit;
  fg.lineWidth = 1;
  fg.strokeRect(fw - 0.5, fw - 0.5, W - fw * 2 + 1, H - fw * 2 + 1);
  fg.strokeStyle = 'rgba(20,22,15,0.85)';
  fg.strokeRect(0.5, 0.5, W - 1, H - 1);
  // corner nails, matching the HUD's brass-and-leather look
  fg.fillStyle = C_UI.goldDeep;
  for (const [nx, ny] of [[2.5, 2.5], [W - 2.5, 2.5], [2.5, H - 2.5], [W - 2.5, H - 2.5]]) {
    fg.beginPath(); fg.arc(nx, ny, 1.3, 0, 6.2832); fg.fill();
  }
  cmp.mmFrame = fc;

  // --- density buffers ----------------------------------------------------
  const [uc, ug] = cCanvas(C_MM_DW, C_MM_DH, false);
  cmp.mmUnits = uc;
  cmp.mmUnitsCtx = ug;
  cmp.mmImg = ug.createImageData(C_MM_DW, C_MM_DH);
  cmp.mmD0 = new Int16Array(C_MM_DW * C_MM_DH);
  cmp.mmD1 = new Int16Array(C_MM_DW * C_MM_DH);

  // --- wear / battle-heat buffers -----------------------------------------
  // Accumulated by mmNoteEvent (which effects.js fxNoteDecal drives from the
  // existing pendingDecals flush). Rebuilt here, so a rematch starts clean.
  const [hc, hg] = cCanvas(C_MM_DW, C_MM_DH, false);
  cmp.mmHeatCv = hc;
  cmp.mmHeatCtx = hg;
  cmp.mmHeatImg = hg.createImageData(C_MM_DW, C_MM_DH);
  cmp.mmHeat = new Float32Array(C_MM_DW * C_MM_DH);
  cmp.mmHeatDirty = true;
}

/**
 * Rasterise the battle-heat grid. Only runs when mmNoteEvent has actually
 * added something since the last redraw, so a quiet minute costs nothing.
 *
 * The stain is a churned-earth brown drawn under the unit layer at 'multiply',
 * i.e. it DARKENS AND WARMS the map where men have died rather than painting a
 * coloured overlay on top of it — the same reasoning that makes blood pools
 * multiply onto the ground in the decal spec instead of sitting over it.
 */
function cRasterHeat() {
  const heat = cmp.mmHeat;
  if (!heat || !cmp.mmHeatDirty) return;
  cmp.mmHeatDirty = false;
  const img = cmp.mmHeatImg, d = img.data;
  const n = heat.length;
  for (let i = 0; i < n; i++) {
    const v = heat[i];
    const p = i << 2;
    if (v <= 0) { d[p + 3] = 0; continue; }
    // saturating response: heavy early return, then a long slow deepening, so
    // a skirmish still registers and a five-minute grind does not clip flat
    const t = 1 - Math.exp(-v * 0.085);
    d[p] = 96 - 34 * t;          // warm umber, never neutral grey
    d[p + 1] = 78 - 30 * t;
    d[p + 2] = 58 - 24 * t;
    d[p + 3] = (30 + 150 * t) | 0;
  }
  cmp.mmHeatCtx.putImageData(img, 0, 0);
}

let cMmT = 0;

/**
 * Minimap redraw. Throttled to ~11 Hz as before.
 *
 * Unit plotting is density accumulation: ~6 integer ops per unit into an
 * Int16Array, then ONE colourise loop over 9,150 cells, ONE putImageData and
 * ONE smoothed upscale drawImage. That replaces up to 6,400 fillRects each
 * preceded by a fillStyle assignment. It is strictly cheaper AND it is better
 * information, because adjacent men now blur into a formation blob that
 * actually reads as a line or a column.
 */
function drawMinimap(world) {
  const now = performance.now();
  if (now - cMmT < 90) return;
  cMmT = now;
  if (!cmp.mmBase) return;

  const W = mmCanvas.width, H = mmCanvas.height;
  const inset = 0;                 // full-bleed, so minimapToWorld stays exact
  const iw = W, ih = H;
  const sx = iw / WORLD.w, sy = ih / WORLD.h;
  const g = mmCtx;

  // ---- 1. baked terrain --------------------------------------------------
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.drawImage(cmp.mmBase, 0, 0);

  // ---- 2. wear layer: where the fighting has already been -----------------
  // TWO independent sources, both optional, both 'multiply' so they stain the
  // board rather than sitting on it:
  //
  //   (a) the decal subsystem's real trample canvas, if one has been injected
  //       via setCompositeTrampleLayer(getTrampleCanvas()).
  //   (b) the battle-heat grid, which works with the SHIPPED codebase because
  //       it is fed by mmNoteEvent from the pendingDecals flush. Without this
  //       the wear layer is simply absent until decals.js lands, and "where has
  //       the fighting been" — the one question a minimap answers that the main
  //       view cannot — goes unanswered.
  g.globalCompositeOperation = 'multiply';
  if (cTrampleRef && cTrampleRef.width) {
    g.globalAlpha = 0.40;
    g.drawImage(cTrampleRef, inset, inset, iw, ih);
  }
  if (cmp.mmHeatCv) {
    cRasterHeat();
    g.globalAlpha = 0.85;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cmp.mmHeatCv, inset, inset, iw, ih);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  // ---- 3. dim the ground outside the camera viewport ----------------------
  // (before units, so off-screen threats stay at full brightness)
  const turned = Math.abs(Math.sin(camera.rotation || 0)) > 0.5;
  const vw = (turned ? ch : cw) / camera.zoom * sx;
  const vh = (turned ? cw : ch) / camera.zoom * sy;
  let vx = inset + camera.x * sx - vw / 2, vy = inset + camera.y * sy - vh / 2;
  g.fillStyle = 'rgba(12,15,9,0.26)';
  const l = Math.max(inset, vx), t = Math.max(inset, vy);
  const r = Math.min(inset + iw, vx + vw), b = Math.min(inset + ih, vy + vh);
  g.fillRect(inset, inset, iw, Math.max(0, t - inset));
  g.fillRect(inset, b, iw, Math.max(0, inset + ih - b));
  g.fillRect(inset, t, Math.max(0, l - inset), Math.max(0, b - t));
  g.fillRect(r, t, Math.max(0, inset + iw - r), Math.max(0, b - t));

  // ---- 4. resources: muted, they are terrain not threat -------------------
  // Sized by the node's actual radius (economy.js seeds clusters at r 38-72,
  // so a great forest genuinely reads bigger than a berry patch) and DIMMED as
  // it depletes, which is the only strategic fact about a node that changes.
  // A worked-out mine that still plots at full strength is worse than no mark.
  const res = world.resources;
  for (let i = 0; i < res.length; i++) {
    const rn = res[i];
    if (!rn.alive || rn.amount <= 0) continue;
    const frac = rn.maxAmount > 0 ? rn.amount / rn.maxAmount : 1;
    const rx = Math.max(1.6, rn.radius * sx * 0.85);
    const ry = Math.max(1.2, rn.radius * sy * 0.85);
    const px = inset + rn.x * sx, py = inset + rn.y * sy;

    // a dark seat under the mark so it reads against pale straw parcels
    g.globalAlpha = 0.34 + 0.30 * frac;
    g.fillStyle = '#1B2016';
    g.beginPath(); g.ellipse(px + 0.5, py + 0.5, rx + 0.8, ry + 0.8, 0, 0, 6.2832); g.fill();

    g.globalAlpha = 0.30 + 0.70 * frac;
    g.fillStyle = rn.type === 'wood' ? '#33512F'
      : rn.type === 'food' ? '#8A6E3A'
        : rn.type === 'gold' ? '#B2933A' : '#7E8079';
    g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, 6.2832); g.fill();

    // key-lit crescent on the up-left, so even the map obeys C_SUN
    g.globalAlpha = (0.30 + 0.70 * frac) * 0.55;
    g.fillStyle = rn.type === 'gold' ? '#E8CF7A'
      : rn.type === 'stone' ? '#B8B9B0'
        : rn.type === 'wood' ? '#4E7345' : '#C2A268';
    g.beginPath();
    g.ellipse(px + C_SUN.x * rx * 0.30, py + C_SUN.y * ry * 0.30,
      rx * 0.58, ry * 0.58, 0, 0, 6.2832);
    g.fill();
  }
  g.globalAlpha = 1;

  // ---- 5. units by density accumulation ----------------------------------
  const DW = C_MM_DW, DH = C_MM_DH;
  const d0 = cmp.mmD0, d1 = cmp.mmD1;
  d0.fill(0); d1.fill(0);
  const kx = DW / WORLD.w, ky = DH / WORLD.h;
  const units = world.active && world.active.length ? world.active : world.units;
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.alive) continue;
    let gx = (u.x * kx) | 0; if (gx < 0) gx = 0; else if (gx >= DW) gx = DW - 1;
    let gy = (u.y * ky) | 0; if (gy < 0) gy = 0; else if (gy >= DH) gy = DH - 1;
    // cavalry counts double: the fast-moving flank threat has to read
    const wgt = u.type === 'cav' ? 2 : u.type === 'gun' ? 3 : 1;
    if (isPlayerTeam(world, u.side)) d0[gy * DW + gx] += wgt;
    else d1[gy * DW + gx] += wgt;
  }

  const img = cmp.mmImg, data = img.data;
  const A0 = C_MM_SIDE_DIM[0], B0 = C_MM_SIDE_LIT[0];
  const A1 = C_MM_SIDE_DIM[1], B1 = C_MM_SIDE_LIT[1];
  const CT = C_MM_CONTEST;
  const cells = DW * DH;
  for (let i = 0; i < cells; i++) {
    const c0 = d0[i], c1 = d1[i];
    const p = i << 2;
    if (c0 === 0 && c1 === 0) { data[p + 3] = 0; continue; }
    const tot = c0 + c1;
    const s = tot >= 7 ? 1 : tot / 7;            // brightness ramp by density
    let R, G, B;
    if (c0 >= c1) { R = A0[0] + (B0[0] - A0[0]) * s; G = A0[1] + (B0[1] - A0[1]) * s; B = A0[2] + (B0[2] - A0[2]) * s; }
    else { R = A1[0] + (B1[0] - A1[0]) * s; G = A1[1] + (B1[1] - A1[1]) * s; B = A1[2] + (B1[2] - A1[2]) * s; }
    if (c0 > 0 && c1 > 0) {
      // Contested cell: pull toward hot gold. Melee fronts glow, which is
      // exactly the thing a commander needs to find without looking away.
      const mix = Math.min(1, (c0 < c1 ? c0 : c1) / 3) * 0.72;
      R += (CT[0] - R) * mix; G += (CT[1] - G) * mix; B += (CT[2] - B) * mix;
    }
    data[p] = R; data[p + 1] = G; data[p + 2] = B;
    data[p + 3] = 165 + 90 * s;
  }
  cmp.mmUnitsCtx.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cmp.mmUnits, inset, inset, iw, ih);

  // ---- 6. buildings: distinct SHAPES, never merged into the unit blur -----
  //
  // Four glyphs, chosen so the map answers the four questions a commander
  // actually asks of a settlement, by silhouette rather than by colour — at
  // 4-7 px, two side hues plus eleven building types cannot be separated by
  // hue alone, and one in twelve male players cannot separate the two side
  // hues at all:
  //
  //   DIAMOND  town centre — the objective. Never mistakeable for a house.
  //   CHEVRON  watch tower — a threat that shoots back; points at the enemy.
  //   BAR      farm        — flat on the ground, occupies area, not a structure.
  //   SQUARE   everything else.
  //
  // Incomplete buildings are drawn as an OUTLINE in parchment rather than a
  // filled side colour: a foundation is a commitment, not yet an asset, and it
  // is the thing a raiding cavalry wing most wants to find.
  const bs = world.buildings;
  for (let i = 0; i < bs.length; i++) {
    const bd = bs[i];
    if (!bd.alive) continue;
    const bx = inset + bd.x * sx, by = inset + bd.y * sy;
    const type = bd.type;
    const big = type === 'town_center';
    const sz = big ? 7.5 : type === 'tower' ? 4.5 : type === 'farm' ? 5 : 4.5;
    const fill = C_SIDE_RIM_LIT[bd.side] || C_SIDE_RIM_LIT[1];

    // dark seat: every glyph gets one, so all of them read on any tone
    g.fillStyle = 'rgba(12,14,9,0.82)';
    if (type === 'farm') g.fillRect(bx - sz - 1, by - sz * 0.42 - 1, sz * 2 + 2, sz * 0.84 + 2);
    else g.fillRect(bx - sz / 2 - 1.2, by - sz / 2 - 1.2, sz + 2.4, sz + 2.4);

    if (!bd.complete) {
      // under construction — hollow, so it never reads as a working asset
      g.strokeStyle = 'rgba(214,202,158,0.92)';
      g.lineWidth = 1.2;
      g.strokeRect(bx - sz / 2 + 0.5, by - sz / 2 + 0.5, sz - 1, sz - 1);
      continue;
    }

    g.fillStyle = fill;
    if (big) {
      g.beginPath();
      g.moveTo(bx, by - sz * 0.72); g.lineTo(bx + sz * 0.72, by);
      g.lineTo(bx, by + sz * 0.72); g.lineTo(bx - sz * 0.72, by);
      g.closePath(); g.fill();
      g.strokeStyle = C_UI.goldBright; g.lineWidth = 1; g.stroke();
    } else if (type === 'tower') {
      // chevron pointing across the map at the opposing base, so a defended
      // approach is legible as an arc of arrowheads rather than a row of dots
      const dir = sideFrontDirection(world, bd.side);
      g.beginPath();
      g.moveTo(bx + dir * sz * 0.70, by);
      g.lineTo(bx - dir * sz * 0.42, by - sz * 0.62);
      g.lineTo(bx - dir * sz * 0.12, by);
      g.lineTo(bx - dir * sz * 0.42, by + sz * 0.62);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,246,222,0.72)'; g.lineWidth = 0.8; g.stroke();
    } else if (type === 'farm') {
      // a low bar: a farm is a worked parcel, not a building with a roof
      g.fillRect(bx - sz, by - sz * 0.42, sz * 2, sz * 0.84);
      g.strokeStyle = 'rgba(20,24,14,0.55)'; g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(bx - sz, by); g.lineTo(bx + sz, by);
      g.stroke();
    } else {
      g.fillRect(bx - sz / 2, by - sz / 2, sz, sz);
      // up-left key facet, matching C_SUN, so the map is lit like the field
      g.fillStyle = 'rgba(255,246,222,0.30)';
      g.fillRect(bx - sz / 2, by - sz / 2, sz, sz * 0.34);
    }
  }

  // ---- 7. combat pings ---------------------------------------------------
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < C_PING_MAX; i++) {
    const p = i * 4;
    const born = cPings[p + 2];
    if (born === 0) continue;
    const age = (now - born) / 1400;
    if (age >= 1) { cPings[p + 2] = 0; continue; }
    const kind = cPings[p + 3];
    const rr = (kind === 2 ? 9 : kind === 1 ? 6 : 3.2) * (0.4 + age * 1.3);
    g.globalAlpha = (1 - age) * (1 - age) * (kind === 0 ? 0.55 : 0.9);
    g.strokeStyle = kind === 1 ? '#FFB870' : '#FFE9B0';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(inset + cPings[p] * sx, inset + cPings[p + 1] * sy, rr, 0, 6.2832);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  // ---- 8. camera viewport ------------------------------------------------
  vx = Math.round(vx) + 0.5; vy = Math.round(vy) + 0.5;
  const rw = Math.round(vw), rh = Math.round(vh);
  g.strokeStyle = 'rgba(10,12,7,0.75)';
  g.lineWidth = 3;
  g.strokeRect(vx, vy, rw, rh);
  g.strokeStyle = C_UI.gold;
  g.lineWidth = 1;
  g.strokeRect(vx, vy, rw, rh);
  const arm = Math.min(9, rw * 0.3, rh * 0.3);
  if (arm > 2) {
    g.strokeStyle = C_UI.goldBright;
    g.lineWidth = 1.8;
    cBracketPath(g, vx, vy, vx + rw, vy + rh, arm);
    g.stroke();
  }

  // ---- 9. frame last, so nothing bleeds over the border -------------------
  g.drawImage(cmp.mmFrame, 0, 0);
}
export { setCompositeRefs, setCompositeView, setCompositeTrampleLayer,
         buildCompositeTextures, buildMinimapBase, drawLightingPass,
         visibleTowerAttackRange, drawTowerAttackRanges,
         drawSelection, drawHealthBars, drawOrderFlags, drawDragRect,
         drawMinimap };
