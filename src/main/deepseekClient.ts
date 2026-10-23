import type { DeepSeekIssue } from '../shared/ipc';

const API_URL = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-flash';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export interface DeepSeekOptions { deep?: boolean; maxTokens?: number; timeoutMs?: number }

export class DeepSeekError extends Error {
  constructor(readonly issue: DeepSeekIssue) {
    super(issue);
    this.name = 'DeepSeekError';
  }
}

function httpIssue(status: number): DeepSeekIssue {
  if (status === 401 || status === 403) return 'deepseekAuth';
  if (status === 402) return 'deepseekBalance';
  if (status === 429) return 'deepseekRateLimit';
  return 'deepseekFailed';
}

function deltaText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') throw new DeepSeekError('deepseekFailed');
  if ('error' in raw) throw new DeepSeekError('deepseekFailed');
  const choices = (raw as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first: unknown = choices[0];
  if (!first || typeof first !== 'object') return '';
  const choice = first as { delta?: unknown; finish_reason?: unknown };
  if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') {
    throw new DeepSeekError('deepseekFailed');
  }
  if (!choice.delta || typeof choice.delta !== 'object') return '';
  const content = (choice.delta as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

/** Reads only answer deltas; reasoning and server error bodies never reach the UI. */
async function streamAnswer(response: Response, onText: (text: string) => void): Promise<string> {
  if (!response.body) throw new DeepSeekError('deepseekFailed');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let bytes = 0;
  let done = false;
  const consume = (line: string): void => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') { done = true; return; }
    const delta = deltaText(JSON.parse(payload) as unknown);
    if (delta) {
      answer += delta;
      onText(answer);
    }
  };
  try {
    while (!done) {
      const next = await reader.read();
      if (next.done) {
        buffer += decoder.decode();
        if (buffer.trim()) consume(buffer);
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new DeepSeekError('deepseekFailed');
      buffer += decoder.decode(next.value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1 && !done) {
        consume(buffer.slice(0, newline).replace(/\r$/, ''));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    if (!done || !answer.trim()) throw new DeepSeekError('deepseekFailed');
    return answer.trim();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Sends one crop directly to DeepSeek Flash without thinking or automatic retries. */
export class DeepSeekClient {
  private readonly requests = new Set<AbortController>();

  constructor(private readonly request: typeof fetch = fetch) {}

  ask(key: string, image: Buffer, prompt: string, onText: (text: string) => void = () => undefined,
    options: DeepSeekOptions = {}): Promise<string> {
    return this.run(async (signal) => {
      const response = await this.request(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal,
        body: JSON.stringify({
          model: MODEL,
          thinking: { type: options.deep ? 'enabled' : 'disabled' },
          ...(options.deep ? { reasoning_effort: 'high' } : {}),
          stream: true,
          max_tokens: options.maxTokens ?? (options.deep ? 4096 : 1200),
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}`, detail: 'original' } },
          ] }],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DeepSeekError(httpIssue(response.status));
      }
      return streamAnswer(response, onText);
    }, options.timeoutMs ?? (options.deep ? 120_000 : REQUEST_TIMEOUT_MS));
  }

  /** Checks the saved key against the model list without uploading a screen or generating billable output. */
  test(key: string): Promise<void> {
    return this.run(async (signal) => {
      const response = await this.request('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DeepSeekError(httpIssue(response.status));
      }
      const raw: unknown = await response.json();
      const models = raw && typeof raw === 'object' ? (raw as { data?: unknown }).data : null;
      if (!Array.isArray(models) || !models.some((model: unknown) => model && typeof model === 'object'
        && (model as { id?: unknown }).id === MODEL)) throw new DeepSeekError('deepseekFailed');
    });
  }

  stop(): void {
    for (const request of this.requests) request.abort();
  }

  private async run<T>(action: (signal: AbortSignal) => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const abort = new AbortController();
    this.requests.add(abort);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
    try {
      return await action(abort.signal);
    } catch (error) {
      if (timedOut) throw new DeepSeekError('deepseekTimeout');
      throw error instanceof DeepSeekError ? error : new DeepSeekError('deepseekFailed');
    } finally {
      clearTimeout(timer);
      this.requests.delete(abort);
    }
  }
}
