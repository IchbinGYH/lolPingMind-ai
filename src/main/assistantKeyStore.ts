import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renameWithRetry } from './settingsStore';

export const DEEPSEEK_KEY_FILE = 'deepseek-api-key.enc';

/** Keys stay in the main process and are encrypted by the current OS user account. */
export class AssistantKeyStore {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {}

  async read(): Promise<string | null> {
    await this.writing.catch(() => undefined);
    if (!this.encryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(await readFile(join(this.directory, DEEPSEEK_KEY_FILE))) || null;
    } catch {
      return null;
    }
  }

  save(raw: unknown): Promise<void> {
    if (typeof raw !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(raw.trim())) {
      return Promise.reject(new Error('deepseekAuth'));
    }
    if (!this.encryptionAvailable()) return Promise.reject(new Error('secureStorage'));
    const encrypted = safeStorage.encryptString(raw.trim());
    return this.enqueue(async () => {
      await mkdir(this.directory, { recursive: true });
      const file = join(this.directory, DEEPSEEK_KEY_FILE);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, encrypted, { mode: 0o600 });
        await renameWithRetry(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  }

  delete(): Promise<void> {
    return this.enqueue(() => rm(join(this.directory, DEEPSEEK_KEY_FILE), { force: true }));
  }

  private encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    this.writing = this.writing.catch(() => undefined).then(action);
    return this.writing;
  }
}
