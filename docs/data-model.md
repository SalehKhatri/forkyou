# Data model

Defined in `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle/`.

```mermaid
erDiagram
  users ||--o{ auth_sessions : has
  users ||--o{ api_keys : has
  users ||--o{ coding_sessions : records
  users {
    uuid id PK
    bigint github_id UK
    text username UK
    bool show_presence
    bool show_language
    timestamptz last_seen_at
    timestamptz offline_at
  }
  auth_sessions {
    text id PK "sha256(cookie token)"
    uuid user_id FK
    timestamptz expires_at
  }
  api_keys {
    uuid id PK
    uuid user_id FK
    text key_hash UK "sha256(key)"
    text key_prefix
    timestamptz revoked_at
  }
  coding_sessions {
    uuid id PK "client-generated"
    uuid user_id FK
    timestamptz started_at
    timestamptz ended_at
    int duration_seconds
    text language
    text project
    text editor
  }
```

## Tables

**`users`**: one row per GitHub account. Identity is `github_id`; `username` follows GitHub renames
on each login. If a username moves to a different GitHub account, the stale row becomes
`<username>~<github_id>` until that person logs in again. Presence lives here (`last_seen_at`,
`offline_at`, `presence_language`, `presence_editor`) because it's a single small row per user.

**`auth_sessions`**: browser logins. The primary key is the SHA-256 of the cookie token. 30-day
sliding expiry; expired rows are deleted when they're next presented.

**`api_keys`**: editor credentials. Only `key_hash` is stored; `key_prefix` (`fy_xxxx`) is for
display. Revoking sets `revoked_at`, which keeps history for `last_used_at`.

**`coding_sessions`**: the fact table. Indexed on `(user_id, started_at)` for per-user reads and on
`started_at` for leaderboard windows. File paths are deliberately not stored.

## Invariants

| Invariant                                                   | Enforced by                                        |
| ----------------------------------------------------------- | -------------------------------------------------- |
| A user's sessions never overlap (beyond 2 s edge tolerance) | `ingestSessions` under a per-user advisory lock    |
| `ended_at > started_at`, `duration_seconds > 0`             | Check constraints                                  |
| A session id is stored at most once                         | Primary key + `ON CONFLICT DO NOTHING`             |
| One user per GitHub id; usernames unique                    | Unique constraints + `upsertGithubUser`            |
| No plaintext secrets at rest                                | Only hashes stored for session tokens and API keys |

Because sessions never overlap, a user's total time over any window can't exceed the wall-clock
length of that window. That's the core anti-cheat property.

## Migrations

1. Edit `schema.ts`.
2. `pnpm db:generate` writes SQL to `apps/api/drizzle/` and updates `drizzle/meta`.
3. Review the SQL, then commit both.
4. Migrations run automatically when the API container starts (`dist/db/migrate.js`).

Never edit a migration that has been merged. Write a new one. For destructive changes (dropping a
column the running version still reads), split into two deploys: stop using it, then drop it.

## Growth plan

Everything is computed from `coding_sessions` on read, which is fine to millions of rows with the
current indexes. When leaderboard or stats queries get slow, add a `daily_stats` rollup maintained in
the ingest transaction (see [ADR 0003](adr/0003-postgres-only.md)).
