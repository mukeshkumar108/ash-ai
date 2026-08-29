CREATE TABLE IF NOT EXISTS "CompanionUserState" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "state" json NOT NULL DEFAULT '{}'::json,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
