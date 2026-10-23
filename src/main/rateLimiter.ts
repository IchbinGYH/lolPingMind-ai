/** Token bucket per key: `burst` tokens (one second's worth by default), refilled continuously at `perSecond`. Excess calls are refused, never queued. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly now: () => number) {}

  /** `perSecond` 0 means unlimited. */
  allow(key: string, perSecond: number, burst = perSecond): boolean {
    if (perSecond <= 0) return true;
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Tokens in `key`'s bucket right now, without spending any. Unlimited buckets read as Infinity. */
  tokens(key: string, perSecond: number, burst = perSecond): number {
    if (perSecond <= 0) return Infinity;
    const now = this.now();
    const b = this.buckets.get(key) ?? { tokens: burst, at: now };
    return Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
  }

  forget(key: string): void {
    this.buckets.delete(key);
  }

  /** How many keys have a bucket. */
  get size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }
}
