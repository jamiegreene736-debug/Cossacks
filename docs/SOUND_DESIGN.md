# Soundscape Plan

## Direction

The score and effects are original procedural audio, not copies of another
game's recordings or compositions. The design borrows two structural ideas from
classic Cossacks presentation:

- The official *Cossacks 3* soundtrack is a 21-piece score with named nation
  cues such as “England” and “Turkey” plus a separate “Battle” cue. This game
  follows that broad structure with English, Ottoman, neutral-campaign, and
  battle pieces, then shuffles the peaceful set without immediately repeating a
  track. Source: [GSC Game World, Cossacks 3 OST on Steam](https://store.steampowered.com/app/650360/Deluxe_Content__Cossacks_3_OST/).
- Web Audio provides gain, tonal filters, convolution reverb, and compression.
  The implementation uses separate effects, ambience, and music buses feeding a
  compressor, with reverb sends for distance and space. Sources:
  [MDN Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API),
  [MDN DynamicsCompressorNode](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode).

## Event coverage

| Game activity | Sound treatment |
| --- | --- |
| Wood, stone, and gold gathering | Distinct axe thunk, pick/rock strike, and brighter ore ring |
| Farms and food | Layered crop rustle and sickle-like swish |
| Building work | Hammer impact pooled across active builders |
| Placement and completion | Foundation drop, then restrained two-note completion signal |
| Damaged buildings | Severity-driven fire crackle and low structural groan below 55% health |
| Destroyed buildings | Low collapse body, debris cloud, and staggered timber/stone breaks |
| Muskets and towers | Aggregated transient crack, powder body, and distant reverberant tail |
| Cannon | Separate muzzle blast and ground/debris impact rather than one reused sound |
| Melee and casualties | Varied metal impact plus quiet body/gear fall, throttled in mass combat |
| Infantry, cavalry, and cannon movement | Pooled grass steps, paired hoofbeats, and wheel/axle rumble |
| Commands and production | Short tonal acknowledgements for select, move, gather, build, rally, attack, queue, and ready |
| Field bed | Low moving wind and sparse birds that recede once combat becomes active |

## Music and pause behavior

The score contains four generated cues: *Greenwich at First Light*, *Watch over
the Bosphorus*, *Lanterns in the Campaign Camp*, and the higher-tempo *Powder
and Banners*. The player's faction cue leads a new skirmish; subsequent peaceful
cues are shuffled, and sustained combat promotes the battle cue at the next
transition. All cues share a restrained period palette built from string,
plucked-lute, reed, bass, and frame-drum synthesis.

The pause council exposes independent master, effects, and music levels. “Music
while paused” can either lower the music to 16% of its chosen level or mute the
music bus. Gain changes ramp smoothly to avoid clicks, and the selected behavior
persists in local storage.

## Acceptance checks

- Every current labor, construction, combat, destruction, production, and order
  event maps to a distinct or deliberately pooled cue.
- A large musket volley and mass melee remain compressed and throttled rather
  than clipping or creating a node for every soldier.
- Starting as England or the Ottoman Empire leads with the matching score and
  does not immediately repeat tracks.
- Pausing lowers or mutes only the music as selected; effects and master levels
  remain independently adjustable.
- Existing saved audio settings migrate through defaults for the new fields.
