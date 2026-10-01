import 'server-only';

import { after } from 'next/server';
import type { z } from 'zod';

import { commitTurnSemantics } from '@/lib/ai/interaction/commit-turn';
import { activeIdleOpportunity } from '@/lib/ai/relationship/policy';
import { scheduleInitiativeOpportunity } from '@/lib/ai/relationship/store';
import { db, updateChatSessionRouting } from '@/lib/db/queries';
import { message as messageTable } from '@/lib/db/schema';
import { mirrorCompletedTurn } from '@/lib/honcho';
import type { transcriptReliabilitySchema } from '@/lib/transcript-reliability';
import type { ChatMessage } from '@/lib/types';

/**
 * Post-reply persistence shared by every Runtime-backed modality (text chat
 * and voice calls): the canonical assistant message, the verbatim Runtime
 * session state, and the existing best-effort mirrors. Nothing here
 * interprets the conversation.
 */
export function boundedRecentContext(messages: ChatMessage[]): string {
  return messages
    .slice(0, -1)
    .slice(-6)
    .map((entry) => {
      const text = entry.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join(' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 700);
      return text ? `${entry.role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(-3_500);
}

export async function persistRuntimeReply(input: {
  assistantText: string;
  beats?: string[] | null;
  beatDelivery?: Array<{ kind: 'immediate' | 'continuation'; available_after_ms: number }> | null;
  nextSessionState?: unknown;
  assistantId: string;
  chatId: string;
  userId: string;
  userMessageId: string;
  userText: string;
  userCreatedAt: Date;
  timeZone: string;
  recentContext: string;
  transcriptReliability: z.infer<typeof transcriptReliabilitySchema> | null;
}) {
  const {
    assistantText,
    beats: resultBeats,
    beatDelivery,
    nextSessionState,
    assistantId,
    chatId,
    userId,
    userMessageId,
    userText,
    userCreatedAt,
    timeZone,
    recentContext,
    transcriptReliability,
  } = input;
  const assistantCreatedAt = new Date();
  const beats =
    resultBeats && resultBeats.length >= 2 ? resultBeats.slice(0, 3) : [];
  const delivery = beatDelivery ?? [];
  const textParts =
    beats.length >= 2
      ? beats.flatMap((beat, beatIndex) => {
          const item = delivery[beatIndex] ?? {
            kind:
              beatIndex === 0
                ? ('immediate' as const)
                : ('continuation' as const),
            available_after_ms: 0,
          };
          return [
            {
              type: 'data-beatDelivery' as const,
              data: {
                beatIndex,
                kind: item.kind,
                availableAt: new Date(
                  assistantCreatedAt.getTime() + item.available_after_ms,
                ).toISOString(),
              },
            },
            { type: 'text' as const, text: beat },
          ];
        })
      : [{ type: 'text' as const, text: assistantText }];
  const inserted = await db
    .insert(messageTable)
    .values({
      id: assistantId,
      role: 'assistant',
      parts: textParts,
      createdAt: assistantCreatedAt,
      attachments: [],
      chatId,
    })
    .onConflictDoNothing()
    .returning({ id: messageTable.id });

  if (
    nextSessionState &&
    typeof nextSessionState === 'object' &&
    !Array.isArray(nextSessionState)
  ) {
    const sessionRouting = nextSessionState as Record<string, unknown>;
    after(async () => {
      await updateChatSessionRouting({
        id: chatId,
        userId,
        sessionRouting,
        timeoutMs: Number(
          process.env.SESSION_ROUTING_UPDATE_TIMEOUT_MS ?? 2_000,
        ),
      }).catch((error) => {
        console.warn('[chat] streamed session routing update failed open', {
          chatId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    });
  }

  if (inserted.length === 0) return;
  after(async () => {
    const opportunity = activeIdleOpportunity(assistantCreatedAt);
    await scheduleInitiativeOpportunity({
      userId,
      chatId,
      anchorMessageId: assistantId,
      trigger: opportunity.trigger,
      notBefore: opportunity.notBefore,
      context: opportunity.context,
    }).catch(() => undefined);
    try {
      await commitTurnSemantics({
        userId,
        chatId,
        messageId: userMessageId,
        userText,
        assistantText,
        localTime: new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone,
        }).format(assistantCreatedAt),
        timeZone,
        referenceTime: assistantCreatedAt,
        recentContext,
        signal: AbortSignal.timeout(
          Number(
            process.env.SOPHIE_COMMITMENT_INTERPRETER_TIMEOUT_MS ?? 8_000,
          ) + 15_000,
        ),
      });
    } catch (error) {
      console.warn('[tasks] streamed semantic commit failed open', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
    await mirrorCompletedTurn({
      userId,
      chatId,
      userMessage: {
        id: userMessageId,
        text: userText,
        createdAt: userCreatedAt,
        inputSource: transcriptReliability?.source ?? 'typed',
        transcriptReliability,
      },
      assistantMessage: {
        id: assistantId,
        text: assistantText,
        createdAt: assistantCreatedAt,
      },
    });
  });
}

