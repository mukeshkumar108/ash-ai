import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '../llm-agent-test/.env.local' });

async function main() {
  const { evaluateInitiative } = await import(
    '@/lib/ai/relationship/evaluator'
  );
  const ownedObject = {
    id: 'bats_after_dark',
    kind: 'curiosity',
    summary: 'whether the bats stayed after the field became fully dark',
    reasonToReturn: 'Sophie genuinely wanted to know how the scene changed',
    status: 'open',
  };
  const decision = await evaluateInitiative({
    trigger: 'second_thought',
    recentConversation:
      'user: The deer have gone but the bats are still circling.\nassistant: The bats are the night shift arriving early. I want to know whether they stay once the field goes fully dark.',
    memoryEvidence: null,
    recentTopicKeys: [],
    localTime: new Date().toISOString(),
    ownedObject,
    situation: {
      now: new Date().toISOString(),
      timezone: 'Europe/London',
      localDate: new Date().toISOString().slice(0, 10),
      localTime: new Date().toISOString().slice(11, 16),
      weekday: 'Saturday',
      hour: 21,
      daypart: 'evening',
      elapsedSinceLastInteractionMinutes: 18,
      lastUserMessageAt: new Date(Date.now() - 19 * 60_000).toISOString(),
      elapsedSinceLastUserMessageMinutes: 19,
      firstInteractionToday: false,
      interactionsToday: 7,
      todaysConversation:
        'The user was walking at dusk and sharing the bats and deer in real time.',
      trustedFacts: null,
    },
    signal: AbortSignal.timeout(30_000),
  });
  console.log(JSON.stringify({ ownedObject, decision }, null, 2));
  if (!decision.act || decision.beatAssessment.proposedBeat.addsNewValue !== true) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
