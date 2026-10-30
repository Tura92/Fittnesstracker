ALTER TABLE "exercises" ADD COLUMN "default_sets" integer;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "default_reps" text;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "default_rir" text;--> statement-breakpoint
-- Vorbelegen mit der Vorgabe aus dem ersten Plantag, in dem die Übung vorkommt (wie bisher der Ersatz im Training)
UPDATE "exercises" e SET "default_sets" = f."sets", "default_reps" = f."reps", "default_rir" = f."rir"
FROM (
  SELECT DISTINCT ON (pi."exercise_id") pi."exercise_id", pi."sets", pi."reps", pi."rir"
  FROM "plan_items" pi JOIN "plan_days" pd ON pd."id" = pi."plan_day_id"
  ORDER BY pi."exercise_id", pd."number", pi."position"
) f
WHERE f."exercise_id" = e."id";
