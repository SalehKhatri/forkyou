import { z } from "zod";
import {
  APPOINTABLE_STAFF_ROLES,
  EDITORS,
  LEADERBOARD_RANGES,
  LEADERBOARD_SIZE,
  LIMITS,
  STAFF_ROLES,
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
  /** Only sessions in this project (exact match). Same limits as a session's project. */
  project: z.string().trim().min(1).max(128).optional(),
  /** Only sessions in this language (exact match). */
  language: z.string().trim().min(1).max(64).optional(),
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;

export const statsResponseSchema = z.object({
  range: z.enum(STATS_RANGES),
  totalSeconds: z.number().int(),
  days: z.array(z.object({ day: z.iso.date(), seconds: z.number().int() })),
  languages: z.array(z.object({ language: z.string(), seconds: z.number().int() })),
  projects: z.array(z.object({ project: z.string(), seconds: z.number().int() })),
  // Added after 2.0. Defaults let clients read responses from servers that predate them.
  /** Seconds per local [weekday][hour]: 7 rows, Monday first, of 24 hours. */
  heatmap: z
    .array(z.array(z.number().int()).length(24))
    .length(7)
    .default(() => Array.from({ length: 7 }, () => Array<number>(24).fill(0))),
  /** Consecutive local days with any coding, over all time, not just `range`. */
  streak: z
    .object({ current: z.number().int(), longest: z.number().int() })
    .default({ current: 0, longest: 0 }),
  highlights: z
    .object({
      activeDays: z.number().int(),
      /** Average over days with any coding, not over every day in the range. */
      dailyAverageSeconds: z.number().int(),
      bestDay: z.object({ day: z.iso.date(), seconds: z.number().int() }).nullable(),
    })
    .default({ activeDays: 0, dailyAverageSeconds: 0, bestDay: null }),
  editors: z.array(z.object({ editor: z.string(), seconds: z.number().int() })).default([]),
  lines: z
    .object({ added: z.number().int(), removed: z.number().int() })
    .default({ added: 0, removed: 0 }),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

/** Today's total, for an editor's status bar. Far cheaper than the full stats. */
export const todayQuerySchema = z.object({ tz: z.string().max(64).default("UTC") });
export const todayResponseSchema = z.object({ day: z.iso.date(), seconds: z.number().int() });
export type TodayResponse = z.infer<typeof todayResponseSchema>;

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
  /**
   * Why, if the maintainer chose to show it (ADR 0008); otherwise null. The data export always
   * includes the reason. Defaults to null so clients accept servers that predate it.
   */
  leaderboardHiddenReason: z.string().nullable().default(null),
  /**
   * The signed-in user's own staff role (ADR 0009), or null. Never returned for anyone else.
   * Defaults to null so clients accept servers that predate it.
   */
  staffRole: z.enum(STAFF_ROLES).nullable().default(null),
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

// ---------------------------------------------------------------- your data

/** Body of `DELETE /v1/me`: the username, typed again, so an account is never deleted by accident. */
export const accountDeleteSchema = z.object({ confirm: z.string() });
export type AccountDelete = z.input<typeof accountDeleteSchema>;

/** One stored coding session, as included in a data export. */
export const exportedSessionSchema = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  durationSeconds: z.number().int(),
  language: z.string(),
  project: z.string().nullable(),
  editor: z.enum(EDITORS),
  linesAdded: z.number().int(),
  linesRemoved: z.number().int(),
  receivedAt: z.iso.datetime(),
});

/** `GET /v1/me/export`: everything ForkYou stores about the signed-in user. */
export const accountExportSchema = z.object({
  exportedAt: z.iso.datetime(),
  user: meResponseSchema.extend({
    githubId: z.number().int(),
    lastSeenAt: z.iso.datetime().nullable(),
    presenceLanguage: z.string().nullable(),
    presenceEditor: z.string().nullable(),
  }),
  apiKeys: z.array(apiKeySchema.extend({ revokedAt: z.iso.datetime().nullable() })),
  sessions: z.array(exportedSessionSchema),
});
export type AccountExport = z.infer<typeof accountExportSchema>;

/** Error envelope returned by every non-2xx API response. */
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------- staff (ADR 0009)

/** PUT /v1/staff/members/:username: appoint someone, or change their role. */
export const staffAppointSchema = z.object({ role: z.enum(APPOINTABLE_STAFF_ROLES) });
export type StaffAppoint = z.infer<typeof staffAppointSchema>;

export const staffMemberSchema = z.object({
  username: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(STAFF_ROLES),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

/** PUT /v1/staff/users/:username/leaderboard-hidden. */
export const leaderboardHideSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Also show the reason on the user's dashboard (ADR 0008). It's in their export either way. */
  showReason: z.boolean().default(false),
});
export type LeaderboardHide = z.infer<typeof leaderboardHideSchema>;

export const hiddenAccountSchema = z.object({
  username: z.string(),
  hiddenAt: z.iso.datetime(),
  reason: z.string().nullable(),
  reasonVisible: z.boolean(),
});
export type HiddenAccount = z.infer<typeof hiddenAccountSchema>;

/** GET /v1/staff/audit: newest first; pass `next` back as `before` for the following page. */
export const auditQuerySchema = z.object({
  /** An opaque cursor from a previous page's `next`. */
  before: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  /** Usernames, or null once that account has been deleted. */
  actor: z.string().nullable(),
  target: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  entries: z.array(auditEntrySchema),
  /** Cursor for the next (older) page, or null when this is the last. */
  next: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;
