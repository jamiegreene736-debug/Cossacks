import { STATION_CONSTRUCTOR_TYPE, STATION_TYPE, TRACK_TYPE, trackEndpoints } from '../railways.js';

function ellipse(ctx, x, y, rx, ry, fill, stroke = null, width = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function brickWall(ctx, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#8d3029');
  grad.addColorStop(0.46, '#b44b38');
  grad.addColorStop(1, '#62241f');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(42,19,15,.52)';
  ctx.lineWidth = 0.8;
  const course = 7;
  for (let yy = y + course; yy < y + h; yy += course) {
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
  }
  for (let row = 0, yy = y; yy < y + h; row++, yy += course) {
    const offset = row % 2 ? 10 : 0;
    for (let xx = x - offset; xx < x + w; xx += 20) {
      ctx.beginPath();
      ctx.moveTo(xx, yy);
      ctx.lineTo(xx, Math.min(y + h, yy + course));
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(255,224,180,.25)';
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawCanopy(ctx, x, y, w, depth) {
  const iron = '#252a2b';
  const roof = ctx.createLinearGradient(x, y - 30, x + w, y + depth);
  roof.addColorStop(0, '#596067');
  roof.addColorStop(0.48, '#2d3338');
  roof.addColorStop(1, '#171d20');
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x, y - 18);
  ctx.lineTo(x + w * 0.5, y - 42);
  ctx.lineTo(x + w, y - 18);
  ctx.lineTo(x + w - 26, y + depth);
  ctx.lineTo(x + 26, y + depth);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(236,226,190,.42)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.strokeStyle = iron;
  ctx.lineWidth = 2.2;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const sx = x + 28 + (w - 56) * t;
    ctx.beginPath();
    ctx.moveTo(sx, y + depth);
    ctx.lineTo(sx + (0.5 - t) * 18, y - 14 - Math.sin(t * Math.PI) * 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, y + depth - 4, 5, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawRailSegment(ctx, track) {
  if (!track?.alive) return;
  ctx.save();
  ctx.translate(track.x, track.y);
  ctx.rotate(track.rotation || 0);
  ctx.fillStyle = 'rgba(26,22,18,.22)';
  ctx.fillRect(-58, -13, 116, 26);
  ctx.strokeStyle = '#3a332b';
  ctx.lineWidth = 4;
  for (const y of [-6, 6]) {
    ctx.beginPath();
    ctx.moveTo(-48, y);
    ctx.lineTo(48, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#9a8670';
  ctx.lineWidth = 1.2;
  for (let x = -42; x <= 42; x += 12) {
    ctx.beginPath();
    ctx.moveTo(x, -11);
    ctx.lineTo(x, 11);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(230,220,190,.38)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-48, -7.8);
  ctx.lineTo(48, -7.8);
  ctx.stroke();
  ctx.restore();
}

export function drawHogwartsStation(ctx, station) {
  if (!station?.alive) return;
  ctx.save();
  ctx.translate(station.x, station.y);
  ctx.rotate(station.rotation || 0);
  ellipse(ctx, 10, 58, 168, 40, 'rgba(21,17,13,.24)');
  ctx.fillStyle = '#7d6c58';
  ctx.fillRect(-154, 36, 324, 24);
  ctx.fillStyle = '#b8a98c';
  ctx.fillRect(-154, 28, 324, 10);
  ctx.strokeStyle = 'rgba(53,42,30,.55)';
  ctx.lineWidth = 1;
  for (let x = -148; x < 164; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, 29);
    ctx.lineTo(x + 9, 59);
    ctx.stroke();
  }
  brickWall(ctx, -118, -62, 104, 76);
  brickWall(ctx, 24, -52, 72, 60);
  drawCanopy(ctx, -144, -18, 298, 48);
  ctx.fillStyle = '#e8dec2';
  ctx.fillRect(-96, -42, 20, 30);
  ctx.fillRect(-62, -42, 20, 30);
  ctx.fillRect(44, -36, 16, 24);
  ctx.strokeStyle = '#3c3128';
  ctx.lineWidth = 1;
  for (const x of [-96, -62, 44]) {
    ctx.strokeRect(x, x === 44 ? -36 : -42, x === 44 ? 16 : 20, x === 44 ? 24 : 30);
  }
  ctx.fillStyle = '#2c2721';
  ctx.fillRect(-18, -70, 70, 18);
  ctx.strokeStyle = '#d8b65c';
  ctx.strokeRect(-18, -70, 70, 18);
  ctx.fillStyle = '#f4e7b9';
  ctx.font = 'bold 10px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('HOGWARTS', 17, -57);
  for (const x of [-130, 136]) {
    ctx.strokeStyle = '#202427';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 34);
    ctx.lineTo(x, -34);
    ctx.stroke();
    ellipse(ctx, x, -39, 6, 8, 'rgba(255,220,128,.72)', '#57411c', 1);
  }
  ctx.fillStyle = '#4b2e22';
  for (const x of [-92, -36, 72]) {
    ctx.fillRect(x, 18, 34, 7);
    ctx.fillRect(x + 3, 25, 3, 9);
    ctx.fillRect(x + 28, 25, 3, 9);
  }
  ctx.restore();
}

export function drawStationConstructor(ctx, building, worldTime = 0) {
  ctx.save();
  ctx.translate(building.x, building.y);
  ctx.rotate(building.rotation || 0);
  const pulse = 0.5 + Math.sin(worldTime * 5) * 0.5;
  ellipse(ctx, 0, 10, 34, 14, 'rgba(35,25,18,.24)');
  ctx.fillStyle = '#253a57';
  ctx.fillRect(-18, -20, 36, 28);
  ctx.strokeStyle = '#d7b64b';
  ctx.lineWidth = 2;
  ctx.strokeRect(-18, -20, 36, 28);
  ctx.fillStyle = '#eadca9';
  ctx.fillRect(-12, -14, 24, 16);
  ctx.strokeStyle = '#6b4d2c';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-9, -8);
  ctx.lineTo(9, -8);
  ctx.moveTo(-9, -3);
  ctx.lineTo(9, -3);
  ctx.stroke();
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, 0, -8, 26 + pulse * 8, 18 + pulse * 4, `rgba(107,158,255,${0.18 + pulse * 0.14})`);
  ctx.restore();
}

function drawTrainCar(ctx, x, role) {
  if (role === 'locomotive') {
    ctx.fillStyle = '#7c1f1e';
    ctx.fillRect(x - 26, -26, 48, 28);
    ctx.fillStyle = '#1c1d1d';
    ctx.fillRect(x + 8, -44, 12, 18);
    ctx.fillRect(x - 18, -34, 18, 9);
    ctx.fillStyle = '#d1a848';
    ctx.fillRect(x - 20, -20, 20, 8);
  } else if (role === 'tender') {
    ctx.fillStyle = '#2b2420';
    ctx.fillRect(x - 24, -22, 46, 23);
    ctx.fillStyle = '#7c1f1e';
    ctx.fillRect(x - 20, -26, 38, 7);
  } else {
    ctx.fillStyle = '#8c2522';
    ctx.fillRect(x - 30, -24, 58, 25);
    ctx.fillStyle = '#d1a848';
    for (let wx = x - 22; wx <= x + 16; wx += 14) ctx.fillRect(wx, -18, 8, 9);
  }
  ctx.strokeStyle = '#1b1715';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x - (role === 'coach' ? 30 : 26), role === 'locomotive' ? -26 : -24, role === 'coach' ? 58 : 48, role === 'coach' ? 25 : 26);
  ctx.fillStyle = '#161412';
  ellipse(ctx, x - 16, 4, 5, 5, '#161412');
  ellipse(ctx, x + 16, 4, 5, 5, '#161412');
}

export function drawHogwartsTrain(ctx, train, worldTime = 0) {
  if (!train) return;
  ctx.save();
  ctx.translate(train.x, train.y);
  ctx.rotate(train.rotation || 0);
  ellipse(ctx, 4, 15, 122, 18, 'rgba(18,14,11,.24)');
  for (const carriage of train.carriages || []) drawTrainCar(ctx, carriage.offset, carriage.role);
  const steam = Math.max(0, Math.sin(worldTime * 2.2));
  ctx.globalCompositeOperation = 'screen';
  ellipse(ctx, -104, -52 - steam * 5, 12 + steam * 6, 7 + steam * 4, `rgba(230,230,220,${0.16 + steam * 0.12})`);
  ctx.restore();
}

export function drawRailwayEntity(ctx, entity, worldTime = 0) {
  if (entity.type === TRACK_TYPE) drawRailSegment(ctx, entity);
  else if (entity.type === STATION_TYPE) drawHogwartsStation(ctx, entity);
  else if (entity.type === STATION_CONSTRUCTOR_TYPE) drawStationConstructor(ctx, entity, worldTime);
}
