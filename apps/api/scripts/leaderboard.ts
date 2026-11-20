/**
 * Maintainer tool: keep accounts off the public leaderboard (ADR 0007).
 *
 *   pnpm --filter @forkyou/api leaderboard list
 *   pnpm --filter @forkyou/api leaderboard hide <username> --reason "<why>" [--show-reason]
 *   pnpm --filter @forkyou/api leaderboard show <username>
 *
 * Runs against DATABASE_URL. Changes appear on the leaderboard within about a minute (the API's
 * cache). The user always sees that they're hidden; `--show-reason` also shows them why on their
 * dashboard. Their data export includes the reason either way (ADR 0008).
 */
import { parseArgs } from "node:util";
import { createDb } from "../src/db/client.js";
import { loadEnv } from "../src/env.js";
import {
  hideFromLeaderboard,
  listHiddenFromLeaderboard,
  showOnLeaderboard,
} from "../src/services/moderation.js";

const USAGE = `Usage:
  leaderboard list
  leaderboard hide <username> --reason "<why>" [--show-reason]
  leaderboard show <username>`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { reason: { type: "string" }, "show-reason": { type: "boolean", default: false } },
});
const [command, username] = positionals;

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
let exitCode = 0;
try {
  if (command === "list") {
    const hidden = await listHiddenFromLeaderboard(db);
    if (hidden.length === 0) console.log("No accounts are hidden.");
    for (const h of hidden) {
      const shown = h.reasonVisible ? "shown to user" : "not shown";
      console.log(`${h.username}\t${h.hiddenAt?.toISOString()}\t${shown}\t${h.reason ?? ""}`);
    }
  } else if (command === "hide" && username && values.reason) {
    const ok = await hideFromLeaderboard(db, username, values.reason, new Date(), {
      showReason: values["show-reason"],
    });
    console.log(ok ? `Hid ${username} from the leaderboard.` : `No user named ${username}.`);
    exitCode = ok ? 0 : 1;
  } else if (command === "show" && username) {
    const ok = await showOnLeaderboard(db, username);
    console.log(ok ? `${username} is back on the leaderboard.` : `No user named ${username}.`);
    exitCode = ok ? 0 : 1;
  } else {
    console.error(USAGE);
    exitCode = 2;
  }
} finally {
  await close();
}
process.exit(exitCode);
