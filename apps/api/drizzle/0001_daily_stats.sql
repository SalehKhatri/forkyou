CREATE TABLE "daily_stats" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"language" text NOT NULL,
	"seconds" integer NOT NULL,
	CONSTRAINT "daily_stats_user_id_day_language_pk" PRIMARY KEY("user_id","day","language")
);
--> statement-breakpoint
ALTER TABLE "daily_stats" ADD CONSTRAINT "daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_stats_day_idx" ON "daily_stats" USING btree ("day");