# Modular Stone Wall Kit

Production kit for Empires: 1700 fortifications — early-to-mid 18th-century
Eastern/Central European rubble curtains in the spirit of classic RTS stone
walls (Cossacks), implemented on the game's connected Canvas model.

## Pieces

| Piece | Building type | Length | Role |
| --- | --- | --- | --- |
| Straight 4 m | `wall` | 88 wu | Primary drag-placed curtain |
| Straight 2 m | `wall_short` | 44 wu | Filler beside gates and corners |
| Outer / inner corner | topology on `wall` | 88 wu | Classified when two axes bend |
| T-junction | topology on `wall` | 88 wu | Classified when ≥3 ends meet |
| End / terminal | topology on `wall` | 88 wu | Free socket gets dressed quoins |
| Gatehouse | `gate` | 104 wu | Arched passage + timber leaves |
| Ramp / stair | `wall_stairs` | — | Access to the terreplein |

World units use `WALL_KIT_UNITS_PER_METRE = 22`, so thickness `h: 22` is a
walkable ~2.0 m terreplein body.

## Zero-seam contract

1. Every curtain piece exposes sockets at ±`halfLength` on its module axis.
2. Snap placement seats a new piece so sockets coincide (`WALL_KIT_SOCKET_TOLERANCE`).
3. Joined ends suppress `endPlane` geometry and terminal quoins.
4. Neighbouring stamps overlap by `WALL_KIT_SEAM_OVERLAP` (3 wu) so walks mitre.
5. World-space UV (`wallKitWorldUvOrigin`) keeps rubble texture continuous across
   module boundaries — no repeating brick grid on long runs.
6. Collision / pathing stay on `fortificationFrame()`; visual relief never
   changes the walk footprint.

API entry points live in `js/wall-kit.js`:

- `WALL_KIT_PIECES` — canonical catalogue
- `classifyWallKitTopology(building, world)` — straight / corner / T / end
- `snapWallKitPieceToSocket(type, orientation, socket, socketId)`
- `wallKitCollisionProfile(type)` — LOD + walk/parapet box for exporters
- `wallKitExtensionRules()` — how to add a new piece without breaking seams

## Visual rules

- Face masonry is **irregular random rubble** with thick lime mortar, chips,
  tool marks, lichen and water stains — never uniform brick courses.
- Dressed (ashlar) stones appear only at exposed ends, corner/T quoins, the
  coping course, and gate arch / flanking pillars.
- Moss/lichen intensity rises on the settlement-facing side and at inner corners
  (`mossBias` on the masonry detail profile).
- Gate **timber leaves** are a separate animatable layer driven by
  `gateOpenProgress`, independent of the stone shell and iron portcullis.

## LODs

| LOD | Use | Contents |
| --- | --- | --- |
| 0 | Gameplay zoom | Full rubble pack, relief, patina, textured faces, gate hardware |
| 1 | Mid distance | Block shell + textured faces; skip micro cracks |
| 2 | Minimap / far | Silhouette blocks only |

Runtime baking already collapses LOD0 into one blit per cache key
(`fort-v3|…`). Cache keys include nation, type, topology piece id, join mask,
interior side, gate frame and a quantized world-UV bin.

## Collision / walkability

- Solid volume: `fortificationFrame` box (`w` × `h`).
- Walk surface: recessed terreplein between parapets; musketeers use wall slots
  along the full connected run (2 slots on short modules, 5 on 4 m, 4 on gates).
- Outer parapet is visual only for blocking; units stay on the walk elevation
  (`WALL_WALK_ELEVATION` / gate elevation).
- Stairs (`wall_stairs`) are the only legal ascent — no clipping teleports.

## Materials / textures

| Asset | Role |
| --- | --- |
| `english-fortification-masonry.png` | English dark irregular fieldstone |
| `ottoman-fortification-masonry.png` | Ottoman warm limestone rubble |
| `fortification-masonry.webp` | Shared fallback sheet |
| `fortification-walkway.webp` | Terreplein + coping top |

Regenerate with:

```sh
npm run generate:wall-textures
```

PBR export note: the Canvas path bakes albedo response, directional bevel
lighting and AO-like contact shade into the stamp. For an external engine,
treat the masonry sheets as albedo, derive normals from height/bevel, keep
roughness high (~0.85 stone / ~0.55 damp mortar) and reuse the same world-UV
origins for seamless tiling.

## Extending the kit

Follow `wallKitExtensionRules().howToAddPiece`:

1. Add a `BUILDING_TYPES` entry on the 2 m grid with `fortification` or
   `wallAttachment`.
2. Register it in `WALL_KIT_PIECES`.
3. Teach `isWallSegmentType` / topology if it is walkable curtain.
4. Paint through `bdPaintFortification` (or a dedicated painter) **without**
   changing socket coordinates.
5. Add snap, seam and walkability tests.

## Visual QA

`?debug=fortification-gallery` on localhost shows both factions with straight
4 m + 2 m filler, bend, staircase, open/closed gate and damaged wall in the
live renderer.
