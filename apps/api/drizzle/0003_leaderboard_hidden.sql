ALTER TABLE "users" ADD COLUMN "leaderboard_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "leaderboard_hidden_reason" text;