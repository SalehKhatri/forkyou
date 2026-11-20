# 0008: Users can see why they were hidden from the leaderboard

**Status:** accepted · **Date:** 2026-11-18 · Supersedes the "the reason is a private note" part of
[ADR 0007](0007-leaderboard-moderation.md)

## Context

ADR 0007 kept the reason for hiding an account from the leaderboard private to the maintainer.
Adding a data export (`GET /v1/me/export`) raised the question again: the reason is data about the
user, people have a right to see the data held about them, and a user who doesn't know why they were
hidden can't usefully appeal. On the other hand, the maintainer may not want every note on the
dashboard, for example while still looking into an account.

## Decision

- **The data export always includes the reason** (`user.leaderboardHiddenReason`).
- **The dashboard shows it only if the maintainer chooses to**, per account:
  `leaderboard hide <username> --reason "…" --show-reason`. A new column,
  `users.leaderboard_hidden_reason_visible` (default `false`), records the choice.
- `/v1/me` returns `leaderboardHiddenReason`: the reason when it's visible, otherwise `null`.
- Showing an account again clears the reason and its visibility.
- Reasons are never shown publicly. The public leaderboard just leaves the account out.

## Consequences

- Reasons should be written as if the user will read them, because they can, through the export.
- `leaderboardHiddenReason` defaults to `null` in `packages/shared`, so clients accept responses
  from servers that predate it.
- Everything else in ADR 0007 stands.
