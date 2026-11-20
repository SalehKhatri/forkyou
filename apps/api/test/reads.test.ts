import { sessionInputSchema, statsResponseSchema, todayResponseSchema } from "@forkyou/shared";
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

/** Sessions from more than maxSessionAgeDays ago, stored as if uploaded right after they ended. */
async function seedLongAgo(userId: string, s: ReturnType<typeof session>) {
  const uploadedAt = new Date(Date.parse(s.startedAt) + s.durationSeconds * 1000 + 60_000);
  await ingestSessions(db, userId, [sessionInputSchema.parse(s)], uploadedAt);
}

const minutesAgo = (days: number) => days * 24 * 60;

/** A heatmap that's zero except for the given [weekday][hour] = seconds (weekday 0 = Monday). */
function heatmapWith(cells: [weekday: number, hour: number, seconds: number][]) {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const [weekday, hour, seconds] of cells) {
    const row = grid[weekday];
    if (row) row[hour] = seconds;
  }
  return grid;
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

  it("leaves out of every breakdown a session from before the first day in the series", async () => {
    const { user, cookie } = await createUserWithSession(db);
    // NOW is Nov 16 12:00 UTC, so the 7-day series starts Nov 10. This session (Nov 9,
    // 14:50–15:00 UTC) is less than 7×24h ago but on a day the series doesn't show.
    await seed(
      user.id,
      session({
        endsMinutesAgo: 6 * 24 * 60 + 21 * 60,
        minutes: 10,
        language: "rust",
        project: "old",
      }),
      session({ endsMinutesAgo: 60, minutes: 10, language: "go", project: "api" }),
    );

    const res = await makeApp(db).request("/v1/me/stats?range=7d", { headers: cookie });
    const stats = (await res.json()) as {
      totalSeconds: number;
      days: { day: string }[];
      languages: unknown[];
      projects: unknown[];
    };

    expect(stats.days[0]?.day).toBe("2026-11-10");
    expect(stats.totalSeconds).toBe(600);
    expect(stats.languages).toEqual([{ language: "go", seconds: 600 }]);
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
  it("splits each session's time across the local hours it spans", async () => {
    const { user, cookie } = await createUserWithSession(db);
    // Monday Nov 16, 10:55–11:10 UTC, which is 16:25–16:40 in Kolkata (UTC+5:30).
    await seed(user.id, session({ endsMinutesAgo: 50, minutes: 15 }));
    const get = async (tz: string) =>
      statsResponseSchema.parse(
        await (await makeApp(db).request(`/v1/me/stats?tz=${tz}`, { headers: cookie })).json(),
      ).heatmap;

    expect(await get("UTC")).toEqual(
      heatmapWith([
        [0, 10, 300],
        [0, 11, 600],
      ]),
    );
    expect(await get("Asia/Kolkata")).toEqual(heatmapWith([[0, 16, 900]]));
  });

  it("splits a session across a DST change by real elapsed time", async () => {
    const { user, cookie } = await createUserWithSession(db);
    // Sunday Nov 1, 2026, 05:55–06:05 UTC. New York falls back at 06:00 UTC, so this is
    // 01:55–02:00 EDT and then 01:00–01:05 EST: ten minutes, all in the local 1am hour.
    await seedLongAgo(
      user.id,
      session({ startedAt: "2026-11-01T05:55:00.000Z", durationSeconds: 600 }),
    );

    const res = await makeApp(db).request("/v1/me/stats?range=30d&tz=America/New_York", {
      headers: cookie,
    });

    expect(statsResponseSchema.parse(await res.json()).heatmap).toEqual(heatmapWith([[6, 1, 600]]));
  });

  it("returns highlights, editors and lines for the range", async () => {
    const { user, cookie } = await createUserWithSession(db);
    await seed(
      user.id,
      session({ endsMinutesAgo: 60, minutes: 10, linesAdded: 40, linesRemoved: 5 }),
      session({ endsMinutesAgo: minutesAgo(1), minutes: 5, linesAdded: 2 }),
      session({ endsMinutesAgo: minutesAgo(1) + 30, minutes: 5, editor: "jetbrains" }),
    );

    const stats = statsResponseSchema.parse(
      await (await makeApp(db).request("/v1/me/stats", { headers: cookie })).json(),
    );

    expect(stats.highlights).toEqual({
      activeDays: 2,
      dailyAverageSeconds: 600,
      // Both days have 600s; the earlier one wins the tie.
      bestDay: { day: "2026-11-15", seconds: 600 },
    });
    expect(stats.editors).toEqual([
      { editor: "vscode", seconds: 900 },
      { editor: "jetbrains", seconds: 300 },
    ]);
    expect(stats.lines).toEqual({ added: 42, removed: 5 });
  });

  it("counts streaks over all time, not just the range", async () => {
    const { user, cookie } = await createUserWithSession(db);
    for (const daysAgo of [20, 19, 18, 17]) {
      await seedLongAgo(user.id, session({ endsMinutesAgo: minutesAgo(daysAgo) }));
    }
    await seed(
      user.id,
      session({ endsMinutesAgo: minutesAgo(1) }),
      session({ endsMinutesAgo: 60 }),
    );

    const stats = statsResponseSchema.parse(
      await (await makeApp(db).request("/v1/me/stats?range=7d", { headers: cookie })).json(),
    );

    expect(stats.streak).toEqual({ current: 2, longest: 4 });
    expect(stats.highlights.activeDays).toBe(2);
  });

  it("returns empty figures for a user who hasn't coded", async () => {
    const { cookie } = await createUserWithSession(db);

    const stats = statsResponseSchema.parse(
      await (await makeApp(db).request("/v1/me/stats", { headers: cookie })).json(),
    );

    expect(stats.heatmap).toEqual(heatmapWith([]));
    expect(stats.streak).toEqual({ current: 0, longest: 0 });
    expect(stats.highlights).toEqual({ activeDays: 0, dailyAverageSeconds: 0, bestDay: null });
    expect(stats.editors).toEqual([]);
    expect(stats.lines).toEqual({ added: 0, removed: 0 });
  });
});

describe("GET /v1/me/today", () => {
  it("returns the seconds coded today in the requested time zone", async () => {
    const { user, auth } = await createUserWithKey(db);
    await seed(
      user.id,
      session({ endsMinutesAgo: 60, minutes: 10 }),
      // Nov 16 00:30–00:40 UTC, which is still Nov 15 in New York.
      session({ endsMinutesAgo: 11 * 60 + 20, minutes: 10 }),
      session({ endsMinutesAgo: 24 * 60, minutes: 10 }),
    );
    const get = async (tz: string) =>
      todayResponseSchema.parse(
        await (await makeApp(db).request(`/v1/me/today?tz=${tz}`, { headers: auth })).json(),
      );

    expect(await get("UTC")).toEqual({ day: "2026-11-16", seconds: 1200 });
    expect(await get("America/New_York")).toEqual({ day: "2026-11-16", seconds: 600 });
  });

  it("matches today's entry in the full stats", async () => {
    const { user, cookie } = await createUserWithSession(db);
    await seed(user.id, session({ endsMinutesAgo: 30, minutes: 7 }));
    const app = makeApp(db);

    const today = await (
      await app.request("/v1/me/today?tz=Asia/Kolkata", { headers: cookie })
    ).json();
    const stats = statsResponseSchema.parse(
      await (await app.request("/v1/me/stats?tz=Asia/Kolkata", { headers: cookie })).json(),
    );

    expect(today).toEqual(stats.days.at(-1));
  });

  it("is zero before any coding today", async () => {
    const { auth } = await createUserWithKey(db);

    const res = await makeApp(db).request("/v1/me/today", { headers: auth });

    expect(await res.json()).toEqual({ day: "2026-11-16", seconds: 0 });
  });

  it("rejects an unknown time zone", async () => {
    const { auth } = await createUserWithKey(db);

    const res = await makeApp(db).request("/v1/me/today?tz=Mars/Olympus", { headers: auth });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_request", message: "Unknown time zone: Mars/Olympus" },
    });
  });

  it("needs an API key or a signed-in session", async () => {
    const res = await makeApp(db).request("/v1/me/today");

    expect(res.status).toBe(401);
  });
});
