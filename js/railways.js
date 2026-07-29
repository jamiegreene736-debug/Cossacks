import { BUILDING_TYPES, WORLD } from './config.js';

export const STATION_CONSTRUCTOR_TYPE = 'hogwarts_station_constructor';
export const STATION_TYPE = 'hogwarts_station';
export const TRACK_TYPE = 'hogwarts_track';

export const TRACK_LENGTH = 96;
export const TRACK_SNAP_DISTANCE = 34;
export const TRAIN_SPEED = 46;

const STATION_TRACK_OFFSETS = Object.freeze([
  Object.freeze({ x: -120, y: 44 }),
  Object.freeze({ x: -24, y: 44 }),
  Object.freeze({ x: 72, y: 44 }),
  Object.freeze({ x: 168, y: 44 }),
]);

const TRAIN_CARRIAGES = Object.freeze([
  Object.freeze({ role: 'locomotive', offset: -82 }),
  Object.freeze({ role: 'tender', offset: -34 }),
  Object.freeze({ role: 'coach', offset: 24 }),
  Object.freeze({ role: 'coach', offset: 86 }),
]);

function normAngle(angle = 0) {
  if (!Number.isFinite(angle)) return 0;
  const turn = Math.PI * 2;
  const wrapped = angle % turn;
  return wrapped < 0 ? wrapped + turn : wrapped;
}

function angleDelta(a, b) {
  let delta = normAngle(a) - normAngle(b);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
}

export function trackEndpoints(track) {
  const rotation = normAngle(track?.rotation);
  const half = TRACK_LENGTH * 0.5;
  const dx = Math.cos(rotation) * half;
  const dy = Math.sin(rotation) * half;
  return [
    { x: track.x - dx, y: track.y - dy },
    { x: track.x + dx, y: track.y + dy },
  ];
}

export function isRailBuilding(building) {
  return building?.alive && building.complete
    && building.type === TRACK_TYPE;
}

export function railEndpoints(world, side = null) {
  const points = [];
  for (const building of world?.buildings || []) {
    if (!isRailBuilding(building)) continue;
    if (side !== null && building.side !== side) continue;
    for (const endpoint of trackEndpoints(building)) points.push({ ...endpoint, building });
  }
  return points;
}

function nearestRailEndpoint(world, side, x, y) {
  let best = null;
  for (const endpoint of railEndpoints(world, side)) {
    const distance = Math.hypot(endpoint.x - x, endpoint.y - y);
    if (distance > TRACK_SNAP_DISTANCE) continue;
    if (!best || distance < best.distance) best = { ...endpoint, distance };
  }
  return best;
}

export function snapTrackPlacement(world, side, x, y, rotation = 0) {
  const requested = normAngle(rotation);
  const probe = { x, y, rotation: requested };
  const probeEndpoints = trackEndpoints(probe);
  let nearest = null;
  for (const probeEndpoint of probeEndpoints) {
    const candidate = nearestRailEndpoint(world, side, probeEndpoint.x, probeEndpoint.y);
    if (candidate && (!nearest || candidate.distance < nearest.distance)) {
      nearest = { ...candidate, probeEndpoint };
    }
  }
  nearest ||= nearestRailEndpoint(world, side, x, y);
  if (!nearest) {
    return {
      ok: false,
      x,
      y,
      rotation: requested,
      message: 'Start track from the Hogwarts station rails or an existing rail endpoint.',
    };
  }
  const baseAngles = [requested, requested + Math.PI];
  const aligned = baseAngles.sort((a, b) => angleDelta(a, nearest.building.rotation) - angleDelta(b, nearest.building.rotation))[0];
  const cx = nearest.x + Math.cos(aligned) * TRACK_LENGTH * 0.5;
  const cy = nearest.y + Math.sin(aligned) * TRACK_LENGTH * 0.5;
  return { ok: true, x: cx, y: cy, rotation: normAngle(aligned), snappedToId: nearest.building.id };
}

function buildingFootprintClear(world, side, candidate) {
  const def = BUILDING_TYPES[candidate.type];
  for (const building of world.buildings || []) {
    if (!building.alive) continue;
    if (building.side === side && building.type === STATION_TYPE) continue;
    if (building.side === side && isRailBuilding(building)) {
      const shared = trackEndpoints(candidate).some(a => (
        trackEndpoints(building).some(b => Math.hypot(a.x - b.x, a.y - b.y) <= 3.5)
      ));
      if (shared) continue;
    }
    const combined = (def.radius || 0) + (building.radius || 0);
    if (Math.hypot(candidate.x - building.x, candidate.y - building.y) < combined * 0.54) return false;
  }
  return true;
}

export function validateTrackPlacement(world, side, x, y, options = {}) {
  const snapped = snapTrackPlacement(world, side, x, y, options.rotation);
  if (!snapped.ok) return snapped;
  const candidate = { type: TRACK_TYPE, x: snapped.x, y: snapped.y, rotation: snapped.rotation };
  const outside = trackEndpoints(candidate)
    .some(point => point.x < 20 || point.y < 20 || point.x > WORLD.w - 20 || point.y > WORLD.h - 20);
  if (outside) return { ...snapped, ok: false, message: 'Keep rail segments inside the map boundary.' };
  if (!buildingFootprintClear(world, side, candidate)) {
    return { ...snapped, ok: false, message: 'The rail bed needs a clear connected path.' };
  }
  return { ...snapped, ok: true, message: '' };
}

function findTrackAt(world, x, y, side) {
  let best = null;
  let bestDistance = Infinity;
  for (const building of world.buildings || []) {
    if (!isRailBuilding(building) || building.side !== side) continue;
    const [a, b] = trackEndpoints(building);
    const distance = pointSegmentDistance(x, y, a.x, a.y, b.x, b.y);
    if (distance < bestDistance && distance <= 24) {
      best = building;
      bestDistance = distance;
    }
  }
  return best;
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function connectedTracks(world, track) {
  if (!track) return [];
  const ends = trackEndpoints(track);
  const connected = [];
  for (const candidate of world.buildings || []) {
    if (candidate === track || !isRailBuilding(candidate) || candidate.side !== track.side) continue;
    const otherEnds = trackEndpoints(candidate);
    const touches = ends.some(a => otherEnds.some(b => Math.hypot(a.x - b.x, a.y - b.y) <= 7));
    if (touches) connected.push(candidate);
  }
  return connected;
}

export function normalizeRailwayState(world) {
  world.trains ||= [];
  for (const train of world.trains) {
    train.entityKind = 'train';
    train.side = Number.isInteger(train.side) ? train.side : 0;
    train.speed = Number.isFinite(train.speed) ? train.speed : TRAIN_SPEED;
    train.carriages = Array.isArray(train.carriages) && train.carriages.length
      ? train.carriages : TRAIN_CARRIAGES.map(carriage => ({ ...carriage }));
    const track = world.buildings?.find(building => building.id === train.trackId && isRailBuilding(building));
    if (track) {
      train.x = Number.isFinite(train.x) ? train.x : track.x;
      train.y = Number.isFinite(train.y) ? train.y : track.y;
      train.rotation = Number.isFinite(train.rotation) ? train.rotation : track.rotation;
    }
    train.progress = Math.max(0, Math.min(1, Number(train.progress) || 0.5));
  }
}

export function generateHogwartsStation(world, constructor) {
  if (!world || !constructor?.alive || constructor.stationGenerated) return null;
  const { createBuilding } = constructor.buildingFactory || {};
  if (typeof createBuilding !== 'function') return null;
  const side = constructor.side;
  const team = world.sides[side]?.team;
  const nation = world.sides[side]?.nation;
  const rotation = normAngle(constructor.rotation);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const station = createBuilding(side, STATION_TYPE, constructor.x, constructor.y, true, {
    rotation, team, nation,
  });
  station.generatedFromId = constructor.id;
  station.stationReady = true;
  world.buildings.push(station);

  for (const offset of STATION_TRACK_OFFSETS) {
    const track = createBuilding(
      side,
      TRACK_TYPE,
      constructor.x + offset.x * cos - offset.y * sin,
      constructor.y + offset.x * sin + offset.y * cos,
      true,
      { rotation, team, nation },
    );
    track.stationId = station.id;
    track.snappedToId = station.id;
    world.buildings.push(track);
  }
  const starterTrack = world.buildings
    .filter(building => building.type === TRACK_TYPE && building.stationId === station.id)
    .sort((a, b) => a.x - b.x)[1];
  const train = {
    id: nextTrainId(world),
    entityKind: 'train',
    type: 'hogwarts_express',
    side,
    stationId: station.id,
    trackId: starterTrack?.id ?? station.id,
    nextTrackId: null,
    x: starterTrack?.x ?? station.x,
    y: starterTrack?.y ?? station.y + 44,
    rotation,
    progress: 0.5,
    speed: TRAIN_SPEED,
    paused: false,
    carriages: TRAIN_CARRIAGES.map(carriage => ({ ...carriage })),
  };
  world.trains ||= [];
  world.trains.push(train);
  constructor.alive = false;
  constructor.selected = false;
  constructor.stationGenerated = true;
  world.navigationVersion = (world.navigationVersion || 0) + 1;
  world.events.push({
    side,
    tone: 'good',
    text: 'Hogwarts Express Station complete. Lay connected rail to extend the route.',
  });
  return { station, train };
}

function nextTrainId(world) {
  const max = Math.max(900000, ...(world.trains || []).map(train => Number(train.id) || 0));
  return max + 1;
}

function chooseNextTrack(world, train, current) {
  const connected = connectedTracks(world, current);
  if (!connected.length) return null;
  const previousId = train.previousTrackId;
  return connected.find(track => track.id !== previousId) || connected[0];
}

export function stepTrains(world, dt) {
  normalizeRailwayState(world);
  for (const train of world.trains) {
    if (train.paused) continue;
    let track = world.buildings.find(building => building.id === train.trackId && isRailBuilding(building));
    if (!track) {
      track = findTrackAt(world, train.x, train.y, train.side);
      if (!track) continue;
      train.trackId = track.id;
    }
    train.progress += (train.speed || TRAIN_SPEED) * dt / TRACK_LENGTH;
    while (train.progress > 1) {
      const next = chooseNextTrack(world, train, track);
      if (!next) {
        train.progress = 1;
        train.paused = true;
        break;
      }
      train.previousTrackId = track.id;
      train.trackId = next.id;
      track = next;
      train.progress -= 1;
    }
    const [a, b] = trackEndpoints(track);
    train.x = a.x + (b.x - a.x) * train.progress;
    train.y = a.y + (b.y - a.y) * train.progress;
    train.rotation = track.rotation;
  }
}

export function completeGeneratedStations(world, createBuilding) {
  for (const building of [...world.buildings]) {
    if (building.alive && building.complete && building.type === STATION_CONSTRUCTOR_TYPE
      && !building.stationGenerated) {
      building.buildingFactory = { createBuilding };
      generateHogwartsStation(world, building);
      delete building.buildingFactory;
    }
  }
}
