import {
  STATION_CONSTRUCTOR_TYPE, STATION_TYPE, TRACK_LENGTH, TRACK_TYPE, trackEndpoints,
} from '../railways.js';

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashUnit(seed) {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

function nightAmount(worldTime = 0) {
  return clamp01(0.48 + Math.sin((worldTime || 0) * 0.035 - 1.15) * 0.42);
}

function ellipse(ctx, x, y, rx, ry, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function roundedRect(ctx, x, y, w, h, r, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function line(ctx, x0, y0, x1, y1, stroke, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

function fillRadial(ctx, x, y, inner, outer, stops, scaleY = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, scaleY);
  const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function lightCone(ctx, x, y, length, halfWidth, colorNear, colorFar) {
  const grad = ctx.createLinearGradient(x, y, x + length, y);
  grad.addColorStop(0, colorNear);
  grad.addColorStop(1, colorFar);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x + length, y - halfWidth);
  ctx.lineTo(x + length, y + halfWidth);
  ctx.lineTo(x, y + 5);
  ctx.closePath();
  ctx.fill();
}

function metalGradient(ctx, x, y, w, h, dark = '#242323', mid = '#85827b', light = '#e3dac5') {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, light);
  grad.addColorStop(0.18, mid);
  grad.addColorStop(0.55, dark);
  grad.addColorStop(0.78, '#151515');
  grad.addColorStop(1, mid);
  return grad;
}

function crimsonGradient(ctx, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#b7352c');
  grad.addColorStop(0.28, '#7d1b1a');
  grad.addColorStop(0.58, '#a72921');
  grad.addColorStop(1, '#37100f');
  return grad;
}

function drawRivets(ctx, x0, x1, y, spacing = 8, radius = 1.1) {
  ctx.fillStyle = 'rgba(244,205,111,.82)';
  ctx.strokeStyle = 'rgba(70,41,17,.45)';
  ctx.lineWidth = 0.45;
  for (let x = x0; x <= x1; x += spacing) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
}

function drawDustMotes(ctx, seed, worldTime, bounds, tint = '255,226,156', count = 34) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < count; i += 1) {
    const px = bounds.x + hashUnit(seed + i * 9.7) * bounds.w;
    const baseY = bounds.y + hashUnit(seed + i * 13.3) * bounds.h;
    const drift = Math.sin(worldTime * (0.34 + hashUnit(seed + i) * 0.18) + i) * 6;
    const pulse = 0.45 + Math.sin(worldTime * 1.2 + i * 2.4) * 0.35;
    const alpha = (0.025 + hashUnit(seed + i * 3.1) * 0.055) * pulse;
    ellipse(ctx, px + drift, baseY - (worldTime * (1.5 + hashUnit(seed + i * 4)) % 24), 1.2, 0.75,
      `rgba(${tint},${alpha})`);
  }
  ctx.restore();
}

function drawGroundFog(ctx, seed, worldTime, x, y, w, h, intensity = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 9; i += 1) {
    const u = hashUnit(seed + i * 4.7);
    const drift = (worldTime * (7 + i * 0.8) + u * 80) % (w + 70);
    const alpha = (0.035 + u * 0.025) * intensity;
    ellipse(ctx, x - 35 + drift, y + hashUnit(seed + i * 8.2) * h, 38 + u * 28, 7 + u * 6,
      `rgba(206,219,218,${alpha})`);
  }
  ctx.restore();
}

function drawLanternPool(ctx, x, y, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  fillRadial(ctx, x, y, 3, 64 * strength, [
    [0, 'rgba(255,215,126,.28)'],
    [0.42, 'rgba(255,185,82,.11)'],
    [1, 'rgba(255,185,82,0)'],
  ], 0.45);
  ctx.restore();
}

function drawCanopyRay(ctx, x0, y0, x1, y1, width, phase, alpha) {
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, `rgba(255,229,163,${alpha})`);
  grad.addColorStop(0.55, `rgba(255,206,113,${alpha * 0.35})`);
  grad.addColorStop(1, 'rgba(255,206,113,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x0 - width * 0.22, y0);
  ctx.lineTo(x0 + width * 0.22, y0);
  ctx.lineTo(x1 + Math.sin(phase) * 9 + width, y1);
  ctx.lineTo(x1 + Math.sin(phase) * 9 - width, y1);
  ctx.closePath();
  ctx.fill();
}

function drawWeatheredPanel(ctx, x, y, w, h, color) {
  roundedRect(ctx, x, y, w, h, 3, color, 'rgba(28,13,10,.72)', 1.1);
  const grime = ctx.createLinearGradient(x, y, x, y + h);
  grime.addColorStop(0, 'rgba(255,236,174,.18)');
  grime.addColorStop(0.62, 'rgba(0,0,0,.08)');
  grime.addColorStop(1, 'rgba(24,12,8,.25)');
  ctx.fillStyle = grime;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(255,226,134,.26)';
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
}

function brickWall(ctx, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#7f2b24');
  grad.addColorStop(0.24, '#b64b38');
  grad.addColorStop(0.58, '#93342b');
  grad.addColorStop(1, '#54201c');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(41,17,13,.55)';
  ctx.lineWidth = 0.75;
  const course = 6;
  for (let yy = y + course; yy < y + h; yy += course) line(ctx, x, yy, x + w, yy, ctx.strokeStyle, 0.75);
  for (let row = 0, yy = y; yy < y + h; row++, yy += course) {
    const offset = row % 2 ? 9 : 0;
    for (let xx = x - offset; xx < x + w; xx += 18) {
      line(ctx, xx, yy, xx, Math.min(y + h, yy + course), 'rgba(48,20,14,.48)', 0.65);
    }
  }
  ctx.strokeStyle = 'rgba(255,224,180,.24)';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function archedWindow(ctx, x, y, w, h) {
  const glass = ctx.createLinearGradient(x, y, x + w, y + h);
  glass.addColorStop(0, '#f2ecd0');
  glass.addColorStop(0.42, '#9bb0a9');
  glass.addColorStop(1, '#273737');
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + w * 0.5);
  ctx.quadraticCurveTo(x + w * 0.5, y - w * 0.18, x + w, y + w * 0.5);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.strokeStyle = '#3b3028';
  ctx.lineWidth = 1;
  ctx.stroke();
  line(ctx, x + w * 0.5, y + 3, x + w * 0.5, y + h, 'rgba(40,35,30,.72)', 0.75);
  line(ctx, x + 3, y + h * 0.56, x + w - 3, y + h * 0.56, 'rgba(40,35,30,.72)', 0.75);
}

function drawCanopy(ctx, x, y, w, depth) {
  const roof = ctx.createLinearGradient(x, y - 38, x + w, y + depth);
  roof.addColorStop(0, '#8c8c82');
  roof.addColorStop(0.18, '#4a5357');
  roof.addColorStop(0.58, '#252c30');
  roof.addColorStop(1, '#111719');
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x, y - 16);
  ctx.lineTo(x + w * 0.5, y - 48);
  ctx.lineTo(x + w, y - 16);
  ctx.lineTo(x + w - 25, y + depth);
  ctx.lineTo(x + 25, y + depth);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(237,226,190,.46)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  for (let i = 0; i <= 9; i += 1) {
    const t = i / 9;
    const sx = x + 24 + (w - 48) * t;
    const ribTop = y - 16 - Math.sin(t * Math.PI) * 20;
    line(ctx, sx, y + depth, sx + (0.5 - t) * 22, ribTop, '#171c1f', 2.1);
    ctx.beginPath();
    ctx.arc(sx, y + depth - 7, 7, Math.PI, TAU);
    ctx.strokeStyle = '#202629';
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }
  for (let i = 0; i < 7; i += 1) {
    const sx = x + 42 + i * ((w - 84) / 6);
    line(ctx, sx, y + depth, sx, y + depth + 40, '#1b2022', 2.2);
    line(ctx, sx - 9, y + depth + 13, sx + 9, y + depth + 13, 'rgba(226,208,156,.5)', 0.7);
  }
}

export function drawRailSegment(ctx, track, worldTime = 0) {
  if (!track?.alive) return;
  ctx.save();
  ctx.translate(track.x, track.y);
  ctx.rotate(track.rotation || 0);
  const half = TRACK_LENGTH * 0.5;
  const complete = track.complete !== false;
  const progress = complete ? 1 : clamp01(track.progress || 0.08);
  const night = nightAmount(worldTime);

  ctx.fillStyle = `rgba(8,6,6,${0.24 + night * 0.16})`;
  ctx.beginPath();
  ctx.moveTo(-half - 4, -18);
  ctx.lineTo(half + 4, -18);
  ctx.lineTo(half + 18, 21);
  ctx.lineTo(-half - 18, 21);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = 'screen';
  fillRadial(ctx, 0, 4, 3, 84, [
    [0, `rgba(102,132,156,${0.06 * night})`],
    [0.55, `rgba(74,99,128,${0.028 * night})`],
    [1, 'rgba(74,99,128,0)'],
  ], 0.24);
  ctx.globalCompositeOperation = 'source-over';

  const ballast = ctx.createLinearGradient(0, -18, 0, 18);
  ballast.addColorStop(0, '#8c8170');
  ballast.addColorStop(0.52, '#51483e');
  ballast.addColorStop(1, '#302b26');
  ctx.fillStyle = ballast;
  ctx.beginPath();
  ctx.moveTo(-half - 2, -14);
  ctx.lineTo(half + 2, -14);
  ctx.lineTo(half + 10, 14);
  ctx.lineTo(-half - 10, 14);
  ctx.closePath();
  ctx.fill();

  for (let x = -half + 4; x <= half - 4; x += 10.7) {
    const tieShade = ((Math.abs(Math.round(x)) * 37 + (track.id || 0)) % 5) * 5;
    ctx.fillStyle = `rgb(${82 + tieShade},${55 + tieShade * 0.5},${34 + tieShade * 0.25})`;
    roundedRect(ctx, x - 2.8, -15, 5.8, 30, 1.2, ctx.fillStyle, 'rgba(25,15,8,.48)', 0.35);
    line(ctx, x - 2.1, -10, x + 2.1, -12, 'rgba(255,225,170,.17)', 0.55);
  }

  for (const y of [-7, 7]) {
    line(ctx, -half, y + 2.2, half * progress, y + 2.2, 'rgba(18,16,14,.72)', 5.2);
    ctx.strokeStyle = metalGradient(ctx, 0, y - 3, 0, 7);
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(-half + TRACK_LENGTH * progress, y);
    ctx.stroke();
    line(ctx, -half, y - 2.3, -half + TRACK_LENGTH * progress, y - 2.3, 'rgba(255,244,211,.58)', 0.85);
    line(ctx, -half, y - 4.3, -half + TRACK_LENGTH * progress, y - 4.3,
      `rgba(178,214,255,${0.09 + night * 0.18})`, 0.65);
  }

  ctx.fillStyle = 'rgba(30,22,15,.5)';
  for (let x = -half + 6; x <= -half + TRACK_LENGTH * progress - 2; x += 10.7) {
    for (const y of [-7, 7]) {
      ellipse(ctx, x - 2.2, y, 1.2, 0.9, '#22201f');
      ellipse(ctx, x + 2.2, y, 1.2, 0.9, '#22201f');
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 12; i += 1) {
    const seed = (track.id || 0) * 17 + i * 11;
    const x = -half + hashUnit(seed) * TRACK_LENGTH * progress;
    const y = -13 + hashUnit(seed + 2.1) * 26;
    const flicker = 0.55 + Math.sin(worldTime * 2.4 + i) * 0.35;
    ellipse(ctx, x + Math.sin(worldTime + i) * 1.8, y, 0.9, 0.55,
      `rgba(214,226,220,${(0.018 + night * 0.022) * flicker})`);
  }
  ctx.restore();
  ctx.restore();
}

function drawPlatformTiles(ctx, x, y, w, h) {
  const stone = ctx.createLinearGradient(x, y, x, y + h);
  stone.addColorStop(0, '#c5b99c');
  stone.addColorStop(1, '#786b55');
  ctx.fillStyle = stone;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(53,42,30,.55)';
  ctx.lineWidth = 0.8;
  for (let xx = x + 12; xx < x + w; xx += 24) line(ctx, xx, y, xx - 8, y + h, ctx.strokeStyle, 0.7);
  for (let yy = y + 7; yy < y + h; yy += 10) line(ctx, x, yy, x + w, yy, 'rgba(41,35,27,.42)', 0.7);
  line(ctx, x, y, x + w, y, 'rgba(255,240,190,.44)', 1.1);
}

function drawLamp(ctx, x, y, worldTime) {
  line(ctx, x, y, x, y - 64, '#1d2224', 2.1);
  line(ctx, x - 8, y - 43, x + 8, y - 43, '#1d2224', 1.1);
  const glow = 0.68 + Math.sin(worldTime * 2.1 + x) * 0.08;
  drawLanternPool(ctx, x, y - 28, 0.86 + nightAmount(worldTime) * 0.44);
  ellipse(ctx, x, y - 68, 7, 9, `rgba(255,224,138,${glow})`, '#5a421d', 1);
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, x, y - 68, 29, 23, `rgba(255,212,104,${0.12 + nightAmount(worldTime) * 0.1})`);
  ellipse(ctx, x, y - 58, 18, 40, `rgba(255,188,85,${0.045 + nightAmount(worldTime) * 0.045})`);
  ctx.globalCompositeOperation = 'source-over';
}

function drawLuggage(ctx, x, y) {
  roundedRect(ctx, x, y, 15, 11, 2, '#6d3b1e', 'rgba(22,12,6,.65)', 0.8);
  roundedRect(ctx, x + 18, y - 5, 18, 15, 2, '#4d2a19', 'rgba(22,12,6,.65)', 0.8);
  line(ctx, x + 22, y - 5, x + 22, y + 10, 'rgba(230,174,92,.48)', 0.8);
  line(ctx, x + 31, y - 5, x + 31, y + 10, 'rgba(230,174,92,.48)', 0.8);
}

export function drawHogwartsStation(ctx, station, worldTime = 0) {
  if (!station?.alive) return;
  ctx.save();
  ctx.translate(station.x, station.y);
  ctx.rotate(station.rotation || 0);
  const night = nightAmount(worldTime);
  ellipse(ctx, 8, 68, 191, 49, `rgba(10,8,8,${0.28 + night * 0.15})`);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  fillRadial(ctx, 15, -34, 12, 260, [
    [0, `rgba(67,96,135,${0.12 * night})`],
    [0.54, `rgba(62,87,122,${0.052 * night})`],
    [1, 'rgba(62,87,122,0)'],
  ], 0.36);
  fillRadial(ctx, -112, 30, 2, 72, [
    [0, `rgba(255,195,83,${0.12 + night * 0.18})`],
    [0.52, `rgba(255,176,70,${0.045 + night * 0.07})`],
    [1, 'rgba(255,176,70,0)'],
  ], 0.35);
  fillRadial(ctx, 111, 30, 2, 78, [
    [0, `rgba(255,195,83,${0.11 + night * 0.17})`],
    [0.52, `rgba(255,176,70,${0.04 + night * 0.07})`],
    [1, 'rgba(255,176,70,0)'],
  ], 0.35);
  ctx.restore();
  drawGroundFog(ctx, (station.id || 0) * 21, worldTime, -183, 51, 382, 31, 0.78 + night * 0.75);
  drawPlatformTiles(ctx, -170, 27, 354, 34);
  drawPlatformTiles(ctx, -164, 62, 344, 11);

  brickWall(ctx, -130, -72, 114, 87);
  brickWall(ctx, 28, -58, 86, 69);
  ctx.fillStyle = '#d2c0a0';
  ctx.fillRect(-133, -76, 120, 6);
  ctx.fillRect(25, -62, 92, 6);
  ctx.fillStyle = '#6d4c35';
  ctx.fillRect(-43, -20, 28, 36);
  ctx.strokeStyle = 'rgba(245,213,144,.38)';
  ctx.strokeRect(-39, -15, 20, 29);
  archedWindow(ctx, -108, -50, 20, 34);
  archedWindow(ctx, -74, -50, 20, 34);
  archedWindow(ctx, 48, -40, 16, 28);
  archedWindow(ctx, 78, -40, 16, 28);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const [i, x] of [-118, -64, -3, 56, 116].entries()) {
    drawCanopyRay(ctx, x, -32, x + 28, 72, 17 + i * 2, worldTime * 0.7 + i,
      (0.022 + night * 0.047) * (0.8 + Math.sin(worldTime + i) * 0.16));
  }
  ctx.restore();
  drawCanopy(ctx, -155, -20, 326, 52);

  roundedRect(ctx, -33, -80, 91, 20, 2, '#221f1b', '#d6b45c', 1.2);
  ctx.fillStyle = '#f5e6b4';
  ctx.font = 'bold 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('HOGWARTS EXPRESS', 12, -67);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, 12, -69, 74, 16, `rgba(255,213,103,${0.045 + night * 0.055})`);
  drawDustMotes(ctx, (station.id || 0) * 31 + 7, worldTime, { x: -35, y: -91, w: 96, h: 31 },
    '255,213,112', 20);
  ctx.restore();
  roundedRect(ctx, 92, -78, 40, 18, 2, '#3b1715', '#d6b45c', 1);
  ctx.fillStyle = '#f5e6b4';
  ctx.font = 'bold 8px Georgia, serif';
  ctx.fillText('PLAT. 9 3/4', 112, -66);

  roundedRect(ctx, -3, -38, 25, 25, 2, '#1f2528', '#c9b071', 1);
  ctx.fillStyle = '#f3e7bd';
  ctx.font = 'bold 9px Georgia, serif';
  ctx.fillText('XII', 9.5, -22);
  ellipse(ctx, 9.5, -25, 9, 9, 'rgba(246,230,174,.22)', '#d0ba7a', 0.8);

  for (const x of [-137, -83, -28, 43, 103, 151]) drawLamp(ctx, x, 35, worldTime);
  drawDustMotes(ctx, (station.id || 0) * 17, worldTime, { x: -162, y: -22, w: 333, h: 90 },
    '255,224,164', 46);
  ctx.fillStyle = '#4b2e22';
  for (const x of [-116, -55, 62]) {
    roundedRect(ctx, x, 17, 38, 7, 2, '#533321', 'rgba(24,13,8,.7)', 0.8);
    ctx.fillStyle = '#2a1b12';
    ctx.fillRect(x + 4, 24, 4, 10);
    ctx.fillRect(x + 30, 24, 4, 10);
  }
  drawLuggage(ctx, -146, 48);
  drawLuggage(ctx, 116, 47);
  line(ctx, 128, 44, 151, 40, '#2c2925', 1.2);
  ellipse(ctx, 126, 47, 3, 3, '#1b1714');
  ellipse(ctx, 152, 42, 3, 3, '#1b1714');
  ctx.restore();
}

export function drawStationConstructor(ctx, building, worldTime = 0) {
  ctx.save();
  ctx.translate(building.x, building.y);
  ctx.rotate(building.rotation || 0);
  const pulse = 0.5 + Math.sin(worldTime * 5) * 0.5;
  ellipse(ctx, 0, 10, 34, 14, 'rgba(35,25,18,.24)');
  roundedRect(ctx, -21, -22, 42, 31, 3, '#253a57', '#d7b64b', 2);
  roundedRect(ctx, -14, -15, 28, 19, 1.5, '#eadca9', '#6b4d2c', 0.9);
  line(ctx, -10, -9, 10, -9, '#33547e', 0.8);
  line(ctx, -10, -4, 10, -4, '#33547e', 0.8);
  line(ctx, -6, -14, -6, 4, '#b44735', 0.8);
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, 0, -8, 26 + pulse * 8, 18 + pulse * 4, `rgba(107,158,255,${0.18 + pulse * 0.14})`);
  ctx.restore();
}

function drawWheel(ctx, x, y, r, phase, powered = false) {
  ellipse(ctx, x, y, r + 1.8, r * 0.78 + 1.3, '#080808', '#2e2925', 1);
  ellipse(ctx, x, y, r, r * 0.72, metalGradient(ctx, x - r, y - r, r * 2, r * 2), '#070707', 1);
  for (let i = 0; i < 8; i += 1) {
    const a = phase + i * TAU / 8;
    line(ctx, x, y, x + Math.cos(a) * r * 0.82, y + Math.sin(a) * r * 0.58, '#121212', powered ? 1.2 : 0.8);
  }
  ellipse(ctx, x, y, r * 0.22, r * 0.16, '#d0a64f', '#37230e', 0.8);
}

function drawConnectingRods(ctx, wheels, phase) {
  const crank = wheels.map(([x, y, r]) => ({
    x: x + Math.cos(phase) * r * 0.62,
    y: y + Math.sin(phase) * r * 0.42,
  }));
  if (crank.length < 2) return;
  line(ctx, crank[0].x, crank[0].y, crank[1].x, crank[1].y, '#d5c7a4', 2.4);
  line(ctx, crank[1].x, crank[1].y, crank[2]?.x ?? crank[1].x + 30, crank[2]?.y ?? crank[1].y, '#b9a47e', 2);
  line(ctx, crank[0].x - 35, crank[0].y - 3, crank[0].x, crank[0].y, '#c7b58d', 1.6);
}

function drawLocomotive(ctx, offset, phase, speed) {
  ctx.save();
  ctx.translate(offset, 0);
  ellipse(ctx, -20, 9, 52, 14, 'rgba(12,8,6,.23)');
  roundedRect(ctx, -50, -26, 40, 31, 3, crimsonGradient(ctx, -50, -26, 40, 31), '#1b0b09', 1.2);
  roundedRect(ctx, -14, -32, 58, 24, 12, crimsonGradient(ctx, -14, -32, 58, 24), '#1b0b09', 1.2);
  roundedRect(ctx, 25, -36, 24, 23, 3, '#171819', '#605547', 1);
  roundedRect(ctx, 39, -44, 10, 13, 2, '#101010', '#625747', 1);
  roundedRect(ctx, -4, -45, 15, 12, 7, '#a82420', '#d3b45c', 1);
  roundedRect(ctx, -32, -43, 18, 12, 6, '#81231f', '#d3b45c', 1);
  roundedRect(ctx, -56, -18, 14, 16, 2, '#1b1b1b', '#4c4236', 0.8);
  roundedRect(ctx, 42, -15, 13, 10, 2, '#161616', '#6f614e', 0.8);
  line(ctx, -57, -2, 59, -2, '#d4ad4c', 1.4);
  line(ctx, -51, -24, 42, -15, 'rgba(255,221,128,.25)', 1);
  drawRivets(ctx, -47, 39, -6, 7, 1);
  roundedRect(ctx, -47, -20, 21, 8, 1.5, '#d5aa49', '#4a2e0f', 0.6);
  ctx.fillStyle = '#42110f';
  ctx.font = 'bold 4.8px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('HOGWARTS', -36.5, -14);
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, 55, -13, 10 + speed * 0.03, 6, 'rgba(255,231,144,.22)');
  ctx.globalCompositeOperation = 'source-over';
  const wheels = [[-37, 5, 8.5], [-12, 6, 10], [17, 6, 10]];
  for (const wheel of wheels) drawWheel(ctx, wheel[0], wheel[1], wheel[2], phase, true);
  drawWheel(ctx, 42, 4, 6, phase * 1.35);
  drawConnectingRods(ctx, wheels, phase);
  ctx.restore();
}

function drawTender(ctx, offset, phase) {
  ctx.save();
  ctx.translate(offset, 0);
  ellipse(ctx, -2, 9, 36, 12, 'rgba(12,8,6,.2)');
  drawWeatheredPanel(ctx, -30, -25, 60, 28, '#342923');
  roundedRect(ctx, -25, -28, 50, 9, 2, crimsonGradient(ctx, -25, -28, 50, 9), '#1b0b09', 1);
  ctx.fillStyle = '#100f0f';
  for (let x = -19; x <= 15; x += 8) ellipse(ctx, x, -18, 5, 2, '#111');
  line(ctx, -28, -4, 28, -4, '#d4ad4c', 1.1);
  drawRivets(ctx, -23, 23, -9, 8, 0.9);
  drawWheel(ctx, -17, 5, 7, phase);
  drawWheel(ctx, 18, 5, 7, phase);
  ctx.restore();
}

function drawCoach(ctx, offset, phase, index) {
  ctx.save();
  ctx.translate(offset, 0);
  ellipse(ctx, -2, 10, 42, 12, 'rgba(12,8,6,.2)');
  roundedRect(ctx, -38, -29, 76, 28, 5, crimsonGradient(ctx, -38, -29, 76, 28), '#1b0b09', 1.2);
  const roof = ctx.createLinearGradient(0, -38, 0, -25);
  roof.addColorStop(0, '#232323');
  roof.addColorStop(1, '#4e4740');
  roundedRect(ctx, -36, -38, 72, 13, 7, roof, '#1b1715', 1);
  for (let x = -27; x <= 19; x += 16) {
    const glass = ctx.createLinearGradient(x, -23, x + 10, -12);
    glass.addColorStop(0, '#f5e7b8');
    glass.addColorStop(0.5, '#a7b8ad');
    glass.addColorStop(1, '#2f3c3c');
    roundedRect(ctx, x, -23, 10, 11, 1.5, glass, '#34251d', 0.8);
  }
  line(ctx, -34, -8, 34, -8, '#d4ad4c', 1.2);
  ctx.fillStyle = '#d8b65c';
  ctx.font = 'bold 4.5px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText(index === 0 ? 'HOGWARTS EXPRESS' : 'HOGWARTS', 0, -4);
  drawRivets(ctx, -31, 31, -9, 8, 0.8);
  drawWheel(ctx, -24, 5, 7, phase);
  drawWheel(ctx, 25, 5, 7, phase);
  ctx.restore();
}

function drawSteam(ctx, train, worldTime, chimneyX) {
  const speed = Math.max(0, train.visualSpeed || 0);
  const intensity = 0.42 + Math.min(1.45, speed / 42);
  const baseX = Number.isFinite(chimneyX) ? chimneyX : 132;
  const baseY = -50;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 14; i += 1) {
    const layer = i < 6 ? 0 : 1;
    const drift = (worldTime * (11 + i * 2.8) + (train.id || 0) * 7 + i * 19) % (72 + layer * 22);
    const rise = drift * (0.7 + i * 0.018);
    const wind = drift * (0.3 + speed * 0.004);
    const x = baseX - wind - i * 1.65 + Math.sin(worldTime * 1.25 + i) * (3.2 + layer * 2.5);
    const y = baseY - rise;
    const fade = Math.max(0, 1 - drift / (82 + layer * 22));
    const alpha = fade * (layer ? 0.07 : 0.13) * intensity;
    ellipse(ctx, x, y, (10 + i * 1.1 + drift * 0.23) * intensity, 5 + i * 0.7 + drift * 0.12,
      `rgba(226,228,215,${alpha})`);
    ellipse(ctx, x + 3, y + 2, (6 + drift * 0.14) * intensity, 3.4 + drift * 0.055,
      `rgba(255,235,182,${alpha * 0.18})`);
  }
  ctx.restore();
}

function drawCylinderSteam(ctx, train, worldTime, locomotiveOffset) {
  const speed = Math.max(0, train.visualSpeed || 0);
  const intensity = 0.42 + Math.min(1, speed / 56);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 8; i += 1) {
    const burst = (worldTime * (21 + i * 1.7) + i * 15 + (train.id || 0)) % 58;
    const side = i % 2 ? 1 : -1;
    const x = locomotiveOffset + 14 - burst * (0.52 + speed * 0.005);
    const y = 7 + side * (7 + hashUnit(i + train.id) * 4) - burst * 0.04;
    const alpha = Math.max(0, (1 - burst / 58) * 0.14 * intensity);
    ellipse(ctx, x, y, 12 + burst * 0.18, 3.6 + burst * 0.035,
      `rgba(225,228,218,${alpha})`);
  }
  ctx.restore();
}

function drawWheelAshAndSparks(ctx, train, worldTime, locomotiveOffset) {
  const speed = Math.max(0, train.visualSpeed || 0);
  const active = clamp01(speed / 46);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 18; i += 1) {
    const seed = (train.id || 0) * 23 + i * 9;
    const drift = (worldTime * (22 + hashUnit(seed) * 18) + i * 12) % 74;
    const x = locomotiveOffset - 40 + hashUnit(seed + 3) * 100 - drift * 0.35;
    const y = 14 + hashUnit(seed + 7) * 12 - drift * 0.025;
    const alpha = (1 - drift / 80) * active * (0.025 + hashUnit(seed + 5) * 0.045);
    ellipse(ctx, x, y, 9 + drift * 0.13, 2.2 + drift * 0.025,
      `rgba(194,166,119,${alpha})`);
  }
  for (let i = 0; i < 10; i += 1) {
    const seed = (train.id || 0) * 41 + i * 13;
    const life = (worldTime * (7 + hashUnit(seed) * 7) + i * 8) % 36;
    const flicker = Math.max(0, 1 - life / 36) * active;
    const x = locomotiveOffset - 35 + hashUnit(seed + 2) * 95 - life * 0.45;
    const y = -1 + hashUnit(seed + 4) * 18 + life * 0.16;
    ellipse(ctx, x, y, 1.2 + flicker * 1.5, 0.8 + flicker,
      `rgba(255,129,42,${flicker * 0.34})`);
    ellipse(ctx, x, y, 0.55, 0.38, `rgba(255,225,125,${flicker * 0.44})`);
  }
  ctx.restore();
}

function drawHeadlampBeam(ctx, train, locomotiveOffset, worldTime) {
  const night = nightAmount(worldTime);
  const speed = Math.max(0, train.visualSpeed || 0);
  const strength = 0.16 + night * 0.23 + Math.min(0.06, speed * 0.0011);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  lightCone(ctx, locomotiveOffset + 55, -13, 190, 34,
    `rgba(255,226,142,${strength})`, 'rgba(255,226,142,0)');
  lightCone(ctx, locomotiveOffset + 60, -13, 120, 16,
    `rgba(255,248,202,${strength * 0.7})`, 'rgba(255,248,202,0)');
  for (let i = 0; i < 18; i += 1) {
    const seed = (train.id || 0) * 59 + i * 5.6;
    const x = locomotiveOffset + 72 + hashUnit(seed) * 152;
    const spread = (x - locomotiveOffset - 72) / 152;
    const y = -13 + (hashUnit(seed + 2) - 0.5) * (12 + spread * 52);
    const shimmer = 0.55 + Math.sin(worldTime * 2 + i) * 0.32;
    ellipse(ctx, x, y, 1.2 + spread * 1.7, 0.7 + spread,
      `rgba(255,231,166,${strength * 0.18 * shimmer})`);
  }
  ctx.restore();
}

export function drawHogwartsTrain(ctx, train, worldTime = 0) {
  if (!train) return;
  ctx.save();
  ctx.translate(train.x, train.y);
  ctx.rotate(train.rotation || 0);
  const phase = (Number(train.distanceTravelled) || 0) / 9.4;
  const night = nightAmount(worldTime);
  ellipse(ctx, 4, 18, 169, 23, `rgba(5,4,4,${0.3 + night * 0.16})`);
  const carriages = train.carriages || [];
  const locomotive = carriages.find(carriage => carriage.role === 'locomotive');
  const locomotiveOffset = locomotive?.offset ?? 94;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, -5, -14, 168, 33, `rgba(93,133,174,${0.028 + night * 0.04})`);
  ellipse(ctx, 23, -35, 116, 22, `rgba(255,193,88,${0.022 + night * 0.028})`);
  ctx.restore();
  drawHeadlampBeam(ctx, train, locomotiveOffset, worldTime);
  drawWheelAshAndSparks(ctx, train, worldTime, locomotiveOffset);
  drawCylinderSteam(ctx, train, worldTime, locomotiveOffset);
  drawSteam(ctx, train, worldTime, locomotiveOffset + 39);
  for (let i = carriages.length - 1; i >= 0; i -= 1) {
    const carriage = carriages[i];
    if (carriage.role === 'locomotive') drawLocomotive(ctx, carriage.offset, phase, train.visualSpeed || 0);
    else if (carriage.role === 'tender') drawTender(ctx, carriage.offset, phase);
    else drawCoach(ctx, carriage.offset, phase, i);
    if (i > 0) line(ctx, carriage.offset - 37, -2, carriages[i - 1].offset + 36, -2, '#1c1714', 2);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  line(ctx, -126, -39, locomotiveOffset + 56, -20, `rgba(178,215,255,${0.09 + night * 0.1})`, 1.3);
  line(ctx, -124, -28, locomotiveOffset + 44, -4, `rgba(255,215,128,${0.045 + night * 0.055})`, 0.9);
  ctx.restore();
  ctx.restore();
}

export function drawRailwayEntity(ctx, entity, worldTime = 0) {
  if (entity.type === TRACK_TYPE) drawRailSegment(ctx, entity, worldTime);
  else if (entity.type === STATION_TYPE) drawHogwartsStation(ctx, entity, worldTime);
  else if (entity.type === STATION_CONSTRUCTOR_TYPE) drawStationConstructor(ctx, entity, worldTime);
}
