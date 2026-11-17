# Changelog

## 2.0.0 (unreleased)

A rewrite for ForkYou 2.0.

- **New API key needed.** 1.x keys no longer work. The old key is removed without being sent
  anywhere, and you're asked for a new one.
- The API key is stored in your OS keychain instead of plain extension storage.
- File paths are no longer sent. Project names can be turned off with `forkyou.sendProjectName`.
- New commands: **Open Dashboard** and **Show Log**.
- Time is counted only while you're active: a session ends at your last edit, selection or scroll
  once you've been idle for 2 minutes (1.x counted up to 2 idle minutes). Sessions also end when
  the window loses focus or you switch language or project, and are split every 15 minutes.
- Reading and other work in VS Code count too: scrolling, moving the cursor, switching editors,
  terminal commands, tasks, the debugger and notebook cell runs.
- The project is the workspace folder of the file you're editing (1.x always used the first
  folder).

## 1.0.0

Initial release.
