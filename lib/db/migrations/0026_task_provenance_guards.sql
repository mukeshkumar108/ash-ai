-- Provenance ledger hardening for canonical tasks.
-- 1. TurnAction: Postgres treats NULLs as distinct in unique indexes, so the
--    (messageId, action, taskId) composite cannot dedupe rows where either id
--    is NULL. Two partial unique indexes close the NULL holes without widening
--    the contract to block legitimate repeated operations on different targets:
--    - records without a task id (pre-task create rows) dedupe by
--      (userId, messageId, action);
--    - message-less manual UI actions dedupe by (userId, action, taskId).
-- 2. Task: candidate materialization is made idempotent by enforcing at most
--    one canonical Task per (userId, materializedCandidateKey).
CREATE UNIQUE INDEX IF NOT EXISTS "turn_action_user_message_action_idx" ON "TurnAction" USING btree ("userId","messageId","action") WHERE ("taskId" IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "turn_action_user_action_idx" ON "TurnAction" USING btree ("userId","action","taskId") WHERE ("messageId" IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_materialized_candidate_key_unique" ON "Task" USING btree ("userId","materializedCandidateKey") WHERE ("materializedCandidateKey" IS NOT NULL);