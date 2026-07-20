import { NATIONS } from '../js/config.js';
import {
  MILITARY_ART_ROWS,
  MILITARY_ART_SPECS,
  getProductionArt,
  preloadProductionArt,
} from '../js/gfx/art-assets.js';

const DISPLAY_SCALE = 2.4;
const gallery = document.querySelector('#gallery');

await preloadProductionArt();

for (const [nationKey, nation] of Object.entries(NATIONS)) {
  for (const [type, spec] of Object.entries(MILITARY_ART_SPECS)) {
    const image = getProductionArt(spec.key);
    if (!image) throw new Error(`Missing production military art: ${spec.key}`);

    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption');
    const canvas = document.createElement('canvas');
    caption.textContent = `${nation.adjective} ${type}`;
    canvas.width = Math.ceil(spec.w * spec.columns * DISPLAY_SCALE);
    canvas.height = Math.ceil(spec.h * DISPLAY_SCALE);
    const context = canvas.getContext('2d');
    context.scale(DISPLAY_SCALE, DISPLAY_SCALE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    for (let frame = 0; frame < spec.columns; frame += 1) {
      context.save();
      context.translate(frame * spec.w + spec.w / 2, spec.ay - 0.35);
      context.fillStyle = 'rgba(27,30,42,0.42)';
      context.strokeStyle = nationKey === 'england' ? '#3E78B8' : '#B8483E';
      context.lineWidth = 1.15;
      context.beginPath();
      context.ellipse(0, 0, spec.baseRadiusX, spec.baseRadiusY, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.restore();
      context.drawImage(
        image,
        frame * spec.sourceW,
        MILITARY_ART_ROWS[nationKey] * spec.sourceH,
        spec.sourceW,
        spec.sourceH,
        frame * spec.w,
        0,
        spec.w,
        spec.h,
      );
    }

    figure.append(caption, canvas);
    gallery.append(figure);
  }
}

document.body.dataset.ready = 'true';
