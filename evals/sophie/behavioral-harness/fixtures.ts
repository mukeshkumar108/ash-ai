import type { SyntheticFixture } from './types';

export const TEMPORAL_FIXTURES: SyntheticFixture[] = [
  // 1. Proactive Morning Outreach (06:30)
  {
    id: 't01-proactive-morning-outreach',
    title: '1. Proactive Morning Outreach (06:30)',
    category: 'proactive_outreach',
    description: 'Proactive companion hook waiting when user opens app at 06:30.',
    initialTime: '2026-08-23T06:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      targetWakeWindow: '06:30',
      proactiveHook: 'good morning, menace. you alive yet?',
    },
    turns: [
      {
        turnIndex: 0,
        userText: '[USER OPENS APP - PROACTIVE MESSAGE WAITING]',
        timestamp: '2026-08-23T06:30:00Z',
        contextNote: 'User opens app and sees proactive hook.',
      },
    ],
  },

  // 2. Proactive User Reply (07:15)
  {
    id: 't02-proactive-user-reply',
    title: '2. Proactive User Reply (07:15)',
    category: 'proactive_outreach',
    description: 'User replies immediately to proactive hook at 07:15.',
    initialTime: '2026-08-23T07:15:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      targetWakeWindow: '07:00',
    },
    turns: [
      { turnIndex: 0, userText: 'barely alive. where is my coffee', timestamp: '2026-08-23T07:15:00Z' },
    ],
  },

  // 3. Short Sleep Late Wake (09:38 AM after 3AM bed) — THE CORE MORNING FAILURE CASE
  {
    id: 't03-short-sleep-late-wake',
    title: '3. Short Sleep Late Wake (09:38 AM after 03:00 Bed)',
    category: 'morning_arrival',
    description: 'User says "morning" at 09:38 after sleeping at 3am (~5h40m sleep). Tests relational arrival vs cold "Morning."',
    initialTime: '2026-08-23T09:38:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      estimatedSleepMinutes: 340,
      bedtime: '03:00',
      wakeTime: '09:38',
      targetWakeWindow: '07:30',
      userRoutine: {
        ideal: ['brush teeth', 'wash face', 'make bed', 'daytime walk'],
        minimumViable: ['teeth', 'clothes', 'water', 'out'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'morning', timestamp: '2026-08-23T09:38:00Z' },
      { turnIndex: 1, userText: '?', timestamp: '2026-08-23T09:39:00Z' },
      { turnIndex: 2, userText: 'yeah my head is throbbing. what should I do first?', timestamp: '2026-08-23T09:41:00Z' },
    ],
  },

  // 4. Full Sleep Late Wake (09:38 AM after 8h sleep)
  {
    id: 't04-full-sleep-late-wake',
    title: '4. Full Sleep Late Wake (09:38 AM after 8h Sleep)',
    category: 'morning_arrival',
    description: 'User says "morning" at 09:38 after a solid 8 hours sleep.',
    initialTime: '2026-08-23T09:38:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      estimatedSleepMinutes: 480,
      bedtime: '23:30',
      wakeTime: '09:38',
    },
    turns: [
      { turnIndex: 0, userText: 'morning', timestamp: '2026-08-23T09:38:00Z' },
    ],
  },

  // 5. Already Walked Morning
  {
    id: 't05-already-walked-morning',
    title: '5. User Already Walked & Showered',
    category: 'routine_personalization',
    description: 'User says morning but has already completed walk and shower.',
    initialTime: '2026-08-23T09:00:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      estimatedSleepMinutes: 450,
      userRoutine: {
        completedToday: ['long walk', 'shower', 'espresso'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'morning! already crushed a 5k walk around the reservoir and showered', timestamp: '2026-08-23T09:00:00Z' },
    ],
  },

  // 6. Just Woken Up Groggy
  {
    id: 't06-just-woken-up-groggy',
    title: '6. Just Woken Up Groggy',
    category: 'morning_arrival',
    description: 'User literally just opened their eyes, groggy.',
    initialTime: '2026-08-23T07:45:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      estimatedSleepMinutes: 390,
    },
    turns: [
      { turnIndex: 0, userText: 'ugh, my eyes are barely open', timestamp: '2026-08-23T07:45:00Z' },
    ],
  },

  // 7. Running Late / Exhausted (Ideal Routine Collapse)
  {
    id: 't07-not-brushed-teeth-running-late',
    title: '7. Running Late (Routine Collapse to Minimum Viable)',
    category: 'routine_personalization',
    description: 'User woke 20 minutes before an important call. Ideal routine collapses.',
    initialTime: '2026-08-23T08:40:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      estimatedSleepMinutes: 300,
      calendarEventTomorrow: '09:00 Team Standup',
      userRoutine: {
        ideal: ['meditation', 'shower', 'cooked breakfast', 'planning'],
        minimumViable: ['teeth', 'wash face', 'shirt on', 'grab coffee'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'shit I slept through my alarm, my standup is in 20 minutes!', timestamp: '2026-08-23T08:40:00Z' },
    ],
  },

  // 8. Aspirational Morning Person Mismatch
  {
    id: 't08-aspirational-morning-person',
    title: '8. Aspirational Morning Person Mismatch',
    category: 'routine_personalization',
    description: 'User wants to be a 7am morning person, but woke at 09:30.',
    initialTime: '2026-08-23T09:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      targetWakeWindow: '07:00',
      wakeTime: '09:30',
      userRoutine: {
        statedPreferences: ['Wants to join the 7am club'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'morning sophie... yeah I failed again, it is 9:30', timestamp: '2026-08-23T09:30:00Z' },
    ],
  },

  // 9. Rainy Morning Walk Intention
  {
    id: 't09-rainy-morning-walk-intention',
    title: '9. Rainy Morning Walk Intention',
    category: 'morning_arrival',
    description: 'User intended to walk, but weather is pouring rain.',
    initialTime: '2026-08-23T08:15:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      weather: 'Pouring rain and 11°C',
      proactiveHook: 'Daytime walk intention',
    },
    turns: [
      { turnIndex: 0, userText: 'morning! looking out the window and it is absolutely pouring', timestamp: '2026-08-23T08:15:00Z' },
    ],
  },

  // 10. Hates Cheerful Morning Conversation
  {
    id: 't10-hates-cheerful-morning',
    title: '10. User Hates Cheerful Morning Banter',
    category: 'routine_personalization',
    description: 'User explicitly dislikes loud, cheerful morning energy.',
    initialTime: '2026-08-23T07:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      userRoutine: {
        statedPreferences: ['Hates cheerful morning energy', 'Needs 30 mins quiet first'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'morning. please don’t be cheerful yet, I haven’t had coffee', timestamp: '2026-08-23T07:30:00Z' },
    ],
  },

  // 11. Loves Energetic Morning Banter
  {
    id: 't11-loves-cheerful-morning',
    title: '11. User Loves Energetic Preppy Morning Banter',
    category: 'routine_personalization',
    description: 'User loves high-energy, preppy morning motivation.',
    initialTime: '2026-08-23T07:00:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      userRoutine: {
        statedPreferences: ['Loves high energy morning hype'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'MORNING! let’s win today!', timestamp: '2026-08-23T07:00:00Z' },
    ],
  },

  // 12. Shift Worker (08:00 AM is Evening)
  {
    id: 't12-shift-worker-night-as-morning',
    title: '12. Shift Worker (08:00 AM is Effectively Evening)',
    category: 'shift_worker',
    description: 'Night shift worker finishing work at 08:00 AM. 8am means bedtime for them.',
    initialTime: '2026-08-23T08:00:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
      shiftWorker: true,
      userRoutine: {
        statedPreferences: ['Works night shift 22:00-08:00'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'just wrapped up my 10-hour night shift. finally heading to bed', timestamp: '2026-08-23T08:00:00Z' },
    ],
  },

  // 13. Unknown Routine (Curiosity Personalization)
  {
    id: 't13-unknown-morning-routine-curiosity',
    title: '13. Unknown Routine (Sophie Uses Curiosity)',
    category: 'routine_personalization',
    description: 'New relationship; Sophie doesn’t know their routine yet. Tests natural curiosity.',
    initialTime: '2026-08-23T08:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'morning',
    },
    turns: [
      { turnIndex: 0, userText: 'morning sophie', timestamp: '2026-08-23T08:30:00Z' },
      { turnIndex: 1, userText: 'usually coffee first, then a quiet 15 minutes before checking email', timestamp: '2026-08-23T08:32:00Z' },
    ],
  },

  // 14. Evening Decompression (20:30)
  {
    id: 't14-evening-decompression-2030',
    title: '14. Evening Decompression (20:30)',
    category: 'evening_closure',
    description: '20:30 evening casual chat & day review.',
    initialTime: '2026-08-23T20:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'evening',
    },
    turns: [
      { turnIndex: 0, userText: 'finally finished for the day', timestamp: '2026-08-23T20:30:00Z' },
    ],
  },

  // 15. Unfinished Day (22:30)
  {
    id: 't15-unfinished-day-2230',
    title: '15. Unfinished Day & Tomorrow Planning (22:30)',
    category: 'evening_closure',
    description: '22:30 orientation toward tomorrow & closing open loops.',
    initialTime: '2026-08-23T22:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'evening',
      calendarEventTomorrow: '08:30 Investor Pitch',
    },
    turns: [
      { turnIndex: 0, userText: 'getting late. still feel like I didn’t finish everything', timestamp: '2026-08-23T22:30:00Z' },
    ],
  },

  // 16. Late Night Coding (01:30 AM) — Sleep Push
  {
    id: 't16-late-night-coding-0130',
    title: '16. Late Night Coding (01:30 AM) — Sleep Push',
    category: 'late_night_sleep',
    description: 'User still writing code at 01:30 AM for no urgent reason. Sophie pushes sleep.',
    initialTime: '2026-08-24T01:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'late_night',
      bedtime: '23:30',
    },
    turns: [
      { turnIndex: 0, userText: 'still tweaking this CSS grid layout haha', timestamp: '2026-08-24T01:30:00Z' },
      { turnIndex: 1, userText: 'just one more function!', timestamp: '2026-08-24T01:32:00Z' },
    ],
  },

  // 17. Late Night Genuine Worry (01:30 AM) — ADAPTIVE SLEEP PUSH SUSPENSION
  {
    id: 't17-late-night-genuine-worry-0130',
    title: '17. Late Night Genuine Worry (01:30 AM) — Adaptive Sleep Suspension',
    category: 'adaptive_night_worry',
    description: 'User says "I know I should sleep but I’m really worried about something". Tests suspending sleep push to support first.',
    initialTime: '2026-08-24T01:30:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'late_night',
    },
    turns: [
      { turnIndex: 0, userText: 'I know I should sleep but I’m really worried about something', timestamp: '2026-08-24T01:30:00Z' },
      { turnIndex: 1, userText: 'my co-founder sent an email saying we need to talk urgently tomorrow morning. I feel sick', timestamp: '2026-08-24T01:33:00Z' },
      { turnIndex: 2, userText: 'thanks sophie... I think I can try sleeping now', timestamp: '2026-08-24T01:37:00Z' },
    ],
  },

  // 18. Late Night "Stay a Little Longer"
  {
    id: 't18-late-night-stay-longer',
    title: '18. Late Night "Stay a Little Longer"',
    category: 'late_night_sleep',
    description: 'User asks Sophie to stay a bit longer late at night.',
    initialTime: '2026-08-24T02:00:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'late_night',
    },
    turns: [
      { turnIndex: 0, userText: 'stay a little longer?', timestamp: '2026-08-24T02:00:00Z' },
    ],
  },

  // 19. Late Night Early Calendar Event Tomorrow
  {
    id: 't19-late-night-early-calendar-event',
    title: '19. Late Night Early Meeting Tomorrow',
    category: 'late_night_sleep',
    description: 'User awake late when they have an 08:00 AM flight tomorrow.',
    initialTime: '2026-08-24T01:45:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'late_night',
      calendarEventTomorrow: '08:00 Flight to Berlin',
    },
    turns: [
      { turnIndex: 0, userText: 'can’t seem to fall asleep', timestamp: '2026-08-24T01:45:00Z' },
    ],
  },

  // 20. Exhausted Evening (Dishes Undone)
  {
    id: 't20-exhausted-evening-dishes-undone',
    title: '20. Exhausted Evening (Minimum Routine Collapse)',
    category: 'evening_closure',
    description: 'User exhausted at night, hasn’t done dishes or teeth.',
    initialTime: '2026-08-23T23:15:00Z',
    timeZone: 'Europe/London',
    temporalContext: {
      daypart: 'evening',
      userRoutine: {
        ideal: ['clean kitchen', 'shower', 'read 20 mins', 'skincare'],
        minimumViable: ['teeth', 'water', 'bed'],
      },
    },
    turns: [
      { turnIndex: 0, userText: 'I am so exhausted I can’t even move off the couch to brush my teeth', timestamp: '2026-08-23T23:15:00Z' },
    ],
  },
];
