import {
  apiKeyCreateSchema,
  leaderboardQuerySchema,
  type MeResponse,
  presenceInputSchema,
  sessionBatchSchema,
  settingsUpdateSchema,
  statsQuerySchema,
} from "@forkyou/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { users } from "../db/schema.js";
import { AppError, errorBody, notFound } from "../lib/errors.js";
import { isValidTimeZone } from "../lib/time.js";
import { validate } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/auth.js";
import { ingestSessions } from "../services/ingest.js";
import { getLeaderboard } from "../services/leaderboard.js";
import { listOnlineUsers, recordPresence } from "../services/presence.js";
import { getUserStats } from "../services/stats.js";

const toMe = (u: AppEnv["Variables"]["user"]): MeResponse => ({
  id: u.id,
  username: u.username,
  name: u.name,
  avatarUrl: u.avatarUrl,
  showPresence: u.showPresence,
  showLanguage: u.showLanguage,
  createdAt: u.createdAt.toISOString(),
});

export const v1Routes = new Hono<AppEnv>()
  // ------------------------------------------------------------ editor extensions
  .post(
    "/sessions",
    bodyLimit({
      maxSize: 512 * 1024,
      onError: (c) => c.json(errorBody("payload_too_large", "Request body exceeds 512 KB"), 413),
    }),
    requireAuth("apiKey"),
    validate("json", sessionBatchSchema),
    async (c) => {
      const { db, now } = c.var.deps;
      const { sessions } = c.req.valid("json");
      const result = await ingestSessions(db, c.var.user.id, sessions, now());
      return c.json(result);
    },
  )
  .post("/presence", requireAuth("apiKey"), validate("json", presenceInputSchema), async (c) => {
    const { db, now } = c.var.deps;
    await recordPresence(db, c.var.user.id, c.req.valid("json"), now());
    return c.body(null, 204);
  })

  // ------------------------------------------------------------ signed-in user
  .get("/me", requireAuth("apiKey", "session"), (c) => c.json(toMe(c.var.user)))
  .patch(
    "/me/settings",
    requireAuth("session"),
    validate("json", settingsUpdateSchema),
    async (c) => {
      const patch = c.req.valid("json");
      const [updated] = await c.var.deps.db
        .update(users)
        .set(patch)
        .where(eq(users.id, c.var.user.id))
        .returning();
      if (!updated) throw notFound("User");
      c.var.deps.leaderboardCache.clear();
      return c.json(toMe(updated));
    },
  )
  .get(
    "/me/stats",
    requireAuth("apiKey", "session"),
    validate("query", statsQuerySchema),
    async (c) => {
      const { range, tz } = c.req.valid("query");
      if (!isValidTimeZone(tz))
        throw new AppError(400, "invalid_request", `Unknown time zone: ${tz}`);
      const { db, now } = c.var.deps;
      return c.json(await getUserStats(db, c.var.user.id, range, tz, now()));
    },
  )

  // ------------------------------------------------------------ API keys (web only)
  .get("/keys", requireAuth("session"), async (c) =>
    c.json(await listApiKeys(c.var.deps.db, c.var.user.id)),
  )
  .post("/keys", requireAuth("session"), validate("json", apiKeyCreateSchema), async (c) => {
    const created = await createApiKey(c.var.deps.db, c.var.user.id, c.req.valid("json").name);
    return c.json(created, 201);
  })
  .delete(
    "/keys/:id",
    requireAuth("session"),
    validate("param", z.object({ id: z.uuid() })),
    async (c) => {
      const ok = await revokeApiKey(c.var.deps.db, c.var.user.id, c.req.valid("param").id);
      if (!ok) throw notFound("API key");
      return c.body(null, 204);
    },
  )

  // ------------------------------------------------------------ public
  .get("/leaderboard", validate("query", leaderboardQuerySchema), async (c) => {
    const { range } = c.req.valid("query");
    const { db, leaderboardCache, now } = c.var.deps;
    const board = await leaderboardCache.getOrSet(range, () => getLeaderboard(db, range, now()));
    c.header("Cache-Control", "public, max-age=30");
    return c.json(board as Awaited<ReturnType<typeof getLeaderboard>>);
  })
  .get("/presence/online", async (c) => {
    const { db, now } = c.var.deps;
    c.header("Cache-Control", "public, max-age=15");
    return c.json(await listOnlineUsers(db, { now: now() }));
  });
