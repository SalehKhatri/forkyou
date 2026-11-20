import { LEADERBOARD_SIZE, sessionInputSchema } from "@forkyou/shared";
import { describe, expect, it } from "vitest";
import { ingestSessions } from "../src/services/ingest.js";
import { getLeaderboard } from "../src/services/leaderboard.js";
import {
  hideFromLeaderboard,
  listHiddenFromLeaderboard,
  showOnLeaderboard,
} from "../src/services/moderation.js";
import {
  createUser,
  createUserWithSession,
  makeApp,
  NOW,
  session,
  setupTestDb,
} from "./helpers.js";

const db = setupTestDb();

async function coded(userId: string, minutes: number) {
  await ingestSessions(db, userId, [sessionInputSchema.parse(session({ minutes }))], NOW);
}

const usernames = async () =>
  (await getLeaderboard(db, "day", NOW)).entries.map((e) => [e.rank, e.username]);

describe("hiding an account from the leaderboard", () => {
  it("removes it from the leaderboard and ranks everyone else without gaps", async () => {
    const ada = await createUser(db, "ada");
    const cheater = await createUser(db, "cheater");
    const linus = await createUser(db, "linus");
    await coded(ada.id, 10);
    await coded(cheater.id, 15);
    await coded(linus.id, 5);

    expect(await hideFromLeaderboard(db, "cheater", "24 h a day for a week", NOW)).toBe(true);

    expect(await usernames()).toEqual([
      [1, "ada"],
      [2, "linus"],
    ]);
  });

  it("doesn't let a hidden account use up one of the top slots", async () => {
    const cheater = await createUser(db, "cheater");
    await coded(cheater.id, 15);
    for (let i = 0; i < LEADERBOARD_SIZE; i++) {
      const user = await createUser(db, `coder${i}`);
      await coded(user.id, 1);
    }

    await hideFromLeaderboard(db, "cheater", "scripted uploads", NOW);
    const board = await getLeaderboard(db, "day", NOW);

    expect(board.entries).toHaveLength(LEADERBOARD_SIZE);
    expect(board.entries.some((e) => e.username === "cheater")).toBe(false);
  });

  it("puts it back when shown again", async () => {
    const ada = await createUser(db, "ada");
    await coded(ada.id, 10);
    await hideFromLeaderboard(db, "ada", "mistake", NOW);

    expect(await showOnLeaderboard(db, "ada")).toBe(true);

    expect(await usernames()).toEqual([[1, "ada"]]);
    expect(await listHiddenFromLeaderboard(db)).toEqual([]);
  });

  it("reports unknown usernames instead of doing nothing silently", async () => {
    expect(await hideFromLeaderboard(db, "nobody", "typo", NOW)).toBe(false);
    expect(await showOnLeaderboard(db, "nobody")).toBe(false);
  });

  it("lists hidden accounts with when and why", async () => {
    await createUser(db, "ada");
    await createUser(db, "cheater");
    await hideFromLeaderboard(db, "cheater", "scripted uploads", NOW);

    expect(await listHiddenFromLeaderboard(db)).toEqual([
      { username: "cheater", hiddenAt: NOW, reason: "scripted uploads", reasonVisible: false },
    ]);
  });

  it("tells the user they're hidden in /v1/me, without the reason unless the maintainer shows it", async () => {
    const { user, cookie } = await createUserWithSession(db, "cheater");
    const app = makeApp(db);
    const before = await (await app.request("/v1/me", { headers: cookie })).json();

    await hideFromLeaderboard(db, "cheater", "scripted uploads", NOW);
    const after = await (await app.request("/v1/me", { headers: cookie })).json();

    expect(before).toMatchObject({ leaderboardHidden: false, leaderboardHiddenReason: null });
    expect(after).toMatchObject({
      id: user.id,
      leaderboardHidden: true,
      leaderboardHiddenReason: null,
    });
    expect(JSON.stringify(after)).not.toContain("scripted uploads");
  });

  it("shows the reason in /v1/me when the maintainer chooses to", async () => {
    const { cookie } = await createUserWithSession(db, "cheater");

    await hideFromLeaderboard(db, "cheater", "24 h a day for a week", NOW, { showReason: true });
    const me = await (await makeApp(db).request("/v1/me", { headers: cookie })).json();

    expect(me).toMatchObject({
      leaderboardHidden: true,
      leaderboardHiddenReason: "24 h a day for a week",
    });
  });

  it("forgets the reason and its visibility when the account is shown again", async () => {
    const { cookie } = await createUserWithSession(db, "ada");
    await hideFromLeaderboard(db, "ada", "mistake", NOW, { showReason: true });

    await showOnLeaderboard(db, "ada");
    await hideFromLeaderboard(db, "ada", "second look", NOW);
    const me = await (await makeApp(db).request("/v1/me", { headers: cookie })).json();

    expect(me).toMatchObject({ leaderboardHidden: true, leaderboardHiddenReason: null });
  });

  it("leaves the user's own stats and uploads untouched", async () => {
    const { user, cookie } = await createUserWithSession(db, "cheater");
    await coded(user.id, 10);
    await hideFromLeaderboard(db, "cheater", "scripted uploads", NOW);

    const stats = (await (
      await makeApp(db).request("/v1/me/stats", { headers: cookie })
    ).json()) as {
      totalSeconds: number;
    };

    expect(stats.totalSeconds).toBe(600);
  });
});
