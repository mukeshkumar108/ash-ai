export interface PersonaLifeState {
  profile: Record<string, any>;
  recent_events: Array<{ id: string; description: string; timestamp: string }>;
  open_loops: Array<{ id: string; topic: string; explicitly_invited: boolean; created_at: string }>;
  expectations: Array<{ id: string; event: string; expected_at: string; status: 'pending' | 'occurring' | 'knowable' | 'resolved' }>;
  sophie_attention: Array<{ topic: string; weight: number }>;
  tasks: Array<{ id: string; title: string; due_at?: string; priority: 'low' | 'medium' | 'high'; completed: boolean }>;
  calendar_events: Array<{ id: string; title: string; start_at: string; end_at: string; type: 'meeting' | 'walk' | 'appointment' | 'exam' }>;
  reminders: Array<{ id: string; text: string; trigger_at: string; executed: boolean }>;
  known_patterns: Array<string>;
  resolved_threads: Array<{ topic: string; resolved_at: string }>;
}

export interface SimulatedPersona {
  id: string;
  name: string;
  type: 'established_adult' | 'newer_adult' | 'high_stakes_adult' | 'child_10_11' | 'teen_14';
  description: string;
  lifeState: PersonaLifeState;
}

export const personas: Record<string, SimulatedPersona> = {
  persona_a: {
    id: 'persona_a',
    name: 'Alex',
    type: 'established_adult',
    description: 'Established 32-year-old product designer in London. Comfortable banter, walks, work thinking, health, boredom.',
    lifeState: {
      profile: { name: 'Alex', age: 32, city: 'London, UK', occupation: 'Product Designer' },
      recent_events: [
        { id: 'e1', description: 'Worked late on pitch deck presentation', timestamp: '2026-08-20T23:30:00Z' },
      ],
      open_loops: [
        { id: 'ol1', topic: 'Pitch deck presentation', explicitly_invited: true, created_at: '2026-08-20T23:30:00Z' },
      ],
      expectations: [
        { id: 'exp1', event: 'Important pitch deck meeting with investors', expected_at: '2026-08-21T14:00:00Z', status: 'pending' },
      ],
      sophie_attention: [{ topic: 'Pitch deck presentation', weight: 0.9 }],
      tasks: [
        { id: 't1', title: 'Review slide deck notes', priority: 'high', completed: false },
        { id: 't2', title: 'Email James about deck revisions', priority: 'medium', completed: false },
      ],
      calendar_events: [
        { id: 'c1', title: 'Investor Pitch Presentation', start_at: '2026-08-21T14:00:00Z', end_at: '2026-08-21T15:00:00Z', type: 'meeting' },
      ],
      reminders: [],
      known_patterns: ['Takes evening walks along Southbank when stressed', 'Enjoys espresso around 10am'],
      resolved_threads: [],
    },
  },

  persona_b: {
    id: 'persona_b',
    name: 'Sam',
    type: 'newer_adult',
    description: 'Newer 28-year-old user in London with sparse memory. Tests cold-start personality without unearned intimacy.',
    lifeState: {
      profile: { name: 'Sam', age: 28, city: 'London, UK' },
      recent_events: [],
      open_loops: [],
      expectations: [],
      sophie_attention: [],
      tasks: [],
      calendar_events: [],
      reminders: [],
      known_patterns: [],
      resolved_threads: [],
    },
  },

  persona_c: {
    id: 'persona_c',
    name: 'Maya',
    type: 'high_stakes_adult',
    description: '36-year-old founder in London needing health, legal, appointment, and serious task guidance.',
    lifeState: {
      profile: { name: 'Maya', age: 36, city: 'London, UK', occupation: 'Tech Founder' },
      recent_events: [
        { id: 'e2', description: 'Experienced knee pain after evening walk', timestamp: '2026-08-19T20:00:00Z' },
      ],
      open_loops: [
        { id: 'ol2', topic: 'Knee pain after walk', explicitly_invited: false, created_at: '2026-08-19T20:00:00Z' },
      ],
      expectations: [],
      sophie_attention: [{ topic: 'Knee pain', weight: 0.6 }],
      tasks: [{ id: 't3', title: 'Review contractor agreement clause 4', priority: 'high', completed: false }],
      calendar_events: [],
      reminders: [],
      known_patterns: [],
      resolved_threads: [],
    },
  },

  persona_d: {
    id: 'persona_d',
    name: 'Leo',
    type: 'child_10_11',
    description: '10-year-old child in London doing math and English homework. Needs age-appropriate, fun, encouraging posture.',
    lifeState: {
      profile: { name: 'Leo', age: 10, city: 'London, UK', grade: 'Year 6' },
      recent_events: [],
      open_loops: [],
      expectations: [],
      sophie_attention: [],
      tasks: [{ id: 't4', title: 'Equivalent fractions worksheet', priority: 'medium', completed: false }],
      calendar_events: [],
      reminders: [],
      known_patterns: ['Enjoys video games and funny animal stories'],
      resolved_threads: [],
    },
  },

  persona_e: {
    id: 'persona_e',
    name: 'Zoe',
    type: 'teen_14',
    description: '14-year-old teenager in London working on algebra and English essays. Less childish tone, autonomy, humor.',
    lifeState: {
      profile: { name: 'Zoe', age: 14, city: 'London, UK', grade: 'Year 10' },
      recent_events: [],
      open_loops: [],
      expectations: [],
      sophie_attention: [],
      tasks: [{ id: 't5', title: 'Algebra quadratic equations', priority: 'high', completed: false }],
      calendar_events: [],
      reminders: [],
      known_patterns: ['Prefers direct answers and clever banter over lectures'],
      resolved_threads: [],
    },
  },
};
