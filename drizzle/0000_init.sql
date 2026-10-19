CREATE TABLE "body_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"kg" real NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"workout_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"position" integer NOT NULL,
	"rir_last" real,
	"set_count" integer,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"primary_muscle" text NOT NULL,
	"secondary_muscle_1" text,
	"secondary_muscle_2" text,
	"note" text,
	CONSTRAINT "exercises_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "plan_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	CONSTRAINT "plan_days_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_day_id" integer NOT NULL,
	"exercise_id" integer NOT NULL,
	"position" integer NOT NULL,
	"sets" integer,
	"reps" text,
	"rir" text,
	"rest" text
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_id" integer NOT NULL,
	"position" integer NOT NULL,
	"reps" integer,
	"weight" real
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"block" integer NOT NULL,
	"day_number" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_day_id_plan_days_id_fk" FOREIGN KEY ("plan_day_id") REFERENCES "public"."plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_weights_date_idx" ON "body_weights" USING btree ("date");