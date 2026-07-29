import {
  BUILDING_TYPES, WORLD, canNationBuildBuilding,
} from './config.js';
import {
  assignBuilders, assignGatherers, assignRepairers, findNearestResource, getTownCenter,
  hasResources, placeBuilding, validatePlacement,
} from './economy.js';
import {
  STATION_CONSTRUCTOR_TYPE, STATION_TYPE, TRACK_LENGTH, TRACK_TYPE,
  isRailBuilding, trackEndpoints,
} from './railways.js';
import { sideFrontDirection } from './teams.js';

export const RAILWAY_AI_STATES = Object.freeze({
  CRAFT_STATION_CONSTRUCTOR: 'craft_station_constructor',
  PLACE_STATION: 'place_station',
  INSPECT_STATION: 'inspect_station_train',
  GATHER_TRACK_MATERIALS: 'gather_track_materials',
  BUILD_EXTEND_TRACK: 'build_extend_track',
  MAINTAIN_REPAIR_TRACK: 'maintain_repair_track',
  INTERACT_WITH_TRAIN: 'interact_with_train',
  NORMAL_ROUTINE: 'normal_routine',
});

export const RAILWAY_AI_CONFIG = Object.freeze({
  stationMinVillagers: 1,
  stationCrew: 3,
  trackCrew: 2,
  maxTracks: 14,
  minTracksBeforeTrainInteraction: 8,
  planningCooldown: 1.5,
  trackBuildCooldown: 8,
  trainInteractionCooldown: 42,
  inspectDuration: 4.5,
  trainInteractionDuration: 5.5,
  trackClearance: 14,
});

function normalizeState(state = {}) {
  return {
    state: state.state || RAILWAY_AI_STATES.NORMAL_ROUTINE,
    nextPlanAt: Number.isFinite(state.nextPlanAt) ? state.nextPlanAt : 0,
    nextTrackAt: Number.isFinite(state.nextTrackAt) ? state.nextTrackAt : 0,
    nextTrainInteractionAt: Number.isFinite(state.nextTrainInteractionAt)
      ? state.nextTrainInteractionAt : 0,
    stationConstructorReady: Boolean(state.stationConstructorReady),
    inspectedStationIds: Array.isArray(state.inspectedStationIds) ? state.inspectedStationIds : [],
    failedPlacements: Number.isFinite(state.failedPlacements) ? state.failedPlacements : 0,
    lastActionAt: Number.isFinite(state.lastActionAt) ? state.lastActionAt : 0,
  };
}

export function normalizeRailwayAiState(state = {}) {
  return normalizeState(state);
}

function setState(commander, nextState) {
  commander.railway.state = nextState;
  commander.railway.lastActionAt = commander.world.time;
}

function availableVillagers(villagers) {
  return villagers.filter(worker => worker.alive && worker.type === 'villager'
    && !worker.orderTarget && !worker.deferredAttack);
}

function pickCrew(villagers, count) {
  const available = availableVillagers(villagers);
  const idle = available.filter(worker => !worker.job);
  const pool = idle.length ? idle : available.filter(worker => worker.job?.kind === 'gather');
  return pool.slice(0, count);
}

function sideBuildings(world, side, type = null) {
  return world.buildings.filter(building => building.alive && building.side === side
    && (!type || building.type === type));
}

function completedStation(world, side) {
  return sideBuildings(world, side, STATION_TYPE).find(building => building.complete) || null;
}

function pendingStationConstructor(world, side) {
  return sideBuildings(world, side, STATION_CONSTRUCTOR_TYPE).find(building => !building.complete) || null;
}

function railwayTracks(world, side, completedOnly = true) {
  return sideBuildings(world, side, TRACK_TYPE)
    .filter(track => !completedOnly || track.complete);
}

function missingResourceType(side, cost) {
  for (const [resourceType, amount] of Object.entries(cost || {})) {
    if ((side.resources?.[resourceType] || 0) + 1e-6 < amount) return resourceType;
  }
  return null;
}

function gatherMissingMaterial(world, sideIndex, villagers, cost) {
  const side = world.sides[sideIndex];
  const resourceType = missingResourceType(side, cost);
  if (!resourceType) return false;
  const worker = pickCrew(villagers, 1)[0];
  if (!worker) return false;
  const resource = findNearestResource(world, worker.x, worker.y, resourceType, sideIndex);
  if (!resource) return false;
  assignGatherers(world, [worker], resource);
  worker.railwayAiState = RAILWAY_AI_STATES.GATHER_TRACK_MATERIALS;
  return true;
}

function stationPlacementCandidates(world, sideIndex) {
  const tc = getTownCenter(world, sideIndex);
  if (!tc) return [];
  const dir = sideFrontDirection(world, sideIndex);
  const rotation = dir >= 0 ? 0 : Math.PI;
  return [
    [430, 0], [500, -180], [500, 180], [610, -310], [610, 310],
    [720, 0], [760, -230], [760, 230],
  ].map(([front, side]) => ({
    x: Math.max(180, Math.min(WORLD.w - 180, tc.x + dir * front)),
    y: Math.max(180, Math.min(WORLD.h - 180, tc.y + side)),
    rotation,
  }));
}

function placeStationConstructor(commander, villagers) {
  const { world, side: sideIndex } = commander;
  const crew = pickCrew(villagers, RAILWAY_AI_CONFIG.stationCrew);
  if (!crew.length) return false;
  for (const site of stationPlacementCandidates(world, sideIndex)) {
    const result = placeBuilding(
      world,
      sideIndex,
      STATION_CONSTRUCTOR_TYPE,
      site.x,
      site.y,
      crew,
      { ai: true, rotation: site.rotation },
    );
    if (result.ok) {
      commander.railway.stationConstructorReady = false;
      result.building.railwayAiGoal = RAILWAY_AI_STATES.PLACE_STATION;
      for (const worker of crew) worker.railwayAiState = RAILWAY_AI_STATES.PLACE_STATION;
      setState(commander, RAILWAY_AI_STATES.PLACE_STATION);
      return true;
    }
    if (result.message?.startsWith('Need ')) return false;
  }
  commander.railway.failedPlacements += 1;
  commander.railway.nextPlanAt = world.time + RAILWAY_AI_CONFIG.planningCooldown
    * Math.min(6, commander.railway.failedPlacements + 1);
  return false;
}

function assignStationInspection(commander, station, villagers) {
  const worker = pickCrew(villagers, 1)[0];
  if (!worker) return false;
  const sideDir = sideFrontDirection(commander.world, commander.side);
  const train = (commander.world.trains || []).find(candidate => (
    candidate.side === commander.side && candidate.stationId === station.id
  ));
  worker.job = {
    kind: 'railway_inspect',
    targetId: station.id,
    x: station.x - sideDir * 78,
    y: station.y + 70,
    faceX: train?.x ?? station.x,
    faceY: train?.y ?? station.y + 44,
    duration: RAILWAY_AI_CONFIG.inspectDuration,
  };
  worker.railwayAiState = RAILWAY_AI_STATES.INSPECT_STATION;
  worker.orderTarget = null;
  worker.target = null;
  commander.railway.inspectedStationIds.push(station.id);
  setState(commander, RAILWAY_AI_STATES.INSPECT_STATION);
  return true;
}

function endpointConnections(world, side, endpoint, owner) {
  let count = 0;
  for (const track of railwayTracks(world, side, true)) {
    if (track.id === owner.id) continue;
    for (const other of trackEndpoints(track)) {
      if (Math.hypot(endpoint.x - other.x, endpoint.y - other.y) <= 7) count += 1;
    }
  }
  return count;
}

function railDeadEnds(world, side) {
  const dir = sideFrontDirection(world, side);
  const endpoints = [];
  for (const track of railwayTracks(world, side, true)) {
    if (!isRailBuilding(track)) continue;
    const [a, b] = trackEndpoints(track);
    const pairs = [
      { endpoint: a, angle: track.rotation + Math.PI },
      { endpoint: b, angle: track.rotation },
    ];
    for (const pair of pairs) {
      const connections = endpointConnections(world, side, pair.endpoint, track);
      endpoints.push({
        ...pair,
        track,
        connections,
        forwardScore: Math.cos(pair.angle) * dir,
      });
    }
  }
  return endpoints
    .filter(item => item.connections === 0)
    .sort((a, b) => b.forwardScore - a.forwardScore || b.track.id - a.track.id);
}

function trackCandidatesFromEndpoint(world, side, deadEnd) {
  const turns = [0, Math.PI / 18, -Math.PI / 18, Math.PI / 12, -Math.PI / 12];
  return turns.map(turn => {
    const rotation = deadEnd.angle + turn;
    const x = deadEnd.endpoint.x + Math.cos(rotation) * TRACK_LENGTH * 0.5;
    const y = deadEnd.endpoint.y + Math.sin(rotation) * TRACK_LENGTH * 0.5;
    const farEnd = {
      x: deadEnd.endpoint.x + Math.cos(rotation) * TRACK_LENGTH,
      y: deadEnd.endpoint.y + Math.sin(rotation) * TRACK_LENGTH,
    };
    const placement = validatePlacement(world, side, TRACK_TYPE, x, y, { rotation });
    return { ...placement, requestedRotation: rotation, farEnd };
  });
}

function placeNextTrack(commander, villagers) {
  const { world, side: sideIndex } = commander;
  if (world.time < commander.railway.nextTrackAt) return false;
  const tracks = railwayTracks(world, sideIndex, true);
  if (tracks.length >= RAILWAY_AI_CONFIG.maxTracks) return false;
  const crew = pickCrew(villagers, RAILWAY_AI_CONFIG.trackCrew);
  if (!crew.length) return false;
  for (const deadEnd of railDeadEnds(world, sideIndex)) {
    for (const candidate of trackCandidatesFromEndpoint(world, sideIndex, deadEnd)) {
      if (!candidate.ok) continue;
      const result = placeBuilding(world, sideIndex, TRACK_TYPE, candidate.x, candidate.y, crew, {
        ai: true,
        rotation: candidate.rotation,
      });
      if (!result.ok) continue;
      result.building.railwayAiGoal = RAILWAY_AI_STATES.BUILD_EXTEND_TRACK;
      result.building.extendsTrackId = deadEnd.track.id;
      for (const worker of crew) worker.railwayAiState = RAILWAY_AI_STATES.BUILD_EXTEND_TRACK;
      commander.railway.nextTrackAt = world.time + RAILWAY_AI_CONFIG.trackBuildCooldown;
      commander.railway.failedPlacements = 0;
      setState(commander, RAILWAY_AI_STATES.BUILD_EXTEND_TRACK);
      return true;
    }
  }
  commander.railway.failedPlacements += 1;
  commander.railway.nextTrackAt = world.time + RAILWAY_AI_CONFIG.trackBuildCooldown
    * Math.min(4, commander.railway.failedPlacements);
  return false;
}

function assignTrainInteraction(commander, station, villagers) {
  const { world, side } = commander;
  if (world.time < commander.railway.nextTrainInteractionAt) return false;
  const tracks = railwayTracks(world, side, true);
  if (tracks.length < RAILWAY_AI_CONFIG.minTracksBeforeTrainInteraction) return false;
  const train = (world.trains || []).find(candidate => candidate.side === side
    && candidate.stationId === station.id);
  if (!train) return false;
  const worker = pickCrew(villagers, 1)[0];
  if (!worker) return false;
  worker.job = {
    kind: 'railway_interact',
    targetId: station.id,
    x: station.x - sideFrontDirection(world, side) * 96,
    y: station.y + 74,
    faceX: train.x,
    faceY: train.y,
    duration: RAILWAY_AI_CONFIG.trainInteractionDuration,
  };
  worker.railwayAiState = RAILWAY_AI_STATES.INTERACT_WITH_TRAIN;
  worker.orderTarget = null;
  worker.target = null;
  if (train.paused) train.paused = false;
  commander.railway.nextTrainInteractionAt = world.time + RAILWAY_AI_CONFIG.trainInteractionCooldown;
  setState(commander, RAILWAY_AI_STATES.INTERACT_WITH_TRAIN);
  return true;
}

function repairDamagedTrack(commander, villagers) {
  const damaged = railwayTracks(commander.world, commander.side, true)
    .find(track => track.hp < track.maxHp - 0.01);
  if (!damaged) return false;
  const crew = pickCrew(villagers, RAILWAY_AI_CONFIG.trackCrew);
  if (!crew.length) return false;
  assignRepairers(commander.world, crew, damaged);
  for (const worker of crew) worker.railwayAiState = RAILWAY_AI_STATES.MAINTAIN_REPAIR_TRACK;
  setState(commander, RAILWAY_AI_STATES.MAINTAIN_REPAIR_TRACK);
  return true;
}

export function manageRailwayVillagers(commander, villagers) {
  if (!commander?.world || !Array.isArray(villagers) || villagers.length === 0) return false;
  commander.railway = normalizeState(commander.railway);
  const { world, side: sideIndex } = commander;
  const side = world.sides[sideIndex];
  if (!side || !canNationBuildBuilding(side.nation, STATION_CONSTRUCTOR_TYPE)) return false;
  if (world.time < commander.railway.nextPlanAt) return false;

  const constructor = pendingStationConstructor(world, sideIndex);
  if (constructor) {
    assignBuilders(world, pickCrew(villagers, RAILWAY_AI_CONFIG.stationCrew), constructor);
    setState(commander, RAILWAY_AI_STATES.PLACE_STATION);
    return true;
  }

  const station = completedStation(world, sideIndex);
  if (!station) {
    if (sideBuildings(world, sideIndex, STATION_CONSTRUCTOR_TYPE).length) return false;
    const cost = BUILDING_TYPES[STATION_CONSTRUCTOR_TYPE].cost;
    if (!hasResources(side, cost)) {
      if (gatherMissingMaterial(world, sideIndex, villagers, cost)) {
        setState(commander, RAILWAY_AI_STATES.GATHER_TRACK_MATERIALS);
        return true;
      }
      return false;
    }
    if (!commander.railway.stationConstructorReady) {
      commander.railway.stationConstructorReady = true;
      setState(commander, RAILWAY_AI_STATES.CRAFT_STATION_CONSTRUCTOR);
      return true;
    }
    setState(commander, RAILWAY_AI_STATES.PLACE_STATION);
    return placeStationConstructor(commander, villagers);
  }

  if (!commander.railway.inspectedStationIds.includes(station.id)) {
    return assignStationInspection(commander, station, villagers);
  }
  if (repairDamagedTrack(commander, villagers)) return true;

  const trackCost = BUILDING_TYPES[TRACK_TYPE].cost;
  if (!hasResources(side, trackCost)) {
    if (gatherMissingMaterial(world, sideIndex, villagers, trackCost)) {
      setState(commander, RAILWAY_AI_STATES.GATHER_TRACK_MATERIALS);
      return true;
    }
    return false;
  }
  if (placeNextTrack(commander, villagers)) return true;
  if (assignTrainInteraction(commander, station, villagers)) return true;

  setState(commander, RAILWAY_AI_STATES.NORMAL_ROUTINE);
  commander.railway.nextPlanAt = world.time + RAILWAY_AI_CONFIG.planningCooldown;
  return false;
}
