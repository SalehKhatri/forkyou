import type { ApiKey, ApiKeyCreated } from "@forkyou/shared";
import { and, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { apiKeys, authSessions, type User, users } from "../db/schema.js";
import { generateApiKey, generateToken, sha256 } from "../lib/crypto.js";
import { days } from "../lib/time.js";

const SESSION_TTL_MS = days(30);
/** Sliding expiry: sessions used in their second half get a fresh 30 days. */
const SESSION_RENEW_BEFORE_MS = days(15);
/** Don't write last_used_at on every request. */
const KEY_TOUCH_INTERVAL_MS = 5 * 60_000;

export type GithubProfile = {
  githubId: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * Create or refresh the user for a GitHub account. GitHub ids are stable; usernames are not.
 *
 * If another account still holds this username (they renamed on GitHub and someone else took the
 * old name), that stale row is moved to `<username>~<githubId>` first. Its real username is
 * restored the next time that person logs in.
 */
export async function upsertGithubUser(db: Db, profile: GithubProfile): Promise<User> {
  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ username: sql`${users.username} || '~' || ${users.githubId}` })
      .where(and(eq(users.username, profile.username), ne(users.githubId, profile.githubId)));

    const [user] = await tx
      .insert(users)
      .values(profile)
      .onConflictDoUpdate({
        target: users.githubId,
        set: { username: profile.username, name: profile.name, avatarUrl: profile.avatarUrl },
      })
      .returning();
    if (!user) throw new Error("upsert returned no row");
    return user;
  });
}

// ---------------------------------------------------------------- browser sessions

export async function createAuthSession(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(authSessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Resolve a cookie token to its user, renewing or deleting the session as needed. */
export async function validateAuthSession(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ user: User; renewedUntil: Date | null } | null> {
  const id = sha256(token);
  const [row] = await db
    .select({ user: users, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.id, id));
  if (!row) return null;

  if (row.expiresAt <= now) {
    await db.delete(authSessions).where(eq(authSessions.id, id));
    return null;
  }
  if (row.expiresAt.getTime() - now.getTime() < SESSION_RENEW_BEFORE_MS) {
    const renewedUntil = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(authSessions).set({ expiresAt: renewedUntil }).where(eq(authSessions.id, id));
    return { user: row.user, renewedUntil };
  }
  return { user: row.user, renewedUntil: null };
}

/**
 * Deletes every login session that has expired, for all users. Expired sessions are also deleted
 * when presented, but one that's never used again (a cleared browser, a lost laptop) would
 * otherwise stay forever. Safe to run from several API instances at once. Returns how many it
 * deleted.
 */
export async function deleteExpiredAuthSessions(db: Db, now: Date): Promise<number> {
  const deleted = await db
    .delete(authSessions)
    .where(lte(authSessions.expiresAt, now))
    .returning({ id: authSessions.id });
  return deleted.length;
}

export async function deleteAuthSession(db: Db, token: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.id, sha256(token)));
}

// ---------------------------------------------------------------- API keys

const toApiKey = (k: typeof apiKeys.$inferSelect): ApiKey => ({
  id: k.id,
  name: k.name,
  prefix: k.keyPrefix,
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(),
});

export async function createApiKey(db: Db, userId: string, name: string): Promise<ApiKeyCreated> {
  const key = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, name, keyHash: sha256(key), keyPrefix: key.slice(0, 7) })
    .returning();
  if (!row) throw new Error("insert returned no row");
  return { ...toApiKey(row), key };
}

export async function listApiKeys(db: Db, userId: string): Promise<ApiKey[]> {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .orderBy(apiKeys.createdAt);
  return rows.map(toApiKey);
}

/** Returns false if the key doesn't exist, isn't the user's, or is already revoked. */
export async function revokeApiKey(db: Db, userId: string, keyId: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

export async function validateApiKey(db: Db, key: string, now = new Date()): Promise<User | null> {
  const [row] = await db
    .select({ user: users, keyId: apiKeys.id })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
  if (!row) return null;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiKeys.id, row.keyId),
        or(
          isNull(apiKeys.lastUsedAt),
          lt(apiKeys.lastUsedAt, new Date(now.getTime() - KEY_TOUCH_INTERVAL_MS)),
        ),
      ),
    );
  return row.user;
}
