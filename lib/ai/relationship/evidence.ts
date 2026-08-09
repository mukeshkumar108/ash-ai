import 'server-only';

import { isHonchoConfigured, retrieveRelevantMemory } from '@/lib/honcho';

const QUESTION = `Build a compact evidence packet for relational curiosity. What is meaningfully known about the user's current life, work or education, family, friends and social world, romantic relationships, interests and hobbies, routines, goals, values, emotional concerns, and personal history? Include open conversational threads and specific things Sophie could naturally ask about. Clearly distinguish sparse areas. Do not speculate.`;

export async function retrieveRelationshipEvidence(
  userId: string,
  chatId: string,
  retrieve = retrieveRelevantMemory,
) {
  if (!isHonchoConfigured() && retrieve === retrieveRelevantMemory)
    return { packet: null, source: 'disabled' as const };
  try {
    const result = await retrieve(userId, chatId, QUESTION);
    return {
      packet:
        result.result?.replace(/\s+/gu, ' ').trim().slice(0, 2_400) || null,
      source: result.mode,
    };
  } catch (error) {
    console.warn('[relationship] Honcho evidence unavailable; failing closed', {
      chatId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { packet: null, source: 'error' as const };
  }
}
