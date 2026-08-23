CREATE TABLE IF NOT EXISTS "CortexOutbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(128) NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"honcho_message_id" varchar(256) NOT NULL,
	"peer_id" varchar(64) NOT NULL,
	"text" text NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/London' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"locked_until" timestamp,
	"last_status_code" integer,
	"last_error" text,
	"degraded_delivery" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cortex_outbox_honcho_message_unique" ON "CortexOutbox" USING btree ("honcho_message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cortex_outbox_due" ON "CortexOutbox" USING btree ("status","next_attempt_at","locked_until");