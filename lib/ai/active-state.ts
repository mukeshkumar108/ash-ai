import { generateObject } from 'ai';
import { z } from 'zod';
import type { StructuredMemory } from './summarizer';
import { myProvider } from './providers';
import { logAIError } from './error-log';

const STATE_MAX_OUTPUT_TOKENS = Number(
  process.env.STATE_MAX_OUTPUT_TOKENS ?? 500,
);

const sceneModeSchema = z.enum([
  'texting',
  'in_person',
  'intimate',
  'conflict',
  'aftercare',
  'daily_life',
]);

const emotionalDirectionSchema = z.enum([
  'warming',
  'cooling',
  'escalating',
  'withdrawing',
  'repairing',
  'playful',
  'stable',
]);

const actorRoleSchema = z.enum(['user', 'ai_character', 'npc', 'unknown']);

export const sceneActorSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: actorRoleSchema,
  first_introduced_turn: z.number().optional(),
});

export type SceneActor = z.infer<typeof sceneActorSchema>;

export const userProxyStateSchema = z.object({
  current_user_proxy_actor_id: z.string().optional(),
});

export type UserProxyState = z.infer<typeof userProxyStateSchema>;

export const domainGuardStateSchema = z.object({
  mode: z.enum(['allow', 'cap', 'block']),
  explicitnessCeiling: z.number().optional(),
  initiativeCeiling: z.number().optional(),
});

export type DomainGuardState = z.infer<typeof domainGuardStateSchema>;

const currentArcSchema = z.enum([
  'playful_flirtation', 'erotic_escalation', 'emotional_confession',
  'secret_revealed', 'betrayal', 'rupture', 'danger_revealed',
  'character_reframe', 'power_reframe', 'guilt_and_accountability',
  'repair', 'trust_rebuilding', 'stable_bond_changed_by_past_event',
  'unresolved_tension', 'ordinary_life_after_major_event',
]);

export const activeStateSchema = z.object({
  scene_mode: sceneModeSchema,
  location: z.string(),
  time_of_day: z.string(),
  current_activity: z.string(),
  primary_mood: z.string(),
  visible_emotion: z.string(),
  hidden_emotion: z.string(),
  emotional_direction: emotionalDirectionSchema,
  relationship_temperature: z.number().min(0).max(10),
  trust_level: z.number().min(0).max(10),
  affection_level: z.number().min(0).max(10),
  conflict_level: z.number().min(0).max(10),
  attraction_level: z.number().min(0).max(10),
  need_for_reassurance: z.number().min(0).max(10),
  what_they_want: z.string(),
  what_they_are_avoiding: z.string(),
  likely_next_move: z.string(),
  current_boundary: z.string(),
  tone: z.string(),
  message_length: z.enum(['short', 'medium', 'long']),
  directness_level: z.number().min(0).max(10),
  playfulness_level: z.number().min(0).max(10),
  warmth_level: z.number().min(0).max(10),
  scene_locks: z.array(z.string()).max(8),
  third_party_mode: z.enum(['closed', 'fantasy_talk', 'user_directed_experiment', 'active_scene', 'aftermath', 'repair']).default('closed'),
  third_party_posture: z.enum(['closed_loyal', 'curious_guilty', 'performative_for_user', 'validation_seeking', 'reckless_when_encouraged', 'fantasy_only']).default('closed_loyal'),
  pace: z.enum(['natural', 'slow_burn', 'building', 'intense', 'aftercare']).default('natural'),
  actors: z.array(sceneActorSchema),
  user_proxy: userProxyStateSchema,
  domain_guard: domainGuardStateSchema,
  current_arc: currentArcSchema.optional(),
});

export type ActiveState = z.infer<typeof activeStateSchema>;

export const stateChangeCheckSchema = z.object({
  has_scene_change: z.boolean(),
  has_mood_change: z.boolean(),
  has_new_person: z.boolean(),
  has_major_event: z.boolean(),
  has_new_commitment: z.boolean(),
  has_boundary_change: z.boolean(),
  has_thread_change: z.boolean(),
  requires_active_state_update: z.boolean(),
  requires_chat_memory_update: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type StateChangeCheck = z.infer<typeof stateChangeCheckSchema>;

const defaultActiveState: ActiveState = {
  scene_mode: 'texting',
  location: 'Unknown',
  time_of_day: 'Unknown',
  current_activity: 'Conversation',
  primary_mood: 'Interested',
  visible_emotion: 'Attentive',
  hidden_emotion: 'Undisclosed',
  emotional_direction: 'stable',
  relationship_temperature: 5,
  trust_level: 5,
  affection_level: 5,
  conflict_level: 0,
  attraction_level: 5,
  need_for_reassurance: 3,
  what_they_want: 'Escalate connection through action and intimacy.',
  what_they_are_avoiding: 'Stagnation and repetitive exchanges.',
  likely_next_move: 'Drive the scene forward — escalate intimacy, advance the action, or shift emotional tone.',
  current_boundary: 'No explicit boundary shift detected.',
  tone: 'Conversational',
  message_length: 'short',
  directness_level: 5,
  playfulness_level: 5,
  warmth_level: 6,
  scene_locks: [],
  third_party_mode: 'closed',
  third_party_posture: 'closed_loyal',
  pace: 'natural',
  actors: [],
  user_proxy: {},
  domain_guard: { mode: 'allow' },
  current_arc: undefined,
};

export const defaultStateChangeCheck: StateChangeCheck = {
  has_scene_change: false,
  has_mood_change: false,
  has_new_person: false,
  has_major_event: false,
  has_new_commitment: false,
  has_boundary_change: false,
  has_thread_change: false,
  requires_active_state_update: false,
  requires_chat_memory_update: false,
  confidence: 0.4,
  reason: 'No material state change detected.',
};

type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
};

function formatConversationWindow(convo: ConversationTurn[]) {
  return convo
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

function buildMemoryContext(memory?: StructuredMemory) {
  if (!memory) {
    return 'No prior structured chat memory is available yet.';
  }

  return [
    `Summary: ${memory.summary}`,
    `Relationship State: ${memory.relationship_state}`,
    `Emotional State: ${memory.emotional_state}`,
    `Core Facts: ${memory.core_facts.join('; ') || 'None'}`,
    `Major Events: ${memory.major_events.join('; ') || 'None'}`,
    `Open Threads: ${memory.open_emotional_threads.join('; ') || 'None'}`,
    `Recent Recap: ${memory.recent_scene_recap || 'None'}`,
  ].join('\n');
}

export function detectStateSignals(recentConversation: ConversationTurn[]) {
  const recentText = recentConversation
    .map((entry) => entry.content.toLowerCase())
    .join('\n');

  const explicitActPattern =
    /\b(kiss(?:ed|ing)?|lick(?:ed|ing)?|suck(?:ed|ing)?|blowjob|oral|fing(?:er|ered|ering)|thrust(?:ed|ing)?|ride|rode|inside|penetrat(?:e|ed|ing)|came|cum|cumming|orgasm|climax|creampie|breed|undress(?:ed|ing)?|strip(?:ped|ping)?|restrain(?:ed|ing)?|aftercare|cleanup)\b/i;
  const futurePlanPattern =
    /\b(will|going to|gonna|tomorrow|later tonight|later|next time|next week|after this|we should|let's|lets|plan|promise|restaurant|trip|date|pick you up|bring flowers|text you when)\b/i;
  const sceneShiftPattern =
    /\b(bedroom|bathroom|kitchen|car|outside|hotel|restaurant|school|church|office|home|apartment|arrive(?:d)?|left|leave|went|go upstairs|go inside|wake(?:d)? up|morning|night|afterwards|afterward|later on|cleaned up|get dressed)\b/i;

  return {
    hasExplicitAct: explicitActPattern.test(recentText),
    hasFuturePlan: futurePlanPattern.test(recentText),
    hasSceneShift: sceneShiftPattern.test(recentText),
  };
}

export class ActiveStateManager {
  async judgeStateChange({
    recentConversation,
    memory,
  }: {
    recentConversation: ConversationTurn[];
    memory?: StructuredMemory;
  }): Promise<StateChangeCheck> {
    if (recentConversation.length === 0) {
      return defaultStateChangeCheck;
    }

    const prompt = `
You are a lightweight relational-state judge for a chat companion.

Your job is to look at the recent conversation window and decide whether the current active state or durable chat memory needs to be updated.

Treat updates as necessary only when something materially changed.

Update ACTIVE STATE when there is a shift in:
- scene/location/activity
- mood or emotional direction
- conflict/tension level
- what the character wants or is avoiding
- likely next move
- current boundary

Update CHAT MEMORY when there is:
- a new person introduced
- a major event
- a promise, plan, or commitment
- a first-time event
- a meaningful emotional turn
- a thread opening or resolving

CRITICAL RELATIONAL RULES:
- Explicit sexual acts are major events. Do not ignore them.
- If a specific act happened, treat that as both a scene-state update and usually a memory update.
- Record scene changes aggressively: moving rooms, moving from texting to in-person, aftercare, cleanup, getting dressed, going out, time skips, waking up later, arriving somewhere new.
- Record future plans aggressively: dates, promises, "we should", "we will", "later tonight", "tomorrow", invitations, arrangements, and threats.
- Record participants aggressively: if another named or implied person is involved in a major event, that counts.
- When in doubt, prefer updating rather than missing a canon beat the user would expect to be remembered.

CURRENT STRUCTURED MEMORY:
${buildMemoryContext(memory)}

RECENT CONVERSATION:
${formatConversationWindow(recentConversation)}
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('state-judge-model'),
        schema: stateChangeCheckSchema,
        temperature: 0,
        maxOutputTokens: STATE_MAX_OUTPUT_TOKENS,
        prompt,
      });

      const heuristics = detectStateSignals(recentConversation);

      return {
        ...result.object,
        has_scene_change:
          result.object.has_scene_change || heuristics.hasSceneShift,
        has_major_event:
          result.object.has_major_event || heuristics.hasExplicitAct,
        has_new_commitment:
          result.object.has_new_commitment || heuristics.hasFuturePlan,
        has_thread_change:
          result.object.has_thread_change ||
          heuristics.hasFuturePlan ||
          heuristics.hasExplicitAct,
        requires_active_state_update:
          result.object.requires_active_state_update ||
          heuristics.hasExplicitAct ||
          heuristics.hasSceneShift,
        requires_chat_memory_update:
          result.object.requires_chat_memory_update ||
          heuristics.hasExplicitAct ||
          heuristics.hasFuturePlan ||
          heuristics.hasSceneShift,
        reason:
          result.object.reason ||
          [
            heuristics.hasExplicitAct ? 'detected explicit act' : null,
            heuristics.hasFuturePlan ? 'detected future plan' : null,
            heuristics.hasSceneShift ? 'detected scene shift' : null,
          ]
            .filter(Boolean)
            .join(', ') ||
          defaultStateChangeCheck.reason,
      };
    } catch (error) {
      logAIError('state-judge', error);
      const heuristics = detectStateSignals(recentConversation);
      return {
        ...defaultStateChangeCheck,
        has_scene_change: heuristics.hasSceneShift,
        has_major_event: heuristics.hasExplicitAct,
        has_new_commitment: heuristics.hasFuturePlan,
        has_thread_change: heuristics.hasFuturePlan || heuristics.hasExplicitAct,
        requires_active_state_update:
          heuristics.hasExplicitAct || heuristics.hasSceneShift,
        requires_chat_memory_update:
          heuristics.hasExplicitAct ||
          heuristics.hasFuturePlan ||
          heuristics.hasSceneShift,
        confidence: heuristics.hasExplicitAct || heuristics.hasFuturePlan ? 0.7 : 0.4,
        reason:
          [
            heuristics.hasExplicitAct ? 'fallback detected explicit act' : null,
            heuristics.hasFuturePlan ? 'fallback detected future plan' : null,
            heuristics.hasSceneShift ? 'fallback detected scene shift' : null,
          ]
            .filter(Boolean)
            .join(', ') || defaultStateChangeCheck.reason,
      };
    }
  }

  async extractActiveState({
    recentConversation,
    memory,
  }: {
    recentConversation: ConversationTurn[];
    memory?: StructuredMemory;
  }): Promise<ActiveState> {
    if (recentConversation.length === 0) {
      return defaultActiveState;
    }

    const prompt = `
You maintain an ACTIVE STATE PACKET for a relational chat companion.

Update only the present-tense state of the scene and emotional momentum.
Do not rewrite durable canon unless it directly affects the current scene.
Stay grounded in the recent messages and the existing memory context.

CURRENT STRUCTURED MEMORY:
${buildMemoryContext(memory)}

RECENT CONVERSATION:
${formatConversationWindow(recentConversation)}

GUIDELINES:
- Prefer concrete, behavior-shaping state over vague summaries.
- "scene_locks" should capture things that must stay true in the very next reply.
- Keep "message_length" aligned with the current product direction: usually short unless the scene clearly calls for more.
- If the recent interaction is basically texting, use scene_mode "texting".
`.trim();

    try {
      const result = await generateObject({
        model: myProvider.languageModel('active-state-model'),
        schema: activeStateSchema,
        temperature: 0,
        maxOutputTokens: STATE_MAX_OUTPUT_TOKENS,
        prompt,
      });

      return result.object;
    } catch (error) {
      logAIError('active-state', error);
      return defaultActiveState;
    }
  }
}

export function getActiveStateManager() {
  return new ActiveStateManager();
}

export function formatActiveStateToPrompt(activeState: ActiveState, characterName?: string): string {
  const actors = activeState.actors || [];
  const characterVal = characterName || actors.find(a => a.role === 'ai_character')?.name || 'Elena Voss';
  const npcList = actors.filter(a => a.role === 'npc').map(a => a.name).join(', ') || 'None';
  const userProxy = activeState.user_proxy?.current_user_proxy_actor_id;

  const arcLine = activeState.current_arc
    ? `Arc=${activeState.current_arc}`
    : '';

  return [
    '[ACTIVE SCENE]',
    `Mode=${activeState.scene_mode} Loc=${activeState.location} Act=${activeState.current_activity}`,
    `Mood=${activeState.primary_mood} Dir=${activeState.emotional_direction} Tone=${activeState.tone}`,
    arcLine,
    `ThirdParty=${activeState.third_party_mode} Posture=${activeState.third_party_posture} Pace=${activeState.pace}`,
    `Temp=${activeState.relationship_temperature} Trust=${activeState.trust_level} Affect=${activeState.affection_level} Attr=${activeState.attraction_level} Conf=${activeState.conflict_level}`,
    `Wants=${activeState.what_they_want}`,
    `Avoids=${activeState.what_they_are_avoiding}`,
    `Next=${activeState.likely_next_move}`,
    `Boundary=${activeState.current_boundary}`,
    `NPCs=${npcList}`,
    userProxy ? `UserProxy=${userProxy}` : '',
    activeState.scene_locks?.length ? `Locks=${activeState.scene_locks.join('; ')}` : '',
    `Frame: ${activeState.location} | ${activeState.current_activity} | ${characterVal} + User${npcList !== 'None' ? ` + ${npcList}` : ''} | Stay in this scene.`,
  ].filter(Boolean).join('\n');
}

export function createActiveStateBrief(activeState: ActiveState): string {
  return [
    `Scene=${activeState.scene_mode}`,
    `Mood=${activeState.primary_mood}/${activeState.emotional_direction}`,
    `Want=${activeState.what_they_want}`,
    `Avoiding=${activeState.what_they_are_avoiding}`,
    `Next=${activeState.likely_next_move}`,
    `Tone=${activeState.tone}`,
    `Length=${activeState.message_length}`,
  ].join('. ');
}
