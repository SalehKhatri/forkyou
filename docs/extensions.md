# Extension protocol

What every ForkYou editor plugin (VS Code, JetBrains, Neovim, …) must do. Shapes and limits come
from `packages/shared`; the VS Code extension can import it directly.

The VS Code extension in [`extensions/vscode`](../extensions/vscode) is the reference
implementation ([ADR 0005](adr/0005-vscode-extension-in-monorepo.md)).

## Setup

1. The user creates an API key at `/settings` and pastes it into the plugin.
2. The plugin calls `GET /v1/me` with `Authorization: Bearer <key>`. `200` means the key is valid;
   show the username. `401` means it's wrong or revoked.
3. Store the key in the editor's secret storage (VS Code `SecretStorage`, JetBrains `PasswordSafe`),
   not in plain settings.

## Sessions

[tracking.md](tracking.md) explains these rules, their accuracy and the anti-cheat model.

A **session** is a continuous stretch of activity in one language and project.

- **Start** on the first edit, selection change or scroll after being inactive.
- **End** on: 2 minutes without interaction, editor window losing focus, switching to a file with a
  different language or project, or the editor closing.
- **Split** any session that reaches 15 minutes: close it and start a new one immediately.
- Discard sessions shorter than 1 second.
- Give every session a fresh UUID (v4) **when it closes**. The id is what makes retries safe.

## Sync

- Append closed sessions to a **persistent** queue (VS Code `globalState`, a file, etc.) so nothing
  is lost if the editor quits while offline.
- Every 60 s, if the queue is non-empty, send up to 500 sessions to `POST /v1/sessions`.
- On `200`: remove every id that appears in `accepted`, `duplicates` **or** `rejected`. Rejected
  sessions will never be accepted, so retrying them would loop forever.
- On a network error or `5xx`: keep the queue and back off (60 s, 2 min, 4 min … capped at 15 min),
  waiting a random 50–100% of each step so clients don't all retry at once after an outage.
- On `401`: stop syncing and prompt the user to re-enter their key. Keep the queue.
- On `400`: a bug in the plugin. Log it, drop that batch, and report it.
- On `410`: the plugin is too old. Tell the user to update.
- On exit: close the current session and attempt one final sync (best effort).
- Drop queued sessions older than 7 days; the server would reject them anyway.
- If several editor windows can run the plugin at once and share storage, give each window its own
  queue so concurrent writes can't lose sessions. Resending is safe; losing isn't.

## Presence

- While the user is active (focused and interacted within 2 minutes), send
  `POST /v1/presence {"online": true, "language": "<current>", "editor": "vscode"}` every 60 s.
- Send `{"online": false}` when going idle, losing focus or exiting.
- Presence is best effort: never retry or queue it.

## Privacy

Send only what's in the schema. Never send file paths, file contents or anything that identifies
files beyond the project (workspace folder) name.

Users can download everything stored about them, or delete their account and all of it, under
Settings → Your data on the website (`GET /v1/me/export`, `DELETE /v1/me`).

ForkYou staff (the maintainer and the moderators they appoint, [ADR 0009](adr/0009-staff-roles.md))
can see a user's coding totals, languages and activity times, to review accounts for the
leaderboard. They can't see project names, API keys or tokens, and every action they take is
recorded.

## Migrating from 1.x

1.x plugins called `/activities/sync`, `/verify-key`, `/user/status` and `/ping`, and signed requests
with a shared secret. Those endpoints now return `410 extension_outdated`, and 1.x API keys no longer
exist. A 2.0 plugin that finds a 1.x-style key (a bare UUID, no `fy_` prefix) should ask the user to
sign in again and create a new key.
