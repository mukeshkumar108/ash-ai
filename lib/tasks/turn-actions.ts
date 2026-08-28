import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/queries';
import { turnAction, type TurnAction } from '@/lib/db/schema';

/**
 * Real-time action ledger. One idempotent row per canonical fast-path action:
 * - the Cortex outbox delivery enriches the turn payload with these actions so
 *   the background watcher deterministically suppresses its own duplicates;
 * - the Things UI reads them for inline "Reminder set — Friday 09:00 · undo"
 *   confirmations. No client-side parallel lifecycle.
 */

export type TurnActionInput = {
  userId: string;
  messageId?: string | null;
  taskId?: string | null;
  action: 'created' | 'updated' | 'completed' | 'cancelled';
  evidenceClass?: string | null;
  evidenceText?: string | null;
  candidateKey?: string | null;
};

export async function recordTurnAction(input: TurnActionInput): Promise<TurnAction | null> {
  if (input.taskId == null && input.messageId == null) return null;
  const inserted = await db
    .insert(turnAction)
    .values({
      userId: input.userId,
      messageId: input.messageId ?? null,
      taskId: input.taskId ?? null,
      action: input.action,
      evidenceClass: input.evidenceClass ?? null,
      evidenceText: input.evidenceText?.slice(0, 500) ?? null,
      candidateKey: input.candidateKey ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return inserted[0] ?? null;
}

export async function listTurnActionsForMessage(
  userId: string,
  messageId: string,
): Promise<TurnAction[]> {
  if (!messageId) return [];
  return db
    .select()
    .from(turnAction)
    .where(and(eq(turnAction.userId, userId), eq(turnAction.messageId, messageId)))
    .orderBy(desc(turnAction.createdAt));
}

export async function listRecentTurnActions(
  userId: string,
  limit = 10,
): Promise<TurnAction[]> {
  return db
    .select()
    .from(turnAction)
    .where(eq(turnAction.userId, userId))
    .orderBy(desc(turnAction.createdAt))
    .limit(Math.max(1, Math.min(limit, 25)));
}
