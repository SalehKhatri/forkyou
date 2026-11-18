import { z } from "zod";
import {
  EDITORS,
  LEADERBOARD_RANGES,
  LEADERBOARD_SIZE,
  LIMITS,
  STATS_RANGES,
} from "./constants.js";

// ---------------------------------------------------------------- ingestion

/** One closed coding session, as sent by an editor extension. */
export const sessionInputSchema = z.object({
  /** Client-generated UUID. Makes retries idempotent. */
  id: z.uuid(),
  /** When the session started (ISO 8601 with offset). */
  startedAt: z.iso.datetime({ offset: true }),
  durationSeconds: z.number().int().min(1).max(LIMITS.maxSessionSeconds),
  language: z.string().trim().min(1).max(64),
  project: z.string().trim().min(1).max(128).optional(),
  editor: z.enum(EDITORS),
  linesAdded: z.number().int().min(0).max(LIMITS.maxLinesPerSession).default(0),
  linesRemoved: z.number().int().min(0).max(LIMITS.maxLinesPerSession).default(0),
});
export type SessionInput = z.input<typeof sessionInputSchema>;
export type Session = z.output<typeof sessionInputSchema>;

export const sessionBatchSchema = z.object({
  sessions: z.array(sessionInputSchema).min(1).max(LIMITS.maxSessionsPerBatch),
});
export type SessionBatch = z.input<typeof sessionBatchSchema>;

export const REJECTION_REASONS = [
  "future_start",
  "too_old",
  "overlaps_existing",
  "overlaps_in_batch",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const ingestResultSchema = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ id: z.uuid(), reason: z.enum(REJECTION_REASONS) })),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

// ---------------------------------------------------------------- presence

export const presenceInputSchema = z.object({
  online: z.boolean(),
  /** Language currently being edited; shown as "coding in X" when the user allows it. */
  language: z.string().trim().min(1).max(64).optional(),
  editor: z.enum(EDITORS).optional(),
});
export type PresenceInput = z.input<typeof presenceInputSchema>;

export const onlineUserSchema = z.object({
  username: z.string(),
  avatarUrl: z.string().nullable(),
  language: z.string().nullable(),
  lastSeenAt: z.iso.datetime(),
});
export type OnlineUser = z.infer<typeof onlineUserSchema>;

// ---------------------------------------------------------------- reads

export const statsQuerySchema = z.object({
  range: z.enum(STATS_RANGES).default("7d"),
  tz: z.string().max(64).default("UTC"),
});

export const statsResponseSchema = z.object({
  range: z.enum(STATS_RANGES),
  totalSeconds: z.number().int(),
  days: z.array(z.object({ day: z.iso.date(), seconds: z.number().int() })),
  languages: z.array(z.object({ language: z.string(), seconds: z.number().int() })),
  projects: z.array(z.object({ project: z.string(), seconds: z.number().int() })),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

export const leaderboardQuerySchema = z.object({
  range: z.enum(LEADERBOARD_RANGES).default("week"),
});

export const leaderboardEntrySchema = z.object({
  rank: z.number().int(),
  username: z.string(),
  avatarUrl: z.string().nullable(),
  totalSeconds: z.number().int(),
  topLanguage: z.string().nullable(),
  online: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = z.object({
  range: z.enum(LEADERBOARD_RANGES),
  entries: z.array(leaderboardEntrySchema).max(LEADERBOARD_SIZE),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

export const meResponseSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  showPresence: z.boolean(),
  showLanguage: z.boolean(),
  /**
   * The maintainer has hidden this account from the leaderboard (ADR 0007). Stats are unaffected.
   * Defaults to false so clients still accept responses from servers that predate it.
   */
  leaderboardHidden: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const settingsUpdateSchema = z.object({
  showPresence: z.boolean().optional(),
  showLanguage: z.boolean().optional(),
});
export type SettingsUpdate = z.input<typeof settingsUpdateSchema>;

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
});

export const apiKeySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

/** Returned once, at creation. The plaintext key is never retrievable again. */
export const apiKeyCreatedSchema = apiKeySchema.extend({ key: z.string() });
export type ApiKeyCreated = z.infer<typeof apiKeyCreatedSchema>;

/** Error envelope returned by every non-2xx API response. */
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
