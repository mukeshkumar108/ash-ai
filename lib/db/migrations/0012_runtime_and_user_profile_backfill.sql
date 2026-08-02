ALTER TABLE "Chat"
ADD COLUMN IF NOT EXISTS "relationship_dynamics" json,
ADD COLUMN IF NOT EXISTS "continuity_events" json;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "rp_display_name" varchar(100),
ADD COLUMN IF NOT EXISTS "rp_age" varchar(32),
ADD COLUMN IF NOT EXISTS "rp_location" varchar(120),
ADD COLUMN IF NOT EXISTS "rp_occupation" varchar(120),
ADD COLUMN IF NOT EXISTS "rp_vibe" varchar(160);
