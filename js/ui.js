// DOM UI: start menu, HUD, selection panel, end-of-battle screen.

import { NATIONS, ARMY_SIZES, UNIT_TYPES } from './config.js';

const $ = (id) => document.getElementById(id);

let sizeChoice = 'battle';
let strengthChoice = 1;

const STRENGTHS = [
  { mult: 1, label: 'Even match', note: 'same army' },
  { mult: 1.25, label: 'Outnumbered', note: '+25% enemies' },
  { mult: 1.5, label: 'Overwhelming', note: '+50% enemies' },
];

export function initMenu(onStart) {
  const pSel = $('sel-player-nation');
  const eSel = $('sel-enemy-nation');
  for (const [key, nat] of Object.entries(NATIONS)) {
    for (const sel of [pSel, eSel]) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${nat.name} — ${nat.blurb}`;
      sel.appendChild(opt);
    }
  }
  pSel.value = 'russia';
  eSel.value = 'sweden';

  const sizeWrap = $('size-buttons');
  for (const s of ARMY_SIZES) {
    const btn = document.createElement('button');
    btn.innerHTML = `${s.label}<small>${s.note}</small>`;
    btn.dataset.size = s.id;
    if (s.id === sizeChoice) btn.classList.add('active');
    btn.addEventListener('click', () => {
      sizeChoice = s.id;
      for (const b of sizeWrap.children) b.classList.toggle('active', b === btn);
    });
    sizeWrap.appendChild(btn);
  }

  const strWrap = $('strength-buttons');
  for (const s of STRENGTHS) {
    const btn = document.createElement('button');
    btn.innerHTML = `${s.label}<small>${s.note}</small>`;
    if (s.mult === strengthChoice) btn.classList.add('active');
    btn.addEventListener('click', () => {
      strengthChoice = s.mult;
      for (const b of strWrap.children) b.classList.toggle('active', b === btn);
    });
    strWrap.appendChild(btn);
  }

  $('btn-start').addEventListener('click', () => {
    onStart({
      playerNation: pSel.value,
      enemyNation: eSel.value,
      sizeId: sizeChoice,
      enemyMult: strengthChoice,
    });
  });
}

export function bindControls(cbs) {
  $('btn-pause').addEventListener('click', cbs.onPause);
  $('btn-speed').addEventListener('click', cbs.onSpeed);
  $('btn-halt').addEventListener('click', cbs.onHalt);
  $('btn-again').addEventListener('click', cbs.onAgain);
  for (const btn of $('formation-buttons').querySelectorAll('button[data-formation]')) {
    btn.addEventListener('click', () => cbs.onFormation(btn.dataset.formation));
  }
}

export function showBattleHud(world) {
  $('overlay-start').classList.add('hidden');
  $('overlay-end').classList.add('hidden');
  $('hud-top').classList.remove('hidden');
  $('panel').classList.remove('hidden');
  $('minimap').classList.remove('hidden');
  $('hint-bar').classList.remove('hidden');
  $('hud-player-nation').textContent = NATIONS[world.sides[0].nation].name;
  $('hud-enemy-nation').textContent = NATIONS[world.sides[1].nation].name;
}

export function setPauseLabel(paused) {
  $('btn-pause').innerHTML = paused ? '&#9654;' : '&#10074;&#10074;';
}

export function setSpeedLabel(speed) {
  $('btn-speed').textContent = speed + '×';
}

export function markFormation(f) {
  for (const btn of $('formation-buttons').querySelectorAll('button[data-formation]')) {
    btn.classList.toggle('active', btn.dataset.formation === f);
  }
}

let hudT = 0;

export function updateHud(world, selection) {
  const now = performance.now();
  if (now - hudT < 150) return;
  hudT = now;

  $('hud-player-count').textContent = world.sides[0].alive;
  $('hud-enemy-count').textContent = world.sides[1].alive;
  const t = world.time | 0;
  $('hud-timer').textContent = `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`;

  if (selection.length === 0) {
    $('sel-info').textContent = 'No troops selected — drag to select';
  } else {
    const byType = {};
    for (const u of selection) byType[u.type] = (byType[u.type] || 0) + 1;
    const parts = Object.entries(byType)
      .map(([type, n]) => `${n} ${UNIT_TYPES[type].label}`)
      .join(', ');
    $('sel-info').textContent = `${selection.length} selected: ${parts}`;
  }
}

export function showEnd(world) {
  const [p, e] = world.sides;
  const title = world.winner === 0 ? 'Victory!' : world.winner === 1 ? 'Defeat' : 'Mutual Ruin';
  $('end-title').textContent = title;

  let verdict;
  if (world.winner === 0) {
    const lossFrac = p.losses / p.start;
    verdict = lossFrac < 0.25 ? 'A crushing, decisive victory — the enemy is swept from the field.'
      : lossFrac < 0.55 ? 'A hard-fought victory. The field is yours.'
      : 'A pyrrhic victory — another such and you are undone.';
  } else if (world.winner === 1) {
    verdict = 'Your army breaks and streams to the rear. The day is lost.';
  } else {
    verdict = 'Both armies have destroyed each other utterly.';
  }
  $('end-verdict').textContent = verdict;

  const mins = (world.time / 60) | 0, secs = (world.time | 0) % 60;
  $('end-stats').innerHTML = `
    <span class="stat-label">Battle length</span><span class="stat-value">${mins}m ${String(secs).padStart(2, '0')}s</span>
    <span class="stat-label">${NATIONS[p.nation].name} losses</span><span class="stat-value">${p.losses} / ${p.start}</span>
    <span class="stat-label">${NATIONS[e.nation].name} losses</span><span class="stat-value">${e.losses} / ${e.start}</span>
    <span class="stat-label">Enemy soldiers felled</span><span class="stat-value">${p.kills}</span>
  `;
  $('overlay-end').classList.remove('hidden');
}

export function showStartMenu() {
  $('overlay-end').classList.add('hidden');
  $('overlay-start').classList.remove('hidden');
}
