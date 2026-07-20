# Building Fire and Destruction Visual Plan

## Readability goals

The complete attack must read without UI: who attacked, what was thrown, where it landed,
how close the structure is to failure, and what remains after destruction. The sequence uses
the same upper-left key light as the rest of the battlefield and scales every effect from the
building footprint so a house never collapses like a Town Center.

## Sequence

1. **Throw (0-0.48 seconds).** Infantry or a cavalry rider raises a wrapped, burning torch and
   extends the throwing arm toward the target. A warm halo, blackened cloth head, wood shaft,
   and faction-colored sleeve keep the action readable over production sprites.
2. **Flight (0.38-0.92 seconds).** The pre-baked torch rotates through sixteen headings along a
   distance-scaled arc. Its flame has a hot cream core, orange body, red edge, trailing glow,
   and a height-sensitive ground shadow. Damage is not applied until impact.
3. **Impact.** A dry masonry/wood thud, flame whoosh, smoke puff, flash, and six directional
   embers mark the exact roof point. The target gains a persistent deterministic fire seed.
4. **Sustained burn.** Two to six independently phased flames occupy repeatable roof and wall
   anchors. Health controls flame count, size, smoke volume, ember rate, soot, cracks, and the
   fire sound layer. Repeated hits add urgency without creating an unbounded effect count.
5. **Collapse (1.45 seconds).** At zero health the charred structure shudders, shears, sinks,
   compresses, and fades through a dust bank, vertical dirt column, thrown debris, smoke, and
   the existing multi-layer collapse sound. Gameplay ownership and collision end immediately.
6. **Aftermath.** A footprint-sized persistent ruin is revealed: irregular scorch bed, broken
   stone wall stubs, crossed charred roof timbers, dozens of rubble pieces, ash drift, and scorch
   tongues. The ruin is a ground decal, so later troops and effects correctly pass over it.

## Performance and persistence

- Torch headings and eight-frame, three-severity flame animation are baked into atlases once.
- Runtime fire anchors are derived from the building id/seed and require only sprite blits.
- Smoke and ember emission shares the capped battlefield particle pool.
- Ignition, fire seed, in-flight torch target/attacker, and mid-collapse state are serialized.
- Collapse objects expire; only the inexpensive ruin decal persists in long campaigns.

## Acceptance checks

The repeatable local visual scenario is available at `?debug=building-fire` on localhost.

- Musketeers, pikemen, and cavalry all throw torches when their target is a building.
- Building health is unchanged while the torch is in flight and falls on impact.
- Fire remains spatially attached to the struck structure and escalates as health falls.
- Zero health never makes a structure disappear in one frame.
- House, stable, mill, fortification, and Town Center ruins match their original footprints.
- Saving during flight, fire, or collapse restores the same stage and entity links.
