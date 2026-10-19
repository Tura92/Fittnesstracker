ALTER TABLE "entries" ADD COLUMN "uid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "uid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "uid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_uid_unique" UNIQUE("uid");--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_uid_unique" UNIQUE("uid");--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_uid_unique" UNIQUE("uid");