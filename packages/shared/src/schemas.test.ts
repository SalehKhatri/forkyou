import { describe, expect, it } from "vitest";
import { LIMITS } from "./constants.js";
import {
  meResponseSchema,
  presenceInputSchema,
  sessionBatchSchema,
  sessionInputSchema,
} from "./schemas.js";

const valid = {
  id: "0b3f9b9e-6f43-4d6c-9a52-2f1d6f0c8a11",
  startedAt: "2026-11-16T10:00:00.000Z",
  durationSeconds: 120,
  language: "typescript",
  editor: "vscode",
};

describe("sessionInputSchema", () => {
  it("accepts a minimal session and defaults line counts", () => {
    const parsed = sessionInputSchema.parse(valid);
    expect(parsed.linesAdded).toBe(0);
    expect(parsed.linesRemoved).toBe(0);
  });

  it("rejects durations outside 1..maxSessionSeconds", () => {
    expect(sessionInputSchema.safeParse({ ...valid, durationSeconds: 0 }).success).toBe(false);
    expect(
      sessionInputSchema.safeParse({ ...valid, durationSeconds: LIMITS.maxSessionSeconds + 1 })
        .success,
    ).toBe(false);
  });

  it("requires a UUID id and an offset timestamp", () => {
    expect(sessionInputSchema.safeParse({ ...valid, id: "abc" }).success).toBe(false);
    expect(sessionInputSchema.safeParse({ ...valid, startedAt: "2026-11-16 10:00" }).success).toBe(
      false,
    );
  });

  it("rejects unknown editors", () => {
    expect(sessionInputSchema.safeParse({ ...valid, editor: "notepad" }).success).toBe(false);
  });
});

describe("sessionBatchSchema", () => {
  it("rejects empty and oversized batches", () => {
    expect(sessionBatchSchema.safeParse({ sessions: [] }).success).toBe(false);
    const big = Array.from({ length: LIMITS.maxSessionsPerBatch + 1 }, () => valid);
    expect(sessionBatchSchema.safeParse({ sessions: big }).success).toBe(false);
  });
});

describe("presenceInputSchema", () => {
  it("accepts an offline signal with no language", () => {
    expect(presenceInputSchema.parse({ online: false })).toEqual({ online: false });
  });
});

describe("meResponseSchema", () => {
  const me = {
    id: "8f9a3c1e-2b4d-4e6f-8a1b-3c5d7e9f0a2b",
    username: "ada",
    name: null,
    avatarUrl: null,
    showPresence: true,
    showLanguage: true,
    createdAt: "2026-11-16T10:00:00.000Z",
  };

  it("accepts responses from servers that predate leaderboardHidden", () => {
    expect(meResponseSchema.parse(me).leaderboardHidden).toBe(false);
  });

  it("keeps leaderboardHidden when the server sends it", () => {
    expect(meResponseSchema.parse({ ...me, leaderboardHidden: true }).leaderboardHidden).toBe(true);
  });
});
