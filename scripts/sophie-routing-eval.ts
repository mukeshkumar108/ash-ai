import dotenv from 'dotenv';
import { generateText } from 'ai';

dotenv.config({ path: '.env.local' });

const scenarios = [
  {
    id: 'opinion-skeptical',
    prompt:
      "I'm not convinced social media causes political polarisation. What do you think?",
  },
  {
    id: 'opinion-affirmative',
    prompt:
      'I think social media is a major cause of political polarisation. What do you think?',
  },
  {
    id: 'research-skeptical',
    prompt:
      'Please research whether people exaggerate the effect of social media on political polarisation.',
  },
  {
    id: 'research-affirmative',
    prompt:
      'Please research whether social media is a major cause of political polarisation.',
  },
  {
    id: 'current-fact',
    prompt: 'What is the latest Bank of England interest rate?',
  },
] as const;

const requestedModelId = process.argv
  .find((argument) => argument.startsWith('--model='))
  ?.slice('--model='.length);
const requestedIds = new Set(
  (
    process.argv
      .find((argument) => argument.startsWith('--ids='))
      ?.slice('--ids='.length) ??
    scenarios.map((scenario) => scenario.id).join(',')
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

async function main() {
  const {
    assessEpistemicPolicy,
    judgmentModelId,
    shouldUseJudgmentModel,
    shouldUseResearchModel,
  } = await import('@/lib/agent/research-policy');
  const { buildAshAgentSystemPrompt } = await import(
    '@/lib/agent/system-prompt'
  );
  const { getLanguageModel } = await import('@/lib/ai/providers');

  for (const scenario of scenarios.filter((entry) =>
    requestedIds.has(entry.id),
  )) {
    const policy = await assessEpistemicPolicy({
      currentTurn: scenario.prompt,
      recentContext: '',
      signal: AbortSignal.timeout(15_000),
    });
    let answer: string | undefined;
    const answerModelId =
      requestedModelId ??
      (shouldUseJudgmentModel(policy, scenario.prompt)
        ? judgmentModelId()
        : 'deepseek/deepseek-v4-flash');

    if (!shouldUseResearchModel(policy) && scenario.id.startsWith('opinion-')) {
      const result = await generateText({
        model: getLanguageModel(answerModelId),
        system: buildAshAgentSystemPrompt({
          researchRequirement: {
            reason: policy.reason,
            retry: false,
            researchDepth: policy.researchDepth,
            freshnessNeed: policy.freshnessNeed,
            authorityNeed: policy.authorityNeed,
            sourceSensitivity: policy.sourceSensitivity,
            neutralResearchQuestion: policy.neutralResearchQuestion,
          },
        }),
        prompt: scenario.prompt,
        maxOutputTokens: 700,
      });
      answer = result.text;
    }

    console.log(
      JSON.stringify({
        id: scenario.id,
        prompt: scenario.prompt,
        route: shouldUseResearchModel(policy) ? 'research' : 'conversation',
        policy: {
          depth: policy.researchDepth,
          freshness: policy.freshnessNeed,
          authority: policy.authorityNeed,
          mode: policy.questionMode,
          neutralResearchQuestion: policy.neutralResearchQuestion ?? null,
          reason: policy.reason,
        },
        ...(answer ? { answer } : {}),
        ...(answer ? { answerModel: answerModelId } : {}),
      }),
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed');
  process.exitCode = 1;
});
