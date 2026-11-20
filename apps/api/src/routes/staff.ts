import {
  auditQuerySchema,
  leaderboardHideSchema,
  staffAppointSchema,
  staffUserQuerySchema,
} from "@forkyou/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { AppError, notFound } from "../lib/errors.js";
import { isValidTimeZone } from "../lib/time.js";
import { validate } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireStaff } from "../middleware/staff.js";
import { getOverview } from "../services/overview.js";
import {
  appointStaff,
  hideAccount,
  listHiddenAccounts,
  listStaff,
  lookupUser,
  type Refusal,
  readAudit,
  removeStaff,
  revokeUserKeys,
  showAccount,
} from "../services/staff.js";

const actor = (c: Context<AppEnv>) => ({ id: c.var.user.id, role: c.var.staffRole });

function refused(refusal: Refusal): never {
  switch (refusal) {
    case "not_found":
      throw notFound("User");
    case "not_staff":
      throw notFound("Staff member");
    case "not_hidden":
      throw notFound("Hidden account");
    case "outranked":
      throw new AppError(
        403,
        "outranked",
        "You can't act on your own account or on staff ranked at or above you",
      );
  }
}

/**
 * Staff tools (ADR 0009). Mounted at /v1/staff. Browser sessions only: an API key never reaches
 * these, even a super admin's.
 */
export const staffRoutes = new Hono<AppEnv>()
  .use(requireAuth("session"))

  .get("/members", requireStaff("manageStaff"), async (c) =>
    c.json(await listStaff(c.var.deps.db, c.var.deps.env)),
  )
  .put(
    "/members/:username",
    requireStaff("manageStaff"),
    validate("json", staffAppointSchema),
    async (c) => {
      const { db, env, now } = c.var.deps;
      const result = await appointStaff(
        db,
        env,
        actor(c),
        c.req.param("username"),
        c.req.valid("json").role,
        now(),
      );
      if (!result.ok) refused(result.refusal);
      return c.json(result.member);
    },
  )
  .delete("/members/:username", requireStaff("manageStaff"), async (c) => {
    const { db, env, now } = c.var.deps;
    const result = await removeStaff(db, env, actor(c), c.req.param("username"), now());
    if (!result.ok) refused(result.refusal);
    return c.body(null, 204);
  })

  // ------------------------------------------------------------ leaderboard moderation
  .get("/leaderboard-hidden", requireStaff("review"), async (c) =>
    c.json(await listHiddenAccounts(c.var.deps.db)),
  )
  .put(
    "/users/:username/leaderboard-hidden",
    requireStaff("moderate"),
    validate("json", leaderboardHideSchema),
    async (c) => {
      const { db, env, now, leaderboardCache } = c.var.deps;
      const body = c.req.valid("json");
      const result = await hideAccount(db, env, actor(c), c.req.param("username"), body, now());
      if (!result.ok) refused(result.refusal);
      leaderboardCache.clear();
      return c.body(null, 204);
    },
  )
  .delete("/users/:username/leaderboard-hidden", requireStaff("moderate"), async (c) => {
    const { db, env, now, leaderboardCache } = c.var.deps;
    const result = await showAccount(db, env, actor(c), c.req.param("username"), now());
    if (!result.ok) refused(result.refusal);
    leaderboardCache.clear();
    return c.body(null, 204);
  })

  // ------------------------------------------------------------ overview
  .get("/overview", requireStaff("review"), async (c) => {
    const { db, env, now, overviewCache } = c.var.deps;
    return c.json(await overviewCache.getOrSet("overview", () => getOverview(db, env, now())));
  })

  // ------------------------------------------------------------ accounts
  .get(
    "/users/:username",
    requireStaff("review"),
    validate("query", staffUserQuerySchema),
    async (c) => {
      const query = c.req.valid("query");
      if (!isValidTimeZone(query.tz))
        throw new AppError(400, "invalid_request", `Unknown time zone: ${query.tz}`);
      const { db, env, now } = c.var.deps;
      const user = await lookupUser(db, env, c.req.param("username"), query, now());
      if (!user) throw notFound("User");
      return c.json(user);
    },
  )
  .post("/users/:username/revoke-keys", requireStaff("revokeKeys"), async (c) => {
    const { db, env, now } = c.var.deps;
    const result = await revokeUserKeys(db, env, actor(c), c.req.param("username"), now());
    if (!result.ok) refused(result.refusal);
    return c.json({ revoked: result.revoked });
  })

  // ------------------------------------------------------------ audit log
  .get("/audit", requireStaff("readAudit"), validate("query", auditQuerySchema), async (c) => {
    const page = await readAudit(c.var.deps.db, c.req.valid("query"));
    if (!page) throw new AppError(400, "invalid_request", "Unknown audit cursor");
    return c.json(page);
  });
