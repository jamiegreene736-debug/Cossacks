# Empires: 1700

A browser-based real-time strategy game about building an 18th-century
settlement into an empire and fielding armies at *Cossacks* scale. A default
skirmish is a 2v2 town war: England and its Hogwarts ally grow against the
Ottoman Empire and the Nightmare Circus, all racing for the enemy team's seats
of power.

The game has no runtime dependencies or build step. Military troops, effects,
sound, and the Ottoman settlement are generated procedurally with plain HTML,
CSS, and JavaScript. English and Ottoman civilians use detailed production-art
animation sheets; England's completed structures use a coordinated
high-resolution Georgian/colonial set; house variants are built from the same
production art into cottages, row houses, ginormous estates, and a restrained
creepy mansion; and the woodland, berry, orchard, grain, garden produce, stone,
gold, meadow, trees, rocks, river, road, cultivated soil,
hedge, and scrub assets
share the same grounded palette and lighting.
These preloaded sprites retain deterministic damage and depletion states
without adding per-frame painting work. The British Town Center carries a
live, cloth-animated Union flag above the cached architectural sprite.
Hogwarts and the Nightmare Circus add dedicated lossless character sheets and
complete isometric architecture sets. The allied opening district includes a
free grand castle, Great Hall school, enchanted pool, Black Lake beach, house,
regional World Park, and inclusive playground. Children are scenery residents
of the protected playground only: they are never units, targets, or combatants.

## Play

```sh
npm start
# open http://localhost:8000
```

## The skirmish loop

- Begin with exactly one Town Center per side in a 2v2 layout. A free first
  villager emerges from every Town Center so the opening cannot deadlock.
- Gather food, wood, gold, and stone from deposits across a 5,200 × 3,200 map,
  including denser woods and varied food sources.
- Build houses, mills with attached renewable fields, lumber and mining camps, barracks,
  stables, artillery foundries, defensive towers, schools, pools, beaches,
  regional parks, playgrounds, and a late-game Grand Artillery Castle.
- Employ villagers directly at completed mills and economic camps, with exact
  assigned and live income-per-hour readouts for each resource.
- Train villagers, women villagers, musketeers, pikemen, hussars, and cannon individually or in
  batches of 5 and 20.
- Raise the costly bastioned castle to fire long-range three-cannon volleys and
  recruit infantry, cavalry, or artillery from one fortified command post.
- Expand population capacity to 1,200 and retain the optimized formation,
  morale, volley, cavalry-charge, artillery, and spatial-grid combat systems.
- Marching trained soldiers automatically engage nearby enemies, reposition for
  their weapon, and resume their original route after the skirmish. Villager
  weapons remain explicit-order only. Women villagers wheel out a compact
  cannon whose direct hit instantly defeats a soldier; civilians and buildings
  receive its ordinary damage instead.
- Destroy both rival Town Centers while protecting your team's towns. A sudden
  rainbow breaks over the battlefield when your team wins.
- Choose any of 195 countries for the World Park identity. The catalogue uses
  the 193 UN member states and two permanent observer states; five detailed
  regional park variants make that global layer practical without pretending
  every real park is an individually simulated military building.

The Ottoman or English opponent uses the same resource costs, construction,
population, and training queues as the player. It develops a settlement and
then sends progressively larger, staged formations into battle. Before choosing
a country, each new campaign requires one CPU difficulty choice:

- **Low** plans less often, grows to 14 villagers, delays military expansion,
  and sends smaller waves beginning around 160 seconds.
- **Medium** grows to 18 villagers and uses measured production and attack
  timings, with its first assault planned around 125 seconds.
- **Hard** preserves the original 22-villager, rapid-production opponent and
  its massed attacks beginning around 92 seconds.

Difficulty changes CPU planning, production, defense, and attack pressure. It
does not alter unit combat stats or give the CPU free resources.

## Factions

| Nation | Character |
| --- | --- |
| England | Disciplined redcoats reload 10% faster; fields produce 15% more food. |
| Ottoman Empire | Cavalry moves 15% faster; villagers train 10% faster. |
| Hogwarts | Allied wizards and witches gather, build, duel, and train Moaning Myrtle from the Town Center. |
| Nightmare Circus | Enemy AI produces Pennywise, Art the Clown, Twisty, Captain Spaulding, and Killer Klowns. |

## Controls

- **Left-click / drag** — select a building, villager, or regiment
- **Select infantry, cavalry, artillery, or villagers, then left-click open ground** — move the formation to a flagged waypoint
- **Select units, then left-click an enemy** — focus the selection on that attack target
- **Select villagers, then hover and left-click a deposit or economic building** — gather resources or work there
- **Select villagers, then hover and left-click a damaged friendly building** — use the hammer cursor to assign repairs, suppress any fire, and rebuild it to full integrity
- **Select villagers, then hover and left-click an enemy soldier or building** — men draw civilian muskets; women wheel out their compact cannon, whose direct hit instantly defeats a soldier
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
- **Three-finger / horizontal trackpad swipe over the battlefield** — turn to the opposing camera view; one swipe produces one turn and preserves Q/E and HUD-arrow alternatives

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
