import type { EpistemicPolicy } from '@/lib/agent/research-policy';
import type { TranscriptReliability } from '@/lib/transcript-reliability';

export function applyTranscriptReliabilityGuard(
  policy: EpistemicPolicy,
  reliability?: TranscriptReliability | null,
): EpistemicPolicy {
  if (reliability?.status !== 'likely_garbled') return policy;
  return {
    ...policy,
    researchDepth: 'none',
    freshnessNeed: 'none',
    authorityNeed: 'none',
    sourceSensitivity: 'low',
    stakes: 'low',
    questionMode: 'conversation',
    capabilityRoute: 'reply',
    interactionMode: 'social',
    neutralResearchQuestion: null,
    reason: 'Clarify a likely garbled audio transcript before acting.',
    confidence: Math.max(policy.confidence, 0.95),
  };
}
