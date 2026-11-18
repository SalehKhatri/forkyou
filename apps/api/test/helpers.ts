import { randomUUID } from "node:crypto";
import type { SessionInput } from "@forkyou/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import type { Deps } from "../src/context.js";
import { createDb } from "../src/db/client.js";
import { loadEnv } from "../src/env.js";
import { TtlCache } from "../src/lib/cache.js";
import {
  createApiKey,
  createAuthSession,
  type GithubProfile,
  upsertGithubUser,
} from "../src/services/auth.js";
import type { GithubOAuth } from "../src/services/github.js";

export const NOW = new Date("2026-11-16T12:00:00.000Z");

/** One DB connection per test file; every table is truncated before each test. */
export function setupTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL missing");
  const { db, close } = createDb(url);
  beforeEach(async () => {
    await db.execute(
      sql`truncate table daily_stats, coding_sessions, api_keys, auth_sessions, users restart identity cascade`,
    );
  });
  afterAll(close);
  return db;
}

export const fakeGithub = (
  profile: GithubProfile = { githubId: 1, username: "octo", name: "Octo", avatarUrl: null },
): GithubOAuth => ({
  authorizationUrl: (state) => new URL(`https://github.test/authorize?state=${state}`),
  exchangeCode: async (code) => {
    if (code !== "good-code") throw new Error("bad code");
    return profile;
  },
});

export function makeApp(db: Deps["db"], overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    db,
    env: loadEnv({ NODE_ENV: "test", DATABASE_URL: "postgres://unused/test" }),
    github: fakeGithub(),
    // No caching in tests: every request reads the database.
    leaderboardCache: new TtlCache(0, { maxStaleMs: 0 }),
    now: () => NOW,
    ...overrides,
  };
  return createApp(deps);
}

let githubIds = 1000;
export async function createUser(db: Deps["db"], username = `user${githubIds}`) {
  return upsertGithubUser(db, { githubId: githubIds++, username, name: null, avatarUrl: null });
}

export async function createUserWithKey(db: Deps["db"], username?: string) {
  const user = await createUser(db, username);
  const { key } = await createApiKey(db, user.id, "test");
  return { user, key, auth: { Authorization: `Bearer ${key}` } };
}

export async function createUserWithSession(db: Deps["db"], username?: string) {
  const user = await createUser(db, username);
  const { token } = await createAuthSession(db, user.id, NOW);
  return { user, cookie: { Cookie: `fy_session=${token}` } };
}

/** A session ending `endsMinutesAgo` before NOW. */
export function session(
  overrides: Partial<SessionInput> & { endsMinutesAgo?: number; minutes?: number } = {},
): SessionInput & { id: string } {
  const { endsMinutesAgo = 5, minutes = 10, ...rest } = overrides;
  const start = new Date(NOW.getTime() - (endsMinutesAgo + minutes) * 60_000);
  return {
    id: randomUUID(),
    startedAt: start.toISOString(),
    durationSeconds: minutes * 60,
    language: "typescript",
    editor: "vscode",
    ...rest,
  };
}

export const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
