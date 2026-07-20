# Graphics subsystems

The renderer combines procedural art with checked-in, high-resolution sprites
where fine masonry, weathering, glazing, foliage, carved ornament, cloth, and
human anatomy need to survive close gameplay zoom. England's complete building
roster, both nations' civilians, natural resource nodes, meadow, and country
vegetation use coordinated production-art sets. Those assets are preloaded
before battle setup and enter the same caches as procedural art, so a completed
building, resource, or unit still costs one runtime blit. Procedural paths
remain as resilient fallbacks.

Everything here implements one art direction — **Kriegsspiel Table**: the player
is looking down at a painted 1:72 wargame diorama under a single warm gallery
photoflood mounted up and to the left. Figures are painted miniatures; the
ground is a modelled board.

## The rules every painter obeys

The whole effect depends on consistency. A figure lit from a different angle
than the ground it stands on destroys it. If you add or change a painter, these
are not suggestions:

**One sun, for the entire game.**

```js
SUN = { x: -0.64, y: -0.77, elevDeg: 38 }   // unit vector TOWARD the light
shadow direction = { x: 0.64, y: 0.77 }     // shadows fall down-right
key  '#FFF1CE'   // warm photoflood
fill '#8FA4C4'   // cool room bounce
shadowRGB '26,30,48'
```

Contact shadows are cool blue-violet, never pure black — a warm key light
produces cool shadows, and pure black desaturates the flock underneath.

**Hard-edged shading, not gradients, in procedural painters.** Each procedural material is painted from a ramp
(`out` / `shade` / `base` / `lit`) derived programmatically from one base hex, so
every nation's colours work automatically. Gradients inside a material read as
muddy realism; the ramp reads as painted. Pre-rendered production assets are the
deliberate exception: their material response is already baked into the source
art and must bypass lining and gallery-light post-processes.

**Team colour lives on military base rims.** Every procedural military sprite
is glued to an oval base whose rim is solid side colour — `#3E78B8` for side 0,
`#B8483E` for side 1. Production civilians instead retain a natural cast shadow
and use their nation-specific dress plus the live selection ring for identity;
adding a painted pedestal would undo their new material depth.

**Keep every drawn pixel inside the frame box, and put the anchor at `w/2`.**
Sprites are mirrored for the left-facing copy by drawing at `ix - ax`, which is
only geometrically right when `ax === w/2`. Two real bugs came from ignoring
this: idle pikemen had their pike tips clipped off, and cavalry frames were
clipping the horse's head.

## The performance contract

A battle can put thousands of units on the field, so:

- Work done **once** — sprite atlas painting, terrain baking, decal stamping,
  texture pre-baking — is effectively free. Be lavish there. That is where all
  the quality comes from.
- Procedural buildings bake at 4x and procedural resources at 3x. Production
  sprites load once, then use lazy scale/damage/depletion variants. Civilian
  production frames bake into the same left/right unit atlas at battle start.
  The Town Center's waving flag is the only live architectural overlay.
- Work done **per unit per frame** must stay at about one `drawImage`. Per-unit
  gradients, shadow ellipses, `save`/`restore` churn, `ctx.filter` or
  `ctx.shadowBlur` in the hot loop are regressions.
- `ctx.filter` and `ctx.shadowBlur` are acceptable **only** in once-baked code.

Measured at 1,625 living units: 0.4ms median frame draw against a 16.7ms budget.

## Files

| File | Owns |
| --- | --- |
| `art-assets.js` | Central URL registry, preload lifecycle and lookup for production art. |
| `terrain.js` | The board: production meadow, hedgerow and scrub art; material field; parcels; road; stream; and restrained procedural foliage. Bakes 1:1 into frustum-culled tiles; `drawTerrain()` is ≤12 blits. |
| `buildings.js` | Nation-specific 18th-century architecture, farms, production and procedural resource nodes, scene props, waving Union flag, and cached damage/depletion states. |
| `assets/buildings/` | Transparent high-resolution sources for every completed England structure. |
| `assets/resources/` | Transparent woodland, berry, stone, and gold sources. |
| `assets/terrain/` | Seamless meadow plus alpha country-vegetation sources. |
| `assets/units/` | Four-frame English and Ottoman civilian production sheets. |
| `infantry.js` | `drawSoldier()` — musketeers and pikemen. |
| `mounted.js` | `drawCavalry()`, `drawCannon()`. |
| `villager.js` | `drawWorker()` — resilient procedural civilian fallback with axe, pickaxe, hoe, sickle, and mallet poses. |
| `worker-animation.js` | Shared job-to-tool action mapping and cached atlas-frame selection. |
| `decals.js` | Persistent aftermath: corpses, craters, wrecks, ruins, trample. |
| `effects.js` | Powder smoke, muzzle flash, projectiles, blood, dust. |
| `composite.js` | Frame composition: haze, grade, vignette, selection, health bars, order flags, minimap. |

These are ES modules rather than one spliced file for a concrete reason:
`infantry.js` and `terrain.js` both define `SUN`, `ramp`, `toHex`, `mixHex` and
`rgba` at top level. In a single file that is a `SyntaxError`; as modules each
has its own scope.

`render.js` owns the camera, viewport and minimap canvas and injects them
(`setEffectsCamera`, `setCompositeRefs`, …) rather than these modules importing
`render.js`, which would be a cycle.

## Tuning note

`composite.js` has an `ATMOS_STRENGTH` constant on the aerial-perspective pass.
The subsystem shipped at full strength, which washed the board to a flat pale
olive and buried the terrain texture underneath it. It is dialled to 0.34, and
the warm soft-light wash is held at 0.42 alpha — a film of air, not a fog bank.
If the field ever looks khaki and flat, look here first.
