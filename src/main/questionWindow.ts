import { BrowserWindow, nativeImage, type BrowserWindowConstructorOptions } from 'electron';
import type { AssistantState } from '../shared/ipc';
import { strings } from '../shared/i18n';
import { SETTINGS_CH } from '../shared/settingsChannels';
import { assetPath, IS_LINUX, IS_MAC, loadPage, pageUrl, preloadPath } from './paths';

let win: BrowserWindow | null = null;
let latestState: AssistantState | null = null;
let visibilityEpoch = 0;

function isQuestionPage(url: string): boolean {
  try {
    const target = new URL(url);
    const own = new URL(pageUrl('question'));
    return target.protocol === own.protocol && target.host === own.host && target.pathname === own.pathname;
  } catch {
    return false;
  }
}

const chromeOptions = (): BrowserWindowConstructorOptions => IS_MAC
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
  : IS_LINUX ? {} : { backgroundMaterial: 'mica', titleBarOverlay: { color: '#00000000', symbolColor: '#d8d8e2', height: 40 } };

function sendState(w: BrowserWindow): void {
  if (latestState && !w.isDestroyed()) w.webContents.send(SETTINGS_CH.assistantState, latestState);
}

function hasRunningRequest(): boolean {
  return latestState?.entries.some((entry) => entry.status === 'asking') === true;
}

function showQuestionWindow(w: BrowserWindow, forceFocus = false): void {
  const state = latestState;
  const selected = state?.entries.find((entry) => entry.id === state.selectedId);
  if (w.isMinimized()) w.restore();
  if (forceFocus || (selected && selected.status !== 'queued')) {
    w.setAlwaysOnTop(hasRunningRequest());
    w.show();
    w.focus();
  } else {
    w.showInactive();
    w.flashFrame(true);
  }
}

export function updateQuestionWindow(state: AssistantState): void {
  latestState = state;
  if (win && !win.isDestroyed()) {
    if (!hasRunningRequest() && win.isAlwaysOnTop()) win.setAlwaysOnTop(false);
    sendState(win);
  }
}

/** Hides the answer window while reading the game screen, then restores it without taking focus. */
export async function withQuestionWindowHidden<T>(capture: () => Promise<T>): Promise<T> {
  const current = win;
  const epoch = visibilityEpoch;
  const wasVisible = !!current && !current.isDestroyed() && current.isVisible();
  if (wasVisible) current.hide();
  try {
    return await capture();
  } finally {
    if (wasVisible && current && !current.isDestroyed() && win === current && epoch === visibilityEpoch) current.showInactive();
  }
}

export function hideQuestionWindow(): void {
  visibilityEpoch++;
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(false);
    win.hide();
  }
}

/** Queued pings stay inactive; after capture, the request window comes forward until the answer finishes. */
export function openQuestionWindow(state: AssistantState, forceFocus = false): void {
  latestState = state;
  if (win && !win.isDestroyed()) {
    showQuestionWindow(win, forceFocus);
    sendState(win);
    return;
  }
  const w = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 780,
    minHeight: 560,
    title: strings(state.language).appName,
    icon: nativeImage.createFromPath(assetPath('textures', 'generic_ping.png')),
    show: false,
    ...chromeOptions(),
    webPreferences: { preload: preloadPath('question'), spellcheck: false, backgroundThrottling: !IS_MAC },
  });
  if (!IS_MAC) w.removeMenu();
  w.webContents.on('did-finish-load', () => sendState(w));
  w.webContents.on('will-navigate', (event) => {
    if (!isQuestionPage(event.url)) event.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.once('ready-to-show', () => {
    showQuestionWindow(w, forceFocus);
  });
  w.on('focus', () => w.flashFrame(false));
  w.on('closed', () => { win = null; });
  void loadPage(w, 'question');
  win = w;
}
