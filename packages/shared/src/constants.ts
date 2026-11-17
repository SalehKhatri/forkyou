/** Limits shared by clients and the server. Changing one is a contract change: see docs/api.md. */
export const LIMITS = {
  /** Max sessions per POST /v1/sessions request. */
  maxSessionsPerBatch: 500,
  /** Max length of a single session. Extensions split longer stretches of work. */
  maxSessionSeconds: 15 * 60,
  /** Sessions older than this are rejected (stale offline queues). */
  maxSessionAgeDays: 7,
  /** Tolerated clock skew between client and server. */
  clockSkewSeconds: 60,
  /** Max lines added/removed recorded for one session. */
  maxLinesPerSession: 100_000,
} as const;

export const PRESENCE = {
  /** Clients send a heartbeat this often while the user is active. */
  heartbeatSeconds: 60,
  /** A user is online if their last heartbeat is newer than this. */
  onlineWindowSeconds: 150,
} as const;

export const EDITORS = ["vscode", "jetbrains", "vim", "other"] as const;
export type Editor = (typeof EDITORS)[number];

export const STATS_RANGES = ["7d", "30d", "365d"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const LEADERBOARD_RANGES = ["day", "week", "month"] as const;
export type LeaderboardRange = (typeof LEADERBOARD_RANGES)[number];

export const LEADERBOARD_SIZE = 100;
