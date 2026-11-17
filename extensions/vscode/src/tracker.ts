import { LIMITS, type SessionInput } from "@forkyou/shared";

/** A session ends after this long without an edit, selection change or scroll. */
export const IDLE_MS = 2 * 60_000;
const MAX_SESSION_MS = LIMITS.maxSessionSeconds * 1000;

/** What the user is working on. A change of language or project starts a new session. */
export interface WorkContext {
  language: string;
  project?: string;
}

export interface LineCounts {
  added: number;
  removed: number;
}

export interface TrackerOptions {
  now: () => number;
  newId: () => string;
  onSession: (session: SessionInput) => void;
}

interface OpenSession {
  context: WorkContext;
  startMs: number;
  /** Time of the latest activity. A session never extends past it by more than IDLE_MS. */
  lastMs: number;
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Turns editor activity into coding sessions (docs/extensions.md → Sessions).
 *
 * A session is a continuous stretch of work in one language and project. It ends when the user
 * goes idle (at their last activity, so idle time is never counted), when `end()` is called (blur,
 * sign-out, exit), or when the language or project changes. Sessions are split at the server's
 * maximum length and ones under a second are dropped. Sessions emitted by one tracker never
 * overlap, which is what the server's plausibility rules require.
 */
export class SessionTracker {
  private open: OpenSession | null = null;

  constructor(private readonly options: TrackerOptions) {}

  /** An edit (with its line counts), selection change or scroll. */
  activity(context: WorkContext, lines: LineCounts = { added: 0, removed: 0 }): void {
    const now = this.options.now();
    if (this.open && now - this.open.lastMs > IDLE_MS) {
      // Idle long enough that tick() should have closed it (e.g. the machine slept).
      this.close(this.open.lastMs);
    } else if (this.open && !sameContext(this.open.context, context)) {
      this.close(now);
    }

    this.open ??= { context, startMs: now, lastMs: now, linesAdded: 0, linesRemoved: 0 };
    this.open.lastMs = now;
    this.splitLongSession();
    this.open.linesAdded = Math.min(LIMITS.maxLinesPerSession, this.open.linesAdded + lines.added);
    this.open.linesRemoved = Math.min(
      LIMITS.maxLinesPerSession,
      this.open.linesRemoved + lines.removed,
    );
  }

  /**
   * Activity with no file to attribute it to (a terminal command, the debugger, a task). It
   * extends the open session but never starts one, since there's no language or project.
   */
  keepAlive(): void {
    if (!this.open) return;
    const now = this.options.now();
    if (now - this.open.lastMs > IDLE_MS) {
      this.close(this.open.lastMs);
      return;
    }
    this.open.lastMs = now;
    this.splitLongSession();
  }

  /** Call every few seconds: closes a session whose user has gone idle. */
  tick(): void {
    if (this.open && this.options.now() - this.open.lastMs > IDLE_MS) this.close(this.open.lastMs);
  }

  /** Closes the current session now: the window lost focus, the user signed out, or VS Code is closing. */
  end(): void {
    if (this.open) this.close(this.options.now());
  }

  private close(at: number): void {
    if (!this.open) return;
    // The quiet time since the last activity counts only while it's shorter than the idle limit.
    if (at - this.open.lastMs <= IDLE_MS) this.open.lastMs = Math.max(at, this.open.lastMs);
    this.splitLongSession();
    this.emit(this.open);
    this.open = null;
  }

  /** Emits full-length pieces until the open session is no longer than the server allows. */
  private splitLongSession(): void {
    while (this.open && this.open.lastMs - this.open.startMs > MAX_SESSION_MS) {
      const boundary = this.open.startMs + MAX_SESSION_MS;
      const rest: OpenSession = {
        context: this.open.context,
        startMs: boundary,
        lastMs: this.open.lastMs,
        linesAdded: 0,
        linesRemoved: 0,
      };
      this.emit({ ...this.open, lastMs: boundary });
      this.open = rest;
    }
  }

  private emit(session: OpenSession): void {
    // Rounding down keeps a session's end at or before the next one's start.
    const durationSeconds = Math.floor((session.lastMs - session.startMs) / 1000);
    if (durationSeconds < 1) return;
    this.options.onSession({
      id: this.options.newId(),
      startedAt: new Date(session.startMs).toISOString(),
      durationSeconds,
      language: session.context.language,
      ...(session.context.project === undefined ? {} : { project: session.context.project }),
      editor: "vscode",
      linesAdded: session.linesAdded,
      linesRemoved: session.linesRemoved,
    });
  }
}

function sameContext(a: WorkContext, b: WorkContext): boolean {
  return a.language === b.language && a.project === b.project;
}

/** The subset of `vscode.TextDocumentContentChangeEvent` used for counting. */
interface TextChange {
  text: string;
  range: { start: { line: number }; end: { line: number } };
}

/**
 * Lines added and removed by one edit: inserted line breaks count as added lines, replaced line
 * spans as removed. Typing within a line changes neither.
 */
export function countLines(changes: readonly TextChange[]): LineCounts {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    added += change.text.split("\n").length - 1;
    removed += change.range.end.line - change.range.start.line;
  }
  return { added, removed };
}
