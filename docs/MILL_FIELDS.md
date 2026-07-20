# Mill and field system

## Research basis

The field loop follows the strongest readable convention from historical RTS
games rather than treating a farm as an isolated building:

- In *Cossacks: European Wars*, constructing a mill creates the agricultural
  centre: grain is planted around it and peasants walk into the crop, harvest,
  then return produce to the central mill. GameSpot's contemporary
  [preview](https://www.gamespot.com/articles/cossacks-european-wars-preview/1100-2669535/)
  and [review](https://www.gamespot.com/reviews/cossacks-european-wars-review/1900-2702187/)
  both describe that loop.
- The [Cossacks 3 mill reference](https://cossacks3.fandom.com/wiki/Mill)
  preserves the mill as the crop-processing and food-upgrade hub.
- *Age of Empires IV* uses the same relationship as a clear spatial rule:
  farms within a mill's influence benefit from it, as summarized by its
  [mill reference](https://ageofempires.fandom.com/wiki/Mill_%28Age_of_Empires_IV%29).

The implementation keeps player-placed fields, but makes them subordinate
parts of a mill complex. This provides the desired control while retaining the
historic RTS silhouette of a mill surrounded by cultivated land.

## Rules

1. A completed Mill is required before Field is enabled.
2. Each Mill owns eight fixed field plots. Pointing beside a mill selects the
   nearest vacant plot and snaps the placement to it.
3. A full Mill requires another Mill before more fields can be placed.
4. Farmers walk to deterministic interior rows and perform the hoe animation
   there. They do not gather from the mill building itself.
5. Destroying a Mill removes its attached fields and releases their workers.
6. Legacy campaign fields are attached to the nearest completed friendly Mill
   when a save is restored.

## Visual direction

Fields are terrain parcels: an irregular turf verge, graded soil, modelled
furrow ridges and troughs, row-aligned crops, wheel ruts, clods, sparse weeds,
and low ownership stakes. A second foreground crop pass is drawn after units,
which hides farmers' lower legs while leaving the torso, arms, and hoe readable.
Subtle ground ruts connect each plot to its mill so the cluster reads as one
working agricultural site.

## Acceptance checks

- Field is disabled before a Mill completes.
- Eight fields fill a Mill; the ninth is refused until another Mill exists.
- Field placement snaps and persists `millId` and `fieldSlot` through save/load.
- A farmer enters the field bounds, switches to `farm`, and keeps a stable row.
- The near crop pass occludes the farmer's boots at mature crop stages.
- AI field construction uses the same mill plots and validation path.
