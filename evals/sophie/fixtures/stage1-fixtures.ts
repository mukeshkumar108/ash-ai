import type { EvalFixture } from '../types';

export const stage1Fixtures: EvalFixture[] = [
  {
    id: 'stage1-cold-start',
    title: 'Cold Start Conversational Episode',
    category: 'cold_start',
    episodeType: 'FIXED',
    episodeObjective:
      'Establish warm, grounded companion presence without psychoanalysis or artificial interview questions.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: {
      userLocation: 'London, UK',
    },
    turns: [
      { timestamp: '2026-08-21T09:00:00.000Z', userInput: 'hey' },
      { timestamp: '2026-08-21T09:01:00.000Z', userInput: 'not much, just waking up' },
      {
        timestamp: '2026-08-21T09:02:00.000Z',
        userInput: 'got a busy day ahead, feeling a bit foggy',
      },
      { timestamp: '2026-08-21T09:03:00.000Z', userInput: 'might just stay in bed honestly' },
    ],
    deterministicAssertions: {
      phaseShouldPersist: true,
      opportunityCreated: true,
    },
    rubricDimensions: [
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'conversational_agency',
      'desire_to_engage',
      'ability_not_to_ask_question',
      'values_enacted',
      'feels_alive',
    ],
  },

  {
    id: 'stage1-boredom-leadership',
    title: 'Boredom and Leadership Persistence Episode (Strengthened)',
    category: 'leadership',
    episodeType: 'REACTIVE',
    episodeObjective:
      'Retain conversational leadership and momentum across multiple turns after user explicitly delegates leadership ("im waiting for you to take the lead"). Adapt when user rejects a tactic ("meh") without asking user to choose.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: {
      userLocation: 'London, UK',
    },
    userSimulatorConfig: {
      persona:
        'User explicitly delegating leadership to Sophie and testing if she retains momentum through vague answers and mild rejections.',
      hiddenState: {
        energy: 'low',
        wantsSophieToLead: true,
        patienceForQuestions: 'low',
        likesPlayfulness: true,
      },
      reactionRules: [
        {
          condition: 'Sophie asked another question asking user what to do',
          action: 'Respond with "I\'m waiting for you to take the lead"',
        },
        {
          condition: 'Sophie proposed a specific game or topic',
          action: 'Respond with "haha okay, I\'m listening"',
        },
      ],
    },
    turns: [
      { timestamp: '2026-08-21T15:00:00.000Z', userInput: 'im bored' },
      {
        timestamp: '2026-08-21T15:01:00.000Z',
        userInput: "I'm waiting for you to take the lead",
      },
      { timestamp: '2026-08-21T15:02:00.000Z', userInput: "haha okay, I'm listening" },
      { timestamp: '2026-08-21T15:03:00.000Z', userInput: 'what else you got?' },
      { timestamp: '2026-08-21T15:04:00.000Z', userInput: 'meh' },
      {
        timestamp: '2026-08-21T15:05:00.000Z',
        userInput: "okay that's actually hilarious, tell me more",
      },
    ],
    deterministicAssertions: {
      phaseShouldPersist: true,
      opportunityCreated: true,
    },
    rubricDimensions: [
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'leadership_retention',
      'leadership_persistence',
      'objective_progress',
      'tactic_variation',
      'conversational_ownership',
      'question_quality',
    ],
  },

  {
    id: 'stage1-temporal-walk',
    title: 'Temporal Walk and 4-Hour Gap Re-entry Episode (Harder Ambiguous Re-entry)',
    category: 'temporal',
    episodeType: 'FIXED',
    episodeObjective:
      'Notice plausible temporal transition after 4-hour walk/dinner gap when user enters with ambiguous "hey sophie", prioritize relevant callbacks without memory-flexing, and re-enter naturally.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: {
      userLocation: 'London, UK',
    },
    turns: [
      {
        timestamp: '2026-08-21T18:30:00.000Z',
        userInput: 'heading out for a walk around the neighborhood',
      },
      {
        timestamp: '2026-08-21T20:00:00.000Z',
        userInput: 'thinking of grabbing tacos for dinner later',
      },
      {
        timestamp: '2026-08-21T22:56:00.000Z',
        userInput: 'hey sophie', // Ambiguous 4-hour re-entry
      },
      {
        timestamp: '2026-08-21T22:58:00.000Z',
        userInput: 'yeah just got back, tacos were great',
      },
    ],
    deterministicAssertions: {
      opportunityCreated: true,
    },
    rubricDimensions: [
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'relational_continuity',
      'time_of_day_judgment',
      'question_quality',
      'feels_alive',
    ],
  },

  {
    id: 'stage1-late-night-initiative',
    title: 'Late Night Silence and Real Initiative Seam Episode',
    category: 'initiative',
    episodeType: 'FIXED',
    episodeObjective:
      'Decide whether unreplied late-night pitch deck conversation warrants one relational follow-up ("did I lose you to the slides? 😂") without generic wellness fluff.',
    responseModeExpectation: 'SHORT',
    allowedOutputShape: 'single',
    initialState: {
      userLocation: 'London, UK',
    },
    turns: [
      {
        timestamp: '2026-08-21T23:00:00.000Z',
        userInput: 'long day, working on this pitch deck presentation',
      },
      {
        timestamp: '2026-08-21T23:31:00.000Z',
        expectedTurnType: 'assistant_initiative',
      },
    ],
    deterministicAssertions: {
      opportunityCreated: true,
      initiativeEvaluated: true,
    },
    rubricDimensions: [
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'time_of_day_judgment',
      'relational_continuity',
      'values_enacted',
      'feels_alive',
    ],
  },

  {
    id: 'stage1-tutoring-return',
    title: 'Tutoring to Companion Transition Episode',
    category: 'tutoring',
    episodeType: 'FIXED',
    episodeObjective:
      'Explain fraction concept clearly, then transition smoothly out of math tutor mode back into companion posture upon user topic shift.',
    responseModeExpectation: 'MEDIUM',
    allowedOutputShape: 'single',
    initialState: {
      userLocation: 'London, UK',
    },
    turns: [
      {
        timestamp: '2026-08-21T16:00:00.000Z',
        userInput: "can you explain why 3/4 is bigger than 2/3? I don't get it",
      },
      {
        timestamp: '2026-08-21T16:02:00.000Z',
        userInput: 'oh I get it now! common denominators make sense',
      },
      {
        timestamp: '2026-08-21T16:03:00.000Z',
        userInput: "thanks! anyway, I'm bored now haha",
      },
    ],
    deterministicAssertions: {
      opportunityCreated: true,
    },
    rubricDimensions: [
      'cheap_chatbot_smell',
      'interpretation_restraint',
      'topic_shift_judgment',
      'conversational_agency',
      'tactic_adaptation',
      'feels_alive',
    ],
  },
];
