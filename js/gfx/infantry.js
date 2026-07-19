/* ============================================================================
   COSSACKS: LINE OF FIRE  —  INFANTRY SPRITE PAINTER
   Subsystem: drawSoldier()  (musketeers AND pikemen)
   Direction: KRIEGSSPIEL TABLE — painted 1:72 miniatures under a gallery
              photoflood mounted up and to the left.

   EVERYTHING IN THIS FILE RUNS ONCE, AT BATTLE START, INTO AN OVERSAMPLED
   OFFSCREEN ATLAS FRAME. There is no per-frame cost to any of it. ctx.filter,
   gradients, save/restore, compositing modes and multi-pass washes are all
   legal here and are used lavishly. The runtime hot loop is untouched: still
   exactly one drawImage per unit.

   The painter produces, per frame:
     - a 5-value acrylic ramp (line / shade / base / lit / edge) derived
       PROGRAMMATICALLY from nat.coat, nat.trim, nat.skin, so any nation added
       to config.js is handled for free;
     - single-sided edge lighting on the up-left boundary of every form,
       obeying ONE sun vector;
     - three whole-figure unifying passes (gallery light, blurred recess wash,
       matte varnish) so the stack of parts reads as one physical painted
       object rather than as a pile of rectangles;
     - an 8-way dilated painted LINING beneath the artwork, plus a second
       asymmetric AO lining along the shadow axis, so the figure survives on
       any terrain and ranks do not fuse into a smear;
     - a baked radial CONTACT SHADOW and a side-tinted trodden-earth scuff at
       the anchor point — a large, never-occluded block of team colour under
       every man, at zero runtime cost.

   Sprite box (see sprite_box_changes):  w 28, h 28, ax 14, ay 23.5
   ========================================================================== */


/* ---------------------------------------------------------------------------
   0. SPRITE BOX + THE ONE SUN
   ------------------------------------------------------------------------ */

const INF_W  = 28;     // frame width  in world units
const INF_H  = 30;     // frame height in world units
const INF_AX = 14;     // anchor x — MUST be INF_W/2 so the mirrored (facing
                       // left) copy shares the same anchor
const INF_AY = 23.5;   // anchor y — the ground contact point under the boots

// The single gallery photoflood. Nothing in the renderer may invent another.
const SUN = {
  x: -0.64, y: -0.77,                 // unit vector TOWARD the light (up-left)
  elevDeg: 38,
  shadow: { x: 0.64, y: 0.77 },       // direction cast shadows fall
  lenMul: 0.55,
  squash: 0.42,
  key: '#FFF1CE',                     // warm photoflood
  fill: '#8FA4C4',                    // cool room bounce
  bounce: '#B9A277',                  // warm kick off the board
  shadowRGB: '26,30,48',              // cool violet — never pure black
};

// Materials that are not nation-driven.
const MAT = {
  breechMusk: '#4A4231',   // wool breeches
  breechPike: '#3E3A2C',   // pikemen wear heavier, darker cloth
  gaiter:     '#2A251D',   // black marching gaiters
  shoe:       '#1E1A15',
  stock:      '#6B4A28',   // musket / pike woodwork
  steel:      '#8A9099',   // barrel, spearhead, helmet
  darkSteel:  '#5B626C',
  brass:      '#AE8737',   // furniture, buttons
  buff:       '#E3DCC5',   // crossbelt / bandolier leather
  hatFelt:    '#20222A',   // black felt tricorn
  hair:       '#3A2E22',
  scuffEarth: '#7A5F3E',   // trodden earth for the contact scuff
};

// How much of the side colour bleeds into the ground scuff. The graft called
// for the painted base rim reframed painterly: side-tinted trodden earth at
// roughly 40% of a wargame base rim's chroma, so it reads as churned ground
// rather than as a plastic base, while still guaranteeing an unoccluded block
// of team colour under every figure.
const RIM_CHROMA = 0.42;

// Force-clamp for the derived lining colour. Guarantees a legible outline for
// ANY coat value a user might add to NATIONS — a very dark coat would
// otherwise produce a lining that vanishes into its own fill.
const LINE_LUM_MAX = 58;   // relative luminance, 0..255


/* ---------------------------------------------------------------------------
   1. COLOUR UTILITIES  (self-contained; no imports)
   ------------------------------------------------------------------------ */

/**
 * DETERMINISTIC noise. Bake-time randomness MUST be reproducible across the
 * frames of one animation: the ground scuff is painted identically into every
 * pose of a given unit type, so if it used Math.random() the speckle would
 * change from frame to frame and the walk cycle would visibly crawl. Anything
 * that is part of the *figure* may vary per frame; anything anchored to the
 * ground may not.
 */
function makeRnd(seed) {
  let s = (seed | 0) || 1;
  return function (a, b) {
    s = (s * 1664525 + 1013904223) | 0;
    return a + ((s >>> 8) / 16777216) * (b - a);
  };
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/** Parse '#rgb' or '#rrggbb' (or a bare 6-hex string) into [r,g,b]. */
function parseHex(hex) {
  let h = String(hex).trim();
  if (h.charCodeAt(0) === 35) h = h.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0], 16), g = parseInt(h[1], 16), b = parseInt(h[2], 16);
    return [r * 17, g * 17, b * 17];
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(c) {
  const r = clamp255(Math.round(c[0])), g = clamp255(Math.round(c[1])), b = clamp255(Math.round(c[2]));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** Linear sRGB-space mix of two [r,g,b] triples. t=0 -> a, t=1 -> b. */
function mixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mixHex(a, b, t) { return toHex(mixRGB(parseHex(a), parseHex(b), t)); }

function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

/**
 * Force the lining below LINE_LUM_MAX, verifying AFTER integer rounding.
 * A single multiplicative scale is not sufficient: toHex() rounds each
 * channel, and rounding up can push a just-compliant colour back over the
 * ceiling (a near-white coat lands at 58.2 with a one-shot scale). Iterating
 * against the rounded value is what makes the guarantee actually hold.
 */
function clampLineLum(c) {
  let out = c;
  for (let i = 0; i < 8; i++) {
    const r = [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])];
    if (lum(r) <= LINE_LUM_MAX) return r;
    out = scaleLight(out, Math.min(0.99, (LINE_LUM_MAX - 0.5) / lum(r)));
  }
  return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])];
}

function rgba(c, a) {
  return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
}

/** Nudge a colour's lightness multiplicatively, preserving hue. */
function scaleLight(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

/**
 * Push a colour away from grey (saturate) or toward it (desaturate).
 * amount > 1 saturates, < 1 desaturates.
 */
function chroma(c, amount) {
  const l = lum(c);
  return [l + (c[0] - l) * amount, l + (c[1] - l) * amount, l + (c[2] - l) * amount];
}

/* --- THE ACRYLIC RAMP -----------------------------------------------------
   Every material in the figure — coat, trim, skin, felt, wood, steel, brass,
   leather — is expanded at bake time from one basecoat into five painted
   values. This is the standard miniature-painter's layering method:
     SHADE  a cool, hue-shifted recess wash
     BASE   the basecoat as authored in config.js
     LIT    a warm drybrush on the sun-facing planes
     EDGE   an extreme edge highlight, applied ONLY on the up-left boundary
     LINE   a material-tinted lining, so the outline reads as painted black
            rather than as a vector stroke — force-clamped in luminance so it
            is guaranteed legible against its own fill for ANY input colour.
   ------------------------------------------------------------------------ */
function ramp(hex) {
  const B = parseHex(hex);
  const shade = mixRGB(B, [0x1B, 0x20, 0x33], 0.42);
  const lit   = mixRGB(B, [0xFF, 0xE9, 0xBC], 0.30);
  const edge  = mixRGB(B, [0xFF, 0xF6, 0xDE], 0.62);

  const line = clampLineLum(mixRGB(B, [0x14, 0x10, 0x0C], 0.78));

  const deep  = mixRGB(shade, [0x10, 0x12, 0x1E], 0.38);   // deepest AO
  const glow  = mixRGB(B, parseHex(SUN.bounce), 0.22);     // ground bounce

  return {
    rgb: B,
    base:  toHex(B),
    baseRGB: B,
    shade: toHex(shade), shadeRGB: shade,
    lit:   toHex(lit),   litRGB: lit,
    edge:  toHex(edge),  edgeRGB: edge,
    line:  toHex(line),  lineRGB: line,
    deep:  toHex(deep),  deepRGB: deep,
    glow:  toHex(glow),
  };
}

/** A copy of a ramp pushed toward its own shade — used for far-side limbs. */
function dimRamp(r, t) {
  const b = mixRGB(r.baseRGB, r.shadeRGB, t);
  return ramp(toHex(mixRGB(b, [0x1B, 0x20, 0x33], t * 0.35)));
}


/* ---------------------------------------------------------------------------
   2. LIT-FORM PRIMITIVES
   Every filled form obeys the same rule: a gradient running along the sun's
   shadow axis from LIT through BASE to SHADE, plus a single-sided EDGE
   highlight on the up-left boundary only. A double-sided highlight reads as
   an outline; a single-sided one reads as a lit object.
   ------------------------------------------------------------------------ */

/** Linear gradient across a bbox, running along +SUN.shadow. */
function rampGrad(g, x, y, w, h, r) {
  const L = Math.max(0.001, w * Math.abs(SUN.shadow.x) + h * Math.abs(SUN.shadow.y));
  const gr = g.createLinearGradient(x, y, x + L * SUN.shadow.x, y + L * SUN.shadow.y);
  gr.addColorStop(0.00, r.lit);
  gr.addColorStop(0.26, r.base);
  gr.addColorStop(0.62, r.base);
  gr.addColorStop(1.00, r.shade);
  return gr;
}

/** Same, but stronger — for large flat planes that need more modelling. */
function rampGradDeep(g, x, y, w, h, r) {
  const L = Math.max(0.001, w * Math.abs(SUN.shadow.x) + h * Math.abs(SUN.shadow.y));
  const gr = g.createLinearGradient(x, y, x + L * SUN.shadow.x, y + L * SUN.shadow.y);
  gr.addColorStop(0.00, r.edge);
  gr.addColorStop(0.14, r.lit);
  gr.addColorStop(0.40, r.base);
  gr.addColorStop(0.70, r.base);
  gr.addColorStop(1.00, r.deep);
  return gr;
}

function segGrad(g, x0, y0, x1, y1, pad, r) {
  const minx = Math.min(x0, x1) - pad, miny = Math.min(y0, y1) - pad;
  return rampGrad(g, minx, miny, Math.abs(x1 - x0) + pad * 2, Math.abs(y1 - y0) + pad * 2, r);
}

/** A lit, edge-highlighted rectangle. */
function litRect(g, x, y, w, h, r, opts) {
  const o = opts || {};
  g.fillStyle = o.deep ? rampGradDeep(g, x, y, w, h, r) : rampGrad(g, x, y, w, h, r);
  g.fillRect(x, y, w, h);
  if (o.edge !== false) {
    g.save();
    g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.lineWidth = o.edgeW || 0.28;
    g.strokeStyle = r.edge;
    g.globalAlpha = o.edgeA == null ? 0.7 : o.edgeA;
    const i = g.lineWidth * 0.5;
    g.beginPath();
    g.moveTo(x + i, y + h);      // up the left face
    g.lineTo(x + i, y + i);
    g.lineTo(x + w, y + i);      // across the top face
    g.stroke();
    g.restore();
  }
}

/**
 * A lit, edge-highlighted path. pathFn builds the path on g.
 *
 * THE RIM CONSTRUCTION. Clip to the form, then stroke the SAME outline with a
 * fat pen whose centreline has been pushed by +w along the shadow axis
 * (i.e. AWAY from the light). Work it through in 1-D: let s measure distance
 * along the shadow axis with the boundary at s=0.
 *   - On the up-left boundary the interior lies at s > 0. The displaced pen
 *     (centre s=+w, half-width w) covers s in [0, 2w] — entirely inside, so a
 *     band of EDGE survives flush against the boundary. This is the rim light.
 *   - On the down-right boundary the interior lies at s < 0. The same pen
 *     covers [0, 2w], which is entirely OUTSIDE, so the clip erases it.
 * A single-sided highlight is what makes a form read as lit; a highlight on
 * both boundaries just reads as an outline.
 */
function litPath(g, pathFn, bx, by, bw, bh, r, opts) {
  const o = opts || {};
  g.beginPath(); pathFn(g);
  g.fillStyle = o.deep ? rampGradDeep(g, bx, by, bw, bh, r) : rampGrad(g, bx, by, bw, bh, r);
  g.fill();
  if (o.edge !== false) {
    const w = o.edgeW || 0.30;
    g.save();
    g.beginPath(); pathFn(g); g.clip();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = w * 2;
    g.strokeStyle = r.edge;
    g.globalAlpha = o.edgeA == null ? 0.72 : o.edgeA;
    g.translate(SUN.shadow.x * w, SUN.shadow.y * w);
    g.beginPath(); pathFn(g);
    g.stroke();
    g.restore();
  }
}

/** A lit ellipse. */
function litEllipse(g, cx, cy, rx, ry, rot, r, opts) {
  litPath(g, (c) => c.ellipse(cx, cy, rx, ry, rot, 0, 7),
    cx - rx, cy - ry, rx * 2, ry * 2, r, opts);
}

/**
 * A limb / weapon segment: a tapered round-capped stroke carrying the sun
 * gradient, with a thin single-sided rim light on whichever side of the
 * segment faces the light.
 */
function bone(g, r, x0, y0, x1, y1, w, opts) {
  const o = opts || {};
  g.save();
  g.lineCap = o.cap || 'round';
  g.lineJoin = 'round';
  g.lineWidth = w;
  g.strokeStyle = segGrad(g, x0, y0, x1, y1, w * 0.5, r);
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();

  if (o.edge !== false) {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    if (nx * SUN.x + ny * SUN.y < 0) { nx = -nx; ny = -ny; }   // pick the sunward normal
    const off = w * 0.5 - w * 0.17;
    g.lineWidth = Math.max(0.16, w * 0.24);
    g.strokeStyle = r.edge;
    g.globalAlpha = o.edgeA == null ? 0.6 : o.edgeA;
    g.beginPath();
    g.moveTo(x0 + nx * off, y0 + ny * off);
    g.lineTo(x1 + nx * off, y1 + ny * off);
    g.stroke();
  }
  g.restore();
}

/** A three-point limb: shoulder -> elbow -> hand, tapering. */
function arm(g, r, sx, sy, ex, ey, hx, hy, wUpper, wLower) {
  bone(g, r, sx, sy, ex, ey, wUpper);
  bone(g, r, ex, ey, hx, hy, wLower);
}

/** Chunky, deliberately oversized hand — heroic-28mm convention. */
function hand(g, r, x, y, s) {
  litEllipse(g, x, y, s, s * 0.86, 0, r, { edgeW: 0.22, edgeA: 0.8 });
}

/**
 * Local ambient occlusion pooled where two forms meet.
 *
 * NOTE the compositing mode. 'multiply' would be the painterly choice, but on
 * a mostly-transparent frame canvas a separable blend mode falls back to
 * source-over wherever the backdrop is transparent — so a multiply AO blob
 * would paint solid darkness into empty space beside the figure, and that
 * darkness would then be swept up by the lining silhouette into a permanent
 * ghost halo. 'source-atop' clips to already-painted pixels, which is exactly
 * the intent: darken the figure, never the air around it.
 */
function contactAO(g, cx, cy, rx, ry, a) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.translate(cx, cy); g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, 'rgba(38,32,26,' + a + ')');
  gr.addColorStop(0.55, 'rgba(38,32,26,' + (a * 0.45) + ')');
  gr.addColorStop(1, 'rgba(38,32,26,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill();
  g.restore();
}


/* ---------------------------------------------------------------------------
   3. WHOLE-FRAME PASSES
   These are what make a stack of independently painted parts read as one
   physical object sitting under one lamp.
   ------------------------------------------------------------------------ */

/** Solid-colour silhouette of a frame canvas, as a new canvas. */
function silhouetteOf(src, fill) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const s = c.getContext('2d');
  s.drawImage(src, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = fill;
  s.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * PASS A — UNIFYING GALLERY LIGHT.
 * One linear gradient along the sun axis, clipped to painted pixels by
 * 'source-atop'. Shades coat, head, legs, hat and weapon consistently with a
 * single operation, which no amount of per-part shading can fake.
 */
function passGalleryLight(g, w, h) {
  const L = w * Math.abs(SUN.shadow.x) + h * Math.abs(SUN.shadow.y);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, L * SUN.shadow.x, L * SUN.shadow.y);
  gr.addColorStop(0.00, 'rgba(255,236,190,0.26)');
  gr.addColorStop(0.42, 'rgba(255,236,190,0)');
  gr.addColorStop(0.62, 'rgba(24,20,42,0)');
  gr.addColorStop(1.00, 'rgba(24,20,42,0.34)');
  g.fillStyle = gr;
  g.fillRect(-2, -2, w + 4, h + 4);
  g.restore();
}

/**
 * PASS B — RECESS WASH.
 * Multiply the frame's own blurred silhouette back over itself. Darkness
 * pools in interior crevices — under the hat brim, between the arm and the
 * torso, inside the coat skirt — exactly as a Citadel shade wash does.
 * ctx.filter is legal here: this is bake-time code.
 *
 * The blur is masked back to the figure ('destination-in' against the
 * original) BEFORE it is composited. Without that mask the blur halo extends
 * past the silhouette, and multiply-over-transparent degenerates to
 * source-over, so the figure would acquire a dark smudge ring that the lining
 * pass would then bake in permanently.
 */
function passRecessWash(g, S) {
  const src = g.canvas;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const s = c.getContext('2d');

  // BLUR THE FRAME, NOT THE SILHOUETTE. Blurring a solid silhouette and
  // multiplying it back is a no-op in the interior: the blur of a solid region
  // is still solid, so every pixel more than a blur-radius from the outline
  // gets the SAME multiplier. That is not a shade wash, it is a flat ~27%
  // darkening of the entire figure — which is precisely how a painted sprite
  // goes muddy, and it stacks on top of the gallery-light gradient's 0.34
  // darkening in the lower right.
  //
  // Blurring the frame's own COLOUR instead makes the multiplier a function of
  // each pixel's neighbourhood: bright sun-facing planes are multiplied by
  // something near white and barely move, while pixels sitting next to dark
  // neighbours — under the hat brim, in the gap between arm and torso, inside
  // the coat skirt, along the lining — are multiplied by something dark and
  // pool. That is what a Citadel shade wash actually does.
  s.filter = 'blur(' + (S * 0.42).toFixed(2) + 'px)';
  s.drawImage(src, 0, 0);
  s.filter = 'none';

  // Lift the wash toward white so it can only pool, never crush. A bright
  // plane ends up at ~0.94x, a deep crevice at ~0.73x.
  s.globalCompositeOperation = 'source-atop';
  s.fillStyle = 'rgba(255,252,244,0.42)';
  s.fillRect(0, 0, c.width, c.height);

  s.globalCompositeOperation = 'destination-in';   // confine to the figure
  s.drawImage(src, 0, 0);

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.55;
  g.drawImage(c, 0, 0);
  g.restore();
}

/**
 * PASS C — MATTE VARNISH.
 * A flat scattering film. Kills any impression of gloss and pulls every
 * nation's palette into one painted family.
 */
function passMatteVarnish(g, w, h) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(238,232,214,0.045)';
  g.fillRect(-2, -2, w + 4, h + 4);
  g.restore();
}

/**
 * PASS D — LINING.
 * An 8-way dilation of the silhouette painted UNDERNEATH the artwork via
 * 'destination-over'. This is the mechanism by which Cossacks and AoE2 kept a
 * 60-man block reading as sixty men. Deployment spacing is 12 world px
 * against a ~17-unit figure, so without lining ranks fuse into a smear.
 *
 * A second, asymmetric ring offset along +SUN.shadow at reduced alpha reads
 * as ambient occlusion and lifts the figure off the ground.
 */
function passLining(g, S, tintHex) {
  const sil = silhouetteOf(g.canvas, tintHex || '#131019');
  const d = Math.max(1, Math.round(S * 0.60));   // ~0.6 world units of outline
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';

  // ring 1 — uniform painted lining
  const ring = [
    [-d, 0], [d, 0], [0, -d], [0, d],
    [-d, -d], [d, -d], [-d, d], [d, d],
  ];
  for (let i = 0; i < ring.length; i++) g.drawImage(sil, ring[i][0], ring[i][1]);

  // ring 2 — asymmetric AO along the shadow axis
  g.globalAlpha = 0.42;
  const d2 = d * 2;
  g.drawImage(sil, Math.round(SUN.shadow.x * d2), Math.round(SUN.shadow.y * d2));
  g.globalAlpha = 0.20;
  const d3 = d * 3.2;
  g.drawImage(sil, Math.round(SUN.shadow.x * d3), Math.round(SUN.shadow.y * d3));
  g.restore();
}

/**
 * PASS E — BAKED CONTACT SHADOW + SIDE-TINTED GROUND SCUFF.
 * Painted under everything with 'destination-over', so it is not part of the
 * lining silhouette and does not read as a floating disc.
 *
 * The scuff is the keystone: it is a large, always-unoccluded block of team
 * colour sitting exactly at the sprite's anchor, where the figure above it can
 * never cover it. Because units deploy at 12px spacing, a formation front
 * resolves into a continuous chain of side colour — the mass reads as blue or
 * red before the eye resolves a single man. Reframed painterly (trodden earth
 * warmed or cooled toward the side hue at ~40% chroma) rather than as a
 * saturated wargame base rim, so it reads as ground, not as plastic.
 */
function passGroundContact(g, S, cx, cy, rx, rimHex) {
  // COMPOSITED VIA A SCRATCH CANVAS, not painted straight onto the frame with
  // destination-over. Every operation inside a destination-over block lands
  // BENEATH everything already drawn in that block, so painting the scuff
  // gradient, then the lit crescent, then the clods, then the cast shadow
  // directly onto the frame stacks them in exactly reverse order: the crescent
  // and clods end up buried under the 0.62-0.80-alpha scuff that was supposed
  // to sit below them, and the cast shadow ends up under the ground it falls
  // on. Building the whole ground plate in normal source-over order on a
  // scratch surface and blitting it under the figure as ONE destination-over
  // drawImage preserves the intended stacking. Bake-time only.
  const src = g.canvas;
  const plate = document.createElement('canvas');
  plate.width = src.width; plate.height = src.height;
  const gp = plate.getContext('2d');
  gp.scale(S, S);

  paintGroundPlate(gp, cx, cy, rx, rimHex);

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.drawImage(plate, 0, 0);
  g.restore();
}

/** The ground plate itself, painted bottom-up in normal source-over order. */
function paintGroundPlate(g, cx, cy, rx, rimHex) {
  // --- the side-tinted trodden scuff -------------------------------------
  if (rimHex) {
    const rimRGB = parseHex(rimHex);
    const earth = parseHex(MAT.scuffEarth);
    const scuff = chroma(mixRGB(earth, rimRGB, RIM_CHROMA), 1.12);
    const scuffLit = mixRGB(scuff, parseHex(SUN.bounce), 0.30);

    g.save();
    g.translate(cx, cy); g.scale(1, SUN.squash);
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.18);
    sg.addColorStop(0.00, rgba(scuff, 0.80));
    sg.addColorStop(0.52, rgba(scuff, 0.62));
    sg.addColorStop(0.82, rgba(scuff, 0.26));
    sg.addColorStop(1.00, rgba(scuff, 0));
    g.fillStyle = sg;
    g.beginPath(); g.arc(0, 0, rx * 1.18, 0, 7); g.fill();

    // A crescent of dry lit earth on the sunward edge — this is what makes
    // the scuff read as churned ground catching the lamp rather than a decal.
    g.lineWidth = rx * 0.26;
    g.strokeStyle = rgba(scuffLit, 0.55);
    g.beginPath();
    g.arc(0, 0, rx * 0.92, Math.PI * 0.92, Math.PI * 1.92);
    g.stroke();

    // Speckle: individual clods, so the edge is never a clean analytic curve.
    // Seeded, NOT Math.random() — see makeRnd. Identical in every pose of the
    // unit, so the ground under a marching man stays put while he walks.
    const rr = makeRnd(0x5C0FF);
    for (let i = 0; i < 22; i++) {
      const a = rr(0, Math.PI * 2);
      const dd = Math.sqrt(rr(0, 1)) * rx * 1.14;
      const px = Math.cos(a) * dd, py = Math.sin(a) * dd;
      const lit = (Math.cos(a) * SUN.x + Math.sin(a) * SUN.y) > 0.2;
      g.fillStyle = rgba(lit ? scuffLit : mixRGB(scuff, [20, 18, 14], 0.35), rr(0.20, 0.5));
      g.beginPath(); g.arc(px, py, rr(0.22, 0.62), 0, 7); g.fill();
    }
    g.restore();
  }

  // --- the cast shadow ----------------------------------------------------
  // Never a flat-alpha ellipse. Offset down-right along +SUN.shadow, cool
  // blue-violet (a warm key light produces cool shadows; pure black would
  // desaturate the flock underneath).
  const ox = cx + rx * 0.30, oy = cy + rx * 0.16;
  g.save();
  g.translate(ox, oy); g.scale(1, SUN.squash);
  const R = rx * 1.5;
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, R);
  sh.addColorStop(0.00, 'rgba(' + SUN.shadowRGB + ',0.46)');
  sh.addColorStop(0.55, 'rgba(' + SUN.shadowRGB + ',0.20)');
  sh.addColorStop(1.00, 'rgba(' + SUN.shadowRGB + ',0)');
  g.fillStyle = sh;
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.restore();
}


/* ---------------------------------------------------------------------------
   4. HEADGEAR
   Silhouette is the primary carrier of unit identity at 8 screen px. These
   three heads must be tellable apart as pure black shapes.
     tricorn  — wide, flat, two raised corners, dip in the middle  (musketeer)
     helmet   — compact dome with a raised comb and a neck flare   (pikeman)
     turban   — tall, round, wrapped mass, no brim                 (ottoman)
   ------------------------------------------------------------------------ */

function drawTricorn(g, hx, hy, tilt, felt, trim) {
  g.save();
  g.translate(hx, hy);
  g.rotate(tilt);

  // Under-brim shadow first, so the face sits in the hat's shade.
  // source-atop, not multiply: the brim overhangs empty space on both sides of
  // the head, and multiply would paint that empty space solid.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(30,26,34,0.34)';
  g.beginPath(); g.ellipse(0.1, 0.55, 4.15, 1.5, 0, 0, 7); g.fill();
  g.restore();

  // A WIDE, FLAT bar with two raised corners. Width is the whole point: the
  // brim spans ~10 units against a ~4.5-unit head, so the tricorn reads as a
  // hard horizontal T even as a single row of black cells. That is what
  // separates it from the Ottoman turban's tall vertical mass at 8px, where
  // no two coat colours would ever separate on hue alone.
  const brim = (c) => {
    c.moveTo(-4.75, 0.3);                          // rear brim tip
    c.quadraticCurveTo(-4.6, -1.6, -3.0, -2.0);    // rear corner peak
    c.quadraticCurveTo(-1.0, -3.05, 0.45, -2.95);  // crown dip
    c.quadraticCurveTo(2.7, -2.85, 3.85, -1.8);    // front corner peak
    c.quadraticCurveTo(4.9, -0.95, 5.05, 0.2);     // front brim tip
    c.quadraticCurveTo(2.3, 1.7, -0.5, 1.58);      // underside
    c.quadraticCurveTo(-3.1, 1.46, -4.75, 0.3);
    c.closePath();
  };
  litPath(g, brim, -5.1, -3.1, 10.3, 4.9, felt, { deep: true, edgeW: 0.3 });

  // Crown, sitting proud of the brim — a second value break so the tricorn
  // does not read as one flat lozenge.
  litPath(g, (c) => {
    c.moveTo(-2.3, -1.35);
    c.quadraticCurveTo(-2.0, -3.5, 0.35, -3.55);
    c.quadraticCurveTo(2.5, -3.5, 2.7, -1.4);
    c.quadraticCurveTo(0.3, -0.55, -2.3, -1.35);
    c.closePath();
  }, -2.4, -3.6, 5.2, 3.1, felt, { edgeW: 0.26, edgeA: 0.85 });

  // Brim binding — a thin trim-coloured tape around the sunward edge. This is
  // the only place the nation's facing colour appears above the shoulders and
  // it is what makes the hat read as belonging to a uniform.
  g.save();
  g.lineCap = 'round';
  g.lineWidth = 0.34;
  g.strokeStyle = trim.lit;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(-3.95, 0.2);
  g.quadraticCurveTo(-3.75, -1.6, -2.5, -1.95);
  g.quadraticCurveTo(-0.85, -3.0, 0.45, -2.9);
  g.quadraticCurveTo(2.25, -2.8, 3.2, -1.75);
  g.stroke();
  g.restore();

  // Cockade — one saturated trim dot on the front corner. A tiny hard accent
  // reads at distance as "detail" and breaks the felt's monotony.
  g.fillStyle = trim.edge;
  g.beginPath(); g.arc(2.75, -1.95, 0.52, 0, 7); g.fill();
  g.fillStyle = trim.shade;
  g.beginPath(); g.arc(2.85, -1.8, 0.24, 0, 7); g.fill();

  g.restore();
}

function drawHelmet(g, hx, hy, tilt, steel, trim) {
  g.save();
  g.translate(hx, hy);
  g.rotate(tilt);

  // source-atop, NOT multiply: the 6-unit-wide brim ellipse overhangs the
  // ~4.5-unit head on both sides, and a separable blend mode over a
  // transparent backdrop degenerates to source-over — so multiply would paint
  // a solid dark blob into empty air beside the head, which passLining would
  // then dilate and bake into the silhouette permanently.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(30,26,34,0.30)';
  g.beginPath(); g.ellipse(0.1, 0.5, 3.0, 1.15, 0, 0, 7); g.fill();
  g.restore();

  // Skull — a compact dome, deliberately much narrower than a tricorn.
  litPath(g, (c) => {
    c.moveTo(-2.65, 0.5);
    c.quadraticCurveTo(-2.85, -2.55, 0.2, -2.75);
    c.quadraticCurveTo(3.15, -2.55, 2.95, 0.5);
    c.quadraticCurveTo(0.2, 1.35, -2.65, 0.5);
    c.closePath();
  }, -2.9, -2.9, 6.1, 4.4, steel, { deep: true, edgeW: 0.3 });

  // Raised comb along the crown — the reading feature at 8px.
  litPath(g, (c) => {
    c.moveTo(-2.15, -1.45);
    c.quadraticCurveTo(0.15, -4.0, 2.4, -1.35);
    c.quadraticCurveTo(0.15, -2.55, -2.15, -1.45);
    c.closePath();
  }, -2.2, -4.0, 4.7, 2.7, steel, { edgeW: 0.24, edgeA: 0.95 });

  // Neck / brim flare at the rear — an asymmetric tail that keeps the helmet
  // from reading as a plain circle.
  litPath(g, (c) => {
    c.moveTo(-2.35, -0.15);
    c.quadraticCurveTo(-4.15, 0.35, -3.55, 1.5);
    c.quadraticCurveTo(-2.6, 1.15, -2.05, 0.75);
    c.closePath();
  }, -4.2, -0.2, 2.3, 1.8, steel, { edgeW: 0.2, edgeA: 0.6 });

  // Rivets along the brow.
  g.fillStyle = mixHex(MAT.brass, '#FFF0C0', 0.35);
  for (let i = -2; i <= 2; i++) {
    g.beginPath(); g.arc(i * 1.05 + 0.2, 0.35 - Math.abs(i) * 0.16, 0.24, 0, 7); g.fill();
  }
  // Trim-coloured plume socket — the pikeman's one flash of nation colour up top.
  g.fillStyle = trim.base;
  g.fillRect(-0.35, -3.55, 0.7, 1.0);
  g.fillStyle = trim.lit;
  g.fillRect(-0.35, -3.55, 0.28, 1.0);

  g.restore();
}

function drawTurban(g, hx, hy, tilt, cloth, trim) {
  g.save();
  g.translate(hx, hy);
  g.rotate(tilt);

  // source-atop, not multiply — see drawHelmet.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(30,26,34,0.30)';
  g.beginPath(); g.ellipse(0.1, 0.6, 3.0, 1.1, 0, 0, 7); g.fill();
  g.restore();

  // A TALL, NARROW wrapped mass — no brim at all, which is exactly the point:
  // narrower than the head is wide and rising well above it, so against the
  // tricorn's wide flat bar the two heads are opposite shapes rather than two
  // similar blobs. Silhouette, not palette, is what separates the armies.
  litPath(g, (c) => {
    c.moveTo(-2.55, 1.0);
    c.quadraticCurveTo(-3.1, -2.4, -1.2, -4.25);
    c.quadraticCurveTo(0.85, -5.5, 2.25, -3.5);
    c.quadraticCurveTo(3.15, -1.8, 2.75, 0.85);
    c.quadraticCurveTo(0.15, 1.85, -2.55, 1.0);
    c.closePath();
  }, -3.15, -5.55, 6.4, 7.5, cloth, { deep: true, edgeW: 0.32 });

  // Wrap coils — three arcs across the mass, each with its own tiny rim, so
  // the turban reads as wound cloth rather than an egg.
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const yy = -2.55 + i * 1.25;
    g.lineWidth = 0.36;
    g.strokeStyle = cloth.shade;
    g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(-2.95 + i * 0.28, yy + 0.5);
    g.quadraticCurveTo(0.1, yy - 0.85, 2.9 - i * 0.22, yy + 0.35);
    g.stroke();
    g.lineWidth = 0.24;
    g.strokeStyle = cloth.edge;
    g.globalAlpha = 0.45;
    g.beginPath();
    g.moveTo(-2.95 + i * 0.28, yy + 0.22);
    g.quadraticCurveTo(0.1, yy - 1.12, 2.9 - i * 0.22, yy + 0.08);
    g.stroke();
  }
  g.restore();

  // Trim-coloured jewel / aigrette at the front.
  g.fillStyle = trim.lit;
  g.beginPath(); g.ellipse(2.35, -2.2, 0.55, 0.72, -0.4, 0, 7); g.fill();
  g.fillStyle = trim.edge;
  g.beginPath(); g.arc(2.25, -2.4, 0.24, 0, 7); g.fill();

  g.restore();
}


/* ---------------------------------------------------------------------------
   5. THE FIGURE
   ------------------------------------------------------------------------ */

const BX = 14;        // body centre x — equals INF_AX so the mirror is exact
const GY = 23.5;      // ground contact y — equals INF_AY

/**
 * Leg geometry for the three phases. Two-segment legs with a real knee and a
 * boot, not two rectangles: the knee break is what makes a 4-unit stretch of
 * leg read as walking at a distance.
 *
 * Returned in draw order (far leg first). Coordinates are relative to BX and
 * the given hip height.
 */
function legGeometry(phase, hipY) {
  const kneeY = hipY + 3.35;
  const ankY = GY - 0.9;
  // The two walk frames must be genuine opposites with COMPARABLE stride
  // length. An earlier version gave phase 1 a 6.3-unit stride and phase 2 a
  // 4.2-unit stride, which reads as a limp rather than a march: the eye picks
  // up the asymmetry as a hitch in the cycle even at small size.
  if (phase === 1) {
    // Near leg driving forward, far leg trailing and extended.
    return {
      far:  { hip: [-0.85, hipY], knee: [-2.20, kneeY + 0.15], ank: [-3.10, ankY], toe: 1.0 },
      near: { hip: [0.95, hipY], knee: [2.55, kneeY - 0.45], ank: [2.95, ankY - 0.35], toe: 1.25 },
    };
  }
  if (phase === 2) {
    // Opposite stride — far leg forward, near leg trailing. Its span is ~14%
    // shorter than phase 1's, which is not the limp described above: this is
    // a three-quarter view, so the FAR leg's swing is genuinely foreshortened
    // relative to the near leg's. The earlier version overdid it at 33%.
    return {
      far:  { hip: [-0.85, hipY], knee: [1.15, kneeY - 0.45], ank: [2.45, ankY - 0.32], toe: 1.2 },
      near: { hip: [0.95, hipY], knee: [-1.40, kneeY + 0.15], ank: [-2.75, ankY], toe: 1.0 },
    };
  }
  // Standing: feet planted, slight natural splay.
  return {
    far:  { hip: [-0.9, hipY], knee: [-1.5, kneeY], ank: [-1.85, ankY], toe: 1.0 },
    near: { hip: [1.0, hipY], knee: [1.45, kneeY], ank: [1.7, ankY], toe: 1.15 },
  };
}

function drawLeg(g, L, breech, gaiter, shoe, dim) {
  const b = dim ? dimRamp(breech, 0.42) : breech;
  const gt = dim ? dimRamp(gaiter, 0.42) : gaiter;
  const sh = dim ? dimRamp(shoe, 0.42) : shoe;

  bone(g, b, BX + L.hip[0], L.hip[1], BX + L.knee[0], L.knee[1], 2.25);
  // knee joint mass
  litEllipse(g, BX + L.knee[0], L.knee[1], 1.05, 1.0, 0, b, { edge: false });
  // gaitered shin
  bone(g, gt, BX + L.knee[0], L.knee[1], BX + L.ank[0], L.ank[1], 1.85);
  // gaiter buttons — a column of tiny light dots, the period detail that
  // reads at 2.4x zoom and adds vertical rhythm at 1x.
  g.fillStyle = gt.edge;
  g.globalAlpha = 0.5;
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.26;
    g.beginPath();
    g.arc(BX + L.knee[0] + (L.ank[0] - L.knee[0]) * t - 0.6,
      L.knee[1] + (L.ank[1] - L.knee[1]) * t, 0.16, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;

  // Shoe: a wedge with a forward toe, buckle catching the light.
  const ax = BX + L.ank[0], ay = L.ank[1];
  litPath(g, (c) => {
    c.moveTo(ax - 1.05, ay - 0.55);
    c.lineTo(ax + 0.85 + L.toe, ay - 0.35);
    c.quadraticCurveTo(ax + 1.35 + L.toe, ay + 0.75, ax + 0.5 + L.toe, ay + 0.95);
    c.lineTo(ax - 1.0, ay + 0.95);
    c.closePath();
  }, ax - 1.1, ay - 0.6, 2.6 + L.toe, 1.7, sh, { edgeW: 0.22, edgeA: 0.55 });
  g.fillStyle = mixHex(MAT.brass, '#FFF0C0', 0.4);
  g.globalAlpha = 0.75;
  g.fillRect(ax + 0.05, ay - 0.28, 0.42, 0.42);
  g.globalAlpha = 1;
}


/* ---------------------------------------------------------------------------
   6. WEAPONS
   ------------------------------------------------------------------------ */

/** Flintlock musket, shouldered for the march. */
function drawMusketShouldered(g, wood, steel, brass, gripOut) {
  // CARRIED DIAGONALLY, not near-vertical. A steeply shouldered musket puts a
  // thin vertical spike immediately above and right of the hat — which is
  // exactly where the pikeman's pike sits, so at the zoom floor the two unit
  // types collided in the same cells and the silhouette gate failed. Slung
  // back at ~65 degrees the muzzle clears the head to the RIGHT and stays
  // BELOW the hat line, so the musketeer's topmost mass is purely his wide
  // tricorn and the pikeman owns the vertical.
  const bx0 = 16.4, by0 = 20.2;      // butt-plate, at the hip
  const mx = 21.7, my = 8.9;         // muzzle, out to the right of the head
  const t = 0.46;
  const jx = bx0 + (mx - bx0) * t, jy = by0 + (my - by0) * t;

  // Butt: a widened wedge, not just the end of a stroke.
  litPath(g, (c) => {
    c.moveTo(bx0 - 0.95, by0 - 0.55);
    c.lineTo(bx0 + 0.55, by0 - 1.35);
    c.lineTo(bx0 + 1.15, by0 + 0.15);
    c.lineTo(bx0 - 0.35, by0 + 0.95);
    c.closePath();
  }, bx0 - 1.0, by0 - 1.4, 2.2, 2.4, wood, { edgeW: 0.24 });

  bone(g, wood, bx0, by0, jx, jy, 1.55);                 // stock
  bone(g, steel, jx - 0.15, jy + 0.5, mx, my, 1.05);     // barrel
  // ramrod, a hair below the barrel line
  bone(g, mixRamp(wood, 0.18), jx + 0.35, jy + 0.9, mx + 0.25, my + 0.85, 0.34, { edge: false });

  // Lock plate + hammer — the visual "middle" of the weapon.
  const lx = bx0 + (mx - bx0) * 0.36, ly = by0 + (my - by0) * 0.36;
  litEllipse(g, lx + 0.35, ly, 0.85, 0.55, Math.atan2(my - by0, mx - bx0), brass, { edgeW: 0.2 });
  g.fillStyle = steel.lit;
  g.fillRect(lx + 0.55, ly - 0.85, 0.4, 0.85);

  // Muzzle ring + a bright specular tick.
  g.fillStyle = steel.edge;
  g.beginPath(); g.arc(mx, my, 0.55, 0, 7); g.fill();
  g.fillStyle = steel.shade;
  g.beginPath(); g.arc(mx + 0.08, my + 0.14, 0.3, 0, 7); g.fill();

  // Sling — a slack curve from butt to fore-end. Cheap, and it is the single
  // detail that most says "this is a real firearm on a real man".
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.32;
  g.strokeStyle = mixHex(MAT.stock, '#1A1410', 0.45);
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(bx0 - 0.2, by0 - 0.9);
  g.quadraticCurveTo(bx0 - 2.4 + gripOut, (by0 + my) * 0.5 + 1.6, jx - 0.6, jy + 0.4);
  g.stroke();
  g.restore();
}

/** Flintlock musket, levelled and shoulder-braced. */
function drawMusketPresented(g, wood, steel, brass, by) {
  const bx0 = 13.2, by0 = by;             // butt at the shoulder pocket
  const mx = 25.6, my = by - 1.35;        // muzzle
  const t = 0.42;
  const jx = bx0 + (mx - bx0) * t, jy = by0 + (my - by0) * t;

  // Butt-plate tucked into the shoulder.
  litPath(g, (c) => {
    c.moveTo(bx0 - 1.15, by0 - 0.95);
    c.lineTo(bx0 + 0.35, by0 - 0.75);
    c.lineTo(bx0 + 0.35, by0 + 1.05);
    c.lineTo(bx0 - 1.15, by0 + 1.25);
    c.closePath();
  }, bx0 - 1.2, by0 - 1.0, 1.6, 2.3, wood, { edgeW: 0.24 });

  bone(g, wood, bx0, by0 + 0.1, jx, jy, 1.6);
  bone(g, steel, jx - 0.2, jy - 0.05, mx, my, 1.1);
  bone(g, mixRamp(wood, 0.18), jx + 0.2, jy + 0.75, mx - 2.4, my + 0.7, 0.34, { edge: false });

  // Lock and hammer, drawn back.
  const lx = bx0 + (mx - bx0) * 0.30, ly = by0 + (my - by0) * 0.30;
  litEllipse(g, lx, ly - 0.1, 1.0, 0.62, 0, brass, { edgeW: 0.2 });
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.42;
  g.strokeStyle = steel.lit;
  g.beginPath(); g.moveTo(lx - 0.25, ly - 0.35); g.lineTo(lx - 0.75, ly - 1.25); g.stroke();
  g.restore();
  // Frizzen / pan, catching the light.
  g.fillStyle = brass.edge;
  g.fillRect(lx + 0.5, ly - 0.95, 0.5, 0.6);

  // Trigger guard.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.3;
  g.strokeStyle = brass.base;
  g.beginPath();
  g.moveTo(lx - 1.4, ly + 0.9);
  g.quadraticCurveTo(lx - 0.4, ly + 1.75, lx + 0.6, ly + 0.95);
  g.stroke();
  g.restore();

  // Muzzle + foresight — the tip that the player's eye tracks along the line.
  g.fillStyle = steel.edge;
  g.beginPath(); g.arc(mx, my, 0.58, 0, 7); g.fill();
  g.fillStyle = steel.shade;
  g.beginPath(); g.arc(mx + 0.1, my + 0.16, 0.3, 0, 7); g.fill();
  g.fillStyle = steel.lit;
  g.fillRect(mx - 1.0, my - 0.95, 0.34, 0.62);
}

/** Pike, grounded and vertical. The tallest silhouette on the field. */
function drawPikeVertical(g, wood, steel) {
  const bxB = 17.5, byB = 25.2;      // butt, planted just outside the near foot
  // byT 5.6, not 4.5: with the broadened spearhead the tip reached y=0.6, and
  // the 0.6-unit lining dilation would then be clipped by the frame edge —
  // the same class of bug as the shipped renderer, where every idle pikeman's
  // spearhead is cut off by the 20-unit frame bound. Verified by the bounds
  // check in smoke.js; the pike still clears the hat by two full cells at the
  // FAR tier, which is what the silhouette read actually needs.
  const bxT = 15.5, byT = 5.6;       // top of shaft
  // Shaft width 1.55, not a scale-realistic ~0.5. Verified against the 8px
  // silhouette gate: below ~1.4 units the shaft covers less than a third of a
  // cell at the 0.45x zoom floor and the pikeman's defining feature vanishes
  // precisely at command altitude. Oversized weapons are the heroic-28mm
  // convention and they buy readability at small size for free.
  bone(g, wood, bxB, byB, bxT, byT, 1.55, { cap: 'butt' });

  // Butt ferrule.
  g.fillStyle = steel.shade;
  g.beginPath(); g.ellipse(bxB, byB - 0.3, 0.7, 0.42, 0, 0, 7); g.fill();

  // Langets — two steel straps binding the head to the shaft. Reads at zoom.
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.3;
  g.strokeStyle = steel.lit;
  g.globalAlpha = 0.85;
  g.beginPath(); g.moveTo(bxT - 0.32, byT + 2.6); g.lineTo(bxT - 0.22, byT - 0.1); g.stroke();
  g.strokeStyle = steel.shade;
  g.beginPath(); g.moveTo(bxT + 0.34, byT + 2.6); g.lineTo(bxT + 0.24, byT - 0.1); g.stroke();
  g.restore();

  // Leaf-shaped spearhead, projecting clear above the hat. Broadened to 2.8
  // units so the projection reads as a distinct mass at the zoom floor rather
  // than dissolving into a single grey cell.
  litPath(g, (c) => {
    c.moveTo(bxT - 0.25, byT + 0.45);
    c.quadraticCurveTo(bxT - 1.45, byT - 1.35, bxT - 0.15, byT - 3.85);
    c.quadraticCurveTo(bxT + 1.25, byT - 1.35, bxT + 0.3, byT + 0.45);
    c.closePath();
  }, bxT - 1.5, byT - 3.9, 2.9, 4.4, steel, { deep: true, edgeW: 0.24, edgeA: 1 });

  // Central fuller — one bright line down the blade.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.2;
  g.strokeStyle = steel.edge;
  g.globalAlpha = 0.7;
  g.beginPath(); g.moveTo(bxT - 0.28, byT - 0.15); g.lineTo(bxT - 0.2, byT - 2.15); g.stroke();
  g.restore();
}

/** Pike, levelled in a committed forward thrust. */
function drawPikeThrust(g, wood, steel) {
  const bxB = 6.1, byB = 16.6;       // butt, driven back past the rear hip
  const hx = 23.9, hy = 13.75;       // head socket
  const tx = 26.4, ty = 13.35;       // point
  bone(g, wood, bxB, byB, hx, hy, 1.6, { cap: 'butt' });

  g.fillStyle = steel.shade;
  g.beginPath(); g.ellipse(bxB + 0.2, byB - 0.05, 0.5, 0.65, 0, 0, 7); g.fill();

  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.3;
  g.strokeStyle = steel.lit;
  g.globalAlpha = 0.85;
  g.beginPath(); g.moveTo(hx - 2.5, hy + 0.15); g.lineTo(hx + 0.1, hy - 0.28); g.stroke();
  g.restore();

  const ang = Math.atan2(ty - hy, tx - hx);
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  litPath(g, (c) => {
    c.moveTo(hx - 0.3 * Math.cos(ang), hy - 0.3 * Math.sin(ang));
    c.quadraticCurveTo(hx + 1.1 * Math.cos(ang) - nx * 0.95, hy + 1.1 * Math.sin(ang) - ny * 0.95, tx, ty);
    c.quadraticCurveTo(hx + 1.1 * Math.cos(ang) + nx * 0.95, hy + 1.1 * Math.sin(ang) + ny * 0.95,
      hx - 0.3 * Math.cos(ang), hy - 0.3 * Math.sin(ang));
    c.closePath();
  }, hx - 1.2, hy - 1.6, 4.0, 3.2, steel, { deep: true, edgeW: 0.22, edgeA: 1 });

  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.2;
  g.strokeStyle = steel.edge;
  g.globalAlpha = 0.7;
  g.beginPath();
  g.moveTo(hx + 0.2, hy - 0.05);
  g.lineTo(tx - 0.5 * Math.cos(ang), ty - 0.5 * Math.sin(ang));
  g.stroke();
  g.restore();
}

/** Convenience: a ramp shifted darker, for ramrods and secondary woodwork. */
function mixRamp(r, t) { return ramp(toHex(mixRGB(r.baseRGB, [0x14, 0x10, 0x0C], t))); }


/* ---------------------------------------------------------------------------
   7. drawSoldier — THE ENTRY POINT
   Signature preserved exactly:  (g, nat, pose, legPhase, weapon)

   Optional, backward-compatible fields read off `nat` if present:
     nat.rim       side colour for the baked ground scuff  ('#3E78B8'/'#B8483E')
     nat.headgear  'turban' to swap the tricorn for a turban (Ottoman)
   Neither is required; the painter degrades gracefully without them.
   ------------------------------------------------------------------------ */

function drawSoldier(g, nat, pose, legPhase, weapon) {
  const isPike = weapon === 'pike';
  const firing = pose === 'fire' && !isPike;
  const thrust = pose === 'attack' && isPike;

  // Oversampling factor, derived from the frame canvas so this works whether
  // SCALE is 3, 4 or anything else.
  const S = g.canvas ? (g.canvas.width / INF_W) : 4;

  /* --- palettes -------------------------------------------------------- */
  const coat    = ramp(nat.coat);
  const trim    = ramp(nat.trim);
  const skin    = ramp(nat.skin);
  const cuff    = ramp(mixHex(nat.trim, nat.coat, 0.12));
  const breech  = ramp(isPike ? MAT.breechPike : MAT.breechMusk);
  const gaiter  = ramp(MAT.gaiter);
  const shoe    = ramp(MAT.shoe);
  const wood    = ramp(MAT.stock);
  const steel   = ramp(MAT.steel);
  const brass   = ramp(MAT.brass);
  const buff    = ramp(MAT.buff);
  const felt    = ramp(MAT.hatFelt);
  const hair    = ramp(MAT.hair);
  const armour  = ramp(mixHex(MAT.steel, '#4A4E56', 0.35));

  /* --- pose parameters -------------------------------------------------
     Body bob: contact frames sit low, passing frames ride high. Without this
     a two-frame walk reads as a sliding decal.
     Lean: the upper body pitches forward into the action; the waist follows
     at ~35% so the figure bends rather than tips.                          */
  // BODY BOB — and this carries more of the walk than the legs do.
  // With a symmetric stride the two walk frames are near mirror images, so in
  // silhouette their legs occupy almost the same cells and the cycle reads as
  // a static slide (measured: 10% frame-to-frame difference on stride alone).
  // The vertical bounce is what the eye actually locks onto. 0.76 units of
  // travel on a 17.5-unit figure is ~4% — pronounced for a stylised marching
  // miniature, and it takes frame-to-frame difference back above 20%.
  // The two frames also swap which leg occludes the other, so the dimmed far
  // leg changes sides: a value cue the black-shape test cannot see but the
  // player can.
  let bob = 0;
  if (legPhase === 1) bob = -0.58;
  else if (legPhase === 2) bob = 0.18;

  let lean = 0, crouch = 0, twist = 0;
  if (firing) { lean = 0.75; crouch = 0.35; twist = -0.06; }
  if (thrust) { lean = 1.85; crouch = 1.05; twist = 0.05; }

  const hipY   = 17.1 + bob + crouch;
  const waistY = 16.6 + bob + crouch;
  const shY    = 11.2 + bob + crouch;
  const headY  = 8.5  + bob + crouch;
  const leanW  = lean * 0.35;         // horizontal shift at the waist
  const leanS  = lean;                // at the shoulders
  const leanH  = lean * 1.25;         // at the head

  const hx = BX + 0.7 + leanH;
  const hy = headY;

  /* --- 1. FAR LEG, then near leg. Far limbs first, dimmed, so depth reads.
     The coat skirt is painted between the legs and the torso, which is what
     gives the figure its period silhouette.                               */
  const legs = legGeometry(legPhase, hipY);
  drawLeg(g, legs.far, breech, gaiter, shoe, true);
  drawLeg(g, legs.near, breech, gaiter, shoe, false);

  /* --- 2. FAR ARM (behind the torso) ----------------------------------- */
  const farSh = [BX - 1.9 + leanS, shY + 0.6];
  let farElb, farHand;
  if (firing) {
    farElb  = [BX + 2.0 + leanS, shY + 2.5];
    farHand = [18.6, shY + 0.9];
  } else if (thrust) {
    farElb  = [BX - 2.6 + leanS, shY + 3.3];
    farHand = [9.4, 16.1];
  } else {
    // Marching arm swing, counter-phased against the legs and symmetric in
    // magnitude so the swing matches the (now symmetric) stride.
    const sw = legPhase === 1 ? 1.35 : legPhase === 2 ? -1.35 : -0.15;
    farElb  = [BX - 2.2 + leanS - sw * 0.45, shY + 3.0];
    farHand = [BX - 2.4 + leanW - sw, hipY - 0.2];
  }
  const farArmRamp = dimRamp(coat, 0.40);
  arm(g, farArmRamp, farSh[0], farSh[1], farElb[0], farElb[1], farHand[0], farHand[1], 2.05, 1.6);
  hand(g, dimRamp(skin, 0.35), farHand[0], farHand[1], 0.82);

  /* --- 3. COAT SKIRT ---------------------------------------------------- */
  // Flared tails, kicking with the stride. This is the widest part of the
  // silhouette below the hat and it is what separates a soldier from a
  // villager at command altitude.
  const kick = legPhase === 1 ? 0.7 : legPhase === 2 ? -0.5 : 0;
  const skirtBot = 19.5 + bob + crouch * 0.6;
  // BULK. The pikeman's skirt widens with his shoulders. Widening only the
  // torso was not enough to register: the coat skirt is the widest part of
  // the lower body, so with a shared skirt the two types measured the same
  // width from the waist down and the silhouette gate stayed at 0.77 IoU.
  const bulk = isPike ? 1.18 : 1.0;
  litPath(g, (c) => {
    c.moveTo(BX - 2.75 * bulk + leanW, waistY - 0.4);
    c.quadraticCurveTo(BX - 4.35 * bulk + leanW - kick * 0.5, skirtBot - 1.2,
      BX - 3.75 * bulk + leanW - kick, skirtBot);
    c.quadraticCurveTo(BX + 0.1 + leanW, skirtBot + 0.85,
      BX + 3.95 * bulk + leanW + kick, skirtBot - 0.25);
    c.quadraticCurveTo(BX + 4.15 * bulk + leanW + kick * 0.5, skirtBot - 1.7,
      BX + 2.85 * bulk + leanW, waistY - 0.4);
    c.closePath();
  }, BX - 4.5 * bulk, waistY - 0.5, 8.9 * bulk, skirtBot - waistY + 1.6, coat, { deep: true, edgeW: 0.3 });

  // Turned-back skirt lining in the facing colour — the loudest, cheapest
  // nation cue on the whole figure, and it sits at the widest point.
  litPath(g, (c) => {
    c.moveTo(BX + 2.05 + leanW + kick * 0.5, waistY + 0.5);
    c.quadraticCurveTo(BX + 4.05 + leanW + kick, skirtBot - 1.9,
      BX + 3.85 + leanW + kick, skirtBot - 0.35);
    c.quadraticCurveTo(BX + 2.35 + leanW + kick * 0.6, skirtBot - 0.7,
      BX + 2.05 + leanW + kick * 0.5, waistY + 0.5);
    c.closePath();
  }, BX + 2.0, waistY, 2.3, skirtBot - waistY, trim, { edgeW: 0.22, edgeA: 0.9 });

  // Shadow pooling where the skirt overhangs the legs.
  contactAO(g, BX + leanW, skirtBot - 0.2, 4.2, 1.5, 0.5);

  /* --- 4. TORSO --------------------------------------------------------- */
  // A barrelled trapezoid, wider at the shoulder than the waist. Built as a
  // path (not a rect) so the chest curves and the waist nips in.
  //
  // The pikeman is deliberately BROADER. Verified against the silhouette
  // gate: with equal torsos the musketeer actually rendered wider (his
  // shouldered musket adds mass on the right), which inverted the intended
  // read — the armoured close-combat troop must be the bulkier shape.
  const shHalf = isPike ? 3.72 : 3.15;
  const wsHalf = isPike ? 3.18 : 2.72;
  litPath(g, (c) => {
    c.moveTo(BX - shHalf + leanS, shY + 0.05);
    c.quadraticCurveTo(BX - shHalf - 0.28 + (leanS + leanW) * 0.5, (shY + waistY) * 0.5,
      BX - wsHalf + leanW, waistY + 0.35);
    c.lineTo(BX + wsHalf + leanW, waistY + 0.35);
    c.quadraticCurveTo(BX + shHalf + 0.34 + (leanS + leanW) * 0.5, (shY + waistY) * 0.5,
      BX + shHalf + leanS, shY + 0.05);
    c.quadraticCurveTo(BX + leanS, shY - 1.1, BX - shHalf + leanS, shY + 0.05);
    c.closePath();
  }, BX - shHalf - 0.4, shY - 1.2, shHalf * 2 + 0.9, waistY - shY + 1.7, coat, { deep: true, edgeW: 0.32 });

  // Pikeman's breastplate — the second silhouette differentiator. A hard,
  // bright, high-contrast plate across the chest that no musketeer has.
  if (isPike) {
    litPath(g, (c) => {
      c.moveTo(BX - 3.38 + leanS, shY + 0.7);
      c.quadraticCurveTo(BX + leanS, shY - 0.4, BX + 3.50 + leanS, shY + 0.75);
      c.quadraticCurveTo(BX + 3.74 + (leanS + leanW) * 0.5, shY + 3.4,
        BX + 1.84 + leanW, waistY - 0.35);
      c.quadraticCurveTo(BX + leanW, waistY + 0.55, BX - 2.08 + leanW, waistY - 0.45);
      c.quadraticCurveTo(BX - 3.62 + (leanS + leanW) * 0.5, shY + 3.3,
        BX - 3.38 + leanS, shY + 0.7);
      c.closePath();
    }, BX - 3.8, shY - 0.45, 7.8, waistY - shY + 1.3, armour, { deep: true, edgeW: 0.34, edgeA: 1 });

    // Medial ridge down the plate.
    g.save();
    g.lineCap = 'round'; g.lineWidth = 0.26;
    g.strokeStyle = armour.edge; g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(BX + 0.55 + leanS, shY + 0.55);
    g.lineTo(BX + 0.2 + leanW, waistY - 0.3);
    g.stroke();
    g.restore();

    // Tassets — two hanging plates over the thighs, a hard notch in the
    // silhouette right where a musketeer has soft coat tails.
    for (let i = 0; i < 2; i++) {
      const tx0 = BX + (i ? 0.5 : -2.7) + leanW;
      litPath(g, (c) => {
        c.moveTo(tx0, waistY - 0.3);
        c.lineTo(tx0 + 2.25, waistY - 0.15);
        c.lineTo(tx0 + 2.0, waistY + 2.05);
        c.lineTo(tx0 + 0.22, waistY + 2.0);
        c.closePath();
      }, tx0, waistY - 0.4, 2.4, 2.6, armour, { edgeW: 0.24, edgeA: 0.8 });
    }
    // Rivet line along the plate's lower edge.
    g.fillStyle = armour.edge; g.globalAlpha = 0.7;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(BX - 2.5 + i * 1.25 + leanW, waistY - 0.6, 0.17, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  } else {
    // Musketeer: coat front, lapels turned back in the facing colour, and a
    // button row. Three vertical value breaks across a 6-unit chest is what
    // makes the coat read as tailored cloth rather than a swatch.
    litPath(g, (c) => {
      c.moveTo(BX + 1.15 + leanS, shY + 0.3);
      c.quadraticCurveTo(BX + 3.0 + leanS, shY + 0.35, BX + 3.2 + leanS, shY + 1.1);
      c.quadraticCurveTo(BX + 3.0 + (leanS + leanW) * 0.5, shY + 3.1,
        BX + 2.2 + leanW, waistY - 0.2);
      c.lineTo(BX + 1.0 + leanW, waistY - 0.35);
      c.closePath();
    }, BX + 1.0, shY + 0.2, 2.4, waistY - shY, trim, { edgeW: 0.24, edgeA: 0.9 });

    // Waistcoat gap showing at the chest opening.
    g.fillStyle = mixHex(nat.trim, '#FFFFFF', 0.2);
    g.globalAlpha = 0.55;
    g.beginPath();
    g.moveTo(BX + 0.35 + leanS, shY + 0.6);
    g.lineTo(BX + 1.35 + leanS, shY + 0.75);
    g.lineTo(BX + 0.95 + leanW, waistY - 0.4);
    g.lineTo(BX + 0.15 + leanW, waistY - 0.5);
    g.closePath(); g.fill();
    g.globalAlpha = 1;

    // Buttons.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const bxp = BX + 1.55 + leanS + (leanW - leanS) * t;
      const byp = shY + 1.25 + (waistY - shY - 1.9) * t;
      g.fillStyle = brass.lit;
      g.beginPath(); g.arc(bxp, byp, 0.3, 0, 7); g.fill();
      g.fillStyle = brass.shade;
      g.beginPath(); g.arc(bxp + 0.09, byp + 0.12, 0.16, 0, 7); g.fill();
    }
  }

  /* --- 5. BELTS --------------------------------------------------------- */
  // Buff crossbelt over the far shoulder to the near hip. On the right-facing
  // aspect this is the belt we can see; the mirrored frame reads correctly
  // because the belt is symmetric about the chest centreline in silhouette.
  g.save();
  g.lineCap = 'butt';
  g.lineWidth = 0.92;
  g.strokeStyle = buff.base;
  g.beginPath();
  g.moveTo(BX - 2.35 + leanS, shY + 0.95);
  g.lineTo(BX + 2.3 + leanW, waistY - 0.1);
  g.stroke();
  g.lineWidth = 0.3;
  g.strokeStyle = buff.edge;
  g.globalAlpha = 0.8;
  g.beginPath();
  g.moveTo(BX - 2.6 + leanS, shY + 0.75);
  g.lineTo(BX + 2.05 + leanW, waistY - 0.3);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();

  if (isPike) {
    // Second belt the other way — sword hanger. Two crossed belts is the
    // period pikeman's look and it further separates the two chests.
    g.save();
    g.lineCap = 'butt'; g.lineWidth = 0.8;
    g.strokeStyle = mixHex(MAT.buff, '#8A7452', 0.45);
    g.beginPath();
    g.moveTo(BX + 2.5 + leanS, shY + 1.0);
    g.lineTo(BX - 2.1 + leanW, waistY - 0.05);
    g.stroke();
    g.restore();
  } else {
    // Cartridge box on the near hip.
    litPath(g, (c) => {
      c.moveTo(BX + 1.65 + leanW, waistY - 0.15);
      c.lineTo(BX + 3.5 + leanW, waistY + 0.15);
      c.lineTo(BX + 3.35 + leanW, waistY + 1.5);
      c.lineTo(BX + 1.55 + leanW, waistY + 1.2);
      c.closePath();
    }, BX + 1.5, waistY - 0.2, 2.1, 1.8, ramp('#4A3A26'), { edgeW: 0.22, edgeA: 0.7 });
  }

  // Waist sash / belt in the facing colour.
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.78;
  g.strokeStyle = trim.shade;
  g.beginPath();
  g.moveTo(BX - 2.75 + leanW, waistY - 0.45);
  g.lineTo(BX + 2.75 + leanW, waistY - 0.1);
  g.stroke();
  g.lineWidth = 0.26;
  g.strokeStyle = trim.edge;
  g.globalAlpha = 0.75;
  g.beginPath();
  g.moveTo(BX - 2.75 + leanW, waistY - 0.72);
  g.lineTo(BX + 2.75 + leanW, waistY - 0.38);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();

  /* --- 6. NECK, HEAD, FACE --------------------------------------------- */
  bone(g, dimRamp(skin, 0.28), BX + 0.35 + leanS, shY + 0.1, hx - 0.1, hy + 1.9, 1.35, { edge: false });

  // Neck stock / cravat — a bright horizontal bar that separates the head
  // mass from the coat mass. Small, and it does an enormous amount of work at
  // 8 screen px because it breaks the head-torso blob into two readable parts.
  g.fillStyle = '#EFE9D6';
  g.globalAlpha = 0.92;
  g.beginPath();
  g.ellipse(hx - 0.15, hy + 2.15, 1.35, 0.62, twist, 0, 7);
  g.fill();
  g.globalAlpha = 1;

  // Queue (tied hair) behind the head — extra silhouette interest at the back.
  bone(g, hair, hx - 1.55, hy + 0.35, hx - 2.6, hy + 2.5, 0.85, { edge: false });
  g.fillStyle = felt.shade;
  g.beginPath(); g.arc(hx - 2.45, hy + 2.15, 0.4, 0, 7); g.fill();

  // Skull. Built as a path with a nose bump and a jaw so the profile reads.
  litPath(g, (c) => {
    c.moveTo(hx - 2.15, hy - 0.15);
    c.quadraticCurveTo(hx - 2.1, hy - 2.25, hx + 0.1, hy - 2.3);
    c.quadraticCurveTo(hx + 1.85, hy - 2.2, hx + 2.0, hy - 0.5);
    c.lineTo(hx + 2.32, hy - 0.05);              // brow -> nose bridge
    c.lineTo(hx + 1.85, hy + 0.3);               // nose tip
    c.quadraticCurveTo(hx + 2.05, hy + 1.15, hx + 1.15, hy + 1.75);  // chin
    c.quadraticCurveTo(hx - 0.6, hy + 2.4, hx - 1.9, hy + 1.15);     // jaw
    c.closePath();
  }, hx - 2.2, hy - 2.35, 4.6, 4.8, skin, { deep: true, edgeW: 0.26 });

  // Warm ground bounce under the jaw — a soldier standing on a lit board
  // catches light from below, and it stops the face going to mud.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.22;
  g.fillStyle = SUN.bounce;
  g.beginPath(); g.ellipse(hx + 0.5, hy + 1.35, 1.5, 0.7, 0, 0, 7); g.fill();
  g.restore();

  // Eye socket shadow + eye. One dark notch is enough at this size, and its
  // absence is exactly why the current sprites read as anonymous.
  g.fillStyle = 'rgba(38,26,22,0.42)';
  g.beginPath(); g.ellipse(hx + 1.15, hy - 0.35, 0.85, 0.5, -0.15, 0, 7); g.fill();
  g.fillStyle = '#191218';
  g.beginPath(); g.ellipse(hx + 1.32, hy - 0.32, 0.28, 0.3, 0, 0, 7); g.fill();
  // Cheek highlight on the sunward side of the face.
  g.fillStyle = skin.edge;
  g.globalAlpha = 0.4;
  g.beginPath(); g.ellipse(hx - 0.35, hy - 0.85, 0.85, 0.62, -0.3, 0, 7); g.fill();
  g.globalAlpha = 1;
  // Mouth.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.2;
  g.strokeStyle = 'rgba(60,32,28,0.7)';
  g.beginPath(); g.moveTo(hx + 0.95, hy + 0.95); g.lineTo(hx + 1.6, hy + 0.88); g.stroke();
  g.restore();

  // Headgear.
  const tilt = twist + (firing ? 0.12 : thrust ? 0.16 : 0) + (legPhase === 1 ? -0.03 : legPhase === 2 ? 0.03 : 0);
  // ORDER MATTERS. The pike helmet is tested FIRST, before nat.headgear.
  // Testing headgear first gave Ottoman pikemen a turban, so within that army
  // musketeer and pikeman shared a head shape and the primary within-army
  // silhouette differentiator was lost for a whole faction. Both axes have to
  // hold at once: type is separated by helmet-vs-headwear (plus the pike's
  // 20-unit vertical), and army is separated by turban-vs-tricorn on the
  // numerous musketeer type. Armour is armour in any nation.
  if (isPike) {
    drawHelmet(g, hx + 0.1, hy - 1.35, tilt, armour, trim);
  } else if (nat.headgear === 'turban') {
    drawTurban(g, hx + 0.1, hy - 1.55, tilt, ramp(mixHex(nat.trim, '#F2ECDC', 0.45)), trim);
  } else {
    drawTricorn(g, hx + 0.15, hy - 1.5, tilt, felt, trim);
  }

  /* --- 7. NEAR ARM + WEAPON -------------------------------------------- */
  // Weapon is drawn between the far arm (already down) and the near arm, so
  // the near hand visibly grips it.
  if (isPike) {
    if (thrust) drawPikeThrust(g, wood, steel);
    else drawPikeVertical(g, wood, steel);
  } else {
    if (firing) drawMusketPresented(g, wood, steel, brass, shY + 0.55);
    else drawMusketShouldered(g, wood, steel, brass, legPhase === 1 ? 0.4 : 0);
  }

  const nearSh = [BX + 1.55 + leanS, shY + 0.75];
  let nearElb, nearHand;
  if (firing) {
    // Elbow up and out — the shoulder-braced firing posture reads entirely
    // from this raised triangle of arm against the sky.
    nearElb  = [BX + 3.3 + leanS, shY - 0.55];
    nearHand = [BX + 1.35 + leanS, shY + 1.75];
  } else if (thrust) {
    nearElb  = [BX + 2.7 + leanS, shY + 2.4];
    nearHand = [15.6, 14.9];
  } else if (isPike) {
    nearElb  = [BX + 2.6 + leanS, shY + 3.4];
    nearHand = [16.7, 14.6];
  } else {
    // Hand placed ON the carried musket's shaft (t ~= 0.2 along butt->muzzle),
    // not floating beside it.
    const sw = legPhase === 1 ? -1.35 : legPhase === 2 ? 1.35 : 0.15;
    nearElb  = [BX + 2.9 + leanS + sw * 0.35, shY + 3.3];
    nearHand = [17.45 + sw * 0.3, 17.75];
  }
  arm(g, coat, nearSh[0], nearSh[1], nearElb[0], nearElb[1], nearHand[0], nearHand[1], 2.2, 1.7);

  // Turned-back cuff in the facing colour at the wrist — the classic 18th-c
  // uniform read, and a bright accent exactly where the eye follows the arm.
  const cdx = nearHand[0] - nearElb[0], cdy = nearHand[1] - nearElb[1];
  const cl = Math.hypot(cdx, cdy) || 1;
  const cwx = nearHand[0] - cdx / cl * 1.15, cwy = nearHand[1] - cdy / cl * 1.15;
  bone(g, cuff, cwx, cwy, nearHand[0] - cdx / cl * 0.15, nearHand[1] - cdy / cl * 0.15, 1.95, { cap: 'butt', edgeA: 0.9 });

  hand(g, skin, nearHand[0], nearHand[1], 0.9);

  // Shoulder strap over the near shoulder, catching the key light.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.34;
  g.strokeStyle = trim.lit; g.globalAlpha = 0.8;
  g.beginPath();
  g.moveTo(BX + 0.6 + leanS, shY - 0.25);
  g.quadraticCurveTo(BX + 2.4 + leanS, shY - 0.35, BX + 3.05 + leanS, shY + 1.0);
  g.stroke();
  g.restore();

  // Far hand for two-handed poses, drawn last so it sits over the weapon.
  if (firing) {
    hand(g, dimRamp(skin, 0.2), 18.75, shY + 1.0, 0.84);
    bone(g, dimRamp(coat, 0.25), BX + 2.6 + leanS, shY + 1.5, 18.3, shY + 1.15, 1.5, { edgeA: 0.4 });
  } else if (thrust) {
    hand(g, dimRamp(skin, 0.2), 9.5, 16.15, 0.84);
  }

  /* --- 8. WHOLE-FIGURE PASSES ------------------------------------------ */
  passGalleryLight(g, INF_W, INF_H);
  passRecessWash(g, S);
  passMatteVarnish(g, INF_W, INF_H);

  /* --- 9. LINING + BAKED GROUND ---------------------------------------- */
  // A material-tinted lining: dark enough to guarantee separation from any
  // terrain value, tinted by the coat so it reads as painted rather than as a
  // vector stroke. Luminance is force-clamped inside ramp().
  passLining(g, S, coat.line);

  const scuffR = isPike ? 5.7 : 5.2;
  passGroundContact(g, S, BX + 0.15, GY + 0.35, scuffR, nat.rim || nat.coat);
}

// render.js does `import { drawSoldier, INF_W, INF_H, INF_AX, INF_AY } from
// './gfx/infantry.js'`. This file is an ES module, not a splice-in fragment.
export { drawSoldier, INF_W, INF_H, INF_AX, INF_AY };
