CREATE TABLE IF NOT EXISTS "TurnAction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"messageId" uuid,
	"taskId" uuid,
	"action" varchar(24) NOT NULL,
	"evidenceClass" varchar(48),
	"evidenceText" varchar(500),
	"candidateKey" varchar(160),
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "turn_action_message_action_idx" ON "TurnAction" USING btree ("messageId","action","taskId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_action_message_idx" ON "TurnAction" USING btree ("messageId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_action_task_idx" ON "TurnAction" USING btree ("taskId");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "TurnAction" ADD CONSTRAINT "TurnAction_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "TurnAction" ADD CONSTRAINT "TurnAction_taskId_Task_id_fk" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "Task" ALTER COLUMN "chatId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "Task" ALTER COLUMN "source" TYPE varchar(24);
--> statement-breakpoint
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "materializedCandidateKey" varchar(160);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_materialized_candidate_idx" ON "Task" USING btree ("materializedCandidateKey");
--> statement-breakpoint
ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_chatId_Chat_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Task" ADD CONSTRAINT "Task_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "CortexOutbox" ADD COLUMN IF NOT EXISTS "app_message_id" uuid;
