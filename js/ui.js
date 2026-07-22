// DOM HUD and contextual command cards.

import {
  NATIONS, UNIT_TYPES, BUILDING_TYPES, RESOURCE_KEYS,
  CPU_DIFFICULTIES, DEFAULT_CPU_DIFFICULTY, getTrainableUnitTypes,
} from './config.js';
import { WORLD_COUNTRIES, WORLD_COUNTRY_BY_CODE, countryFlag } from './countries.js';
import {
  formatCost, getBuildingEconomyStats, getEconomyBreakdown,
  getFieldAttachmentStatus, getGatherAssignmentStats, getRallyTarget,
} from './economy.js';
import { formatPeaceTime, isPeaceTime } from './truce.js';
import { isPlayerTeam, playerTeam } from './teams.js';

const $ = id => document.getElementById(id);
let callbacks = {};
let selectedNation = 'england';
let selectedDifficulty = null;
let selectedWorldCountry = 'GB';
let lastSelectionKey = '';
let toastTimer = 0;
let activePlacementType = null;

export function initMenu(menuCallbacks) {
  const difficultyOptions = $('difficulty-options');
  for (const [key, difficulty] of Object.entries(CPU_DIFFICULTIES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.difficulty = key;
    button.setAttribute('aria-pressed', 'false');
    const name = document.createElement('b');
    name.textContent = difficulty.name;
    const summary = document.createElement('span');
    summary.textContent = difficulty.summary;
    button.append(name, summary);
    button.addEventListener('click', () => selectDifficulty(key));
    difficultyOptions.appendChild(button);
  }

  const select = $('sel-player-nation');
  for (const [key, nation] of Object.entries(NATIONS)) {
    if (nation.playable === false) continue;
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
  const countrySelect = $('sel-world-country');
  for (const country of WORLD_COUNTRIES) {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = `${countryFlag(country.code)} ${country.name}`;
    countrySelect.appendChild(option);
  }
  countrySelect.value = selectedWorldCountry;
  countrySelect.addEventListener('change', () => {
    selectedWorldCountry = countrySelect.value;
  });
  $('world-country-count').textContent = `${WORLD_COUNTRIES.length} countries represented`;
  $('btn-start').addEventListener('click', () => {
    if (!selectedDifficulty) return;
    const enemyNation = selectedNation === 'england' ? 'ottoman' : 'england';
    menuCallbacks.onStart({
      playerNation: selectedNation,
      enemyNation,
      allyNations: selectedNation === 'england' ? ['hogwarts', 'starwars'] : ['hogwarts'],
      enemyAllyNation: 'nightmare_circus',
      worldCountry: selectedWorldCountry,
      difficulty: selectedDifficulty,
    });
  });
  $('btn-load-save').addEventListener('click', () => menuCallbacks.onLoad?.());
  $('btn-delete-save').addEventListener('click', () => menuCallbacks.onDelete?.());
}

function selectDifficulty(difficulty) {
  if (!CPU_DIFFICULTIES[difficulty]) return;
  selectedDifficulty = difficulty;
  for (const button of $('difficulty-options').querySelectorAll('button[data-difficulty]')) {
    const active = button.dataset.difficulty === difficulty;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const nationStep = $('nation-step');
  nationStep.classList.remove('locked');
  nationStep.setAttribute('aria-disabled', 'false');
  $('sel-player-nation').disabled = false;
  $('sel-world-country').disabled = false;
  $('btn-start').disabled = false;
  $('preview-difficulty').textContent = CPU_DIFFICULTIES[difficulty].name.toLowerCase();
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
  $('btn-view-left').addEventListener('click', () => cbs.onView?.(-1));
  $('btn-view-right').addEventListener('click', () => cbs.onView?.(1));
  $('btn-zoom-out').addEventListener('click', () => cbs.onZoom?.(-1));
  $('btn-zoom-in').addEventListener('click', () => cbs.onZoom?.(1));
  $('btn-halt').addEventListener('click', cbs.onHalt);
  $('btn-again').addEventListener('click', cbs.onAgain);
  $('btn-resume').addEventListener('click', cbs.onPause);
  $('btn-save').addEventListener('click', () => cbs.onSave?.(false));
  $('btn-save-exit').addEventListener('click', () => cbs.onSave?.(true));
  $('volume-master').addEventListener('input', event => cbs.onAudio?.({ master: Number(event.target.value) / 100 }));
  $('volume-effects').addEventListener('input', event => cbs.onAudio?.({ effects: Number(event.target.value) / 100 }));
  $('volume-music').addEventListener('input', event => cbs.onAudio?.({ music: Number(event.target.value) / 100 }));
  $('pause-music').addEventListener('change', event => cbs.onAudio?.({ pauseMusic: event.target.value }));
  $('btn-mute').addEventListener('click', () => cbs.onMute?.());
  $('btn-cancel-placement').addEventListener('click', () => cbs.onCancelPlacement?.());
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
  hidePauseMenu();
  for (const id of ['hud-top', 'time-controls', 'panel', 'minimap', 'hint-bar']) $(id).classList.remove('hidden');
  const playerAllies = world.sides
    .filter((_side, sideIndex) => sideIndex !== 0 && isPlayerTeam(world, sideIndex))
    .map(side => NATIONS[side.nation].name);
  const playerNames = [NATIONS[world.sides[0].nation].name, ...playerAllies];
  $('hud-player-nation').textContent = playerNames.join(' + ');
  const rivals = world.sides
    .filter((_side, sideIndex) => !isPlayerTeam(world, sideIndex))
    .map(side => NATIONS[side.nation].name);
  $('hud-enemy-nation').textContent = rivals.join(' + ');
  const difficulty = CPU_DIFFICULTIES[world.difficulty] || CPU_DIFFICULTIES[DEFAULT_CPU_DIFFICULTY];
  $('hud-enemy-role').textContent = `${difficulty.name} CPU rival team`;
  $('player-crest').textContent = NATIONS[world.sides[0].nation].name[0];
  $('player-crest').style.background = NATIONS[world.sides[0].nation].coat;
  const country = WORLD_COUNTRY_BY_CODE[world.worldCountry];
  $('hud-world-country').textContent = country
    ? `${countryFlag(country.code)} World Park: ${country.name}` : 'World Park';
  $('enemy-crest').textContent = NATIONS[world.sides[1].nation].name[0];
  $('enemy-crest').style.background = NATIONS[world.sides[1].nation].coat;
  lastSelectionKey = '';
}

export function setPauseLabel(paused) {
  $('btn-pause').innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
}

export function setViewDirection(label) {
  $('view-direction').textContent = label;
}

export function showPauseMenu(audioSettings) {
  $('pause-save-status').textContent = '';
  setAudioControls(audioSettings);
  $('overlay-pause').classList.remove('hidden');
  $('btn-resume').focus();
}

export function hidePauseMenu() { $('overlay-pause').classList.add('hidden'); }

export function setPauseSaveStatus(message, tone = 'good') {
  const status = $('pause-save-status');
  status.textContent = message;
  status.className = tone;
}

export function setAudioControls(settings) {
  const master = Math.round((settings?.master ?? 0.7) * 100);
  const effects = Math.round((settings?.effects ?? 0.72) * 100);
  const music = Math.round((settings?.music ?? 0.42) * 100);
  $('volume-master').value = String(master);
  $('volume-effects').value = String(effects);
  $('volume-music').value = String(music);
  $('volume-master-value').textContent = `${master}%`;
  $('volume-effects-value').textContent = `${effects}%`;
  $('volume-music-value').textContent = `${music}%`;
  $('pause-music').value = settings?.pauseMusic === 'mute' ? 'mute' : 'duck';
  $('btn-mute').textContent = settings?.muted ? 'Unmute' : 'Mute';
  $('btn-mute').setAttribute('aria-pressed', String(Boolean(settings?.muted)));
}

export function setMusicStatus(title, paused = false) {
  const status = $('music-status');
  const next = paused ? `${title} · paused` : title;
  if (status.textContent !== next) status.textContent = next;
}

function formatCampaignTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, '0')}s`;
}

export function setSavedCampaign(summary) {
  const card = $('saved-game-card');
  card.classList.toggle('hidden', !summary);
  if (!summary) return;
  if (summary.corrupt) {
    $('saved-game-title').textContent = 'Unreadable campaign';
    $('saved-game-date').textContent = '';
    $('saved-game-summary').textContent = 'This local save cannot be resumed. Discard it to begin a clean campaign.';
    $('btn-load-save').disabled = true;
    return;
  }
  $('btn-load-save').disabled = false;
  const playerNations = [summary.nation, ...(summary.allyNations || [])];
  const enemyNations = summary.enemyNations?.length
    ? summary.enemyNations
    : [summary.enemyNation];
  const playerLabel = playerNations
    .map(nation => NATIONS[nation]?.name || 'Unknown realm')
    .join(' + ');
  const enemyLabel = enemyNations
    .map(nation => NATIONS[nation]?.name || 'Unknown rival')
    .join(' + ');
  const difficulty = CPU_DIFFICULTIES[summary.difficulty] || CPU_DIFFICULTIES[DEFAULT_CPU_DIFFICULTY];
  $('saved-game-title').textContent = `${playerLabel} vs ${enemyLabel}`;
  const date = new Date(summary.savedAt);
  $('saved-game-date').textContent = date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('saved-game-date').dateTime = date.toISOString();
  $('saved-game-summary').textContent = `${difficulty.name} CPU · ${formatCampaignTime(summary.elapsed)} campaign · ${summary.population.toLocaleString()} population · ${summary.military.toLocaleString()} soldiers · ${summary.buildings.toLocaleString()} buildings`;
}

export function setSpeedLabel(speed) { $('btn-speed').textContent = `${speed}×`; }

export function markFormation(formation) {
  for (const button of $('formation-buttons').querySelectorAll('button[data-formation]')) {
    button.classList.toggle('active', button.dataset.formation === formation);
  }
}

function countMilitary(world, side) {
  let count = 0;
  for (const unit of world.units) {
    if (unit.alive && unit.side === side && unit.type !== 'villager') count++;
  }
  return count;
}

function countTeamMilitary(world, wantPlayerTeam) {
  let count = 0;
  for (const unit of world.units) {
    if (!unit.alive || unit.type === 'villager') continue;
    if (isPlayerTeam(world, unit.side) === wantPlayerTeam) count++;
  }
  return count;
}

function sumTeam(world, wantPlayerTeam, key) {
  return world.sides.reduce((sum, side, sideIndex) => (
    isPlayerTeam(world, sideIndex) === wantPlayerTeam ? sum + (side[key] || 0) : sum
  ), 0);
}

function formatHourly(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 1_000_000) return `+${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}m/hr`;
  if (amount >= 1000) return `+${(amount / 1000).toFixed(amount >= 100_000 ? 0 : 1)}k/hr`;
  return `+${Math.round(amount).toLocaleString()}/hr`;
}

let hudTime = 0;
export function updateHud(world, selection) {
  const now = performance.now();
  if (now - hudTime < 200) return;
  hudTime = now;
  const player = world.sides[0];
  $('hud-player-count').textContent = countTeamMilitary(world, true).toLocaleString();
  $('hud-enemy-count').textContent = countTeamMilitary(world, false).toLocaleString();
  for (const key of RESOURCE_KEYS) {
    $(`res-${key}`).textContent = Math.floor(player.resources[key]).toLocaleString();
    const rate = $(`rate-${key}`);
    rate.textContent = formatHourly(player.incomePerHour[key]);
    rate.classList.toggle('active', player.incomePerHour[key] > 0.5);
  }
  $('res-pop').textContent = `${player.population + player.queuedPopulation} / ${player.popCap}`;
  const seconds = world.time | 0;
  $('hud-timer').textContent = `${(seconds / 60) | 0}:${String(seconds % 60).padStart(2, '0')}`;
  const truce = $('hud-truce');
  const peaceActive = isPeaceTime(world);
  truce.classList.toggle('hidden', !peaceActive);
  if (peaceActive) truce.querySelector('b').textContent = formatPeaceTime(world);

  while (world.events.length) {
    const event = world.events.shift();
    if (event.side === 0) toast(event.text, event.tone);
  }

  const hasLiveEconomy = selection.length === 0 || selection.some(entity => entity.type === 'villager'
    || (entity.entityKind === 'building' && (entity.resourceType || BUILDING_TYPES[entity.type].boost)));
  const key = selection.map(entity => {
    const first = entity.queue?.[0];
    const queueProgress = first ? Math.floor((1 - first.remaining / first.total) * 100) : '';
    const buildProgress = entity.complete === false ? Math.floor(entity.progress * 100) : '';
    const job = entity.job
      ? `${entity.job.kind}:${entity.job.targetId || ''}:${entity.job.resourceType || ''}` : '';
    const wallState = entity.wallMount
      ? `mounted:${entity.wallMount.wallId}`
      : entity.wallOrder ? `mounting:${entity.wallOrder.wallId}` : '';
    const rally = entity.entityKind === 'building'
      ? `${entity.rallyTargetId ?? ''}:${entity.rallyX ?? ''}:${entity.rallyY ?? ''}` : '';
    return `${entity.entityKind || 'unit'}:${entity.id}:${entity.queue?.length || 0}:${queueProgress}`
      + `:${entity.complete ?? ''}:${buildProgress}:${Math.ceil(entity.hp || 0)}:${job}:${wallState}`
      + `:${rally}:${entity.type === 'gate' ? entity.gateOpen !== false : ''}`;
  }).join('|');
  // Economy telemetry changes every 0.75 seconds. Rebuilding its cards faster
  // only creates DOM/layout work without showing the player newer information.
  const renderKey = `${key}:${hasLiveEconomy ? Math.floor(world.time / 0.75) : ''}`;
  if (renderKey !== lastSelectionKey) {
    renderSelection(world, selection);
    lastSelectionKey = renderKey;
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
    const economy = getEconomyBreakdown(world, 0);
    const gathering = RESOURCE_KEYS.reduce((sum, resourceType) => sum + economy[resourceType].workers, 0);
    title.textContent = 'Settlement';
    info.textContent = 'Live economy overview';
    detail.textContent = `${world.units.filter(unit => unit.alive && unit.side === 0 && unit.type === 'villager').length} villagers · ${gathering} assigned to the economy · ${world.buildings.filter(b => b.alive && b.side === 0).length} buildings`;
    context.textContent = 'Assigned output / actual income per hour';
    for (const resourceType of RESOURCE_KEYS) addEconomyMetric(grid, economy[resourceType], { showActual: true });
    return;
  }

  const building = selection.length === 1 && selection[0].entityKind === 'building' ? selection[0] : null;
  if (building) {
    const def = BUILDING_TYPES[building.type];
    const economy = getBuildingEconomyStats(world, building);
    title.textContent = def.label;
    info.textContent = building.complete ? def.description : `Under construction — ${Math.floor(building.progress * 100)}%`;
    const trainable = getTrainableUnitTypes(world.sides[building.side].nation, building.type);
    const rally = building.complete && trainable.length ? rallyDescription(world, building) : '';
    const status = economy
      ? `${Math.ceil(building.hp).toLocaleString()} / ${building.maxHp.toLocaleString()} integrity · ${economy.workers} assigned · ${formatHourly(economy.projectedPerHour)} projected`
      : `${Math.ceil(building.hp).toLocaleString()} / ${building.maxHp.toLocaleString()} integrity`;
    detail.textContent = rally ? `${status} · ${rally}` : status;
    context.textContent = building.complete
      ? (economy
        ? (building.type === 'town_center'
          ? 'Routed output / rolling stockpile income per hour'
          : 'Building output per hour')
        : 'Production')
      : 'Construction';
    if (!building.complete) return;
    if (building.type === 'tower') {
      info.textContent = 'Garrisoned defensive cannon — measured fire with no splash damage.';
      detail.textContent = `${status} · ${def.attack} damage · ${def.range} attack radius · ${def.reload.toFixed(1)}s reload`;
      context.textContent = 'Artillery coverage · exact radius shown on the map';
    }
    if (economy) {
      for (const row of economy.resources) {
        addEconomyMetric(grid, row, {
          showActual: building.type === 'town_center',
          bonusPerHour: row.bonusPerHour,
          remaining: building.resourceType === row.resourceType ? economy.remaining : null,
        });
      }
    }
    if (building.type === 'gate') {
      const open = building.gateOpen !== false;
      info.textContent = open ? 'Gate open — troops may pass' : 'Gate closed — passage barred';
      context.textContent = 'Fortification controls';
      addCommand(grid, {
        action: 'gate', type: 'gate', icon: open ? '▥' : '∩',
        label: open ? 'Close Gate' : 'Open Gate',
        meta: open ? 'Bar the passage' : 'Clear the passage',
      });
    }
    for (const unitType of trainable) {
      const counts = UNIT_TYPES[unitType].worker ? [1, 5] : [1, 5, 20];
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
    const economy = getEconomyBreakdown(world, 0, villagers);
    const gatherers = RESOURCE_KEYS.reduce((sum, resourceType) => sum + economy[resourceType].workers, 0);
    const projected = RESOURCE_KEYS.reduce((sum, resourceType) => sum + economy[resourceType].projectedPerHour, 0);
    const women = villagers.filter(worker => worker.unitType === 'woman_villager').length;
    title.textContent = villagers.length === 1 && women === 1
      ? 'Woman Villager'
      : `${villagers.length} Villager${villagers.length === 1 ? '' : 's'}`;
    const working = villagers.filter(worker => worker.job).length;
    const carrying = villagers.filter(worker => (Number(worker.job?.carriedAmount) || 0) > 0).length;
    info.textContent = `${working} working · ${villagers.length - working} ready for orders${carrying ? ` · ${carrying} carrying` : ''}${women ? ` · ${women} cannon-trained` : ''}`;
    const attackInstruction = women
      ? 'hover an enemy and click to wheel out their cannon'
      : 'hover an enemy and click to draw muskets';
    detail.textContent = gatherers
      ? `${gatherers} working · ${formatHourly(projected)} assigned · ${attackInstruction}`
      : `Click open ground to move; hover and click work targets or enemies to gather, build, or ${women ? 'wheel out cannon' : 'draw muskets'}.`;
    context.textContent = gatherers ? 'Selected output and construction' : 'Construct a building';
    for (const resourceType of RESOURCE_KEYS) {
      if (economy[resourceType].workers) addEconomyMetric(grid, economy[resourceType]);
    }
    for (const [type, def] of Object.entries(BUILDING_TYPES)) {
      if (type === 'town_center') continue;
      const fieldStatus = type === 'farm' ? getFieldAttachmentStatus(world, 0) : null;
      addCommand(grid, {
        action: 'build', type, icon: buildingIcon(type), label: def.label,
        meta: fieldStatus && !fieldStatus.ok ? fieldStatus.message : formatCost(def.cost),
        disabled: Boolean(fieldStatus && !fieldStatus.ok),
      });
    }
    return;
  }

  const byType = {};
  for (const unit of units) byType[unit.type] = (byType[unit.type] || 0) + 1;
  const wallDefenders = units.filter(unit => unit.wallMount).length;
  title.textContent = `${units.length.toLocaleString()} Soldiers`;
  info.textContent = Object.entries(byType).map(([type, count]) => `${count} ${UNIT_TYPES[type].label}`).join(' · ');
  detail.textContent = wallDefenders
    ? `${wallDefenders} defending the wall · click ground to descend or an enemy to focus fire.`
    : 'Click ground to march; trained soldiers automatically engage nearby enemies and then resume their route. Right-click an accessible wall to mount musketeers.';
  context.textContent = 'Formation and movement';
  formations.classList.remove('hidden');
}

function rallyDescription(world, building) {
  if (Number.isNaN(building.rallyX) || Number.isNaN(building.rallyY)) {
    return building.type === 'town_center'
      ? 'Click a resource, workplace, or construction to rally new villagers · two-finger or Control-click ground for a waypoint.'
      : 'Right-click a building or ground to set the rally point.';
  }
  const target = getRallyTarget(world, building);
  if (!target) return 'Rally: ground waypoint';
  if (target.entityKind === 'resource') return `Rally: ${target.resourceType} · new villagers auto-gather`;
  const def = BUILDING_TYPES[target.type];
  if (!target.complete) return `Rally: ${def.label} construction · new villagers auto-build`;
  if (target.type === 'farm' || def.workResources?.length) {
    return `Rally: ${def.label} · new villagers auto-work`;
  }
  return `Rally: ${def.label} waypoint`;
}

function addEconomyMetric(grid, row, options = {}) {
  const labels = { food: 'Food', wood: 'Wood', gold: 'Gold', stone: 'Stone' };
  const icons = { food: '●', wood: '▥', gold: '◆', stone: '⬟' };
  const card = document.createElement('div');
  card.className = `economy-card ${row.resourceType}`;
  const icon = document.createElement('span');
  icon.className = 'economy-icon';
  icon.textContent = icons[row.resourceType];
  const copy = document.createElement('span');
  copy.className = 'economy-copy';
  const label = document.createElement('b');
  label.textContent = labels[row.resourceType];
  const output = document.createElement('strong');
  output.textContent = formatHourly(row.projectedPerHour);
  const meta = document.createElement('small');
  const parts = [`${row.workers} worker${row.workers === 1 ? '' : 's'}`];
  if (options.showActual) parts.push(`${formatHourly(row.actualPerHour)} actual`);
  if (options.bonusPerHour > 0.5) parts.push(`${formatHourly(options.bonusPerHour)} building bonus`);
  if (options.remaining !== null && options.remaining !== undefined) {
    parts.push(`${Math.floor(options.remaining).toLocaleString()} remaining`);
  }
  meta.textContent = parts.join(' · ');
  copy.append(label, output, meta);
  card.append(icon, copy);
  grid.appendChild(card);
}

function addCommand(grid, command) {
  const button = document.createElement('button');
  button.className = 'command-card';
  button.dataset.action = command.action;
  button.dataset.type = command.type;
  if (command.action === 'build') {
    const active = command.type === activePlacementType;
    button.classList.toggle('placement-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (command.count) button.dataset.count = String(command.count);
  button.disabled = Boolean(command.disabled);
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
  return {
    villager: '⚒', woman_villager: '⚒◉', musk: '♟', pike: '†', cav: '♞', gun: '◉',
    wizard_worker: '⚒✦', witch_worker: '⚒✧', circus_worker: '⚒☠',
    starwars_mechanic: '⚒◇', starwars_robed_villager: '⚒◈',
    wizard_duelist: '✦', witch_duelist: '✧', moaning_myrtle: '◌',
    pennywise: '●', art_clown: '◐', twisty_clown: '♣',
    captain_spaulding: '※', killer_klown: '◎',
    starwars_sentinel: '◇', starwars_blade_guard: '◈',
    starwars_skiff_rider: '⬦', starwars_pulse_cannon: '◉◇',
  }[type] || '•';
}

function buildingIcon(type) {
  return {
    house: '⌂', farm: '≋', mill: '✣', lumber_camp: '♣', mine: '◆',
    barracks: '⚔', stable: '♞', foundry: '◉', tower: '♜', castle: '♛',
    school: '⌘', pool: '≈', beach: '≋', park: '♧', playground: '☆',
    wall: '▥', gate: '∩', wall_stairs: '▰',
  }[type] || '▦';
}

function updateObjective(world) {
  const villagers = world.units.filter(unit => unit.alive && unit.side === 0 && unit.type === 'villager');
  const ownBuildings = world.buildings.filter(building => building.alive && building.side === 0);
  const military = countMilitary(world, 0);
  let titleText, body;
  const hasFarm = ownBuildings.some(building => building.type === 'farm' && building.complete);
  const hasMill = ownBuildings.some(building => building.type === 'mill' && building.complete);
  if (villagers.length === 0) {
    titleText = 'The first resident';
    body = 'Your Town Center is preparing a free first villager.';
  } else if (!hasFarm && !villagers.some(worker => ['gather', 'workplace'].includes(worker.job?.kind))) {
    titleText = 'Stock the storehouses';
    body = 'Select your villager, then click a resource or completed economic building.';
  } else if (!hasMill) {
    titleText = 'Establish the mill';
    body = 'Build and complete a Mill before laying out cultivated fields.';
  } else if (!hasFarm) {
    titleText = 'Lay out the fields';
    body = 'Select a villager, choose Field, then place it beside the Mill to attach it.';
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
  const title = $('objective-title');
  const text = $('objective-text');
  if (title.textContent !== titleText) title.textContent = titleText;
  if (text.textContent !== body) text.textContent = body;
}

export function setPlacement(active, label = '', type = '', orientation = '') {
  activePlacementType = active ? type : null;
  $('placement-tip').classList.toggle('hidden', !active);
  if (active && label) {
    $('placement-message').textContent = type === 'farm'
      ? 'Field: move beside a completed Mill · snaps to an open attached plot · HUD or Esc cancels'
      : BUILDING_TYPES[type]?.wallAttachment
      ? `${label}: move beside a completed Stone Wall · snaps only to the settlement-facing inner side · HUD or Esc cancels`
      : BUILDING_TYPES[type]?.fortification
      ? type === 'wall'
        ? `${label}: drag from open ground or an existing wall end · bend while dragging to curve · HUD or Esc cancels`
        : `${label}: click terrain · R turns ${orientation === 'diagonal' ? 'diagonal' : 'straight'} · HUD or Esc cancels`
      : `${label}: click terrain to build · Click any HUD panel to cancel`;
  }
  for (const button of $('command-grid').querySelectorAll('button[data-action="build"]')) {
    const selected = active && button.dataset.type === type;
    button.classList.toggle('placement-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

export function setResourceHover(world, hover) {
  const tooltip = $('resource-tooltip');
  const attack = hover?.kind === 'attack' && hover.target?.alive && hover.workers?.length;
  const repair = hover?.kind === 'repair' && hover.target?.alive && hover.workers?.length;
  tooltip.classList.toggle('attack', Boolean(attack));
  tooltip.classList.toggle('repair', Boolean(repair));
  if (world && attack) {
    const targetDef = hover.target.entityKind === 'building'
      ? BUILDING_TYPES[hover.target.type] : UNIT_TYPES[hover.target.type];
    const villager = UNIT_TYPES.villager;
    const title = document.createElement('strong');
    title.textContent = `Attack Enemy ${targetDef?.short || targetDef?.label || 'Target'}`;
    const output = document.createElement('span');
    output.textContent = `${hover.workers.length} villager${hover.workers.length === 1 ? '' : 's'} · ${villager.dmg} damage · ${villager.range} range · ${Math.round(villager.acc * 100)}% accuracy`;
    const instruction = document.createElement('small');
    instruction.textContent = 'Click to draw muskets and fire · slower and weaker than trained musketeers.';
    tooltip.replaceChildren(title, output, instruction);
    tooltip.style.left = `${Math.max(12, Math.min(window.innerWidth - 294, hover.screenX + 18))}px`;
    tooltip.style.top = `${Math.max(90, Math.min(window.innerHeight - 235, hover.screenY + 18))}px`;
    tooltip.classList.remove('hidden');
    return;
  }
  if (world && repair) {
    const def = BUILDING_TYPES[hover.target.type];
    const integrity = Math.max(0, Math.ceil(hover.target.hp / hover.target.maxHp * 100));
    const title = document.createElement('strong');
    title.textContent = `Repair ${def?.label || 'Building'}`;
    const output = document.createElement('span');
    output.textContent = `${hover.workers.length} villager${hover.workers.length === 1 ? '' : 's'} selected · ${integrity}% integrity${hover.target.ignited ? ' · burning' : ''}`;
    const instruction = document.createElement('small');
    instruction.textContent = 'Click to assign the selected villagers, suppress the fire, and rebuild the structure.';
    tooltip.replaceChildren(title, output, instruction);
    tooltip.style.left = `${Math.max(12, Math.min(window.innerWidth - 294, hover.screenX + 18))}px`;
    tooltip.style.top = `${Math.max(90, Math.min(window.innerHeight - 235, hover.screenY + 18))}px`;
    tooltip.classList.remove('hidden');
    return;
  }
  const construction = hover?.target?.entityKind === 'building' && !hover.target.complete;
  if (world && construction && hover.workers?.length) {
    const title = document.createElement('strong');
    title.textContent = `Continue ${BUILDING_TYPES[hover.target.type].label}`;
    const output = document.createElement('span');
    output.textContent = `${hover.workers.length} villager${hover.workers.length === 1 ? '' : 's'} selected · ${Math.floor(hover.target.progress * 100)}% built`;
    const instruction = document.createElement('small');
    instruction.textContent = 'Click to assign the selected villagers and finish this construction.';
    tooltip.replaceChildren(title, output, instruction);
    tooltip.style.left = `${Math.max(12, Math.min(window.innerWidth - 294, hover.screenX + 18))}px`;
    tooltip.style.top = `${Math.max(90, Math.min(window.innerHeight - 235, hover.screenY + 18))}px`;
    tooltip.classList.remove('hidden');
    return;
  }
  const stats = world && hover?.target
    ? getGatherAssignmentStats(world, hover.workers || [], hover.target) : null;
  if (!stats || stats.workers === 0) {
    tooltip.classList.add('hidden');
    tooltip.classList.remove('attack');
    tooltip.classList.remove('repair');
    return;
  }
  const labels = {
    food: hover.target.type === 'farm' ? 'Field' : 'Food source',
    wood: 'Forest', gold: 'Gold deposit', stone: 'Stone deposit',
  };
  const title = document.createElement('strong');
  const workplace = hover.target.entityKind === 'building' && stats.renewable;
  title.textContent = workplace
    ? BUILDING_TYPES[hover.target.type].label : labels[stats.resourceType] || 'Resource';
  const output = document.createElement('span');
  output.textContent = `${stats.workers} selected · ${formatHourly(stats.projectedPerHour)}`;
  const instruction = document.createElement('small');
  instruction.textContent = stats.renewable
    ? `Click to work here · renewable ${stats.resourceType} · ${stats.assignedWorkers} already assigned`
    : `Click to gather · ${Math.floor(stats.amount).toLocaleString()} remaining · ${stats.assignedWorkers} already assigned`;
  tooltip.replaceChildren(title, output, instruction);
  tooltip.style.left = `${Math.max(12, Math.min(window.innerWidth - 294, hover.screenX + 18))}px`;
  tooltip.style.top = `${Math.max(90, Math.min(window.innerHeight - 235, hover.screenY + 18))}px`;
  tooltip.classList.remove('hidden');
}

export function toast(message, tone = '') {
  const element = $('toast');
  element.textContent = message;
  element.className = tone || 'neutral';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 2600);
}

export function showEnd(world) {
  const victory = world.winner === playerTeam(world);
  $('end-title').textContent = victory ? 'Rainbow Over the Empire' : world.winner === -2 ? 'Mutual Ruin' : 'The Realm Has Fallen';
  $('end-verdict').textContent = victory
    ? 'Both rival towns are broken. Your allied settlements command the field beneath a sudden rainbow.'
    : 'Your team Town Centers have fallen. Rebuild the plan and return stronger.';
  const player = world.sides[0];
  const seconds = world.time | 0;
  $('end-stats').innerHTML = `
    <span>Campaign length</span><b>${(seconds / 60) | 0}m ${String(seconds % 60).padStart(2, '0')}s</b>
    <span>Your units raised</span><b>${player.unitsCreated.toLocaleString()}</b>
    <span>Allied team units raised</span><b>${sumTeam(world, true, 'unitsCreated').toLocaleString()}</b>
    <span>Enemy units defeated</span><b>${sumTeam(world, true, 'kills').toLocaleString()}</b>
    <span>Allied team losses</span><b>${sumTeam(world, true, 'losses').toLocaleString()}</b>
    <span>Rival team units raised</span><b>${sumTeam(world, false, 'unitsCreated').toLocaleString()}</b>`;
  const overlay = $('overlay-end');
  overlay.classList.toggle('victory', victory);
  overlay.classList.remove('hidden');
}

export function showStartMenu() {
  for (const id of ['hud-top', 'time-controls', 'panel', 'minimap', 'hint-bar', 'placement-tip']) $(id).classList.add('hidden');
  $('overlay-end').classList.add('hidden');
  $('overlay-end').classList.remove('victory');
  hidePauseMenu();
  $('overlay-start').classList.remove('hidden');
}
