import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { executeLiveDataReply } = await import('@/lib/agent/turn-executor');
  const { createToolLanePacket, toolLaneDecision } = await import(
    '@/lib/agent/tool-lane'
  );
  const prompt =
    process.argv.slice(2).join(' ').trim() ||
    "Reckon I'll need a jacket for my sunset walk?";
  const decision = toolLaneDecision({
    lane: 'live_data',
    selectedModelId: 'deepseek/deepseek-v4-flash',
    hasImageParts: false,
  });
  const packet = createToolLanePacket({
    decision,
    messages: [
      {
        id: 'weather-smoke-message',
        role: 'user',
        parts: [{ type: 'text', text: prompt }],
      },
    ],
    ambient: { userLocation: 'Burwell, Cambs', timeZone: 'Europe/London' },
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
