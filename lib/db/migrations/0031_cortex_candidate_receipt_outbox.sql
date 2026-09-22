CREATE TABLE IF NOT EXISTS "CortexCandidateReceiptOutbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "receipt_id" varchar(200) NOT NULL,
  "decision_id" varchar(200) NOT NULL,
  "turn_id" varchar(200) NOT NULL,
  "candidate_id" varchar(240) NOT NULL,
  "candidate_version" varchar(80) NOT NULL,
  "workspace_id" varchar(128) NOT NULL,
  "owner_peer_id" varchar(128) NOT NULL,
  "assistant_message_id" uuid NOT NULL REFERENCES "Message_v2"("id") ON DELETE CASCADE,
  "occurred_at" timestamp NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_attempt_at" timestamp,
  "next_attempt_at" timestamp,
  "locked_until" timestamp,
  "last_status_code" integer,
  "last_error" text,
  "delivered_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "cortex_candidate_receipt_id_unique"
  ON "CortexCandidateReceiptOutbox" ("receipt_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cortex_candidate_receipt_decision_candidate_unique"
  ON "CortexCandidateReceiptOutbox" ("decision_id", "candidate_id");
CREATE INDEX IF NOT EXISTS "cortex_candidate_receipt_due"
  ON "CortexCandidateReceiptOutbox" ("status", "next_attempt_at", "locked_until");
