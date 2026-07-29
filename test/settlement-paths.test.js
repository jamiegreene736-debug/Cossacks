import assert from 'node:assert/strict';
import test from 'node:test';

import { createBuilding } from '../js/economy.js';
import {
  buildSettlementPathNetwork,
  getSettlementPathNodes,
} from '../js/gfx/settlement-paths.js';

test('settlement path network connects every ordinary completed village building on a side', () => {
  const buildings = [
    createBuilding(0, 'town_center', 1200, 1200, true),
    createBuilding(0, 'house', 1540, 1100, true),
    createBuilding(0, 'mill', 1810, 1320, true),
    createBuilding(0, 'barracks', 1460, 1660, true),
    createBuilding(0, 'stable', 2050, 1680, true),
  ];

  const network = buildSettlementPathNetwork(buildings);
  const touched = new Set(network.links.flatMap(link => [link.a, link.b]));

  assert.equal(network.nodes.length, buildings.length);
  assert.equal(touched.size, buildings.length);
  assert.ok(network.links.length >= buildings.length - 1);
  assert.equal(new Set(network.links.map(link => link.key)).size, network.links.length);
});

test('path endpoints overlap courtyard edges so there are no visual gaps', () => {
  const buildings = [
    createBuilding(0, 'town_center', 1600, 1500, true),
    createBuilding(0, 'house', 2040, 1500, true),
  ];

  const network = buildSettlementPathNetwork(buildings);
  assert.equal(network.links.length, 1);
  const [link] = network.links;
  const start = network.nodes.find(node => node.id === link.a);
  const end = network.nodes.find(node => node.id === link.b);

  const startDistance = Math.hypot(link.start.x - start.x, link.start.y - start.y);
  const endDistance = Math.hypot(link.end.x - end.x, link.end.y - end.y);

  assert.ok(startDistance < start.rx, 'path starts slightly inside the first brick circle edge');
  assert.ok(startDistance > start.rx * 0.52, 'path does not disappear under the building center');
  assert.ok(endDistance < end.rx, 'path ends slightly inside the second brick circle edge');
  assert.ok(endDistance > end.rx * 0.52, 'path reaches the second circle perimeter');
});

test('path routing excludes farms, fortifications, incomplete buildings and enemy villages', () => {
  const completeHouse = createBuilding(0, 'house', 1000, 1000, true);
  const completeMill = createBuilding(0, 'mill', 1320, 1060, true);
  const incomplete = createBuilding(0, 'barracks', 1500, 1180, false);
  const farm = createBuilding(0, 'farm', 1150, 1280, true);
  const wall = createBuilding(0, 'wall', 1220, 910, true, { orientation: 'horizontal' });
  const gate = createBuilding(0, 'gate', 1420, 910, true, { orientation: 'horizontal' });
  const enemyHouse = createBuilding(1, 'house', 1680, 1160, true);

  const nodes = getSettlementPathNodes([
    completeHouse, completeMill, incomplete, farm, wall, gate, enemyHouse,
  ]);
  const playerNodes = nodes.filter(node => node.side === 0);
  const network = buildSettlementPathNetwork([
    completeHouse, completeMill, incomplete, farm, wall, gate, enemyHouse,
  ]);

  assert.deepEqual(playerNodes.map(node => node.type).sort(), ['house', 'mill']);
  assert.equal(network.links.length, 1);
  assert.ok(network.links.every(link => (
    [completeHouse.id, completeMill.id].includes(link.a)
    && [completeHouse.id, completeMill.id].includes(link.b)
  )));
});

test('organic path control points are deterministic and bend around intervening buildings', () => {
  const left = createBuilding(0, 'house', 1000, 1400, true);
  const blocker = createBuilding(0, 'foundry', 1320, 1400, true);
  const right = createBuilding(0, 'barracks', 1640, 1400, true);
  const lower = createBuilding(0, 'stable', 1320, 1780, true);

  const first = buildSettlementPathNetwork([left, blocker, right, lower]);
  const second = buildSettlementPathNetwork([left, blocker, right, lower]);

  assert.deepEqual(second, first);
  assert.ok(first.links.some(link => link.controls.some(control => (
    Math.abs(control.y - ((first.nodes.find(node => node.id === link.a).y
      + first.nodes.find(node => node.id === link.b).y) * 0.5)) > 20
  ))), 'at least one generated path should have a visible organic bend');
});
