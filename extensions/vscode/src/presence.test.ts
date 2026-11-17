import type { PresenceInput } from "@forkyou/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { Presence } from "./presence.js";
import { IDLE_MS } from "./tracker.js";

const SECOND = 1000;

let now: number;
let key: string | undefined;
let sent: PresenceInput[];
let presence: Presence;

beforeEach(() => {
  now = Date.parse("2026-11-17T12:00:00.000Z");
  key = "fy_example";
  sent = [];
  presence = new Presence({
    send: async (_key, body) => {
      sent.push(body);
    },
    getKey: async () => key,
    now: () => now,
  });
});

/** Lets the fire-and-forget sends finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ONLINE_TS = { online: true, editor: "vscode", language: "typescript" };

describe("Presence", () => {
  it("goes online on the first activity", async () => {
    presence.active("typescript");
    await settle();

    expect(sent).toEqual([ONLINE_TS]);
  });

  it("sends at most one heartbeat a minute while active", async () => {
    presence.active("typescript");
    now += 30 * SECOND;
    presence.active("typescript");
    now += 30 * SECOND;
    presence.active("typescript");
    await settle();

    expect(sent).toEqual([ONLINE_TS, ONLINE_TS]);
  });

  it("sends right away when the language changes", async () => {
    presence.active("typescript");
    now += 5 * SECOND;
    presence.active("rust");
    await settle();

    expect(sent.map((s) => s.language)).toEqual(["typescript", "rust"]);
  });

  it("keeps the last language for activity outside files (terminal, debugger)", async () => {
    presence.active("python");
    now += 60 * SECOND;
    presence.active();
    await settle();

    expect(sent.map((s) => s.language)).toEqual(["python", "python"]);
  });

  it("keeps the heartbeat going between interactions while not idle", async () => {
    presence.active("typescript");
    now += 70 * SECOND;
    presence.tick();
    await settle();

    expect(sent).toEqual([ONLINE_TS, ONLINE_TS]);
  });

  it("goes offline once when the user goes idle", async () => {
    presence.active("typescript");
    now += IDLE_MS + SECOND;
    presence.tick();
    presence.tick();
    await settle();

    expect(sent).toEqual([ONLINE_TS, { online: false }]);
  });

  it("goes offline once when the user leaves, and online again when they return", async () => {
    presence.active("typescript");
    await presence.inactive();
    await presence.inactive();
    now += 10 * SECOND;
    presence.active("typescript");
    await settle();

    expect(sent).toEqual([ONLINE_TS, { online: false }, ONLINE_TS]);
  });

  it("delivers updates in order even when an earlier send is slow", async () => {
    const delivered: PresenceInput[] = [];
    let release: () => void = () => {};
    const slowFirst = new Presence({
      send: async (_key, body) => {
        if (delivered.length === 0 && body.online) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        delivered.push(body);
      },
      getKey: async () => key,
      now: () => now,
    });

    slowFirst.active("typescript");
    const offline = slowFirst.inactive();
    await settle();
    release();
    await offline;

    expect(delivered.map((b) => b.online)).toEqual([true, false]);
  });

  it("sends nothing while signed out", async () => {
    key = undefined;
    presence.active("typescript");
    await presence.inactive();

    expect(sent).toEqual([]);
  });

  it("ignores send failures (best effort)", async () => {
    const failing = new Presence({
      send: async () => {
        throw new Error("offline");
      },
      getKey: async () => key,
      now: () => now,
    });

    failing.active("typescript");
    await expect(failing.inactive()).resolves.toBeUndefined();
  });
});
