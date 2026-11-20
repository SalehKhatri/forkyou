import { reviewQueueEntrySchema, sessionInputSchema } from "@forkyou/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adminActions, dailyStats, users } from "../src/db/schema.js";
import { createApiKey } from "../src/services/auth.js";
import { ingestSessions } from "../src/services/ingest.js";
import { createUser, createUserWithSession, makeApp, NOW, setupTestDb } from "./helpers.js";

const db = setupTestDb();
const HOUR = 3_600_000;

async function moderator() {
  const created = await createUserWithSession(db, "mod");
  await db.update(users).set({ staffRole: "moderator" }).where(eq(users.username, "mod"));
  return created;
}

/**
 * Back-to-back 15-minute sessions from `start`, `gapMinutes` apart, until `hours` have passed.
 * Returns the stretch's exact end.
 */
async function stretch(userId: string, start: Date, hours: number, gapMinutes = 0) {
  const sessions = [];
  let t = start.getTime();
  const end = start.getTime() + hours * HOUR;
  while (t + 15 * 60_000 <= end) {
    sessions.push(
      sessionInputSchema.parse({
        id: crypto.randomUUID(),
        startedAt: new Date(t).toISOString(),
        durationSeconds: 900,
        language: "go",
        editor: "vscode",
      }),
    );
    t += (15 + gapMinutes) * 60_000;
  }
  await ingestSessions(db, userId, sessions, NOW);
  return new Date(t - gapMinutes * 60_000);
}

/** Rollup rows for the sudden-jump rule, which only reads `daily_stats`. */
async function weekly(userId: string, secondsPerWeek: [number, number, number, number]) {
  // Weeks 3, 2 and 1 before this one, then this week; one row on a day inside each.
  const dayOf = (daysAgo: number) =>
    new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const rows = [24, 17, 10, 1].map((daysAgo, i) => ({
    userId,
    day: dayOf(daysAgo),
    language: "go",
    seconds: secondsPerWeek[i] ?? 0,
  }));
  await db.insert(dailyStats).values(rows.filter((r) => r.seconds > 0));
}

const queue = async (cookie: { Cookie: string }, now = NOW) => {
  const res = await makeApp(db, { now: () => now }).request("/v1/staff/review-queue", {
    headers: cookie,
  });
  return reviewQueueEntrySchema.array().parse(await res.json());
};

const dismiss = (cookie: { Cookie: string }, username: string, now: Date, note?: string) =>
  makeApp(db, { now: () => now }).request(`/v1/staff/users/${username}/review-dismiss`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cookie },
    body: JSON.stringify(note ? { note } : {}),
  });

describe("review queue: no breaks", () => {
  it("flags 8 hours with no break longer than 10 minutes", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    const start = new Date(NOW.getTime() - 30 * HOUR);
    const end = await stretch(ada.id, start, 8.5, 10);

    expect(await queue(cookie)).toEqual([
      {
        username: "ada",
        avatarUrl: null,
        // 20 sessions of 15 minutes, 10 minutes apart: 8 h 10 min from first to last.
        weekSeconds: 18_000,
        flags: [
          {
            kind: "no_breaks",
            from: start.toISOString(),
            to: end.toISOString(),
            seconds: (end.getTime() - start.getTime()) / 1000,
          },
        ],
      },
    ]);
  });

  it("doesn't flag a long day with a real break in it", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    const morning = await stretch(ada.id, new Date(NOW.getTime() - 30 * HOUR), 5);
    // An 11-minute gap: longer than the allowed break.
    await stretch(ada.id, new Date(morning.getTime() + 11 * 60_000), 5);

    expect(await queue(cookie)).toEqual([]);
  });

  it("leaves out accounts that are already hidden from the leaderboard", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    await stretch(ada.id, new Date(NOW.getTime() - 30 * HOUR), 9);
    await db.update(users).set({ leaderboardHiddenAt: NOW }).where(eq(users.id, ada.id));

    expect(await queue(cookie)).toEqual([]);
  });
});

describe("review queue: sudden jump", () => {
  it("flags a week at least 5x the average of the 3 before, and at least 20 hours", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    await weekly(ada.id, [3_600, 3_600, 3_600, 21 * 3_600]);

    expect(await queue(cookie)).toEqual([
      {
        username: "ada",
        avatarUrl: null,
        weekSeconds: 75_600,
        flags: [{ kind: "sudden_jump", weekSeconds: 75_600, baselineWeekSeconds: 3_600 }],
      },
    ]);
  });

  it("doesn't flag someone who codes a lot every week, or a light user who doubles up", async () => {
    const { cookie } = await moderator();
    const steady = await createUser(db, "steady");
    const light = await createUser(db, "light");
    await weekly(steady.id, [40 * 3_600, 40 * 3_600, 40 * 3_600, 45 * 3_600]);
    await weekly(light.id, [1_800, 1_800, 1_800, 10 * 3_600]);

    expect(await queue(cookie)).toEqual([]);
  });

  it("lists the accounts with the most time this week first", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    const linus = await createUser(db, "linus");
    await weekly(ada.id, [0, 0, 0, 25 * 3_600]);
    await weekly(linus.id, [0, 0, 0, 30 * 3_600]);

    expect((await queue(cookie)).map((e) => e.username)).toEqual(["linus", "ada"]);
  });
});

describe("dismissing a flag", () => {
  it("removes the flags it covered and records the note", async () => {
    const { user: mod, cookie } = await moderator();
    const ada = await createUser(db, "ada");
    await stretch(ada.id, new Date(NOW.getTime() - 30 * HOUR), 9);

    const res = await dismiss(cookie, "ada", NOW, "pair-programming marathon, checked with them");

    expect(res.status).toBe(204);
    expect(await queue(cookie)).toEqual([]);
    expect(
      await db
        .select({
          actorId: adminActions.actorId,
          targetId: adminActions.targetId,
          action: adminActions.action,
          details: adminActions.details,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions),
    ).toEqual([
      {
        actorId: mod.id,
        targetId: ada.id,
        action: "review.dismiss",
        details: { note: "pair-programming marathon, checked with them" },
        createdAt: NOW,
      },
    ]);
  });

  it("brings the account back for a new stretch that starts after the review", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    await stretch(ada.id, new Date(NOW.getTime() - 100 * HOUR), 9);
    await dismiss(cookie, "ada", new Date(NOW.getTime() - 80 * HOUR));
    const later = new Date(NOW.getTime() - 30 * HOUR);
    await stretch(ada.id, later, 9);

    const flags = (await queue(cookie))[0]?.flags;

    expect(flags).toHaveLength(1);
    expect(flags?.[0]).toMatchObject({ kind: "no_breaks", from: later.toISOString() });
  });

  it("keeps a dismissed jump out of the queue while the week still includes the review", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    await weekly(ada.id, [3_600, 3_600, 3_600, 21 * 3_600]);
    await dismiss(cookie, "ada", new Date(NOW.getTime() - 2 * 86_400_000));

    expect(await queue(cookie)).toEqual([]);
  });

  it("follows the rank rule, and is for moderators and above", async () => {
    const { cookie } = await moderator();
    await createUserWithSession(db, "peer");
    await db.update(users).set({ staffRole: "moderator" }).where(eq(users.username, "peer"));
    const { cookie: plain } = await createUserWithSession(db, "linus");
    await createUser(db, "ada");

    const peer = await dismiss(cookie, "peer", NOW);
    const notStaff = await dismiss(plain, "ada", NOW);

    expect([peer.status, notStaff.status]).toEqual([403, 403]);
    expect(await peer.json()).toEqual({
      error: {
        code: "outranked",
        message: "You can't act on your own account or on staff ranked at or above you",
      },
    });
  });
});

describe("GET /v1/staff/review-queue access", () => {
  it("is for staff only, and never with an API key", async () => {
    const { cookie } = await createUserWithSession(db, "ada");
    const linus = await createUser(db, "linus");
    await db.update(users).set({ staffRole: "admin" }).where(eq(users.id, linus.id));
    const { key } = await createApiKey(db, linus.id, "laptop");
    const app = makeApp(db);

    const plain = await app.request("/v1/staff/review-queue", { headers: cookie });
    const withKey = await app.request("/v1/staff/review-queue", {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect([plain.status, withKey.status]).toEqual([403, 401]);
  });
});
