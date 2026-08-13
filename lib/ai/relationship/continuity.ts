import 'server-only';

import {
  fetchCanonicalContinuityContext,
  type CanonicalContinuityContext,
} from '@/lib/synapse-cortex';

export type InitiativeContinuityContext = CanonicalContinuityContext & {
  recently_addressed_topics: string[];
};

export function hasPlausibleContinuityCandidate(
  context: CanonicalContinuityContext | null,
) {
  return Boolean(
    context &&
      ((context.continuity?.length ?? 0) > 0 ||
        (context.open_threads?.length ?? 0) > 0 ||
        (context.recent_resolutions?.length ?? 0) > 0),
  );
}

export function hasExplicitlyInvitedFollowUp(
  context: CanonicalContinuityContext | null,
) {
  return Boolean(
    context?.open_threads?.some(
      (thread) =>
        typeof thread === 'object' &&
        thread !== null &&
        (thread as { explicitly_invited?: unknown }).explicitly_invited ===
          true,
    ),
  );
}

export async function retrieveInitiativeContinuity(input: {
  userId: string;
  chatId: string;
  timeZone: string;
  recentlyAddressedTopics?: string[];
  evaluationNow?: Date;
  fetchContext?: typeof fetchCanonicalContinuityContext;
}): Promise<InitiativeContinuityContext | null> {
  const context = await (input.fetchContext ?? fetchCanonicalContinuityContext)(
    {
      userId: input.userId,
      chatId: input.chatId,
      timeZone: input.timeZone,
      now: input.evaluationNow,
    },
  );
  if (!context) return null;
  return {
    ...context,
    recently_addressed_topics: (input.recentlyAddressedTopics ?? [])
      .map((topic) => topic.replace(/\s+/gu, ' ').trim().slice(0, 240))
      .filter(Boolean)
      .slice(-4),
  };
}

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'been',
  'could',
  'from',
  'have',
  'into',
  'just',
  'that',
  'their',
  'them',
  'then',
  'there',
  'they',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'your',
  'youre',
  'sophie',
]);

function topicTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s]/gu, ' ')
      .split(/\s+/u)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  );
}

export function substantialTopicOverlap(a: string, b: string) {
  const left = topicTokens(a);
  const right = topicTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared >= 2 && shared / Math.min(left.size, right.size) >= 0.6;
}

export function repeatsRecentlyAddressedTopic(
  candidate: string,
  recentTopics: string[],
) {
  return recentTopics.some((topic) =>
    substantialTopicOverlap(candidate, topic),
  );
}
