# 0007: The maintainer can hide accounts from the leaderboard

**Status:** accepted, partly superseded by [ADR 0008](0008-moderation-reason-visibility.md) and
[ADR 0009](0009-staff-roles.md) ·
**Date:** 2026-11-18

## Context

The server bounds what any account can claim to wall-clock time
([ADR 0004](0004-overlap-based-plausibility.md)), but that still allows close to 24 hours a day.
Requests can't be restricted to the real extension ([ADR 0002](0002-no-request-signing.md),
[tracking.md](../tracking.md) → Cheating), so a script or a macro can top the leaderboard. Some
human judgement is needed, and 2.0 deliberately has no roles, admin UI or RBAC.

A daily cap on leaderboard time was considered and rejected: it penalises honest long days and still
lets a cheater reach the cap every day.

## Decision

- Two nullable columns on `users`: `leaderboard_hidden_at` and `leaderboard_hidden_reason`.
- The leaderboard leaves hidden accounts out **before** taking the top 100, so they don't use up a
  slot.
- Nothing else changes for a hidden account: uploads, stats, dashboard and presence keep working.
  Being wrongly hidden costs a user only their place on the public board.
- The user is told: `/v1/me` returns `leaderboardHidden`, and the dashboard explains it and how to
  appeal (email). The reason is a private note for the maintainer and is never returned by the API.
- The maintainer uses a command, not a UI:
  `pnpm --filter @forkyou/api leaderboard hide|show|list`, run against the database like the other
  scripts. No roles, no admin endpoints, so there's nothing new to attack.

## Consequences

- Moderation needs database access. Fine for one maintainer; more moderators would need a
  different approach (and an ADR).
- Changes reach the leaderboard when its cache next refreshes, under a minute.
- Automatic flagging of implausible patterns (e.g. 20+ hours a day) can later set the same columns;
  this ADR only adds the manual path.
- A hidden user can still appear in the public "online now" list. That list isn't a ranking, so it
  isn't worth cheating for.
