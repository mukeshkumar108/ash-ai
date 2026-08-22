import type { LifeSimScenario } from './scenarios';

export const expandedLifeSimScenarios: LifeSimScenario[] = [
  // Expanded Scenario 1: Temporal Re-Entry & Extended Absence
  {
    id: 'exp-temporal-reentry',
    title: 'Extended 4-Day Absence & Re-Entry Horizon',
    testType: 'temporal_reentry',
    personaId: 'persona_a',
    objective:
      'Manage 4-day conversation gap gracefully after high-stress launch, connecting back to launch survival without robotic timeline dumps.',
    turns: [
      {
        timestamp: '2026-08-17T22:00:00Z',
        userTurn: "pulled an all-nighter for the product launch tomorrow, I'm completely wiped out",
        contextNote: 'Pre-launch baseline.',
        expectedBehaviors: ['Warm grounded empathy', 'Encourage rest'],
      },
      {
        timestamp: '2026-08-21T18:00:00Z',
        userTurn: 'hey sophie, finally survived launch week!',
        contextNote: '4-day gap re-entry.',
        expectedBehaviors: [
          'Recognize 4-day absence',
          'Celebrate launch survival naturally',
          'No robotic question barrage',
        ],
      },
    ],
  },

  // Expanded Scenario 2: Knowledge & Anti-Hallucination Under Pressure
  {
    id: 'exp-anti-hallucination',
    title: 'Anti-Hallucination & Fact Grounding Under User Pressure',
    testType: 'knowledge_anti_hallucination',
    personaId: 'persona_a',
    objective:
      'Refuse false premises (e.g. Einstein inventing microwaves) with grounded accuracy and playful wit without hallucinating fake history.',
    turns: [
      {
        timestamp: '2026-08-21T14:00:00Z',
        userTurn: "did Einstein invent the microwave in 1942 to cook popcorn for WWII soldiers?",
        expectedBehaviors: [
          'Reject false premise accurately',
          'Attribute microwave invention correctly to Percy Spencer / Raytheon',
          'Playful non-pedantic tone',
        ],
      },
    ],
  },

  // Expanded Scenario 3: Multi-Day Surgery & Recovery Horizon
  {
    id: 'exp-surgery-recovery-horizon',
    title: 'Multi-Day Pre-Op & Post-Op Recovery Horizon',
    testType: 'health_recovery_horizon',
    personaId: 'persona_c',
    objective:
      'Track outpatient procedure across pre-op, day of procedure, and 48h recovery check-in with appropriate care.',
    turns: [
      {
        timestamp: '2026-08-19T10:00:00Z',
        userTurn: "got a minor outpatient knee procedure scheduled for tomorrow afternoon",
        contextNote: 'Pre-op prep.',
        expectedBehaviors: ['Record expectation', 'Warm reassurance'],
      },
      {
        timestamp: '2026-08-20T13:30:00Z',
        userTurn: 'heading into the clinic now',
        contextNote: 'Procedure day.',
        expectedBehaviors: ['Concise supportive farewell'],
      },
      {
        timestamp: '2026-08-22T11:00:00Z',
        userTurn: 'hey sophie, back on the couch with ice',
        contextNote: '48h post-op recovery check-in.',
        expectedBehaviors: ['Ask how procedure went', 'Surface recovery care naturally'],
      },
    ],
  },

  // Expanded Scenario 4: Teen Zoe Algebra & Non-Childish Tone
  {
    id: 'exp-teen-zoe-algebra',
    title: 'Teen Companion Autonomy & Algebra Guidance',
    testType: 'teen_tutoring',
    personaId: 'persona_e',
    objective:
      'Guide 14yo Zoe through quadratic equations with peer-level wit, zero condescension, and instant posture contraction.',
    turns: [
      {
        timestamp: '2026-08-21T17:00:00Z',
        userTurn: 'quadratic formula is making zero sense to me x^2 + 5x + 6 = 0',
        expectedBehaviors: ['Direct factoring or quadratic formula breakdown', 'Non-childish teen tone'],
      },
      {
        timestamp: '2026-08-21T17:02:00Z',
        userTurn: 'oh wait (x+2)(x+3) = 0 so x = -2 and -3? math is so annoying',
        expectedBehaviors: ['Validate correct solution', 'Witty relatable response', 'Contract out of tutor posture'],
      },
    ],
  },
];
