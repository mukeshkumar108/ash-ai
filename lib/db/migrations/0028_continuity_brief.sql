CREATE TABLE IF NOT EXISTS "ContinuityBrief" (
  "id" varchar(180) PRIMARY KEY NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id"),
  "userDay" varchar(10) NOT NULL,
  "daypart" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "sourceSnapshot" json NOT NULL,
  "editorial" json,
  "lastError" text,
  "generatedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ContinuityBrief_user_daypart_unique"
    UNIQUE ("userId", "userDay", "daypart")
);

CREATE INDEX IF NOT EXISTS "ContinuityBrief_user_recent_idx"
  ON "ContinuityBrief" ("userId", "createdAt" DESC);
