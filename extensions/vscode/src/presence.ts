import { PRESENCE, type PresenceInput } from "@forkyou/shared";
import { IDLE_MS } from "./tracker.js";

const HEARTBEAT_MS = PRESENCE.heartbeatSeconds * 1000;

export interface PresenceOptions {
  /** Sends one heartbeat. Failures are ignored: presence is best effort and never retried. */
  send: (apiKey: string, body: PresenceInput) => Promise<unknown>;
  getKey: () => PromiseLike<string | undefined>;
  now: () => number;
}

/**
 * Tells the server whether the user is coding right now (docs/extensions.md → Presence). While
 * the user is active it sends `online` with the current language, at most once a minute unless
 * the language changes. It sends `offline` once when they go idle, leave the window or sign out.
 * The server also times out a client that stops sending, so a crash needs no cleanup.
 */
export class Presence {
  private online = false;
  private language: string | undefined;
  private lastActivityMs = 0;
  private lastSentMs = 0;
  /** Sends go out one at a time, so a slow `online` can't land after the `offline` that followed. */
  private sending: Promise<void> = Promise.resolve();

  constructor(private readonly options: PresenceOptions) {}

  /** Activity in a file of `language`, or elsewhere in the editor if undefined. */
  active(language?: string): void {
    const now = this.options.now();
    this.lastActivityMs = now;
    const languageChanged = language !== undefined && language !== this.language;
    if (language !== undefined) this.language = language;
    if (!this.online || languageChanged || now - this.lastSentMs >= HEARTBEAT_MS) {
      this.sendOnline(now);
    }
  }

  /** Call every few seconds: keeps the heartbeat going while active, goes offline when idle. */
  tick(): void {
    if (!this.online) return;
    const now = this.options.now();
    if (now - this.lastActivityMs > IDLE_MS) this.inactive();
    else if (now - this.lastSentMs >= HEARTBEAT_MS) this.sendOnline(now);
  }

  /**
   * The user left: idle, window blurred, signed out or VS Code closing. Resolves once pending
   * updates have been sent (or failed), so callers can wait for `offline` before signing out.
   */
  inactive(): Promise<void> {
    if (!this.online) return this.sending;
    this.online = false;
    return this.post({ online: false });
  }

  private sendOnline(now: number): void {
    this.online = true;
    this.lastSentMs = now;
    void this.post({
      online: true,
      editor: "vscode",
      ...(this.language === undefined ? {} : { language: this.language }),
    });
  }

  private post(body: PresenceInput): Promise<void> {
    this.sending = this.sending.then(async () => {
      try {
        const key = await this.options.getKey();
        if (key) await this.options.send(key, body);
      } catch {
        // Best effort: the next heartbeat or the server's timeout corrects any missed update.
      }
    });
    return this.sending;
  }
}
