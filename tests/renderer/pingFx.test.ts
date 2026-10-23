import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnPing } from '../../src/renderer/overlay/pingFx';
import { pingById, type PingDef } from '../../src/shared/pings';

/** Just enough of the DOM for spawnPing: elements with classes and children that can be removed. */
class FakeElement {
  className = '';
  textContent = '';
  src = '';
  onerror: (() => void) | null = null;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  readonly style = { setProperty: () => undefined };
  get childElementCount(): number {
    return this.children.length;
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  append(...els: FakeElement[]): void {
    for (const el of els) {
      el.parent = this;
      this.children.push(el);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
}

const danger = pingById('danger') as PingDef;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('spawnPing', () => {
  it('removes a ping once its duration is over', () => {
    const layer = new FakeElement();
    spawnPing(layer as unknown as HTMLElement, danger, 10, 20, { sizePx: 110, durationS: 3 });
    expect(layer.children).toHaveLength(1);
    vi.advanceTimersByTime(3200);
    expect(layer.children).toHaveLength(0);
  });

  it('leaves a kept ping on screen past its duration, for the caller to remove', () => {
    const layer = new FakeElement();
    const el = spawnPing(layer as unknown as HTMLElement, danger, 10, 20, { sizePx: 110, durationS: 3, keep: true });
    expect(layer.children[0].className).toBe('ping kept');
    vi.advanceTimersByTime(60_000);
    expect(layer.children).toHaveLength(1);
    el.remove();
    expect(layer.children).toHaveLength(0);
  });
});
