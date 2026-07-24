// Modular 18th-century stone fortification kit for Empires: 1700.
//
// This is the production mapping of a true modular wall set onto the game's
// connected Canvas fortification model. Edge sockets, module lengths and
// topology classification guarantee zero-seam joins when pieces snap together.
// Gameplay collision continues to use fortificationFrame() footprints; the kit
// owns visual continuity, piece roles and extension guidance.

import { BUILDING_TYPES } from './config.js';
import {
  fortificationAxis, fortificationEndpoints, fortificationFrame,
  isFortificationType, isWallSegmentType,
} from './fortifications.js';

export { isWallSegmentType };

/** World units per nominal metre for fortification authoring. */
export const WALL_KIT_UNITS_PER_METRE = 22;

/** Straight run lengths. The long section is the drag-placement default. */
export const WALL_MODULE_LENGTH_2M = WALL_KIT_UNITS_PER_METRE * 2; // 44
export const WALL_MODULE_LENGTH_4M = WALL_KIT_UNITS_PER_METRE * 4; // 88

/**
 * Walkable thickness of the terreplein body (about 2.0 m). Matches BUILDING
 * footprint height so pathing, wall-walk slots and art stay in agreement.
 */
export const WALL_KIT_THICKNESS = WALL_KIT_UNITS_PER_METRE * 1.0; // 22

/** Shared edge inset used when neighbouring modules overlap to hide the joint. */
export const WALL_KIT_SEAM_OVERLAP = 7;

/** Endpoint snap tolerance that keeps sockets coincident. */
export const WALL_KIT_SOCKET_TOLERANCE = 3.5;

/**
 * Canonical kit pieces. Geometry values are world units; art consumes the same
 * numbers so a snapped corner never introduces a light leak or grass wedge.
 */
export const WALL_KIT_PIECES = Object.freeze({
  straight_4m: Object.freeze({
    id: 'straight_4m',
    label: 'Straight Wall 4 m',
    buildingType: 'wall',
    length: WALL_MODULE_LENGTH_4M,
    thickness: WALL_KIT_THICKNESS,
    sockets: Object.freeze(['neg', 'pos']),
    dressed: Object.freeze(['crown']),
    rubbleFace: true,
    walkable: true,
    description: 'Primary curtain section with irregular rubble face and terreplein walk.',
  }),
  straight_2m: Object.freeze({
    id: 'straight_2m',
    label: 'Straight Wall 2 m',
    buildingType: 'wall_short',
    length: WALL_MODULE_LENGTH_2M,
    thickness: WALL_KIT_THICKNESS,
    sockets: Object.freeze(['neg', 'pos']),
    dressed: Object.freeze(['crown']),
    rubbleFace: true,
    walkable: true,
    description: 'Half-module filler for gates, corners and uneven runs.',
  }),
  outer_corner: Object.freeze({
    id: 'outer_corner',
    label: '90° Outer Corner',
    buildingType: 'wall',
    length: WALL_MODULE_LENGTH_4M,
    thickness: WALL_KIT_THICKNESS,
    sockets: Object.freeze(['neg', 'pos']),
    dressed: Object.freeze(['crown', 'outer_quoin']),
    rubbleFace: true,
    walkable: true,
    topological: true,
    description: 'Topology role when two sections meet with an exterior obtuse bend.',
  }),
  inner_corner: Object.freeze({
    id: 'inner_corner',
    label: '90° Inner Corner',
    buildingType: 'wall',
    length: WALL_MODULE_LENGTH_4M,
    thickness: WALL_KIT_THICKNESS,
    sockets: Object.freeze(['neg', 'pos']),
    dressed: Object.freeze(['crown', 'inner_quoin']),
    rubbleFace: true,
    walkable: true,
    topological: true,
    description: 'Topology role when two sections meet with an interior reflex bend.',
  }),
  t_junction: Object.freeze({
    id: 't_junction',
    label: 'T-Junction',
    buildingType: 'wall',
    length: WALL_MODULE_LENGTH_4M,
    thickness: WALL_KIT_THICKNESS,
    sockets: Object.freeze(['neg', 'pos', 'spur']),
    dressed: Object.freeze(['crown', 'spur_quoin']),
    rubbleFace: true,
    walkable: true,
    topological: true,
    description: 'Topology role when three wall ends meet at one socket.',
  }),
  end: Object.freeze({
    id: 'end',
    label: 'Terminal / End Cap',
    buildingType: 'wall',
    length: WALL_MODULE_LENGTH_4M,
    thickness: WALL_KIT_THICKNESS,
    sockets: Object.freeze(['neg', 'pos']),
    dressed: Object.freeze(['crown', 'exposed_end']),
    rubbleFace: true,
    walkable: true,
    topological: true,
    description: 'Any free end receives dressed quoin stones and a finished return.',
  }),
  gate: Object.freeze({
    id: 'gate',
    label: 'Gatehouse',
    buildingType: 'gate',
    length: BUILDING_TYPES.gate.w,
    thickness: BUILDING_TYPES.gate.h,
    sockets: Object.freeze(['neg', 'pos']),
    dressed: Object.freeze(['crown', 'arch', 'pillars', 'plinth']),
    rubbleFace: true,
    walkable: true,
    separateGateLeaves: true,
    description: 'Arched gatehouse with dressed ashlar surrounds and animatable timber leaves.',
  }),
  ramp: Object.freeze({
    id: 'ramp',
    label: 'Wall Stair / Ramp',
    buildingType: 'wall_stairs',
    length: BUILDING_TYPES.wall_stairs.w,
    thickness: BUILDING_TYPES.wall_stairs.h,
    sockets: Object.freeze(['host']),
    dressed: Object.freeze(['treads', 'cheeks', 'landing']),
    rubbleFace: true,
    walkable: true,
    description: 'Settlement-side stair giving access to the wall walk without clipping.',
  }),
});

export function wallKitPieceForBuildingType(type) {
  if (type === 'wall_short') return WALL_KIT_PIECES.straight_2m;
  if (type === 'wall') return WALL_KIT_PIECES.straight_4m;
  if (type === 'gate') return WALL_KIT_PIECES.gate;
  if (type === 'wall_stairs') return WALL_KIT_PIECES.ramp;
  return null;
}

function angleBetweenAxes(a, b) {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
  const cross = a.x * b.y - a.y * b.x;
  return Math.atan2(cross, dot);
}

function endpointNeighbors(building, world, {
  tolerance = WALL_KIT_SOCKET_TOLERANCE,
  includeIncomplete = false,
} = {}) {
  const endpoints = fortificationEndpoints(building);
  if (!world || endpoints.length !== 2) {
    return [[], []];
  }
  return endpoints.map(endpoint => world.buildings.filter(candidate => {
    if (!candidate?.alive || candidate === building || candidate.side !== building.side) {
      return false;
    }
    if (!includeIncomplete && !candidate.complete) return false;
    if (!isFortificationType(candidate.type) || candidate.type === 'wall_stairs') return false;
    return fortificationEndpoints(candidate).some(other => (
      Math.hypot(other.x - endpoint.x, other.y - endpoint.y) <= tolerance
    ));
  }));
}

/**
 * Classify a placed fortification into a kit topology role so the renderer can
 * apply dressed quoins, suppress internal end caps and keep seams invisible.
 */
export function classifyWallKitTopology(building, world, { includeIncomplete = false } = {}) {
  if (!building) return null;
  if (building.type === 'gate') {
    const neighborsByEnd = endpointNeighbors(building, world, { includeIncomplete });
    const neighborCounts = neighborsByEnd.map(list => list.length);
    const joinedEnds = neighborCounts.map(count => count > 0);
    return {
      pieceId: 'gate',
      piece: WALL_KIT_PIECES.gate,
      joinedEnds,
      neighborCounts,
      bendRadians: [0, 0],
      isOuterCorner: false,
      isInnerCorner: false,
      isTJunction: false,
      isTerminal: joinedEnds.some(joined => !joined),
    };
  }
  if (building.type === 'wall_stairs') {
    return {
      pieceId: 'ramp',
      piece: WALL_KIT_PIECES.ramp,
      joinedEnds: [false, false],
      neighborCounts: [0, 0],
      bendRadians: [0, 0],
      isOuterCorner: false,
      isInnerCorner: false,
      isTJunction: false,
      isTerminal: false,
    };
  }
  if (!isWallSegmentType(building.type)) return null;

  const neighborsByEnd = endpointNeighbors(building, world, { includeIncomplete });
  const neighborCounts = neighborsByEnd.map(list => list.length);
  const joinedEnds = neighborCounts.map(count => count > 0);
  const selfAxis = fortificationAxis(building.orientation);
  const bendRadians = neighborsByEnd.map((list, endIndex) => {
    if (!list.length) return 0;
    // Use the strongest angular departure among neighbours at this socket.
    let strongest = 0;
    for (const neighbor of list) {
      const angle = angleBetweenAxes(selfAxis, fortificationAxis(neighbor.orientation));
      if (Math.abs(angle) > Math.abs(strongest)) strongest = angle;
    }
    // Flip sign by end so a consistent exterior turn reads positive as outer.
    return endIndex === 0 ? -strongest : strongest;
  });

  const isTJunction = neighborCounts.some(count => count >= 2)
    || (joinedEnds[0] && joinedEnds[1] && neighborCounts[0] + neighborCounts[1] >= 3);
  const cornerThreshold = Math.PI / 6;
  const isOuterCorner = !isTJunction && bendRadians.some(angle => angle > cornerThreshold);
  const isInnerCorner = !isTJunction && bendRadians.some(angle => angle < -cornerThreshold);
  const isTerminal = joinedEnds.some(joined => !joined);

  let pieceId = building.type === 'wall_short' ? 'straight_2m' : 'straight_4m';
  if (isTJunction) pieceId = 't_junction';
  else if (isOuterCorner) pieceId = 'outer_corner';
  else if (isInnerCorner) pieceId = 'inner_corner';
  else if (isTerminal && !(joinedEnds[0] && joinedEnds[1])) pieceId = 'end';

  return {
    pieceId,
    piece: WALL_KIT_PIECES[pieceId],
    joinedEnds,
    neighborCounts,
    bendRadians,
    isOuterCorner,
    isInnerCorner,
    isTJunction,
    isTerminal,
  };
}

/**
 * World-space UV origin along the wall axis. Adjacent modules that share an
 * endpoint receive continuous texture samples, so rubble joints do not repeat
 * or seam at the module boundary.
 */
export function wallKitWorldUvOrigin(building) {
  const axis = fortificationAxis(building.orientation);
  const along = building.x * axis.x + building.y * axis.y;
  const across = building.x * -axis.y + building.y * axis.x;
  return {
    along: along - (BUILDING_TYPES[building.type]?.w || 0) * 0.5,
    across,
    axis,
  };
}

/**
 * Edge socket descriptors used by the snap helper and by art to suppress
 * internal end planes. Coordinates are world-space.
 */
export function wallKitSockets(building) {
  const frame = fortificationFrame(building.type, building.x, building.y, building.orientation);
  if (!frame) return [];
  return [-1, 1].map((sign, index) => ({
    id: sign < 0 ? 'neg' : 'pos',
    index,
    x: frame.x + frame.axis.x * frame.halfLength * sign,
    y: frame.y + frame.axis.y * frame.halfLength * sign,
    outward: {
      x: frame.axis.x * sign,
      y: frame.axis.y * sign,
    },
    normal: { x: frame.normal.x, y: frame.normal.y },
  }));
}

/**
 * Placement helper: returns the centre that seats `type` so its chosen socket
 * lands exactly on `socket` (zero seam).
 */
export function snapWallKitPieceToSocket(type, orientation, socket, socketId = 'neg') {
  const frame = fortificationFrame(type, 0, 0, orientation);
  if (!frame || !socket) {
    return { x: socket?.x || 0, y: socket?.y || 0, orientation };
  }
  const sign = socketId === 'pos' ? 1 : -1;
  return {
    x: socket.x - frame.axis.x * frame.halfLength * sign,
    y: socket.y - frame.axis.y * frame.halfLength * sign,
    orientation,
    snappedSocketId: socketId,
  };
}

/**
 * Collision / walkability notes for LODs and engine export. The live game uses
 * the simplified fortificationFrame box; exporters can read this profile when
 * building a dedicated collision mesh.
 */
export function wallKitCollisionProfile(type = 'wall') {
  const def = BUILDING_TYPES[type];
  const piece = wallKitPieceForBuildingType(type);
  if (!def || !piece) return null;
  return Object.freeze({
    buildingType: type,
    pieceId: piece.id,
    box: Object.freeze({
      length: def.w,
      thickness: def.h,
      height: type === 'gate' ? 57 : 40,
    }),
    walkSurface: Object.freeze({
      // Recessed terreplein between parapets — characters walk the full length.
      halfLength: def.w * 0.5 - 1.5,
      halfThickness: Math.max(2.5, def.h * 0.5 - 3.4),
      elevation: type === 'gate' ? 57 : 40,
    }),
    outerParapet: Object.freeze({
      halfThickness: 2.15,
      height: 10.2,
    }),
    lod: Object.freeze({
      lod0: 'full rubble + relief + patina + textured faces',
      lod1: 'block shell + textured faces, skip micro cracks',
      lod2: 'silhouette blocks only (minimap / distant)',
    }),
  });
}

export function listWallKitPieces() {
  return Object.values(WALL_KIT_PIECES);
}

/**
 * Extension guide consumed by docs and by future kit authors. Keep piece edge
 * vertices on the shared module grid; never invent a unique end profile.
 */
export function wallKitExtensionRules() {
  return Object.freeze({
    grid: Object.freeze({
      lengthStep: WALL_MODULE_LENGTH_2M,
      thickness: WALL_KIT_THICKNESS,
      seamOverlap: WALL_KIT_SEAM_OVERLAP,
      socketTolerance: WALL_KIT_SOCKET_TOLERANCE,
    }),
    edgeContract: Object.freeze([
      'Every straight or corner piece must expose sockets at ±halfLength on the module axis.',
      'Joined ends suppress endPlane geometry and dressed terminal quoins.',
      'World-space UV origins use wallKitWorldUvOrigin so albedo/normal continue across seams.',
      'Only corners, gate surrounds, exposed terminals and the coping course use dressed ashlar.',
      'Face masonry is irregular rubble with thick lime mortar — never uniform brick courses.',
      'Gate timber leaves are a separate paintable/animatable layer from the stone shell.',
      'Collision stays on fortificationFrame; visual relief must not alter the walk footprint.',
    ]),
    howToAddPiece: Object.freeze([
      '1. Add a BUILDING_TYPES entry whose w/h sit on the 2 m grid and set fortification or wallAttachment.',
      '2. Register the piece in WALL_KIT_PIECES with sockets and dressed zones.',
      '3. Teach classifyWallKitTopology / isWallSegmentType about the new type if it is walkable curtain.',
      '4. Extend bdPaintFortification (or a dedicated painter) without changing socket coordinates.',
      '5. Add fortification tests for snap, seam join and walkability.',
    ]),
  });
}
