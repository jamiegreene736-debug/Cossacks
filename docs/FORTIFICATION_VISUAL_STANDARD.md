# Fortification Visual Standard

This is the acceptance contract for every wall, bend, gate and staircase shown
at normal gameplay zoom. The system targets the density and silhouette clarity
of the best classic RTS fortifications while retaining the physical inside and
outside faces required by the rotatable battlefield.

1. **Gameplay read:** a wall must read as one heavy defensive run before its
   individual stones become visible. Human figures remain the scale reference.
2. **Rendering:** fortifications use the connected Canvas model for every
   faction and orientation. Legacy fixed-angle sheets must not replace a saved
   or newly built section. Stamps are painted in VIEW space: each module's
   world axis is rotated by the camera before painting, elevation stays
   screen-vertical, and only camera-facing planes receive face detail. A
   camera turn to East, North or West therefore keeps every socket, gate jamb
   and stair landing seam-coincident instead of billboarding modules apart.
3. **Masonry:** English walls use warm grey-buff limestone laid as coursed
   squared rubble with thin lime joints — tone varies, hue does not. Ottoman
   walls use warmer sandy ashlar. Dressed stone appears only at corners, gate
   surrounds, exposed ends and the coping. Weathering (damp bases, thin water
   stains, dusty lichen) stays restrained; no confetti noise, no neon moss.
4. **Assembly:** the modular kit in `js/wall-kit.js` / `docs/MODULAR_WALL_KIT.md`
   guarantees zero-seam sockets. Joined sections overlap beneath their finish,
   suppress internal end caps, share world-space UVs and retain exposed dressed
   caps only at true run ends. Free-angle sections are cached in 64 visual bins
   to bound GPU memory. Provide 4 m (`wall`) and 2 m (`wall_short`) straights.
5. **Staircase:** the broad stone flight includes individual worn treads, cheek
   walls, coping, a flush landing and a construction scaffold. Soldiers climb
   it over time; they never teleport from the ground to the firing walk.
6. **Gatehouse:** two masonry towers, an arched passage and a raised central
   mass make the gate larger than a wall section. Heavy timber double leaves are
   a separate animatable layer (iron strap hinges, bolts, studs) and swing with
   gate progress; the portcullis travels vertically and becomes passable only
   after clearing troop height.
7. **Grounding:** battered plinths, continuous contact shade, a fitted service
   lane, sparse foot moss and local rubble join the wall to the terrain.
8. **States:** surveyed trench, rising masonry, scaffolding, incomplete crown,
   cracked/sooted damage and fallen rubble must be visually distinct.
9. **Faction identity:** structure geometry and gameplay statistics remain
   shared; stone source, surface value and weathering distinguish nations.
10. **Visual QA:** `?debug=fortification-gallery` displays both factions with a
    straight wall, free-angle bend, staircase with climbing troops, open/closed
    gate and critical-damage wall in the actual game renderer.
11. **Performance:** completed pieces bake to one runtime blit. Cache keys
    include nation, type, damage, join mask, inside face, gate frame and the
    quantised VIEW orientation (world angle plus camera turn), so each of the
    four camera directions bakes its own stamp exactly once.
12. **Release:** syntax checks, deterministic fortification/save tests, fresh
    and resumed browser playtests, and production deployment verification are
    required before the feature is considered delivered.
