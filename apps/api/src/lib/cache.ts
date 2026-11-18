export interface TtlCacheOptions {
  /**
   * How long past its TTL a value may still be served while it refreshes. Older than this and
   * callers wait for fresh data, so a value nobody asked for in a while isn't shown.
   */
  maxStaleMs?: number;
  /** Called when a background refresh fails; the stale value keeps being served. */
  onError?: (key: string, error: unknown) => void;
}

/**
 * Tiny in-process cache for expensive reads (the leaderboard). Callers never wait for a refresh
 * once a value exists, and the work behind a key never runs twice at once:
 *
 * - fresh (within the TTL): returned as is;
 * - stale: returned immediately, and one background refresh starts;
 * - missing or too stale: the first caller loads it and concurrent callers share that load.
 *
 * Load-tested in docs/performance.md. Per instance only: with several API instances each keeps
 * its own copy (see ADR 0003).
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; freshUntil: number }>();
  private loading = new Map<string, Promise<T>>();
  /** Bumped by clear(), so a load that started earlier can't store a pre-clear value. */
  private generation = 0;
  private readonly maxStaleMs: number;

  constructor(
    private readonly ttlMs: number,
    private readonly options: TtlCacheOptions = {},
  ) {
    this.maxStaleMs = options.maxStaleMs ?? 5 * 60_000;
  }

  async getOrSet(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && now < hit.freshUntil) return hit.value;
    if (hit && now < hit.freshUntil + this.maxStaleMs) {
      this.refresh(key, load, now).catch((error) => this.options.onError?.(key, error));
      return hit.value;
    }
    return this.refresh(key, load, now);
  }

  clear() {
    this.entries.clear();
    this.loading.clear();
    this.generation++;
  }

  private refresh(key: string, load: () => Promise<T>, now: number): Promise<T> {
    const running = this.loading.get(key);
    if (running) return running;
    const generation = this.generation;
    const promise = load()
      .then((value) => {
        if (generation === this.generation) {
          this.entries.set(key, { value, freshUntil: now + this.ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.loading.get(key) === promise) this.loading.delete(key);
      });
    this.loading.set(key, promise);
    return promise;
  }
}
