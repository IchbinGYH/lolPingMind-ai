import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantKeyStore, DEEPSEEK_KEY_FILE } from '../../src/main/assistantKeyStore';

const h = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => h.available,
  getSelectedStorageBackend: () => 'test_keyring',
  encryptString: (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
  decryptString: (bytes: Buffer) => {
    if (!bytes.toString().startsWith('sealed:')) throw new Error('invalid ciphertext');
    return Buffer.from(bytes.toString().slice(7), 'base64').toString();
  },
} }));

let directory: string;
beforeEach(async () => {
  h.available = true;
  directory = await mkdtemp(join(tmpdir(), 'lolping-key-test-'));
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('AssistantKeyStore', () => {
  it('has no default key, persists encrypted bytes, and lets another instance read or delete them', async () => {
    const store = new AssistantKeyStore(directory);
    expect(await store.read()).toBeNull();
    await store.save('  test-key-only  ');
    expect((await readFile(join(directory, DEEPSEEK_KEY_FILE))).toString()).not.toContain('test-key-only');
    const reopened = new AssistantKeyStore(directory);
    expect(await reopened.read()).toBe('test-key-only');
    await reopened.delete();
    expect(await store.read()).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('serializes replacement and deletion without leaving a key behind', async () => {
    const store = new AssistantKeyStore(directory);
    await Promise.all([store.save('test-key-one'), store.save('test-key-two'), store.delete()]);
    expect(await store.read()).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('never falls back to writing plaintext when OS encryption is unavailable', async () => {
    h.available = false;
    await expect(new AssistantKeyStore(directory).save('test-key-only')).rejects.toThrow('secureStorage');
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects invalid IPC payloads while keeping the saved key', async () => {
    const store = new AssistantKeyStore(directory);
    await store.save('test-key-only');
    for (const key of [null, {}, '', 'short', 'bad key with spaces', 'x'.repeat(513), 'key\nwithnewline']) {
      await expect(store.save(key)).rejects.toThrow('deepseekAuth');
    }
    expect(await store.read()).toBe('test-key-only');
  });
});
