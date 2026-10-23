import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent, type NativeImage, type Display } from 'electron';
import { CAPTURE_CH, type CaptureState } from '../shared/ipc';
import { capturePixels } from '../shared/captureSelection';
import type { Lang } from '../shared/i18n';
import { IS_LINUX, IS_MAC, loadPage, pageUrl, preloadPath } from './paths';
import { captureScreen } from './screenCapture';

type CleanCapture = <T>(displayId: number, read: () => Promise<T>) => Promise<T>;

export class RegionCapture {
  constructor(private readonly clean: CleanCapture, private readonly selecting: (active: boolean) => void) {}

  async capture(displayId: number, language: Lang, signal: AbortSignal): Promise<Buffer | null> {
    return this.clean(displayId, async () => {
      if (signal.aborted) return null;
      const { display, image } = await captureScreen(displayId);
      if (signal.aborted) return null;
      this.selecting(true);
      try { return await this.select(display, image, language, signal); }
      finally { this.selecting(false); }
    });
  }

  private select(display: Display, image: NativeImage, language: Lang, signal: AbortSignal): Promise<Buffer | null> {
    const state: CaptureState = { image: image.toDataURL(), width: display.bounds.width,
      height: display.bounds.height, language };
    return new Promise((resolve, reject) => {
      const win = new BrowserWindow({
        ...display.bounds, frame: false, resizable: false, movable: false, minimizable: false,
        maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
        enableLargerThanScreen: true, backgroundColor: '#101217', show: false,
        ...(IS_MAC ? { type: 'panel' as const } : {}),
        webPreferences: { preload: preloadPath('capture'), backgroundThrottling: false, spellcheck: false },
      });
      let finished = false;
      let loadTimer: NodeJS.Timeout | undefined;
      const finish = (crop: Buffer | null, error?: Error): void => {
        if (finished) return;
        finished = true;
        if (loadTimer) clearTimeout(loadTimer);
        signal.removeEventListener('abort', cancel);
        screen.removeListener('display-removed', displayChanged);
        screen.removeListener('display-metrics-changed', displayChanged);
        for (const channel of Object.values(CAPTURE_CH)) ipcMain.removeHandler(channel);
        if (!win.isDestroyed()) win.destroy();
        if (error) reject(error); else resolve(crop);
      };
      const cancel = (): void => finish(null);
      const displayChanged = (_event: unknown, changed: Display): void => { if (changed.id === display.id) cancel(); };
      const ownPage = (url: string): boolean => {
        try {
          const current = new URL(url), own = new URL(pageUrl('capture'));
          return current.protocol === own.protocol && current.host === own.host && current.pathname === own.pathname;
        } catch { return false; }
      };
      const allowed = (event: IpcMainInvokeEvent): boolean => !finished && event.sender === win.webContents
        && event.senderFrame === win.webContents.mainFrame && ownPage(event.senderFrame.url);
      ipcMain.handle(CAPTURE_CH.state, (event) => allowed(event) ? state : null);
      ipcMain.handle(CAPTURE_CH.cancel, (event) => { if (allowed(event)) cancel(); });
      ipcMain.handle(CAPTURE_CH.confirm, (event, raw: unknown) => {
        if (!allowed(event)) return false;
        const size = image.getSize();
        const rect = capturePixels(raw, display.bounds.width, display.bounds.height, size.width, size.height);
        if (!rect) return false;
        try { finish(image.crop(rect).toJPEG(82)); return true; }
        catch { finish(null, new Error('capture')); return false; }
      });
      signal.addEventListener('abort', cancel, { once: true });
      screen.on('display-removed', displayChanged);
      screen.on('display-metrics-changed', displayChanged);
      win.on('closed', cancel);
      win.webContents.on('render-process-gone', () => finish(null, new Error('capture')));
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); cancel(); }
      });
      win.webContents.on('will-navigate', (event) => { if (!ownPage(event.url)) event.preventDefault(); });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.setAlwaysOnTop(true, 'screen-saver');
      if (IS_LINUX) win.setVisibleOnAllWorkspaces(true);
      if (IS_MAC) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        win.setHiddenInMissionControl(true);
      }
      win.once('ready-to-show', () => {
        if (finished) return;
        if (loadTimer) clearTimeout(loadTimer);
        win.setBounds(display.bounds);
        win.show();
        win.focus();
      });
      loadTimer = setTimeout(() => finish(null, new Error('capture')), 15_000);
      void loadPage(win, 'capture').catch(() => finish(null, new Error('capture')));
      if (signal.aborted) cancel();
    });
  }
}
