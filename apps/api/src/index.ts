import { LEADERBOARD_RANGES } from "@forkyou/shared";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { TtlCache } from "./lib/cache.js";
import { createGithubOAuth } from "./services/github.js";
import { getLeaderboard } from "./services/leaderboard.js";

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);

const github =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? createGithubOAuth({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        redirectUri: env.GITHUB_REDIRECT_URI,
      })
    : null;
if (!github) console.warn("GITHUB_CLIENT_ID/SECRET not set: login is disabled");

const leaderboardCache = new TtlCache<unknown>(30_000, {
  onError: (key, error) => console.error(`leaderboard refresh failed (range=${key})`, error),
});
const app = createApp({ db, env, github, leaderboardCache, now: () => new Date() });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
  // Warm the cache so the first visitors after a deploy don't wait for the leaderboard query.
  for (const range of LEADERBOARD_RANGES) {
    leaderboardCache
      .getOrSet(range, () => getLeaderboard(db, range, new Date()))
      .catch((error) => console.error(`leaderboard warm-up failed (range=${range})`, error));
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
