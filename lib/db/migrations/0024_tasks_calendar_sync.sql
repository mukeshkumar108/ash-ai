CREATE TABLE IF NOT EXISTS "Task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"chatId" uuid NOT NULL,
	"title" varchar(280) NOT NULL,
	"notes" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"dueAt" timestamp,
	"snoozeCount" integer DEFAULT 0 NOT NULL,
	"source" varchar(16) DEFAULT 'conversation' NOT NULL,
	"sourceMessageId" uuid,
	"cortexVersion" integer DEFAULT 1 NOT NULL,
	"cortexDirty" boolean DEFAULT true NOT NULL,
	"cortexSyncedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"cancelledAt" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_user_status_due_idx" ON "Task" USING btree ("userId","status","dueAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_cortex_dirty_idx" ON "Task" USING btree ("cortexDirty");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_chat_idx" ON "Task" USING btree ("chatId");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Task" ADD CONSTRAINT "Task_chatId_Chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceMessageId_Message_v2_id_fk" FOREIGN KEY ("sourceMessageId") REFERENCES "Message_v2"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "TaskReminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taskId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"startAt" timestamp NOT NULL,
	"endAt" timestamp,
	"label" varchar(120),
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"firedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_reminder_due_idx" ON "TaskReminder" USING btree ("status","startAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_reminder_task_idx" ON "TaskReminder" USING btree ("taskId");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_taskId_Task_id_fk" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "TaskReminder" ADD CONSTRAINT "TaskReminder_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "CalendarEventSync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"calendarId" varchar(128) DEFAULT 'primary' NOT NULL,
	"eventId" varchar(256) NOT NULL,
	"title" varchar(500),
	"startAt" timestamp,
	"endAt" timestamp,
	"allDay" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"contentHash" varchar(64) NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"completedAt" timestamp,
	"followupWindowEnd" timestamp,
	"followupConsumedAt" timestamp,
	"lastSeenAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_event_sync_unique" ON "CalendarEventSync" USING btree ("userId","calendarId","eventId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "calendar_event_sync_followup_idx" ON "CalendarEventSync" USING btree ("status","endAt");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "CalendarEventSync" ADD CONSTRAINT "CalendarEventSync_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
