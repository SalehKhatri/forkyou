import { LEADERBOARD_RANGES, type ReviewQueueEntry, type StaffOverview } from "@forkyou/shared";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { TtlCache } from "./lib/cache.js";
import { createLogger } from "./lib/log.js";
import { deleteExpiredAuthSessions } from "./services/auth.js";
import { createGithubOAuth } from "./services/github.js";
import { getLeaderboard } from "./services/leaderboard.js";

const env = loadEnv();
const log = createLogger(env.NODE_ENV === "production" ? "json" : "pretty");
const { db, close } = createDb(env.DATABASE_URL);

const github =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? createGithubOAuth({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        redirectUri: env.GITHUB_REDIRECT_URI,
      })
    : null;
if (!github) log.info("GITHUB_CLIENT_ID/SECRET not set: login is disabled");

const leaderboardCache = new TtlCache<unknown>(30_000, {
  onError: (range, error) => log.error("leaderboard refresh failed", error, { range }),
});
const overviewCache = new TtlCache<StaffOverview>(60_000, {
  onError: (_key, error) => log.error("staff overview refresh failed", error),
});
const reviewQueueCache = new TtlCache<ReviewQueueEntry[]>(60_000, {
  onError: (_key, error) => log.error("review queue refresh failed", error),
});
const app = createApp({
  db,
  env,
  github,
  leaderboardCache,
  overviewCache,
  reviewQueueCache,
  log,
  now: () => new Date(),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info("api listening", { port: info.port });
  // Warm the cache so the first visitors after a deploy don't wait for the leaderboard query.
  for (const range of LEADERBOARD_RANGES) {
    leaderboardCache
      .getOrSet(range, () => getLeaderboard(db, range, new Date()))
      .catch((error) => log.error("leaderboard warm-up failed", error, { range }));
  }
});

// Expired logins are deleted when presented; this catches the ones nobody presents again.
async function sweepExpiredSessions() {
  try {
    const deleted = await deleteExpiredAuthSessions(db, new Date());
    if (deleted > 0) log.info("deleted expired login sessions", { count: deleted });
  } catch (error) {
    log.error("expired session sweep failed", error);
  }
}
void sweepExpiredSessions();
const sweep = setInterval(sweepExpiredSessions, 60 * 60_000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(sweep);
    server.close(async () => {
      await close();
      process.exit(0);
    });
  });
}
