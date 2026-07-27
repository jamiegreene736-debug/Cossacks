// Small, persistent collectibles fabricated by the 3D Printing Shop.
// They are deliberately drawn in world space so they inherit camera rotation
// and remain grounded beside their parent workshop.

import { getProductionArt } from './art-assets.js';

export const PRINTED_MODEL_SPRITES = Object.freeze({
  trex: Object.freeze({ frame: 0, width: 58, height: 54 }),
  stegosaurus: Object.freeze({ frame: 1, width: 58, height: 54 }),
  robot: Object.freeze({ frame: 2, width: 46, height: 58 }),
  rocket: Object.freeze({ frame: 3, width: 44, height: 60 }),
});

function ellipse(ctx, x, y, rx, ry, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function line(ctx, points, stroke, width) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawPedestal(ctx, color) {
  ellipse(ctx, 0, 4, 16, 7, 'rgba(20,18,15,.32)');
  ctx.fillStyle = '#817b70';
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(12, 0);
  ctx.lineTo(10, 5);
  ctx.lineTo(-10, 5);
  ctx.closePath();
  ctx.fill();
  ellipse(ctx, 0, 0, 12, 4, '#b8b1a4', '#514d47', 0.8);
  ellipse(ctx, 0, -0.5, 8, 2.2, color, 'rgba(255,255,255,.42)', 0.65);
}

function drawTrex(ctx, color) {
  const dark = '#59372f';
  line(ctx, [[-8, -5], [-11, -13], [-8, -20], [-2, -23], [5, -21], [9, -16]], color, 5.5);
  line(ctx, [[-7, -19], [-1, -21], [5, -19]], 'rgba(255,255,255,.34)', 1.2);
  line(ctx, [[-8, -18], [-17, -16], [-22, -12]], color, 3.6);
  line(ctx, [[-4, -9], [-7, -2]], dark, 2.8);
  line(ctx, [[3, -9], [7, -2]], dark, 2.8);
  line(ctx, [[-7, -2], [-10, -1]], '#25211f', 1.8);
  line(ctx, [[7, -2], [10, -1]], '#25211f', 1.8);
  line(ctx, [[0, -18], [6, -13]], dark, 2);
  ellipse(ctx, 9, -17, 6.5, 4.5, color, dark, 1);
  line(ctx, [[6, -16], [13, -15]], 'rgba(255,255,255,.30)', 0.9);
  ctx.fillStyle = '#f2e5cf';
  for (let index = 0; index < 4; index++) {
    ctx.beginPath();
    ctx.moveTo(7 + index * 2.2, -14.5);
    ctx.lineTo(8 + index * 2.2, -11.6);
    ctx.lineTo(9 + index * 2.2, -14.3);
    ctx.fill();
  }
  ellipse(ctx, 11, -18.5, 0.8, 0.8, '#f7d65d');
}

function drawStegosaurus(ctx, color) {
  const dark = '#355943';
  ellipse(ctx, 0, -12, 11.5, 6.5, color, dark, 1);
  line(ctx, [[-8, -14], [-2, -16], [6, -14]], 'rgba(255,255,255,.32)', 1);
  line(ctx, [[8, -12], [15, -9], [18, -6]], color, 4);
  line(ctx, [[-9, -12], [-16, -9], [-21, -10]], color, 3.4);
  for (const x of [-7, -2, 3, 8]) {
    ctx.fillStyle = '#d8a64b';
    ctx.beginPath();
    ctx.moveTo(x - 2.7, -17);
    ctx.lineTo(x, -24 + Math.abs(x) * 0.18);
    ctx.lineTo(x + 3, -17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#684d2d';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  line(ctx, [[-6, -8], [-8, -2]], dark, 2.6);
  line(ctx, [[6, -8], [8, -2]], dark, 2.6);
  ellipse(ctx, 17.5, -7, 3.5, 2.5, color, dark, 0.8);
}

function drawRobot(ctx, color) {
  const dark = '#274b5c';
  ctx.fillStyle = color;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.fillRect(-7, -17, 14, 12);
  ctx.strokeRect(-7, -17, 14, 12);
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.fillRect(-5, -15, 3, 8);
  ctx.fillStyle = '#a4dceb';
  ctx.fillRect(-6, -28, 12, 9);
  ctx.strokeRect(-6, -28, 12, 9);
  line(ctx, [[0, -28], [0, -32]], dark, 1.4);
  ellipse(ctx, 0, -33, 1.3, 1.3, '#efbb55');
  ellipse(ctx, -3, -24, 1.3, 1.3, '#f5ec9d');
  ellipse(ctx, 3, -24, 1.3, 1.3, '#f5ec9d');
  line(ctx, [[-7, -15], [-12, -9]], color, 3);
  line(ctx, [[7, -15], [12, -9]], color, 3);
  line(ctx, [[-4, -5], [-5, -1]], dark, 3);
  line(ctx, [[4, -5], [5, -1]], dark, 3);
  ctx.fillStyle = '#f3a34f';
  ctx.fillRect(-3, -13, 6, 3);
}

function drawRocket(ctx, color) {
  const dark = '#4e555d';
  ctx.fillStyle = color;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -33);
  ctx.bezierCurveTo(8, -27, 8, -13, 5, -4);
  ctx.lineTo(-5, -4);
  ctx.bezierCurveTo(-8, -13, -8, -27, 0, -33);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  line(ctx, [[-2, -28], [-3.5, -10]], 'rgba(255,255,255,.52)', 1.3);
  ellipse(ctx, 0, -20, 2.8, 3.2, '#5eb2d7', '#273c49', 0.8);
  ctx.fillStyle = '#c74f40';
  ctx.beginPath();
  ctx.moveTo(-5, -12);
  ctx.lineTo(-11, -3);
  ctx.lineTo(-4, -6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(5, -12);
  ctx.lineTo(11, -3);
  ctx.lineTo(4, -6);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-4, -7, 8, 4);
  ctx.fillStyle = '#efb74b';
  ctx.beginPath();
  ctx.moveTo(-3, -3);
  ctx.lineTo(0, 3);
  ctx.lineTo(3, -3);
  ctx.closePath();
  ctx.fill();
}

const MODEL_PAINTERS = Object.freeze({
  trex: drawTrex,
  stegosaurus: drawStegosaurus,
  robot: drawRobot,
  rocket: drawRocket,
});

function drawProductionModel(ctx, type, image) {
  const presentation = PRINTED_MODEL_SPRITES[type];
  if (!presentation || !image?.naturalWidth || !image?.naturalHeight) return false;
  const sourceWidth = image.naturalWidth / 4;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ellipse(ctx, 0, 4, presentation.width * 0.42, presentation.height * 0.11, 'rgba(18,15,12,.34)');
  ctx.drawImage(
    image,
    sourceWidth * presentation.frame,
    0,
    sourceWidth,
    image.naturalHeight,
    -presentation.width * 0.5,
    -presentation.height + 6,
    presentation.width,
    presentation.height,
  );
  ctx.restore();
  return true;
}

export function drawPrintedModel(ctx, model, worldTime = 0) {
  const paint = MODEL_PAINTERS[model.type];
  if (!paint) return;
  ctx.save();
  ctx.translate(model.x, model.y);
  const entrance = Math.max(0, Math.min(1, (worldTime - (model.createdAt || 0)) / 0.65));
  const bounce = Math.sin(entrance * Math.PI) * 5;
  ctx.translate(0, -bounce);
  ctx.scale(0.72 + entrance * 0.28, 0.72 + entrance * 0.28);
  const productionArt = getProductionArt('printedCollectibles');
  if (!drawProductionModel(ctx, model.type, productionArt)) {
    drawPedestal(ctx, model.color || '#d8dde2');
    paint(ctx, model.color || '#d8dde2');
  }
  if (entrance < 1) {
    ctx.globalCompositeOperation = 'screen';
    ellipse(ctx, 0, -14, 22 + entrance * 7, 15 + entrance * 5, `rgba(95,220,255,${(1 - entrance) * 0.34})`);
  }
  ctx.restore();
}
