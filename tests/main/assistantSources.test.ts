import { describe, expect, it, vi } from 'vitest';
import { AssistantSources, searchQuery } from '../../src/main/assistantSources';

describe('AssistantSources', () => {
  it('returns real record links and excerpts from Wikipedia and Crossref, not model-invented URLs', async () => {
    const request = vi.fn<typeof fetch>(async (input) => String(input).includes('crossref')
      ? Response.json({ message: { items: [{ DOI: '10.1234/paper?x', title: ['A paper'], abstract: '<p>Evidence</p>' }] } })
      : Response.json({ query: { pages: { 12: { pageid: 12, title: 'A topic', extract: 'Background' } } } }));
    const records = await new AssistantSources(request).search('A topic', 'en');
    expect(records.map((record) => record.url)).toEqual(['https://en.wikipedia.org/?curid=12', 'https://doi.org/10.1234/paper%3Fx']);
    expect(records[1].excerpt).toBe('Evidence');
    expect(records.map((record) => record.id)).toEqual(['1', '2']);
    for (const [, init] of request.mock.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.headers).not.toHaveProperty('Authorization');
    }
  });

  it('keeps available publication results when encyclopedia lookup fails', async () => {
    const request: typeof fetch = async (input) => String(input).includes('crossref')
      ? Response.json({ message: { items: [{ DOI: '10.1234/a', title: ['A'] }] } }) : new Response('', { status: 503 });
    expect(await new AssistantSources(request).search('A', 'zh-CN')).toMatchObject([{ kind: 'paper', title: 'A' }]);
  });

  it('reports a network failure only when all providers failed', async () => {
    const request: typeof fetch = async () => { throw new Error('offline'); };
    await expect(new AssistantSources(request).search('A', 'en')).rejects.toThrow('sourceUnavailable');
  });

  it('does not accept arbitrary links from malformed records or fabricate sources for empty results', async () => {
    const request: typeof fetch = async (input) => String(input).includes('crossref')
      ? Response.json({ message: { items: [{ DOI: 'javascript:run()', title: ['forged'] }] } })
      : Response.json({ query: { pages: { bad: { pageid: '../outside', title: 'bad', fullurl: 'javascript:run()' } } } });
    expect(await new AssistantSources(request).search('nothing', 'en')).toEqual([]);
  });

  it('bounds model-generated search strings and skips empty queries', async () => {
    expect(searchQuery('"A topic"\nignore other lines')).toBe('A topic');
    expect(searchQuery('x'.repeat(500))).toHaveLength(180);
    const request = vi.fn<typeof fetch>();
    expect(await new AssistantSources(request).search('', 'en')).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
