import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCustomRef } from '../shared/emotes';
import { renameWithRetry } from './settingsStore';

/** At most this many stills and this many bytes of friends' emotes are kept; the rest is evicted least recently used first. */
export const CACHE_MAX_FILES = 200;
export const CACHE_MAX_BYTES = 4 * 1024 * 1024;
/** A crashed put leaves a `.tmp` behind; a live one owns its file for milliseconds, so only tmp this old is swept. */
const STALE_TMP_MS = 5 * 60_000;
const NAME_RE = /^([0-9a-f]{32})\.webp$/;

/** Owns `<settings folder>/emote-cache/`: verified stills that arrived over a room, capped, evicted by last use. */
export class EmoteCache {
  readonly dir: string;
  /**
   * What is on disk: each still's size and when it was last stored or shown (the file's mtime after a launch).
   * Kept in use order too, so a tie on `at` goes to the newer use.
   */
  private entries = new Map<string, { size: number; at: number }>();
  /** Set after the first write failure, so the log says so once: received stills stay unavailable (the placeholder). */
  private broken = false;

  constructor(dir: string, private readonly now: () => number) {
    this.dir = dir;
  }

  /** Reads what earlier sessions left behind. Run once at launch, before anything asks has(). */
  async present(): Promise<void> {
    await this.sweep();
  }

  has(hash: string): boolean {
    return this.entries.has(hash);
  }

  /** A display showed this emote: it counts as the most recently used. */
  touch(hash: string): void {
    const e = this.entries.get(hash);
    if (e) this.use(hash, e.size);
  }

  /** Stores a still that has already been verified against its hash and image header. False when the disk refused. */
  async put(hash: string, bytes: Uint8Array): Promise<boolean> {
    if (!isCustomRef(`c:${hash}`)) return false;
    const tmp = join(this.dir, `${hash}.webp.tmp`);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(tmp, bytes);
      await renameWithRetry(tmp, join(this.dir, `${hash}.webp`));
      this.use(hash, bytes.length);
      await this.evict();
      return true;
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      if (!this.broken) {
        this.broken = true;
        console.warn('[emotes] emote cache unavailable:', (err as Error).message);
      }
      return false;
    }
  }

  /** Rebuilds the index from the folder, applies the caps and removes old temp files. A put only evicts. */
  async sweep(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return; // nothing cached yet, or the folder can't be read: empty until a put succeeds
    }
    const entries = new Map<string, { size: number; at: number }>();
    for (const name of names) {
      const m = NAME_RE.exec(name);
      const tmp = name.endsWith('.tmp');
      if (!m && !tmp) continue;
      try {
        const s = await stat(join(this.dir, name));
        if (m) entries.set(m[1], { size: s.size, at: this.entries.get(m[1])?.at ?? s.mtimeMs });
        else if (this.now() - s.mtimeMs > STALE_TMP_MS) await rm(join(this.dir, name), { force: true }).catch(() => undefined);
      } catch {
        // gone between readdir and stat: it is no longer served either
      }
    }
    this.entries = entries;
    await this.evict();
  }

  private use(hash: string, size: number): void {
    this.entries.delete(hash);
    this.entries.set(hash, { size, at: this.now() });
  }

  /** Keeps at most CACHE_MAX_FILES stills and CACHE_MAX_BYTES, evicting the least recently used. */
  private async evict(): Promise<void> {
    const byUse = [...this.entries].reverse().sort((a, b) => b[1].at - a[1].at);
    let files = 0;
    let bytes = 0;
    for (const [hash, e] of byUse) {
      if (files < CACHE_MAX_FILES && bytes + e.size <= CACHE_MAX_BYTES) {
        files++;
        bytes += e.size;
        continue;
      }
      this.entries.delete(hash); // has() says no at once, before the file is gone
      await rm(join(this.dir, `${hash}.webp`), { force: true }).catch(() => undefined);
    }
  }
}
