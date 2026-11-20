# 0009: Staff roles: a super admin, admins and moderators

**Status:** accepted · **Date:** 2026-11-20 · Partly supersedes [ADR 0007](0007-leaderboard-moderation.md)
("no roles, no admin endpoints") and the "roles/RBAC" cut in
[architecture.md](../architecture.md#whats-deliberately-not-here)

## Context

Moderation is a CLI command run against the production database (ADR 0007). That works for one
maintainer, but ADR 0007 already noted that more moderators would need a different approach. The
maintainer also wants an overview of the service (sign-ups, activity) and a queue of accounts that
look implausible, without running SQL by hand.

That needs staff who can act through the API, with some trusted less than others. 2.0 cut roles to
keep the core small and the attack surface smaller, so the design has to stay close to that goal:
few roles, fixed permissions, nothing self-service.

## Decision

**Three fixed roles,** ordered from most to least trusted:

| Role            | How someone gets it                            | Stored                           |
| --------------- | ---------------------------------------------- | -------------------------------- |
| **Super admin** | Their GitHub id is in `SUPER_ADMIN_GITHUB_IDS` | Config only, never the database  |
| **Admin**       | Appointed by a super admin                     | `users.staff_role = 'admin'`     |
| **Moderator**   | Appointed by a super admin                     | `users.staff_role = 'moderator'` |

GitHub ids are used rather than usernames because a GitHub username can be renamed and then
claimed by someone else.

**Permissions are fixed in code**, not configurable:

| Capability                                               | Moderator | Admin | Super admin |
| -------------------------------------------------------- | :-------: | :---: | :---------: |
| Overview stats, review queue, user lookup                |     ✓     |   ✓   |      ✓      |
| Hide or show an account on the leaderboard (with reason) |     ✓     |   ✓   |      ✓      |
| Revoke a user's API keys                                 |           |   ✓   |      ✓      |
| Read the audit log                                       |           |   ✓   |      ✓      |
| Appoint or remove admins and moderators                  |           |       |      ✓      |

**Rules:**

- Staff endpoints live under `/v1/staff/*` and accept only a browser session cookie, never an API
  key. Keys live in editors and leak more easily.
- The role is checked on every request, so removing someone's role takes effect at once, even in
  the middle of their session. Being a super admin can't be granted or removed through the app or
  the database.
- Nobody can act on themselves or on someone of equal or higher rank. For example, a moderator
  can't hide an admin, and nobody can hide a super admin.
- Only an existing account (one that has signed in once) can be appointed. The role belongs to the
  user id, so a later username change keeps it.
- Every write is recorded in an `admin_actions` audit table: who did what to whom, why and when.
- Staff never see project names. The docs promise that projects are private to their owner, and
  moderation only needs totals, languages and timing. Staff never see API keys or tokens either.
- The review queue only flags accounts for a human to look at. Nothing is hidden automatically.
- `/v1/me` returns the signed-in user's own `staffRole` (`null`, `"moderator"`, `"admin"` or
  `"super_admin"`), so the web app can show the admin link. It's never returned for anyone else.
- The `leaderboard` CLI stays, for when the web app is down.

Out of scope: deleting or editing other people's accounts or sessions (editing sessions would also
break the `daily_stats` rollup, ADR 0006), and acting as another user.

## Consequences

- Anyone who can write to the database can make themselves an admin or moderator. They still
  can't become super admin or appoint staff. Database access already gives full control, so this
  adds no new risk.
- A new env var, `SUPER_ADMIN_GITHUB_IDS`. Without it nobody is a super admin, so nobody can be
  appointed, and the staff API is unusable. That makes it off by default for self-hosters.
- The API grows a privileged surface. Every staff endpoint needs tests for each role, including
  each refusal.
- The privacy section of [extensions.md](../extensions.md#privacy) says that staff can see a
  user's totals, languages and activity times. Database access allowed that already; the API makes
  it routine, so it should be public.
- The web pages for staff wait for the branding work. Until then, the API is used from tests and
  `curl`.
