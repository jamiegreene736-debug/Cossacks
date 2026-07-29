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

let pathCanvas = null;
let pathCtx = null;
let cachedSignature = '';

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

function redrawPathCanvas(world) {
  ensureCanvas();
  pathCtx.clearRect(0, 0, WORLD.w, WORLD.h);
  const network = buildSettlementPathNetwork(world?.buildings || []);
  for (const link of network.links) drawCobblestonePath(pathCtx, link);
}

export function resetSettlementPathCache() {
  cachedSignature = '';
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
