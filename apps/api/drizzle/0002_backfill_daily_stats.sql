-- Fill daily_stats from the sessions stored before it existed (ADR 0006). From here on
-- ingestSessions keeps it up to date. Same query as rebuildDailyStats in src/services/rollups.ts.
INSERT INTO "daily_stats" ("user_id", "day", "language", "seconds")
SELECT "user_id", ("started_at" AT TIME ZONE 'UTC')::date, "language", sum("duration_seconds")::int
FROM "coding_sessions"
GROUP BY 1, 2, 3;
