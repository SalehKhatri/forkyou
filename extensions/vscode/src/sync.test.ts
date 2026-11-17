import type { IngestResult, SessionInput } from "@forkyou/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { ApiResult } from "./api.js";
import { type StopReason, Syncer } from "./sync.js";

const MINUTE = 60_000;

function session(n: number): SessionInput {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    startedAt: "2026-11-17T10:00:00.000Z",
    durationSeconds: 60,
    language: "typescript",
    editor: "vscode",
  };
}

/** An in-memory queue with the SessionQueue methods the syncer uses. */
function memoryQueue(initial: SessionInput[], batchSize = 500) {
  let sessions = [...initial];
  return {
    get size() {
      return sessions.length;
    },
    get ids() {
      return sessions.map((s) => s.id);
    },
    peek: () => sessions.slice(0, batchSize),
    remove: async (ids: ReadonlySet<string>) => {
      sessions = sessions.filter((s) => !ids.has(s.id));
    },
    refresh: async () => {},
  };
}

const processed = (
  n: number,
  rejected: IngestResult["rejected"] = [],
): ApiResult<IngestResult> => ({
  ok: true,
  data: { accepted: n - rejected.length, duplicates: 0, rejected },
});
const failed = (failure: "network" | "server" | "unauthorized" | "outdated" | "rejected") =>
  ({ ok: false, failure, message: failure }) as const;

let now: number;
let key: string | undefined;
let responses: ApiResult<IngestResult>[];
let uploads: { key: string; ids: string[] }[];
let stopped: StopReason[];
let warnings: string[];

function syncer(queue: ReturnType<typeof memoryQueue>) {
  return new Syncer({
    queue,
    upload: async (apiKey, sessions) => {
      uploads.push({ key: apiKey, ids: sessions.map((s) => s.id) });
      return responses.shift() ?? processed(sessions.length);
    },
    getKey: async () => key,
    now: () => now,
    log: { info: () => {}, warn: (m) => warnings.push(m) },
    onStopped: (reason) => stopped.push(reason),
  });
}

beforeEach(() => {
  now = Date.parse("2026-11-17T12:00:00.000Z");
  key = "fy_example";
  responses = [];
  uploads = [];
  stopped = [];
  warnings = [];
});

describe("Syncer", () => {
  it("uploads queued sessions and removes them once processed", async () => {
    const queue = memoryQueue([session(1), session(2)]);

    await syncer(queue).tick();

    expect(uploads).toEqual([{ key: "fy_example", ids: [session(1).id, session(2).id] }]);
    expect(queue.size).toBe(0);
  });

  it("removes rejected sessions too, since retrying them would never succeed", async () => {
    const queue = memoryQueue([session(1), session(2)]);
    responses = [processed(2, [{ id: session(2).id, reason: "overlaps_existing" }])];

    await syncer(queue).tick();

    expect(queue.size).toBe(0);
    expect(warnings).toEqual(["1 sessions rejected: overlaps_existing"]);
  });

  it("drains a backlog in several batches per tick", async () => {
    const queue = memoryQueue([session(1), session(2), session(3)], 2);

    await syncer(queue).tick();

    expect(uploads.map((u) => u.ids.length)).toEqual([2, 1]);
    expect(queue.size).toBe(0);
  });

  it("does nothing while signed out or with an empty queue", async () => {
    key = undefined;
    await syncer(memoryQueue([session(1)])).tick();
    key = "fy_example";
    await syncer(memoryQueue([])).tick();

    expect(uploads).toEqual([]);
  });

  it("keeps sessions and backs off 1, 2, 4 … 15 minutes on network or server errors", async () => {
    const queue = memoryQueue([session(1)]);
    const sync = syncer(queue);
    responses = [failed("network"), failed("server"), failed("network"), failed("network")];

    await sync.tick(); // fails: retry in 1 min
    now += MINUTE - 1;
    await sync.tick(); // too early
    now += 1;
    await sync.tick(); // fails: retry in 2 min
    now += 2 * MINUTE;
    await sync.tick(); // fails: retry in 4 min
    now += 4 * MINUTE;
    await sync.tick(); // fails: retry in 8 min

    expect(uploads).toHaveLength(4);
    expect(queue.size).toBe(1);
    expect(warnings.at(-1)).toBe("Upload failed (network); retrying in 8 min");
  });

  it("caps the backoff at 15 minutes", async () => {
    const sync = syncer(memoryQueue([session(1)]));
    responses = Array.from({ length: 6 }, () => failed("server"));

    for (const wait of [0, 1, 2, 4, 8, 15]) {
      now += wait * MINUTE;
      await sync.tick();
    }

    expect(uploads).toHaveLength(6);
    expect(warnings.at(-1)).toBe("Upload failed (server); retrying in 15 min");
  });

  it("resets the backoff after a successful upload", async () => {
    const queue = memoryQueue([session(1), session(2)], 1);
    const sync = syncer(queue);
    responses = [failed("network"), processed(1), failed("network")];

    await sync.tick(); // fails
    now += MINUTE;
    await sync.tick(); // session 1 uploaded, then session 2 fails: retry in 1 min, not 2

    expect(warnings.at(-1)).toBe("Upload failed (network); retrying in 1 min");
  });

  it("stops on 401, keeps the queue, and resumes when the key changes", async () => {
    const queue = memoryQueue([session(1)]);
    const sync = syncer(queue);
    responses = [failed("unauthorized")];

    await sync.tick();
    await sync.tick();
    expect(stopped).toEqual(["unauthorized"]);
    expect(uploads).toHaveLength(1);
    expect(queue.size).toBe(1);

    key = "fy_new";
    sync.resume();
    await sync.tick();
    expect(uploads.at(-1)?.key).toBe("fy_new");
    expect(queue.size).toBe(0);
  });

  it("stops on 410 (extension outdated)", async () => {
    const sync = syncer(memoryQueue([session(1)]));
    responses = [failed("outdated")];

    await sync.tick();
    now += 60 * MINUTE;
    await sync.tick();

    expect(stopped).toEqual(["outdated"]);
    expect(uploads).toHaveLength(1);
  });

  it("drops a batch the server refuses outright (400), so it can't block the queue", async () => {
    const queue = memoryQueue([session(1)]);
    responses = [failed("rejected")];

    await syncer(queue).tick();

    expect(queue.size).toBe(0);
    expect(warnings).toEqual(["Server refused 1 sessions (rejected); dropped them"]);
  });

  it("flush() makes one final attempt and leaves failures queued", async () => {
    const queue = memoryQueue([session(1)]);
    responses = [failed("network")];

    await syncer(queue).flush();

    expect(uploads).toHaveLength(1);
    expect(queue.size).toBe(1);
  });
});
