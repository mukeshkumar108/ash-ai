CREATE TABLE IF NOT EXISTS "StreamTrace" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "turnId" uuid NOT NULL,
  "chatId" uuid NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "env" varchar(16) DEFAULT 'production' NOT NULL,
  "resumableEnabled" boolean DEFAULT false NOT NULL,
  "chatRouteStartedMs" integer,
  "runtimeStreamConnectedMs" integer,
  "runtimeFirstTextDeltaMs" integer,
  "firstDataStreamWriteMs" integer,
  "firstOutputChunkMs" integer,
  "runtimeCompletedMs" integer,
  "responseStreamClosedMs" integer,
  "chunksBeforeCompleted" integer DEFAULT 0 NOT NULL,
  "firstChunkBytes" integer,
  "firstFewChunksBytes" integer,
  "coalescedIntoFirstBrowserChunk" boolean DEFAULT false NOT NULL,
  "browserFirstChunkMs" integer,
  "browserFirstTextDeltaMs" integer,
  "runtimeTiming" json,
  "error" text
);

CREATE INDEX IF NOT EXISTS "StreamTrace_turn_created_idx"
  ON "StreamTrace" ("turnId", "createdAt");
CREATE INDEX IF NOT EXISTS "StreamTrace_created_idx"
  ON "StreamTrace" ("createdAt");