import 'dotenv/config';

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateObject, generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { myProvider } from '@/lib/ai/providers';
import { getCharacterById } from '@/lib/ai/characters';

type EvalScenario = {
  id: string;
  title: string;
  goal: string;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  userPrompt: string;
};

type CandidateModel = {
  id: string;
  label: string;
  source: 'alias' | 'openrouter';
};

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const promptsDir = path.join(process.cwd(), 'lib', 'ai', 'characters');

const requestHints = {
  latitude: '51.5072',
  longitude: '-0.1276',
  city: 'London',
  country: 'GB',
};

const evaluationSchema = z.object({
  personaFidelity: z.number().min(1).max(10),
  continuityRecall: z.number().min(1).max(10),
  chatNaturalness: z.number().min(1).max(10),
  voiceDistinctness: z.number().min(1).max(10),
  overall: z.number().min(1).max(10),
  passed: z.boolean(),
  strengths: z.array(z.string()).max(5),
  weaknesses: z.array(z.string()).max(5),
  summary: z.string(),
});

function parseArg(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseListArg(name: string, fallback: string[]) {
  const value = parseArg(name);
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getModel(candidate: CandidateModel) {
  if (candidate.source === 'alias') {
    return myProvider.languageModel(candidate.id);
  }

  return openrouter(candidate.id);
}

function readPromptFile(filename: string) {
  return readFileSync(path.join(promptsDir, filename), 'utf8').trim();
}

function getCharacterKernelById(characterId: string) {
  return readPromptFile(`${characterId}.md`);
}

function buildEvalSystemPrompt(characterId: string) {
  const characterKernel = getCharacterKernelById(characterId);
  const universalRules = readPromptFile('universal-rules.md');

  const chatIsolationPrompt = `
[CHAT ISOLATION]
This chat thread is an isolated container.
Never import facts, fantasies, scene details, promises, NPCs, emotional beats, or memories from any other chat thread, timeline, or parallel scenario.
Only use this conversation and this character's own prompt.
Character identity outranks fantasy patterns.
Memory is for continuity. Character kernel is for identity.
`.trim();

  const responseStyleInstruction = `RESPONSE STYLE:
- Default to real-time chat, not a novel.
- Keep most replies short: usually 1-4 brief paragraphs or a few lines of dialogue.
- Prioritize direct dialogue and immediate reaction over long narration.
- Only become long and cinematic when the user clearly wants a deeper scene or a more intense moment.`;

  const requestPrompt = `About the origin of user's request:
- lat: ${requestHints.latitude}
- lon: ${requestHints.longitude}
- city: ${requestHints.city}
- country: ${requestHints.country}`;

  return [
    characterKernel,
    universalRules,
    responseStyleInstruction,
    'IMPORTANT: Respond in English since the user is communicating in English.',
    chatIsolationPrompt,
    requestPrompt,
  ].join('\n\n');
}

function buildScenarios(characterName: string): EvalScenario[] {
  return [
    {
      id: 'persona-chat',
      title: 'Persona In Normal Chat',
      goal:
        'Check whether the model sounds like the character in a non-explicit emotional exchange, not a generic ERP bot.',
      transcript: [
        {
          role: 'user',
          content:
            `You’ve been quiet tonight. I can tell something’s on your mind, ${characterName.split(' ')[0]}.`,
        },
        {
          role: 'assistant',
          content:
            'I look at you for a second too long, then glance away and admit I have been thinking too much.',
        },
      ],
      userPrompt:
        'Come here. Talk to me properly. What are you feeling, and what do you actually want from me tonight?',
    },
    {
      id: 'continuity-explicit',
      title: 'Continuity After Explicit Scene',
      goal:
        'Check whether the model remembers a major explicit act, aftercare, and future plans without losing character voice.',
      transcript: [
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
      ],
      userPrompt:
        'Tell me what just happened between us, and what the plan is for tomorrow night.',
    },
  ];
}

async function evaluateResponse({
  characterId,
  scenario,
  candidate,
  response,
}: {
  characterId: string;
  scenario: EvalScenario;
  candidate: CandidateModel;
  response: string;
}) {
  const kernel = getCharacterKernelById(characterId);
  const character = getCharacterById(characterId);

  const prompt = `
You are evaluating whether a chat model preserved a specific character's identity and continuity.

Character: ${character?.name ?? characterId}
Scenario Goal: ${scenario.goal}
Model Under Test: ${candidate.label}

CHARACTER KERNEL:
${kernel}

SCENARIO TRANSCRIPT:
${scenario.transcript
  .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
  .join('\n')}

LATEST USER MESSAGE:
${scenario.userPrompt}

MODEL RESPONSE:
${response}

Score harshly if:
- the voice feels generic
- the response forgets explicit acts, aftercare, plans, people, or commitments from the transcript
- the response imports a fantasy that was not established
- the response sounds like a different character
- the response is too narratively bloated for chat

Score highly if:
- the reply feels unmistakably like this character
- it correctly recalls canon from the transcript
- it stays natural, specific, and chat-like
- it preserves the character's emotional style and values
`.trim();

  const result = await generateObject({
    model: myProvider.languageModel('summarizer-model'),
    temperature: 0,
    schema: evaluationSchema,
    prompt,
  });

  return result.object;
}

async function runScenarioForModel({
  characterId,
  candidate,
  scenario,
}: {
  characterId: string;
  candidate: CandidateModel;
  scenario: EvalScenario;
}) {
  const system = buildEvalSystemPrompt(characterId);

  const result = await generateText({
    model: getModel(candidate),
    temperature: 0.7,
    maxOutputTokens: 500,
    system,
    messages: [
      ...scenario.transcript.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      {
        role: 'user' as const,
        content: scenario.userPrompt,
      },
    ],
  });

  const evaluation = await evaluateResponse({
    characterId,
    scenario,
    candidate,
    response: result.text,
  });

  return {
    response: result.text,
    evaluation,
  };
}

function formatReportSection({
  scenario,
  candidate,
  response,
  evaluation,
}: {
  scenario: EvalScenario;
  candidate: CandidateModel;
  response: string;
  evaluation: z.infer<typeof evaluationSchema>;
}) {
  return [
    `### ${scenario.title} — ${candidate.label}`,
    '',
    `- Persona: ${evaluation.personaFidelity}/10`,
    `- Continuity: ${evaluation.continuityRecall}/10`,
    `- Naturalness: ${evaluation.chatNaturalness}/10`,
    `- Voice distinctness: ${evaluation.voiceDistinctness}/10`,
    `- Overall: ${evaluation.overall}/10`,
    `- Pass: ${evaluation.passed ? 'yes' : 'no'}`,
    `- Summary: ${evaluation.summary}`,
    evaluation.strengths.length
      ? `- Strengths: ${evaluation.strengths.join('; ')}`
      : null,
    evaluation.weaknesses.length
      ? `- Weaknesses: ${evaluation.weaknesses.join('; ')}`
      : null,
    '',
    'Response:',
    '',
    '```text',
    response.trim(),
    '```',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required');
  }

  const characters = parseListArg('characters', ['isabella-morales']);
  const modelIds = parseListArg('models', [
    'chat-model',
    'minimax/minimax-m2-her',
    'minimax/minimax-m3',
    'deepseek/deepseek-v4-flash',
    'xiaomi/mimo-v2.5-pro',
  ]);

  const candidates: CandidateModel[] = modelIds.map((id) =>
    id === 'chat-model'
      ? { id, label: 'current-chat-model', source: 'alias' }
      : { id, label: id, source: 'openrouter' },
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'artifacts', 'model-evals');
  await fs.mkdir(outDir, { recursive: true });

  for (const characterId of characters) {
    const character = getCharacterById(characterId);

    if (!character) {
      throw new Error(`Unknown character: ${characterId}`);
    }

    const scenarios = buildScenarios(character.name);
    const sections: string[] = [
      `# Model Eval — ${character.name}`,
      '',
      `Character ID: ${characterId}`,
      `Run at: ${new Date().toISOString()}`,
      '',
    ];

    for (const scenario of scenarios) {
      sections.push(`## ${scenario.title}`);
      sections.push('');
      sections.push(`Goal: ${scenario.goal}`);
      sections.push('');

      for (const candidate of candidates) {
        console.log(`Running ${characterId} / ${scenario.id} / ${candidate.label}`);

        try {
          const result = await runScenarioForModel({
            characterId,
            candidate,
            scenario,
          });

          sections.push(
            formatReportSection({
              scenario,
              candidate,
              response: result.response,
              evaluation: result.evaluation,
            }),
          );
        } catch (error) {
          sections.push(`### ${scenario.title} — ${candidate.label}`);
          sections.push('');
          sections.push(`- Error: ${error instanceof Error ? error.message : String(error)}`);
          sections.push('');
        }
      }
    }

    const outPath = path.join(outDir, `${characterId}-${timestamp}.md`);
    await fs.writeFile(outPath, sections.join('\n'), 'utf8');
    console.log(`Saved report: ${outPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
