ALTER TABLE "User" ADD COLUMN "display_name" varchar(100);--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "language_preference" varchar(10) DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "theme_preference" varchar(20) DEFAULT 'system';