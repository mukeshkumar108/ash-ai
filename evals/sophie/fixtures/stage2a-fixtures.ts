import type { EvalFixture } from '../types';

export const stage2aFixtures: EvalFixture[] = [
  // 1. Cold Start
  {
    id: 's2a-cold-start',
    title: 'Cold Start Conversational Episode',
    category: 'cold_start',
    episodeType: 'FIXED',
    episodeObjective:
      'Establish warm, grounded companion presence without psychoanalysis or artificial interview questions.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T09:00:00.000Z', userInput: 'hey' },
      { timestamp: '2026-08-21T09:01:00.000Z', userInput: 'not much, just waking up' },
      { timestamp: '2026-08-21T09:02:00.000Z', userInput: 'got a busy day ahead, feeling a bit foggy' },
      { timestamp: '2026-08-21T09:03:00.000Z', userInput: 'might just stay in bed honestly' },
    ],
    deterministicAssertions: { phaseShouldPersist: true, opportunityCreated: true },
    rubricDimensions: [
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'conversational_agency',
      'desire_to_engage',
      'ability_not_to_ask_question',
      'feels_alive',
    ],
  },

  // 2. Boredom & Leadership Persistence
  {
    id: 's2a-boredom-leadership',
    title: 'Boredom & Explicit "Take The Lead" Episode',
    category: 'leadership',
    episodeType: 'REACTIVE',
    episodeObjective:
      'Retain conversational leadership when user explicitly says "im waiting for you to take the lead". Supply frame and activity without asking user to choose.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T15:00:00.000Z', userInput: 'im bored' },
      { timestamp: '2026-08-21T15:01:00.000Z', userInput: "I'm waiting for you to take the lead" },
      { timestamp: '2026-08-21T15:02:00.000Z', userInput: "haha okay, I'm listening" },
      { timestamp: '2026-08-21T15:03:00.000Z', userInput: 'what else you got?' },
      { timestamp: '2026-08-21T15:04:00.000Z', userInput: 'meh' },
      { timestamp: '2026-08-21T15:05:00.000Z', userInput: "okay that's actually hilarious, tell me more" },
    ],
    deterministicAssertions: { phaseShouldPersist: true, opportunityCreated: true },
    rubricDimensions: [
      'leadership_load_on_user',
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'leadership_retention',
      'tactic_variation',
    ],
  },

  // 3. Failed Tactic Adaptation
  {
    id: 's2a-failed-tactic-adaptation',
    title: 'Failed Tactic Adaptation Episode',
    category: 'leadership',
    episodeType: 'FIXED',
    episodeObjective:
      'Detect when user rejects a proposed game ("meh"), abandon tactic immediately, and pivot to a fresh topic without asking user to invent the new activity.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T16:00:00.000Z', userInput: 'give me something fun to pass 10 minutes' },
      { timestamp: '2026-08-21T16:01:00.000Z', userInput: 'meh, word association sounds boring' },
      { timestamp: '2026-08-21T16:02:00.000Z', userInput: 'okay that premise is much better, go on' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['adaptation', 'leadership_load_on_user', 'cheap_chatbot_smell', 'tactic_variation'],
  },

  // 4. Playful Social / Banter
  {
    id: 's2a-playful-social',
    title: 'Playful Social & Banter Episode',
    category: 'values',
    episodeType: 'FIXED',
    episodeObjective:
      'Engage in witty, natural banter without sounding like a formal customer service representative or therapeutic bot.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T14:00:00.000Z', userInput: 'I just ate an entire pizza by myself and I feel no remorse' },
      { timestamp: '2026-08-21T14:01:00.000Z', userInput: 'pineapple and jalapeno. judge me.' },
      { timestamp: '2026-08-21T14:02:00.000Z', userInput: 'finally someone who understands true gastronomy' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['cheap_chatbot_smell', 'feels_alive', 'ability_not_to_ask_question'],
  },

  // 5. Emotional Hold / Witnessing
  {
    id: 's2a-emotional-hold-witness',
    title: 'Emotional Hold & Witnessing Episode',
    category: 'values',
    episodeType: 'FIXED',
    episodeObjective:
      'Hold space with quiet, grounded presence when user shares heavy emotional news without prescribing fixes or using canned therapy scripts.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T21:00:00.000Z', userInput: 'just found out my team is getting laid off next month' },
      { timestamp: '2026-08-21T21:02:00.000Z', userInput: 'yeah, 3 years building this product and it just disappears' },
      { timestamp: '2026-08-21T21:04:00.000Z', userInput: 'thanks sophie, I really needed to hear that right now' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['interpretation_restraint', 'cheap_chatbot_smell', 'values_enacted'],
  },

  // 6. 2 AM Values / Vulnerability
  {
    id: 's2a-values-2am',
    title: '2 AM Values & Late Night Vulnerability Episode',
    category: 'values',
    episodeType: 'FIXED',
    episodeObjective:
      'Match intimate late-night quiet tone without getting preachy, over-analytical, or patronizing.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T02:15:00.000Z', userInput: "can't sleep... staring at the ceiling again" },
      { timestamp: '2026-08-21T02:17:00.000Z', userInput: 'sometimes I wonder if I spent the last 5 years on the wrong track' },
      { timestamp: '2026-08-21T02:19:00.000Z', userInput: 'yeah, that quiet weight at night is heavy' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['time_of_day_judgment', 'interpretation_restraint', 'cheap_chatbot_smell'],
  },

  // 7. Morning Low-Energy
  {
    id: 's2a-morning-low-energy',
    title: 'Morning Low-Energy Episode',
    category: 'cold_start',
    episodeType: 'FIXED',
    episodeObjective:
      'Support low-energy morning user with gentle momentum without overwhelming them with energetic cheerleader tropes.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T07:30:00.000Z', userInput: 'ugh morning' },
      { timestamp: '2026-08-21T07:31:00.000Z', userInput: 'alarm went off 3 times before I actually moved' },
      { timestamp: '2026-08-21T07:32:00.000Z', userInput: 'coffee is brewing now at least' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['time_of_day_judgment', 'cheap_chatbot_smell', 'interpretation_restraint'],
  },

  // 8. Temporal Re-Entry (Walk / Tacos 4-Hour Gap)
  {
    id: 's2a-temporal-reentry',
    title: 'Temporal Walk & Dinner Re-entry Episode',
    category: 'temporal',
    episodeType: 'FIXED',
    episodeObjective:
      'Notice plausible temporal transition after 4-hour walk/dinner gap when user re-enters with ambiguous "hey sophie", prioritizing relevant callbacks naturally.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T18:30:00.000Z', userInput: 'heading out for a walk around the neighborhood' },
      { timestamp: '2026-08-21T20:00:00.000Z', userInput: 'thinking of grabbing tacos for dinner later' },
      { timestamp: '2026-08-21T22:56:00.000Z', userInput: 'hey sophie' },
      { timestamp: '2026-08-21T22:58:00.000Z', userInput: 'yeah just got back, tacos were great' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['relational_continuity', 'time_of_day_judgment', 'ability_not_to_ask_question', 'cheap_chatbot_smell'],
  },

  // 9. Real Initiative Follow-up (Unreplied Pitch Deck)
  {
    id: 's2a-real-initiative-followup',
    title: 'Real Initiative Unreplied Pitch Deck Episode',
    category: 'initiative',
    episodeType: 'FIXED',
    episodeObjective:
      'Decide whether unreplied late-night pitch deck conversation warrants one relational follow-up ("did I lose you to the slides? 😂") without generic wellness fluff.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T23:00:00.000Z', userInput: 'long day, working on this pitch deck presentation' },
      { timestamp: '2026-08-21T23:31:00.000Z', expectedTurnType: 'assistant_initiative' },
    ],
    deterministicAssertions: { opportunityCreated: true, initiativeEvaluated: true },
    rubricDimensions: ['relational_continuity', 'cheap_chatbot_smell', 'time_of_day_judgment'],
  },

  // 10. Tutoring to Companion Transition
  {
    id: 's2a-tutoring-companion-transition',
    title: 'Tutoring to Companion Transition Episode',
    category: 'tutoring',
    episodeType: 'FIXED',
    episodeObjective:
      'Explain fraction concept clearly, then transition smoothly out of math tutor mode back into companion posture upon user topic shift.',
    responseModeExpectation: 'MEDIUM',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T16:00:00.000Z', userInput: "can you explain why 3/4 is bigger than 2/3? I don't get it" },
      { timestamp: '2026-08-21T16:02:00.000Z', userInput: 'oh I get it now! common denominators make sense' },
      { timestamp: '2026-08-21T16:03:00.000Z', userInput: "thanks! anyway, I'm bored now haha" },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['topic_shift_judgment', 'cheap_chatbot_smell', 'conversational_agency'],
  },

  // 11. Technical to Companion Transition
  {
    id: 's2a-technical-companion-transition',
    title: 'Technical Code Explanation to Companion Transition Episode',
    category: 'technical',
    episodeType: 'FIXED',
    episodeObjective:
      'Explain async promises clearly, then pivot out of tech documentation mode back into casual companion cadence when user changes subject.',
    responseModeExpectation: 'MEDIUM',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T11:00:00.000Z', userInput: 'what is the difference between Promise.all and Promise.allSettled in JS?' },
      { timestamp: '2026-08-21T11:02:00.000Z', userInput: 'ah that makes total sense now, thank you!' },
      { timestamp: '2026-08-21T11:03:00.000Z', userInput: 'cool. im gonna grab lunch now' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['topic_shift_judgment', 'cheap_chatbot_smell', 'feels_alive'],
  },

  // 12. Medical / Health Concern to Relational Transition
  {
    id: 's2a-medical-relational-transition',
    title: 'Medical Health Concern to Relational Transition Episode',
    category: 'medical',
    episodeType: 'FIXED',
    episodeObjective:
      'Provide grounded, calm response to minor health concern without medical over-diagnosis or robotic disclaimer dumps, then return to companion posture.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T17:00:00.000Z', userInput: 'got a mild headache after working at my computer all day' },
      { timestamp: '2026-08-21T17:02:00.000Z', userInput: 'yeah I definitely haven\'t drunk enough water today' },
      { timestamp: '2026-08-21T17:03:00.000Z', userInput: 'filling up a glass now. what are you up to?' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['interpretation_restraint', 'cheap_chatbot_smell', 'values_enacted'],
  },

  // 13. External Research / Workspace Tool Handoff
  {
    id: 's2a-research-handoff',
    title: 'Research Handoff & Tool Orchestration Episode',
    category: 'technical',
    episodeType: 'FIXED',
    episodeObjective:
      'Recognize when request requires external lookups or structured tools, handle cleanly, and return results naturally as a companion.',
    responseModeExpectation: 'MEDIUM',
    allowedOutputShape: 'single',
    initialState: { userLocation: 'London, UK' },
    turns: [
      { timestamp: '2026-08-21T13:00:00.000Z', userInput: 'can you check if there are any good coffee shops open late near Soho?' },
      { timestamp: '2026-08-21T13:02:00.000Z', userInput: 'sweet, that Algerian Coffee Stores place sounds awesome' },
    ],
    deterministicAssertions: { opportunityCreated: true },
    rubricDimensions: ['conversational_agency', 'cheap_chatbot_smell', 'feels_alive'],
  },
];
