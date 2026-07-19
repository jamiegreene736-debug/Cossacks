# Cossacks: Line of Fire

A browser-based real-time tactics game inspired by the classic *Cossacks:
European Wars* — massed armies of the early 1700s clashing on an open field.
Runs on any Mac (or anything else) in Chrome. No install, no plugins, no build
step, no dependencies: plain HTML, CSS, and JavaScript on a 2D canvas.

![Era](https://img.shields.io/badge/era-1700s-8f6b2f) ![Platform](https://img.shields.io/badge/platform-browser-2a4d8f)

## Play

Any static file server works. From the repo folder:

```sh
# macOS has Python preinstalled:
python3 -m http.server 8000
# then open http://localhost:8000 in Chrome
```

or `npx serve` if you have Node.

## The game

Pick a nation, pick a battle size — up to **~3,200 soldiers** on the field at
once — and break the enemy army.

**Units**

| Unit | Role |
| --- | --- |
| Musketeers | Line infantry. Halt and volley when the enemy is in range; long reload between volleys. |
| Pikemen | Melee wall. Devastating against cavalry. |
| Hussars | Fast shock cavalry. Damage scales with charge momentum — hit at full gallop. |
| Cannon | Long-range roundshot with splash damage. Doesn't distinguish friend from foe. |

**Nations** — Russia, Sweden, France, Austria, Poland, and the Ottomans, each
with a light flavor bonus (Swedish reload drill, Polish hussars, etc.).

**Morale** — soldiers who see comrades fall and take heavy fire will break and
rout. Collapse the enemy's will to fight and the battle is yours.

**Controls**

- **Drag** — select troops. **Shift** adds to selection. **F** — select all
- **Right-click** — march (attack-move); right-click an enemy to focus attack
- **L / C / B** — Line / Column / Square formation (square repels cavalry)
- **H** — halt · **P** — pause · **Ctrl+1–9** set control group, **1–9** recall
- **WASD / arrows / screen edge** — pan · **wheel** — zoom · **minimap** — click to jump

## How it handles big armies

- Fixed 30 Hz simulation with interpolated 60 fps rendering
- Flat uniform spatial grids rebuilt per tick with counting sort (no GC churn)
- Staggered target acquisition; collision separation only for moving units
- All sprites pre-rendered to offscreen atlases at load; corpses and craters
  are painted once onto a persistent decal canvas — the battlefield litter of
  a long fight costs nothing per frame

## Code layout

| File | What it does |
| --- | --- |
| `js/config.js` | Nations, unit stats, army sizes |
| `js/sim.js` | The battle simulation: combat, morale, projectiles |
| `js/ai.js` | Enemy commander: infantry line, artillery, cavalry flanking |
| `js/formations.js` | Formation slot math and order assignment |
| `js/render.js` | Canvas renderer, procedural sprites, terrain, minimap |
| `js/input.js` | Selection, orders, camera |
| `js/ui.js` | Menus and HUD |
| `js/main.js` | Game loop |

All art and sound are generated procedurally in code — there are no asset
files in this repo. This is an original fan-inspired project; it contains no
assets or code from the original game.
