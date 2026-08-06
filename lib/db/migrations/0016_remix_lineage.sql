ALTER TABLE "Generation" RENAME COLUMN "parentImageId" TO "parentOutputPathname";
--> statement-breakpoint
ALTER TABLE "Generation" ADD COLUMN "parentGenerationId" uuid;
--> statement-breakpoint
ALTER TABLE "Generation" ADD COLUMN "instruction" text;
--> statement-breakpoint
ALTER TABLE "Generation" ADD COLUMN "inputImages" json;
--> statement-breakpoint
ALTER TABLE "Generation" ADD COLUMN "remixState" json;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "Generation" ADD CONSTRAINT "Generation_parentGenerationId_Generation_id_fk" FOREIGN KEY ("parentGenerationId") REFERENCES "public"."Generation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Generation_parentGenerationId_idx" ON "Generation" ("parentGenerationId");
