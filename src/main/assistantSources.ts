import type { AssistantSource } from '../shared/assistantActions';
import type { Lang } from '../shared/i18n';
import { APP_NAME } from '../shared/branding';

const USER_AGENT = APP_NAME;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  ? value as Record<string, unknown> : {};
const plain = (value: unknown, max = 1100): string => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim().slice(0, max) : '';

export function searchQuery(value: string): string {
  return value.replace(/```[^\n]*\n?/g, '').split(/\r?\n/)[0].replace(/["“”\u0000-\u001f]/g, '').trim().slice(0, 180);
}

export class SourceLookupError extends Error {
  constructor() { super('sourceUnavailable'); }
}

/** Looks up public background and publication records; search hits are never treated as verified claims. */
export class AssistantSources {
  private readonly requests = new Set<AbortController>();
  constructor(private readonly request: typeof fetch = fetch) {}

  async search(query: string, language: Lang): Promise<AssistantSource[]> {
    const clean = searchQuery(query);
    if (!clean) return [];
    const jobs = [this.wikipedia(clean, language === 'zh-CN' ? 'zh' : 'en'), this.crossref(clean)];
    if (language === 'zh-CN') jobs.push(this.wikipedia(clean, 'en'));
    const results = await Promise.allSettled(jobs);
    if (results.every((result) => result.status === 'rejected')) throw new SourceLookupError();
    const records = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    const seen = new Set<string>();
    return records.filter((record) => {
      if (seen.has(record.url)) return false;
      seen.add(record.url); return true;
    }).slice(0, 7).map((record, index) => ({ ...record, id: String(index + 1) }));
  }

  stop(): void { for (const request of this.requests) request.abort(); }

  private async wikipedia(query: string, language: 'en' | 'zh'): Promise<AssistantSource[]> {
    const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
    url.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: query,
      gsrlimit: '2', prop: 'extracts', exintro: '1', explaintext: '1', exchars: '1000', exlimit: '2' }).toString();
    const root = object(await this.json(url));
    if (root.error) throw new SourceLookupError();
    return Object.values(object(object(root.query).pages)).flatMap((value): AssistantSource[] => {
      const item = object(value);
      if (!Number.isSafeInteger(item.pageid) || typeof item.pageid !== 'number' || item.pageid < 1) return [];
      const title = plain(item.title, 240);
      return title ? [{ id: '', title, url: `https://${language}.wikipedia.org/?curid=${item.pageid}`,
        excerpt: plain(item.extract), kind: 'encyclopedia' }] : [];
    });
  }

  private async crossref(query: string): Promise<AssistantSource[]> {
    const url = new URL('https://api.crossref.org/works');
    url.search = new URLSearchParams({ query, rows: '3', select: 'DOI,title,abstract,published,author' }).toString();
    const raw = object(await this.json(url));
    const items = object(raw.message).items;
    if (!Array.isArray(items)) throw new SourceLookupError();
    return items.flatMap((value: unknown): AssistantSource[] => {
      const item = object(value);
      if (typeof item.DOI !== 'string' || !/^10\.\d{4,9}\/\S+$/i.test(item.DOI)) return [];
      const title = Array.isArray(item.title) ? plain(item.title[0], 240) : '';
      const authors = Array.isArray(item.author) ? item.author.slice(0, 3)
        .map((person) => [plain(object(person).given, 60), plain(object(person).family, 60)].filter(Boolean).join(' ')) : [];
      return title ? [{ id: '', title, url: `https://doi.org/${item.DOI.split('/').map(encodeURIComponent).join('/')}`,
        excerpt: [...authors, plain(item.abstract)].filter(Boolean).join('\n').slice(0, 1400), kind: 'paper' }] : [];
    });
  }

  private async json(url: URL): Promise<unknown> {
    const abort = new AbortController();
    this.requests.add(abort);
    const timer = setTimeout(() => abort.abort(), 12_000);
    try {
      const response = await this.request(url, { signal: abort.signal, redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new SourceLookupError(); }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > 1024 * 1024) throw new SourceLookupError();
          chunks.push(next.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    } catch { throw new SourceLookupError(); }
    finally { clearTimeout(timer); this.requests.delete(abort); }
  }
}
