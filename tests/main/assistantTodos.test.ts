import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssistantTodos } from '../../src/main/assistantTodos';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'lolping-todos-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('AssistantTodos', () => {
  it('persists tasks, screenshots, renamed titles and completion across restarts', async () => {
    const store = new AssistantTodos(directory);
    expect(await store.list()).toEqual([]);
    const record = await store.add('Read this diagram', Buffer.from('jpeg'), 100);
    const reopened = new AssistantTodos(directory);
    expect(await reopened.list()).toEqual([record]);
    expect(await reopened.image(record.id)).toBe('data:image/jpeg;base64,anBlZw==');
    expect(await reopened.update(record.id, { title: '  Review\narchitecture  ', completed: true })).toBe(true);
    expect(await new AssistantTodos(directory).list()).toEqual([{ ...record, title: 'Review architecture', completed: true }]);
  });

  it('deletes both the screenshot and task record while keeping other tasks', async () => {
    const store = new AssistantTodos(directory);
    const first = await store.add('first', Buffer.from('one'), 1);
    const second = await store.add('second', Buffer.from('two'), 2);
    await store.delete(first.id);
    expect(await store.list()).toEqual([second]);
    expect(await store.image(first.id)).toBeNull();
    expect(await readdir(join(directory, 'assistant-todos'))).toEqual(expect.arrayContaining(['index.json', second.id + '.jpg']));
    expect(await readdir(join(directory, 'assistant-todos'))).not.toContain(first.id + '.jpg');
  });

  it('serializes simultaneous changes without losing another task', async () => {
    const store = new AssistantTodos(directory);
    const records = await Promise.all([store.add('one', Buffer.from('x'), 1), store.add('two', Buffer.from('x'), 2)]);
    await Promise.all([store.update(records[0].id, { completed: true }), store.update(records[1].id, { title: 'renamed' })]);
    expect(await store.list()).toEqual([{ ...records[1], title: 'renamed' }, { ...records[0], completed: true }]);
  });

  it('does not overwrite a user title with a delayed suggestion queued behind it', async () => {
    const store = new AssistantTodos(directory);
    const record = await store.add('default title', Buffer.from('x'), 1);
    const results = await Promise.all([
      store.update(record.id, { title: 'User title' }),
      store.update(record.id, { title: 'Suggested title' }, record.title),
    ]);
    expect(results).toEqual([true, false]);
    expect((await store.list())[0].title).toBe('User title');
  });

  it('rejects forged paths and invalid patches without modifying data', async () => {
    const store = new AssistantTodos(directory);
    const record = await store.add('valid', Buffer.from('x'), 1);
    expect(await store.update('../outside', { completed: true })).toBe(false);
    expect(await store.delete('../outside')).toBe(false);
    expect(await store.image('../outside')).toBeNull();
    expect(await store.update(record.id, { title: '' })).toBe(false);
    expect(await store.update(record.id, { completed: 'yes' })).toBe(false);
    expect(await store.list()).toEqual([record]);
  });

  it('leaves a corrupt task index untouched rather than overwriting it', async () => {
    await mkdir(join(directory, 'assistant-todos'));
    const file = join(directory, 'assistant-todos', 'index.json');
    await writeFile(file, 'not json');
    await expect(new AssistantTodos(directory).add('new', Buffer.from('x'), 1)).rejects.toMatchObject({ issue: 'todoStorage' });
    expect(await readFile(file, 'utf8')).toBe('not json');
  });

  it('enforces the task and image limits without creating extra files', async () => {
    await mkdir(join(directory, 'assistant-todos'));
    const records = Array.from({ length: 100 }, (_, i) => ({
      id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), title: 'task', createdAt: i, completed: false,
    }));
    await writeFile(join(directory, 'assistant-todos', 'index.json'), JSON.stringify(records));
    await expect(new AssistantTodos(directory).add('new', Buffer.from('x'), 1)).rejects.toMatchObject({ issue: 'todoLimit' });
    const empty = new AssistantTodos(join(directory, 'empty'));
    await expect(empty.add('oversize', Buffer.alloc(4 * 1024 * 1024 + 1), 1)).rejects.toMatchObject({ issue: 'todoStorage' });
  });
});
