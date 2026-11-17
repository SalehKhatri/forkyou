import { type SessionInput, sessionBatchSchema } from "@forkyou/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { countLines, IDLE_MS, SessionTracker } from "./tracker.js";

const START = Date.parse("2026-11-17T10:00:00.000Z");
const TS = { language: "typescript", project: "forkyou" };
const SECOND = 1000;
const MINUTE = 60 * SECOND;

let now: number;
let sessions: SessionInput[];
let tracker: SessionTracker;

beforeEach(() => {
  now = START;
  sessions = [];
  let nextId = 0;
  tracker = new SessionTracker({
    now: () => now,
    newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    onSession: (s) => sessions.push(s),
  });
});

/** Moves the fake clock forward. */
const advance = (ms: number) => {
  now += ms;
};

describe("SessionTracker", () => {
  it("emits one session for continuous work, ending when end() is called", () => {
    tracker.activity(TS);
    advance(30 * SECOND);
    tracker.activity(TS);
    advance(30 * SECOND);
    tracker.end();

    expect(sessions).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        startedAt: "2026-11-17T10:00:00.000Z",
        durationSeconds: 60,
        language: "typescript",
        project: "forkyou",
        editor: "vscode",
        linesAdded: 0,
        linesRemoved: 0,
      },
    ]);
  });

  it("ends an idle session at the last activity, so idle time isn't counted", () => {
    tracker.activity(TS);
    advance(45 * SECOND);
    tracker.activity(TS);
    advance(IDLE_MS + SECOND);
    tracker.tick();

    expect(sessions.map((s) => s.durationSeconds)).toEqual([45]);
  });

  it("keeps a session open while gaps stay under the idle limit", () => {
    tracker.activity(TS);
    advance(IDLE_MS - SECOND);
    tracker.tick();
    tracker.activity(TS);
    advance(10 * SECOND);
    tracker.end();

    expect(sessions.map((s) => s.durationSeconds)).toEqual([129]);
  });

  it("starts a new session after a long gap even if tick() never ran (e.g. sleep)", () => {
    tracker.activity(TS);
    advance(20 * SECOND);
    tracker.activity(TS);
    advance(60 * MINUTE);
    tracker.activity(TS);
    advance(5 * SECOND);
    tracker.end();

    expect(sessions.map((s) => [s.startedAt, s.durationSeconds])).toEqual([
      ["2026-11-17T10:00:00.000Z", 20],
      ["2026-11-17T11:00:20.000Z", 5],
    ]);
  });

  it("starts a new session when the language changes", () => {
    tracker.activity(TS);
    advance(40 * SECOND);
    tracker.activity({ language: "rust", project: "forkyou" });
    advance(20 * SECOND);
    tracker.end();

    expect(sessions.map((s) => [s.language, s.startedAt, s.durationSeconds])).toEqual([
      ["typescript", "2026-11-17T10:00:00.000Z", 40],
      ["rust", "2026-11-17T10:00:40.000Z", 20],
    ]);
  });

  it("starts a new session when the project changes", () => {
    tracker.activity(TS);
    advance(10 * SECOND);
    tracker.activity({ language: "typescript", project: "dotfiles" });
    advance(10 * SECOND);
    tracker.end();

    expect(sessions.map((s) => s.project)).toEqual(["forkyou", "dotfiles"]);
  });

  it("splits sessions at 15 minutes into back-to-back pieces", () => {
    tracker.activity(TS);
    for (let minute = 1; minute <= 20; minute++) {
      advance(MINUTE);
      tracker.activity(TS);
    }
    tracker.end();

    expect(sessions.map((s) => [s.startedAt, s.durationSeconds])).toEqual([
      ["2026-11-17T10:00:00.000Z", 900],
      ["2026-11-17T10:15:00.000Z", 300],
    ]);
  });

  it("counts time until blur when the window loses focus mid-session", () => {
    tracker.activity(TS);
    advance(50 * SECOND);
    tracker.end();
    advance(10 * MINUTE);
    tracker.activity(TS);
    advance(5 * SECOND);
    tracker.end();

    expect(sessions.map((s) => s.durationSeconds)).toEqual([50, 5]);
  });

  it("drops sessions shorter than a second", () => {
    tracker.activity(TS);
    advance(900);
    tracker.end();

    expect(sessions).toEqual([]);
  });

  it("adds up line counts and caps them at the server limit", () => {
    tracker.activity(TS, { added: 3, removed: 1 });
    advance(SECOND);
    tracker.activity(TS, { added: 99_999, removed: 2 });
    advance(SECOND);
    tracker.end();

    expect(sessions.map((s) => [s.linesAdded, s.linesRemoved])).toEqual([[100_000, 3]]);
  });

  it("leaves out the project when there isn't one", () => {
    tracker.activity({ language: "markdown" });
    advance(5 * SECOND);
    tracker.end();

    expect(sessions[0]).not.toHaveProperty("project");
  });

  it("emits sessions the API's schema accepts", () => {
    tracker.activity(TS, { added: 2, removed: 0 });
    for (let minute = 1; minute <= 16; minute++) {
      advance(MINUTE);
      tracker.activity(TS);
    }
    tracker.activity({ language: "python" });
    advance(3 * SECOND);
    tracker.end();

    expect(sessions).toHaveLength(3);
    expect(sessionBatchSchema.safeParse({ sessions }).success).toBe(true);
  });

  it("keepAlive() extends the open session (terminal, debugger, tasks)", () => {
    tracker.activity(TS);
    advance(90 * SECOND);
    tracker.keepAlive();
    advance(90 * SECOND);
    tracker.keepAlive();
    advance(IDLE_MS + SECOND);
    tracker.tick();

    expect(sessions.map((s) => s.durationSeconds)).toEqual([180]);
  });

  it("keepAlive() never starts a session on its own", () => {
    tracker.keepAlive();
    advance(30 * SECOND);
    tracker.end();

    expect(sessions).toEqual([]);
  });

  it("keepAlive() after the user went idle closes the session instead of reviving it", () => {
    tracker.activity(TS);
    advance(20 * SECOND);
    tracker.activity(TS);
    advance(IDLE_MS + SECOND);
    tracker.keepAlive();
    advance(30 * SECOND);
    tracker.end();

    expect(sessions.map((s) => s.durationSeconds)).toEqual([20]);
  });

  it("does nothing on end() or tick() with no open session", () => {
    tracker.end();
    tracker.tick();

    expect(sessions).toEqual([]);
  });
});

describe("countLines", () => {
  const change = (text: string, startLine: number, endLine: number) => ({
    text,
    range: { start: { line: startLine }, end: { line: endLine } },
  });

  it("counts inserted line breaks as added lines", () => {
    expect(countLines([change("a\nb\nc\n", 4, 4)])).toEqual({ added: 3, removed: 0 });
  });

  it("counts replaced line spans as removed lines", () => {
    expect(countLines([change("", 2, 5)])).toEqual({ added: 0, removed: 3 });
  });

  it("ignores typing within a line", () => {
    expect(countLines([change("x", 7, 7)])).toEqual({ added: 0, removed: 0 });
  });

  it("adds up multiple changes in one edit (e.g. multi-cursor)", () => {
    expect(countLines([change("\n", 1, 1), change("\n", 3, 4)])).toEqual({ added: 2, removed: 1 });
  });
});
