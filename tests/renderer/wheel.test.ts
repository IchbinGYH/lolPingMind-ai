import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Wheel } from '../../src/renderer/overlay/wheel';
import { WHEEL } from '../../src/shared/geometry';

/** The SVG operations Wheel uses, without a browser. */
class FakeElement {
  id = '';
  innerHTML = '';
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  append(child: FakeElement): void {
    this.children.push(child);
  }
}

function makeWheel(id = 'wheel') {
  const svg = new FakeElement();
  svg.id = id;
  const hover = vi.fn();
  const wheel = new Wheel(svg as unknown as SVGSVGElement, 'WHEEL', 'icon.png', hover);
  wheel.setItems(Array.from({ length: 8 }, (_, i) => ({ key: String(i), icon: `${i}.png` })));
  return { wheel, svg, hover };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElementNS: () => new FakeElement() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wheel size', () => {
  it.each(['wheel', 'emoteWheel'])('resizes %s around its original centre', (id) => {
    const { wheel, svg } = makeWheel(id);
    wheel.open(800, 500);
    for (const size of [300, 600, 900]) {
      wheel.setSize(size);
      expect(svg.style).toMatchObject({
        width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size / 2}px`,
        left: '800px', top: '500px',
      });
      expect(wheel.isOpen).toBe(true);
    }
  });

  it.each([300, 600, 900])('scales hover and release dead zones at %i px', (size) => {
    const { wheel, hover } = makeWheel();
    wheel.setSize(size);
    const deadZone = WHEEL.innerR * size / 600;
    wheel.open(800, 500);
    wheel.move(800, 500 - deadZone + 1);
    expect(hover).not.toHaveBeenCalled();
    expect(wheel.release(800, 500 - deadZone + 1)).toBeNull();
    wheel.open(800, 500);
    wheel.move(800, 500 - deadZone);
    expect(hover).toHaveBeenCalledWith(0);
    expect(wheel.release(800, 500 - deadZone)).toEqual({ key: '0', x: 800, y: 500 });
    expect(wheel.isOpen).toBe(false);
  });

  it.each([300, 600, 900])('keeps all eight slices aligned at %i px', (size) => {
    const { wheel, hover } = makeWheel();
    wheel.setSize(size);
    for (let i = 0; i < 8; i++) {
      const rad = ((i * 45 - 90) * Math.PI) / 180;
      const r = WHEEL.iconR * size / 600;
      const x = 800 + r * Math.cos(rad);
      const y = 500 + r * Math.sin(rad);
      wheel.open(800, 500);
      wheel.move(x, y);
      expect(hover).toHaveBeenLastCalledWith(i);
      expect(wheel.release(x, y)).toEqual({ key: String(i), x: 800, y: 500 });
    }
  });

  it('uses a new size for a wheel that is already open', () => {
    const { wheel, hover } = makeWheel();
    wheel.open(800, 500);
    wheel.move(800, 400);
    expect(hover).toHaveBeenCalledWith(0);
    wheel.setSize(900);
    wheel.move(800, 400);
    expect(wheel.release(800, 400)).toBeNull();
  });

  it('still cancels after resizing', () => {
    const { wheel, svg } = makeWheel();
    wheel.setSize(300);
    wheel.open(800, 500);
    wheel.move(800, 400);
    wheel.cancel();
    expect(wheel.isOpen).toBe(false);
    expect(svg.classes.has('open')).toBe(false);
    expect(wheel.release(800, 400)).toBeNull();
  });
});
