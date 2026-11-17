# How coding time is tracked

What counts as coding time, how accurate it is, and what stops people from inflating it. The rules
live in two places:

- **The extension** decides when you're working ([`extensions/vscode/src/tracker.ts`](../extensions/vscode/src/tracker.ts),
  wired to VS Code in [`editor.ts`](../extensions/vscode/src/editor.ts)). It's on your machine, so
  it serves honest users. It can't stop anyone.
- **The server** decides what it will accept ([`apps/api/src/services/ingest.ts`](../apps/api/src/services/ingest.ts)).
  It's the only place rules can be enforced, because anyone can send requests with their own API
  key without using the extension ([ADR 0002](adr/0002-no-request-signing.md)).

## What counts as working

You're working while VS Code is focused and you've interacted with it recently. Nothing counts
while the window isn't focused. These count as activity:

| Signal                      | Typical cause                                         |
| --------------------------- | ----------------------------------------------------- |
| Edit in the active editor   | Typing, pasting, refactoring, accepting a suggestion  |
| Selection or cursor change  | Clicking, moving the cursor, selecting code           |
| Visible range change        | Scrolling, jumping to a definition                    |
| Switching editors           | Opening a file, changing tabs                         |
| Focusing the VS Code window | Coming back from another app                          |
| Terminal                    | Switching terminals, a command starting or finishing¹ |
| Tasks                       | A build or test task starting or finishing            |
| Debugger                    | Starting/stopping, stepping, setting breakpoints      |
| Notebooks                   | Adding or moving cells, a cell run starting or ending |

¹ Commands starting and finishing need VS Code 1.93 or later; older versions count terminal
switches only.

Code signals are attributed to that file's language and project. The others (terminal, tasks,
debugger, notebooks, focus) are attributed to the active editor; with no editor open they only
extend the session you're in and never start one. Streaming output, such as a long-running
notebook cell or terminal command printing, doesn't count, because nobody needs to be there.

Reading counts. Scrolling, moving the cursor and clicking through code are all activity, and the
quiet time between two interactions is counted as long as it's under **2 minutes**. Ten minutes of
reading with a scroll or click every minute or so counts as ten minutes.

Edits in background documents (a formatter touching other files, Git, other extensions) don't
count. Neither do output panels, diff views, settings editors or other non-code documents.

## Sessions

Activity is grouped into **sessions**: continuous stretches in one language and one project. A
session:

- **starts** at the first activity,
- **ends at your last activity** after 2 minutes without any; the idle 2 minutes aren't counted,
- **ends at the moment** the VS Code window loses focus (quiet time before that counts, up to 2
  minutes),
- **ends** when you switch to a file in a different language or workspace folder, starting a new
  one immediately,
- is **split** into back-to-back pieces every 15 minutes (the server's limit),
- is **dropped** if it's shorter than a second.

### Example

| Time     | You                            | Counted                                         |
| -------- | ------------------------------ | ----------------------------------------------- |
| 10:00:00 | Open `api.ts`, start typing    | Session starts                                  |
| 10:01:30 | Stop typing, read the function | Still counting (gap under 2 min)                |
| 10:03:00 | Scroll down                    | 10:00:00–10:03:00 so far                        |
| 10:04:00 | Click into `README.md`         | TypeScript session ends: 4 min. Markdown starts |
| 10:04:40 | ⌘-Tab to the browser           | Markdown session ends: 40 s                     |
| 10:20:00 | Back, type in `api.ts`         | New TypeScript session                          |
| 10:21:00 | Walk away                      |                                                 |
| 10:23:00 | (2 min idle)                   | Session ends at 10:21:00: 1 min                 |

Total: 5 min 40 s. The 15 minutes in the browser and the 2 idle minutes aren't counted.

## How accurate it is

The rules aim to be **close for honest users and to err on the low side**. The leaderboard
compares people, so missing a little of someone's time is better than giving anyone free time.

**Where it undercounts:**

- **Long stretches without input.** Reading one screen of code for more than 2 minutes without
  scrolling or clicking stops the session at your last interaction.
- **Work outside VS Code**: docs in a browser, a separate terminal app, design tools, meetings.
- **VS Code visible but not focused**, for example on a second monitor while you type elsewhere.
- **Parts of VS Code without an activity signal**: typing in an AI chat panel, the Git panel,
  search results and the file explorer. VS Code doesn't expose events for these, so they count only
  through the 2-minute gap between other activity. Typing a long command in the terminal counts
  when it starts running.
- **Rounding**: each session is rounded down to the second.

**Where it overcounts:**

- **Short breaks.** A gap of up to 2 minutes between two interactions is counted, even if you
  looked away. At most 2 minutes per gap.
- **Quiet time before blur.** Leaving VS Code within 2 minutes of your last interaction counts that
  quiet time.

**Two windows at once:** each window tracks separately. The server rejects any session that
overlaps one it already has, so the same minute is never counted twice.

**Lines added and removed** count line breaks inserted and line spans replaced in the active
editor. Edits an AI assistant applies to the open file count too, so line counts measure change
volume, not authorship. They're shown on your dashboard, not used for the leaderboard.

## Cheating

Assume a cheater can run any code on their machine and send any request with their own API key.
The extension's rules don't bind them, so they're not a defence. What the server enforces is.

### What the server enforces today

| Rule ([ADR 0004](adr/0004-overlap-based-plausibility.md))              | Stops                                                                |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A user's sessions can't overlap (2 s tolerance), under a per-user lock | Running several editors, scripts or replays at once to multiply time |
| Sessions can't end in the future (60 s clock skew allowed)             | Claiming time that hasn't happened                                   |
| Sessions can't be older than 7 days                                    | Backfilling months of fake history                                   |
| Sessions are 1 s – 15 min, at most 500 per request                     | Single giant sessions; oversized uploads                             |
| Session ids are unique                                                 | Re-sending the same session                                          |

Together these guarantee that **no account can claim more time than has actually passed**: at most
24 hours a day, 168 a week. Every request also needs a valid API key, so time is always tied to a
GitHub account that can be removed from the leaderboard.

### What that doesn't stop

That ceiling is far above what anyone really codes. Someone who sends fake sessions with a script,
or keeps VS Code scrolling with a macro, can record close to 24 hours a day and top the leaderboard.
The server only sees sessions, not the activity behind them, so it can't tell an auto-scroller
from someone reading code.

| Approach                                 | Bounded by today                          |
| ---------------------------------------- | ----------------------------------------- |
| Fake sessions sent with curl or a script | Wall clock: ≤ 24 h/day                    |
| A macro that scrolls or types in VS Code | Wall clock: ≤ 24 h/day                    |
| Running several editors at once          | Fully stopped (overlap rule)              |
| Replaying old sessions                   | Fully stopped (ids, 7-day limit, overlap) |
| Modifying the extension                  | Same as a script                          |

Closing that gap is the server's job. Planned: a way for the maintainer to remove an account from
the leaderboard (its owner still sees all their time on their dashboard). Under consideration:
automatically flagging patterns no person produces, such as 20+ hours in a day. Each gets its own
ADR. A daily cap on leaderboard time was considered and rejected: it penalises honest long days and
still lets a cheater reach the cap every day.

### Why requests can't be limited to the extension

Making the API accept sessions only from the real extension isn't possible. Whatever the extension
uses to prove it's genuine (a secret, a signature, an obfuscated algorithm) ships to every user's
machine in a public, open-source package, and anyone can copy it into a script. ForkYou 1.x tried
exactly this with a signing secret. It stopped no one and caused an outage
([ADR 0002](adr/0002-no-request-signing.md)). VS Code offers no way for a server to verify which
extension is calling it.

It also wouldn't help. A cheater can run the genuine, unmodified extension and keep VS Code busy
with a macro. Every request would be real, and the time would still be fake.

So ForkYou judges **what** is claimed, not **which program** sent it: the wall-clock rules above,
and accounts the maintainer can remove from the leaderboard.
