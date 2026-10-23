import { globalShortcut, ipcMain, shell } from 'electron';
import { isCustomRef, isEmoteRefShape, type CustomEmote, type EmoteRef, type ImportResult, type SoundResult } from '../shared/emotes';
import type { Strings } from '../shared/i18n';
import { UPSTREAM_PROJECT_URL } from '../shared/branding';
import {
  SETTINGS_CH, type About, type AppStatus, type AssistantActionResult, type AssistantConfig, type AssistantState,
  type SetSettingsResult,
} from '../shared/ipc';
import { hotkeyLabel, hotkeyToAccelerator, type Hotkey } from '../shared/keys';
import { pingById, type PingId } from '../shared/pings';
import type { Platform } from '../shared/platform';
import type { JoinResult, RoomState } from '../shared/room';
import { patchClashes, rendererPatch } from '../shared/settings';
import type { UpdateState } from '../shared/update';
import { emoteFileFrom, type EmoteLibrary } from './emoteLibrary';
import type { SettingsStore } from './settingsStore';

const PROJECT_URL = UPSTREAM_PROJECT_URL;
/** Where "What's new" goes when no update is known. */
export const LATEST_RELEASE_URL = `${PROJECT_URL}/releases/latest`;

export interface SettingsIpcDeps {
  store: SettingsStore;
  /** Imported emotes' files. Only the import, remove and sound handlers change `customEmotes`. */
  library: EmoteLibrary;
  getStatus(): AppStatus;
  setEnabled(on: boolean): void;
  preview(id: PingId): void;
  previewEmote(ref: EmoteRef): void;
  about(): About;
  retryHelper(): void;
  setCapturing(on: boolean): void;
  openAccessibility(): void;
  /** Strings in the app's current language. */
  text(): Strings;
  platform: Platform;
  /** The update checker. Absent in a development build without LOLPING_UPDATE_TEST_URL: the page then shows no update controls. */
  update?: {
    state(): UpdateState;
    /** The release notes link of the update that was found, kept through a failed download or install; null when none is known. */
    notesUrl(): string | null;
    /** A manual check. */
    check(): Promise<void>;
    /** Downloads and installs; settles when the install has been handed over, which is minutes later. */
    start(): Promise<void>;
  };
  room: {
    state(): RoomState;
    create(): Promise<void>;
    join(text: string): Promise<JoinResult>;
    leave(): void;
    mute(peer: string, on: boolean): void;
    clipboardCode(): Promise<string | null>;
    copyCode(): void;
    retryInternet(): void;
  };
  assistant: {
    config(): Promise<AssistantConfig>;
    openWindow(): Promise<void>;
    saveDeepSeekKey(key: unknown): Promise<AssistantActionResult>;
    deleteDeepSeekKey(): Promise<AssistantActionResult>;
    testDeepSeek(): Promise<AssistantActionResult>;
    state(): Promise<AssistantState>;
    selectEntry(id: unknown): void;
    deleteEntry(id: unknown): void;
    clearHistory(): void;
    openSettings(): void;
    rerun(id: unknown, action: unknown, options: unknown): void;
    copyAnswer(id: unknown): boolean;
    openSource(id: unknown, sourceId: unknown): Promise<void>;
    selectTodo(id: unknown): Promise<void>;
    renameTodo(id: unknown, title: unknown): Promise<boolean>;
    completeTodo(id: unknown, completed: unknown): Promise<boolean>;
    deleteTodo(id: unknown): Promise<boolean>;
    analyzeTodo(id: unknown, action: unknown): Promise<void>;
    clearWorkspace(): void;
  };
}

/** Returns an error message when another app already owns this shortcut. */
function hotkeyConflict(next: Hotkey, current: Hotkey, text: Strings, platform: Platform): string | null {
  if (next.mods === current.mods && next.vk === current.vk) return null;
  const accelerator = hotkeyToAccelerator(next);
  if (!accelerator) return null;
  try {
    const free = globalShortcut.register(accelerator, () => undefined);
    if (free) globalShortcut.unregister(accelerator);
    return free ? null : text.hotkeyTaken(hotkeyLabel(next, platform));
  } catch {
    return null;
  }
}

export function registerSettingsIpc(d: SettingsIpcDeps): void {
  // Imports and removals run one at a time, so each sees the list the one before it left (the duplicate and full checks).
  let emoteQueue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = emoteQueue.then(fn);
    emoteQueue = run.catch(() => undefined);
    return run;
  };

  ipcMain.handle(SETTINGS_CH.get, () => d.store.get());
  ipcMain.handle(SETTINGS_CH.set, (_e, raw: unknown): SetSettingsResult => {
    const patch = rendererPatch(raw);
    if (patchClashes(d.store.get(), patch, d.platform)) {
      return { ok: false, error: d.text().emoteKeyClash, settings: d.store.get() };
    }
    if (patch.toggleHotkey) {
      const error = hotkeyConflict(patch.toggleHotkey, d.store.get().toggleHotkey, d.text(), d.platform);
      if (error) return { ok: false, error, settings: d.store.get() };
    }
    return { ok: true, settings: d.store.update(patch) };
  });
  ipcMain.handle(SETTINGS_CH.status, () => d.getStatus());
  ipcMain.handle(SETTINGS_CH.setEnabled, (_e, on: unknown) => d.setEnabled(on === true));
  ipcMain.handle(SETTINGS_CH.preview, (_e, id: unknown) => {
    const p = typeof id === 'string' ? pingById(id) : undefined;
    if (p) d.preview(p.id);
  });
  ipcMain.handle(SETTINGS_CH.previewEmote, (_e, ref: unknown) => {
    if (isEmoteRefShape(ref)) d.previewEmote(ref);
  });
  ipcMain.handle(SETTINGS_CH.emoteImport, (_e, raw: unknown) => oneAtATime(async (): Promise<ImportResult> => {
    const file = emoteFileFrom(raw);
    if (!file) return { ok: false, error: 'type' };
    const saved = await d.library.save(file, d.store.get().customEmotes);
    if (!saved.ok) return { ok: false, error: saved.error };
    d.store.update({ customEmotes: [...d.store.get().customEmotes, saved.emote] });
    return { ok: true, id: saved.emote.id };
  }));
  ipcMain.handle(SETTINGS_CH.emoteRemove, (_e, id: unknown) => oneAtATime(async () => {
    if (!isCustomRef(id)) return;
    await d.library.remove(id);
    // Normalising the shorter list puts each wheel slot (and the click emote) that used it back to a default.
    d.store.update({ customEmotes: d.store.get().customEmotes.filter((c) => c.id !== id) });
  }));
  ipcMain.handle(SETTINGS_CH.emoteSound, (_e, id: unknown, raw: unknown) => oneAtATime(async (): Promise<SoundResult> => {
    if (!isCustomRef(id) || !d.store.get().customEmotes.some((c) => c.id === id)) return { ok: false, error: 'type' };
    if (raw !== null && !(raw instanceof Uint8Array)) return { ok: false, error: 'type' };
    const error = await d.library.setSound(id, raw);
    if (error) return { ok: false, error };
    const withSound = ({ sound: _old, ...c }: CustomEmote): CustomEmote => (raw === null ? c : { ...c, sound: true });
    d.store.update({ customEmotes: d.store.get().customEmotes.map((c) => (c.id === id ? withSound(c) : c)) });
    return { ok: true };
  }));
  ipcMain.handle(SETTINGS_CH.about, () => d.about());
  ipcMain.handle(SETTINGS_CH.openFolder, async () => {
    await shell.openPath(d.store.dir);
  });
  ipcMain.handle(SETTINGS_CH.openProject, async () => {
    await shell.openExternal(PROJECT_URL);
  });
  ipcMain.handle(SETTINGS_CH.retryHelper, () => d.retryHelper());
  ipcMain.handle(SETTINGS_CH.capture, (_e, on: unknown) => d.setCapturing(on === true));
  ipcMain.handle(SETTINGS_CH.openAccessibility, () => d.openAccessibility());
  ipcMain.handle(SETTINGS_CH.roomGet, () => d.room.state());
  ipcMain.handle(SETTINGS_CH.roomCreate, () => d.room.create());
  ipcMain.handle(SETTINGS_CH.roomJoin, (_e, text: unknown): Promise<JoinResult> | JoinResult =>
    typeof text === 'string' ? d.room.join(text) : { ok: false, error: 'invalid' });
  ipcMain.handle(SETTINGS_CH.roomLeave, () => d.room.leave());
  ipcMain.handle(SETTINGS_CH.roomMute, (_e, peer: unknown, on: unknown) => {
    if (typeof peer === 'string') d.room.mute(peer, on === true);
  });
  ipcMain.handle(SETTINGS_CH.roomClipboard, () => d.room.clipboardCode());
  ipcMain.handle(SETTINGS_CH.roomCopy, () => d.room.copyCode());
  ipcMain.handle(SETTINGS_CH.roomRetryInternet, () => d.room.retryInternet());

  ipcMain.handle(SETTINGS_CH.updateGet, (): UpdateState | null => d.update?.state() ?? null);
  ipcMain.handle(SETTINGS_CH.updateCheck, async () => {
    await d.update?.check();
  });
  ipcMain.handle(SETTINGS_CH.updateStart, () => {
    // Not awaited: the page follows the download through update:state, and this call would otherwise stay open for minutes.
    d.update?.start().catch(() => undefined);
  });
  ipcMain.handle(SETTINGS_CH.updateOpenRelease, async () => {
    if (!d.update) return;
    const notes = d.update.notesUrl();
    await shell.openExternal(notes !== null && isWebUrl(notes) ? notes : LATEST_RELEASE_URL);
  });
  ipcMain.handle(SETTINGS_CH.assistantConfig, () => d.assistant.config());
  ipcMain.handle(SETTINGS_CH.assistantOpenWindow, () => d.assistant.openWindow());
  ipcMain.handle(SETTINGS_CH.assistantSaveKey, (_e, key: unknown) => d.assistant.saveDeepSeekKey(key));
  ipcMain.handle(SETTINGS_CH.assistantDeleteKey, () => d.assistant.deleteDeepSeekKey());
  ipcMain.handle(SETTINGS_CH.assistantTest, () => d.assistant.testDeepSeek());
  ipcMain.handle(SETTINGS_CH.assistantGet, () => d.assistant.state());
  ipcMain.handle(SETTINGS_CH.assistantOpenSettings, () => d.assistant.openSettings());
  ipcMain.handle(SETTINGS_CH.assistantSelect, (_e, id: unknown) => d.assistant.selectEntry(id));
  ipcMain.handle(SETTINGS_CH.assistantDeleteEntry, (_e, id: unknown) => d.assistant.deleteEntry(id));
  ipcMain.handle(SETTINGS_CH.assistantClearHistory, () => d.assistant.clearHistory());
  ipcMain.handle(SETTINGS_CH.assistantRerun, (_e, id: unknown, action: unknown, options: unknown) => d.assistant.rerun(id, action, options));
  ipcMain.handle(SETTINGS_CH.assistantCopy, (_e, id: unknown) => d.assistant.copyAnswer(id));
  ipcMain.handle(SETTINGS_CH.assistantSource, (_e, id: unknown, sourceId: unknown) => d.assistant.openSource(id, sourceId));
  ipcMain.handle(SETTINGS_CH.assistantTodoSelect, (_e, id: unknown) => d.assistant.selectTodo(id));
  ipcMain.handle(SETTINGS_CH.assistantTodoRename, (_e, id: unknown, title: unknown) => d.assistant.renameTodo(id, title));
  ipcMain.handle(SETTINGS_CH.assistantTodoComplete, (_e, id: unknown, completed: unknown) => d.assistant.completeTodo(id, completed));
  ipcMain.handle(SETTINGS_CH.assistantTodoDelete, (_e, id: unknown) => d.assistant.deleteTodo(id));
  ipcMain.handle(SETTINGS_CH.assistantTodoAnalyze, (_e, id: unknown, action: unknown) => d.assistant.analyzeTodo(id, action));
  ipcMain.handle(SETTINGS_CH.assistantClearWorkspace, () => d.assistant.clearWorkspace());
}

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
