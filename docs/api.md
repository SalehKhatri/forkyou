# API reference

Base URL: `https://forkyou.dev/api` in production (through the web proxy), or the API host
directly (`http://localhost:4000` locally). Paths below are relative to the base.

The source of truth for every shape and limit is `packages/shared`. This page explains them.

## Authentication

| Method         | Used by                    | How                                                    |
| -------------- | -------------------------- | ------------------------------------------------------ |
| API key        | Editor extensions, scripts | `Authorization: Bearer fy_…`. Create keys in Settings. |
| Session cookie | The web app                | Set by the GitHub login flow. Browsers only.           |

Each endpoint accepts only the methods listed. An API key can't manage API keys, and a browser
cookie can't upload sessions.

## Errors

Every non-2xx response has this shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "✖ Too big: expected number to be <=900 → at sessions[0].durationSeconds"
  }
}
```

| Status | `code`                  | Meaning                                                  |
| ------ | ----------------------- | -------------------------------------------------------- |
| 400    | `invalid_request`       | Body or query failed validation. `message` says where.   |
| 400    | `confirmation_mismatch` | `DELETE /v1/me`: the typed username didn't match         |
| 401    | `unauthorized`          | Missing, unknown or revoked credentials                  |
| 403    | `forbidden`             | Staff endpoint, and your role doesn't allow it           |
| 403    | `outranked`             | Staff action on yourself or on equal or higher staff     |
| 404    | `not_found`             | Unknown route or resource (including another user's key) |
| 410    | `extension_outdated`    | A ForkYou 1.x endpoint. The client must update.          |
| 413    | `payload_too_large`     | Body too large (sessions: 512 KB)                        |
| 503    | `oauth_unconfigured`    | GitHub login isn't configured on this server             |
| 500    | `internal`              | Bug. Logged with a request id.                           |

## Limits

| Limit                           | Value                                                   |
| ------------------------------- | ------------------------------------------------------- |
| Sessions per batch              | 500                                                     |
| Session length                  | 1 s – 15 min (extensions split longer stretches)        |
| Session age                     | ≤ 7 days old (older offline-queue entries are rejected) |
| Clock skew tolerated            | 60 s                                                    |
| Lines added/removed per session | ≤ 100,000                                               |
| Presence heartbeat              | every 60 s; online window 150 s                         |

## Endpoints

### `POST /v1/sessions` (API key)

Upload closed coding sessions.

```json
{
  "sessions": [
    {
      "id": "0b3f9b9e-6f43-4d6c-9a52-2f1d6f0c8a11",
      "startedAt": "2026-11-16T10:00:00.000Z",
      "durationSeconds": 420,
      "language": "typescript",
      "project": "forkyou",
      "editor": "vscode",
      "linesAdded": 12,
      "linesRemoved": 3
    }
  ]
}
```

`project`, `linesAdded` and `linesRemoved` are optional. `editor` is one of `vscode`, `jetbrains`,
`vim`, `other`.

Response `200`:

```json
{ "accepted": 1, "duplicates": 0, "rejected": [{ "id": "…", "reason": "overlaps_existing" }] }
```

| Rejection reason    | Meaning                                                          | Client action                |
| ------------------- | ---------------------------------------------------------------- | ---------------------------- |
| `future_start`      | Session ends after server time + skew                            | Drop; check the device clock |
| `too_old`           | Started more than 7 days ago                                     | Drop                         |
| `overlaps_in_batch` | Overlaps an earlier session in the same batch                    | Drop                         |
| `overlaps_existing` | Overlaps a session already stored (e.g. another editor was open) | Drop                         |

The whole batch is never rejected for one bad session (apart from schema errors, which are `400`).
**Clients must drop every id in `accepted`, `duplicates` and `rejected`** and retry only on network
errors or 5xx.

### `POST /v1/presence` (API key)

```json
{ "online": true, "language": "rust", "editor": "vscode" }
```

`204`. Send `online: true` every 60 s while the user is active and `online: false` on idle, blur or exit.

### `GET /v1/presence/online` (public)

```json
{
  "count": 12,
  "users": [{ "username": "ada", "avatarUrl": null, "language": "rust", "lastSeenAt": "…" }]
}
```

Up to 100 users, most recent first. Respects each user's privacy settings. Cached 15 s.

### `GET /v1/leaderboard?range=day|week|month` (public)

Rolling 24 h / 7 d / 30 d windows. Top 100. Cached 30 s. Accounts hidden by the maintainer
(ADR 0007) are left out.

```json
{
  "range": "week",
  "entries": [
    {
      "rank": 1,
      "username": "ada",
      "avatarUrl": null,
      "totalSeconds": 5400,
      "topLanguage": "rust",
      "online": true
    }
  ]
}
```

### `GET /v1/me` (API key or cookie)

The current user. Extensions use it to check a key during setup.

```json
{
  "id": "…",
  "username": "ada",
  "name": "Ada",
  "avatarUrl": "…",
  "showPresence": true,
  "showLanguage": true,
  "leaderboardHidden": false,
  "leaderboardHiddenReason": null,
  "staffRole": null,
  "createdAt": "…"
}
```

`leaderboardHidden` is `true` when the maintainer has kept the account off the public leaderboard
([ADR 0007](adr/0007-leaderboard-moderation.md)); stats and uploads are unaffected.
`leaderboardHiddenReason` is the reason if the maintainer chose to show it, otherwise `null`
([ADR 0008](adr/0008-moderation-reason-visibility.md)). Both were added after the first 2.0
release, so clients should treat missing values as `false` and `null`.

`staffRole` is the signed-in user's own staff role, `"moderator"`, `"admin"` or `"super_admin"`,
or `null` ([ADR 0009](adr/0009-staff-roles.md)). It's never returned for anyone else. Treat a
missing value as `null`.

### `PATCH /v1/me/settings` (cookie)

`{ "showPresence"?: boolean, "showLanguage"?: boolean }` → the updated user.

### `GET /v1/me/today?tz=<IANA zone>` (API key or cookie)

Seconds coded today, a calendar day in `tz` (default `UTC`; unknown zones are a `400`). It counts
the same sessions as the last entry of `days` in `/v1/me/stats`, but it's one cheap query. Editors
show it in the status bar and ask after every upload, so use this rather than the full stats.

```json
{ "day": "2026-11-20", "seconds": 5400 }
```

### `GET /v1/me/stats?range=7d|30d|365d&tz=<IANA zone>[&project=…][&language=…]` (API key or cookie)

`tz` defaults to `UTC`; unknown zones are a `400`. Everything covers the same calendar days in `tz`:
today and the 6, 29 or 364 days before it. A session counts toward the day it started. `days` is
dense (one entry per day, oldest first, zero-filled). Languages and projects return the top 20.

```json
{
  "range": "7d",
  "totalSeconds": 14460,
  "days": [{ "day": "2026-11-10", "seconds": 0 }],
  "languages": [{ "language": "python", "seconds": 3360 }],
  "projects": [{ "project": "forkyou", "seconds": 6900 }],
  "heatmap": [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 300, 600, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  "streak": { "current": 4, "longest": 19 },
  "highlights": {
    "activeDays": 5,
    "dailyAverageSeconds": 2892,
    "bestDay": { "day": "2026-11-14", "seconds": 6900 }
  },
  "editors": [{ "editor": "vscode", "seconds": 14460 }],
  "lines": { "added": 1840, "removed": 620 }
}
```

- `heatmap`: seconds per local weekday and hour, 7 rows (Monday first) of 24. A session is split
  across the hours it spans, so 10:55–11:10 adds 300 to 10:00 and 600 to 11:00. Values are rounded
  to the second, so the cells can differ from `totalSeconds` by a few seconds. (The example shows
  one row.)
- `streak`: consecutive local days with any coding, over **all time**, not just `range`. Today
  isn't over yet, so a streak that reached yesterday is still `current`.
- `highlights`: `activeDays` are days in the range with any coding. `dailyAverageSeconds` averages
  over those days, not every day in the range. `bestDay` is the day with the most time (the
  earliest on a tie), or `null` if there was none.
- `editors`: every editor, most time first. `lines`: lines added and removed in the range.

**Filters.** `project=<name>` and `language=<id>` narrow every figure, the streak included, to
sessions with exactly that project or language. Both can be combined, for example
`/v1/me/stats?range=30d&project=forkyou&language=rust`. Sessions only have a project when the
editor sends one (`forkyou.sendProjectName`). An empty value is a `400`; a name with no sessions
returns empty figures. Servers from before the filters ignore them and return unfiltered figures.

These five fields were added after 2.0. `packages/shared` gives them empty defaults, so clients
also accept responses from older servers.

### `DELETE /v1/me` (cookie)

Deletes the account and everything stored for it: coding sessions, the daily rollup, API keys and
browser logins. The body must repeat the username exactly, so an account is never deleted by
accident:

```json
{ "confirm": "ada" }
```

`204` and the session cookie is cleared. `400 confirmation_mismatch` if `confirm` isn't the
username. API keys can't delete accounts (`401`).

### `GET /v1/me/export` (cookie)

Everything ForkYou stores about you, as a JSON file download
(`Content-Disposition: attachment; filename="forkyou-<username>-<date>.json"`):

```json
{
  "exportedAt": "2026-11-18T09:00:00.000Z",
  "user": { "id": "…", "username": "ada", "githubId": 1, "…": "…" },
  "apiKeys": [{ "id": "…", "name": "Laptop", "prefix": "fy_ab12", "revokedAt": null, "…": "…" }],
  "sessions": [
    { "id": "…", "startedAt": "…", "durationSeconds": 420, "language": "rust", "…": "…" }
  ]
}
```

`user` is the `/v1/me` response plus `githubId` and the latest presence, and
`leaderboardHiddenReason` is always filled in when the account is hidden, even if it isn't shown on
the dashboard (ADR 0008). Never included: API key and login token hashes. Shape:
`accountExportSchema` in `packages/shared`.

### API keys (cookie)

| Endpoint              | Body / response                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /v1/keys`        | `[{ id, name, prefix, lastUsedAt, createdAt }]`, active keys only                                  |
| `POST /v1/keys`       | `{ name }` → `201 { id, name, prefix, lastUsedAt, createdAt, key }`. **`key` is shown only once.** |
| `DELETE /v1/keys/:id` | `204`, or `404` if it isn't yours or is already revoked                                            |

### Auth (browser)

| Endpoint                    |                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /auth/github`          | Starts the OAuth flow (redirect)                                                           |
| `GET /auth/github/callback` | OAuth callback → sets the session cookie → redirects to `/dashboard` (or `/login?error=…`) |
| `POST /auth/logout`         | `204`. Deletes the session and clears the cookie.                                          |

### Staff (cookie, staff only)

Staff tools ([ADR 0009](adr/0009-staff-roles.md)). They take a browser session only: an API key
gets `401`, even a super admin's. Someone without the right role gets `403 forbidden`, and staff
can't act on their own account or on staff ranked at or above them (`403 outranked`).

| Endpoint                                              | Role        | Body / response                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/staff/members`                               | super admin | `[{ username, avatarUrl, role }]`, most trusted first, super admins included                                                                                                                                                       |
| `PUT /v1/staff/members/:username`                     | super admin | `{ "role": "moderator" \| "admin" }` → `{ username, avatarUrl, role }`. `404` if they've never signed in.                                                                                                                          |
| `DELETE /v1/staff/members/:username`                  | super admin | `204`, or `404` if they aren't staff                                                                                                                                                                                               |
| `GET /v1/staff/leaderboard-hidden`                    | moderator   | `[{ username, hiddenAt, reason, reasonVisible }]`, oldest first                                                                                                                                                                    |
| `PUT /v1/staff/users/:username/leaderboard-hidden`    | moderator   | `{ "reason": "…", "showReason"?: false }` → `204`. Hiding again replaces the reason.                                                                                                                                               |
| `DELETE /v1/staff/users/:username/leaderboard-hidden` | moderator   | `204`, or `404` if the account isn't hidden                                                                                                                                                                                        |
| `GET /v1/staff/overview`                              | moderator   | `{ generatedAt, users: { total, staff, hiddenFromLeaderboard }, activeUsers: { today, week, month }, onlineNow, days: [{ day, signups, activeUsers, seconds }], languages, editors }`. Cached for a minute.                        |
| `GET /v1/staff/users/:username?range=7d&tz=<zone>`    | moderator   | The account for review: profile, `staffRole`, `leaderboard` (hidden, reason, visibility), `apiKeys` (active count, last use), `recent` seconds (24 h / 7 d / 30 d) and `stats` as in `/v1/me/stats`, but `projects` is always `[]` |
| `POST /v1/staff/users/:username/revoke-keys`          | admin       | `{ "revoked": 2 }`. Revokes every active key; `0` changes and records nothing.                                                                                                                                                     |
| `GET /v1/staff/audit?limit=50&before=<cursor>`        | admin       | `{ entries: [{ id, action, actor, target, details, createdAt }], next }`, newest first                                                                                                                                             |

"Role" is the least trusted role allowed; more trusted roles can too. Super admins are set with
`SUPER_ADMIN_GITHUB_IDS` and can't be appointed or removed through the API.

The overview uses UTC days (it reads the `daily_stats` rollup): `days` is the last 30, zero-filled;
`languages` is the top 10 over 30 days; `editors` covers the last 7 days. `onlineNow` only counts
people who allow being shown online.

Lookup never returns project names (they're private to their owner), API keys or token hashes.
Any staff member can look up any account, since looking isn't acting. Revoked keys stop working
immediately; the user creates a new one in Settings.

Hiding and showing take effect on the public leaderboard immediately. The rules are the same as the
CLI's ([ADR 0007](adr/0007-leaderboard-moderation.md), [ADR 0008](adr/0008-moderation-reason-visibility.md)).

Every write is recorded in the audit log. `actor` and `target` are usernames, or `null` once that
account has been deleted. `limit` is 1–200 (default 50). To read older entries, pass `next` back as
`before`; it's `null` on the last page. A `before` value the API didn't produce is a `400`.

### `GET /health`

`200 {"status":"ok"}`, or `503` if the database is unreachable.

## Versioning

- Additive changes (new optional fields, new endpoints) ship within `/v1`.
- Removing or changing a field, or tightening a limit, requires `/v2` or a deprecation period long
  enough for extensions to update. Extensions in the wild can't be upgraded instantly.
