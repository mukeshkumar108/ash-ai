ALTER TABLE "RelationshipOpportunity"
  ADD COLUMN IF NOT EXISTS "followupDueAt" timestamp,
  ADD COLUMN IF NOT EXISTS "followupSentAt" timestamp,
  ADD COLUMN IF NOT EXISTS "finalDueAt" timestamp,
  ADD COLUMN IF NOT EXISTS "finalSentAt" timestamp,
  ADD COLUMN IF NOT EXISTS "closedAt" timestamp;

CREATE INDEX IF NOT EXISTS "RelationshipOpportunity_followup_due_idx"
  ON "RelationshipOpportunity" ("status", "followupDueAt");