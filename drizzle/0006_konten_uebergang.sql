-- Übergang: Vercel-Previews migrieren dieselbe Datenbank wie die laufende App. Die ältere Version
-- kennt user_id noch nicht; mit Standardwert 1 (Konto des bisherigen Besitzers) kann sie weiter
-- speichern, bis die neue Version live ist. Der neue Code setzt user_id immer selbst.
ALTER TABLE "body_weights" ALTER COLUMN "user_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "user_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "plan_days" ALTER COLUMN "user_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "user_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "rest_timers" ALTER COLUMN "user_id" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "workouts" ALTER COLUMN "user_id" SET DEFAULT 1;
