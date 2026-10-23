import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantState } from '../../src/shared/ipc';

const h = vi.hoisted(() => ({ windows: [] as unknown[] }));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeWindow extends Emitter {
    webContents = Object.assign(new Emitter(), { send: () => undefined, setWindowOpenHandler: () => undefined });
    visible = false;
    minimized = false;
    top = false;
    focused = 0;
    constructor() { super(); h.windows.push(this); }
    isDestroyed(): boolean { return false; }
    isVisible(): boolean { return this.visible; }
    isMinimized(): boolean { return this.minimized; }
    isAlwaysOnTop(): boolean { return this.top; }
    setAlwaysOnTop(on: boolean): void { this.top = on; }
    removeMenu(): void {}
    restore(): void { this.minimized = false; }
    show(): void { this.visible = true; }
    showInactive(): void { this.visible = true; }
    hide(): void { this.visible = false; }
    focus(): void { this.focused++; }
    flashFrame(): void {}
  }
  return { BrowserWindow: FakeWindow, nativeImage: { createFromPath: () => ({}) } };
});
vi.mock('../../src/main/paths', () => ({
  IS_MAC: false, IS_LINUX: false, assetPath: () => 'icon.png', preloadPath: () => 'preload.js',
  pageUrl: () => 'lolping://app/question/index.html', loadPage: () => Promise.resolve(),
}));

type FakeWindow = EventEmitter & { visible: boolean; minimized: boolean; top: boolean; focused: number };
let mod: typeof import('../../src/main/questionWindow');
const state = (status: 'queued' | 'asking' | 'done' | 'error'): AssistantState => ({
  entries: [{ id: 'question', action: 'explain', options: { format: 'markdown', target: 'auto' },
    createdAt: 1, image: null, question: 'question', answer: '', status }],
  selectedId: 'question', provider: 'deepseek', deepseekKeySet: true, language: 'en',
  codexOpen: false, codexCliAvailable: false, codexSignedIn: false,
  mode: 'all', todos: [], selectedTodoId: null, todoImage: null,
});

beforeEach(async () => {
  h.windows.length = 0;
  vi.resetModules();
  mod = await import('../../src/main/questionWindow');
});

describe('question window', () => {
  it('can be explicitly opened from settings without a queued request or a screenshot', () => {
    const empty = { ...state('done'), entries: [], selectedId: null };
    mod.openQuestionWindow(empty, true);
    const window = h.windows[0] as FakeWindow;
    window.emit('ready-to-show');
    expect(window).toMatchObject({ visible: true, top: false, focused: 1 });
  });
  it('keeps a queued ping inactive, then restores and raises the window when the request starts', () => {
    mod.openQuestionWindow(state('queued'));
    const window = h.windows[0] as FakeWindow;
    window.emit('ready-to-show');
    expect(window).toMatchObject({ visible: true, top: false, focused: 0 });
    window.minimized = true;
    mod.openQuestionWindow(state('asking'));
    expect(window).toMatchObject({ visible: true, minimized: false, top: true, focused: 1 });
    expect(h.windows).toHaveLength(1);
  });

  it('raises a new window after loading if capture finished while its old window was closed', () => {
    mod.openQuestionWindow(state('asking'));
    const window = h.windows[0] as FakeWindow;
    window.emit('ready-to-show');
    expect(window).toMatchObject({ visible: true, top: true, focused: 1 });
  });

  it.each(['done', 'error'] as const)('releases always-on-top after %s without hiding or refocusing the result', (status) => {
    mod.openQuestionWindow(state('asking'));
    const window = h.windows[0] as FakeWindow;
    window.emit('ready-to-show');
    mod.updateQuestionWindow(state('asking'));
    expect(window).toMatchObject({ top: true, focused: 1 });
    mod.updateQuestionWindow(state(status));
    expect(window).toMatchObject({ visible: true, top: false, focused: 1 });
  });

  it('hides even a pinned answer window during capture and restores it without another focus change', async () => {
    mod.openQuestionWindow(state('asking'));
    const window = h.windows[0] as FakeWindow;
    window.emit('ready-to-show');
    await expect(mod.withQuestionWindowHidden(async () => {
      expect(window.visible).toBe(false);
      return 'clean crop';
    })).resolves.toBe('clean crop');
    expect(window).toMatchObject({ visible: true, top: true, focused: 1 });
  });

  it('keeps the window hidden when the workspace was cleared during capture', async () => {
    mod.openQuestionWindow(state('asking'));
    const window = h.windows[0] as FakeWindow;
    window.emit('ready-to-show');
    await mod.withQuestionWindowHidden(async () => { mod.hideQuestionWindow(); });
    expect(window).toMatchObject({ visible: false, top: false });
  });
});
