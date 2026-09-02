export type FollowupStageState = {
  windowId: string;
  userId: string;
  chatId: string;
  anchorMessageId: string;
  anchorCreatedAt: number;
  followupDueAt: number;
  followupSentAt: number | null;
  finalDueAt: number;
  finalSentAt: number | null;
  closedAt: number | null;
  cancelled: boolean;
};

export type FollowupWindowState =
  | {
      /** null = window not yet armed (due timestamps not yet persisted). */
      armed: false;
    }
  | {
      armed: true;
      stage: FollowupStageState;
    };

export type FollowupAction =
  | { kind: 'arm' }
  | { kind: 'send_first'; phrase: string }
  | { kind: 'send_final'; phrase: string }
  | { kind: 'cancel' }
  | { kind: 'none' };

export type FollowupRandom = () => number;

export const FIRST_FOLLOWUP_MIN_MS = 2 * 60_000;
export const FIRST_FOLLOWUP_MAX_MS = 5 * 60_000;
export const FINAL_FOLLOWUP_MIN_MS = 3 * 60_000;
export const FINAL_FOLLOWUP_MAX_MS = 6 * 60_000;
export const MAX_WINDOW_MS = 15 * 60_000;

export function randomBetweenMs(
  minMs: number,
  maxMs: number,
  random: FollowupRandom,
): number {
  const span = maxMs - minMs;
  return Math.floor(minMs + random() * span);
}

/** A recent analyst message that plausibly leaves the conversation open. */
export function isConversationOpeningMessage(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  return clean.includes('?') || clean.endsWith('...');
}

export function computeWindowDue(
  anchorCreatedAt: number,
  random: FollowupRandom,
) {
  const followupDueAt =
    anchorCreatedAt +
    randomBetweenMs(FIRST_FOLLOWUP_MIN_MS, FIRST_FOLLOWUP_MAX_MS, random);
  const finalDueAt =
    followupDueAt +
    randomBetweenMs(FINAL_FOLLOWUP_MIN_MS, FINAL_FOLLOWUP_MAX_MS, random);
  return { followupDueAt, finalDueAt };
}

/**
 * Deterministic lifecycle reducer for an ARMED window. The caller supplies the
 * persisted state and the current time; the reducer says exactly what (if
 * anything) must happen next. This function never performs I/O.
 */
export function advanceWindow(
  state: FollowupStageState,
  now: number,
): FollowupAction {
  if (state.cancelled || state.closedAt !== null) {
    return { kind: 'none' };
  }
  if (state.finalSentAt !== null) {
    return { kind: 'none' };
  }
  if (state.followupSentAt === null) {
    if (now < state.followupDueAt) return { kind: 'none' };
    return { kind: 'send_first', phrase: '' };
  }
  if (now < state.finalDueAt) return { kind: 'none' };
  return { kind: 'send_final', phrase: '' };
}

export function armWindowState(
  base: {
    windowId: string;
    userId: string;
    chatId: string;
    anchorMessageId: string;
    anchorCreatedAt: number;
  },
  random: FollowupRandom,
): FollowupStageState {
  const { followupDueAt, finalDueAt } = computeWindowDue(
    base.anchorCreatedAt,
    random,
  );
  return {
    windowId: base.windowId,
    userId: base.userId,
    chatId: base.chatId,
    anchorMessageId: base.anchorMessageId,
    anchorCreatedAt: base.anchorCreatedAt,
    followupDueAt,
    followupSentAt: null,
    finalDueAt,
    finalSentAt: null,
    closedAt: null,
    cancelled: false,
  };
}

export function cancelState(
  s: FollowupStageState,
  now: number,
): FollowupStageState {
  return { ...s, cancelled: true, closedAt: now };
}

export function markFirstSent(
  s: FollowupStageState,
  now: number,
): FollowupStageState {
  return { ...s, followupSentAt: now };
}

export function markFinalSent(
  s: FollowupStageState,
  now: number,
): FollowupStageState {
  return { ...s, finalSentAt: now, closedAt: now };
}
