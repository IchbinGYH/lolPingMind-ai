import type { EmoteArt, EmoteFile, EmoteRef, ImportResult, SoundResult } from './emotes';
import type { PingId } from './pings';
import type { Platform } from './platform';
import type { HelperStatus, WheelKind } from './protocol';
import type { JoinResult, RoomState } from './room';
import type { AssistantProvider, OverlaySettings, Settings } from './settings';
import type { UpdateState } from './update';
import type { Lang } from './i18n';
import type { AssistantAction, AssistantMode, AssistantOptions, AssistantSource, AssistantTodo } from './assistantActions';
import type { CaptureRect } from './captureSelection';

export const CAPTURE_CH = { state: 'capture:state', confirm: 'capture:confirm', cancel: 'capture:cancel' } as const;
export interface CaptureState { image: string; width: number; height: number; language: Lang }
export interface CaptureApi {
  getState(): Promise<CaptureState | null>;
  confirm(rect: CaptureRect): Promise<boolean>;
  cancel(): void;
}

export interface Point {
  x: number;
  y: number;
}

/** The name tag under a room member's ping. `color` indexes TAG_COLORS. */
export interface PingTag {
  name: string;
  color: number;
}

/** main → overlay renderer messages. Points are CSS pixels inside that overlay. */
export interface OverlayEvents {
  'overlay:settings': OverlaySettings;
  /** `wheel` names the wheel the gesture belongs to; missing means 'ping' (the site demo leaves it out). */
  'wheel:open': Point & { wheel?: WheelKind };
  'wheel:move': Point & { wheel?: WheelKind };
  'wheel:release': Point & { wheel?: WheelKind };
  'wheel:cancel': null;
  /** `tag` marks a ping from another room member. `keep`: our own ping that stays until 'ping:unkeep' or our next one. */
  'ping:spawn': Point & { id: PingId; tag?: PingTag; keep?: boolean };
  /** Removes the ping kept on this display, if any: we pinged on another display, or paused. */
  'ping:unkeep': null;
  /** `owner` is 'self', 'preview' or a room member: each owner has at most one emote on screen. */
  'emote:spawn': Point & { owner: string; art: EmoteArt; tag?: PingTag };
  'emote:clear': { owner: string };
  'toast:show': { title: string; body: string };
  'overlay:clearMarks': null;
}

export type OverlayChannel = keyof OverlayEvents;

export const OVERLAY_CHANNELS: readonly OverlayChannel[] = [
  'overlay:settings', 'wheel:open', 'wheel:move', 'wheel:release', 'wheel:cancel', 'ping:spawn', 'ping:unkeep', 'emote:spawn', 'emote:clear',
  'toast:show',
  'overlay:clearMarks',
];

/** overlay renderer → main: string[] of asset files that failed to load. */
export const OVERLAY_ASSETS = 'overlay:assets';
/** overlay renderer → main: {id, x, y} of a ping the wheel just placed, so it can be shared with the room. */
export const OVERLAY_PINGED = 'overlay:pinged';
/** overlay renderer → main: {ref, x, y} of an emote the wheel just placed, so it can be shared with the room. */
export const OVERLAY_EMOTED = 'overlay:emoted';

export interface AppStatus {
  enabled: boolean;
  helper: HelperStatus;
  /**
   * macOS only: lolPing is in the Accessibility list but the helper still can't read input. That is a stale entry
   * left by an update (ad-hoc signatures change every build): it has to be removed and added again.
   */
  staleAccess?: boolean;
}

export interface About {
  version: string;
  problems: string[];
  limitations: string[];
}

export type SetSettingsResult = { ok: true; settings: Settings } | { ok: false; error: string; settings: Settings };

export type DeepSeekIssue = 'deepseekKeyMissing' | 'deepseekAuth' | 'deepseekBalance' | 'deepseekRateLimit'
  | 'deepseekTimeout' | 'deepseekFailed' | 'secureStorage';
export type AssistantIssue = 'codexClosed' | 'codexCliMissing' | 'codexSignIn' | 'codexFailed' | 'captureFailed'
  | 'todoStorage' | 'todoLimit' | 'sourceUnavailable' | DeepSeekIssue;
export type AssistantActionResult = { ok: true; latencyMs?: number } | { ok: false; issue: DeepSeekIssue };
export interface AssistantEntry {
  id: string;
  action: AssistantAction;
  title?: string;
  options: AssistantOptions;
  createdAt: number;
  image: string | null;
  question: string;
  answer: string;
  status: 'queued' | 'asking' | 'done' | 'error' | 'cancelled';
  phase?: 'capturing' | 'selecting' | 'searching' | 'answering';
  sources?: AssistantSource[];
  searchQuery?: string;
  todoId?: string;
  issue?: AssistantIssue;
}
export interface AssistantState {
  entries: AssistantEntry[];
  selectedId: string | null;
  codexOpen: boolean;
  codexCliAvailable: boolean;
  codexSignedIn: boolean;
  provider: AssistantProvider;
  deepseekKeySet: boolean;
  mode: AssistantMode;
  todos: AssistantTodo[];
  selectedTodoId: string | null;
  todoImage: string | null;
  workspaceIssue?: AssistantIssue;
  language: Lang;
}
export interface AssistantConfig {
  codexOpen: boolean;
  codexCliAvailable: boolean;
  codexSignedIn: boolean;
  provider: AssistantProvider;
  deepseekKeySet: boolean;
}

// SETTINGS_CH lives in its own module so the settings preload can import it without sharing a chunk
// with the overlay preload (a sandboxed preload can only require('electron'), never a sibling file).
export { SETTINGS_CH } from './settingsChannels';

/** window.settingsApi in the settings renderer. */
export interface SettingsApi {
  readonly platform: Platform;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<SetSettingsResult>;
  onSettings(cb: (s: Settings) => void): () => void;
  getStatus(): Promise<AppStatus>;
  onStatus(cb: (s: AppStatus) => void): () => void;
  setEnabled(on: boolean): Promise<void>;
  previewPing(id: PingId): Promise<void>;
  /** Plays the emote in the middle of the primary display, without sharing it. */
  previewEmote(ref: EmoteRef): Promise<void>;
  /** Saves an image prepared by the settings window and adds it to the imported emotes. */
  importEmote(file: EmoteFile): Promise<ImportResult>;
  /** Deletes an imported emote's files and entry; wheel slots that used it fall back. */
  removeEmote(id: EmoteRef): Promise<void>;
  /** Gives one of our imported emotes a sound (OGG, MP3 or WAV bytes), or takes it away with null. */
  setEmoteSound(id: EmoteRef, sound: Uint8Array | null): Promise<SoundResult>;
  getAbout(): Promise<About>;
  openSettingsFolder(): Promise<void>;
  openProjectPage(): Promise<void>;
  retryHelper(): Promise<void>;
  setCapturing(on: boolean): Promise<void>;
  /** macOS: asks for Accessibility access and opens that page of System Settings. */
  openAccessibility(): Promise<void>;
  getRoom(): Promise<RoomState>;
  onRoom(cb: (s: RoomState) => void): () => void;
  createRoom(): Promise<void>;
  /** Accepts a code or any text containing one. */
  joinRoom(text: string): Promise<JoinResult>;
  leaveRoom(): Promise<void>;
  muteMember(peer: string, on: boolean): Promise<void>;
  /** The room code on the clipboard, if there is one. The clipboard is read only when this is called. */
  clipboardRoomCode(): Promise<string | null>;
  copyRoomCode(): Promise<void>;
  /** Reconnects to every relay now (the Room page's Retry). */
  retryInternet(): Promise<void>;
  /** The main process asks to scroll to a section (e.g. tray → Room settings…). */
  onShowSection(cb: (id: string) => void): () => void;
  /** Where the update checker is, or null when this build has none (a development build): then the page shows no update controls. */
  getUpdate(): Promise<UpdateState | null>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
  /** A manual check for a new version. Does nothing while a check, a download or an install is already running. */
  checkForUpdates(): Promise<void>;
  /** Downloads and installs the version that was found. Returns at once; progress arrives through onUpdate. */
  startUpdate(): Promise<void>;
  /** Opens the release notes of the version that was found, or else the page of the latest release. */
  openReleasePage(): Promise<void>;
  getAssistantConfig(): Promise<AssistantConfig>;
  openAssistantWindow(): Promise<void>;
  saveDeepSeekKey(key: string): Promise<AssistantActionResult>;
  deleteDeepSeekKey(): Promise<AssistantActionResult>;
  testDeepSeek(): Promise<AssistantActionResult>;
  onAssistantConfig(cb: (config: AssistantConfig) => void): () => void;
}

/** window.questionApi in the screenshot explanation window. */
export interface QuestionApi {
  getState(): Promise<AssistantState>;
  onState(cb: (state: AssistantState) => void): () => void;
  openSettings(): void;
  selectEntry(id: string): void;
  deleteEntry(id: string): void;
  clearHistory(): void;
  rerun(id: string, action: AssistantAction, options?: Partial<AssistantOptions>): void;
  copyAnswer(id: string): Promise<boolean>;
  openSource(id: string, sourceId: string): void;
  selectTodo(id: string | null): void;
  renameTodo(id: string, title: string): Promise<boolean>;
  completeTodo(id: string, completed: boolean): Promise<boolean>;
  deleteTodo(id: string): Promise<boolean>;
  clearWorkspace(): void;
  analyzeTodo(id: string, action: AssistantAction): void;
}
