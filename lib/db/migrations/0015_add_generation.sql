CREATE TABLE IF NOT EXISTS "Generation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"modelId" varchar(200) NOT NULL,
	"prompt" text NOT NULL,
	"images" json NOT NULL,
	"generationIndex" integer DEFAULT 1 NOT NULL,
	"parentImageId" varchar(200),
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Generation" ADD CONSTRAINT "Generation_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
