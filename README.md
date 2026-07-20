# Empires: 1700

A browser-based real-time strategy game about building an 18th-century
settlement into an empire and fielding armies at *Cossacks* scale. England and
the Ottoman Empire begin with one Town Center, grow real economies, construct
bases, and fight for the rival seat of power.

The game has no runtime dependencies or build step. Military troops, effects,
sound, and the Ottoman settlement are generated procedurally with plain HTML,
CSS, and JavaScript. English and Ottoman civilians use detailed production-art
animation sheets; England's completed structures use a coordinated
high-resolution Georgian/colonial set; and the woodland, berry, stone, gold,
meadow, trees, rocks, river, road, cultivated soil, hedge, and scrub assets
share the same grounded palette and lighting.
These preloaded sprites retain deterministic damage and depletion states
without adding per-frame painting work. The British Town Center carries a
live, cloth-animated Union flag above the cached architectural sprite.

## Play

```sh
npm start
# open http://localhost:8000
```

## The skirmish loop

- Begin with exactly one Town Center. A free first villager emerges so the
  opening cannot deadlock.
- Gather food, wood, gold, and stone from deposits across a 5,200 × 3,200 map.
- Build houses, mills with attached renewable fields, lumber and mining camps, barracks,
  stables, artillery foundries, and defensive towers.
- Employ villagers directly at completed mills and economic camps, with exact
  assigned and live income-per-hour readouts for each resource.
- Train villagers, musketeers, pikemen, hussars, and cannon individually or in
  batches of 5 and 20.
- Expand population capacity to 1,200 and retain the optimized formation,
  morale, volley, cavalry-charge, artillery, and spatial-grid combat systems.
- Destroy the enemy Town Center while protecting your own.

The Ottoman or English opponent uses the same resource costs, construction,
population, and training queues as the player. It develops a settlement and
then sends progressively larger, staged formations into battle.

## Nations

| Nation | Character |
| --- | --- |
| England | Disciplined redcoats reload 10% faster; fields produce 15% more food. |
| Ottoman Empire | Cavalry moves 15% faster; villagers train 10% faster. |

## Controls

- **Left-click / drag** — select a building, villager, or regiment
- **Select infantry, cavalry, artillery, or villagers, then left-click open ground** — move the formation to a flagged waypoint
- **Select units, then left-click an enemy** — focus the selection on that attack target
- **Select villagers, then hover and left-click a deposit or economic building** — gather resources or work there
- **Select villagers, then hover and left-click an enemy soldier or building** — draw civilian muskets and attack at reduced range, accuracy, fire rate, and damage
- **Right-click / Mac two-finger click / Control-click** — alternate move, construct, attack, wall-mount, or rally command
- **Town Center selected + primary click on a resource or worksite** — send newly trained villagers there to gather, work, or build
- **Build card, then click terrain** — place a foundation
- **Stone Wall, then press-drag-release** — preview and place the longest connected run your stone and open terrain allow
- **Villager + open-ground click** — route around walls, buildings, and deposits on the way to the waypoint
- **Cancel placement** — click the placement button or any HUD panel; Esc and secondary-click also work
- **L / C / B** — line, column, or square formation
- **H** — halt; **P** — pause; **F** — select all military units
- **Ctrl/Command+1–9** — set a control group; **1–9** — recall it
- **WASD / arrows / screen edge** — pan; **wheel** — zoom; **minimap** — jump

## Development

```sh
npm run check  # syntax checks
npm test       # economy, construction, production, victory, and mass-unit tests
```

## Code layout

| File | Responsibility |
| --- | --- |
| `js/config.js` | Nations, units, buildings, costs, map and balance data |
| `js/economy.js` | Resources, gathering, construction, queues and population |
| `js/sim.js` | Fixed-step movement, combat, morale, projectiles and victory |
| `js/ai.js` | Enemy settlement development, production and attack waves |
| `js/formations.js` | Large-formation slot math and order assignment |
| `js/render.js` | Camera, frame composition and minimap orchestration |
| `js/gfx/art-assets.js` | Shared preload registry for production buildings, civilians, resources and terrain art |
| `js/gfx/buildings.js` | High-resolution architecture, farms, resources, props and damage variants |
| `js/gfx/*.js` | Terrain, miniatures, effects, decals and composition passes |
| `js/input.js` | Selection, contextual orders, placement and camera controls |
| `js/ui.js` | Menus, resource HUD, objectives and command cards |
| `js/main.js` | Game loop and module wiring |

See [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) for the release boundaries and
acceptance criteria. This is an original, fan-inspired project and does not use
assets or code from the games that inspired its base-building and battle scale.
