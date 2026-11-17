import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../context.js";

export const healthRoutes = new Hono<AppEnv>().get("/health", async (c) => {
  try {
    await c.var.deps.db.execute(sql`select 1`);
    return c.json({ status: "ok" });
  } catch {
    return c.json({ status: "degraded", db: "unreachable" }, 503);
  }
});
