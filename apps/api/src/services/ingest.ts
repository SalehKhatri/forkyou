import { type IngestResult, LIMITS, type RejectionReason, type Session } from "@forkyou/shared";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { codingSessions } from "../db/schema.js";
import { days, seconds } from "../lib/time.js";

/** Sessions may touch at their edges by this much without counting as overlapping. */
const OVERLAP_TOLERANCE_MS = seconds(2);

type Interval = { id: string; start: number; end: number };

const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end - OVERLAP_TOLERANCE_MS && b.start < a.end - OVERLAP_TOLERANCE_MS;

/**
 * Store a batch of sessions for one user.
 *
 * Guarantees:
 * - Idempotent: re-sending a session id is reported as a duplicate, never double-counted.
 * - Plausible: a user's sessions never overlap, so recorded time can't exceed wall-clock time.
 *   (This replaces v1's per-batch duration check and HMAC signing.)
 * - Serialised per user: concurrent batches for the same user take an advisory lock, so two
 *   overlapping uploads can't both pass the overlap check.
 *
 * Rejected sessions are reported back by id so clients can drop them instead of retrying forever.
 */
export async function ingestSessions(
  db: Db,
  userId: string,
  sessions: Session[],
  now: Date = new Date(),
): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    const rejected: IngestResult["rejected"] = [];
    const reject = (id: string, reason: RejectionReason) => rejected.push({ id, reason });

    // 1. Duplicates (already stored). Checked first: a retried session must never be "rejected".
    const ids = sessions.map((s) => s.id);
    const existing = await tx
      .select({ id: codingSessions.id })
      .from(codingSessions)
      .where(inArray(codingSessions.id, ids));
    const existingIds = new Set(existing.map((r) => r.id));
    const seen = new Set<string>();
    let duplicates = 0;

    // 2. Time-window checks.
    const nowMs = now.getTime();
    const candidates: (Interval & { session: Session })[] = [];
    for (const session of sessions) {
      if (existingIds.has(session.id) || seen.has(session.id)) {
        duplicates++;
        continue;
      }
      seen.add(session.id);
      const start = Date.parse(session.startedAt);
      const end = start + seconds(session.durationSeconds);
      if (end > nowMs + seconds(LIMITS.clockSkewSeconds)) reject(session.id, "future_start");
      else if (start < nowMs - days(LIMITS.maxSessionAgeDays)) reject(session.id, "too_old");
      else candidates.push({ id: session.id, start, end, session });
    }

    // 3. Overlaps within the batch: keep the earlier session.
    candidates.sort((a, b) => a.start - b.start);
    const inBatch: typeof candidates = [];
    for (const c of candidates) {
      const prev = inBatch.at(-1);
      if (prev && overlaps(prev, c)) reject(c.id, "overlaps_in_batch");
      else inBatch.push(c);
    }

    // 4. Overlaps with sessions already stored.
    let accepted = inBatch;
    const first = inBatch[0];
    const last = inBatch.at(-1);
    if (first && last) {
      const stored = await tx
        .select({
          id: codingSessions.id,
          start: codingSessions.startedAt,
          end: codingSessions.endedAt,
        })
        .from(codingSessions)
        .where(
          and(
            eq(codingSessions.userId, userId),
            lt(codingSessions.startedAt, new Date(last.end)),
            gt(codingSessions.endedAt, new Date(first.start)),
          ),
        );
      const storedIntervals = stored.map((s) => ({
        id: s.id,
        start: s.start.getTime(),
        end: s.end.getTime(),
      }));
      accepted = inBatch.filter((c) => {
        const clash = storedIntervals.some((s) => overlaps(s, c));
        if (clash) reject(c.id, "overlaps_existing");
        return !clash;
      });
    }

    // 5. Insert. ON CONFLICT covers an id stored by another user (ids are global).
    let inserted = 0;
    if (accepted.length > 0) {
      const rows = await tx
        .insert(codingSessions)
        .values(
          accepted.map(({ session, start, end }) => ({
            id: session.id,
            userId,
            startedAt: new Date(start),
            endedAt: new Date(end),
            durationSeconds: session.durationSeconds,
            language: session.language,
            project: session.project ?? null,
            editor: session.editor,
            linesAdded: session.linesAdded,
            linesRemoved: session.linesRemoved,
          })),
        )
        .onConflictDoNothing({ target: codingSessions.id })
        .returning({ id: codingSessions.id });
      inserted = rows.length;
    }

    return {
      accepted: inserted,
      duplicates: duplicates + (accepted.length - inserted),
      rejected,
    };
  });
}
