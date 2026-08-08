import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { executeLiveDataReply } = await import('@/lib/agent/turn-executor');
  const { createTurnPacket, decideTurn } = await import(
    '@/lib/agent/turn-runtime'
  );
  const prompt =
    process.argv.slice(2).join(' ').trim() ||
    "Reckon I'll need a jacket for my sunset walk?";
  const event = {
    userId: 'weather-smoke-user',
    chatId: 'weather-smoke-chat',
    currentUserText: prompt,
    selectedModelId: 'deepseek/deepseek-v4-flash',
    hasImageParts: false,
    ambient: {
      userLocation: 'Burwell, Cambs',
      timeZone: 'Europe/London',
    },
  };
  const policy = {
    researchDepth: 'none' as const,
    freshnessNeed: 'required' as const,
    authorityNeed: 'none' as const,
    sourceSensitivity: 'low' as const,
    stakes: 'low' as const,
    questionMode: 'verification' as const,
    capabilityRoute: 'live_data' as const,
    interactionMode: 'practical' as const,
    neutralResearchQuestion: null,
    reason: 'Weather smoke test.',
    confidence: 1,
    classifierRan: false,
    classifierSucceeded: true,
    userDeclinedResearch: false,
  };
  const decision = decideTurn(event, policy);
  const packet = createTurnPacket({
    event,
    decision,
    messages: [
      {
        id: 'weather-smoke-message',
        role: 'user',
        parts: [{ type: 'text', text: prompt }],
      },
    ],
    timeZone: event.ambient.timeZone,
  });
  const result = await executeLiveDataReply({
    packet,
    signal: AbortSignal.timeout(45_000),
  });
  console.log(
    JSON.stringify(
      {
        lane: decision.lane,
        model: result.modelId,
        usedFallback: result.usedFallback,
        answer: result.text,
        trace: result.trace,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Weather agent smoke test failed.',
  );
  process.exitCode = 1;
});
