/** Tiny in-process TTL cache. Fine for one API instance; swap for Redis when we scale out. */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  async getOrSet(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = await load();
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }

  clear() {
    this.entries.clear();
  }
}
