import { describe, expect, it } from "vitest";
import { memoryLogger } from "../src/lib/log.js";
import {
  createUserWithKey,
  createUserWithSession,
  json,
  makeApp,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

// The username checks use "linus" because its letters can't occur in the hex request ids. With
// "ada" the tests failed whenever a random id happened to contain those three hex digits.

describe("request logging", () => {
  it("logs method, route, status, duration and request id, and nothing personal", async () => {
    const { auth } = await createUserWithKey(db, "linus");
    const log = memoryLogger();

    await makeApp(db, { log }).request("/v1/me/stats?range=7d&tz=Europe/Berlin", {
      headers: auth,
    });

    expect(log.lines).toEqual([
      {
        time: expect.any(String),
        level: "info",
        msg: "request",
        method: "GET",
        route: "/v1/me/stats",
        status: 200,
        ms: expect.any(Number),
        requestId: expect.any(String),
      },
    ]);
    const written = JSON.stringify(log.lines);
    expect(written).not.toContain(auth.Authorization.slice("Bearer ".length));
    expect(written).not.toContain("Berlin");
    expect(written).not.toContain("linus");
  });

  it("logs the route pattern, not the path with ids in it", async () => {
    const { cookie } = await createUserWithSession(db);
    const log = memoryLogger();

    await makeApp(db, { log }).request("/v1/keys/8f9a3c1e-2b4d-4e6f-8a1b-3c5d7e9f0a2b", {
      method: "DELETE",
      headers: cookie,
    });

    expect(log.lines.map((l) => [l.route, l.status])).toEqual([["/v1/keys/:id", 404]]);
  });

  it("doesn't log the path of unknown routes", async () => {
    const log = memoryLogger();

    await makeApp(db, { log }).request("/wp-login.php?token=secret");

    expect(log.lines.map((l) => [l.route, l.status])).toEqual([["(unmatched)", 404]]);
  });

  it("skips health checks", async () => {
    const log = memoryLogger();

    await makeApp(db, { log }).request("/health");

    expect(log.lines).toEqual([]);
  });

  it("counts accepted, duplicate and rejected sessions per upload, without the user", async () => {
    const { auth } = await createUserWithKey(db, "linus");
    const log = memoryLogger();
    const app = makeApp(db, { log });
    const first = session({ endsMinutesAgo: 60 });
    const overlapping = session({ endsMinutesAgo: 62 });

    await app.request("/v1/sessions", json({ sessions: [first] }, auth));
    await app.request("/v1/sessions", json({ sessions: [first, overlapping] }, auth));

    expect(log.lines.filter((l) => l.msg === "ingest")).toEqual([
      expect.objectContaining({ accepted: 1, duplicates: 0, rejected: {} }),
      expect.objectContaining({ accepted: 0, duplicates: 1, rejected: { overlaps_existing: 1 } }),
    ]);
    expect(JSON.stringify(log.lines)).not.toContain("linus");
  });

  it("logs unhandled errors with the request id, and returns a generic 500", async () => {
    const log = memoryLogger();
    const app = makeApp(db, {
      log,
      now: () => {
        throw new Error("clock exploded");
      },
    });

    const res = await app.request("/v1/leaderboard?range=day");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal", message: "Internal server error" },
    });
    const error = log.lines.find((l) => l.level === "error");
    expect(error).toMatchObject({ msg: "unhandled error", requestId: expect.any(String) });
    expect(String(error?.error)).toContain("clock exploded");
    expect(log.lines.find((l) => l.msg === "request")).toMatchObject({
      route: "/v1/leaderboard",
      status: 500,
      requestId: error?.requestId,
    });
  });
});
