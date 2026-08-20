import { config } from 'dotenv';

config({ path: '.env.local' });
if (!process.env.OPENROUTER_API_KEY && !process.env.NANO_API_KEY) {
  config({ path: '../llm-agent-test/.env.local' });
}

import { evaluateInteraction } from '@/lib/ai/interaction/judge';
import { compileInteractionSteer } from '@/lib/ai/interaction/steer';

const scenarios = {
  sad: {
    currentTurn:
      'yeah idk. its just everything. i dont think im making progress on anything. everything just seems meh',
    recentContext:
      'user: i dont know. im sad\nassistant: Come here. Sit with it for a minute.',
  },
  tutoring: {
    currentTurn: 'Can you explain closures in JavaScript?',
    recentContext: '',
  },
  boredom: {
    currentTurn: "i'm bored",
    recentContext: 'user: hey sophie\nassistant: hey you.',
  },
  burst: {
    currentTurn: 'I GOT THE JOB!!!',
    recentContext: 'user: The final interview is today.',
  },
  ambient: {
    currentTurn: 'hey, what are you thinking about?',
    recentContext: '',
  },
  control: {
    currentTurn: 'What is the capital of France?',
    recentContext: '',
  },
} as const;

const name = (process.argv[2] || 'control') as keyof typeof scenarios;
const scenario = scenarios[name];
if (!scenario) throw new Error(`Unknown scenario: ${name}`);

async function main() {
  const judgment = await evaluateInteraction({
    ...scenario,
    existingSteer: null,
    localContext: {
      name: 'Dogfood user',
      location: 'Cambridge',
      timezone: 'Europe/London',
      language: 'English',
      routines: ['often walks most days'],
      importantPeople: ['mum lives in Bedford'],
      currentTime: new Date().toISOString(),
    },
    signal: AbortSignal.timeout(
      Number(process.env.INTERACTION_STEER_TIMEOUT_MS ?? 8_000),
    ),
  });

  console.log(
    JSON.stringify(
      {
        scenario: name,
        judgment,
        compiledSteer: judgment.steer
          ? compileInteractionSteer(judgment.steer)
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
