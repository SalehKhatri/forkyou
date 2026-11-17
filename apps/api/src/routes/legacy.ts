import { Hono } from "hono";
import type { AppEnv } from "../context.js";
import { errorBody } from "../lib/errors.js";

/**
 * Endpoints called by ForkYou 1.x extensions. Their data and API keys did not survive the
 * rewrite, so answer fast with 410 instead of letting old installs hang or retry blindly.
 * Remove once traffic to these paths stops (watch the access logs).
 */
const gone = errorBody(
  "extension_outdated",
  "This version of the ForkYou extension is no longer supported. Update it and sign in again.",
);

export const legacyRoutes = new Hono<AppEnv>().on(
  ["GET", "POST", "PUT"],
  ["/activities/sync", "/verify-key", "/user/status", "/ping"],
  (c) => c.json(gone, 410),
);
