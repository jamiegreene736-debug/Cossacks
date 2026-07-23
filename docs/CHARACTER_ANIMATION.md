# Character animation plan

The game uses detailed cached sprites, so fluid motion must preserve those assets while making their timing obey physical movement.

## Motion contract

1. Locomotion phase advances from world distance travelled. Animation speed therefore follows foot speed rather than the display refresh rate or a generic timer.
2. A full gait has six presentation beats: contact, down, passing, opposite contact, down, and opposite passing. Existing historical six-pose sheets map directly to these beats. Worker and fantasy sheets reuse authored idle, stride, and recovery poses to complete the same contract.
3. Continuous canvas transforms bridge the discrete poses with weight transfer, vertical lift, torso roll, and head stabilization. Mounted and heavy units use restrained amplitudes.
4. Attacks use a continuous recoil and recovery curve over the simulation's existing `fireT` window. Gameplay damage timing remains unchanged.
5. Formation phase offsets remain deterministic, and `gaitDistance` is part of the normal unit save data so resumed campaigns keep their animation phase.

## Research basis

- Unity's Blend Tree guidance aligns locomotion clips at normalized foot-contact times before blending.
- Godot's AnimatedSprite2D preserves both frame and fractional frame progress when changing animation state.
- The browser render loop continues to use `requestAnimationFrame` timestamps and simulation interpolation; gait progression itself is simulation-distance driven.

## Acceptance checks

- Walking frames stop when the unit stops and cannot advance without ground travel.
- Faster and slower units cover an appropriate stride distance per cycle without foot sliding.
- Every worker, infantry, cavalry, fantasy fighter, and fantasy worker exposes six locomotion beats.
- Head and torso motion counter each other while walking; artillery remains visually stable.
- Attack recoil settles back to the exact idle anchor.
- New game and restored game browser playthroughs have no rendering warnings.
