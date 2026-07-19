// Villager/worker sprite painter — civilian lineage of the infantry.
/* ============================================================================
   COSSACKS: LINE OF FIRE  —  VILLAGER / LABOURER SPRITE PAINTER
   Subsystem: drawWorker()
   Direction: PAINTED STEEL / KRIEGSSPIEL TABLE — painted 1:72 miniatures under
              a gallery photoflood mounted up and to the left.

   This file is the civilian counterpart to gfx/infantry.js and it deliberately
   mirrors that file's painting language EXACTLY: the same five-value acrylic
   ramp, the same single-sided edge-light construction, the same four
   whole-figure passes, the same 8-way dilated lining, the same baked contact
   shadow and side-tinted ground scuff. Only the FIGURE differs.

   Every helper here carries a `vl` prefix so this file can be concatenated
   into render.js alongside infantry.js, terrain.js, decals.js, effects.js and
   composite.js without a single top-level collision. Nothing is imported.

   ---------------------------------------------------------------------------
   WHY THE VILLAGER IS SHAPED THE WAY IT IS

   The acceptance gate is the 8-pixel pure-black silhouette test. A villager
   that reads as "small musketeer" makes the whole economy layer illegible,
   because villagers cluster exactly where the player is trying to parse
   buildings. Six deliberate divergences from drawSoldier, in descending order
   of how much they buy at command altitude:

     1. NO TRICORN. The tricorn is a hard horizontal T, 10 units of brim over a
        4.5-unit head — the loudest shape in the army. The villager wears a
        soft straw hat: a ROUNDED, drooping, asymmetric blob only ~5.6 wide,
        with a sagging brim. Round-versus-T is the single strongest read.
     2. NO COAT SKIRT. The soldier's flared, kicking tails are the widest part
        of his silhouette below the hat. The villager wears a belted smock with
        a STRAIGHT, slightly ragged hem and no flare at all, so his lower body
        is a plain tapering column.
     3. THE TOOL POINTS THE OTHER WAY. The shouldered musket is a diagonal spur
        to the upper RIGHT; the pike is a vertical mast. The idle villager
        carries his axe over the FAR shoulder, making a diagonal spur to the
        upper LEFT — the one direction no military type uses. And the spur
        TERMINATES IN A PADDLE (a 3.4-unit blade fan) where the musket
        terminates in a 1-unit barrel, so even mirrored — where the villager's
        spur swings round to the upper right — the terminal mass separates
        them.
     4. STOOP. A permanent forward pitch of the upper body. Soldiers stand;
        labourers lean into their work. This bends the whole vertical axis.
     5. BARE CALVES. Soldiers wear black gaiters — a dark column all the way to
        the ground. The villager wears knee-breeches over bare, sun-browned
        calves and wooden clogs, so his legs carry a bright value break at the
        knee that no soldier has.
     6. ROLLED SLEEVES. Cloth upper arm, bare skin forearm, with a rolled cuff
        band at the elbow. Soldiers are coated to the wrist.

   ---------------------------------------------------------------------------
   POSES, AND WHAT THE SIM CAN ACTUALLY SELECT

   economy.js gives a villager exactly two jobs — job.kind === 'build' and
   job.kind === 'gather' — and updateWorkers() sets worker.state to 'move'
   while travelling and 'work' once inside target.radius + 16. Gathering is
   CONTINUOUS (economy.js credits side.resources every tick); there are no
   carry trips, so no carry state exists in the sim today.

   This painter therefore supports four poses:

     'idle'   legPhase 0 | 1 | 2   stand / walk stride A / walk stride B
     'work'   legPhase 0 | 1       axe raised / axe struck   (job.kind 'gather')
     'build'  legPhase 0 | 1       mallet raised / struck    (job.kind 'build')
     'carry'  legPhase 1 | 2       laden walk A / B          (OPTIONAL — see below)

   'carry' is fully implemented and costs nothing to bake, but NOTHING IN THE
   SIM CAN SELECT IT. Do not bake it until sim/economy gains a carry trip.
   The recommended 7-frame list omits it; adding it appends frames 7 and 8 with
   no other change anywhere.

   ---------------------------------------------------------------------------
   SPRITE BOX (see sprite_box_changes — this is a CHANGE render.js must make)

     VL_W 28   VL_H 30   VL_AX 14   VL_AY 23.5

   Identical to INF_W / INF_H / INF_AX / INF_AY on purpose. All foot types then
   share one box, one ground line and one anchor rule, and VL_AX === VL_W / 2
   so mirror() produces a correctly anchored left-facing frame. The current
   villager def (w 18, h 20, ax 8, ay 17.6) violates ax === w/2 by 1 world px
   and would clip this figure on all four sides.

   EVERYTHING IN THIS FILE RUNS ONCE, AT BATTLE START. ctx.filter, gradients,
   save/restore and compositing modes are all legal here and used lavishly. The
   runtime hot loop is untouched: still exactly one drawImage per unit.
   ========================================================================== */


/* ---------------------------------------------------------------------------
   0. SPRITE BOX + THE ONE SUN
   ------------------------------------------------------------------------ */

const VL_W  = 28;      // frame width  in world units
const VL_H  = 30;      // frame height in world units
const VL_AX = 14;      // anchor x — MUST equal VL_W/2 so the mirrored copy
                       // shares the same anchor
const VL_AY = 23.5;    // anchor y — ground contact under the clogs. MUST equal
                       // INF_AY or villagers and soldiers stand on different
                       // ground lines and the whole field shears.

/* The single gallery photoflood.

   NOTE FOR THE INTEGRATOR — SUN VECTOR RECONCILIATION.
   The Art Bible mandates {x:-0.53, y:-0.85} (58 deg elevation). Every phase-1
   painter — terrain.js, infantry.js, decals.js, effects.js, composite.js — and
   the already-integrated js/gfx/infantry.js all use {x:-0.64, y:-0.77} (38
   deg). The Bible's own stated primary property is consistency across
   painters, and a villager lit at 58 deg standing beside a musketeer lit at 38
   deg is an immediately visible error, whereas the whole world lit at 38 deg
   is merely a lower sun than the Bible imagined.

   So this file matches the shipped painters, NOT the Bible's literal number.
   If the integrator normalises the world to the Bible vector, this is a
   one-line change here and one line in each sibling file; nothing else in this
   painter depends on the specific elevation. Flagged in `unresolved`. */
const VL_SUN = {
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

/* Materials that are not nation-driven.

   The whole civilian palette is deliberately LOW-CHROMA and warm-neutral:
   undyed linen, coarse wool, ash, straw, bare wood. This is not decoration, it
   is hierarchy. A villager painted in saturated cloth would compete with a
   musketeer's coat for the eye, and the graft note is explicit that military
   units must read as the priority. Every value here sits inside the earth /
   straw band so villagers recede one step without ever losing their outline or
   their rim — those two are never negotiable. */
const VL_MAT = {
  smock:     '#8C7A5C',   // undyed linen-wool smock — the villager's "coat"
  smockAlt:  '#7E6E52',   // a second bolt of cloth, for the sleeve/patch break
  apron:     '#A99978',   // bleached work apron
  breech:    '#5B4B36',   // coarse brown knee-breeches
  clog:      '#4A3826',   // carved wooden clogs
  straw:     '#B9A063',   // straw hat
  strawDark: '#8E7742',   // the shaded weave of the hat
  leather:   '#6E5334',   // belt, satchel, straps
  haft:      '#7A5C36',   // ash tool handle — LIGHTER than the musket stock
                          // (#6B4A28) so tools and firearms are different wood
  steel:     '#8A9099',   // axe bit, mallet bands
  darkSteel: '#5B626C',
  sack:      '#A08E6B',   // hessian bundle
  rope:      '#8A7748',
  hair:      '#3A2E22',
  linen:     '#E4DCC4',   // neck kerchief / shirt showing at the collar
  scuffEarth:'#7A5F3E',   // trodden earth for the contact scuff
};

/* How much of the side colour bleeds into the ground scuff.

   infantry.js uses 0.42. The villager uses 0.34 and a smaller scuff radius,
   because the Bible's villager graft requires civilians to carry the base rim
   at REDUCED saturation so military units read as the priority. Same mechanism,
   one step quieter. */
const VL_RIM_CHROMA = 0.34;

/* Chroma multiplier applied to the team colour before it is painted on cloth
   (hat band, waist sash). Below 1 desaturates toward the colour's own
   luminance, so the team hue is unmistakable but sits behind a soldier's. */
const VL_CIVIL_CHROMA = 0.74;

/* Force-clamp for the derived lining colour. Guarantees a legible outline for
   ANY value a future nation might introduce. Identical to infantry.js. */
const VL_LINE_LUM_MAX = 58;


/* ---------------------------------------------------------------------------
   1. COLOUR UTILITIES  (self-contained; byte-identical maths to infantry.js)
   ------------------------------------------------------------------------ */

/**
 * DETERMINISTIC noise. Bake-time randomness MUST be reproducible across the
 * frames of one animation: the ground scuff is painted identically into every
 * pose, so if it used Math.random() the speckle would change from frame to
 * frame and the ground under a walking villager would visibly crawl.
 */
function vlMakeRnd(seed) {
  let s = (seed | 0) || 1;
  return function (a, b) {
    s = (s * 1664525 + 1013904223) | 0;
    return a + ((s >>> 8) / 16777216) * (b - a);
  };
}

function vlClamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/** Parse '#rgb' or '#rrggbb' (or a bare 6-hex string) into [r,g,b]. */
function vlParseHex(hex) {
  let h = String(hex).trim();
  if (h.charCodeAt(0) === 35) h = h.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0], 16), g = parseInt(h[1], 16), b = parseInt(h[2], 16);
    return [r * 17, g * 17, b * 17];
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function vlToHex(c) {
  const r = vlClamp255(Math.round(c[0]));
  const g = vlClamp255(Math.round(c[1]));
  const b = vlClamp255(Math.round(c[2]));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** Linear sRGB-space mix of two [r,g,b] triples. t=0 -> a, t=1 -> b. */
function vlMixRGB(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function vlMixHex(a, b, t) { return vlToHex(vlMixRGB(vlParseHex(a), vlParseHex(b), t)); }

function vlLum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

/** Nudge a colour's lightness multiplicatively, preserving hue. */
function vlScaleLight(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

/**
 * Push a colour away from grey (saturate) or toward it (desaturate).
 * amount > 1 saturates, < 1 desaturates.
 */
function vlChroma(c, amount) {
  const l = vlLum(c);
  return [l + (c[0] - l) * amount, l + (c[1] - l) * amount, l + (c[2] - l) * amount];
}

/**
 * Force the lining below VL_LINE_LUM_MAX, verifying AFTER integer rounding.
 * A single multiplicative scale is not sufficient: vlToHex() rounds each
 * channel and rounding up can push a just-compliant colour back over the
 * ceiling. Iterating against the rounded value is what makes the guarantee
 * actually hold.
 */
function vlClampLineLum(c) {
  let out = c;
  for (let i = 0; i < 8; i++) {
    const r = [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])];
    if (vlLum(r) <= VL_LINE_LUM_MAX) return r;
    out = vlScaleLight(out, Math.min(0.99, (VL_LINE_LUM_MAX - 0.5) / vlLum(r)));
  }
  return [Math.round(out[0]), Math.round(out[1]), Math.round(out[2])];
}

function vlRGBA(c, a) {
  return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
}

/* --- THE ACRYLIC RAMP -----------------------------------------------------
   Identical derivation to infantry.js ramp(). Every material in the figure is
   expanded at bake time from one basecoat into five painted values:
     SHADE  a cool, hue-shifted recess wash
     BASE   the basecoat
     LIT    a warm drybrush on the sun-facing planes
     EDGE   an extreme edge highlight, applied ONLY on the up-left boundary
     LINE   a material-tinted lining, luminance force-clamped so it is
            guaranteed legible against its own fill for ANY input colour
   ------------------------------------------------------------------------ */
function vlRamp(hex) {
  const B = vlParseHex(hex);
  const shade = vlMixRGB(B, [0x1B, 0x20, 0x33], 0.42);
  const lit   = vlMixRGB(B, [0xFF, 0xE9, 0xBC], 0.30);
  const edge  = vlMixRGB(B, [0xFF, 0xF6, 0xDE], 0.62);

  const line = vlClampLineLum(vlMixRGB(B, [0x14, 0x10, 0x0C], 0.78));

  const deep  = vlMixRGB(shade, [0x10, 0x12, 0x1E], 0.38);        // deepest AO
  const glow  = vlMixRGB(B, vlParseHex(VL_SUN.bounce), 0.22);     // ground bounce

  return {
    rgb: B,
    base:  vlToHex(B), baseRGB: B,
    shade: vlToHex(shade), shadeRGB: shade,
    lit:   vlToHex(lit),   litRGB: lit,
    edge:  vlToHex(edge),  edgeRGB: edge,
    line:  vlToHex(line),  lineRGB: line,
    deep:  vlToHex(deep),  deepRGB: deep,
    glow:  vlToHex(glow),
  };
}

/** A copy of a ramp pushed toward its own shade — used for far-side limbs. */
function vlDimRamp(r, t) {
  const b = vlMixRGB(r.baseRGB, r.shadeRGB, t);
  return vlRamp(vlToHex(vlMixRGB(b, [0x1B, 0x20, 0x33], t * 0.35)));
}

/** A ramp shifted darker, for secondary woodwork and strapping. */
function vlMixRamp(r, t) { return vlRamp(vlToHex(vlMixRGB(r.baseRGB, [0x14, 0x10, 0x0C], t))); }


/* ---------------------------------------------------------------------------
   2. LIT-FORM PRIMITIVES
   Every filled form obeys the same rule: a gradient running along the sun's
   shadow axis from LIT through BASE to SHADE, plus a single-sided EDGE
   highlight on the up-left boundary only. A double-sided highlight reads as an
   outline; a single-sided one reads as a lit object.
   ------------------------------------------------------------------------ */

/** Linear gradient across a bbox, running along +VL_SUN.shadow. */
function vlRampGrad(g, x, y, w, h, r) {
  const L = Math.max(0.001, w * Math.abs(VL_SUN.shadow.x) + h * Math.abs(VL_SUN.shadow.y));
  const gr = g.createLinearGradient(x, y, x + L * VL_SUN.shadow.x, y + L * VL_SUN.shadow.y);
  gr.addColorStop(0.00, r.lit);
  gr.addColorStop(0.26, r.base);
  gr.addColorStop(0.62, r.base);
  gr.addColorStop(1.00, r.shade);
  return gr;
}

/** Same, but stronger — for large flat planes that need more modelling. */
function vlRampGradDeep(g, x, y, w, h, r) {
  const L = Math.max(0.001, w * Math.abs(VL_SUN.shadow.x) + h * Math.abs(VL_SUN.shadow.y));
  const gr = g.createLinearGradient(x, y, x + L * VL_SUN.shadow.x, y + L * VL_SUN.shadow.y);
  gr.addColorStop(0.00, r.edge);
  gr.addColorStop(0.14, r.lit);
  gr.addColorStop(0.40, r.base);
  gr.addColorStop(0.70, r.base);
  gr.addColorStop(1.00, r.deep);
  return gr;
}

function vlSegGrad(g, x0, y0, x1, y1, pad, r) {
  const minx = Math.min(x0, x1) - pad, miny = Math.min(y0, y1) - pad;
  return vlRampGrad(g, minx, miny, Math.abs(x1 - x0) + pad * 2, Math.abs(y1 - y0) + pad * 2, r);
}

/**
 * A lit, edge-highlighted path. pathFn builds the path on g.
 *
 * THE RIM CONSTRUCTION (identical to infantry.js litPath). Clip to the form,
 * then stroke the SAME outline with a fat pen whose centreline has been pushed
 * by +w along the shadow axis, i.e. AWAY from the light. On the up-left
 * boundary the displaced pen lands entirely inside the clip, so a band of EDGE
 * survives flush against the boundary. On the down-right boundary the same pen
 * lands entirely outside and the clip erases it. Single-sided by construction.
 */
function vlLitPath(g, pathFn, bx, by, bw, bh, r, opts) {
  const o = opts || {};
  g.beginPath(); pathFn(g);
  g.fillStyle = o.deep ? vlRampGradDeep(g, bx, by, bw, bh, r) : vlRampGrad(g, bx, by, bw, bh, r);
  g.fill();
  if (o.edge !== false) {
    const w = o.edgeW || 0.30;
    g.save();
    g.beginPath(); pathFn(g); g.clip();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = w * 2;
    g.strokeStyle = r.edge;
    g.globalAlpha = o.edgeA == null ? 0.72 : o.edgeA;
    g.translate(VL_SUN.shadow.x * w, VL_SUN.shadow.y * w);
    g.beginPath(); pathFn(g);
    g.stroke();
    g.restore();
  }
}

/** A lit ellipse. */
function vlLitEllipse(g, cx, cy, rx, ry, rot, r, opts) {
  vlLitPath(g, (c) => c.ellipse(cx, cy, rx, ry, rot, 0, 7),
    cx - rx, cy - ry, rx * 2, ry * 2, r, opts);
}

/**
 * A limb / tool segment: a round-capped stroke carrying the sun gradient, with
 * a thin single-sided rim light on whichever side of the segment faces the
 * light.
 */
function vlBone(g, r, x0, y0, x1, y1, w, opts) {
  const o = opts || {};
  g.save();
  g.lineCap = o.cap || 'round';
  g.lineJoin = 'round';
  g.lineWidth = w;
  g.strokeStyle = vlSegGrad(g, x0, y0, x1, y1, w * 0.5, r);
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();

  if (o.edge !== false) {
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    if (nx * VL_SUN.x + ny * VL_SUN.y < 0) { nx = -nx; ny = -ny; }   // sunward normal
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

/**
 * A ROLLED-SLEEVE ARM — the villager's arm, and one of the six silhouette
 * divergences. Cloth from shoulder to elbow, a thick rolled cuff band at the
 * elbow, then BARE SKIN forearm. A soldier is coated to the wrist; this is
 * what makes a villager's arm read as a working man's arm even at 2 screen px,
 * because the value jumps at the elbow instead of running continuously dark.
 */
function vlSleeveArm(g, cloth, skin, sx, sy, ex, ey, hx, hy, wUpper, wLower) {
  vlBone(g, cloth, sx, sy, ex, ey, wUpper);

  // Rolled cuff — a short fat band just short of the elbow, in the lighter
  // second bolt of cloth so the roll reads as a separate thickness.
  const ux = ex - sx, uy = ey - sy;
  const uL = Math.hypot(ux, uy) || 1;
  const cx0 = ex - ux / uL * 0.95, cy0 = ey - uy / uL * 0.95;
  vlBone(g, cloth, cx0, cy0, ex + ux / uL * 0.12, ey + uy / uL * 0.12,
    wUpper * 1.18, { cap: 'butt', edgeA: 0.85 });

  vlBone(g, skin, ex, ey, hx, hy, wLower);
}

/** Chunky, deliberately oversized hand — heroic-28mm convention. */
function vlHand(g, r, x, y, s) {
  vlLitEllipse(g, x, y, s, s * 0.86, 0, r, { edgeW: 0.22, edgeA: 0.8 });
}

/**
 * Local ambient occlusion pooled where two forms meet.
 *
 * NOTE the compositing mode. 'multiply' would be the painterly choice, but on
 * a mostly-transparent frame canvas a separable blend mode falls back to
 * source-over wherever the backdrop is transparent — so a multiply AO blob
 * would paint solid darkness into empty space beside the figure, and the
 * lining pass would then bake that into a permanent ghost halo. 'source-atop'
 * clips to already-painted pixels, which is exactly the intent.
 */
function vlContactAO(g, cx, cy, rx, ry, a) {
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
   physical object sitting under one lamp. Identical construction and identical
   constants to infantry.js — this is the mechanism by which a villager and a
   musketeer standing side by side look like two models from one paint session
   rather than two pieces of art.
   ------------------------------------------------------------------------ */

/** Solid-colour silhouette of a frame canvas, as a new canvas. */
function vlSilhouetteOf(src, fill) {
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
 * 'source-atop'. Shades smock, head, legs, hat and tool consistently with a
 * single operation, which no amount of per-part shading can fake.
 */
function vlPassGalleryLight(g, w, h) {
  const L = w * Math.abs(VL_SUN.shadow.x) + h * Math.abs(VL_SUN.shadow.y);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, L * VL_SUN.shadow.x, L * VL_SUN.shadow.y);
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
 * Multiply the frame's own blurred silhouette back over itself. Darkness pools
 * in interior crevices — under the hat brim, between the arm and the smock,
 * inside the hem — exactly as a shade wash does. ctx.filter is legal here:
 * this is bake-time code.
 *
 * The blur is masked back to the figure ('destination-in' against the
 * original) BEFORE it is composited. Without that mask the blur halo extends
 * past the silhouette, and multiply-over-transparent degenerates to
 * source-over, so the figure would acquire a dark smudge ring that the lining
 * pass would then bake in permanently.
 */
function vlPassRecessWash(g, S) {
  const src = g.canvas;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const s = c.getContext('2d');

  // BLUR THE FRAME, NOT THE SILHOUETTE. Blurring a solid silhouette and
  // multiplying it back is a no-op in the interior: the blur of a solid region
  // is still solid, so every pixel more than a blur-radius from the outline
  // gets the SAME multiplier. That is not a shade wash, it is a flat darkening
  // of the entire figure, and it stacks on the gallery-light gradient's 0.34
  // darkening in the lower right — the villager goes to mud and, worse, stops
  // matching the musketeer standing next to him.
  //
  // Blurring the frame's own COLOUR makes the multiplier a function of each
  // pixel's neighbourhood: bright sun-facing planes are multiplied by something
  // near white and barely move, while pixels beside dark neighbours — under the
  // hat brim, in the gap between arm and smock, inside the ragged hem, along
  // the lining — are multiplied by something dark and pool.
  //
  // Byte-identical construction and constants to infantry.js passRecessWash.
  s.filter = 'blur(' + (S * 0.42).toFixed(2) + 'px)';
  s.drawImage(src, 0, 0);
  s.filter = 'none';

  // Lift the wash toward white so it can only pool, never crush.
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
function vlPassMatteVarnish(g, w, h) {
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(238,232,214,0.045)';
  g.fillRect(-2, -2, w + 4, h + 4);
  g.restore();
}

/**
 * PASS D — LINING.
 * An 8-way dilation of the silhouette painted UNDERNEATH the artwork via
 * 'destination-over'. Villagers cluster tightly around a town centre and a
 * resource node — tighter than infantry deployment spacing — so without lining
 * a gathering crew fuses into one brown smear against the ground.
 *
 * A second, asymmetric ring offset along +VL_SUN.shadow at reduced alpha reads
 * as ambient occlusion and lifts the figure off the ground.
 */
function vlPassLining(g, S, tintHex) {
  const sil = vlSilhouetteOf(g.canvas, tintHex || '#131019');
  const d = Math.max(1, Math.round(S * 0.60));   // ~0.6 world units of outline
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';

  const ring = [
    [-d, 0], [d, 0], [0, -d], [0, d],
    [-d, -d], [d, -d], [-d, d], [d, d],
  ];
  for (let i = 0; i < ring.length; i++) g.drawImage(sil, ring[i][0], ring[i][1]);

  g.globalAlpha = 0.42;
  const d2 = d * 2;
  g.drawImage(sil, Math.round(VL_SUN.shadow.x * d2), Math.round(VL_SUN.shadow.y * d2));
  g.globalAlpha = 0.20;
  const d3 = d * 3.2;
  g.drawImage(sil, Math.round(VL_SUN.shadow.x * d3), Math.round(VL_SUN.shadow.y * d3));
  g.restore();
}

/**
 * PASS E — BAKED CONTACT SHADOW + SIDE-TINTED GROUND SCUFF.
 * Painted under everything with 'destination-over', so it is not part of the
 * lining silhouette and does not read as a floating disc.
 *
 * The scuff is a large, always-unoccluded block of team colour sitting exactly
 * at the sprite's anchor. For villagers this matters more than for infantry,
 * not less: a knot of eight workers around a contested central gold deposit is
 * a knot of eight small brown figures, and the scuff is what tells the player
 * at a glance whose workers they are. Painted at VL_RIM_CHROMA (0.34 against
 * infantry's 0.42) and a smaller radius, so a mixed crowd of troops and
 * civilians still reads soldiers first.
 */
function vlPassGroundContact(g, S, cx, cy, rx, rimHex) {
  // COMPOSITED VIA A SCRATCH CANVAS, not painted straight onto the frame with
  // destination-over. Every operation inside a destination-over block lands
  // BENEATH everything already drawn in that block, so painting the scuff
  // gradient, then the lit crescent, then the clods, then the cast shadow
  // directly onto the frame stacks them in exactly reverse order: the crescent
  // and the 20 clods end up buried under the 0.76-alpha scuff that was supposed
  // to sit below them, and the cast shadow ends up under the ground it falls
  // on. Building the whole ground plate in normal source-over order on a
  // scratch surface and blitting it under the figure as ONE destination-over
  // drawImage preserves the intended stacking. Bake-time only.
  //
  // Same construction as infantry.js passGroundContact / paintGroundPlate.
  const src = g.canvas;
  const plate = document.createElement('canvas');
  plate.width = src.width; plate.height = src.height;
  const gp = plate.getContext('2d');
  gp.scale(S, S);

  vlPaintGroundPlate(gp, cx, cy, rx, rimHex);

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-over';
  g.drawImage(plate, 0, 0);
  g.restore();
}

/** The ground plate itself, painted bottom-up in normal source-over order. */
function vlPaintGroundPlate(g, cx, cy, rx, rimHex) {
  // --- the side-tinted trodden scuff ---------------------------------------
  if (rimHex) {
    const rimRGB = vlParseHex(rimHex);
    const earth = vlParseHex(VL_MAT.scuffEarth);
    const scuff = vlChroma(vlMixRGB(earth, rimRGB, VL_RIM_CHROMA), 1.10);
    const scuffLit = vlMixRGB(scuff, vlParseHex(VL_SUN.bounce), 0.30);

    g.save();
    g.translate(cx, cy); g.scale(1, VL_SUN.squash);
    const sg = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.18);
    sg.addColorStop(0.00, vlRGBA(scuff, 0.76));
    sg.addColorStop(0.52, vlRGBA(scuff, 0.58));
    sg.addColorStop(0.82, vlRGBA(scuff, 0.24));
    sg.addColorStop(1.00, vlRGBA(scuff, 0));
    g.fillStyle = sg;
    g.beginPath(); g.arc(0, 0, rx * 1.18, 0, 7); g.fill();

    // A crescent of dry lit earth on the sunward edge — this is what makes the
    // scuff read as churned ground catching the lamp rather than a decal.
    g.lineWidth = rx * 0.26;
    g.strokeStyle = vlRGBA(scuffLit, 0.52);
    g.beginPath();
    g.arc(0, 0, rx * 0.92, Math.PI * 0.92, Math.PI * 1.92);
    g.stroke();

    // Speckle: individual clods, so the edge is never a clean analytic curve.
    // Seeded, NOT Math.random() — the ground under a walking villager must
    // stay put while he walks.
    const rr = vlMakeRnd(0x7A11E5);
    for (let i = 0; i < 20; i++) {
      const a = rr(0, Math.PI * 2);
      const dd = Math.sqrt(rr(0, 1)) * rx * 1.14;
      const px = Math.cos(a) * dd, py = Math.sin(a) * dd;
      const lit = (Math.cos(a) * VL_SUN.x + Math.sin(a) * VL_SUN.y) > 0.2;
      g.fillStyle = vlRGBA(lit ? scuffLit : vlMixRGB(scuff, [20, 18, 14], 0.35), rr(0.18, 0.46));
      g.beginPath(); g.arc(px, py, rr(0.20, 0.58), 0, 7); g.fill();
    }
    g.restore();
  }

  // --- the cast shadow ------------------------------------------------------
  // Never a flat-alpha ellipse. Offset down-right along +VL_SUN.shadow, cool
  // blue-violet — a warm key light produces cool shadows, and pure black would
  // desaturate the ground underneath.
  const ox = cx + rx * 0.30, oy = cy + rx * 0.16;
  g.save();
  g.translate(ox, oy); g.scale(1, VL_SUN.squash);
  const R = rx * 1.5;
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, R);
  sh.addColorStop(0.00, 'rgba(' + VL_SUN.shadowRGB + ',0.44)');
  sh.addColorStop(0.55, 'rgba(' + VL_SUN.shadowRGB + ',0.19)');
  sh.addColorStop(1.00, 'rgba(' + VL_SUN.shadowRGB + ',0)');
  g.fillStyle = sh;
  g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
  g.restore();
}


/* ---------------------------------------------------------------------------
   4. HEADGEAR — DIVERGENCE #1
   The single most load-bearing shape on the figure.

   The tricorn is a hard horizontal T: a 10-unit brim over a 4.5-unit head,
   with two raised corners and a dip. Against that, the villager's straw hat
   must be its opposite in every respect — ROUND, NARROWER (5.6 vs 10), with a
   SAGGING asymmetric brim and a low soft crown. At 8 px black one is a bar and
   one is a lump, which is the strongest read available at that size.

   Ottoman villagers get a wrapped head-cloth instead, matching infantry.js's
   nat.headgear convention. It is deliberately LOW and close to the skull — the
   Ottoman soldier's turban is a tall vertical tower, so the civilian version
   must not borrow that mass or the two would collide.
   ------------------------------------------------------------------------ */

function vlDrawStrawHat(g, hx, hy, tilt, straw, band) {
  g.save();
  g.translate(hx, hy);
  g.rotate(tilt);

  // Under-brim shadow first, so the face sits in the hat's shade.
  // source-atop, not multiply: the brim overhangs empty space on both sides of
  // the head, and multiply would paint that empty space solid.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(30,26,34,0.36)';
  g.beginPath(); g.ellipse(0.1, 0.7, 3.55, 1.45, 0, 0, 7); g.fill();
  g.restore();

  // BRIM — a floppy disc that SAGS. Two independent droops (deeper at the
  // front) and a slightly wavy rear edge, so no part of the outline is a clean
  // arc. A perfect ellipse here would read as a bowler and lose the whole
  // "worn, cheap, handmade" character that separates it from military felt.
  const brim = (c) => {
    c.moveTo(-3.05, -0.05);
    c.quadraticCurveTo(-3.50, 0.70, -2.55, 1.25);   // rear brim, drooping
    c.quadraticCurveTo(-1.25, 1.88, 0.10, 1.82);    // underside sag
    c.quadraticCurveTo(1.85, 1.76, 2.90, 1.00);
    c.quadraticCurveTo(3.62, 0.45, 3.15, -0.28);    // front tip, curled up
    c.quadraticCurveTo(1.70, -1.12, 0.05, -1.18);   // upper edge of the brim
    c.quadraticCurveTo(-1.70, -1.12, -3.05, -0.05);
    c.closePath();
  };
  vlLitPath(g, brim, -3.70, -1.25, 7.4, 3.2, straw, { deep: true, edgeW: 0.28 });

  // CROWN — low, rounded, slightly lopsided. Never taller than it is wide.
  vlLitPath(g, (c) => {
    c.moveTo(-2.05, -0.55);
    c.quadraticCurveTo(-2.20, -2.60, -0.10, -2.95);
    c.quadraticCurveTo(1.95, -2.85, 2.15, -0.75);
    c.quadraticCurveTo(0.10, -0.05, -2.05, -0.55);
    c.closePath();
  }, -2.25, -3.00, 4.5, 3.0, straw, { edgeW: 0.26, edgeA: 0.85 });

  // TEAM BAND around the base of the crown. Reserved team colour, painted at
  // reduced chroma. Unoccluded, sits at the top of the figure where nothing
  // ever covers it, and reads as a hatband rather than as a marker.
  //
  // Sat ON THE CROWN, clear of the brim. At the first pass the band was drawn
  // at the crown/brim junction and the two merged into one dark mass, which
  // cost the hat its brim — the single shape doing the most silhouette work
  // against the tricorn. Lifting it ~0.45 units restores a visible band of
  // straw below the band.
  g.save();
  g.lineCap = 'butt';
  g.lineWidth = 0.66;
  g.strokeStyle = band.base;
  g.beginPath();
  g.moveTo(-1.98, -1.18);
  g.quadraticCurveTo(0.05, -0.44, 2.08, -1.30);
  g.stroke();
  g.lineWidth = 0.22;
  g.strokeStyle = band.edge;
  g.globalAlpha = 0.78;
  g.beginPath();
  g.moveTo(-1.98, -1.44);
  g.quadraticCurveTo(0.05, -0.72, 2.08, -1.55);
  g.stroke();
  g.lineWidth = 0.20;
  g.strokeStyle = band.shade;
  g.globalAlpha = 0.65;
  g.beginPath();
  g.moveTo(-1.96, -0.90);
  g.quadraticCurveTo(0.05, -0.18, 2.06, -1.04);
  g.stroke();
  g.restore();

  // A loose end of the band, hanging down past the brim at the back — a tiny
  // asymmetry that stops the hat reading as a machined object.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.28;
  g.strokeStyle = band.shade;
  g.beginPath();
  g.moveTo(-1.88, -1.05);
  g.quadraticCurveTo(-2.85, 0.15, -2.45, 1.45);
  g.stroke();
  g.restore();

  // STRAW WEAVE — radial strokes across the brim and two arcs on the crown.
  // At 2.4x zoom this is what makes the hat legibly straw rather than felt.
  g.save();
  g.lineCap = 'round';
  g.globalAlpha = 0.34;
  g.lineWidth = 0.16;
  g.strokeStyle = straw.edge;
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI * 0.96 + i * (Math.PI * 0.94 / 7);
    g.beginPath();
    g.moveTo(Math.cos(a) * 1.15, 0.05 + Math.sin(a) * 0.50);
    g.lineTo(Math.cos(a) * 3.10, 0.05 + Math.sin(a) * 1.45);
    g.stroke();
  }
  g.globalAlpha = 0.28;
  g.strokeStyle = vlMixHex(VL_MAT.strawDark, '#000000', 0.15);
  g.beginPath();
  g.moveTo(-1.85, -1.35); g.quadraticCurveTo(0.05, -0.75, 2.00, -1.55);
  g.stroke();
  g.beginPath();
  g.moveTo(-1.60, -2.10); g.quadraticCurveTo(0.05, -1.55, 1.80, -2.30);
  g.stroke();
  g.restore();

  g.restore();
}

function vlDrawHeadCloth(g, hx, hy, tilt, cloth, band) {
  g.save();
  g.translate(hx, hy);
  g.rotate(tilt);

  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(30,26,34,0.30)';
  g.beginPath(); g.ellipse(0.1, 0.5, 2.6, 1.0, 0, 0, 7); g.fill();
  g.restore();

  // A LOW wrapped cloth, hugging the skull, with a tail falling to the
  // shoulder. Deliberately shorter than the Ottoman soldier's turban — the
  // civilian must not borrow the military vertical.
  vlLitPath(g, (c) => {
    c.moveTo(-2.35, 0.85);
    c.quadraticCurveTo(-2.75, -1.35, -1.05, -2.35);
    c.quadraticCurveTo(0.75, -3.05, 2.10, -1.85);
    c.quadraticCurveTo(2.70, -0.85, 2.45, 0.75);
    c.quadraticCurveTo(0.10, 1.50, -2.35, 0.85);
    c.closePath();
  }, -2.80, -3.10, 5.6, 4.7, cloth, { deep: true, edgeW: 0.30 });

  // Wrap coils.
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < 2; i++) {
    const yy = -1.55 + i * 1.15;
    g.lineWidth = 0.32;
    g.strokeStyle = cloth.shade;
    g.globalAlpha = 0.68;
    g.beginPath();
    g.moveTo(-2.55 + i * 0.22, yy + 0.45);
    g.quadraticCurveTo(0.05, yy - 0.70, 2.45 - i * 0.18, yy + 0.30);
    g.stroke();
    g.lineWidth = 0.20;
    g.strokeStyle = cloth.edge;
    g.globalAlpha = 0.42;
    g.beginPath();
    g.moveTo(-2.55 + i * 0.22, yy + 0.20);
    g.quadraticCurveTo(0.05, yy - 0.95, 2.45 - i * 0.18, yy + 0.06);
    g.stroke();
  }
  g.restore();

  // Falling tail at the rear — the head-cloth's silhouette signature.
  vlLitPath(g, (c) => {
    c.moveTo(-2.20, 0.15);
    c.quadraticCurveTo(-3.55, 0.95, -3.10, 2.65);
    c.quadraticCurveTo(-2.35, 2.05, -1.85, 1.05);
    c.closePath();
  }, -3.60, 0.10, 1.9, 2.7, cloth, { edgeW: 0.2, edgeA: 0.6 });

  // TEAM BAND — a cord wound round the wrap.
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.52;
  g.strokeStyle = band.base;
  g.beginPath();
  g.moveTo(-2.50, -0.35);
  g.quadraticCurveTo(0.05, 0.42, 2.50, -0.50);
  g.stroke();
  g.lineWidth = 0.18;
  g.strokeStyle = band.edge; g.globalAlpha = 0.7;
  g.beginPath();
  g.moveTo(-2.50, -0.58);
  g.quadraticCurveTo(0.05, 0.18, 2.50, -0.72);
  g.stroke();
  g.restore();

  g.restore();
}


/* ---------------------------------------------------------------------------
   5. THE FIGURE — SKELETON
   ------------------------------------------------------------------------ */

const VL_BX = 14;        // body centre x — equals VL_AX so the mirror is exact
const VL_GY = 23.5;      // ground contact y — equals VL_AY

/**
 * Leg geometry. Two-segment legs with a real knee: the knee break is what makes
 * a 4-unit stretch of leg read as walking at a distance.
 *
 * Three modes, because the villager's work poses are PLANTED, not mid-stride —
 * a man swinging an axe braces both feet. Reusing the walk cycle for a chop
 * would make him look like he was strolling into the tree.
 *   'walk'   phase 0 stand / 1 stride A / 2 stride B
 *   'stance' feet apart and braced, for the axe swing
 *   'lunge'  near foot advanced, for carpentry
 *
 * Returned in draw order (far leg first), relative to VL_BX.
 */
function vlLegGeometry(mode, phase, hipY) {
  const kneeY = hipY + 3.05;
  const ankY = VL_GY - 0.85;

  if (mode === 'stance') {
    return {
      far:  { hip: [-1.05, hipY], knee: [-2.60, kneeY + 0.10], ank: [-3.40, ankY], toe: 1.00 },
      near: { hip: [1.15, hipY],  knee: [2.50, kneeY + 0.05],  ank: [3.20, ankY],  toe: 1.20 },
    };
  }
  if (mode === 'lunge') {
    return {
      far:  { hip: [-1.00, hipY], knee: [-2.15, kneeY + 0.20], ank: [-2.90, ankY], toe: 1.00 },
      near: { hip: [1.10, hipY],  knee: [2.95, kneeY - 0.55],  ank: [3.85, ankY - 0.20], toe: 1.25 },
    };
  }
  if (phase === 1) {
    // Near leg driving forward, far leg trailing and extended.
    return {
      far:  { hip: [-0.85, hipY], knee: [-2.30, kneeY + 0.15], ank: [-3.20, ankY], toe: 1.00 },
      near: { hip: [0.95, hipY],  knee: [2.45, kneeY - 0.45],  ank: [2.85, ankY - 0.35], toe: 1.25 },
    };
  }
  if (phase === 2) {
    // Mirrored stride — near leg trailing, far leg forward.
    return {
      far:  { hip: [-0.85, hipY], knee: [0.50, kneeY - 0.40], ank: [1.80, ankY - 0.30], toe: 1.20 },
      near: { hip: [0.95, hipY],  knee: [-0.80, kneeY + 0.25], ank: [-2.30, ankY], toe: 1.00 },
    };
  }
  // Standing: feet planted, slight natural splay.
  return {
    far:  { hip: [-0.90, hipY], knee: [-1.50, kneeY], ank: [-1.85, ankY], toe: 1.00 },
    near: { hip: [1.00, hipY],  knee: [1.45, kneeY], ank: [1.70, ankY],  toe: 1.15 },
  };
}

/**
 * DIVERGENCE #5 — the leg. Knee-breeches over a BARE CALF and a wooden clog.
 *
 * The soldier's leg is a single dark column from hip to ground: breech, then
 * black gaiter, then black shoe. The villager's leg has a hard bright break at
 * the knee where dark wool gives way to sunburnt skin. At the zoom floor the
 * legs are 4 px tall and this value break is the only leg information that
 * survives — which makes it worth more than any amount of detail higher up.
 */
function vlDrawLeg(g, L, breech, skin, clog, dim) {
  const b  = dim ? vlDimRamp(breech, 0.42) : breech;
  const sk = dim ? vlDimRamp(skin, 0.45) : skin;
  const cl = dim ? vlDimRamp(clog, 0.42) : clog;

  const kx = VL_BX + L.knee[0], ky = L.knee[1];
  const ax = VL_BX + L.ank[0],  ay = L.ank[1];

  // Thigh, in breeches — full and baggy.
  vlBone(g, b, VL_BX + L.hip[0], L.hip[1], kx, ky, 2.30);

  // Breech cuff: a tied band just below the knee. A hard horizontal tick right
  // at the value break, which sharpens it.
  const dx = ax - kx, dy = ay - ky;
  const dL = Math.hypot(dx, dy) || 1;
  vlBone(g, vlMixRamp(b, 0.12),
    kx + dx / dL * 0.10, ky + dy / dL * 0.10,
    kx + dx / dL * 0.85, ky + dy / dL * 0.85,
    2.05, { cap: 'butt', edgeA: 0.9 });

  // Bare calf — narrower than the thigh, so the leg tapers.
  vlBone(g, sk, kx + dx / dL * 0.7, ky + dy / dL * 0.7, ax, ay, 1.50);

  // A rag binding round one shin. Cheap, and it says "this man dressed himself"
  // where a gaiter says "this man was issued a uniform".
  if (!dim) {
    g.save();
    g.lineCap = 'round';
    g.lineWidth = 0.26;
    g.strokeStyle = vlMixHex(VL_MAT.linen, '#8A7A5C', 0.45);
    g.globalAlpha = 0.7;
    for (let i = 0; i < 2; i++) {
      const t = 0.42 + i * 0.22;
      const px = kx + dx * t, py = ky + dy * t;
      g.beginPath();
      g.moveTo(px - 0.80, py - 0.16);
      g.lineTo(px + 0.80, py + 0.16);
      g.stroke();
    }
    g.restore();
  }

  // CLOG — a chunky carved wooden shoe with a blunt upturned toe. Deliberately
  // wider and rounder than the soldier's buckled shoe, and with no buckle
  // glint, so the foot mass differs too.
  vlLitPath(g, (c) => {
    c.moveTo(ax - 1.15, ay - 0.50);
    c.lineTo(ax + 0.70 + L.toe, ay - 0.60);
    c.quadraticCurveTo(ax + 1.55 + L.toe, ay - 0.45, ax + 1.35 + L.toe, ay + 0.55);
    c.quadraticCurveTo(ax + 1.15 + L.toe, ay + 1.05, ax + 0.35 + L.toe, ay + 1.05);
    c.lineTo(ax - 1.05, ay + 1.00);
    c.quadraticCurveTo(ax - 1.45, ay + 0.30, ax - 1.15, ay - 0.50);
    c.closePath();
  }, ax - 1.5, ay - 0.65, 3.1 + L.toe, 1.8, cl, { deep: true, edgeW: 0.24, edgeA: 0.7 });

  // Grain: two shallow strokes along the carved block.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.15;
  g.strokeStyle = cl.edge; g.globalAlpha = 0.35;
  g.beginPath();
  g.moveTo(ax - 0.75, ay + 0.10); g.lineTo(ax + 0.85 + L.toe, ay - 0.02);
  g.stroke();
  g.restore();
}


/* ---------------------------------------------------------------------------
   6. LOADS AND TOOLS
   ------------------------------------------------------------------------ */

/**
 * FELLING AXE — the gather tool.
 *
 * The blade is deliberately oversized (a ~3.4-unit fan on a 0.95-unit haft).
 * That is the heroic-28mm convention, and here it does specific work: it gives
 * the villager's tool-spur a TERMINAL MASS. The musket ends in a 1-unit
 * barrel; the pike ends in a narrow leaf. A spur that ends in a paddle is the
 * fallback discriminator when the sprite is mirrored and the villager's
 * up-left diagonal swings round to the up-right where the musket lives.
 */
function vlDrawAxe(g, wood, steel, x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const ux = Math.cos(a), uy = Math.sin(a);
  const nx = -uy, ny = ux;

  // Haft, running a little past the socket so the head is properly hung.
  vlBone(g, wood, x0, y0, x1 + ux * 0.75, y1 + uy * 0.75, 0.95);

  // Butt swell — a slight thickening at the grip end.
  vlLitEllipse(g, x0 - ux * 0.1, y0 - uy * 0.1, 0.62, 0.52, a, wood, { edgeW: 0.18, edgeA: 0.6 });

  const P = (dU, dN) => [x1 + ux * dU + nx * dN, y1 + uy * dU + ny * dN];
  const bb = [x1 - 3.6, y1 - 3.6, 7.2, 7.2];

  // BIT — a BEARDED axe, and the asymmetry is the whole point.
  //
  // A bit that fans symmetrically about the haft axis reads as a SPADE, not an
  // axe — verified in the bake harness, where the first symmetric version was
  // unmistakably a shovel over the shoulder. The fix is the historical profile:
  // a NARROW NECK at the eye (1.35 units) opening to a wide edge, a modest top
  // horn, and a long "beard" sweeping down and back toward the haft. The
  // downward bias is what the eye reads as an axe.
  vlLitPath(g, (c) => {
    const p0 = P(-0.50, -0.60);   // top of the eye — deliberately narrow
    const c1 = P(1.15, -1.95);    // ctrl: neck flares out to the top horn
    const p2 = P(2.55, -1.30);    // top horn
    const c3 = P(3.15, 0.35);     // ctrl: belly of the cutting edge
    const p4 = P(2.10, 2.45);     // beard tip — long, and BELOW the axis
    const c5 = P(0.85, 2.10);     // ctrl: the beard sweeps back to the haft
    const p6 = P(-0.30, 0.75);    // bottom of the eye
    c.moveTo(p0[0], p0[1]);
    c.quadraticCurveTo(c1[0], c1[1], p2[0], p2[1]);
    c.quadraticCurveTo(c3[0], c3[1], p4[0], p4[1]);
    c.quadraticCurveTo(c5[0], c5[1], p6[0], p6[1]);
    c.closePath();
  }, bb[0], bb[1], bb[2], bb[3], steel, { deep: true, edgeW: 0.26, edgeA: 1 });

  // Cutting edge — one bright hard line along the outer curve. A blade reads as
  // sharp only because of this line.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.24;
  g.strokeStyle = steel.edge; g.globalAlpha = 0.9;
  const e0 = P(2.40, -1.15), e1 = P(3.05, 0.35), e2 = P(1.95, 2.30);
  g.beginPath();
  g.moveTo(e0[0], e0[1]);
  g.quadraticCurveTo(e1[0], e1[1], e2[0], e2[1]);
  g.stroke();
  g.restore();

  // Socket / eye where the haft passes through — a dark notch that separates
  // the bit from the handle, and a raised lug above it.
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.85;
  g.strokeStyle = steel.shade; g.globalAlpha = 0.85;
  const s0 = P(-0.60, -0.50), s1 = P(-0.45, 0.68);
  g.beginPath(); g.moveTo(s0[0], s0[1]); g.lineTo(s1[0], s1[1]); g.stroke();
  g.lineWidth = 0.22;
  g.strokeStyle = steel.edge; g.globalAlpha = 0.55;
  const t0 = P(-0.30, -0.52), t1 = P(-0.18, 0.62);
  g.beginPath(); g.moveTo(t0[0], t0[1]); g.lineTo(t1[0], t1[1]); g.stroke();
  g.restore();
}

/**
 * CARPENTER'S MALLET — the build tool.
 * Short haft, a barrel head of end-grain beech with two iron hoops. Reads as a
 * completely different tool from the axe at a glance: stubby and blunt where
 * the axe is long and bladed, so 'building' and 'gathering' separate on tool
 * silhouette as well as on arm motion.
 */
function vlDrawMallet(g, wood, steel, x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const ux = Math.cos(a), uy = Math.sin(a);
  const nx = -uy, ny = ux;

  vlBone(g, wood, x0, y0, x1, y1, 0.85);

  const head = vlMixRamp(wood, 0.06);
  const P = (dU, dN) => [x1 + ux * dU + nx * dN, y1 + uy * dU + ny * dN];

  // Barrel head, drawn as a rounded quad across the haft axis.
  vlLitPath(g, (c) => {
    const p0 = P(-0.35, -1.55);
    const p1 = P(1.85, -1.60);
    const p2 = P(1.85, 1.60);
    const p3 = P(-0.35, 1.55);
    c.moveTo(p0[0], p0[1]);
    c.quadraticCurveTo(P(0.75, -1.95)[0], P(0.75, -1.95)[1], p1[0], p1[1]);
    c.quadraticCurveTo(P(2.35, 0)[0], P(2.35, 0)[1], p2[0], p2[1]);
    c.quadraticCurveTo(P(0.75, 1.95)[0], P(0.75, 1.95)[1], p3[0], p3[1]);
    c.quadraticCurveTo(P(-0.80, 0)[0], P(-0.80, 0)[1], p0[0], p0[1]);
    c.closePath();
  }, x1 - 2.6, y1 - 2.6, 5.2, 5.2, head, { deep: true, edgeW: 0.28, edgeA: 0.95 });

  // Two iron hoops.
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.30;
  for (let i = 0; i < 2; i++) {
    const d = i ? 1.55 : 0.15;
    const h0 = P(d, -1.62), h1 = P(d, 1.62);
    g.strokeStyle = i ? steel.shade : steel.lit;
    g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(h0[0], h0[1]); g.lineTo(h1[0], h1[1]); g.stroke();
  }
  g.restore();
}

/**
 * A WOODEN PEG held in the off hand during carpentry. Tiny, but it is what
 * turns "man waving a mallet" into "man driving a peg" — the off hand having a
 * job is most of what makes a two-handed action pose legible.
 */
function vlDrawPeg(g, wood, x, y, ang) {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  vlBone(g, wood, x, y, x + ux * 1.85, y + uy * 1.85, 0.55, { cap: 'butt' });
  g.save();
  g.fillStyle = wood.edge;
  g.globalAlpha = 0.7;
  g.beginPath(); g.arc(x + ux * 1.85, y + uy * 1.85, 0.30, 0, 7); g.fill();
  g.restore();
}

/**
 * LEATHER TOOL SATCHEL at the hip — worn in the build pose. A hard rectangular
 * lump low on the near side, which is a piece of silhouette no other unit type
 * carries in that position.
 */
function vlDrawSatchel(g, leather, steel, x, y) {
  vlLitPath(g, (c) => {
    c.moveTo(x - 1.05, y - 0.20);
    c.lineTo(x + 1.15, y + 0.05);
    c.lineTo(x + 1.00, y + 2.00);
    c.quadraticCurveTo(x + 0.05, y + 2.35, x - 1.05, y + 1.85);
    c.closePath();
  }, x - 1.1, y - 0.25, 2.4, 2.7, leather, { deep: true, edgeW: 0.22, edgeA: 0.8 });

  // Flap and buckle.
  vlLitPath(g, (c) => {
    c.moveTo(x - 1.05, y - 0.20);
    c.lineTo(x + 1.15, y + 0.05);
    c.lineTo(x + 1.05, y + 0.85);
    c.lineTo(x - 1.00, y + 0.62);
    c.closePath();
  }, x - 1.1, y - 0.25, 2.4, 1.3, vlMixRamp(leather, 0.16), { edgeW: 0.2, edgeA: 0.8 });
  g.fillStyle = steel.lit;
  g.globalAlpha = 0.85;
  g.fillRect(x - 0.15, y + 0.55, 0.42, 0.42);
  g.globalAlpha = 1;
}

/**
 * BACK BUNDLE — the carry load. A big hessian sack roped shut, riding high on
 * the shoulders with two lengths of firewood poking out of the neck.
 *
 * This is the largest single silhouette change in the file: it roughly doubles
 * the upper-body mass and puts it BEHIND and ABOVE the shoulder line, which no
 * other type does. A laden villager is recognisable at any zoom.
 */
function vlDrawBundle(g, sack, rope, wood, cx, cy) {
  // Two sticks first, so they emerge from behind the sack.
  vlBone(g, wood, cx - 0.35, cy - 1.55, cx - 2.55, cy - 4.15, 0.48);
  vlBone(g, wood, cx + 0.15, cy - 1.75, cx - 1.30, cy - 4.60, 0.42);

  vlLitPath(g, (c) => {
    c.moveTo(cx - 2.65, cy + 0.55);
    c.quadraticCurveTo(cx - 3.35, cy - 1.35, cx - 2.15, cy - 2.55);
    c.quadraticCurveTo(cx - 0.55, cy - 3.55, cx + 1.35, cy - 2.85);
    c.quadraticCurveTo(cx + 2.95, cy - 1.95, cx + 2.65, cy + 0.35);
    c.quadraticCurveTo(cx + 2.25, cy + 2.35, cx + 0.25, cy + 2.55);
    c.quadraticCurveTo(cx - 1.95, cy + 2.35, cx - 2.65, cy + 0.55);
    c.closePath();
  }, cx - 3.4, cy - 3.6, 6.4, 6.2, sack, { deep: true, edgeW: 0.32, edgeA: 0.9 });

  // Rope binding — two turns round the neck of the sack plus a knot.
  g.save();
  g.lineCap = 'round';
  g.lineWidth = 0.34;
  g.strokeStyle = rope.base;
  g.beginPath();
  g.moveTo(cx - 2.15, cy - 1.65);
  g.quadraticCurveTo(cx - 0.25, cy - 0.85, cx + 2.05, cy - 1.85);
  g.stroke();
  g.lineWidth = 0.18;
  g.strokeStyle = rope.edge; g.globalAlpha = 0.7;
  g.beginPath();
  g.moveTo(cx - 2.15, cy - 1.92);
  g.quadraticCurveTo(cx - 0.25, cy - 1.12, cx + 2.05, cy - 2.10);
  g.stroke();
  g.restore();
  vlLitEllipse(g, cx + 1.55, cy - 1.55, 0.5, 0.42, -0.3, rope, { edgeW: 0.16, edgeA: 0.8 });

  // Sagging creases — three short arcs that give the sack weight.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.22;
  g.strokeStyle = sack.shade; g.globalAlpha = 0.55;
  for (let i = 0; i < 3; i++) {
    const yy = cy + 0.15 + i * 0.72;
    g.beginPath();
    g.moveTo(cx - 2.05 + i * 0.32, yy);
    g.quadraticCurveTo(cx + 0.05, yy + 0.62, cx + 2.05 - i * 0.28, yy - 0.15);
    g.stroke();
  }
  g.restore();

  // Shoulder AO where the load presses down on the back.
  vlContactAO(g, cx + 0.35, cy + 2.15, 3.0, 1.2, 0.48);
}


/* ---------------------------------------------------------------------------
   7. drawWorker — THE ENTRY POINT
   Signature preserved exactly:  (g, nat, pose, legPhase)

     pose      'idle' | 'work' | 'build' | 'carry'
     legPhase  'idle'  : 0 stand, 1 stride A, 2 stride B
               'work'  : 0 axe raised, 1 axe struck
               'build' : 0 mallet raised, 1 mallet struck
               'carry' : 1 laden stride A, 2 laden stride B

   Optional, backward-compatible fields read off `nat` if present (identical
   convention to infantry.js drawSoldier):
     nat.rim       side colour for the baked ground scuff and cloth accents
     nat.headgear  'turban' swaps the straw hat for a wrapped head-cloth
   Neither is required; the painter degrades gracefully without them.
   ------------------------------------------------------------------------ */

function drawWorker(g, nat, pose, legPhase) {
  const gathering = pose === 'work';
  const building  = pose === 'build';
  const carrying  = pose === 'carry';
  const working   = gathering || building;

  // For the two-beat work poses legPhase is the SWING phase, not a stride.
  const strike = working && legPhase === 1;

  // Oversampling factor, derived from the frame canvas so this works whether
  // SCALE is 3, 4 or anything else.
  const S = g.canvas ? (g.canvas.width / VL_W) : 4;

  /* --- palettes ---------------------------------------------------------
     The villager wears no uniform. His cloth is undyed; the nation shows only
     as a faint wash in the apron, and the SIDE shows as the reserved team
     colour on the hat band, the waist sash and the ground scuff. That split is
     deliberate: nation is flavour, side is information.                    */
  const smock   = vlRamp(VL_MAT.smock);
  const smockB  = vlRamp(VL_MAT.smockAlt);
  // Apron carries a 22% wash of the nation trim — enough to tell two nations'
  // villagers apart at close zoom, far too little to compete with a coat.
  const apron   = vlRamp(vlMixHex(VL_MAT.apron, nat.trim, 0.22));
  const breech  = vlRamp(VL_MAT.breech);
  const clog    = vlRamp(VL_MAT.clog);
  const straw   = vlRamp(VL_MAT.straw);
  const leather = vlRamp(VL_MAT.leather);
  const wood    = vlRamp(VL_MAT.haft);
  const steel   = vlRamp(VL_MAT.steel);
  const sack    = vlRamp(VL_MAT.sack);
  const rope    = vlRamp(VL_MAT.rope);
  const hair    = vlRamp(VL_MAT.hair);
  // Weathered outdoor skin — the same nation base pushed toward sunburn.
  const skin    = vlRamp(vlMixHex(nat.skin, '#B07A4E', 0.18));

  // RESERVED TEAM COLOUR, at civilian chroma.
  const teamHex = nat.rim || nat.coat;
  const team    = vlRamp(vlToHex(vlChroma(vlParseHex(teamHex), VL_CIVIL_CHROMA)));

  /* --- pose parameters ---------------------------------------------------
     bob    contact frames sit low, passing frames ride high; without this a
            two-frame walk reads as a sliding decal.
     stoop  DIVERGENCE #4 — the villager is never upright. Even standing he
            carries a forward pitch, and the work poses fold him almost double.
     crouch vertical compression, so a strike drives the whole body down rather
            than just rotating the arms.                                    */
  let bob = 0;
  if (!working) {
    if (legPhase === 1) bob = -0.38;
    else if (legPhase === 2) bob = 0.16;
  }

  let stoop = 0.85, crouch = 0;
  let legMode = 'walk';

  if (gathering) {
    legMode = 'stance';
    stoop  = strike ? 2.55 : -0.20;   // wind back, then fold hard into the blow
    crouch = strike ? 1.25 : 0.10;
  } else if (building) {
    legMode = 'lunge';
    stoop  = strike ? 1.70 : 0.90;
    crouch = strike ? 0.70 : 0.30;
  } else if (carrying) {
    stoop  = 1.75;                    // the load pushes him forward and down
    crouch = 0.45;
  }

  const hipY   = 17.25 + bob + crouch;
  const waistY = 16.75 + bob + crouch;
  const shY    = 12.00 + bob + crouch;
  const headY  = 9.25  + bob + crouch;
  const hemY   = 19.25 + bob + crouch * 0.6;

  const leanW = stoop * 0.32;         // horizontal shift at the waist
  const leanS = stoop;                // at the shoulders
  const leanH = stoop * 1.22;         // at the head

  const hx = VL_BX + 0.65 + leanH;
  const hy = headY;

  // Shoulders are NARROWER than any soldier's: 5.7 against the musketeer's
  // 6.3 and the pikeman's 7.44. Combined with the un-flared hem this makes the
  // villager a slimmer column top to bottom.
  const shHalf = 2.85;
  const wsHalf = 2.50;

  /* --- 1. LEGS. Far limbs first, dimmed, so depth reads. --------------- */
  const legs = vlLegGeometry(legMode, legPhase, hipY);
  vlDrawLeg(g, legs.far, breech, skin, clog, true);
  vlDrawLeg(g, legs.near, breech, skin, clog, false);

  /* --- 2. BACK LOAD (behind the torso) --------------------------------- */
  if (carrying) {
    vlDrawBundle(g, sack, rope, vlMixRamp(wood, 0.18),
      VL_BX - 2.35 + leanS * 0.55, shY + 0.35);
  }

  /* --- 3. FAR ARM (behind the torso) ------------------------------------ */
  const farSh = [VL_BX - 1.75 + leanS, shY + 0.55];
  let farElb, farHand;
  if (gathering) {
    // Both hands on the haft. The far hand rides LOW on the grip; the near
    // hand chokes up. Two hands at different points along one shaft is what
    // makes a swing read as a swing rather than as a wave.
    farElb  = strike ? [VL_BX + 1.30 + leanS, shY + 3.10] : [VL_BX - 2.40 + leanS, shY + 1.05];
    farHand = strike ? [17.20, 15.40] : [15.10, 11.30];
  } else if (building) {
    // Off hand steadies the peg, out in front and low.
    farElb  = [VL_BX - 0.35 + leanS, shY + 2.85];
    farHand = [17.90, 14.60];
  } else if (carrying) {
    // One hand up gripping the shoulder strap.
    farElb  = [VL_BX - 2.60 + leanS, shY + 2.05];
    farHand = [VL_BX - 2.30 + leanW, hipY - 0.30];
  } else {
    // Walking arm swing, counter-phased against the legs.
    const sw = legPhase === 1 ? 1.30 : legPhase === 2 ? -1.10 : -0.15;
    farElb  = [VL_BX - 2.10 + leanS - sw * 0.45, shY + 2.95];
    farHand = [VL_BX - 2.30 + leanW - sw, hipY - 0.20];
  }
  const farCloth = vlDimRamp(smock, 0.40);
  const farSkin  = vlDimRamp(skin, 0.35);
  vlSleeveArm(g, farCloth, farSkin,
    farSh[0], farSh[1], farElb[0], farElb[1], farHand[0], farHand[1], 1.95, 1.45);
  vlHand(g, farSkin, farHand[0], farHand[1], 0.80);

  /* --- 4. LOWER SMOCK — DIVERGENCE #2 -----------------------------------
     A belted tunic with a STRAIGHT, slightly ragged hem. The soldier's coat
     skirt flares and kicks with the stride; this does neither. It is the
     widest part of the villager below the hat and it is barely wider than his
     shoulders, so his lower silhouette is a plain taper where a soldier's is a
     bell.                                                                   */
  vlLitPath(g, (c) => {
    c.moveTo(VL_BX - wsHalf - 0.15 + leanW, waistY - 0.35);
    c.lineTo(VL_BX - 3.15 + leanW, hemY - 0.35);
    // Ragged hem — three shallow notches, cut and re-cut over years.
    c.lineTo(VL_BX - 2.35 + leanW, hemY);
    c.lineTo(VL_BX - 1.55 + leanW, hemY - 0.30);
    c.lineTo(VL_BX - 0.45 + leanW, hemY + 0.15);
    c.lineTo(VL_BX + 0.85 + leanW, hemY - 0.20);
    c.lineTo(VL_BX + 2.05 + leanW, hemY + 0.10);
    c.lineTo(VL_BX + 3.10 + leanW, hemY - 0.40);
    c.lineTo(VL_BX + wsHalf + 0.15 + leanW, waistY - 0.35);
    c.closePath();
  }, VL_BX - 3.4, waistY - 0.5, 6.8, hemY - waistY + 1.0, smock, { deep: true, edgeW: 0.30 });

  // A sewn-on patch at the near hip — a lighter bolt of cloth, crudely
  // stitched. One of the few places a villager gets to look individually poor
  // rather than generically brown.
  vlLitPath(g, (c) => {
    c.moveTo(VL_BX + 0.95 + leanW, waistY + 0.75);
    c.lineTo(VL_BX + 2.55 + leanW, waistY + 0.95);
    c.lineTo(VL_BX + 2.40 + leanW, waistY + 2.35);
    c.lineTo(VL_BX + 0.85 + leanW, waistY + 2.15);
    c.closePath();
  }, VL_BX + 0.8, waistY + 0.7, 1.9, 1.8, smockB, { edgeW: 0.2, edgeA: 0.6 });
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.13;
  g.strokeStyle = smockB.edge; g.globalAlpha = 0.5;
  g.setLineDash([0.28, 0.28]);
  g.beginPath();
  g.rect(VL_BX + 0.92 + leanW, waistY + 0.80, 1.6, 1.45);
  g.stroke();
  g.setLineDash([]);
  g.restore();

  // Shadow pooling where the smock overhangs the legs.
  vlContactAO(g, VL_BX + leanW, hemY - 0.15, 3.4, 1.25, 0.50);

  /* --- 5. UPPER SMOCK ---------------------------------------------------- */
  vlLitPath(g, (c) => {
    c.moveTo(VL_BX - shHalf + leanS, shY + 0.15);
    c.quadraticCurveTo(VL_BX - shHalf - 0.22 + (leanS + leanW) * 0.5, (shY + waistY) * 0.5,
      VL_BX - wsHalf + leanW, waistY + 0.30);
    c.lineTo(VL_BX + wsHalf + leanW, waistY + 0.30);
    c.quadraticCurveTo(VL_BX + shHalf + 0.26 + (leanS + leanW) * 0.5, (shY + waistY) * 0.5,
      VL_BX + shHalf + leanS, shY + 0.15);
    // Rounded, stooped shoulder line — no military squareness anywhere.
    c.quadraticCurveTo(VL_BX + leanS, shY - 1.35, VL_BX - shHalf + leanS, shY + 0.15);
    c.closePath();
  }, VL_BX - shHalf - 0.4, shY - 1.45, shHalf * 2 + 0.8, waistY - shY + 1.8,
    smock, { deep: true, edgeW: 0.32 });

  // Work apron over the chest and belly — a lighter panel with a neck cord.
  // Three vertical value breaks across a 5.7-unit chest is what stops the
  // smock reading as one flat swatch.
  vlLitPath(g, (c) => {
    c.moveTo(VL_BX - 1.45 + leanS, shY + 1.05);
    c.quadraticCurveTo(VL_BX + 0.35 + leanS, shY + 0.55, VL_BX + 2.05 + leanS, shY + 1.25);
    c.quadraticCurveTo(VL_BX + 2.30 + (leanS + leanW) * 0.5, shY + 3.20,
      VL_BX + 1.75 + leanW, waistY + 0.15);
    c.lineTo(VL_BX - 1.15 + leanW, waistY - 0.05);
    c.quadraticCurveTo(VL_BX - 1.70 + (leanS + leanW) * 0.5, shY + 3.10,
      VL_BX - 1.45 + leanS, shY + 1.05);
    c.closePath();
  }, VL_BX - 1.9, shY + 0.5, 4.4, waistY - shY + 0.4, apron, { deep: true, edgeW: 0.26, edgeA: 0.85 });

  // Apron neck cord.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.22;
  g.strokeStyle = apron.shade; g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(VL_BX - 1.30 + leanS, shY + 1.05);
  g.quadraticCurveTo(VL_BX + 0.15 + leanS, shY - 0.30, VL_BX + 1.85 + leanS, shY + 1.20);
  g.stroke();
  g.restore();

  /* --- 6. BELT + RESERVED TEAM SASH -------------------------------------
     The waist sash is the villager's principal block of side colour on the
     figure: a wide band right across the widest, most-lit part of the body,
     plus a knotted tail hanging on the near side. At 0.75x zoom the band alone
     is ~4 screen px of pure team hue, which is what makes a working crew
     legible as yours or theirs without reading the minimap.                 */
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 1.30;
  g.strokeStyle = team.base;
  g.beginPath();
  g.moveTo(VL_BX - wsHalf - 0.15 + leanW, waistY - 0.35);
  g.lineTo(VL_BX + wsHalf + 0.15 + leanW, waistY - 0.05);
  g.stroke();
  // Sunward edge of the sash.
  g.lineWidth = 0.30;
  g.strokeStyle = team.edge;
  g.globalAlpha = 0.78;
  g.beginPath();
  g.moveTo(VL_BX - wsHalf - 0.15 + leanW, waistY - 0.90);
  g.lineTo(VL_BX + wsHalf + 0.15 + leanW, waistY - 0.60);
  g.stroke();
  // Shaded lower edge, so the sash has thickness rather than being a decal.
  g.lineWidth = 0.26;
  g.strokeStyle = team.shade;
  g.globalAlpha = 0.7;
  g.beginPath();
  g.moveTo(VL_BX - wsHalf - 0.10 + leanW, waistY + 0.22);
  g.lineTo(VL_BX + wsHalf + 0.10 + leanW, waistY + 0.52);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();

  // Knotted sash tail on the near hip — extra team-coloured area, and it
  // swings with the stride so it also sells the walk.
  const tailKick = (!working && legPhase === 1) ? 0.55 : (!working && legPhase === 2) ? -0.35 : 0;
  vlLitPath(g, (c) => {
    c.moveTo(VL_BX + 1.85 + leanW, waistY - 0.15);
    c.quadraticCurveTo(VL_BX + 3.05 + leanW + tailKick, waistY + 1.35,
      VL_BX + 2.55 + leanW + tailKick * 1.4, waistY + 3.05);
    c.quadraticCurveTo(VL_BX + 1.85 + leanW + tailKick * 0.6, waistY + 1.85,
      VL_BX + 1.35 + leanW, waistY + 0.25);
    c.closePath();
  }, VL_BX + 1.3, waistY - 0.2, 2.4, 3.4, team, { edgeW: 0.22, edgeA: 0.9 });

  // A plain leather belt riding just under the sash, with a brass tongue.
  g.save();
  g.lineCap = 'butt'; g.lineWidth = 0.42;
  g.strokeStyle = leather.shade;
  g.beginPath();
  g.moveTo(VL_BX - wsHalf - 0.05 + leanW, waistY + 0.62);
  g.lineTo(VL_BX + wsHalf + 0.05 + leanW, waistY + 0.92);
  g.stroke();
  g.restore();

  if (building) vlDrawSatchel(g, leather, steel, VL_BX + 2.65 + leanW, waistY + 0.85);

  /* --- 7. NECK, HEAD, FACE ---------------------------------------------- */
  vlBone(g, vlDimRamp(skin, 0.28), VL_BX + 0.30 + leanS, shY + 0.10, hx - 0.10, hy + 1.90,
    1.30, { edge: false });

  // Open collar with a linen shirt showing — the bright horizontal bar that
  // separates the head mass from the body mass. The soldier gets a tight
  // stock; the villager's is loose and open, which is another small but real
  // difference in the neck silhouette.
  vlLitPath(g, (c) => {
    c.moveTo(hx - 1.55, hy + 1.75);
    c.quadraticCurveTo(hx - 0.15, hy + 2.75, hx + 1.45, hy + 1.85);
    c.quadraticCurveTo(hx + 0.95, hy + 2.60, hx - 0.05, hy + 2.70);
    c.quadraticCurveTo(hx - 1.05, hy + 2.60, hx - 1.55, hy + 1.75);
    c.closePath();
  }, hx - 1.6, hy + 1.7, 3.1, 1.1, vlRamp(VL_MAT.linen), { edgeW: 0.2, edgeA: 0.8 });

  // Loose hair at the nape — no soldier's tied queue, just an unkempt fringe.
  vlBone(g, hair, hx - 1.55, hy + 0.15, hx - 2.20, hy + 1.55, 1.05, { edge: false });
  vlBone(g, hair, hx - 1.15, hy - 1.05, hx - 2.05, hy - 0.05, 0.85, { edge: false });

  // Skull — a path with a nose bump and a jaw so the profile reads.
  vlLitPath(g, (c) => {
    c.moveTo(hx - 2.10, hy - 0.15);
    c.quadraticCurveTo(hx - 2.05, hy - 2.20, hx + 0.10, hy - 2.25);
    c.quadraticCurveTo(hx + 1.80, hy - 2.15, hx + 1.95, hy - 0.50);
    c.lineTo(hx + 2.28, hy - 0.05);              // brow -> nose bridge
    c.lineTo(hx + 1.80, hy + 0.32);              // nose tip
    c.quadraticCurveTo(hx + 2.00, hy + 1.15, hx + 1.10, hy + 1.72);   // chin
    c.quadraticCurveTo(hx - 0.60, hy + 2.35, hx - 1.85, hy + 1.12);   // jaw
    c.closePath();
  }, hx - 2.15, hy - 2.30, 4.5, 4.7, skin, { deep: true, edgeW: 0.26 });

  // Warm ground bounce under the jaw — a man standing on a lit board catches
  // light from below, and it stops the face going to mud.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.22;
  g.fillStyle = VL_SUN.bounce;
  g.beginPath(); g.ellipse(hx + 0.50, hy + 1.30, 1.45, 0.68, 0, 0, 7); g.fill();
  g.restore();

  // Stubble along the jaw — a low-alpha cool wash. Two device pixels of
  // texture, and it is most of the difference between "labourer" and "shaved
  // soldier in a straw hat" at close zoom.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.20;
  g.fillStyle = '#3B3126';
  g.beginPath();
  g.ellipse(hx + 0.35, hy + 1.05, 1.60, 0.95, -0.12, 0, 7);
  g.fill();
  g.restore();

  // Eye socket shadow + eye. One dark notch is enough at this size, and its
  // absence is exactly why the current sprites read as anonymous.
  g.fillStyle = 'rgba(38,26,22,0.42)';
  g.beginPath(); g.ellipse(hx + 1.10, hy - 0.35, 0.82, 0.48, -0.15, 0, 7); g.fill();
  g.fillStyle = '#191218';
  g.beginPath(); g.ellipse(hx + 1.28, hy - 0.32, 0.27, 0.29, 0, 0, 7); g.fill();
  // Brow — heavier than the soldier's, and lowered. A squint under a straw hat.
  g.save();
  g.lineCap = 'round'; g.lineWidth = 0.24;
  g.strokeStyle = 'rgba(48,34,26,0.62)';
  g.beginPath();
  g.moveTo(hx + 0.42, hy - 0.92); g.lineTo(hx + 1.62, hy - 0.78);
  g.stroke();
  g.restore();
  // Cheek highlight on the sunward side of the face.
  g.fillStyle = skin.edge;
  g.globalAlpha = 0.4;
  g.beginPath(); g.ellipse(hx - 0.35, hy - 0.80, 0.82, 0.60, -0.3, 0, 7); g.fill();
  g.globalAlpha = 1;
  // Mouth — set, and slightly open when swinging.
  g.save();
  g.lineCap = 'round'; g.lineWidth = strike ? 0.30 : 0.20;
  g.strokeStyle = 'rgba(60,32,28,0.7)';
  g.beginPath(); g.moveTo(hx + 0.90, hy + 0.95); g.lineTo(hx + 1.55, hy + 0.88); g.stroke();
  g.restore();

  // Headgear — DIVERGENCE #1.
  const tilt = (gathering ? (strike ? 0.30 : -0.10) : building ? 0.18 : carrying ? 0.14 : 0)
    + (!working && legPhase === 1 ? -0.03 : !working && legPhase === 2 ? 0.03 : 0);
  if (nat.headgear === 'turban') {
    vlDrawHeadCloth(g, hx + 0.10, hy - 1.30, tilt,
      vlRamp(vlMixHex(VL_MAT.linen, nat.trim, 0.14)), team);
  } else {
    vlDrawStrawHat(g, hx + 0.15, hy - 1.35, tilt, straw, team);
  }

  /* --- 8. TOOL ----------------------------------------------------------
     Drawn after the head and before the near arm, so the near hand visibly
     grips it — the same layering rule drawSoldier uses for the musket.     */
  let nearHand, nearElb;

  if (gathering) {
    if (strike) {
      // DOWNSWING: the axe has come through and the bit is at the work, low
      // and forward. Haft runs from high-left grip to low-right head.
      vlDrawAxe(g, wood, steel, 16.10, 12.60, 22.10, 16.30);
      nearElb  = [VL_BX + 3.05 + leanS, shY + 1.55];
      nearHand = [18.35, 14.05];
    } else {
      // WIND-UP: the axe is overhead and slightly back, the body opened out.
      // The near hand has choked up the haft toward the head.
      vlDrawAxe(g, wood, steel, 14.90, 11.10, 19.30, 5.60);
      nearElb  = [VL_BX + 2.55 + leanS, shY - 0.85];
      nearHand = [16.85, 8.55];
    }
  } else if (building) {
    // Peg held steady in the off hand across both frames; only the mallet
    // moves. Holding one element still is what makes the other read as motion.
    vlDrawPeg(g, vlMixRamp(wood, 0.10), 18.10, 14.35, -1.15);
    if (strike) {
      vlDrawMallet(g, wood, steel, 18.60, 11.80, 20.90, 13.35);
      nearElb  = [VL_BX + 2.95 + leanS, shY + 1.30];
      nearHand = [18.35, 11.65];
    } else {
      vlDrawMallet(g, wood, steel, 18.10, 11.00, 19.85, 8.30);
      nearElb  = [VL_BX + 3.10 + leanS, shY + 0.30];
      nearHand = [17.90, 10.85];
    }
  } else if (carrying) {
    // No tool in hand — the near arm reaches up to the shoulder strap.
    nearElb  = [VL_BX + 2.35 + leanS, shY + 1.55];
    nearHand = [VL_BX + 0.55 + leanS, shY - 0.55];
  } else {
    // IDLE / WALK — DIVERGENCE #3.
    // The axe rests over the FAR shoulder: grip at the near hip, head up and
    // BACK, making a diagonal spur to the upper LEFT. The musket's spur runs
    // to the upper right and the pike is a vertical mast, so this is the one
    // diagonal no military type occupies.
    const sw = legPhase === 1 ? -1.05 : legPhase === 2 ? 1.15 : 0.10;
    vlDrawAxe(g, wood, steel,
      17.20 + sw * 0.22 + leanW, 18.35,
      11.05 + leanS * 0.45, 9.60);
    nearElb  = [VL_BX + 2.75 + leanS + sw * 0.30, shY + 3.15];
    nearHand = [17.05 + sw * 0.22 + leanW, 17.95];
  }

  /* --- 9. NEAR ARM ------------------------------------------------------ */
  const nearSh = [VL_BX + 1.45 + leanS, shY + 0.70];
  vlSleeveArm(g, smock, skin,
    nearSh[0], nearSh[1], nearElb[0], nearElb[1], nearHand[0], nearHand[1], 2.10, 1.55);
  vlHand(g, skin, nearHand[0], nearHand[1], 0.88);

  // Far hand redrawn OVER the tool for the two-handed poses, so the grip
  // wraps the haft instead of disappearing behind it.
  if (gathering) {
    vlHand(g, vlDimRamp(skin, 0.20), farHand[0], farHand[1], 0.82);
  } else if (carrying) {
    // Shoulder strap, drawn last so it crosses the chest over the smock.
    g.save();
    g.lineCap = 'round'; g.lineWidth = 0.65;
    g.strokeStyle = rope.base;
    g.beginPath();
    g.moveTo(VL_BX - 1.35 + leanS, shY - 0.55);
    g.quadraticCurveTo(VL_BX + 1.05 + leanS, shY + 1.65, VL_BX + 1.55 + leanW, waistY - 0.45);
    g.stroke();
    g.lineWidth = 0.22;
    g.strokeStyle = rope.edge; g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(VL_BX - 1.55 + leanS, shY - 0.75);
    g.quadraticCurveTo(VL_BX + 0.85 + leanS, shY + 1.45, VL_BX + 1.35 + leanW, waistY - 0.65);
    g.stroke();
    g.restore();
  }

  /* --- 10. WHOLE-FIGURE PASSES ------------------------------------------ */
  vlPassGalleryLight(g, VL_W, VL_H);
  vlPassRecessWash(g, S);
  vlPassMatteVarnish(g, VL_W, VL_H);

  /* --- 11. LINING + BAKED GROUND ---------------------------------------- */
  // A material-tinted lining: dark enough to guarantee separation from any
  // terrain value, tinted by the smock so it reads as painted rather than as a
  // vector stroke. Luminance is force-clamped inside vlRamp().
  vlPassLining(g, S, smock.line);

  // Scuff radius 4.6 against infantry's 5.2 — a smaller footprint for a
  // smaller, quieter figure, and it keeps a dense worker crowd from turning
  // into one continuous slab of team colour.
  vlPassGroundContact(g, S, VL_BX + 0.15, VL_GY + 0.35, 4.6, teamHex);
}
export { drawWorker, VL_W, VL_H, VL_AX, VL_AY };
