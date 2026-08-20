CREATE TABLE IF NOT EXISTS "RelationshipOpportunity" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "chatId" uuid NOT NULL REFERENCES "Chat"("id") ON DELETE cascade,
  "anchorMessageId" uuid NOT NULL REFERENCES "Message_v2"("id") ON DELETE cascade,
  "trigger" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'scheduled' NOT NULL,
  "notBefore" timestamp NOT NULL,
  "context" json,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "claimedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "RelationshipOpportunity_anchor_trigger_idx"
  ON "RelationshipOpportunity" ("anchorMessageId", "trigger");
CREATE INDEX IF NOT EXISTS "RelationshipOpportunity_due_idx"
  ON "RelationshipOpportunity" ("status", "notBefore");
