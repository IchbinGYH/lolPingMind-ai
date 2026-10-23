import { net } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AssistantActionResult, AssistantConfig, AssistantEntry, AssistantIssue, AssistantState } from '../shared/ipc';
import { strings, type Lang } from '../shared/i18n';
import {
  actionForPing, actionPrompt, assistantOptions, DEFAULT_ASSISTANT_OPTIONS, isAssistantAction,
  type AssistantAction, type AssistantMode, type AssistantOptions, type AssistantTodo,
} from '../shared/assistantActions';
import type { PingId } from '../shared/pings';
import { answerSummary, extractedText } from '../shared/assistantMarkdown';
import type { AssistantProvider } from '../shared/settings';
import { AssistantKeyStore } from './assistantKeyStore';
import { CodexCli, CodexCliError } from './codexCli';
import { DeepSeekClient, DeepSeekError, type DeepSeekOptions } from './deepseekClient';
import { AssistantTodos, todoTitle, TodoStoreError } from './assistantTodos';
import { AssistantSources, searchQuery, SourceLookupError } from './assistantSources';
import { captureAround } from './screenCapture';
import { PING_REPEAT_MS, repeatedPing, type TimedPing } from '../shared/pingRepeat';

const MAX_ENTRIES = 24;
const PING_DEBOUNCE_MS = PING_REPEAT_MS;
const LEGACY_KEY_FILE = 'openai-api-key.enc';

interface PendingPing {
  id: string;
  displayId: number;
  x: number;
  y: number;
  ready: boolean;
  action: AssistantAction;
  options: AssistantOptions;
  image?: Buffer;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 3000, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? '' : stdout);
    });
  });
}

/** The Codex desktop host is named ChatGPT.exe on Windows; a CLI process alone does not satisfy the gate. */
async function codexIsOpen(): Promise<boolean> {
  if (process.platform === 'win32') {
    const powershell = join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const output = await run(powershell, [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id)',
    ]);
    if (output.trim()) return true;
    const tasklist = await run('tasklist.exe', ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH']);
    return tasklist.toLowerCase().includes('chatgpt.exe');
  }
  const output = await run('ps', ['-A', '-o', 'comm=']);
  const names = output.split(/\r?\n/).map((line) => basename(line.trim()).toLowerCase());
  return names.some((name) => name === 'chatgpt' || name === 'codex');
}

export class QuestionAssistant {
  private entries: AssistantEntry[] = [];
  private selectedId: string | null = null;
  private todos: AssistantTodo[] = [];
  private selectedTodoId: string | null = null;
  private todoImage: string | null = null;
  private workspaceIssue: AssistantIssue | undefined;
  private codexOpen = false;
  private codexCliAvailable = false;
  private codexSignedIn = false;
  private codexCheck: Promise<boolean> | null = null;
  private pending: PendingPing | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private processing = false;
  private activeId: string | null = null;
  private lastPing: TimedPing | null = null;
  private selection: AbortController | null = null;
  private epoch = 0;
  private readonly codexCli: CodexCli;
  private readonly keys: AssistantKeyStore;
  private readonly todoStore: AssistantTodos;
  private readonly deepseek = new DeepSeekClient((input, init) => net.fetch(input instanceof URL ? input.toString() : input, init));
  private readonly sources = new AssistantSources((input, init) => net.fetch(input instanceof URL ? input.toString() : input, init));
  private deepseekKeySet = false;

  constructor(
    directory: string,
    private readonly language: () => Lang,
    private readonly provider: () => AssistantProvider,
    private readonly publish: (state: AssistantState) => void,
    private readonly present: (state: AssistantState) => void,
    private readonly withCleanCapture: (displayId: number, capture: () => Promise<Buffer>) => Promise<Buffer>,
    private readonly mode: () => AssistantMode = () => 'all',
    private readonly clearView: () => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly captureRegion: (displayId: number, language: Lang, signal: AbortSignal) => Promise<Buffer | null>
      = async () => null,
  ) {
    this.codexCli = new CodexCli(directory);
    this.keys = new AssistantKeyStore(directory);
    this.todoStore = new AssistantTodos(directory);
    void rm(join(directory, LEGACY_KEY_FILE), { force: true }).catch(() => undefined);
  }

  async config(): Promise<AssistantConfig> {
    this.deepseekKeySet = (await this.keys.read()) !== null;
    if (this.provider() === 'codex' && this.mode() !== 'off') {
      const [, available, signedIn] = await Promise.all([
        this.checkCodex(), this.codexCli.available(), this.codexCli.signedIn(),
      ]);
      this.codexCliAvailable = available;
      this.codexSignedIn = signedIn;
    }
    return {
      codexOpen: this.codexOpen, codexCliAvailable: this.codexCliAvailable, codexSignedIn: this.codexSignedIn,
      provider: this.provider(), deepseekKeySet: this.deepseekKeySet,
    };
  }

  async state(): Promise<AssistantState> {
    await Promise.all([this.config(), this.refreshTodos()]);
    return this.snapshot();
  }

  async refresh(): Promise<AssistantState> {
    const state = await this.state();
    this.publish(state);
    return state;
  }

  async saveDeepSeekKey(raw: unknown): Promise<AssistantActionResult> {
    try {
      await this.keys.save(raw);
      this.deepseekKeySet = true;
      this.notify();
      return { ok: true };
    } catch (error) {
      return { ok: false, issue: error instanceof Error && error.message === 'deepseekAuth'
        ? 'deepseekAuth' : 'secureStorage' };
    }
  }

  async deleteDeepSeekKey(): Promise<AssistantActionResult> {
    try {
      this.cancelPending();
      this.cancelRunning();
      await this.keys.delete();
      this.deepseekKeySet = false;
      this.notify();
      return { ok: true };
    } catch { return { ok: false, issue: 'secureStorage' }; }
  }

  async testDeepSeek(): Promise<AssistantActionResult> {
    const key = await this.keys.read();
    if (!key) return { ok: false, issue: 'deepseekKeyMissing' };
    const start = this.now();
    try {
      await this.deepseek.test(key);
      return { ok: true, latencyMs: this.now() - start };
    } catch (error) {
      return { ok: false, issue: error instanceof DeepSeekError ? error.issue : 'deepseekFailed' };
    }
  }

  handlePing(ping: PingId, displayId: number, x: number, y: number): void {
    const mode = this.mode();
    if (mode === 'off' || (mode === 'questions' && ping !== 'missing')) { this.lastPing = null; return; }
    if (this.selection) return;
    const current: TimedPing = { ping, displayId, at: this.now() };
    const repeated = repeatedPing(this.lastPing, current);
    this.lastPing = repeated ? null : current;
    const action = actionForPing(ping, mode);
    if (repeated) {
      this.enqueue(action && action !== 'clear' ? action : 'explain', displayId, x, y, DEFAULT_ASSISTANT_OPTIONS);
      void this.selectRegion();
      return;
    }
    if (action === 'clear') { this.clearWorkspace(); return; }
    if (action) this.enqueue(action, displayId, x, y, DEFAULT_ASSISTANT_OPTIONS);
  }

  rerun(id: unknown, action: unknown, rawOptions: unknown): void {
    if (typeof id !== 'string' || !isAssistantAction(action) || action === 'clear') return;
    const entry = this.entries.find((item) => item.id === id);
    if (!entry?.image) return;
    const image = Buffer.from(entry.image.slice('data:image/jpeg;base64,'.length), 'base64');
    this.enqueue(action, 0, 0, 0, assistantOptions(rawOptions), image);
  }

  async analyzeTodo(id: unknown, action: unknown): Promise<void> {
    if (!isAssistantAction(action) || action === 'clear' || action === 'todo') return;
    const image = await this.todoStore.image(id).catch(() => null);
    if (image) this.enqueue(action, 0, 0, 0, DEFAULT_ASSISTANT_OPTIONS,
      Buffer.from(image.slice('data:image/jpeg;base64,'.length), 'base64'));
  }

  selectEntry(id: unknown): void {
    if (typeof id !== 'string' || !this.entries.some((entry) => entry.id === id)) return;
    this.selectedId = id;
    this.selectedTodoId = null;
    this.todoImage = null;
    this.notify();
  }

  deleteEntry(id: unknown): void {
    if (typeof id !== 'string' || !this.entries.some((entry) => entry.id === id)) return;
    if (this.pending?.id === id) this.cancelPending();
    if (this.activeId === id) this.cancelRunning();
    this.entries = this.entries.filter((entry) => entry.id !== id);
    if (this.selectedId === id) this.selectedId = this.entries[0]?.id ?? null;
    this.notify();
  }

  clearHistory(): void {
    this.lastPing = null;
    this.cancelPending();
    this.cancelRunning();
    this.entries = [];
    this.selectedId = null;
    this.notify();
  }

  answerForCopy(id: unknown): string | null {
    const entry = this.entries.find((entry) => entry.id === id);
    return entry?.answer ? entry.action === 'extract' ? extractedText(entry.answer) : entry.answer : null;
  }

  sourceUrl(id: unknown, sourceId: unknown): string | null {
    return this.entries.find((entry) => entry.id === id)?.sources?.find((source) => source.id === sourceId)?.url ?? null;
  }

  async selectTodo(id: unknown): Promise<void> {
    if (id === null) {
      this.selectedTodoId = null;
      this.todoImage = null;
      this.notify();
      return;
    }
    if (typeof id !== 'string' || !this.todos.some((todo) => todo.id === id)) return;
    this.selectedTodoId = id;
    this.todoImage = null;
    this.notify();
    const image = await this.todoStore.image(id).catch(() => null);
    if (this.selectedTodoId === id) { this.todoImage = image; this.notify(); }
  }

  async changeTodo(id: unknown, patch: { title?: unknown; completed?: unknown }): Promise<boolean> {
    try {
      const result = await this.todoStore.update(id, patch);
      await this.refreshTodos();
      this.notify();
      return result;
    } catch {
      this.workspaceIssue = 'todoStorage';
      this.notify();
      return false;
    }
  }

  async deleteTodo(id: unknown): Promise<boolean> {
    try {
      const result = await this.todoStore.delete(id);
      if (this.selectedTodoId === id) { this.selectedTodoId = null; this.todoImage = null; }
      await this.refreshTodos();
      this.notify();
      return result;
    } catch {
      this.workspaceIssue = 'todoStorage';
      this.notify();
      return false;
    }
  }

  clearWorkspace(): void {
    this.cancelPending();
    this.cancelRunning();
    this.notify();
    this.clearView();
  }

  stop(): void {
    this.lastPing = null;
    this.cancelPending();
    this.cancelRunning();
  }

  cancelRegion(): void {
    if (!this.selection) return;
    this.lastPing = null;
    this.cancelPending();
    this.notify();
  }

  private enqueue(action: AssistantAction, displayId: number, x: number, y: number,
    options: AssistantOptions, image?: Buffer): void {
    this.cancelSelection();
    const question = strings(this.language()).assistantRequests[action];
    const createdAt = this.now();
    const imageUrl = image ? 'data:image/jpeg;base64,' + image.toString('base64') : null;
    this.selectedTodoId = null;
    this.todoImage = null;
    if (this.pending) {
      Object.assign(this.pending, { action, displayId, x, y, options: { ...options }, image, ready: false });
      this.update(this.pending.id, { action, options: { ...options }, createdAt, image: imageUrl, question,
        title: undefined, answer: '', sources: undefined, searchQuery: undefined, todoId: undefined,
        issue: undefined, phase: undefined, status: 'queued' });
    } else {
      const id = randomUUID();
      this.pending = { id, action, displayId, x, y, options: { ...options }, image, ready: false };
      const entry: AssistantEntry = { id, action, options: { ...options }, createdAt, image: imageUrl, question,
        answer: '', status: 'queued' };
      this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES);
      this.selectedId = id;
      this.present(this.snapshot());
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pending) this.pending.ready = true;
      void this.processPending();
    }, PING_DEBOUNCE_MS);
  }

  private async selectRegion(): Promise<void> {
    const request = this.pending;
    if (!request) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const controller = new AbortController();
    this.selection = controller;
    this.update(request.id, { phase: 'selecting' });
    try {
      if (request.action !== 'todo') await this.credentials(this.provider());
      if (controller.signal.aborted) return;
      const image = await this.captureRegion(request.displayId, this.language(), controller.signal);
      if (controller.signal.aborted || this.pending !== request) return;
      if (!image) { this.cancelPending(); this.notify(); return; }
      request.image = image;
      request.ready = true;
      this.update(request.id, { image: 'data:image/jpeg;base64,' + image.toString('base64'), phase: undefined });
    } catch (error) {
      if (controller.signal.aborted || this.pending !== request) return;
      this.pending = null;
      this.update(request.id, { status: 'error', phase: undefined,
        issue: error instanceof AssistantError ? error.issue : 'captureFailed' });
      this.present(this.snapshot());
    } finally {
      if (this.selection === controller) this.selection = null;
      if (this.pendingIsReady()) void this.processPending();
    }
  }

  private async processPending(): Promise<void> {
    if (this.processing || !this.pending?.ready) return;
    const request = this.pending;
    this.pending = null;
    this.processing = true;
    this.activeId = request.id;
    const epoch = this.epoch;
    const current = (): void => {
      if (epoch !== this.epoch || !this.entries.some((entry) => entry.id === request.id)) throw new CancelledAction();
    };
    this.selectedId = request.id;
    this.selectedTodoId = null;
    this.todoImage = null;
    this.update(request.id, { status: 'asking', phase: 'capturing' });
    try {
      const provider = this.provider();
      const key = request.action === 'todo' ? null : await this.credentials(provider);
      current();
      const image = request.image ?? await this.withCleanCapture(request.displayId,
        () => captureAround(request.displayId, request.x, request.y));
      current();
      this.update(request.id, { image: 'data:image/jpeg;base64,' + image.toString('base64'), phase: 'answering' });
      this.present(this.snapshot());
      const text = strings(this.language());
      if (request.action === 'todo') {
        const record = await this.todoStore.add(text.questionTodoDefault, image, this.now());
        await this.refreshTodos();
        current();
        this.update(request.id, { todoId: record.id, answer: text.questionTodoSaved(record.title) });
        let title = record.title;
        let enhanced = false;
        try {
          const todoKey = await this.credentials(provider);
          current();
          const suggested = await this.ask(provider, todoKey, image, text.assistantPrompts.todo,
            () => undefined, { maxTokens: 128, timeoutMs: 8000 });
          current();
          const candidate = todoTitle(suggested.replace(/^[#*"\s]+|["\s]+$/g, ''));
          if (candidate && await this.todoStore.update(record.id, { title: candidate }, record.title)) {
            title = candidate;
            enhanced = true;
          } else {
            const saved = (await this.todoStore.list()).find((todo) => todo.id === record.id);
            if (saved) { title = saved.title; enhanced = true; }
          }
        } catch (error) { if (error instanceof CancelledAction) throw error; }
        current();
        await this.refreshTodos();
        this.update(request.id, { status: 'done', title: text.assistantRecordTitle(text.assistantActionNames.todo, title),
          answer: text.questionTodoSaved(title)
          + (enhanced ? '' : '\n' + text.questionTodoOffline) });
        return;
      }
      let prompt = actionPrompt(request.action, text, request.options);
      if (request.action === 'sources') {
        const rawQuery = await this.ask(provider, key, image, text.assistantSearchQueryPrompt,
          () => undefined, { maxTokens: 160 });
        current();
        const query = searchQuery(rawQuery);
        this.update(request.id, { phase: 'searching', searchQuery: query,
          title: text.assistantRecordTitle(text.assistantActionNames.sources, query) });
        const sources = await this.sources.search(query, this.language());
        current();
        this.update(request.id, { sources, phase: 'answering' });
        if (!sources.length) {
          this.update(request.id, { status: 'done', answer: text.questionNoSources });
          return;
        }
        prompt += '\n\n' + JSON.stringify(sources);
      }
      let lastPublished = -Infinity;
      const answer = await this.ask(provider, key, image, prompt, (answer) => {
        if (epoch !== this.epoch || this.now() - lastPublished < 100) return;
        lastPublished = this.now();
        this.update(request.id, { answer });
      }, { deep: request.action === 'deep', maxTokens: request.action === 'extract' || request.action === 'deep' ? 4096 : 1600 });
      current();
      this.update(request.id, { answer, status: 'done', issue: undefined,
        title: text.assistantRecordTitle(text.assistantActionNames[request.action],
          this.entries.find((entry) => entry.id === request.id)?.searchQuery || answerSummary(answer)) });
    } catch (error) {
      if (epoch !== this.epoch || error instanceof CancelledAction) {
        this.update(request.id, { status: 'cancelled' });
      } else {
        const issue = error instanceof AssistantError ? error.issue
          : error instanceof DeepSeekError ? error.issue
            : error instanceof TodoStoreError ? error.issue
              : error instanceof SourceLookupError ? 'sourceUnavailable'
                : error instanceof CodexCliError ? error.issue === 'cliMissing' ? 'codexCliMissing'
                  : error.issue === 'signIn' ? 'codexSignIn' : 'codexFailed'
                  : 'captureFailed';
        this.update(request.id, { status: 'error', issue });
      }
    } finally {
      this.processing = false;
      this.activeId = null;
      if (this.pendingIsReady()) void this.processPending();
    }
  }

  private async credentials(provider: AssistantProvider): Promise<string | null> {
    if (provider === 'deepseek') {
      const key = await this.keys.read();
      this.deepseekKeySet = key !== null;
      if (!key) throw new AssistantError('deepseekKeyMissing');
      return key;
    }
    if (!await this.checkCodex()) throw new AssistantError('codexClosed');
    if (!await this.codexCli.available()) throw new AssistantError('codexCliMissing');
    this.codexCliAvailable = true;
    if (!await this.codexCli.signedIn()) throw new AssistantError('codexSignIn');
    this.codexSignedIn = true;
    return null;
  }

  private pendingIsReady(): boolean { return this.pending?.ready === true; }

  private ask(provider: AssistantProvider, key: string | null, image: Buffer, prompt: string,
    onText: (text: string) => void, options: DeepSeekOptions): Promise<string> {
    if (provider === 'deepseek') {
      if (!key) return Promise.reject(new AssistantError('deepseekKeyMissing'));
      return this.deepseek.ask(key, image, prompt, onText, options);
    }
    return this.codexCli.ask(image, prompt, options.deep, options.timeoutMs);
  }

  private cancelPending(): void {
    this.cancelSelection();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    const id = this.pending?.id;
    this.pending = null;
    if (id) this.entries = this.entries.map((entry) => entry.id === id
      ? { ...entry, status: 'cancelled', phase: undefined } : entry);
  }

  private cancelSelection(): void {
    this.selection?.abort();
    this.selection = null;
  }

  private cancelRunning(): void {
    this.epoch++;
    this.codexCli.stop();
    this.deepseek.stop();
    this.sources.stop();
    if (this.activeId) this.entries = this.entries.map((entry) => entry.id === this.activeId
      ? { ...entry, status: 'cancelled' } : entry);
  }

  private async refreshTodos(): Promise<void> {
    try {
      this.todos = await this.todoStore.list();
      this.workspaceIssue = undefined;
    } catch { this.workspaceIssue = 'todoStorage'; }
  }

  private async checkCodex(): Promise<boolean> {
    if (!this.codexCheck) this.codexCheck = codexIsOpen().finally(() => { this.codexCheck = null; });
    this.codexOpen = await this.codexCheck;
    return this.codexOpen;
  }

  private snapshot(): AssistantState {
    return {
      entries: this.entries, selectedId: this.selectedId, codexOpen: this.codexOpen,
      codexCliAvailable: this.codexCliAvailable, codexSignedIn: this.codexSignedIn,
      provider: this.provider(), deepseekKeySet: this.deepseekKeySet, language: this.language(),
      mode: this.mode(), todos: this.todos, selectedTodoId: this.selectedTodoId, todoImage: this.todoImage,
      workspaceIssue: this.workspaceIssue,
    };
  }

  private update(id: string, patch: Partial<AssistantEntry>): void {
    this.entries = this.entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
    this.notify();
  }

  private notify(): void { this.publish(this.snapshot()); }
}

class AssistantError extends Error {
  constructor(readonly issue: AssistantIssue) { super(issue); }
}

class CancelledAction extends Error {}
