CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_insider_cost_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"sampled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bytes_billed" bigint DEFAULT 0 NOT NULL,
	"bytes_avoided" bigint DEFAULT 0 NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"misses" integer DEFAULT 0 NOT NULL,
	"hit_rate" double precision,
	"window_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "shopping_insider_cost_samples_sampled_at_idx" ON "shopping_insider_cost_samples" USING btree ("sampled_at");