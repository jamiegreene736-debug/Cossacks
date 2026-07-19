// DOM HUD and contextual command cards.

import { NATIONS, UNIT_TYPES, BUILDING_TYPES, RESOURCE_KEYS } from './config.js';
import { formatCost } from './economy.js';

const $ = id => document.getElementById(id);
let callbacks = {};
let selectedNation = 'england';
let lastSelectionKey = '';
let toastTimer = 0;

export function initMenu(onStart) {
  const select = $('sel-player-nation');
  for (const [key, nation] of Object.entries(NATIONS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = nation.name;
    select.appendChild(option);
  }
  select.value = selectedNation;
  updateNationPreview();
  select.addEventListener('change', () => {
    selectedNation = select.value;
    updateNationPreview();
  });
  $('btn-start').addEventListener('click', () => {
    const enemyNation = selectedNation === 'england' ? 'ottoman' : 'england';
    onStart({ playerNation: selectedNation, enemyNation });
  });
}

function updateNationPreview() {
  const player = NATIONS[selectedNation];
  const enemyKey = selectedNation === 'england' ? 'ottoman' : 'england';
  $('preview-name').textContent = player.name;
  $('preview-blurb').textContent = player.blurb;
  $('preview-enemy').textContent = NATIONS[enemyKey].name;
  $('preview-crest').textContent = player.name[0];
  $('preview-crest').style.background = player.coat;
}

export function bindControls(cbs) {
  callbacks = cbs;
  $('btn-pause').addEventListener('click', cbs.onPause);
  $('btn-speed').addEventListener('click', cbs.onSpeed);
  $('btn-halt').addEventListener('click', cbs.onHalt);
  $('btn-again').addEventListener('click', cbs.onAgain);
  $('command-grid').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    cbs.onCommand?.({
      action: button.dataset.action,
      type: button.dataset.type,
      count: Number(button.dataset.count || 1),
    });
  });
  for (const button of $('formation-buttons').querySelectorAll('button[data-formation]')) {
    button.addEventListener('click', () => cbs.onFormation(button.dataset.formation));
  }
}

export function showBattleHud(world) {
  $('overlay-start').classList.add('hidden');
  $('overlay-end').classList.add('hidden');
  for (const id of ['hud-top', 'time-controls', 'panel', 'minimap', 'hint-bar']) $(id).classList.remove('hidden');
  $('hud-player-nation').textContent = NATIONS[world.sides[0].nation].name;
  $('hud-enemy-nation').textContent = NATIONS[world.sides[1].nation].name;
  $('player-crest').textContent = NATIONS[world.sides[0].nation].name[0];
  $('player-crest').style.background = NATIONS[world.sides[0].nation].coat;
  $('enemy-crest').textContent = NATIONS[world.sides[1].nation].name[0];
  $('enemy-crest').style.background = NATIONS[world.sides[1].nation].coat;
  lastSelectionKey = '';
}

export function setPauseLabel(paused) {
  $('btn-pause').innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
}

export function setSpeedLabel(speed) { $('btn-speed').textContent = `${speed}×`; }

export function markFormation(formation) {
  for (const button of $('formation-buttons').querySelectorAll('button[data-formation]')) {
    button.classList.toggle('active', button.dataset.formation === formation);
  }
}

function countMilitary(world, side) {
  return world.units.filter(unit => unit.alive && unit.side === side && unit.type !== 'villager').length;
}

let hudTime = 0;
export function updateHud(world, selection) {
  const now = performance.now();
  if (now - hudTime < 120) return;
  hudTime = now;
  const player = world.sides[0];
  $('hud-player-count').textContent = countMilitary(world, 0).toLocaleString();
  $('hud-enemy-count').textContent = countMilitary(world, 1).toLocaleString();
  for (const key of RESOURCE_KEYS) $(`res-${key}`).textContent = Math.floor(player.resources[key]).toLocaleString();
  $('res-pop').textContent = `${player.population + player.queuedPopulation} / ${player.popCap}`;
  const seconds = world.time | 0;
  $('hud-timer').textContent = `${(seconds / 60) | 0}:${String(seconds % 60).padStart(2, '0')}`;

  while (world.events.length) {
    const event = world.events.shift();
    if (event.side === 0) toast(event.text, event.tone);
  }

  const key = selection.map(entity => `${entity.entityKind || 'unit'}:${entity.id}:${entity.queue?.length || 0}:${entity.complete ?? ''}`)
    .join('|');
  // Queue progress and construction percentages still refresh periodically.
  if (key !== lastSelectionKey || selection.some(entity => entity.queue?.length || entity.complete === false || entity.type === 'villager')) {
    renderSelection(world, selection);
    lastSelectionKey = key;
  }
  updateObjective(world);
}

function renderSelection(world, selection) {
  const title = $('sel-title');
  const info = $('sel-info');
  const detail = $('sel-detail');
  const grid = $('command-grid');
  const context = $('command-context');
  const formations = $('formation-buttons');
  grid.replaceChildren();
  formations.classList.add('hidden');

  if (selection.length === 0) {
    title.textContent = 'Settlement';
    info.textContent = 'Select a villager or building for commands.';
    detail.textContent = `${world.units.filter(unit => unit.alive && unit.side === 0 && unit.type === 'villager').length} villagers · ${world.buildings.filter(b => b.alive && b.side === 0).length} buildings`;
    context.textContent = 'Select a unit or building';
    return;
  }

  const building = selection.length === 1 && selection[0].entityKind === 'building' ? selection[0] : null;
  if (building) {
    const def = BUILDING_TYPES[building.type];
    title.textContent = def.label;
    info.textContent = building.complete ? def.description : `Under construction — ${Math.floor(building.progress * 100)}%`;
    detail.textContent = `${Math.ceil(building.hp).toLocaleString()} / ${building.maxHp.toLocaleString()} integrity`;
    context.textContent = building.complete ? 'Production' : 'Construction';
    if (!building.complete) return;
    for (const unitType of def.trains || []) {
      const counts = unitType === 'villager' ? [1, 5] : [1, 5, 20];
      for (const count of counts) addCommand(grid, {
        action: 'train', type: unitType, count,
        icon: unitIcon(unitType),
        label: `${UNIT_TYPES[unitType].short} ×${count}`,
        meta: multiplyCost(UNIT_TYPES[unitType].cost, count),
      });
    }
    if (building.queue.length) {
      const first = building.queue[0];
      const percent = Math.floor((1 - first.remaining / first.total) * 100);
      const queue = document.createElement('div');
      queue.className = 'queue-summary';
      queue.textContent = `${UNIT_TYPES[first.type].short} ${percent}% · ${building.queue.length} queued`;
      grid.appendChild(queue);
    }
    return;
  }

  const units = selection.filter(entity => entity.entityKind !== 'building');
  const villagers = units.filter(unit => unit.type === 'villager');
  if (villagers.length) {
    title.textContent = `${villagers.length} Villager${villagers.length === 1 ? '' : 's'}`;
    const working = villagers.filter(worker => worker.job).length;
    info.textContent = `${working} working · ${villagers.length - working} ready for orders`;
    detail.textContent = 'Right-click a deposit to gather or a foundation to construct.';
    context.textContent = 'Construct a building';
    for (const [type, def] of Object.entries(BUILDING_TYPES)) {
      if (type === 'town_center') continue;
      addCommand(grid, {
        action: 'build', type, icon: buildingIcon(type), label: def.label,
        meta: formatCost(def.cost),
      });
    }
    return;
  }

  const byType = {};
  for (const unit of units) byType[unit.type] = (byType[unit.type] || 0) + 1;
  title.textContent = `${units.length.toLocaleString()} Soldiers`;
  info.textContent = Object.entries(byType).map(([type, count]) => `${count} ${UNIT_TYPES[type].label}`).join(' · ');
  detail.textContent = 'Right-click ground to march or an enemy to focus the attack.';
  context.textContent = 'Formation and movement';
  formations.classList.remove('hidden');
}

function addCommand(grid, command) {
  const button = document.createElement('button');
  button.className = 'command-card';
  button.dataset.action = command.action;
  button.dataset.type = command.type;
  if (command.count) button.dataset.count = String(command.count);
  const icon = document.createElement('span');
  icon.className = 'command-icon';
  icon.textContent = command.icon;
  const text = document.createElement('span');
  text.className = 'command-copy';
  const label = document.createElement('b');
  label.textContent = command.label;
  const meta = document.createElement('small');
  meta.textContent = command.meta;
  text.append(label, meta);
  button.append(icon, text);
  grid.appendChild(button);
}

function multiplyCost(cost, count) {
  return formatCost(Object.fromEntries(Object.entries(cost).map(([key, amount]) => [key, amount * count])));
}

function unitIcon(type) {
  return { villager: '⚒', musk: '♟', pike: '†', cav: '♞', gun: '◉' }[type] || '•';
}

function buildingIcon(type) {
  return {
    house: '⌂', farm: '≋', mill: '✣', lumber_camp: '♣', mine: '◆',
    barracks: '⚔', stable: '♞', foundry: '◉', tower: '♜',
  }[type] || '▦';
}

function updateObjective(world) {
  const villagers = world.units.filter(unit => unit.alive && unit.side === 0 && unit.type === 'villager');
  const ownBuildings = world.buildings.filter(building => building.alive && building.side === 0);
  const military = countMilitary(world, 0);
  let titleText, body;
  const hasFarm = ownBuildings.some(building => building.type === 'farm');
  if (villagers.length === 0) {
    titleText = 'The first resident';
    body = 'Your Town Center is preparing a free first villager.';
  } else if (!hasFarm && !villagers.some(worker => worker.job?.kind === 'gather')) {
    titleText = 'Stock the storehouses';
    body = 'Select your villager and right-click berries or a forest to gather.';
  } else if (!hasFarm) {
    titleText = 'Secure the food supply';
    body = 'Select a villager, choose Farm, then place and construct it.';
  } else if (!ownBuildings.some(building => building.type === 'barracks')) {
    titleText = 'Prepare for war';
    body = 'Raise houses for population and a Barracks for infantry.';
  } else if (military < 20) {
    titleText = 'Muster the first regiment';
    body = 'Select a completed military building and train soldiers in batches.';
  } else {
    titleText = 'Break the rival empire';
    body = 'Build an army at massive scale and destroy the enemy Town Center.';
  }
  $('objective-title').textContent = titleText;
  $('objective-text').textContent = body;
}

export function setPlacement(active, label = '') {
  $('placement-tip').classList.toggle('hidden', !active);
  if (active && label) $('placement-tip').textContent = `${label}: move to place · Click to build · Shift-click for another · Right-click or Esc to cancel`;
}

export function toast(message, tone = '') {
  const element = $('toast');
  element.textContent = message;
  element.className = tone || 'neutral';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 2600);
}

export function showEnd(world) {
  const victory = world.winner === 0;
  $('end-title').textContent = victory ? 'Empire Ascendant' : world.winner === 1 ? 'The Realm Has Fallen' : 'Mutual Ruin';
  $('end-verdict').textContent = victory
    ? 'The rival seat of power lies in ruins. Your banners command the field.'
    : 'Your Town Center has fallen. Rebuild the plan and return stronger.';
  const player = world.sides[0];
  const enemy = world.sides[1];
  const seconds = world.time | 0;
  $('end-stats').innerHTML = `
    <span>Campaign length</span><b>${(seconds / 60) | 0}m ${String(seconds % 60).padStart(2, '0')}s</b>
    <span>Your units raised</span><b>${player.unitsCreated.toLocaleString()}</b>
    <span>Enemy units defeated</span><b>${player.kills.toLocaleString()}</b>
    <span>Your losses</span><b>${player.losses.toLocaleString()}</b>
    <span>Rival units raised</span><b>${enemy.unitsCreated.toLocaleString()}</b>`;
  $('overlay-end').classList.remove('hidden');
}

export function showStartMenu() {
  for (const id of ['hud-top', 'time-controls', 'panel', 'minimap', 'hint-bar', 'placement-tip']) $(id).classList.add('hidden');
  $('overlay-end').classList.add('hidden');
  $('overlay-start').classList.remove('hidden');
}
