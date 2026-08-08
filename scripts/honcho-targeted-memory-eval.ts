import dotenv from 'dotenv';
import { generateText } from 'ai';

dotenv.config({ path: '.env.local' });
process.env.HONCHO_URL ||= 'http://localhost:8001';

const userId = 'ce7f7b39-ea4a-472f-ae19-8cd404e0dde6';
const chatId = '4da0bca5-cbf5-4179-b514-1820d4a6664c';

const cases = [
  {
    id: 'previous-project',
    turn: 'What was I building before Margins?',
    recent: '',
    expectMemory: true,
    expect: /lantern/iu,
  },
  {
    id: 'current-project',
    turn: 'What am I working on now?',
    recent: '',
    expectMemory: true,
    expect: /margins/iu,
  },
  {
    id: 'historical-exercise',
    turn: 'What did I used to do for exercise?',
    recent: '',
    expectMemory: true,
    expect: /cycl/iu,
  },
  {
    id: 'contextual-followup',
    turn: 'What am I doing instead now?',
    recent:
      'user: Why did I stop cycling again?\nassistant: You stopped because the evenings became darker.',
    expectMemory: true,
    expect: /walk/iu,
  },
  {
    id: 'cancelled-plan',
    turn: 'Am I still going to York?',
    recent: '',
    expectMemory: true,
    expect: /not|cancel|no/iu,
  },
  {
    id: 'assistant-speculation',
    turn: 'Do I actually prefer working alone?',
    recent: '',
    expectMemory: true,
    expect: /no clear|not.*said|no evidence|did not/iu,
  },
  {
    id: 'general-opinion',
    turn: 'Do you think people are naturally selfish?',
    recent: '',
    expectMemory: false,
    expect: /.*/u,
  },
  {
    id: 'ambiguous-project',
    turn: 'What was it called again?',
    recent:
      'user: I was thinking about the photography app I shelved before Margins.',
    expectMemory: true,
    expect: /lantern/iu,
  },
] as const;

async function main() {
  const [
    { prepareTurnMemory },
    { buildSophieReplySystemPrompt },
    { getLanguageModel },
  ] = await Promise.all([
    import('@/lib/agent/memory'),
    import('@/lib/agent/system-prompt'),
    import('@/lib/ai/providers'),
  ]);
  const results = [];
  for (const testCase of cases) {
    const started = performance.now();
    const memory = await prepareTurnMemory({
      userId,
      chatId,
      currentUserTurn: testCase.turn,
      recentConversation: testCase.recent,
    });
    const passed =
      memory.decision.needsMemory === testCase.expectMemory &&
      (!testCase.expectMemory ||
        (testCase.id === 'assistant-speculation'
          ? !/prefer(?:s|red)? working alone|clearly prefer working alone/iu.test(
              memory.result ?? '',
            )
          : testCase.expect.test(memory.result ?? '')));
    const result = {
      id: testCase.id,
      passed,
      turn: testCase.turn,
      recent: testCase.recent,
      decision: memory.decision,
      mode: memory.retrievalMode,
      result: memory.result,
      decisionLatencyMs: memory.decisionLatencyMs,
      retrievalLatencyMs: memory.retrievalLatencyMs,
      totalMemoryLatencyMs: Math.round(performance.now() - started),
    };
    results.push(result);
    console.log(JSON.stringify({ type: 'memory-case', ...result }));
  }

  const overrideTurn =
    "I've started cycling again this week. So what do I normally do now?";
  const overrideMemory = await prepareTurnMemory({
    userId,
    chatId,
    currentUserTurn: overrideTurn,
    recentConversation: '',
  });
  const overrideAnswer = await generateText({
    model: getLanguageModel('chat-model'),
    system: buildSophieReplySystemPrompt({
      memoryPacket: overrideMemory.packet,
    }),
    prompt: overrideTurn,
    maxOutputTokens: 300,
  });
  console.log(
    JSON.stringify({
      type: 'current-override',
      memory: overrideMemory.result,
      answer: overrideAnswer.text,
      passed:
        /cycling|cycle|ride|saddle/iu.test(overrideAnswer.text) &&
        !/you (?:no longer|don't) cycle/iu.test(overrideAnswer.text),
    }),
  );

  const abPrompts = [
    'What was I building before Margins?',
    'What am I working on now?',
    'Why did I stop cycling?',
    'What kind of assistant do I like?',
  ];
  const comparisons = [];
  for (const prompt of abPrompts) {
    const memory = await prepareTurnMemory({
      userId,
      chatId,
      currentUserTurn: prompt,
      recentConversation: '',
    });
    const baseSystem = buildSophieReplySystemPrompt();
    const [withoutMemory, withMemory] = await Promise.all([
      generateText({
        model: getLanguageModel('chat-model'),
        system: baseSystem,
        prompt,
        maxOutputTokens: 350,
      }),
      generateText({
        model: getLanguageModel('chat-model'),
        system: buildSophieReplySystemPrompt({ memoryPacket: memory.packet }),
        prompt,
        maxOutputTokens: 350,
      }),
    ]);
    const comparison = {
      prompt,
      retrieved: memory.result,
      retrievalLatencyMs: memory.retrievalLatencyMs,
      withoutMemory: withoutMemory.text,
      withMemory: withMemory.text,
    };
    comparisons.push(comparison);
    console.log(JSON.stringify({ type: 'ab', ...comparison }));
  }
  console.log(
    JSON.stringify({
      type: 'targeted-summary',
      passed: results.filter((item) => item.passed).length,
      total: results.length,
      averageDecisionLatencyMs: Math.round(
        results.reduce((sum, item) => sum + item.decisionLatencyMs, 0) /
          results.length,
      ),
      averageRetrievalLatencyMs: Math.round(
        results
          .filter((item) => item.retrievalLatencyMs !== null)
          .reduce((sum, item) => sum + (item.retrievalLatencyMs ?? 0), 0) /
          results.filter((item) => item.retrievalLatencyMs !== null).length,
      ),
      results,
      comparisons,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
