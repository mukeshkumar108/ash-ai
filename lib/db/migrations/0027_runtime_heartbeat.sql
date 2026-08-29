CREATE TABLE IF NOT EXISTS "RuntimeHeartbeat" (
  "worker" varchar(64) PRIMARY KEY NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'idle',
  "lastStartedAt" timestamp,
  "lastCompletedAt" timestamp,
  "lastFailedAt" timestamp,
  "lastDurationMs" integer,
  "lastSummary" json,
  "lastError" text,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
