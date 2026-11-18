import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { matchedRoutes } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Deps } from "./context.js";
import { AppError, errorBody } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { legacyRoutes } from "./routes/legacy.js";
import { v1Routes } from "./routes/v1.js";

/**
 * Build the HTTP app. No CORS on purpose: browsers reach the API through the web app's
 * same-origin /api proxy, and editor extensions aren't browsers. That also makes the cookie
 * endpoints immune to cross-site JSON requests.
 */
export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    if (c.req.path === "/health") return; // Uptime checks would drown everything else.
    deps.log.info("request", {
      method: c.req.method,
      // The matched pattern (/v1/keys/:id), never the raw path or query, which can carry ids.
      route: matchedRoutes(c).findLast((r) => r.method !== "ALL")?.path ?? "(unmatched)",
      status: c.res.status,
      ms: Math.round((performance.now() - started) * 10) / 10,
      requestId: c.get("requestId"),
    });
  });
  app.use(secureHeaders());
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.route("/", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/v1", v1Routes);
  app.route("/", legacyRoutes);

  app.notFound((c) => c.json(errorBody("not_found", "Route not found"), 404));

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json(errorBody(err.code, err.message), err.status);
    if (err instanceof HTTPException) {
      return c.json(errorBody("http_error", err.message), err.status);
    }
    deps.log.error("unhandled error", err, { requestId: c.get("requestId") });
    return c.json(errorBody("internal", "Internal server error"), 500);
  });

  return app;
}
