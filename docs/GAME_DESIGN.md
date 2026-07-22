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
   Town Centers train both men and women; both perform every worker job.
3. Villagers place and construct houses, mills with attached fields, economic camps, barracks,
   stables, artillery foundries, towers, and the late-game Grand Artillery Castle.
4. Buildings train individual units or batches of 5 and 20. Houses expand the
   population cap to a maximum of 1,200.
5. The enemy follows the same economic progression, fortifies its settlement,
   and launches increasingly large attack waves.
6. England and Hogwarts must destroy both Ottoman and Nightmare Circus Town
   Centers; the allied team loses only after both friendly Town Centers fall.

## Authored 2v2 scenario

- Side 0 remains the human England settlement.
- Side 2 is the Hogwarts ally. Its Town Center is a towering school castle and
  its complete opening civic district is free. Wizards and witches share the
  worker surface; Moaning Myrtle is trained from the Town Center as a spectral
  ranged unit.
- Side 1 remains the Ottoman opponent.
- Side 3 is the Nightmare Circus opponent. Its AI uses five distinct clown
  identities across melee, ranged, and artillery-like roles.
- A 195-country catalogue selects the World Park identity. Five regional park
  variants and one inclusive playground represent this non-military civic
  layer. Civic sites cannot be damaged, and children are painted residents
  rather than targetable entities.

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

## Grand Artillery Castle

The castle is the settlement's final military investment: 900 wood, 650 gold,
and 1,400 stone with a 52-second build. Its 8,500 integrity and 118-unit
footprint make it the largest structure in the roster. It automatically fires a
three-round cannon volley with splash damage to 590 range, well beyond the
Watch Tower's 330, and can train musketeers, pikes, cavalry, and cannon. Both
nations receive the same combat values and roster; their command keeps and roof
profiles remain visually distinct. The CPU may build one after completing its
artillery foundry and reaching its late-game villager threshold.

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
- Women villagers are separately trainable for England and the Ottoman Empire,
  retain every construction/economy order, and use an explicit deploy-aim-fire-recoil
  cannon sequence. A direct shot defeats any soldier instantly without applying
  that lethal override to civilians or buildings.
- Damaged completed buildings remain operational and can be explicitly repaired by selected
  villagers. Multiple repairers stack their labor; active crews suppress flames while the
  damage art, scaffolding, and working course visibly return the structure to full integrity.
- Resource costs, population reservations, construction, and queues cannot go
  negative or exceed the cap.
- England and the Ottoman Empire have distinct visuals and bonuses.
- Hogwarts and Nightmare Circus use dedicated architecture and character art;
  no fantasy unit falls back to a historical costume row.
- The default four factions, free Hogwarts landmarks, Moaning Myrtle training,
  clown-only rival production, 195-country catalogue, and protected civic
  buildings survive save and resume.
- Batch queues can grow the battle into hundreds or thousands of soldiers.
- The enemy establishes a base and attacks rather than receiving an instant
  pre-deployed army.
- Both Town Center victory paths work and the skirmish can be restarted.
