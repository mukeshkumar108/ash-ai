ALTER TABLE "RelationshipInitiative"
ADD COLUMN IF NOT EXISTS "evaluationAt" timestamp DEFAULT now() NOT NULL;
