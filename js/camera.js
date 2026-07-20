// Pure camera transforms shared by rendering and input. The battlefield turns
// in exact opposing-view steps so the authored isometric architecture stays
// upright and crisp while players can inspect the far side of a fortification.

export const VIEW_TURN = Math.PI;

export function normalizeViewRotation(rotation) {
  const turns = Math.round((Number(rotation) || 0) / VIEW_TURN);
  return ((turns % 2) + 2) % 2 * VIEW_TURN;
}

export function turnView(rotation, direction) {
  return normalizeViewRotation(rotation + Math.sign(direction || 1) * VIEW_TURN);
}

export function screenVectorToWorld(camera, dx, dy) {
  const angle = normalizeViewRotation(camera?.rotation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx + sin * dy,
    y: -sin * dx + cos * dy,
  };
}

export function screenPointToWorld(camera, viewWidth, viewHeight, sx, sy) {
  const zoom = Math.max(0.01, Number(camera?.zoom) || 1);
  const vector = screenVectorToWorld(
    camera,
    (sx - viewWidth / 2) / zoom,
    (sy - viewHeight / 2) / zoom,
  );
  return { x: camera.x + vector.x, y: camera.y + vector.y };
}

export function worldViewDepth(camera, x, y) {
  const angle = normalizeViewRotation(camera?.rotation);
  return Math.sin(angle) * x + Math.cos(angle) * y;
}

export function rotatedViewHalfExtents(camera, viewWidth, viewHeight) {
  const zoom = Math.max(0.01, Number(camera?.zoom) || 1);
  const halfWidth = Math.max(0, Number(viewWidth) || 0) / (2 * zoom);
  const halfHeight = Math.max(0, Number(viewHeight) || 0) / (2 * zoom);
  const angle = normalizeViewRotation(camera?.rotation);
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return {
    x: cos * halfWidth + sin * halfHeight,
    y: sin * halfWidth + cos * halfHeight,
  };
}

export function viewDirectionLabel(rotation) {
  const turn = Math.round(normalizeViewRotation(rotation) / VIEW_TURN) % 2;
  return ['South', 'North'][turn];
}
