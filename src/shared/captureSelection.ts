export interface CapturePoint { x: number; y: number }
export interface CaptureRect extends CapturePoint { width: number; height: number }
export type CaptureHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const MIN_CAPTURE_SIZE = 8;

const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));

export function selectionRect(start: CapturePoint, end: CapturePoint, width: number, height: number): CaptureRect {
  const x1 = clamp(start.x, width), y1 = clamp(start.y, height);
  const x2 = clamp(end.x, width), y2 = clamp(end.y, height);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

export function moveSelection(rect: CaptureRect, dx: number, dy: number, width: number, height: number): CaptureRect {
  return { ...rect, x: clamp(rect.x + dx, width - rect.width), y: clamp(rect.y + dy, height - rect.height) };
}

export function resizeSelection(rect: CaptureRect, handle: CaptureHandle, point: CapturePoint,
  width: number, height: number): CaptureRect {
  return selectionRect({ x: handle.includes('w') ? point.x : rect.x, y: handle.includes('n') ? point.y : rect.y },
    { x: handle.includes('e') ? point.x : rect.x + rect.width,
      y: handle.includes('s') ? point.y : rect.y + rect.height }, width, height);
}

/** Validate renderer coordinates and map display DIPs to the actual captured thumbnail, including mixed DPI. */
export function capturePixels(raw: unknown, width: number, height: number,
  pixelWidth: number, pixelHeight: number): CaptureRect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const x = r.x, y = r.y, w = r.width, h = r.height;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number'
    || ![x, y, w, h].every(Number.isFinite)) return null;
  if (w < MIN_CAPTURE_SIZE || h < MIN_CAPTURE_SIZE || x < 0 || y < 0 || x + w > width + 0.01 || y + h > height + 0.01) return null;
  const left = Math.max(0, Math.floor(x * pixelWidth / width));
  const top = Math.max(0, Math.floor(y * pixelHeight / height));
  return { x: left, y: top,
    width: Math.min(pixelWidth, Math.ceil((x + w) * pixelWidth / width)) - left,
    height: Math.min(pixelHeight, Math.ceil((y + h) * pixelHeight / height)) - top };
}
