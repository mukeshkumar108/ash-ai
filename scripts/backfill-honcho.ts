import postgres from 'postgres';

import { mirrorCompletedTurn } from '@/lib/honcho';
import { getDatabaseUrl } from '@/lib/db/env';

type VisibleMessage = {
  id: string;
  chatId: string;
  userId: string;
  role: string;
  parts: Array<{ type?: string; text?: string }>;
  createdAt: Date;
};

function visibleText(parts: VisibleMessage['parts']) {
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

async function main() {
  if (!process.env.HONCHO_URL?.trim()) {
    throw new Error('HONCHO_URL is required');
  }

  const sql = postgres(getDatabaseUrl(), { max: 1 });
  try {
    const messages = await sql<VisibleMessage[]>`
      select
        m.id,
        m."chatId",
        c."userId",
        m.role,
        m.parts,
        m."createdAt"
      from "Message_v2" m
      join "Chat" c on c.id = m."chatId"
      join "User" u on u.id = c."userId"
      where u.email not like 'guest-%'
        and u.email not like '%@playwright.com'
        and u.email not like '%@playwright.local'
        and u.email not like '%@local.test'
      order by c."userId", m."chatId", m."createdAt", m.id
    `;

    let mirrored = 0;
    let failed = 0;
    for (let index = 0; index < messages.length; index += 1) {
      const userMessage = messages[index];
      if (userMessage.role !== 'user') continue;

      const assistantMessage = messages[index + 1];
      if (
        !assistantMessage ||
        assistantMessage.chatId !== userMessage.chatId ||
        assistantMessage.role !== 'assistant'
      ) {
        continue;
      }

      const userText = visibleText(userMessage.parts);
      const assistantText = visibleText(assistantMessage.parts);
      if (!userText || !assistantText) continue;

      const result = await mirrorCompletedTurn({
        userId: userMessage.userId,
        chatId: userMessage.chatId,
        userMessage: {
          id: userMessage.id,
          text: userText,
          createdAt: userMessage.createdAt,
        },
        assistantMessage: {
          id: assistantMessage.id,
          text: assistantText,
          createdAt: assistantMessage.createdAt,
        },
      });

      if (result.mirrored) mirrored += 1;
      else failed += 1;
      index += 1;
    }

    console.log(
      JSON.stringify({ completedTurns: mirrored + failed, mirrored, failed }),
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backfill failed');
  process.exitCode = 1;
});
