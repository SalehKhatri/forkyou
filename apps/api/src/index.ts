import { LEADERBOARD_RANGES } from "@forkyou/shared";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { TtlCache } from "./lib/cache.js";
import { createLogger } from "./lib/log.js";
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
const app = createApp({ db, env, github, leaderboardCache, log, now: () => new Date() });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info("api listening", { port: info.port });
  // Warm the cache so the first visitors after a deploy don't wait for the leaderboard query.
  for (const range of LEADERBOARD_RANGES) {
    leaderboardCache
      .getOrSet(range, () => getLeaderboard(db, range, new Date()))
      .catch((error) => log.error("leaderboard warm-up failed", error, { range }));
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await close();
      process.exit(0);
    });
  });
}
