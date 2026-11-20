import { sessionInputSchema, staffOverviewSchema } from "@forkyou/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { createApiKey } from "../src/services/auth.js";
import { ingestSessions } from "../src/services/ingest.js";
import { recordPresence } from "../src/services/presence.js";
import {
  createUser,
  createUserWithSession,
  makeApp,
  NOW,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

async function moderator() {
  const created = await createUserWithSession(db, "mod");
  await db
    .update(users)
    .set({ staffRole: "moderator", createdAt: new Date("2026-01-01") })
    .where(eq(users.username, "mod"));
  return created;
}

/** A user who signed up `daysAgo` days before NOW. */
async function signedUp(username: string, daysAgo: number) {
  const user = await createUser(db, username);
  await db
    .update(users)
    .set({ createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000) })
    .where(eq(users.id, user.id));
  return user;
}

async function coded(userId: string, minutesAgo: number, minutes: number, extra: object = {}) {
  const s = session({ endsMinutesAgo: minutesAgo, minutes, ...extra });
  const uploadedAt = new Date(Date.parse(s.startedAt) + minutes * 60_000 + 60_000);
  await ingestSessions(db, userId, [sessionInputSchema.parse(s)], uploadedAt);
}

const overviewFor = async (cookie: { Cookie: string }, superAdmins: number[] = []) => {
  const app = makeApp(db, {
    env: {
      ...loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/test" }),
      SUPER_ADMIN_GITHUB_IDS: superAdmins,
    },
  });
  const res = await app.request("/v1/staff/overview", { headers: cookie });
  return { status: res.status, body: await res.json() };
};

describe("GET /v1/staff/overview", () => {
  it("summarises users, activity and the language and editor mix", async () => {
    const { cookie } = await moderator();
    const owner = await signedUp("owner", 40);
    const ada = await signedUp("ada", 0);
    const linus = await signedUp("linus", 3);
    await db.update(users).set({ leaderboardHiddenAt: NOW }).where(eq(users.id, linus.id));
    await coded(ada.id, 60, 10, { language: "rust" });
    await coded(linus.id, 60, 5, { language: "go", editor: "jetbrains" });
    await coded(linus.id, 3 * 24 * 60, 15, { language: "go" });
    await coded(linus.id, 10 * 24 * 60, 15, { language: "go" });
    await recordPresence(db, ada.id, { online: true, language: "rust" }, NOW);

    const { status, body } = await overviewFor(cookie, [owner.githubId]);
    const overview = staffOverviewSchema.parse(body);

    expect(status).toBe(200);
    expect(overview.generatedAt).toBe(NOW.toISOString());
    expect(overview.users).toEqual({ total: 4, staff: 2, hiddenFromLeaderboard: 1 });
    expect(overview.activeUsers).toEqual({ today: 2, week: 2, month: 2 });
    expect(overview.onlineNow).toBe(1);
    expect(overview.days).toHaveLength(30);
    expect(overview.days[0]?.day).toBe("2026-10-18");
    expect(overview.days.at(-1)).toEqual({
      day: "2026-11-16",
      signups: 1,
      activeUsers: 2,
      seconds: 900,
    });
    expect(overview.days.at(-4)).toEqual({
      day: "2026-11-13",
      signups: 1,
      activeUsers: 1,
      seconds: 900,
    });
    expect(overview.languages).toEqual([
      { language: "go", seconds: 2100 },
      { language: "rust", seconds: 600 },
    ]);
    expect(overview.editors).toEqual([
      { editor: "vscode", seconds: 1500 },
      { editor: "jetbrains", seconds: 300 },
    ]);
  });

  it("doesn't count people who hide their presence as online", async () => {
    const { cookie } = await moderator();
    const ada = await createUser(db, "ada");
    await db.update(users).set({ showPresence: false }).where(eq(users.id, ada.id));
    await recordPresence(db, ada.id, { online: true, language: "rust" }, NOW);

    const { body } = await overviewFor(cookie);

    expect(staffOverviewSchema.parse(body).onlineNow).toBe(0);
  });

  it("returns zeros for a quiet service", async () => {
    const { cookie } = await moderator();

    const overview = staffOverviewSchema.parse((await overviewFor(cookie)).body);

    expect(overview.activeUsers).toEqual({ today: 0, week: 0, month: 0 });
    expect(overview.days.at(-1)).toEqual({
      day: "2026-11-16",
      signups: 0,
      activeUsers: 0,
      seconds: 0,
    });
    expect(overview.languages).toEqual([]);
    expect(overview.editors).toEqual([]);
  });

  it("is for staff only, and never with an API key", async () => {
    const { cookie } = await createUserWithSession(db, "ada");
    const linus = await createUser(db, "linus");
    await db.update(users).set({ staffRole: "admin" }).where(eq(users.id, linus.id));
    const { key } = await createApiKey(db, linus.id, "laptop");
    const app = makeApp(db);

    const plain = await app.request("/v1/staff/overview", { headers: cookie });
    const withKey = await app.request("/v1/staff/overview", {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect([plain.status, withKey.status]).toEqual([403, 401]);
  });
});
