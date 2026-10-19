CREATE TABLE "login_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "login_failures_ip_at_idx" ON "login_failures" USING btree ("ip","at");