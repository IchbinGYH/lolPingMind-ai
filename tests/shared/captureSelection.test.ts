import { describe, expect, it } from 'vitest';
import { capturePixels, moveSelection, resizeSelection, selectionRect } from '../../src/shared/captureSelection';

describe('captureSelection', () => {
  it('draws in either direction and clamps the selection to the display', () => {
    expect(selectionRect({ x: 500, y: 400 }, { x: -10, y: 80 }, 1920, 1080))
      .toEqual({ x: 0, y: 80, width: 500, height: 320 });
    expect(selectionRect({ x: 20, y: 10 }, { x: 3000, y: 2000 }, 1920, 1080))
      .toEqual({ x: 20, y: 10, width: 1900, height: 1070 });
  });
  it('moves the entire rectangle without changing its size or leaving the screen', () => {
    expect(moveSelection({ x: 200, y: 100, width: 400, height: 300 }, 1800, -200, 1920, 1080))
      .toEqual({ x: 1520, y: 0, width: 400, height: 300 });
  });
  it('resizes all corners and edges and supports dragging across the opposite edge', () => {
    const rect = { x: 100, y: 100, width: 400, height: 300 };
    expect(resizeSelection(rect, 'se', { x: 700, y: 600 }, 1920, 1080))
      .toEqual({ x: 100, y: 100, width: 600, height: 500 });
    expect(resizeSelection(rect, 'w', { x: 600, y: 0 }, 1920, 1080))
      .toEqual({ x: 500, y: 100, width: 100, height: 300 });
    expect(resizeSelection(rect, 'n', { x: 0, y: 20 }, 1920, 1080))
      .toEqual({ x: 100, y: 20, width: 400, height: 380 });
    expect(resizeSelection(rect, 'ne', { x: 250, y: 40 }, 1920, 1080))
      .toEqual({ x: 100, y: 40, width: 150, height: 360 });
  });
  it('maps DIPs to a downscaled high DPI snapshot without losing the selected edges', () => {
    expect(capturePixels({ x: 100, y: 50, width: 700, height: 400 }, 2560, 1440, 3840, 2160))
      .toEqual({ x: 150, y: 75, width: 1050, height: 600 });
    expect(capturePixels({ x: 0.1, y: 0.1, width: 8, height: 8 }, 1920, 1080, 1920, 1080))
      .toEqual({ x: 0, y: 0, width: 9, height: 9 });
  });
  it('rejects tiny, invalid and out of bounds rectangles from IPC', () => {
    for (const raw of [null, {}, { x: 0, y: 0, width: '20', height: 20 },
      { x: NaN, y: 0, width: 20, height: 20 }, { x: 0, y: Infinity, width: 20, height: 20 },
      { x: -1, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: 7, height: 20 },
      { x: 1900, y: 0, width: 50, height: 20 }, { x: 0, y: 1000, width: 50, height: 100 }]) {
      expect(capturePixels(raw, 1920, 1080, 3840, 2160)).toBeNull();
    }
  });
});
