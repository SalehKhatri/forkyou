import { sessionInputSchema } from "@forkyou/shared";
import { describe, expect, it } from "vitest";
import { ingestSessions } from "../src/services/ingest.js";
import { createUser, NOW, session, setupTestDb } from "./helpers.js";

const db = setupTestDb();
const parse = (s: ReturnType<typeof session>) => sessionInputSchema.parse(s);
const ingest = (userId: string, ...sessions: ReturnType<typeof session>[]) =>
  ingestSessions(db, userId, sessions.map(parse), NOW);

describe("ingestSessions", () => {
  it("stores valid sessions", async () => {
    const user = await createUser(db);
    const result = await ingest(
      user.id,
      session({ endsMinutesAgo: 30 }),
      session({ endsMinutesAgo: 5 }),
    );
    expect(result).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
  });

  it("is idempotent: a retried batch counts as duplicates, not new time", async () => {
    const user = await createUser(db);
    const batch = [session({ endsMinutesAgo: 30 }), session({ endsMinutesAgo: 5 })];
    await ingest(user.id, ...batch);
    expect(await ingest(user.id, ...batch)).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
  });

  it("treats a repeated id within one batch as a duplicate", async () => {
    const user = await createUser(db);
    const s = session();
    expect(await ingest(user.id, s, s)).toEqual({ accepted: 1, duplicates: 1, rejected: [] });
  });

  it("rejects sessions that end in the future (beyond clock skew)", async () => {
    const user = await createUser(db);
    const s = session({ endsMinutesAgo: -5 });
    expect((await ingest(user.id, s)).rejected).toEqual([{ id: s.id, reason: "future_start" }]);
  });

  it("tolerates small client clock skew", async () => {
    const user = await createUser(db);
    const s = session({ endsMinutesAgo: -0.5 });
    expect((await ingest(user.id, s)).accepted).toBe(1);
  });

  it("rejects sessions older than the max age", async () => {
    const user = await createUser(db);
    const s = session({ endsMinutesAgo: 8 * 24 * 60 });
    expect((await ingest(user.id, s)).rejected).toEqual([{ id: s.id, reason: "too_old" }]);
  });

  it("rejects the later of two overlapping sessions in one batch", async () => {
    const user = await createUser(db);
    const first = session({ endsMinutesAgo: 10, minutes: 10 });
    const second = session({ endsMinutesAgo: 5, minutes: 10 });
    const result = await ingest(user.id, second, first);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toEqual([{ id: second.id, reason: "overlaps_in_batch" }]);
  });

  it("rejects sessions overlapping ones already stored", async () => {
    const user = await createUser(db);
    await ingest(user.id, session({ endsMinutesAgo: 10, minutes: 10 }));
    const clash = session({ endsMinutesAgo: 5, minutes: 10 });
    expect((await ingest(user.id, clash)).rejected).toEqual([
      { id: clash.id, reason: "overlaps_existing" },
    ]);
  });

  it("allows back-to-back sessions that only touch at the edges", async () => {
    const user = await createUser(db);
    const a = session({ endsMinutesAgo: 20, minutes: 10 });
    const b = session({ endsMinutesAgo: 10, minutes: 10 });
    expect((await ingest(user.id, a, b)).accepted).toBe(2);
  });

  it("does not compare sessions across users", async () => {
    const alice = await createUser(db);
    const bob = await createUser(db);
    await ingest(alice.id, session({ endsMinutesAgo: 5 }));
    expect((await ingest(bob.id, session({ endsMinutesAgo: 5 }))).accepted).toBe(1);
  });

  it("serialises concurrent batches so overlapping uploads can't both win", async () => {
    const user = await createUser(db);
    const a = session({ endsMinutesAgo: 5, minutes: 10 });
    const b = session({ endsMinutesAgo: 6, minutes: 10 });
    const results = await Promise.all([ingest(user.id, a), ingest(user.id, b)]);
    expect(results.reduce((n, r) => n + r.accepted, 0)).toBe(1);
  });
});
