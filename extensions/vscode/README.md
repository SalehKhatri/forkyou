# ForkYou for VS Code

Track the time you actually spend coding, straight from your editor. See where it goes on your
dashboard at [forkyou.dev](https://forkyou.dev), and climb the leaderboard.

> [!NOTE]
> **In development.** This is the unreleased 2.0 rewrite. Sign-in and session tracking work;
> offline sync and presence are being added and will be in place before 2.0.0 is published. Until
> then, "What's collected" describes the finished extension.

## Getting started

1. Sign in at [forkyou.dev](https://forkyou.dev) with GitHub.
2. Go to **Settings** and create an API key.
3. In VS Code, run **ForkYou: Configure API Key** from the Command Palette and paste the key.

The key is stored in your operating system's keychain, not in your settings.

## Upgrading from 1.x

ForkYou 2.0 is a rewrite, and 1.x API keys no longer work. After the update, the extension removes
your old key (without sending it anywhere) and asks for a new one. Create it in Settings on
forkyou.dev.

## What's collected

For each stretch of coding, ForkYou sends: when it started and how long it lasted, the language,
the editor (`vscode`), how many lines were added and removed, and the workspace folder name.

- **Never sent:** file names, file paths or file contents.
- **Project names** are only visible to you. Turn them off with the `forkyou.sendProjectName`
  setting (it can be set per workspace).
- **Presence:** while you're active, ForkYou tells the server you're online and which language
  you're using. You can hide both in Settings on forkyou.dev.

## Commands

| Command                    | What it does                              |
| -------------------------- | ----------------------------------------- |
| ForkYou: Configure API Key | Add or replace your API key               |
| ForkYou: Clear API Key     | Remove the key and stop tracking          |
| ForkYou: Open Dashboard    | Open your dashboard in the browser        |
| ForkYou: Show Log          | Show the extension's log, for bug reports |

## Settings

| Setting                   | Default                   | Description                                      |
| ------------------------- | ------------------------- | ------------------------------------------------ |
| `forkyou.sendProjectName` | `true`                    | Send the workspace folder name with sessions     |
| `forkyou.apiUrl`          | `https://forkyou.dev/api` | Server URL; only change it for local development |

## Feedback

ForkYou is open source (MIT). Report bugs and ideas at
[github.com/SalehKhatri/forkyou](https://github.com/SalehKhatri/forkyou/issues).
