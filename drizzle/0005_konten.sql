CREATE TABLE "invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" integer,
	"used_at" timestamp with time zone,
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Konto 1 übernimmt alle Daten aus der Zeit vor den Konten; Name und Passwort kommen bei der Ersteinrichtung
INSERT INTO "users" ("id", "name", "is_admin") VALUES (1, 'Admin', true);--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('users', 'id'), 1);--> statement-breakpoint
ALTER TABLE "exercises" DROP CONSTRAINT "exercises_name_unique";--> statement-breakpoint
ALTER TABLE "plan_days" DROP CONSTRAINT "plan_days_number_unique";--> statement-breakpoint
DROP INDEX "body_weights_date_idx";--> statement-breakpoint
ALTER TABLE "body_weights" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "body_weights" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "plan_days" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_days" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "rest_timers" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rest_timers" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "user_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_name_idx" ON "users" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "body_weights" ADD CONSTRAINT "body_weights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_days" ADD CONSTRAINT "plan_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rest_timers" ADD CONSTRAINT "rest_timers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "body_weights_user_date_idx" ON "body_weights" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_user_name_idx" ON "exercises" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_days_user_number_idx" ON "plan_days" USING btree ("user_id","number");--> statement-breakpoint
CREATE INDEX "workouts_user_date_idx" ON "workouts" USING btree ("user_id","date");