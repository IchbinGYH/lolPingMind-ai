import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssistantTodo } from '../shared/assistantActions';
import { renameWithRetry } from './settingsStore';

const MAX_TODOS = 100;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function todoTitle(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export class TodoStoreError extends Error {
  constructor(readonly issue: 'todoStorage' | 'todoLimit') { super(issue); }
}

/** Persists user-created tasks and crops locally; answer history remains session-only. */
export class AssistantTodos {
  private readonly directory: string;
  private readonly index: string;
  private loading: Promise<void> | null = null;
  private writing: Promise<unknown> = Promise.resolve();
  private records: AssistantTodo[] = [];

  constructor(directory: string) {
    this.directory = join(directory, 'assistant-todos');
    this.index = join(this.directory, 'index.json');
  }

  async list(): Promise<AssistantTodo[]> {
    await this.load();
    await this.writing.catch(() => undefined);
    return this.records.map((record) => ({ ...record }));
  }

  add(title: string, image: Buffer, createdAt: number): Promise<AssistantTodo> {
    return this.enqueue(async () => {
      if (this.records.length >= MAX_TODOS) throw new TodoStoreError('todoLimit');
      if (!todoTitle(title) || image.byteLength > MAX_IMAGE_BYTES) throw new TodoStoreError('todoStorage');
      await mkdir(this.directory, { recursive: true });
      const record: AssistantTodo = { id: randomUUID(), createdAt, title: todoTitle(title), completed: false };
      const file = join(this.directory, `${record.id}.jpg`);
      await writeFile(file, image, { mode: 0o600 });
      try {
        await this.persist([record, ...this.records]);
        return { ...record };
      } catch (error) {
        await rm(file, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  update(id: unknown, patch: { title?: unknown; completed?: unknown }, expectedTitle?: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!validId(id) || !this.records.some((record) => record.id === id)) return false;
      if (expectedTitle !== undefined && this.records.find((record) => record.id === id)?.title !== expectedTitle) return false;
      if ('title' in patch && (typeof patch.title !== 'string' || !todoTitle(patch.title))) return false;
      if ('completed' in patch && typeof patch.completed !== 'boolean') return false;
      await this.persist(this.records.map((record) => record.id === id ? {
        ...record,
        ...(typeof patch.title === 'string' ? { title: todoTitle(patch.title) } : {}),
        ...(typeof patch.completed === 'boolean' ? { completed: patch.completed } : {}),
      } : record));
      return true;
    });
  }

  delete(id: unknown): Promise<boolean> {
    return this.enqueue(async () => {
      if (!validId(id) || !this.records.some((record) => record.id === id)) return false;
      await rm(join(this.directory, `${id}.jpg`), { force: true });
      await this.persist(this.records.filter((record) => record.id !== id));
      return true;
    });
  }

  async image(id: unknown): Promise<string | null> {
    const records = await this.list();
    if (!validId(id) || !records.some((record) => record.id === id)) return null;
    try {
      const file = join(this.directory, `${id}.jpg`);
      if ((await stat(file)).size > MAX_IMAGE_BYTES) return null;
      return `data:image/jpeg;base64,${(await readFile(file)).toString('base64')}`;
    } catch { return null; }
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        if ((await stat(this.index)).size > 128 * 1024) throw new TodoStoreError('todoStorage');
        const raw: unknown = JSON.parse(await readFile(this.index, 'utf8'));
        if (!Array.isArray(raw)) throw new TodoStoreError('todoStorage');
        const seen = new Set<string>();
        this.records = raw.flatMap((value: unknown): AssistantTodo[] => {
          if (!value || typeof value !== 'object') return [];
          const item = value as Partial<AssistantTodo>;
          if (!validId(item.id) || seen.has(item.id) || typeof item.title !== 'string' || !todoTitle(item.title)
            || typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || typeof item.completed !== 'boolean') return [];
          seen.add(item.id);
          return [{ id: item.id, title: todoTitle(item.title), createdAt: item.createdAt, completed: item.completed }];
        }).slice(0, MAX_TODOS);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new TodoStoreError('todoStorage');
      }
    })();
    return this.loading;
  }

  private async persist(records: AssistantTodo[]): Promise<void> {
    const temporary = `${this.index}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(records), { mode: 0o600 });
      await renameWithRetry(temporary, this.index);
      this.records = records;
    } finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.writing.catch(() => undefined).then(async () => {
      await this.load();
      try { return await action(); }
      catch (error) { throw error instanceof TodoStoreError ? error : new TodoStoreError('todoStorage'); }
    });
    this.writing = run;
    return run;
  }
}
