import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekClient } from '../../src/main/deepseekClient';

const encode = new TextEncoder();
const event = (content: string): string => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
function response(text: string, split = 5): Response {
  const bytes = encode.encode(text);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => vi.useRealTimers());

describe('DeepSeekClient', () => {
  it('enables high reasoning only when deep analysis is requested', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(event('deep answer') + 'data: [DONE]\n\n'));
    await new DeepSeekClient(request).ask('test-key-only', Buffer.from('x'), 'analyze', () => undefined, { deep: true });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      model: 'deepseek-flash', thinking: { type: 'enabled' }, reasoning_effort: 'high', max_tokens: 4096,
    });
  });
  it('sends only the current crop and exact question with thinking disabled, then streams UTF-8 answers', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(`: keepalive\n\n${event('这是一张')}${event('截图。')}data: [DONE]\n\n`, 1));
    const client = new DeepSeekClient(request);
    const updates: string[] = [];
    const answer = await client.ask('test-key-only', Buffer.from('jpeg'), '这个截图里的内容是什么意思', (text) => updates.push(text));
    expect(answer).toBe('这是一张截图。');
    expect(updates).toEqual(['这是一张', '这是一张截图。']);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'deepseek-flash', thinking: { type: 'disabled' }, stream: true, max_tokens: 1200,
      messages: [{ role: 'user', content: [
        { type: 'text', text: '这个截图里的内容是什么意思' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,anBlZw==', detail: 'original' } },
      ] }],
    });
  });

  it.each([[401, 'deepseekAuth'], [403, 'deepseekAuth'], [402, 'deepseekBalance'],
    [429, 'deepseekRateLimit'], [500, 'deepseekFailed']])('maps HTTP %s without exposing the service response or retrying', async (status, issue) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('private server detail', { status: Number(status) }));
    await expect(new DeepSeekClient(request).ask('test-key-only', Buffer.from('x'), 'question')).rejects.toMatchObject({ issue, message: issue });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not display reasoning deltas', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response('data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n'
      + event('answer') + 'data: [DONE]\n\n'));
    const updates: string[] = [];
    expect(await new DeepSeekClient(request).ask('test-key-only', Buffer.from('x'), 'q', (text) => updates.push(text))).toBe('answer');
    expect(updates).toEqual(['answer']);
  });

  it.each([event('partial'), 'data: not-json\n\n', 'data: [DONE]\n\n',
    event('partial') + 'data: {"error":{"message":"private"}}\n\n',
    'data: {"choices":[{"finish_reason":"length","delta":{}}]}\n\n'])('rejects incomplete or malformed streams', async (text) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(text));
    await expect(new DeepSeekClient(request).ask('test-key-only', Buffer.from('x'), 'q')).rejects.toMatchObject({ issue: 'deepseekFailed' });
  });

  it('stops a stalled request after one minute', async () => {
    vi.useFakeTimers();
    const request: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    const result = expect(new DeepSeekClient(request).ask('test-key-only', Buffer.from('x'), 'q'))
      .rejects.toMatchObject({ issue: 'deepseekTimeout' });
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it('tests model access without sending a screenshot', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: 'deepseek-flash' }] }));
    await new DeepSeekClient(request).test('test-key-only');
    expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/models');
    expect(request.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('fails the connection check when Flash is unavailable', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: 'another-model' }] }));
    await expect(new DeepSeekClient(request).test('test-key-only')).rejects.toMatchObject({ issue: 'deepseekFailed' });
  });
});
