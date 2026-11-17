import type { IngestResult, SessionInput } from "@forkyou/shared";
import type { ApiResult } from "./api.js";

const FIRST_RETRY_MS = 60_000;
const MAX_RETRY_MS = 15 * 60_000;
/** Drains a backlog (say, a week offline) in one tick instead of 500 sessions a minute. */
const MAX_BATCHES_PER_TICK = 10;

/** The parts of `SessionQueue` the syncer uses. */
export interface SyncQueue {
  readonly size: number;
  peek(): SessionInput[];
  remove(ids: ReadonlySet<string>): Promise<void>;
  refresh(): Promise<void>;
}

export type StopReason = "unauthorized" | "outdated";

export interface SyncerOptions {
  queue: SyncQueue;
  upload: (apiKey: string, sessions: SessionInput[]) => Promise<ApiResult<IngestResult>>;
  getKey: () => PromiseLike<string | undefined>;
  now: () => number;
  /** Returns a number in [0, 1). Defaults to Math.random; injected so tests are deterministic. */
  random?: () => number;
  log: { info(message: string): void; warn(message: string): void };
  /** Called when the server stops accepting the key (401) or this extension version (410). */
  onStopped: (reason: StopReason) => void;
}

/**
 * Uploads queued sessions (docs/extensions.md → Sync). Sessions leave the queue only after the
 * server has processed them: accepted, duplicate or rejected alike, since a rejected session
 * would be rejected again forever. Network and server errors back off from 1 to 15 minutes, with
 * jitter. A 401
 * or 410 stops uploads until `resume()`; sessions keep queueing meanwhile.
 */
export class Syncer {
  private failures = 0;
  private retryAt = 0;
  private stopped: StopReason | null = null;
  private busy = false;

  constructor(private readonly options: SyncerOptions) {}

  /** Call about once a minute. Never throws. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.options.queue.refresh();
      if (this.stopped || this.options.now() < this.retryAt) return;
      const key = await this.options.getKey();
      if (!key) return;
      for (let i = 0; i < MAX_BATCHES_PER_TICK && this.options.queue.size > 0; i++) {
        if (!(await this.uploadBatch(key))) break;
      }
    } catch (error) {
      this.options.log.warn(`Sync failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.busy = false;
    }
  }

  /** One last upload attempt when VS Code closes. Whatever's left stays queued for next time. */
  async flush(): Promise<void> {
    if (this.stopped || this.options.queue.size === 0) return;
    const key = await this.options.getKey();
    if (key) await this.uploadBatch(key).catch(() => {});
  }

  /** The API key changed: forget earlier failures and try again on the next tick. */
  resume(): void {
    this.stopped = null;
    this.failures = 0;
    this.retryAt = 0;
  }

  /** Returns true if the batch left the queue and another one may follow. */
  private async uploadBatch(key: string): Promise<boolean> {
    const { queue, log } = this.options;
    const batch = queue.peek();
    const ids = new Set(batch.map((s) => s.id));
    const result = await this.options.upload(key, batch);

    if (result.ok) {
      await queue.remove(ids);
      this.failures = 0;
      this.retryAt = 0;
      const { accepted, duplicates, rejected } = result.data;
      log.info(
        `Uploaded ${batch.length} sessions: ${accepted} accepted, ${duplicates} duplicates, ${rejected.length} rejected`,
      );
      for (const [reason, count] of countReasons(rejected)) {
        log.warn(`${count} sessions rejected: ${reason}`);
      }
      return true;
    }

    switch (result.failure) {
      case "network":
      case "server": {
        this.failures++;
        const backoff = Math.min(FIRST_RETRY_MS * 2 ** (this.failures - 1), MAX_RETRY_MS);
        // Wait a random 50-100% of the backoff, so clients that failed together (a server outage)
        // don't all retry in the same second when it comes back.
        const random = this.options.random ?? Math.random;
        const delay = Math.round(backoff * (0.5 + random() / 2));
        this.retryAt = this.options.now() + delay;
        log.warn(`Upload failed (${result.message}); retrying in ${Math.round(delay / 1000)} s`);
        return false;
      }
      case "unauthorized":
      case "outdated":
        this.stopped = result.failure;
        log.warn(`Uploads stopped: ${result.failure} (${result.message})`);
        this.options.onStopped(result.failure);
        return false;
      case "rejected":
        // The server refused the whole request: a bug in the extension. Retrying would block the
        // queue forever, so drop the batch.
        await queue.remove(ids);
        log.warn(`Server refused ${batch.length} sessions (${result.message}); dropped them`);
        return false;
    }
  }
}

function countReasons(rejected: IngestResult["rejected"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { reason } of rejected) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return counts;
}
