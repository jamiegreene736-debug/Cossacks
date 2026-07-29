import { BUILDING_TYPES, WORLD } from '../config.js';
import { getBuildingPresentation } from './buildings.js';

const PATHABLE_TYPES = new Set(Object.keys(BUILDING_TYPES).filter(type => (
  type !== 'farm'
  && type !== 'wall'
  && type !== 'gate'
  && type !== 'wall_stairs'
  && !BUILDING_TYPES[type].fortification
  && !BUILDING_TYPES[type].rail
  && !type.startsWith('hogwarts_station')
)));
const MIN_PATH_RADIUS = 42;
const BASE_PATH_WIDTH = 46;
const MAX_LINK_DISTANCE = 760;
const MAX_NEIGHBORS = 3;
const LANTERN_INTERVAL = 178;
const LANTERN_EDGE_OFFSET = 42;

let pathCanvas = null;
let pathCtx = null;
let cachedSignature = '';
let cachedLanterns = [];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded(seed) {
  let value = seed >>> 0;
  return (min = 0, max = 1) => {
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    const t = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    return min + (max - min) * t;
  };
}

function mix(a, b, t) {
  const ax = parseInt(a.slice(1, 3), 16);
  const ay = parseInt(a.slice(3, 5), 16);
  const az = parseInt(a.slice(5, 7), 16);
  const bx = parseInt(b.slice(1, 3), 16);
  const by = parseInt(b.slice(3, 5), 16);
  const bz = parseInt(b.slice(5, 7), 16);
  const hex = n => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return `#${hex(ax + (bx - ax) * t)}${hex(ay + (by - ay) * t)}${hex(az + (bz - az) * t)}`;
}

function rgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getSettlementPathNodes(buildings = []) {
  return buildings
    .filter(building => (
      building?.alive
      && building.complete
      && PATHABLE_TYPES.has(building.type)
      && BUILDING_TYPES[building.type]
    ))
    .map(building => {
      const def = BUILDING_TYPES[building.type];
      const presentation = getBuildingPresentation(building.type, def, building.nation);
      const rx = Math.max(MIN_PATH_RADIUS, presentation.apronRx || def.w * 0.9);
      const ry = Math.max(MIN_PATH_RADIUS * 0.55, presentation.apronRy || def.h * 0.58);
      return {
        id: building.id,
        type: building.type,
        nation: building.nation || '',
        side: building.side,
        x: building.x,
        y: building.y + (presentation.pavingCenterY || def.h * 0.22),
        obstacleX: building.x,
        obstacleY: building.y,
        rx,
        ry,
        obstacleRadius: Math.max(def.w, def.h, rx) * 0.72 + BASE_PATH_WIDTH,
      };
    })
    .sort((a, b) => (a.side - b.side) || (a.id - b.id));
}

function edgeKey(a, b) {
  return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lineDistanceToPoint(ax, ay, bx, by, px, py) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / len2, 0, 1);
  return {
    distance: Math.hypot(px - (ax + vx * t), py - (ay + vy * t)),
    t,
  };
}

function endpointOnPaving(node, toward, overshoot = 8) {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const radius = 1 / Math.sqrt((ux * ux) / (node.rx * node.rx) + (uy * uy) / (node.ry * node.ry));
  return {
    x: node.x + ux * Math.max(10, radius - overshoot),
    y: node.y + uy * Math.max(8, radius - overshoot * 0.55),
  };
}

function routeControlPoints(a, b, nodes) {
  const seed = hashString(`${a.id}:${b.id}:${Math.round(a.x)}:${Math.round(b.y)}`);
  const rnd = seeded(seed);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let organic = (rnd(-0.5, 0.5) || 0.25) * clamp(len * 0.20, 42, 126);
  let strongest = null;
  for (const node of nodes) {
    if (node.id === a.id || node.id === b.id) continue;
    const hit = lineDistanceToPoint(a.x, a.y, b.x, b.y, node.obstacleX, node.obstacleY);
    if (hit.t <= 0.08 || hit.t >= 0.92 || hit.distance > node.obstacleRadius) continue;
    const side = Math.sign((node.obstacleX - a.x) * nx + (node.obstacleY - a.y) * ny) || 1;
    const needed = (node.obstacleRadius - hit.distance) + BASE_PATH_WIDTH * 1.7;
    if (!strongest || needed > strongest.needed) strongest = { side, needed, t: hit.t };
  }
  if (strongest) organic = -strongest.side * clamp(strongest.needed + Math.abs(organic), 92, 210);
  const t1 = strongest ? clamp(strongest.t - 0.18, 0.24, 0.48) : rnd(0.34, 0.45);
  const t2 = strongest ? clamp(strongest.t + 0.18, 0.52, 0.76) : rnd(0.55, 0.66);
  return [
    { x: a.x + dx * t1 + nx * organic, y: a.y + dy * t1 + ny * organic },
    { x: a.x + dx * t2 + nx * organic * rnd(0.72, 1.10), y: a.y + dy * t2 + ny * organic * rnd(0.72, 1.10) },
  ];
}

export function buildSettlementPathNetwork(buildings = []) {
  const nodes = getSettlementPathNodes(buildings);
  if (nodes.length < 2) return { nodes, links: [] };
  const candidates = [];
  for (let left = 0; left < nodes.length; left++) {
    const ranked = [];
    for (let right = 0; right < nodes.length; right++) {
      if (left === right || nodes[left].side !== nodes[right].side) continue;
      const d = distance(nodes[left], nodes[right]);
      if (d <= MAX_LINK_DISTANCE) ranked.push({ node: nodes[right], distance: d });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    for (const entry of ranked.slice(0, MAX_NEIGHBORS)) {
      candidates.push({ a: nodes[left], b: entry.node, distance: entry.distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);

  const parent = new Map(nodes.map(node => [node.id, node.id]));
  const find = id => {
    let root = parent.get(id);
    while (root !== parent.get(root)) root = parent.get(root);
    let cur = id;
    while (cur !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const used = new Set();
  const links = [];
  const addLink = candidate => {
    const key = edgeKey(candidate.a, candidate.b);
    if (used.has(key)) return false;
    const start = endpointOnPaving(candidate.a, candidate.b);
    const end = endpointOnPaving(candidate.b, candidate.a);
    const controls = routeControlPoints(candidate.a, candidate.b, nodes);
    links.push({ key, a: candidate.a.id, b: candidate.b.id, start, end, controls, width: BASE_PATH_WIDTH });
    used.add(key);
    return true;
  };

  for (const candidate of candidates) {
    if (find(candidate.a.id) === find(candidate.b.id)) continue;
    parent.set(find(candidate.a.id), find(candidate.b.id));
    addLink(candidate);
  }
  for (const node of nodes) {
    const current = links.filter(link => link.a === node.id || link.b === node.id).length;
    if (current >= 2) continue;
    const candidate = candidates.find(entry => (
      (entry.a.id === node.id || entry.b.id === node.id) && !used.has(edgeKey(entry.a, entry.b))
    ));
    if (candidate) addLink(candidate);
  }
  return { nodes, links };
}

function networkSignature(world) {
  return getSettlementPathNodes(world?.buildings || []).map(node => (
    `${node.id}:${node.type}:${node.side}:${Math.round(node.x)}:${Math.round(node.y)}:${Math.round(node.rx)}:${Math.round(node.ry)}`
  )).join('|');
}

function ensureCanvas() {
  if (!pathCanvas) {
    pathCanvas = document.createElement('canvas');
    pathCanvas.width = WORLD.w;
    pathCanvas.height = WORLD.h;
    pathCtx = pathCanvas.getContext('2d');
  }
}

function sampleCubic(start, c1, c2, end, t) {
  const u = 1 - t;
  return {
    x: u * u * u * start.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
    y: u * u * u * start.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
  };
}

function cubicTangent(start, c1, c2, end, t) {
  const u = 1 - t;
  const x = 3 * u * u * (c1.x - start.x)
    + 6 * u * t * (c2.x - c1.x)
    + 3 * t * t * (end.x - c2.x);
  const y = 3 * u * u * (c1.y - start.y)
    + 6 * u * t * (c2.y - c1.y)
    + 3 * t * t * (end.y - c2.y);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

function linkPolyline(link, samples = 36) {
  const [c1, c2] = link.controls;
  const points = [];
  let length = 0;
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const point = sampleCubic(link.start, c1, c2, link.end, t);
    if (points.length) {
      const previous = points[points.length - 1];
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    points.push({ ...point, t, length });
  }
  return { points, length };
}

function tAtDistance(polyline, distanceAlong) {
  if (distanceAlong <= 0) return 0;
  for (let index = 1; index < polyline.points.length; index++) {
    const previous = polyline.points[index - 1];
    const current = polyline.points[index];
    if (current.length < distanceAlong) continue;
    const segment = Math.max(1e-6, current.length - previous.length);
    return previous.t + (current.t - previous.t) * clamp((distanceAlong - previous.length) / segment, 0, 1);
  }
  return 1;
}

function isInsideNodeApron(x, y, node, margin = 16) {
  const dx = x - node.x;
  const dy = y - node.y;
  const rx = node.rx + margin;
  const ry = node.ry + margin * 0.58;
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}

function isTooCloseToStructure(x, y, node, margin = 22) {
  const radius = Math.max(node.rx, node.obstacleRadius * 0.62) + margin;
  return Math.hypot(x - node.obstacleX, y - node.obstacleY) <= radius;
}

function lanternCandidate(link, nodes, t, side, index) {
  const [c1, c2] = link.controls;
  const point = sampleCubic(link.start, c1, c2, link.end, t);
  const tangent = cubicTangent(link.start, c1, c2, link.end, t);
  const normal = { x: -tangent.y, y: tangent.x };
  const offset = (link.width * 0.5 + LANTERN_EDGE_OFFSET) * side;
  const x = point.x + normal.x * offset;
  const y = point.y + normal.y * offset;
  const tooClose = nodes.some(node => isInsideNodeApron(x, y, node, 20)
    || isTooCloseToStructure(x, y, node, 8));
  return {
    key: `${link.key}:lantern:${index}`,
    linkKey: link.key,
    x,
    y,
    baseX: point.x,
    baseY: point.y,
    tangent,
    side,
    t,
    tooClose,
  };
}

export function buildSettlementLanterns(network) {
  const nodes = network?.nodes || [];
  const lanterns = [];
  for (const link of network?.links || []) {
    const polyline = linkPolyline(link);
    const count = Math.max(1, Math.floor((polyline.length - 72) / LANTERN_INTERVAL));
    const spacing = polyline.length / (count + 1);
    const startSide = hashString(link.key) % 2 === 0 ? 1 : -1;
    for (let index = 0; index < count; index++) {
      const t = clamp(tAtDistance(polyline, spacing * (index + 1)), 0.14, 0.86);
      const primarySide = startSide * (index % 2 === 0 ? 1 : -1);
      let candidate = lanternCandidate(link, nodes, t, primarySide, index);
      if (candidate.tooClose) {
        const flipped = lanternCandidate(link, nodes, t, -primarySide, index);
        if (!flipped.tooClose) candidate = flipped;
      }
      if (candidate.tooClose) continue;
      lanterns.push({
        ...candidate,
        tooClose: undefined,
        height: 49 + (hashString(`${candidate.key}:height`) % 7),
        glowRadius: 74 + (hashString(`${candidate.key}:glow`) % 19),
      });
    }
  }
  return lanterns;
}

function drawPathStroke(g, link, width) {
  const [c1, c2] = link.controls;
  g.beginPath();
  g.moveTo(link.start.x, link.start.y);
  g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, link.end.x, link.end.y);
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

function drawLanternLightPool(g, lantern) {
  g.save();
  g.globalCompositeOperation = 'screen';
  const glow = g.createRadialGradient(lantern.baseX, lantern.baseY, 1, lantern.baseX, lantern.baseY,
    lantern.glowRadius);
  glow.addColorStop(0, 'rgba(255,204,118,.24)');
  glow.addColorStop(0.34, 'rgba(234,154,63,.15)');
  glow.addColorStop(0.72, 'rgba(171,93,35,.055)');
  glow.addColorStop(1, 'rgba(110,54,18,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.ellipse(lantern.baseX, lantern.baseY, lantern.glowRadius * 1.08, lantern.glowRadius * 0.58,
    Math.atan2(lantern.tangent.y, lantern.tangent.x), 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawCobblestonePath(g, link) {
  const [c1, c2] = link.controls;
  const seed = hashString(link.key);
  const rnd = seeded(seed);
  const width = link.width;
  g.save();
  g.shadowColor = 'rgba(31,23,14,.26)';
  g.shadowBlur = 9;
  g.shadowOffsetY = 5;
  g.strokeStyle = 'rgba(45,35,24,.30)';
  drawPathStroke(g, link, width + 13);
  g.shadowColor = 'transparent';
  g.strokeStyle = 'rgba(83,72,58,.76)';
  drawPathStroke(g, link, width + 5);
  g.strokeStyle = 'rgba(121,111,92,.62)';
  drawPathStroke(g, link, width - 1);

  g.save();
  drawPathStroke(g, link, width);
  g.clip();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(41,35,27,.56)';
  g.lineWidth = 1.35;
  const palette = ['#756C5D', '#91856E', '#665F55', '#88725B', '#A09278', '#5C5B56', '#7C766A'];
  const count = Math.max(46, Math.round(Math.hypot(link.end.x - link.start.x, link.end.y - link.start.y) / 5.6));
  for (let index = 0; index < count; index++) {
    const t = (index + 0.5) / count;
    const p = sampleCubic(link.start, c1, c2, link.end, t);
    const ahead = sampleCubic(link.start, c1, c2, link.end, clamp(t + 0.015, 0, 1));
    const dx = ahead.x - p.x;
    const dy = ahead.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const columns = 4 + (index % 3 === 0 ? 1 : 0);
    for (let col = 0; col < columns; col++) {
      const lane = (col - (columns - 1) / 2) / columns;
      const jitter = rnd(-0.23, 0.23);
      const x = p.x + nx * (lane + jitter) * width * 0.74 + rnd(-1.8, 1.8);
      const y = p.y + ny * (lane + jitter) * width * 0.74 + rnd(-1.2, 1.2);
      const stoneW = rnd(6.0, 11.4) * (1 - Math.abs(lane) * 0.12);
      const stoneH = rnd(4.8, 8.6);
      const angle = Math.atan2(dy, dx) + rnd(-0.42, 0.42);
      const color = mix(palette[Math.floor(rnd(0, palette.length))], '#5E4C37', rnd(0, 0.18));
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.beginPath();
      const bevel = rnd(1.0, 2.2);
      g.moveTo(-stoneW / 2 + bevel, -stoneH / 2);
      g.lineTo(stoneW / 2 - bevel, -stoneH / 2 + rnd(-0.5, 0.5));
      g.lineTo(stoneW / 2, stoneH / 2 - bevel);
      g.lineTo(-stoneW / 2 + rnd(-0.4, 0.4), stoneH / 2);
      g.lineTo(-stoneW / 2, -stoneH / 2 + bevel);
      g.closePath();
      g.fillStyle = color;
      g.fill();
      g.strokeStyle = 'rgba(30,25,20,.62)';
      g.lineWidth = 0.95;
      g.stroke();
      g.strokeStyle = rgba(mix(color, '#F0E3C0', 0.46), 0.44);
      g.lineWidth = 0.55;
      g.beginPath();
      g.moveTo(-stoneW * 0.28, -stoneH * 0.30);
      g.lineTo(stoneW * 0.25, -stoneH * 0.18);
      g.stroke();
      if (rnd(0, 1) < 0.30) {
        g.strokeStyle = 'rgba(40,34,27,.22)';
        g.lineWidth = 0.45;
        g.beginPath();
        g.moveTo(rnd(-stoneW * 0.32, stoneW * 0.02), rnd(-stoneH * 0.10, stoneH * 0.20));
        g.lineTo(rnd(0, stoneW * 0.36), rnd(-stoneH * 0.22, stoneH * 0.24));
        g.stroke();
      }
      if (rnd(0, 1) < 0.08) {
        g.fillStyle = 'rgba(64,86,42,.34)';
        g.beginPath();
        g.ellipse(rnd(-stoneW * 0.42, stoneW * 0.42), rnd(-stoneH * 0.42, stoneH * 0.42),
          rnd(0.8, 1.8), rnd(0.35, 0.85), rnd(0, Math.PI), 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }
  g.restore();

  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(236,220,174,.18)';
  g.lineWidth = 2.1;
  drawPathStroke(g, link, width * 0.38);
  g.restore();
}

function drawLanternPost(g, lantern, time = 0) {
  const sway = Math.sin(time * 1.7 + hashString(lantern.key) * 0.001) * 0.45;
  const postTopY = lantern.y - lantern.height;
  const armDir = lantern.side > 0 ? -1 : 1;
  const lanternX = lantern.x + armDir * 12;
  const lanternY = postTopY + 7 + sway;
  g.save();
  g.translate(lantern.x, lantern.y);
  g.shadowColor = 'rgba(22,17,12,.32)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 4;
  g.fillStyle = 'rgba(28,23,18,.28)';
  g.beginPath();
  g.ellipse(0, 4, 7.5, 3.2, -0.08, 0, Math.PI * 2);
  g.fill();
  g.shadowColor = 'transparent';

  const wood = '#2D241B';
  const iron = '#191817';
  const ironLit = '#4A4034';
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(10,9,8,.72)';
  g.lineWidth = 5.2;
  g.beginPath();
  g.moveTo(0, 1);
  g.lineTo(0, -lantern.height);
  g.stroke();
  g.strokeStyle = wood;
  g.lineWidth = 3.3;
  g.beginPath();
  g.moveTo(-0.4, 0);
  g.lineTo(0.4, -lantern.height + 1);
  g.stroke();
  g.strokeStyle = 'rgba(113,89,56,.42)';
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-1.4, -5);
  g.lineTo(-0.8, -lantern.height + 7);
  g.stroke();

  g.strokeStyle = iron;
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(0, -lantern.height + 10);
  g.quadraticCurveTo(armDir * 7, -lantern.height + 1, armDir * 14, -lantern.height + 8);
  g.stroke();
  g.fillStyle = ironLit;
  g.beginPath();
  g.arc(0, -lantern.height, 2.4, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.save();
  g.translate(lanternX, lanternY);
  const aura = g.createRadialGradient(0, 0, 0, 0, 0, 24);
  aura.addColorStop(0, 'rgba(255,221,137,.48)');
  aura.addColorStop(0.42, 'rgba(246,160,68,.20)');
  aura.addColorStop(1, 'rgba(177,79,22,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = aura;
  g.beginPath();
  g.ellipse(0, 1, 23, 18, 0, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = 'source-over';

  g.fillStyle = 'rgba(20,18,16,.92)';
  g.strokeStyle = 'rgba(6,5,4,.75)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-6, -8);
  g.lineTo(6, -8);
  g.lineTo(8, 2);
  g.lineTo(4, 10);
  g.lineTo(-4, 10);
  g.lineTo(-8, 2);
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,209,117,.82)';
  g.beginPath();
  g.moveTo(-4.2, -5.3);
  g.lineTo(4.2, -5.3);
  g.lineTo(5.4, 2.2);
  g.lineTo(2.7, 6.8);
  g.lineTo(-2.7, 6.8);
  g.lineTo(-5.4, 2.2);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(80,43,20,.42)';
  g.beginPath();
  g.moveTo(0, -5.2);
  g.lineTo(0, 6.5);
  g.moveTo(-4.8, 0.7);
  g.lineTo(4.8, 0.7);
  g.stroke();
  g.fillStyle = 'rgba(255,245,178,.92)';
  g.beginPath();
  g.ellipse(0, 1.8, 2.3, 4.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,210,.72)';
  g.beginPath();
  g.ellipse(-1.6, -2.4, 1.2, 2.1, -0.4, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function redrawPathCanvas(world) {
  ensureCanvas();
  pathCtx.clearRect(0, 0, WORLD.w, WORLD.h);
  const network = buildSettlementPathNetwork(world?.buildings || []);
  cachedLanterns = buildSettlementLanterns(network);
  for (const lantern of cachedLanterns) drawLanternLightPool(pathCtx, lantern);
  for (const link of network.links) drawCobblestonePath(pathCtx, link);
  for (const lantern of cachedLanterns) drawLanternLightPool(pathCtx, lantern);
}

export function resetSettlementPathCache() {
  cachedSignature = '';
  cachedLanterns = [];
  if (pathCtx) pathCtx.clearRect(0, 0, WORLD.w, WORLD.h);
}

export function drawSettlementPaths(ctx, world, visibleWorld) {
  if (!ctx || !world) return;
  ensureCanvas();
  const signature = networkSignature(world);
  if (signature !== cachedSignature) {
    cachedSignature = signature;
    redrawPathCanvas(world);
  }
  const left = Math.max(0, Math.floor(visibleWorld?.left ?? 0));
  const top = Math.max(0, Math.floor(visibleWorld?.top ?? 0));
  const right = Math.min(WORLD.w, Math.ceil(visibleWorld?.right ?? WORLD.w));
  const bottom = Math.min(WORLD.h, Math.ceil(visibleWorld?.bottom ?? WORLD.h));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  ctx.drawImage(pathCanvas, left, top, width, height, left, top, width, height);
}

export function drawSettlementLanterns(ctx, world, visibleWorld, time = 0) {
  if (!ctx || !world) return;
  ensureCanvas();
  const signature = networkSignature(world);
  if (signature !== cachedSignature) {
    cachedSignature = signature;
    redrawPathCanvas(world);
  }
  const left = visibleWorld?.left ?? 0;
  const right = visibleWorld?.right ?? WORLD.w;
  const top = visibleWorld?.top ?? 0;
  const bottom = visibleWorld?.bottom ?? WORLD.h;
  const visibleLanterns = cachedLanterns
    .filter(lantern => lantern.x >= left - 64 && lantern.x <= right + 64
      && lantern.y >= top - 86 && lantern.y <= bottom + 24)
    .sort((a, b) => a.y - b.y);
  for (const lantern of visibleLanterns) drawLanternPost(ctx, lantern, time);
}
