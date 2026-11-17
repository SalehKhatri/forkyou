import { randomUUID } from "node:crypto";
import { sessionInputSchema } from "@forkyou/shared";
import { asc, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dailyStats } from "../src/db/schema.js";
import { ingestSessions } from "../src/services/ingest.js";
import { getLeaderboard } from "../src/services/leaderboard.js";
import { rebuildDailyStats } from "../src/services/rollups.js";
import { createUser, NOW, setupTestDb } from "./helpers.js";

const db = setupTestDb();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A session starting at `start` (ms since epoch), valid as ingestion input. */
function at(start: number, minutes: number, language = "typescript") {
  return sessionInputSchema.parse({
    id: randomUUID(),
    startedAt: new Date(start).toISOString(),
    durationSeconds: minutes * 60,
    language,
    editor: "vscode",
  });
}

const rollup = () =>
  db
    .select({ day: dailyStats.day, language: dailyStats.language, seconds: dailyStats.seconds })
    .from(dailyStats)
    .orderBy(asc(dailyStats.day), asc(dailyStats.language));

describe("daily_stats", () => {
  it("adds up each user's time per UTC day and language as sessions are ingested", async () => {
    const user = await createUser(db, "ada");
    const midnight = Date.parse(`${NOW.toISOString().slice(0, 10)}T00:00:00.000Z`);

    await ingestSessions(db, user.id, [at(midnight - 2 * HOUR, 10), at(midnight - HOUR, 5)], NOW);
    await ingestSessions(
      db,
      user.id,
      // The second session starts before midnight UTC and ends after it: it counts on its start day.
      [at(midnight + HOUR, 15, "rust"), at(midnight - 3 * MINUTE, 6)],
      NOW,
    );

    const yesterday = new Date(midnight - DAY).toISOString().slice(0, 10);
    const today = new Date(midnight).toISOString().slice(0, 10);
    expect(await rollup()).toEqual([
      { day: yesterday, language: "typescript", seconds: 21 * 60 },
      { day: today, language: "rust", seconds: 15 * 60 },
    ]);
  });

  it("doesn't count duplicates or rejected sessions", async () => {
    const user = await createUser(db, "ada");
    const first = at(NOW.getTime() - 2 * HOUR, 10);
    await ingestSessions(db, user.id, [first], NOW);

    const result = await ingestSessions(
      db,
      user.id,
      [first, at(NOW.getTime() - 2 * HOUR + MINUTE, 10), at(NOW.getTime() + HOUR, 10)],
      NOW,
    );

    expect(result).toMatchObject({ accepted: 0, duplicates: 1 });
    expect((await rollup()).map((r) => r.seconds)).toEqual([600]);
  });

  it("can be rebuilt from coding_sessions with the same result", async () => {
    const ada = await createUser(db, "ada");
    const linus = await createUser(db, "linus");
    const now = NOW.getTime();
    await ingestSessions(db, ada.id, [at(now - 3 * DAY, 12), at(now - HOUR, 5)], NOW);
    await ingestSessions(db, linus.id, [at(now - 2 * HOUR, 15, "go")], NOW);
    const maintained = await rollup();

    await db.execute(sql`update daily_stats set seconds = 1`);
    const rows = await rebuildDailyStats(db);

    expect(rows).toBe(3);
    expect(await rollup()).toEqual(maintained);
  });
});

/** Stores a session directly, bypassing ingestion's 7-day limit, to build up older history. */
async function storeOld(userId: string, start: number, seconds: number) {
  await db.execute(sql`
    insert into coding_sessions (id, user_id, started_at, ended_at, duration_seconds, language, editor)
    values (${randomUUID()}, ${userId}, ${new Date(start).toISOString()}::timestamptz,
            ${new Date(start + seconds * 1000).toISOString()}::timestamptz, ${seconds}, 'go', 'vscode')`);
}

describe("leaderboard from daily_stats", () => {
  it("matches summing the raw sessions in each rolling window, including the partial first day", async () => {
    const ada = await createUser(db, "ada");
    const linus = await createUser(db, "linus");
    const now = NOW.getTime();
    await ingestSessions(
      db,
      ada.id,
      [
        at(now - DAY - 10 * MINUTE, 5), // just before the 24 h window
        at(now - DAY + 10 * MINUTE, 7), // just inside it
        at(now - 3 * HOUR, 15, "rust"),
        at(now - 6 * DAY - 30 * MINUTE, 11), // inside the week, near its start
      ],
      NOW,
    );
    await storeOld(ada.id, now - 7 * DAY - 30 * MINUTE, 13 * 60); // just outside the week
    await storeOld(linus.id, now - 20 * DAY, 900); // inside the month
    await storeOld(linus.id, now - 31 * DAY, 900); // outside the month
    // Stored directly, so bring the rollup up to date the way the backfill migration does.
    await rebuildDailyStats(db);

    const totals = async (range: "day" | "week" | "month") =>
      Object.fromEntries(
        (await getLeaderboard(db, range, NOW)).entries.map((e) => [e.username, e.totalSeconds]),
      );

    expect(await totals("day")).toEqual({ ada: (7 + 15) * 60 });
    expect(await totals("week")).toEqual({ ada: (5 + 7 + 15 + 11) * 60 });
    expect(await totals("month")).toEqual({ ada: (5 + 7 + 15 + 11 + 13) * 60, linus: 900 });
  });
});
