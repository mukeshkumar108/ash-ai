CREATE TABLE IF NOT EXISTS "RelationshipInitiative" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "chatId" uuid NOT NULL REFERENCES "Chat"("id") ON DELETE cascade,
  "trigger" varchar(24) NOT NULL,
  "triggerMessageId" uuid NOT NULL REFERENCES "Message_v2"("id") ON DELETE cascade,
  "dedupeKey" varchar(180) NOT NULL,
  "status" varchar(24) DEFAULT 'evaluating' NOT NULL,
  "candidateKind" varchar(40),
  "topicKey" varchar(80),
  "reason" text,
  "evidence" json,
  "guidance" text,
  "generatedMessageId" uuid REFERENCES "Message_v2"("id") ON DELETE set null,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "decidedAt" timestamp,
  "sentAt" timestamp,
  "repliedAt" timestamp,
  "replyMessageId" uuid REFERENCES "Message_v2"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "RelationshipInitiative_dedupe_idx" ON "RelationshipInitiative" ("dedupeKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RelationshipInitiative_user_created_idx" ON "RelationshipInitiative" ("userId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RelationshipInitiative_chat_created_idx" ON "RelationshipInitiative" ("chatId", "createdAt");
