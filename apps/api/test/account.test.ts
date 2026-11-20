import { accountExportSchema, sessionInputSchema } from "@forkyou/shared";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { apiKeys } from "../src/db/schema.js";
import { createApiKey } from "../src/services/auth.js";
import { ingestSessions } from "../src/services/ingest.js";
import { hideFromLeaderboard } from "../src/services/moderation.js";
import {
  createUserWithKey,
  createUserWithSession,
  makeApp,
  NOW,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

const del = (body: unknown, headers: Record<string, string>) => ({
  method: "DELETE",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** Rows each table holds for a user. */
async function rowsFor(userId: string) {
  const count = async (table: string) =>
    Number(
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(table === "users" ? "id" : "user_id")} = ${userId}`,
        )
      )[0]?.n,
    );
  return {
    users: await count("users"),
    authSessions: await count("auth_sessions"),
    apiKeys: await count("api_keys"),
    codingSessions: await count("coding_sessions"),
    dailyStats: await count("daily_stats"),
  };
}

async function coded(userId: string) {
  await ingestSessions(db, userId, [sessionInputSchema.parse(session({ minutes: 10 }))], NOW);
}

describe("DELETE /v1/me", () => {
  it("deletes the account and everything stored for it, and clears the cookie", async () => {
    const { user, cookie } = await createUserWithSession(db, "ada");
    await createApiKey(db, user.id, "laptop");
    await coded(user.id);

    const res = await makeApp(db).request("/v1/me", del({ confirm: "ada" }, cookie));

    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^fy_session=;.*Max-Age=0/);
    expect(await rowsFor(user.id)).toEqual({
      users: 0,
      authSessions: 0,
      apiKeys: 0,
      codingSessions: 0,
      dailyStats: 0,
    });
  });

  it("leaves other users' data alone", async () => {
    const { cookie } = await createUserWithSession(db, "ada");
    const { user: linus } = await createUserWithKey(db, "linus");
    await coded(linus.id);

    await makeApp(db).request("/v1/me", del({ confirm: "ada" }, cookie));

    expect(await rowsFor(linus.id)).toEqual({
      users: 1,
      authSessions: 0,
      apiKeys: 1,
      codingSessions: 1,
      dailyStats: 1,
    });
  });

  it("removes the user from the leaderboard and invalidates their API keys", async () => {
    const { user, cookie } = await createUserWithSession(db, "ada");
    const { key } = await createApiKey(db, user.id, "laptop");
    await coded(user.id);
    const app = makeApp(db);

    await app.request("/v1/me", del({ confirm: "ada" }, cookie));

    const board = (await (await app.request("/v1/leaderboard?range=day")).json()) as {
      entries: unknown[];
    };
    expect(board.entries).toEqual([]);
    expect(
      (await app.request("/v1/me", { headers: { Authorization: `Bearer ${key}` } })).status,
    ).toBe(401);
  });

  it("refuses when the typed username doesn't match", async () => {
    const { user, cookie } = await createUserWithSession(db, "ada");

    const res = await makeApp(db).request("/v1/me", del({ confirm: "Ada " }, cookie));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "confirmation_mismatch", message: "Type your username to confirm" },
    });
    expect((await rowsFor(user.id)).users).toBe(1);
  });

  it("can't be done with an API key, only from the signed-in web app", async () => {
    const { user, auth } = await createUserWithKey(db, "ada");

    const res = await makeApp(db).request("/v1/me", del({ confirm: "ada" }, auth));

    expect(res.status).toBe(401);
    expect((await rowsFor(user.id)).users).toBe(1);
  });
});

describe("GET /v1/me/export", () => {
  it("downloads everything stored about the user as JSON", async () => {
    const { user, cookie } = await createUserWithSession(db, "ada");
    await createApiKey(db, user.id, "laptop");
    await coded(user.id);

    const res = await makeApp(db).request("/v1/me/export", { headers: cookie });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="forkyou-ada-2026-11-16.json"',
    );
    const body = accountExportSchema.parse(await res.json());
    expect(body.exportedAt).toBe(NOW.toISOString());
    expect(body.user).toMatchObject({ id: user.id, username: "ada", githubId: user.githubId });
    expect(body.apiKeys).toEqual([expect.objectContaining({ name: "laptop", revokedAt: null })]);
    expect(body.sessions).toEqual([
      expect.objectContaining({ durationSeconds: 600, language: "typescript", editor: "vscode" }),
    ]);
  });

  it("never includes key hashes or other users", async () => {
    const { user, cookie } = await createUserWithSession(db, "ada");
    await createApiKey(db, user.id, "laptop");
    const { user: linus } = await createUserWithKey(db, "linus");
    await coded(linus.id);
    await hideFromLeaderboard(db, "ada", "secret maintainer note", NOW);
    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));

    const res = await makeApp(db).request("/v1/me/export", { headers: cookie });
    const text = await res.text();

    expect(text).not.toContain(stored?.keyHash ?? "missing");
    expect(text).not.toContain("linus");
  });

  it("includes the moderation reason even when it isn't shown on the dashboard", async () => {
    const { cookie } = await createUserWithSession(db, "ada");
    await hideFromLeaderboard(db, "ada", "scripted uploads", NOW);

    const body = accountExportSchema.parse(
      await (await makeApp(db).request("/v1/me/export", { headers: cookie })).json(),
    );

    expect(body.user).toMatchObject({
      leaderboardHidden: true,
      leaderboardHiddenReason: "scripted uploads",
    });
  });

  it("needs a signed-in browser session", async () => {
    const { auth } = await createUserWithKey(db, "ada");

    expect((await makeApp(db).request("/v1/me/export", { headers: auth })).status).toBe(401);
  });
});
