// Pure camera transforms shared by rendering and input. The battlefield turns
// in exact cardinal steps so the authored isometric architecture stays upright
// and crisp while players can inspect every side of a formation or settlement.

export const VIEW_TURN = Math.PI / 2;
export const MIN_CAMERA_ZOOM = 0.3;
export const MAX_CAMERA_ZOOM = 2.5;
export const CAMERA_ZOOM_STEP = 1.25;

const VIEW_DIRECTION_LABELS = ['South', 'East', 'North', 'West'];

export function normalizeViewRotation(rotation) {
  const turns = Math.round((Number(rotation) || 0) / VIEW_TURN);
  return ((turns % VIEW_DIRECTION_LABELS.length) + VIEW_DIRECTION_LABELS.length)
    % VIEW_DIRECTION_LABELS.length * VIEW_TURN;
}

export function turnView(rotation, direction) {
  return normalizeViewRotation(rotation + Math.sign(direction || 1) * VIEW_TURN);
}

export function clampCameraZoom(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, value));
}

export function stepCameraZoom(zoom, direction) {
  const factor = Math.sign(direction || 1) < 0 ? 1 / CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP;
  return clampCameraZoom(clampCameraZoom(zoom) * factor);
}

// Side-on unit/building art has one mirrored counterpart. At East/West, where
// world-X projects vertically, keep the mirror stable with the adjoining view
// instead of allowing floating-point noise around cos(90deg) to flip sprites.
export function viewMirrorsHorizontalFacing(rotation) {
  const turn = Math.round(normalizeViewRotation(rotation) / VIEW_TURN)
    % VIEW_DIRECTION_LABELS.length;
  return turn === 2 || turn === 3;
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
  const turn = Math.round(normalizeViewRotation(rotation) / VIEW_TURN)
    % VIEW_DIRECTION_LABELS.length;
  return VIEW_DIRECTION_LABELS[turn];
}
