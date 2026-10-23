import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_CH } from '../../src/shared/ipc';
import { RegionCapture } from '../../src/main/regionCapture';

type Handler = (event: unknown, value?: unknown) => unknown;
const h = vi.hoisted(() => ({ windows: [] as unknown[], handlers: new Map<string, Handler>(),
  displayEvents: null as EventEmitter | null, crops: [] as unknown[], load: vi.fn(), snapshot: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  h.displayEvents = new Emitter();
  class FakeWindow extends Emitter {
    webContents = Object.assign(new Emitter(), { mainFrame: { url: 'lolping://app/capture/index.html' },
      setWindowOpenHandler: () => undefined });
    visible = false;
    destroyed = false;
    focused = false;
    bounds: unknown;
    constructor() { super(); h.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    setBounds(bounds: unknown) { this.bounds = bounds; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
  }
  return { BrowserWindow: FakeWindow, screen: h.displayEvents,
    ipcMain: { handle: (channel: string, handler: Handler) => h.handlers.set(channel, handler),
      removeHandler: (channel: string) => h.handlers.delete(channel) } };
});
vi.mock('../../src/main/paths', () => ({ IS_MAC: false, IS_LINUX: false,
  preloadPath: () => 'capture.js', pageUrl: () => 'lolping://app/capture/index.html', loadPage: h.load }));
vi.mock('../../src/main/screenCapture', () => ({ captureScreen: h.snapshot }));

interface FakeWindow extends EventEmitter {
  webContents: EventEmitter & { mainFrame: { url: string } };
  visible: boolean;
  destroyed: boolean;
  focused: boolean;
  bounds: unknown;
}
const display = { id: 2, bounds: { x: -2560, y: 0, width: 2560, height: 1440 }, scaleFactor: 2 };
const invoke = (channel: string, event: unknown, value?: unknown): unknown => {
  const handler = h.handlers.get(channel);
  if (!handler) throw new Error('handler unavailable');
  return handler(event, value);
};
let controller: AbortController;
let unit: RegionCapture;
let selecting: boolean[];
let hidden: boolean;
let pending: Promise<Buffer | null> | null;
const open = async (): Promise<{ win: FakeWindow; event: unknown }> => {
  pending = unit.capture(2, 'zh-CN', controller.signal);
  await vi.waitFor(() => expect(h.windows).toHaveLength(1));
  const win = h.windows[0] as FakeWindow;
  return { win, event: { sender: win.webContents, senderFrame: win.webContents.mainFrame } };
};
beforeEach(() => {
  h.windows.length = 0; h.handlers.clear(); h.crops.length = 0;
  h.displayEvents?.removeAllListeners(); h.load.mockReset(); h.load.mockResolvedValue(undefined);
  h.snapshot.mockReset(); h.snapshot.mockResolvedValue({ display, image: { toDataURL: () => 'data:image/png;base64,snapshot',
    getSize: () => ({ width: 3840, height: 2160 }), crop: (rect: unknown) => {
      h.crops.push(rect); return { toJPEG: () => Buffer.from('selected pixels') };
    } } });
  controller = new AbortController(); selecting = []; hidden = false; pending = null;
  unit = new RegionCapture(async (_display, run) => {
    hidden = true;
    try { return await run(); } finally { hidden = false; }
  }, (value) => selecting.push(value));
});
afterEach(async () => { controller.abort(); await pending?.catch(() => undefined); });

describe('RegionCapture', () => {
  it('keeps lolPing hidden throughout selection and crops the frozen snapshot only after confirmation', async () => {
    const { win, event } = await open();
    expect(hidden).toBe(true);
    expect(h.crops).toEqual([]);
    expect(invoke(CAPTURE_CH.state, event)).toMatchObject({ width: 2560, height: 1440, language: 'zh-CN' });
    win.emit('ready-to-show');
    expect(win).toMatchObject({ visible: true, focused: true, bounds: display.bounds });
    expect(invoke(CAPTURE_CH.confirm, event, { x: 100, y: 80, width: 500, height: 300 })).toBe(true);
    expect(await pending).toEqual(Buffer.from('selected pixels'));
    expect(h.crops).toEqual([{ x: 150, y: 120, width: 750, height: 450 }]);
    expect(win.destroyed).toBe(true);
    expect(selecting).toEqual([true, false]);
    expect(hidden).toBe(false);
    expect(h.handlers.size).toBe(0);
    expect(h.displayEvents?.listenerCount('display-removed')).toBe(0);
  });
  it('refuses screenshot reads and crop requests from another window or frame', async () => {
    const { win, event } = await open();
    expect(invoke(CAPTURE_CH.state, { sender: {}, senderFrame: win.webContents.mainFrame })).toBeNull();
    expect(invoke(CAPTURE_CH.state, { sender: win.webContents, senderFrame: { url: win.webContents.mainFrame.url } })).toBeNull();
    expect(invoke(CAPTURE_CH.confirm, { sender: {} }, { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
    expect(invoke(CAPTURE_CH.confirm, event, { x: -1, y: 0, width: 100, height: 100 })).toBe(false);
    expect(h.crops).toEqual([]);
    expect(win.destroyed).toBe(false);
    invoke(CAPTURE_CH.cancel, event);
    expect(await pending).toBeNull();
  });
  it('closes on cancellation and never reappears from a late ready event', async () => {
    const { win } = await open();
    controller.abort();
    expect(await pending).toBeNull();
    win.emit('ready-to-show');
    expect(win).toMatchObject({ destroyed: true, visible: false, focused: false });
    expect(selecting).toEqual([true, false]);
    expect(h.crops).toEqual([]);
  });
  it('cancels safely if the target monitor is removed or changes DPI', async () => {
    await open();
    h.displayEvents?.emit('display-metrics-changed', {}, { ...display, scaleFactor: 1 });
    expect(await pending).toBeNull();
    expect(hidden).toBe(false);
    expect(h.crops).toEqual([]);
  });
  it('releases selection input on a renderer load failure', async () => {
    h.load.mockRejectedValue(new Error('load failed'));
    await expect(unit.capture(2, 'en', controller.signal)).rejects.toThrow('capture');
    expect(selecting).toEqual([true, false]);
    expect(h.handlers.size).toBe(0);
    expect(hidden).toBe(false);
  });
  it('does not capture or open a window for an already cancelled request', async () => {
    controller.abort();
    expect(await unit.capture(2, 'en', controller.signal)).toBeNull();
    expect(h.snapshot).not.toHaveBeenCalled();
    expect(h.windows).toEqual([]);
    expect(selecting).toEqual([]);
  });
});
