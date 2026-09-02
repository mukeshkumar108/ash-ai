import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  finalPhraseForLocalHour,
  pickPhrase,
  rotationIndexForUser,
} from '@/lib/ai/relationship/followup-phrases';
import {
  armWindowState,
  isConversationOpeningMessage,
  MAX_WINDOW_MS,
  type FollowupRandom,
  type FollowupStageState,
} from '@/lib/ai/relationship/followup-core';
import {
  anchorStillOpen,
  cancelWindow,
  closeWindow,
  existingSentFollowupCount,
  listDueActiveIdleWindows,
  persistFollowupMessage,
  tryArmWindow,
  tryClaimFinalSend,
  tryClaimFirstSend,
  type DueActiveWindowRow,
} from '@/lib/ai/relationship/followup-store';
import { localDateKey } from '@/lib/ai/relationship/situation';

/**
 * Deterministic active-conversation follow-up sweep. Driven by the minute-level
 * cron. It performs cheap DB/state work only: no cortex calls, no model
 * providers, no generation. Returns a summary for the heartbeat.
 */
export async function sweepActiveConversationFollowups(input?: {
  now?: Date;
  random?: FollowupRandom;
  timeZone?: string;
}): Promise<{
  windows: number;
  sentFirst: number;
  sentFinal: number;
  cancelled: number;
}> {
  const now = input?.now ?? new Date();
  const random: FollowupRandom = input?.random ?? Math.random;
  const timeZone =
    input?.timeZone ?? process.env.ASH_TIME_ZONE?.trim() ?? 'Europe/London';
  const localDay = localDateKey(now, timeZone);

  const candidates = await listDueActiveIdleWindows(now, MAX_WINDOW_MS);
  const summary = { windows: 0, sentFirst: 0, sentFinal: 0, cancelled: 0 };

  for (const candidate of candidates) {
    if (candidate.milestone === 'arm') {
      // First contact with this window: gate deterministically, then persist
      // the randomized due timestamps exactly once. Never a model call.
      if (
        !isConversationOpeningMessage(candidate.anchorText) ||
        !(await anchorStillOpen({
          chatId: candidate.chatId,
          anchorMessageId: candidate.anchorMessageId,
        }))
      ) {
        await cancelWindow(candidate.id, now);
        summary.cancelled += 1;
        continue;
      }
      const stage: FollowupStageState = armWindowState(
        {
          windowId: candidate.id,
          userId: candidate.userId,
          chatId: candidate.chatId,
          anchorMessageId: candidate.anchorMessageId,
          anchorCreatedAt: new Date(candidate.anchorCreatedAt).getTime(),
        },
        random,
      );
      summary.windows += 1;
      // Persist due timestamps only if not already armed (overlap-safe). The
      // SQL milestone classification in the next tick reads the persisted row,
      // so the losing invocation cannot re-randomize or double-arm.
      await tryArmWindow({
        windowId: candidate.id,
        followupDueAt: new Date(stage.followupDueAt),
        finalDueAt: new Date(stage.finalDueAt),
      });
      continue;
    }

    if (candidate.milestone === 'first') {
      const claimed = await tryClaimFirstSend({ windowId: candidate.id, now });
      if (!claimed) continue;
      const stage = stageFromRow(candidate);
      await sendFirst(stage, candidate.id, now, localDay, summary);
      continue;
    }

    // milestone === 'final'
    const claimed = await tryClaimFinalSend({ windowId: candidate.id, now });
    if (!claimed) continue;
    const stage = stageFromRow(candidate);
    await sendFinal(stage, candidate.id, now, timeZone, localDay, summary);
  }

  return summary;
}

function stageFromRow(row: DueActiveWindowRow): FollowupStageState {
  return {
    windowId: row.id,
    userId: row.userId,
    chatId: row.chatId,
    anchorMessageId: row.anchorMessageId,
    anchorCreatedAt: new Date(row.anchorCreatedAt).getTime(),
    followupDueAt: row.followupDueAt
      ? new Date(row.followupDueAt).getTime()
      : 0,
    followupSentAt: row.followupSentAt
      ? new Date(row.followupSentAt).getTime()
      : null,
    finalDueAt: row.finalDueAt ? new Date(row.finalDueAt).getTime() : 0,
    finalSentAt: row.finalSentAt ? new Date(row.finalSentAt).getTime() : null,
    closedAt: null,
    cancelled: false,
  };
}

async function sendFirst(
  stage: FollowupStageState,
  windowId: string,
  now: Date,
  localDay: string,
  summary: { sentFirst: number },
) {
  const prior = await existingSentFollowupCount(
    stage.userId,
    stage.chatId,
    now,
  );
  const seed = rotationIndexForUser(stage.userId, localDay, prior);
  const phrase = pickPhrase('first', seed);
  const ok = await persistFollowupMessage({
    userId: stage.userId,
    chatId: stage.chatId,
    anchorMessageId: stage.anchorMessageId,
    windowId,
    stage: 'first',
    messageId: randomUUID(),
    text: phrase,
    now,
    phraseSeed: seed,
  });
  if (ok) summary.sentFirst += 1;
}

async function sendFinal(
  stage: FollowupStageState,
  windowId: string,
  now: Date,
  timeZone: string,
  localDay: string,
  summary: { sentFinal: number },
) {
  const prior = await existingSentFollowupCount(
    stage.userId,
    stage.chatId,
    now,
  );
  const seed = rotationIndexForUser(stage.userId, localDay, prior);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  const phrase = finalPhraseForLocalHour(hour, seed);
  const ok = await persistFollowupMessage({
    userId: stage.userId,
    chatId: stage.chatId,
    anchorMessageId: stage.anchorMessageId,
    windowId,
    stage: 'final',
    messageId: randomUUID(),
    text: phrase,
    now,
    phraseSeed: seed,
  });
  if (ok) {
    summary.sentFinal += 1;
    await closeWindow(windowId, now);
  }
}
