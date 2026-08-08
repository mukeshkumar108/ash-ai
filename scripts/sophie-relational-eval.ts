import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const conversations = [
  {
    id: 'work-and-walk',
    turns: [
      'hey my friend',
      'thanks...',
      'i have done loads of work on you today. gave you a whole new harness and i might try long-term memory next lol',
      'it is working pretty well actually. i might go for a walk later and watch the sunset',
    ],
  },
  {
    id: 'idea-with-texture',
    turns: [
      'i have this slightly ridiculous idea for a tiny cinema in an old railway carriage',
      'the intimate weirdness of it. twelve seats, great sound, films people actually want to talk about afterwards',
      'i am not sure if it should be a real business or just one beautiful event',
    ],
  },
  {
    id: 'clean-stop',
    turns: ['what is 12 multiplied by 8?'],
  },
] as const;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

async function main() {
  const { assessEpistemicPolicy } = await import('@/lib/agent/research-policy');
  const { createTurnPacket, decideTurn } = await import(
    '@/lib/agent/turn-runtime'
  );
  const { executeDirectReply } = await import('@/lib/agent/turn-executor');
  const selectedModelId = argument('model') ?? 'deepseek/deepseek-v4-flash';
  const requestedIds = new Set(
    (argument('ids') ?? conversations.map(({ id }) => id).join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  for (const conversation of conversations.filter(({ id }) =>
    requestedIds.has(id),
  )) {
    const messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      parts: Array<{ type: 'text'; text: string }>;
    }> = [];
    const transcript: Array<{
      role: 'user' | 'assistant';
      text: string;
      mode?: string;
      model?: string;
      fallback?: boolean;
    }> = [];

    for (const [index, currentUserText] of conversation.turns.entries()) {
      const recentContext = transcript
        .slice(-6)
        .map(({ role, text }) => `${role}: ${text}`)
        .join('\n')
        .slice(-4_000);
      const policy = await assessEpistemicPolicy({
        currentTurn: currentUserText,
        recentContext,
        signal: AbortSignal.timeout(15_000),
      });
      const event = {
        userId: 'relational-eval-user',
        chatId: `relational-eval-${conversation.id}`,
        currentUserText,
        selectedModelId,
        hasImageParts: false,
        ambient: {
          userLocation: 'Cambridge, England',
          timeZone: 'Europe/London',
        },
        handshake:
          index === 0
            ? {
                chatsToday: 2,
                lastInteractionAt: new Date(Date.now() - 90 * 60 * 1000),
              }
            : undefined,
      };
      const decision = decideTurn(event, policy);
      if (decision.lane !== 'reply_only') {
        throw new Error(
          `${conversation.id} unexpectedly routed turn ${index + 1} to ${decision.lane}`,
        );
      }

      messages.push({
        id: `${conversation.id}-user-${index}`,
        role: 'user',
        parts: [{ type: 'text', text: currentUserText }],
      });
      const packet = createTurnPacket({ event, decision, messages });
      const reply = await executeDirectReply({
        packet,
        signal: AbortSignal.timeout(45_000),
      });
      messages.push({
        id: `${conversation.id}-assistant-${index}`,
        role: 'assistant',
        parts: [{ type: 'text', text: reply.text }],
      });
      transcript.push(
        { role: 'user', text: currentUserText, mode: policy.interactionMode },
        {
          role: 'assistant',
          text: reply.text,
          model: reply.modelId,
          fallback: reply.usedFallback,
        },
      );
    }

    console.log(JSON.stringify({ id: conversation.id, transcript }));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed');
  process.exitCode = 1;
});
