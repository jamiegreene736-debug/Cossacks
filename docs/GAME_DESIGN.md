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
3. Villagers place and construct houses, farms, economic camps, barracks,
   stables, artillery foundries, and towers.
4. Buildings train individual units or batches of 5 and 20. Houses expand the
   population cap to a maximum of 1,200.
5. The enemy follows the same economic progression, fortifies its settlement,
   and launches increasingly large attack waves.
6. Destroying the enemy Town Center wins the skirmish; losing yours ends it.

## Deliberate boundaries

This is an original 1700s RTS core loop inspired by the readability of classic
base builders and the army scale of mass-battle games. It does not copy another
game's assets, campaigns, technology tree, maps, or exact balance. Future work
can add naval warfare, walls and gates, diplomacy, trading, campaigns, saved
games, additional nations, and deeper technologies without replacing the
economy or entity interfaces introduced here.

## Acceptance checks

- A new match visibly starts with one Town Center and no units.
- The first villager emerges, can gather, place a farm, and construct military
  buildings.
- Resource costs, population reservations, construction, and queues cannot go
  negative or exceed the cap.
- England and the Ottoman Empire have distinct visuals and bonuses.
- Batch queues can grow the battle into hundreds or thousands of soldiers.
- The enemy establishes a base and attacks rather than receiving an instant
  pre-deployed army.
- Both Town Center victory paths work and the skirmish can be restarted.
