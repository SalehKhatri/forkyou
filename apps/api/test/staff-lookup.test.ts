import { sessionInputSchema, staffUserSchema } from "@forkyou/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adminActions, apiKeys, users } from "../src/db/schema.js";
import { loadEnv } from "../src/env.js";
import { createApiKey } from "../src/services/auth.js";
import { ingestSessions } from "../src/services/ingest.js";
import {
  createUser,
  createUserWithSession,
  makeApp,
  NOW,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

const app = (...superAdminGithubIds: number[]) =>
  makeApp(db, {
    env: {
      ...loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/test" }),
      SUPER_ADMIN_GITHUB_IDS: superAdminGithubIds,
    },
  });

async function staff(username: string, role: "moderator" | "admin") {
  const created = await createUserWithSession(db, username);
  await db.update(users).set({ staffRole: role }).where(eq(users.username, username));
  return created;
}

/** A session `daysAgo` days before NOW, stored as if uploaded right after it ended. */
async function codedDaysAgo(userId: string, daysAgo: number, minutes: number, project?: string) {
  const s = session({ endsMinutesAgo: daysAgo * 24 * 60 + 60, minutes, project });
  const uploadedAt = new Date(Date.parse(s.startedAt) + minutes * 60_000 + 60_000);
  await ingestSessions(db, userId, [sessionInputSchema.parse(s)], uploadedAt);
}

describe("GET /v1/staff/users/:username", () => {
  it("shows a moderator the account's profile, moderation state, keys and recent time", async () => {
    const { cookie } = await staff("mod", "moderator");
    const ada = await createUser(db, "ada");
    await createApiKey(db, ada.id, "laptop");
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date("2026-11-16T11:00:00.000Z") })
      .where(eq(apiKeys.userId, ada.id));
    await codedDaysAgo(ada.id, 0, 10);
    await codedDaysAgo(ada.id, 3, 5);
    await codedDaysAgo(ada.id, 20, 4);
    await codedDaysAgo(ada.id, 40, 2);

    const res = await app().request("/v1/staff/users/ada?range=7d", { headers: cookie });
    const body = staffUserSchema.parse(await res.json());

    expect(res.status).toBe(200);
    expect({ ...body, stats: undefined }).toEqual({
      username: "ada",
      name: null,
      avatarUrl: null,
      createdAt: ada.createdAt.toISOString(),
      lastSeenAt: null,
      staffRole: null,
      leaderboard: { hidden: false, hiddenAt: null, reason: null, reasonVisible: false },
      apiKeys: { active: 1, lastUsedAt: "2026-11-16T11:00:00.000Z" },
      recent: { day: 600, week: 900, month: 1140 },
      stats: undefined,
    });
    expect(body.stats.totalSeconds).toBe(900);
  });

  it("never shows project names, API keys or token hashes", async () => {
    const { cookie } = await staff("mod", "moderator");
    const ada = await createUser(db, "ada");
    const { key } = await createApiKey(db, ada.id, "laptop");
    await codedDaysAgo(ada.id, 0, 10, "secret-project");
    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.userId, ada.id));

    const res = await app().request("/v1/staff/users/ada", { headers: cookie });
    const text = await res.text();

    expect(staffUserSchema.parse(JSON.parse(text)).stats.projects).toEqual([]);
    expect(text).not.toContain("secret-project");
    expect(text).not.toContain(key);
    expect(text).not.toContain(stored?.keyHash ?? "missing");
  });

  it("doesn't count revoked keys", async () => {
    const { cookie } = await staff("mod", "moderator");
    const ada = await createUser(db, "ada");
    await createApiKey(db, ada.id, "old");
    await db.update(apiKeys).set({ revokedAt: NOW }).where(eq(apiKeys.userId, ada.id));

    const res = await app().request("/v1/staff/users/ada", { headers: cookie });

    expect(staffUserSchema.parse(await res.json()).apiKeys).toEqual({
      active: 0,
      lastUsedAt: null,
    });
  });

  it("lets staff look up anyone, super admins included, because looking isn't acting", async () => {
    const { cookie } = await staff("mod", "moderator");
    const owner = await createUser(db, "owner");

    const res = await app(owner.githubId).request("/v1/staff/users/owner", { headers: cookie });

    expect(staffUserSchema.parse(await res.json()).staffRole).toBe("super_admin");
  });

  it("refuses someone who isn't staff, and API keys", async () => {
    const { cookie } = await createUserWithSession(db, "linus");
    const ada = await createUser(db, "ada");
    const { key } = await createApiKey(db, ada.id, "laptop");
    const a = app();

    const plain = await a.request("/v1/staff/users/ada", { headers: cookie });
    const withKey = await a.request("/v1/staff/users/ada", {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect([plain.status, withKey.status]).toEqual([403, 401]);
  });

  it("returns 404 for an unknown user and 400 for an unknown time zone", async () => {
    const { cookie } = await staff("mod", "moderator");
    await createUser(db, "ada");
    const a = app();

    const unknown = await a.request("/v1/staff/users/nobody", { headers: cookie });
    const badTz = await a.request("/v1/staff/users/ada?tz=Mars/Olympus", { headers: cookie });

    expect(await unknown.json()).toEqual({
      error: { code: "not_found", message: "User not found" },
    });
    expect(await badTz.json()).toEqual({
      error: { code: "invalid_request", message: "Unknown time zone: Mars/Olympus" },
    });
  });
});

describe("POST /v1/staff/users/:username/revoke-keys", () => {
  const revoke = (cookie: { Cookie: string }) => ({ method: "POST", headers: cookie });

  it("lets an admin revoke every active key, which stops them working, and records it", async () => {
    const { user: boss, cookie } = await staff("boss", "admin");
    const ada = await createUser(db, "ada");
    const { key } = await createApiKey(db, ada.id, "laptop");
    await createApiKey(db, ada.id, "desktop");
    const a = app();

    const res = await a.request("/v1/staff/users/ada/revoke-keys", revoke(cookie));
    const me = await a.request("/v1/me", { headers: { Authorization: `Bearer ${key}` } });

    expect(await res.json()).toEqual({ revoked: 2 });
    expect(me.status).toBe(401);
    expect(
      await db
        .select({
          actorId: adminActions.actorId,
          targetId: adminActions.targetId,
          action: adminActions.action,
          details: adminActions.details,
        })
        .from(adminActions),
    ).toEqual([
      { actorId: boss.id, targetId: ada.id, action: "keys.revoke", details: { count: 2 } },
    ]);
  });

  it("is admin-only", async () => {
    const { cookie } = await staff("mod", "moderator");
    const ada = await createUser(db, "ada");
    await createApiKey(db, ada.id, "laptop");

    const res = await app().request("/v1/staff/users/ada/revoke-keys", revoke(cookie));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "forbidden", message: "Your account doesn't have access to this" },
    });
  });

  it("won't let an admin revoke another admin's keys", async () => {
    const { cookie } = await staff("boss", "admin");
    const { user: peer } = await staff("peer", "admin");
    await createApiKey(db, peer.id, "laptop");

    const res = await app().request("/v1/staff/users/peer/revoke-keys", revoke(cookie));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: "outranked",
        message: "You can't act on your own account or on staff ranked at or above you",
      },
    });
  });

  it("changes and records nothing when there are no active keys", async () => {
    const { cookie } = await staff("boss", "admin");
    await createUser(db, "ada");

    const res = await app().request("/v1/staff/users/ada/revoke-keys", revoke(cookie));

    expect(await res.json()).toEqual({ revoked: 0 });
    expect(await db.select().from(adminActions)).toEqual([]);
  });
});
