# 0004: Overlap-based plausibility instead of per-batch duration checks

**Status:** accepted · **Date:** 2026-11-16

## Context

1.x rejected a batch if its total duration exceeded the time since the last sync. That check was
easy to get wrong (it depended on server-side "last synced" state in Redis), rejected whole batches,
and didn't stop a client from replaying old time.

## Decision

Treat each session as a time interval and require that **a user's sessions never overlap** (2 s
edge tolerance). Also reject sessions that end in the future (beyond 60 s skew) or started more than
7 days ago, and cap a session at 15 minutes. Ingestion holds a per-user advisory lock so concurrent
batches can't both pass the check. Rejections are reported per session, with a reason.

## Consequences

- A user's recorded time over any window can't exceed wall-clock time, whatever the client sends.
- Retries are free: duplicates are recognised by id before the overlap check.
- Two editors open at once: the second editor's overlapping sessions are rejected, so time is counted
  once. That's the intended behaviour, but documented so it isn't mistaken for a bug.
- Extensions must split long sessions and drop rejected ids (see `docs/extensions.md`).
