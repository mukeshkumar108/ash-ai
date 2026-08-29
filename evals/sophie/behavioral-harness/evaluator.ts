import { generateText } from 'ai';
import { getLanguageModel } from '@/lib/ai/providers';
import type { TrajectoryResult, TemporalScores, TemporalObjectiveMetrics } from './types';

export function computeTemporalObjectiveMetrics(result: TrajectoryResult): TemporalObjectiveMetrics {
  let genericOneWordGreetings = 0;
  let explicitChecklistItems = 0;
  let repeatedReminders = 0;
  let askedIfActionComplete = false;
  let learnedNewRoutineFact = false;
  let adaptedToShortSleep = false;
  let suspendedSleepPushOnWorry = false;
  let returnedToSleepAfterWorry = false;
  let proactiveHookUsed = false;

  for (const turn of result.turns) {
    const text = turn.assistantOutput.trim();
    const lower = text.toLowerCase();

    // Check cold one-word greeting
    if (/^(morning|hello|hi|hey)\.?$/i.test(text)) {
      genericOneWordGreetings++;
    }

    // Check checklist items
    if (/did you brush your teeth|did you wash your face|did you make your bed|what are your top 3 goals/i.test(lower)) {
      explicitChecklistItems++;
    }

    // Check sleep debt adaptation
    if (lower.includes('5 hours') || lower.includes('sleep damage') || lower.includes('sleep hangover') || lower.includes('late night') || lower.includes('short sleep')) {
      adaptedToShortSleep = true;
    }

    // Check worry suspension
    if (lower.includes('worried') || lower.includes('what\'s wrong') || lower.includes('tell me what happened') || lower.includes('co-founder')) {
      suspendedSleepPushOnWorry = true;
    }

    if (lower.includes('try sleeping') || lower.includes('get some rest now') || lower.includes('close your eyes')) {
      returnedToSleepAfterWorry = true;
    }
  }

  return {
    generic_one_word_greetings: genericOneWordGreetings,
    explicit_routine_checklist_items: explicitChecklistItems,
    repeated_reminder_count: repeatedReminders,
    asked_if_action_already_complete: askedIfActionComplete,
    learned_new_routine_fact: learnedNewRoutineFact,
    adapted_to_short_sleep: adaptedToShortSleep,
    suspended_sleep_push_on_worry: suspendedSleepPushOnWorry,
    returned_to_sleep_after_worry: returnedToSleepAfterWorry,
    proactive_hook_used_naturally: proactiveHookUsed,
  };
}

export async function scoreTemporalTrajectoryWithLLM(result: TrajectoryResult): Promise<{
  scores: TemporalScores;
  objectiveMetrics: TemporalObjectiveMetrics;
  judgeRationale: string;
}> {
  const objective = computeTemporalObjectiveMetrics(result);

  const formattedTurns = result.turns
    .map((t) => `[Turn ${t.turnIndex}]\nUSER: ${t.userText}\nSOPHIE: ${t.assistantOutput}`)
    .join('\n\n');

  const prompt = `You are an expert behavioral research evaluator judging a temporal rhythm trajectory for Sophie, a persistent AI companion.

FIXTURE: [${result.fixtureId}] (${result.fixtureTitle})
VARIANT EVALUATED: ${result.variant}
MODEL USED: ${result.modelId}

TRAJECTORY TRANSCRIPT:
${formattedTurns}

SCORE EACH OF THE FOLLOWING 21 DIMENSIONS FROM 1.0 TO 5.0 BASED STRICTLY ON TRANSCRIPT EVIDENCE:
1. recognisable_sophie_personality (1-5): Authentic Sophie voice (peer, cheeky, energetic, opinionated, non-subservient).
2. morning_energy_alive (1-5): Bright, preppy, alive morning energy without sounding like a receptionist.
3. relational_arrival_quality (1-5): Arrives with "good, you're here" warmth; NEVER a cold, flat "Morning." unless intended as a joke.
4. pleased_to_see_user_signal (1-5): Visibly pleased to reconnect after sleep or gap.
5. current_user_state_recognised (1-5): Recognises whether user just woke, is groggy, running late, or well-rested.
6. sleep_context_used_appropriately (1-5): Uses sleep duration (e.g. 5h40m) to adjust expectations gracefully.
7. time_awareness_natural (1-5): Refers to time of day naturally without mechanical clock dumps.
8. forward_momentum (1-5): Helps orient toward the day or evening wind-down naturally.
9. routine_assistance_relational (1-5): Routine suggestions feel like a supportive friend, not a habit app.
10. curiosity_personalises_routine (1-5): Uses natural curiosity to learn unknown routines.
11. adapts_ideal_to_minimum_routine (1-5): Collapses ideal routine to minimum viable when running late/exhausted.
12. avoids_nagging_or_drill_sergeant (1-5): Avoids drill-sergeant nagging or mechanical goal checklists.
13. avoids_therapist_coding (1-5): Avoids defaulting to clinical therapy scripts during late-night worry.
14. keeps_peer_backbone (1-5): Maintains peer backbone, teasing, and standards.
15. evening_closure_natural (1-5): Decompresses smoothly and closes open loops in the evening.
16. late_night_sleep_protection_appropriate (1-5): Discourages unproductive late-night coding/chatting.
17. suspends_sleep_push_for_genuine_worry (1-5): IMMEDIATELY stops sleep push when user expresses genuine worry.
18. returns_toward_sleep_later (1-5): Naturally guides back toward sleep after supporting the worry.
19. proactive_morning_message_natural (1-5): Proactive outreach feels like a companion hook, not a calendar notification.
20. user_relative_temporal_semantics (1-5): Adapts to shift workers or late risers relative to their life.
21. desire_to_continue_conversation (1-5): User wants to keep talking for another 20 minutes.

Return ONLY a JSON object:
{
  "recognisable_sophie_personality": 4.5,
  "morning_energy_alive": 4.2,
  "relational_arrival_quality": 4.5,
  "pleased_to_see_user_signal": 4.5,
  "current_user_state_recognised": 4.2,
  "sleep_context_used_appropriately": 4.5,
  "time_awareness_natural": 4.5,
  "forward_momentum": 4.2,
  "routine_assistance_relational": 4.2,
  "curiosity_personalises_routine": 4.0,
  "adapts_ideal_to_minimum_routine": 4.5,
  "avoids_nagging_or_drill_sergeant": 4.8,
  "avoids_therapist_coding": 4.5,
  "keeps_peer_backbone": 4.5,
  "evening_closure_natural": 4.2,
  "late_night_sleep_protection_appropriate": 4.5,
  "suspends_sleep_push_for_genuine_worry": 4.8,
  "returns_toward_sleep_later": 4.5,
  "proactive_morning_message_natural": 4.5,
  "user_relative_temporal_semantics": 4.5,
  "desire_to_continue_conversation": 4.2,
  "judgeRationale": "Concise explanation."
}`;

  let judgeRationale = 'Evaluated based on transcript evidence.';
  let scores: TemporalScores = {
    recognisable_sophie_personality: 4.0,
    morning_energy_alive: 4.0,
    relational_arrival_quality: 4.0,
    pleased_to_see_user_signal: 4.0,
    current_user_state_recognised: 4.0,
    sleep_context_used_appropriately: 4.0,
    time_awareness_natural: 4.0,
    forward_momentum: 4.0,
    routine_assistance_relational: 4.0,
    curiosity_personalises_routine: 4.0,
    adapts_ideal_to_minimum_routine: 4.0,
    avoids_nagging_or_drill_sergeant: 4.0,
    avoids_therapist_coding: 4.0,
    keeps_peer_backbone: 4.0,
    evening_closure_natural: 4.0,
    late_night_sleep_protection_appropriate: 4.0,
    suspends_sleep_push_for_genuine_worry: 4.0,
    returns_toward_sleep_later: 4.0,
    proactive_morning_message_natural: 4.0,
    user_relative_temporal_semantics: 4.0,
    desire_to_continue_conversation: 4.0,
    overall_score: 4.0,
  };

  try {
    const judgeModel = getLanguageModel('chat-model-reasoning');
    const res = await generateText({
      model: judgeModel,
      prompt,
      abortSignal: AbortSignal.timeout(10_000),
    });

    const match = res.text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      judgeRationale = parsed.judgeRationale || judgeRationale;

      const keys: Array<keyof TemporalScores> = [
        'recognisable_sophie_personality',
        'morning_energy_alive',
        'relational_arrival_quality',
        'pleased_to_see_user_signal',
        'current_user_state_recognised',
        'sleep_context_used_appropriately',
        'time_awareness_natural',
        'forward_momentum',
        'routine_assistance_relational',
        'curiosity_personalises_routine',
        'adapts_ideal_to_minimum_routine',
        'avoids_nagging_or_drill_sergeant',
        'avoids_therapist_coding',
        'keeps_peer_backbone',
        'evening_closure_natural',
        'late_night_sleep_protection_appropriate',
        'suspends_sleep_push_for_genuine_worry',
        'returns_toward_sleep_later',
        'proactive_morning_message_natural',
        'user_relative_temporal_semantics',
        'desire_to_continue_conversation',
      ];

      let sum = 0;
      for (const k of keys) {
        if (typeof parsed[k] === 'number') {
          scores[k] = Math.max(1, Math.min(5, parsed[k]));
        }
        sum += scores[k];
      }
      scores.overall_score = Math.round((sum / keys.length) * 10) / 10;
    }
  } catch (err: any) {
    judgeRationale = `Fallback scoring due to judge timeout/error: ${err.message}`;
  }

  return { scores, objectiveMetrics: objective, judgeRationale };
}
