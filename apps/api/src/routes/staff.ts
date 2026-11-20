import { staffAppointSchema } from "@forkyou/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { AppError, notFound } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { requireStaff } from "../middleware/staff.js";
import { appointStaff, listStaff, type Refusal, removeStaff } from "../services/staff.js";

const actor = (c: Context<AppEnv>) => ({ id: c.var.user.id, role: c.var.staffRole });

function refused(refusal: Refusal): never {
  switch (refusal) {
    case "not_found":
      throw notFound("User");
    case "not_staff":
      throw notFound("Staff member");
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
      const { db, env } = c.var.deps;
      const result = await appointStaff(
        db,
        env,
        actor(c),
        c.req.param("username"),
        c.req.valid("json").role,
      );
      if (!result.ok) refused(result.refusal);
      return c.json(result.member);
    },
  )
  .delete("/members/:username", requireStaff("manageStaff"), async (c) => {
    const { db, env } = c.var.deps;
    const result = await removeStaff(db, env, actor(c), c.req.param("username"));
    if (!result.ok) refused(result.refusal);
    return c.body(null, 204);
  });
