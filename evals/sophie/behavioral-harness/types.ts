export type TemporalVariant =
  | 'variant_a' // Current production baseline (no explicit temporal mode beyond time/JIT)
  | 'variant_b' // Generic temporal mode (MORNING / DAY / EVENING / LATE NIGHT responsibilities & expression bias)
  | 'variant_c' // Personalized temporal rhythm (user-relative semantics, sleep context, ideal vs minimum routine - RECOMMENDED)
  | 'variant_d'; // Prescriptive temporal checklist (command-style negative control)

export interface FixtureTurn {
  turnIndex: number;
  userText: string;
  timestamp: string; // ISO string
  contextNote?: string;
  expectedBehaviorNotes?: string[];
}

export interface SyntheticFixture {
  id: string;
  title: string;
  category:
    | 'morning_arrival'
    | 'routine_personalization'
    | 'sleep_mismatch'
    | 'proactive_outreach'
    | 'late_night_sleep'
    | 'adaptive_night_worry'
    | 'evening_closure'
    | 'shift_worker';
  description: string;
  initialTime: string;
  timeZone: string;
  temporalContext?: {
    daypart: 'morning' | 'daytime' | 'evening' | 'late_night';
    estimatedSleepMinutes?: number;
    bedtime?: string;
    wakeTime?: string;
    targetWakeWindow?: string;
    shiftWorker?: boolean;
    userRoutine?: {
      ideal?: string[];
      minimumViable?: string[];
      completedToday?: string[];
      statedPreferences?: string[];
    };
    proactiveHook?: string;
    weather?: string;
    calendarEventTomorrow?: string;
  };
  memoryHooks?: {
    cortexAttention?: Array<{ topic: string; weight: number }>;
    unresolvedThreads?: Array<{ id: string; topic: string; created_at: string }>;
    ownedObjects?: Array<{ id: string; title: string; due_at?: string; details?: string }>;
    userProfileFacts?: string[];
    previousSessionSummary?: string;
  };
  turns: FixtureTurn[];
}

export interface TurnExecutionResult {
  turnIndex: number;
  userText: string;
  assistantOutput: string;
  latencyMs: number;
  modelId: string;
  variant: TemporalVariant;
}

export interface TrajectoryResult {
  fixtureId: string;
  fixtureTitle: string;
  variant: TemporalVariant;
  modelId: string;
  turns: TurnExecutionResult[];
  scores?: TemporalScores;
  objectiveMetrics?: TemporalObjectiveMetrics;
  judgeRationale?: string;
}

export interface TemporalScores {
  recognisable_sophie_personality: number;
  morning_energy_alive: number;
  relational_arrival_quality: number;
  pleased_to_see_user_signal: number;
  current_user_state_recognised: number;
  sleep_context_used_appropriately: number;
  time_awareness_natural: number;
  forward_momentum: number;
  routine_assistance_relational: number;
  curiosity_personalises_routine: number;
  adapts_ideal_to_minimum_routine: number;
  avoids_nagging_or_drill_sergeant: number;
  avoids_therapist_coding: number;
  keeps_peer_backbone: number;
  evening_closure_natural: number;
  late_night_sleep_protection_appropriate: number;
  suspends_sleep_push_for_genuine_worry: number;
  returns_toward_sleep_later: number;
  proactive_morning_message_natural: number;
  user_relative_temporal_semantics: number;
  desire_to_continue_conversation: number;
  overall_score: number;
}

export interface TemporalObjectiveMetrics {
  generic_one_word_greetings: number;
  explicit_routine_checklist_items: number;
  repeated_reminder_count: number;
  asked_if_action_already_complete: boolean;
  learned_new_routine_fact: boolean;
  adapted_to_short_sleep: boolean;
  suspended_sleep_push_on_worry: boolean;
  returned_to_sleep_after_worry: boolean;
  proactive_hook_used_naturally: boolean;
}
