CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "rest_timers" (
	"id" serial PRIMARY KEY NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"label" text,
	"message_id" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"fired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "rest_seconds" integer;