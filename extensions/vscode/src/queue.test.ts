import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionInput } from "@forkyou/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionQueue, STALE_MS } from "./queue.js";

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "forkyou-queue-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function session(n: number, startedAt = "2026-11-17T10:00:00.000Z"): SessionInput {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    startedAt,
    durationSeconds: 60,
    language: "typescript",
    editor: "vscode",
    linesAdded: 0,
    linesRemoved: 0,
  };
}

const queue = (windowId: string) => new SessionQueue(dir, windowId, () => NOW);

/** Writes another window's queue file, last modified `ageMs` ago. */
async function otherWindowFile(windowId: string, sessions: unknown, ageMs: number) {
  const path = join(dir, `queue-${windowId}.json`);
  await writeFile(path, JSON.stringify(sessions));
  const mtime = new Date(NOW - ageMs);
  await utimes(path, mtime, mtime);
}

const files = async () => (await readdir(dir)).sort();
const ids = (q: SessionQueue) => q.peek().map((s) => s.id);

describe("SessionQueue", () => {
  it("persists sessions to this window's file", async () => {
    const q = queue("a");
    await q.refresh();

    await q.add(session(1));
    await q.add(session(2));

    expect(await files()).toEqual(["queue-a.json"]);
    expect(JSON.parse(await readFile(join(dir, "queue-a.json"), "utf8"))).toEqual([
      session(1),
      session(2),
    ]);
  });

  it("saves even if the storage folder doesn't exist yet and refresh() hasn't run", async () => {
    const q = new SessionQueue(join(dir, "not-created-yet"), "a", () => NOW);

    await q.add(session(1));

    expect(await readdir(join(dir, "not-created-yet"))).toEqual(["queue-a.json"]);
  });

  it("removes uploaded sessions and deletes the file once empty", async () => {
    const q = queue("a");
    await q.refresh();
    await q.add(session(1));
    await q.add(session(2));

    await q.remove(new Set([session(1).id]));
    expect(ids(q)).toEqual([session(2).id]);

    await q.remove(new Set([session(2).id]));
    expect(await files()).toEqual([]);
  });

  it("clear() discards everything and deletes the file", async () => {
    const q = queue("a");
    await q.refresh();
    await q.add(session(1));

    await q.clear();

    expect(q.size).toBe(0);
    expect(await files()).toEqual([]);
  });

  it("peeks at most one batch, oldest first", async () => {
    const q = queue("a");
    await q.refresh();
    for (const n of [1, 2, 3]) await q.add(session(n));

    expect(q.peek(2).map((s) => s.id)).toEqual([session(1).id, session(2).id]);
  });

  it("adopts the queue of a window that stopped updating it", async () => {
    await otherWindowFile("gone", [session(7), session(8)], STALE_MS + 1);
    const q = queue("a");

    await q.refresh();

    expect(ids(q)).toEqual([session(7).id, session(8).id]);
    expect(await files()).toEqual(["queue-a.json"]);
  });

  it("leaves alone the queue of a window that's still running", async () => {
    await otherWindowFile("alive", [session(7)], STALE_MS - 60_000);
    const q = queue("a");

    await q.refresh();

    expect(q.size).toBe(0);
    expect(await files()).toEqual(["queue-alive.json"]);
  });

  it("doesn't duplicate sessions it already has when adopting", async () => {
    const q = queue("a");
    await q.refresh();
    await q.add(session(1));
    await otherWindowFile("gone", [session(1), session(2)], STALE_MS + 1);

    await q.refresh();

    expect(ids(q)).toEqual([session(1).id, session(2).id]);
  });

  it("drops sessions older than the server accepts (7 days)", async () => {
    const old = new Date(NOW - 8 * DAY).toISOString();
    await otherWindowFile("gone", [session(1, old), session(2)], STALE_MS + 1);
    const q = queue("a");

    await q.refresh();

    expect(ids(q)).toEqual([session(2).id]);
  });

  it("skips malformed entries and leaves unreadable files in place", async () => {
    await otherWindowFile("mixed", [session(1), { id: "not-a-session" }], STALE_MS + 1);
    await writeFile(join(dir, "queue-broken.json"), "{ not json");
    await utimes(join(dir, "queue-broken.json"), new Date(0), new Date(0));
    const q = queue("a");

    await q.refresh();

    expect(ids(q)).toEqual([session(1).id]);
    expect(await files()).toEqual(["queue-a.json", "queue-broken.json"]);
  });

  it("survives a restart: a new window adopts the old one's queue once it's stale", async () => {
    const before = queue("old");
    await before.refresh();
    await before.add(session(1));
    const mtime = new Date(NOW - STALE_MS - 1);
    await utimes(join(dir, "queue-old.json"), mtime, mtime);

    const after = queue("new");
    await after.refresh();

    expect(ids(after)).toEqual([session(1).id]);
  });
});
