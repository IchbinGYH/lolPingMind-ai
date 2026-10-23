import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantState } from '../../src/shared/ipc';
import type { AssistantMode } from '../../src/shared/assistantActions';
import { QuestionAssistant } from '../../src/main/questionAssistant';
import { ALL_PINGS } from '../../src/shared/pings';

const h = vi.hoisted(() => ({ key: 'test-key-only' as string | null, request: vi.fn(),
  crops: [] as { x: number; y: number }[], cliAsk: vi.fn(), clear: vi.fn(), select: vi.fn() }));
vi.mock('electron', () => ({
  net: { fetch: (input: unknown, init: unknown) => h.request(input, init) },
  screen: { getAllDisplays: () => [{ id: 1, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 }] },
  desktopCapturer: { getSources: async () => [{ display_id: '1', thumbnail: {
    isEmpty: () => false, getSize: () => ({ width: 1920, height: 1080 }),
    crop: (rect: { x: number; y: number }) => {
      h.crops.push(rect); return { toJPEG: () => Buffer.from('test crop ' + rect.x) };
    },
  } }] },
}));
vi.mock('../../src/main/assistantKeyStore', () => ({ AssistantKeyStore: class {
  async read() { return h.key; }
  async save(key: string) { h.key = key; }
  async delete() { h.key = null; }
} }));
vi.mock('../../src/main/codexCli', () => ({
  CodexCliError: class extends Error {},
  CodexCli: class {
    async available() { return false; }
    async signedIn() { return false; }
    ask = h.cliAsk;
    stop() {}
  },
}));

const stream = (answer: string): Response => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: answer } }] })
  + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
let directory: string;
let unit: QuestionAssistant;
let snapshots: AssistantState[];
let mode: AssistantMode;
const latest = (): AssistantState => snapshots[snapshots.length - 1];
const publish = (state: AssistantState): void => { snapshots.push(structuredClone(state)); };
const make = (capture: (_display: number, run: () => Promise<Buffer>) => Promise<Buffer> = (_display, run) => run()): QuestionAssistant =>
  new QuestionAssistant(directory, () => 'zh-CN', () => 'deepseek', publish, publish, capture, () => mode, h.clear,
    Date.now, h.select);
const settle = async (): Promise<void> => {
  await vi.waitFor(() => expect(latest().entries[0].status).toBe('done'));
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lolping-actions-test-'));
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  h.key = 'test-key-only'; h.crops.length = 0; h.request.mockReset(); h.cliAsk.mockReset(); h.clear.mockClear();
  h.request.mockImplementation(async () => stream('answer'));
  h.select.mockReset(); h.select.mockResolvedValue(Buffer.from('chosen region'));
  snapshots = []; mode = 'all'; unit = make();
});
afterEach(async () => {
  unit.stop(); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

describe('QuestionAssistant', () => {
  it.each(ALL_PINGS)('uses a manually selected crop for two rapid $id signals without a fixed crop', async ({ id }) => {
    if (id === 'enemyvision') h.request.mockImplementation(async (input: unknown) => {
      if (String(input).includes('/chat/completions')) return stream('answer');
      if (String(input).includes('crossref')) return Response.json({ message: { items: [{ DOI: '10.1234/a', title: ['Source'] }] } });
      return Response.json({ query: { pages: {} } });
    });
    unit.handlePing(id, 1, 600, 400);
    await vi.advanceTimersByTimeAsync(600);
    unit.handlePing(id, 1, 700, 500);
    await settle();
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(h.crops).toHaveLength(0);
    expect(latest().entries[0].image).toBe('data:image/jpeg;base64,' + Buffer.from('chosen region').toString('base64'));
    if (id !== 'enemyvision') expect(h.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(latest().entries).toHaveLength(1);
  });

  it('does not send or fall back to a fixed crop when manual selection is cancelled', async () => {
    h.select.mockResolvedValue(null);
    unit.handlePing('missing', 1, 600, 400);
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.crops).toEqual([]);
    expect(latest().entries[0].status).toBe('cancelled');
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200); await settle();
    expect(h.crops).toHaveLength(1);
  });

  it('keeps one manual selection open and cancels it with the workspace', async () => {
    let selectionSignal: AbortSignal | undefined;
    h.select.mockImplementation((_display: number, _language: string, signal: AbortSignal) => {
      selectionSignal = signal;
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
    });
    for (let i = 0; i < 6; i++) unit.handlePing('missing', 1, 600, 400);
    await vi.waitFor(() => expect(h.select).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.request).not.toHaveBeenCalled();
    expect(latest().entries[0].phase).toBe('selecting');
    unit.clearWorkspace();
    await vi.advanceTimersByTimeAsync(0);
    expect(selectionSignal?.aborted).toBe(true);
    expect(latest().entries[0].status).toBe('cancelled');
    expect(h.request).not.toHaveBeenCalled();
  });

  it('allows choosing a follow-up crop while an earlier answer is running, then sends it in order', async () => {
    let release: (response: Response) => void = () => undefined;
    h.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    unit.handlePing('danger', 1, 800, 400);
    unit.handlePing('danger', 1, 800, 400);
    await vi.waitFor(() => expect(latest().entries[0].image).not.toBeNull());
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledTimes(1);
    release(stream('first')); await settle();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(latest().entries[0]).toMatchObject({ action: 'risk', answer: 'answer' });
  });

  it('does not open selection or capture when the answer service is unconfigured', async () => {
    h.key = null;
    unit.handlePing('missing', 1, 600, 400); unit.handlePing('missing', 1, 600, 400);
    await vi.waitFor(() => expect(latest().entries[0].status).toBe('error'));
    expect(latest().entries[0].issue).toBe('deepseekKeyMissing');
    expect(h.select).not.toHaveBeenCalled();
    expect(h.crops).toHaveLength(0);
  });

  it('ignores a late selected crop after the associated history was deleted', async () => {
    let release: (image: Buffer) => void = () => undefined;
    h.select.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { release = resolve; }));
    unit.handlePing('missing', 1, 600, 400); unit.handlePing('missing', 1, 600, 400);
    await vi.waitFor(() => expect(h.select).toHaveBeenCalledTimes(1));
    unit.clearHistory(); release(Buffer.from('late crop'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(latest().entries).toEqual([]);
    expect(h.request).not.toHaveBeenCalled();
  });

  it('cancels a region request immediately when the app is paused during preparation', async () => {
    unit.handlePing('missing', 1, 600, 400); unit.handlePing('missing', 1, 600, 400);
    unit.cancelRegion();
    await vi.advanceTimersByTimeAsync(2000);
    expect(latest().entries[0].status).toBe('cancelled');
    expect(h.select).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it('keeps fixed crops for matching signals outside the repeat window', async () => {
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1300); await settle();
    unit.handlePing('missing', 1, 800, 400);
    await vi.advanceTimersByTimeAsync(1300); await settle();
    expect(h.select).not.toHaveBeenCalled();
    expect(h.crops).toHaveLength(2);
  });

  it('limits manual selection to Enemy Missing in questions-only mode', async () => {
    mode = 'questions';
    for (const id of ['danger', 'generic', 'visioncleared'] as const) {
      unit.handlePing(id, 1, 600, 400); unit.handlePing(id, 1, 600, 400);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.select).not.toHaveBeenCalled();
    expect(h.crops).toHaveLength(0);
    unit.handlePing('missing', 1, 600, 400); unit.handlePing('missing', 1, 600, 400);
    await settle();
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid marks into the latest action and position without requiring Codex in DeepSeek mode', async () => {
    unit.handlePing('missing', 1, 600, 400);
    unit.handlePing('danger', 1, 900, 500);
    unit.handlePing('assist', 1, 1100, 600);
    expect(latest().entries).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1200); await settle();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(latest().entries[0]).toMatchObject({ action: 'help', answer: 'answer', status: 'done' });
    expect(h.crops).toMatchObject([{ x: 620, y: 290 }]);
    expect(h.cliAsk).not.toHaveBeenCalled();
  });

  it('keeps one active request and only one merged follow-up across different actions', async () => {
    let release: (response: Response) => void = () => undefined;
    h.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    unit.handlePing('danger', 1, 800, 400);
    unit.handlePing('push', 1, 1000, 400);
    await vi.advanceTimersByTimeAsync(1200);
    expect(latest().entries).toHaveLength(2);
    expect(h.request).toHaveBeenCalledTimes(1);
    release(stream('first'));
    await settle();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(latest().entries[0]).toMatchObject({ action: 'next', answer: 'answer' });
    expect(latest().entries[1]).toMatchObject({ action: 'explain', answer: 'first' });
  });

  it('cancels an active request and its pending follow-up without reopening a clean workspace', async () => {
    h.request.mockImplementationOnce((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    unit.handlePing('push', 1, 800, 400);
    unit.handlePing('visioncleared', 1, 800, 400);
    await vi.advanceTimersByTimeAsync(1200);
    expect(latest().entries.every((entry) => entry.status === 'cancelled')).toBe(true);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.clear).toHaveBeenCalledTimes(1);
    unit.handlePing('assist', 1, 800, 400);
    await vi.advanceTimersByTimeAsync(1200); await settle();
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('does not send a captured image if the workspace was cleared during capture', async () => {
    let release: (image: Buffer) => void = () => undefined;
    unit = make(async () => new Promise((resolve) => { release = resolve; }));
    unit.handlePing('missing', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(latest().entries[0].status).toBe('asking'));
    unit.clearWorkspace(); release(Buffer.from('crop'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.request).not.toHaveBeenCalled();
    expect(latest().entries[0].status).toBe('cancelled');
  });

  it('saves a task locally when no key or Codex session is available and keeps it when history is cleared', async () => {
    h.key = null;
    unit.handlePing('omw', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200); await settle();
    expect(latest().todos).toHaveLength(1);
    expect(latest().entries[0].todoId).toBe(latest().todos[0].id);
    expect(h.request).not.toHaveBeenCalled();
    const entryId = latest().entries[0].id;
    await unit.selectTodo(latest().todos[0].id);
    expect(latest().todoImage).toMatch(/^data:image\/jpeg;base64,/);
    unit.rerun(entryId, 'explain', {});
    expect(latest().todoImage).toBeNull();
    unit.clearHistory();
    expect(latest().entries).toEqual([]);
    expect((await unit.state()).todos).toHaveLength(1);
  });

  it('does not overwrite a task title edited by the user while a suggested title is being generated', async () => {
    let release: (response: Response) => void = () => undefined;
    h.request.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    unit.handlePing('omw', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    const task = latest().todos[0];
    await unit.changeTodo(task.id, { title: 'My own title' });
    release(stream('Model title')); await settle();
    expect(latest().todos[0].title).toBe('My own title');
  });

  it('uses higher reasoning only for deep analysis and can reuse a screenshot for CSV extraction', async () => {
    unit.handlePing('allin', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200); await settle();
    const firstBody = JSON.parse(h.request.mock.calls[0][1].body);
    expect(firstBody).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 4096 });
    const id = latest().entries[0].id;
    h.request.mockImplementationOnce(async () => stream('```csv\na,b\n1,2\n```'));
    unit.rerun(id, 'extract', { format: 'csv', target: 'auto' });
    await vi.advanceTimersByTimeAsync(1200); await settle();
    expect(h.crops).toHaveLength(1);
    expect(JSON.parse(h.request.mock.calls[1][1].body).thinking).toEqual({ type: 'disabled' });
    expect(JSON.parse(h.request.mock.calls[1][1].body).messages[0].content[0].text).toContain('csv');
    expect(unit.answerForCopy(latest().entries[0].id)).toBe('a,b\n1,2');
  });

  it('looks up real records before answering a source request and exposes validated source links', async () => {
    let turns = 0;
    h.request.mockImplementation(async (input: unknown) => {
      if (String(input).includes('/chat/completions')) return stream(++turns === 1 ? 'EMOTE architecture' : 'Supported background [1].');
      if (String(input).includes('crossref')) return Response.json({ message: { items: [{ DOI: '10.1234/emote', title: ['EMOTE'] }] } });
      return Response.json({ query: { pages: {} } });
    });
    unit.handlePing('enemyvision', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200); await settle();
    const entry = latest().entries[0];
    expect(entry.sources).toMatchObject([{ title: 'EMOTE', url: 'https://doi.org/10.1234/emote' }]);
    expect(unit.sourceUrl(entry.id, '1')).toBe('https://doi.org/10.1234/emote');
    expect(unit.sourceUrl(entry.id, 'forged')).toBeNull();
    expect(turns).toBe(2);
    expect(snapshots.some((state) => state.entries[0]?.phase === 'searching')).toBe(true);
  });

  it('does not reuse a deleted key for the answer stage of an ongoing source search', async () => {
    let turns = 0;
    h.request.mockImplementation(async (input: unknown, init: RequestInit) => {
      if (String(input).includes('/chat/completions')) { turns++; return stream('a topic'); }
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    unit.handlePing('enemyvision', 1, 600, 400);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.waitFor(() => expect(latest().entries[0].phase).toBe('searching'));
    expect(await unit.deleteDeepSeekKey()).toEqual({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(turns).toBe(1);
    expect(latest().entries[0].status).toBe('cancelled');
    expect(latest().deepseekKeySet).toBe(false);
  });

  it('keeps ordinary pings free of capture and requests when classic mode is selected', async () => {
    mode = 'off';
    for (const ping of ['missing', 'danger', 'omw', 'visioncleared', 'generic'] as const) {
      unit.handlePing(ping, 1, 600, 400); unit.handlePing(ping, 1, 600, 400);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect((await unit.state()).entries).toEqual([]);
    expect(h.crops).toEqual([]);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.select).not.toHaveBeenCalled();
  });
});
