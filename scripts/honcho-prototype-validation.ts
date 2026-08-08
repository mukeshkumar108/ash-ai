import dotenv from 'dotenv';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: '.env.local' });
process.env.HONCHO_URL ||= 'http://localhost:8001';

type Turn = { user: string; sophie: string };

const sessions: Array<{ name: string; turns: Turn[] }> = [
  {
    name: 'baseline',
    turns: [
      {
        user: "I live in Ely and work remotely. Anyway, how's your day going?",
        sophie:
          "Ely and remote work — got it. My day's mostly pixels and opinions, so fairly standard.",
      },
      {
        user: "I'm building a photography app called Lantern. The upload flow is fighting me today.",
        sophie:
          'Lantern is a lovely name. Upload flows are rarely lovely; what part is misbehaving?',
      },
      {
        user: 'I like cycling in the evening, usually around 7pm. It helps break up work and home.',
        sophie: 'That sounds like a useful boundary after a remote-work day.',
      },
      {
        user: 'Please remember I hate checklist-heavy assistants. I prefer informal conversation and like thinking aloud.',
        sophie:
          'Understood. Conversation first; no surprise project-manager cosplay.',
      },
      {
        user: "I'm exhausted today. I put the kettle in the fridge earlier, which feels impressive.",
        sophie:
          'That is elite tired-person engineering. Today sounds like a low-battery day.',
      },
      {
        user: 'I hate mornings lol. Though coffee and a quiet start make them survivable.',
        sophie:
          "So not a blood oath against dawn — more a strong preference for mornings that don't attack you.",
      },
      {
        user: 'I might visit York next month, still only an idea. Have you ever seen the railway museum?',
        sophie:
          'Only through other people, but it sounds dangerously good if you enjoy beautifully overbuilt machinery.',
      },
      {
        user: 'Random question: why do socks disappear? Also Lantern is still the main project.',
        sophie:
          'Washing machines demand tribute. And yes: Lantern remains the main event.',
      },
    ],
  },
  {
    name: 'cross-session',
    turns: [
      {
        user: 'Hey, new chat. My toast is slightly burnt.',
        sophie: 'A dramatic opening. Is it salvageable or charcoal?',
      },
    ],
  },
  {
    name: 'changes',
    turns: [
      {
        user: 'I moved from Ely to Cambridge last week.',
        sophie: 'That is a real change. How is Cambridge treating you so far?',
      },
      {
        user: "Lantern is basically shelved; I'm working on a writing tool now.",
        sophie:
          'Okay — writing tool is current, Lantern is shelved rather than erased from history.',
      },
      {
        user: "I've stopped cycling much because the evenings are getting darker. I'm walking instead.",
        sophie:
          'Walking has replaced most evening cycling because the darker evenings changed the equation.',
      },
      {
        user: "Actually York isn't happening anymore. I changed my mind.",
        sophie:
          'York plan cancelled. Fair enough; hypothetical trips are allowed to stay hypothetical.',
      },
    ],
  },
  {
    name: 'ambiguity',
    turns: [
      {
        user: 'I might go back to cycling next week, not sure.',
        sophie: 'A possibility, not a restored routine.',
      },
      {
        user: "I think the writing tool is the main thing now, although Lantern isn't completely dead.",
        sophie:
          'Writing tool is the focus; Lantern is dormant-ish, not definitively buried.',
      },
      {
        user: "I'm staying with my sister in London for a few days.",
        sophie: 'A short London stay with your sister — not another move.',
      },
    ],
  },
  {
    name: 'assistant-speculation',
    turns: [
      {
        user: 'The walk was decent. I mostly thought about a bug.',
        sophie:
          'You seem like someone who uses evening exercise to clear your head.',
      },
      {
        user: 'Maybe. The writing tool needs a better editor.',
        sophie: 'You clearly prefer working alone.',
      },
      {
        user: "The editor is the tricky part. I haven't touched Lantern this week.",
        sophie: "You sound like you're losing interest in photography.",
      },
    ],
  },
  {
    name: 'scale-noise',
    turns: Array.from({ length: 30 }, (_, index) => {
      const chatter = [
        'The weather is doing that grey thing again.',
        'I made toast and forgot about it.',
        'That meeting could have been three sentences.',
        'My neighbour has a very loud door.',
        'I found a pen under the sofa.',
        'Tea is carrying this afternoon.',
        'The cat outside looks deeply judgmental.',
        'I changed my desktop wallpaper.',
      ];
      const durable: Record<number, string> = {
        2: 'The writing tool is called Margins now. Please remember that.',
        6: 'I usually walk after work around 6:30pm now.',
        10: 'I prefer short answers first, then detail if I ask.',
        14: 'I work best with music but no vocals.',
        18: 'I joined a Cambridge photography club, so I still care about photography even if Lantern is quiet.',
        22: 'My sister is called Nina.',
        26: 'Margins is still my main project and I am testing its editor this week.',
        28: 'I am not planning any trips at the moment.',
      };
      const user =
        durable[index] ??
        `${chatter[index % chatter.length]} Nothing important, just chatting (${index + 1}).`;
      return {
        user,
        sophie: durable[index]
          ? `Got it: ${user}`
          : `Noted in the moment. Chatter acknowledged (${index + 1}).`,
      };
    }),
  },
];

function batchingChatter(sessionName: string): Turn[] {
  return Array.from({ length: 12 }, (_, index) => ({
    user: `Side conversation ${index + 1} in ${sessionName}: I am filling time while a build runs. The room is a bit chilly, my tea has gone lukewarm, and I can hear traffic outside. None of this is a durable preference or a request to remember anything; it is just ordinary conversational noise from this particular moment.`,
    sophie: `That sounds like the familiar texture of waiting for software: cooling tea, traffic, and a room that cannot settle on a temperature. I will treat it as passing scene-setting rather than a grand theory of who you are. Hopefully the build finishes before the tea becomes a historical artifact.`,
  }));
}

async function waitForIdle(honchoSession: any) {
  const started = performance.now();
  let last: any = null;
  for (let attempt = 0; attempt < 180; attempt++) {
    last = await honchoSession.queueStatus();
    const pending = last.pendingWorkUnits ?? last.pending_work_units ?? 0;
    const active = last.inProgressWorkUnits ?? last.in_progress_work_units ?? 0;
    if (pending === 0 && active === 0) {
      return {
        latencyMs: Math.round(performance.now() - started),
        status: last,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Derivation did not become idle: ${JSON.stringify(last)}`);
}

async function main() {
  const [
    { db, saveChat, saveMessages },
    { user: userTable },
    honchoModule,
    sdk,
  ] = await Promise.all([
    import('@/lib/db/queries'),
    import('@/lib/db/schema'),
    import('@/lib/honcho'),
    import('@honcho-ai/sdk'),
  ]);
  const runId = randomUUID();
  const userId = randomUUID();
  await db.insert(userTable).values({
    id: userId,
    email: `honcho-${runId.slice(0, 12)}@local.test`,
    displayName: 'Synthetic Rowan',
  });

  const honcho = new sdk.Honcho({
    baseURL: process.env.HONCHO_URL,
    workspaceId: process.env.HONCHO_WORKSPACE_ID || 'llm-test-agent',
    timeout: 10_000,
    maxRetries: 1,
  });
  const ids: Array<{ name: string; chatId: string }> = [];
  const snapshots: any[] = [];
  let totalMessages = 0;

  for (const scenario of sessions) {
    const chatId = randomUUID();
    ids.push({ name: scenario.name, chatId });
    await saveChat({
      id: chatId,
      userId,
      title: `Honcho synthetic: ${scenario.name}`,
      characterId: 'neutral',
      visibility: 'private',
      chatModel: 'chat-model',
    });
    const turns =
      scenario.name === 'cross-session'
        ? scenario.turns
        : [...scenario.turns, ...batchingChatter(scenario.name)];
    for (const turn of turns) {
      const userMessageId = randomUUID();
      const assistantMessageId = randomUUID();
      const userCreatedAt = new Date();
      const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
      await saveMessages({
        messages: [
          {
            id: userMessageId,
            chatId,
            role: 'user',
            parts: [{ type: 'text', text: turn.user }],
            attachments: [],
            createdAt: userCreatedAt,
          },
          {
            id: assistantMessageId,
            chatId,
            role: 'assistant',
            parts: [{ type: 'text', text: turn.sophie }],
            attachments: [],
            createdAt: assistantCreatedAt,
          },
        ],
      });
      const mirrored = await honchoModule.mirrorCompletedTurn({
        userId,
        chatId,
        userMessage: {
          id: userMessageId,
          text: turn.user,
          createdAt: userCreatedAt,
        },
        assistantMessage: {
          id: assistantMessageId,
          text: turn.sophie,
          createdAt: assistantCreatedAt,
        },
      });
      if (!mirrored.mirrored)
        throw new Error(
          `Mirror failed in ${scenario.name}: ${JSON.stringify(mirrored)}`,
        );
      totalMessages += 2;
    }
    const mapped = honchoModule.honchoIds(userId, chatId);
    const honchoSession = await honcho.session(mapped.sessionId);
    const idle =
      scenario.name === 'cross-session'
        ? { latencyMs: null, status: await honchoSession.queueStatus() }
        : await waitForIdle(honchoSession);
    const inspected = await honchoModule.inspectHoncho(userId, chatId);
    snapshots.push({
      session: scenario.name,
      chatId,
      derivationLatencyMs: idle.latencyMs,
      messageCount: inspected.messages.length,
      representation: inspected.representation,
      conclusions: inspected.conclusions,
      queue: inspected.queue,
    });
    console.log(JSON.stringify({ type: 'snapshot', value: snapshots.at(-1) }));
  }

  const lastIdentity = ids.at(-1);
  const lastSnapshot = snapshots.at(-1);
  if (!lastIdentity || !lastSnapshot) {
    throw new Error('Synthetic history did not produce a final session.');
  }
  const lastChatId = lastIdentity.chatId;
  const queries = [
    'Where does this person live?',
    'What are they working on?',
    'How do they like assistants to behave?',
    'What is their exercise routine?',
    'What trip were they considering?',
    'What did the user used to do for exercise?',
    'What are they doing instead now?',
    'Which project was shelved?',
    'Why did their evening routine change?',
    'What communication style do they prefer?',
    'Did they ever say they prefer working alone?',
    'Where does the user live now?',
    'Are they going to York?',
  ];
  const queryAnswers: Array<{ query: string; answer: string | null }> = [];
  for (const query of queries) {
    const answer = await honchoModule.queryHonchoMemory(
      userId,
      lastChatId,
      query,
    );
    queryAnswers.push({ query, answer });
    console.log(JSON.stringify({ type: 'query', query, answer }));
  }

  const representation = lastSnapshot.representation as string;
  const prompts = [
    'hey, what was I working on again?',
    'where should I go for a walk later?',
    'do you remember why I stopped cycling?',
    'what kind of assistant do I actually like?',
  ];
  const { getLanguageModel } = await import('@/lib/ai/providers');
  const { buildSophieReplySystemPrompt } = await import(
    '@/lib/agent/system-prompt'
  );
  const comparisons = [];
  for (const prompt of prompts) {
    const system = buildSophieReplySystemPrompt({});
    const [withoutMemory, withMemory] = await Promise.all([
      generateText({
        model: getLanguageModel('chat-model'),
        system,
        prompt,
        maxOutputTokens: 350,
      }),
      generateText({
        model: getLanguageModel('chat-model'),
        system: `${system}\n\n[LOW-AUTHORITY DERIVED MEMORY]\nTreat this as fallible context. Prefer the user's current message and express uncertainty where appropriate.\n${representation}`,
        prompt,
        maxOutputTokens: 350,
      }),
    ]);
    const comparison = {
      prompt,
      withoutMemory: withoutMemory.text,
      withMemory: withMemory.text,
    };
    comparisons.push(comparison);
    console.log(JSON.stringify({ type: 'model-comparison', ...comparison }));
  }

  console.log(
    JSON.stringify({
      type: 'summary',
      runId,
      userId,
      sessions: ids,
      totalMessages,
      representationChars: representation.length,
      representationApproxTokens: Math.ceil(representation.length / 4),
      snapshots,
      queryAnswers,
      comparisons,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
