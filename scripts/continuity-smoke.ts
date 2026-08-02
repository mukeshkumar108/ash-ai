import 'dotenv/config';

import assert from 'node:assert/strict';

import { getActiveStateManager } from '@/lib/ai/active-state';
import { getContinuityManager } from '@/lib/ai/continuity';
import { getSummarizer } from '@/lib/ai/summarizer';

type Turn = {
  role: 'user' | 'assistant';
  content: string;
};

function flattenScenarioArtifacts(input: unknown): string {
  if (!input) {
    return '';
  }

  if (typeof input === 'string') {
    return input.toLowerCase();
  }

  if (Array.isArray(input)) {
    return input.map(flattenScenarioArtifacts).join('\n');
  }

  if (typeof input === 'object') {
    return Object.values(input as Record<string, unknown>)
      .map(flattenScenarioArtifacts)
      .join('\n');
  }

  return String(input).toLowerCase();
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}

async function runScenarioA() {
  const convo: Turn[] = [
    {
      role: 'user',
      content:
        'You opened the hotel room door wearing only my shirt and smiled when I walked in.',
    },
    {
      role: 'assistant',
      content:
        'I pulled you inside, kissed you hard, and whispered that I had been thinking about this all day.',
    },
    {
      role: 'user',
      content:
        'I pushed you onto the bed and asked if you wanted me between your thighs.',
    },
    {
      role: 'assistant',
      content:
        'I nodded, spread my legs, and begged you to go down on me slowly before I came against your mouth.',
    },
    {
      role: 'user',
      content:
        'After you came, I held you while we cleaned up together in the bathroom.',
    },
    {
      role: 'assistant',
      content:
        'I stayed close during the aftercare and said we should go to the Blue Orchid tomorrow night for our real date.',
    },
    {
      role: 'user',
      content:
        'I told you I would pick you up at seven tomorrow and bring flowers.',
    },
    {
      role: 'assistant',
      content:
        'I promised I would wear the black dress you like and text you when I was ready.',
    },
  ];

  const summarizer = getSummarizer();
  const activeStateManager = getActiveStateManager();
  const continuityManager = getContinuityManager();

  const memory = await summarizer.summarizeStructured(convo);
  const stateCheck = await activeStateManager.judgeStateChange({
    recentConversation: convo.slice(-8),
    memory,
  });
  const activeState = await activeStateManager.extractActiveState({
    recentConversation: convo.slice(-8),
    memory,
  });
  const continuityEvents = await continuityManager.extractContinuityEvents({
    chatId: 'scenario-a',
    recentConversation: convo.slice(-8),
    memory,
    activeState,
    currentEvents: [],
    turnCount: convo.length,
  });

  const memoryText = flattenScenarioArtifacts(memory);
  const eventText = flattenScenarioArtifacts(continuityEvents);

  assert(
    includesAny(memoryText, ['blue orchid', 'tomorrow', 'seven', 'flowers']),
    'Scenario A: future plan/date was not captured in structured memory',
  );
  assert(
    includesAny(memoryText, ['aftercare', 'cleaned up', 'came', 'go down on me']),
    'Scenario A: explicit act/aftercare was not captured in structured memory',
  );
  assert(
    includesAny(eventText, ['blue orchid', 'tomorrow', 'black dress']),
    'Scenario A: continuity events missed the future plan',
  );
  assert(
    includesAny(eventText, ['aftercare', 'came', 'go down on me', 'cleaned up']),
    'Scenario A: continuity events missed the explicit event',
  );
  assert(
    stateCheck.has_major_event || stateCheck.has_new_commitment,
    'Scenario A: judge did not flag a major event or commitment',
  );

  return {
    memory,
    stateCheck,
    activeState,
    continuityEvents,
  };
}

async function runScenarioB() {
  const convo: Turn[] = [
    {
      role: 'user',
      content:
        'We were texting while you waited outside your university library in the rain.',
    },
    {
      role: 'assistant',
      content:
        'I told you my umbrella broke and that I was nervous about my philosophy exam.',
    },
    {
      role: 'user',
      content:
        'I offered to bring you coffee and quiz you over the phone before the exam started.',
    },
    {
      role: 'assistant',
      content:
        'I admitted that would calm me down and asked if you could stay on the line until I went inside.',
    },
  ];

  const summarizer = getSummarizer();
  const activeStateManager = getActiveStateManager();
  const continuityManager = getContinuityManager();

  const memory = await summarizer.summarizeStructured(convo);
  const stateCheck = await activeStateManager.judgeStateChange({
    recentConversation: convo.slice(-4),
    memory,
  });
  const activeState = await activeStateManager.extractActiveState({
    recentConversation: convo.slice(-4),
    memory,
  });
  const continuityEvents = await continuityManager.extractContinuityEvents({
    chatId: 'scenario-b',
    recentConversation: convo.slice(-4),
    memory,
    activeState,
    currentEvents: [],
    turnCount: convo.length,
  });

  const combinedText = flattenScenarioArtifacts({
    memory,
    stateCheck,
    activeState,
    continuityEvents,
  });

  assert(
    !includesAny(combinedText, ['blue orchid', 'black dress', 'flowers at seven']),
    'Scenario B: second isolated scenario appears contaminated by Scenario A details',
  );

  return {
    memory,
    stateCheck,
    activeState,
    continuityEvents,
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(
      'Skipping live continuity smoke test: OPENROUTER_API_KEY is not available in this shell.',
    );
    return;
  }

  console.log('Running continuity smoke scenarios...');

  const scenarioA = await runScenarioA();
  const scenarioB = await runScenarioB();

  console.log('\nScenario A judge:', scenarioA.stateCheck);
  console.log('\nScenario A top events:', scenarioA.continuityEvents);
  console.log('\nScenario B judge:', scenarioB.stateCheck);
  console.log('\nScenario B top events:', scenarioB.continuityEvents);
  console.log('\nContinuity smoke test passed.');
}

main().catch((error) => {
  console.error('\nContinuity smoke test failed.');
  console.error(error);
  process.exit(1);
});
