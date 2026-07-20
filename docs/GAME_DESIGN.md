# Settlement Skirmish Plan

## Player promise

Start in 1700 with only a Town Center, turn a small settlement into a working
economy, and field armies far beyond the population scale of a conventional
historical RTS. England and the Ottoman Empire use the same readable core rules
with light, historically flavored bonuses rather than opaque hard counters.

## Complete loop in this release

1. The Town Center automatically prepares the first villager so a literal
   Town-Center-only start cannot deadlock.
2. Villagers gather food, wood, gold, and stone from visible map deposits.
3. Villagers place and construct houses, mills with attached fields, economic camps, barracks,
   stables, artillery foundries, and towers.
4. Buildings train individual units or batches of 5 and 20. Houses expand the
   population cap to a maximum of 1,200.
5. The enemy follows the same economic progression, fortifies its settlement,
   and launches increasingly large attack waves.
6. Destroying the enemy Town Center wins the skirmish; losing yours ends it.

## CPU difficulty plan

Every new campaign chooses CPU difficulty before the country selector unlocks.
All levels obey the same resource, construction, population, unit-stat, and
combat rules as the player.

| Level | Economy and production | Battlefield pressure |
| --- | --- | --- |
| Low | Slower 1.75-second planning, 14 villagers, later military buildings, smaller batches, one tower | First attack timer 160s; 14/24 minimum troops and at most 55% of the ready army per wave |
| Medium | 1.25-second planning, 18 villagers, balanced building milestones and batches, up to two towers | First attack timer 125s; 20/32 minimum troops and at most 70% of the ready army per wave |
| Hard | Original one-second planning, 22 villagers, original milestones and batches, two towers | Original 92s first attack; 24/40 minimum troops and at most 80% of the ready army per wave |

Lower levels also defend a smaller radius and wait longer between attacks.
Campaign saves persist the selected level; saves from before this feature use
Hard so their opponent behavior does not silently change.

## Deliberate boundaries

This is an original 1700s RTS core loop inspired by the readability of classic
base builders and the army scale of mass-battle games. It does not copy another
game's assets, campaigns, technology tree, maps, or exact balance. Future work
can add naval warfare, walls and gates, diplomacy, trading, campaigns, saved
games, additional nations, and deeper technologies without replacing the
economy or entity interfaces introduced here.

## Acceptance checks

- A new match visibly starts with one Town Center and no units.
- The first villager emerges, can gather, establish a mill and fields, construct military
  infrastructure, and explicitly draw a low-powered civilian musket against a hovered enemy
  soldier or building.
- Resource costs, population reservations, construction, and queues cannot go
  negative or exceed the cap.
- England and the Ottoman Empire have distinct visuals and bonuses.
- Batch queues can grow the battle into hundreds or thousands of soldiers.
- The enemy establishes a base and attacks rather than receiving an instant
  pre-deployed army.
- Both Town Center victory paths work and the skirmish can be restarted.
