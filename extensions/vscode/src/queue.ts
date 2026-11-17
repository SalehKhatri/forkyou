import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LIMITS, type SessionInput, sessionInputSchema } from "@forkyou/shared";

/** A queue file not written for this long belongs to a window that's gone; another window adopts it. */
export const STALE_MS = 5 * 60_000;
const MAX_AGE_MS = LIMITS.maxSessionAgeDays * 24 * 60 * 60_000;
const FILE_PATTERN = /^queue-[\w-]+\.json$/;

/**
 * Closed sessions waiting to be uploaded, persisted so they survive restarts and offline periods.
 *
 * Every VS Code window runs its own copy of the extension. Each window writes only its own file
 * (`queue-<windowId>.json`) so concurrent windows can't overwrite each other's sessions, and
 * `touch()` refreshes the file while the window is alive. Files from windows that stopped
 * refreshing them are adopted. Two windows adopting the same file at once upload some sessions
 * twice; the server recognises those as duplicates by id. Sessions are never lost this way.
 */
export class SessionQueue {
  private sessions: SessionInput[] = [];
  private readonly file: string;
  /** Serialises disk writes so they land in the order they were made. */
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly dir: string,
    windowId: string,
    private readonly now: () => number,
  ) {
    this.file = join(dir, `queue-${windowId}.json`);
  }

  get size(): number {
    return this.sessions.length;
  }

  /** The oldest sessions, up to one request's worth. */
  peek(max: number = LIMITS.maxSessionsPerBatch): SessionInput[] {
    return this.sessions.slice(0, max);
  }

  add(session: SessionInput): Promise<void> {
    this.sessions.push(session);
    return this.save();
  }

  /** Discards everything queued, e.g. on sign-out, so another account never uploads it. */
  clear(): Promise<void> {
    this.sessions = [];
    return this.save();
  }

  remove(ids: ReadonlySet<string>): Promise<void> {
    this.sessions = this.sessions.filter((s) => !ids.has(s.id));
    return this.save();
  }

  /**
   * Marks this window as alive, adopts queues from windows that aren't, and drops sessions too old
   * for the server to accept. Call on startup and then about once a minute.
   */
  async refresh(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const adopted = await this.adoptStaleQueues();
    const cutoff = this.now() - MAX_AGE_MS;
    const known = new Set(this.sessions.map((s) => s.id));
    this.sessions = [...this.sessions, ...adopted.filter((s) => !known.has(s.id))].filter(
      (s) => Date.parse(s.startedAt) >= cutoff,
    );
    await this.save();
  }

  /** Resolves once every write so far has reached the disk. */
  flushed(): Promise<void> {
    return this.writes;
  }

  private async adoptStaleQueues(): Promise<SessionInput[]> {
    const names = (await readdir(this.dir)).filter((n) => FILE_PATTERN.test(n));
    const adopted: SessionInput[] = [];
    for (const name of names) {
      const path = join(this.dir, name);
      if (path === this.file) continue;
      const info = await stat(path).catch(() => undefined);
      if (!info || this.now() - info.mtimeMs < STALE_MS) continue;
      const sessions = await readSessions(path);
      if (sessions === undefined) continue; // Unreadable: leave it rather than lose it.
      adopted.push(...sessions);
      await unlink(path).catch(() => {}); // Another window may have adopted it first.
    }
    return adopted;
  }

  private save(): Promise<void> {
    const snapshot = JSON.stringify(this.sessions);
    const empty = this.sessions.length === 0;
    const write = this.writes.then(async () => {
      if (empty) {
        await unlink(this.file).catch(() => {});
        return;
      }
      // Write then rename, so a crash mid-write can't leave a truncated file.
      const temp = `${this.file}.tmp`;
      await writeFile(temp, snapshot);
      await rename(temp, this.file);
    });
    // A failed write is reported to its caller but mustn't block later writes, which carry the
    // full queue and so repair it.
    this.writes = write.catch(() => {});
    return write;
  }
}

async function readSessions(path: string): Promise<SessionInput[] | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(value)) return undefined;
    // One malformed entry would get its whole batch rejected, so keep only valid sessions.
    return value.flatMap((item) => {
      const parsed = sessionInputSchema.safeParse(item);
      return parsed.success ? [item as SessionInput] : [];
    });
  } catch {
    return undefined;
  }
}
