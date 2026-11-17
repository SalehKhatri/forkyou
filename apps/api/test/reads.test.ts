import { sessionInputSchema } from "@forkyou/shared";
import { describe, expect, it } from "vitest";
import { ingestSessions } from "../src/services/ingest.js";
import {
  createUser,
  createUserWithKey,
  createUserWithSession,
  json,
  makeApp,
  NOW,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

async function seed(userId: string, ...sessions: ReturnType<typeof session>[]) {
  await ingestSessions(
    db,
    userId,
    sessions.map((s) => sessionInputSchema.parse(s)),
    NOW,
  );
}

describe("GET /v1/leaderboard", () => {
  it("ranks by total time with each user's top language", async () => {
    const alice = await createUser(db, "alice");
    const bob = await createUser(db, "bob");
    await seed(alice.id, session({ endsMinutesAgo: 60, minutes: 10, language: "go" }));
    await seed(
      bob.id,
      session({ endsMinutesAgo: 60, minutes: 10, language: "rust" }),
      session({ endsMinutesAgo: 30, minutes: 15, language: "python" }),
    );
    const res = await makeApp(db).request("/v1/leaderboard?range=day");
    const board = (await res.json()) as { entries: Record<string, unknown>[] };
    expect(board.entries).toEqual([
      expect.objectContaining({
        rank: 1,
        username: "bob",
        totalSeconds: 1500,
        topLanguage: "python",
      }),
      expect.objectContaining({ rank: 2, username: "alice", totalSeconds: 600, topLanguage: "go" }),
    ]);
  });

  it("only counts sessions inside the rolling window", async () => {
    const alice = await createUser(db, "alice");
    await seed(alice.id, session({ endsMinutesAgo: 3 * 24 * 60 }));
    const day = (await (await makeApp(db).request("/v1/leaderboard?range=day")).json()) as {
      entries: unknown[];
    };
    const week = (await (await makeApp(db).request("/v1/leaderboard?range=week")).json()) as {
      entries: unknown[];
    };
    expect(day.entries).toHaveLength(0);
    expect(week.entries).toHaveLength(1);
  });

  it("marks users who are online", async () => {
    const { user, auth } = await createUserWithKey(db, "live");
    await seed(user.id, session());
    const app = makeApp(db);
    await app.request("/v1/presence", json({ online: true }, auth));
    const board = (await (await app.request("/v1/leaderboard")).json()) as {
      entries: { online: boolean }[];
    };
    expect(board.entries[0]?.online).toBe(true);
  });
});

describe("GET /v1/me/stats", () => {
  it("returns a zero-filled daily series and breakdowns", async () => {
    const { user, cookie } = await createUserWithSession(db);
    await seed(
      user.id,
      session({ endsMinutesAgo: 60, minutes: 10, language: "go", project: "api" }),
      session({ endsMinutesAgo: 2 * 24 * 60, minutes: 5, language: "go" }),
    );
    const res = await makeApp(db).request("/v1/me/stats?range=7d", { headers: cookie });
    const stats = (await res.json()) as {
      totalSeconds: number;
      days: { day: string; seconds: number }[];
      languages: unknown[];
      projects: unknown[];
    };
    expect(stats.totalSeconds).toBe(900);
    expect(stats.days).toHaveLength(7);
    expect(stats.days.at(-1)).toEqual({ day: "2026-11-16", seconds: 600 });
    expect(stats.days.at(-3)).toEqual({ day: "2026-11-14", seconds: 300 });
    expect(stats.languages).toEqual([{ language: "go", seconds: 900 }]);
    expect(stats.projects).toEqual([{ project: "api", seconds: 600 }]);
  });

  it("buckets days in the requested time zone", async () => {
    const { user, cookie } = await createUserWithSession(db);
    // 00:30–00:40 UTC on Nov 16 is 19:30–19:40 on Nov 15 in New York.
    await seed(user.id, session({ endsMinutesAgo: 11 * 60 + 20, minutes: 10 }));
    const utc = await makeApp(db).request("/v1/me/stats?tz=UTC", { headers: cookie });
    const ny = await makeApp(db).request("/v1/me/stats?tz=America/New_York", { headers: cookie });
    const last = async (r: Response) =>
      ((await r.json()) as { days: { day: string; seconds: number }[] }).days.filter(
        (d) => d.seconds > 0,
      );
    expect(await last(utc)).toEqual([{ day: "2026-11-16", seconds: 600 }]);
    expect(await last(ny)).toEqual([{ day: "2026-11-15", seconds: 600 }]);
  });
});
