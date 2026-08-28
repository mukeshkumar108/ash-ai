import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db/queries';

/**
 * Delivery-time chat resolution for owner-scoped state whose origin chat is
 * unknown or irrelevant. Tasks are user-owned; the chat is only the
 * projection coordinate, so a chatless (manual/system) task anchors to the
 * user's most recently active conversation at push time.
 */
export async function resolveCurrentBestChatId(userId: string): Promise<string | null> {
  const rows = await db.execute(sql`
    SELECT c.id AS "chatId"
    FROM "Chat" c
    LEFT JOIN (
      SELECT "chatId", MAX("createdAt") AS "lastAt"
      FROM "Message_v2" GROUP BY "chatId"
    ) lm ON lm."chatId" = c.id
    WHERE c."userId" = ${userId}
    ORDER BY COALESCE(lm."lastAt", c."createdAt") DESC
    LIMIT 1
  `);
  const typedRows = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
    (rows as unknown as Array<Record<string, unknown>>);
  const first = (Array.isArray(typedRows) ? typedRows : [])[0];
  return first ? String(first.chatId) : null;
}
