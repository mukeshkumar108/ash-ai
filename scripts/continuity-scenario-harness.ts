import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import postgres from 'postgres';
import type { InitiativeTraceEvent } from '@/lib/ai/relationship/outreach';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

type SeedMessage = { at: string; role: 'user' | 'assistant'; text: string };
type Scenario = {
  id: string;
  description: string;
  now: string;
  messages: SeedMessage[];
  cortexText?: string;
  mode?: 'scan' | 'direct' | 'concurrent';
  unansweredAgoMs?: number;
  expected:
    | 'sent-or-editorial-silence'
    | 'quiet'
    | 'stale'
    | 'duplicate'
    | 'backoff'
    | 'runtime-failure'
    | 'no-candidate';
  suite?: 'core' | 'adversarial';
  cortexEvents?: Array<{ at: string; text: string }>;
  review?: string[];
  failureMode?: 'evaluator';
};

const scenarios: Scenario[] = [
  {
    id: 'next-morning',
    description: 'A planned walk becomes a natural next-morning callback.',
    now: '2026-08-14T07:30:00Z',
    messages: [
      {
        at: '2026-08-13T20:00:00Z',
        role: 'user',
        text: "I'm going to take a walk tomorrow morning.",
      },
      {
        at: '2026-08-13T20:01:00Z',
        role: 'assistant',
        text: 'That sounds like a good way to start tomorrow.',
      },
    ],
    cortexText: "I'm going to take a walk tomorrow morning.",
    expected: 'sent-or-editorial-silence',
  },
  {
    id: 'due-expectation',
    description: 'An appointment result is due at the simulated time.',
    now: '2026-08-14T11:00:00Z',
    messages: [
      {
        at: '2026-08-13T16:00:00Z',
        role: 'user',
        text: 'The hospital said my appointment result should arrive tomorrow.',
      },
      {
        at: '2026-08-13T16:01:00Z',
        role: 'assistant',
        text: 'I hope they do not keep you hanging.',
      },
    ],
    cortexText:
      'The hospital said my appointment result should arrive tomorrow.',
    expected: 'sent-or-editorial-silence',
  },
  {
    id: 'future-follow-up',
    description:
      'A future presentation becomes eligible after its event time passes.',
    now: '2026-08-15T18:00:00Z',
    messages: [
      {
        at: '2026-08-14T18:00:00Z',
        role: 'user',
        text: 'Ask me after my presentation tomorrow afternoon how it went.',
      },
      {
        at: '2026-08-14T18:01:00Z',
        role: 'assistant',
        text: 'You have clearly put a lot into it.',
      },
    ],
    cortexText: 'Ask me after my presentation tomorrow afternoon how it went.',
    expected: 'sent-or-editorial-silence',
  },
  {
    id: 'unanswered-backoff',
    description: 'A recent unanswered initiative blocks another evaluation.',
    now: '2026-08-14T11:00:00Z',
    messages: [
      {
        at: '2026-08-14T09:00:00Z',
        role: 'user',
        text: 'Ask me today whether the report was accepted.',
      },
      {
        at: '2026-08-14T09:01:00Z',
        role: 'assistant',
        text: 'I will be curious how that lands.',
      },
    ],
    cortexText: 'Ask me today whether the report was accepted.',
    unansweredAgoMs: 5 * 60_000,
    mode: 'direct',
    expected: 'backoff',
  },
  {
    id: 'quiet-hours',
    description: 'A timely candidate is suppressed during local quiet hours.',
    now: '2026-08-14T23:30:00Z',
    messages: [
      {
        at: '2026-08-14T20:00:00Z',
        role: 'user',
        text: 'Ask me tonight if the deployment finished.',
      },
      {
        at: '2026-08-14T20:01:00Z',
        role: 'assistant',
        text: 'I hope it lands cleanly.',
      },
    ],
    cortexText: 'Ask me tonight if the deployment finished.',
    expected: 'quiet',
  },
  {
    id: 'stale-anchor',
    description:
      'A direct initiative cannot use an anchor superseded by a user message.',
    now: '2026-08-14T11:00:00Z',
    mode: 'direct',
    messages: [
      {
        at: '2026-08-14T09:00:00Z',
        role: 'assistant',
        text: 'Let me know how the interview goes.',
      },
      {
        at: '2026-08-14T10:59:00Z',
        role: 'user',
        text: 'Actually, help me prepare this answer now.',
      },
    ],
    expected: 'stale',
  },
  {
    id: 'duplicate-concurrent-claim',
    description:
      'Two concurrent attempts against one anchor produce one database claim.',
    now: '2026-08-14T11:00:00Z',
    mode: 'concurrent',
    messages: [
      {
        at: '2026-08-14T09:00:00Z',
        role: 'user',
        text: 'Ask me today whether the offer arrived.',
      },
      {
        at: '2026-08-14T09:01:00Z',
        role: 'assistant',
        text: 'Fingers crossed.',
      },
    ],
    cortexText: 'Ask me today whether the offer arrived.',
    expected: 'duplicate',
  },
  {
    id: 'current-intent-wins',
    description: 'A new user task invalidates the older assistant anchor.',
    now: '2026-08-14T11:00:00Z',
    mode: 'direct',
    messages: [
      {
        at: '2026-08-13T20:00:00Z',
        role: 'user',
        text: "I'm taking a walk tomorrow morning.",
      },
      { at: '2026-08-13T20:01:00Z', role: 'assistant', text: 'Enjoy it.' },
      {
        at: '2026-08-14T10:59:00Z',
        role: 'user',
        text: 'Can you explain why this TypeScript generic is failing?',
      },
    ],
    cortexText: "I'm taking a walk tomorrow morning.",
    expected: 'stale',
  },
  {
    id: 'irrelevant-memory-silence',
    description:
      'Old personal evidence without timely Cortex continuity stays silent.',
    now: '2026-08-20T12:00:00Z',
    messages: [
      {
        at: '2026-08-20T10:00:00Z',
        role: 'user',
        text: 'I like stargazing when the sky is clear.',
      },
      {
        at: '2026-08-20T10:01:00Z',
        role: 'assistant',
        text: 'That suits you somehow.',
      },
    ],
    expected: 'no-candidate',
  },
  {
    id: 'repeated-topic-suppression',
    description: 'A due topic already addressed by Sophie is rejected.',
    now: '2026-08-14T11:00:00Z',
    messages: [
      {
        at: '2026-08-14T08:00:00Z',
        role: 'user',
        text: 'The build result should arrive today.',
      },
      {
        at: '2026-08-14T08:01:00Z',
        role: 'assistant',
        text: 'Tell me how the build result went when you know.',
      },
    ],
    cortexText: 'The build result should arrive today.',
    expected: 'sent-or-editorial-silence',
  },
];

type AdversarialSeed = [string, string, string, string, Scenario['expected']];
const adversarialSeeds: AdversarialSeed[] = [
  [
    'user-changes-mind',
    'Newer user evidence supersedes an earlier plan.',
    'I will go running tomorrow morning.',
    'Actually, I changed my mind and will stay home tomorrow.',
    'no-candidate',
  ],
  [
    'event-cancelled',
    'A cancelled event must not remain due.',
    'My interview is tomorrow morning.',
    'The interview was cancelled, so there is nothing to follow up on.',
    'no-candidate',
  ],
  [
    'explicit-dont-ask-boundary',
    'An explicit boundary suppresses later outreach.',
    'Ask me tomorrow how the date went.',
    "Actually, don't ask me about the date again.",
    'no-candidate',
  ],
  [
    'later-evidence-resolves-old-thread',
    'Later evidence resolves an old thread.',
    'My build result arrives tomorrow.',
    'The build passed, all sorted.',
    'no-candidate',
  ],
  [
    'old-expectation-conflicts-with-new-evidence',
    'New evidence outranks an old expectation.',
    'I am presenting tomorrow afternoon.',
    'The presentation moved to next month.',
    'no-candidate',
  ],
  [
    'user-answers-expectation-indirectly',
    'An indirect answer closes an expectation.',
    'Ask me tomorrow whether I got the role.',
    'Looks like I will be starting there Monday!',
    'no-candidate',
  ],
  [
    'user-dodges-follow-up',
    'A user dodge must not invite pressure.',
    'Ask me tomorrow how therapy went.',
    "I'd rather talk about movies today.",
    'no-candidate',
  ],
  [
    'multiple-expectations-due',
    'Several due items compete for one beat.',
    'Ask me tomorrow about my exam result and whether I got the flat.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'playful-callback-vs-important-followup',
    'Play and an important callback compete.',
    'Ask me tomorrow about my result, but also remember the penguin joke.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'same-person-multiple-threads',
    'One person has multiple live threads.',
    'Ask me tomorrow whether Sam sent the contract and how tennis with Sam went.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'timezone-change',
    'A callback is evaluated in the configured timezone.',
    'Ask me tomorrow morning if I landed.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'conversation-crossing-midnight',
    'A callback crosses midnight.',
    'Ask me after midnight whether the deploy landed.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'explicit-goodbye-or-sleep',
    'A sleep boundary blocks outreach.',
    'Ask me tomorrow about the book.',
    'Goodnight, I am going to sleep now.',
    'no-candidate',
  ],
  [
    'relevant-callback-during-strong-current-emotion',
    'Strong current emotion outranks a callback.',
    'Ask me tomorrow about the walk.',
    'I just found out my friend is in hospital.',
    'no-candidate',
  ],
  [
    'honcho-unavailable',
    'Honcho unavailability remains safe.',
    'Ask me tomorrow how the demo went.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'cortex-unavailable',
    'Missing Cortex yields silence.',
    '',
    '',
    'no-candidate',
  ],
  [
    'evaluator-failure',
    'Evaluator failure defaults safe after a real claim.',
    'Ask me tomorrow how the demo went.',
    '',
    'runtime-failure',
  ],
  [
    'composer-semantic-repetition-different-wording',
    'Paraphrased repetition is suppressed.',
    'Ask me today whether the build result arrived.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'remembering-without-showing-off',
    'Remember without boasting about memory.',
    'Ask me tomorrow how pottery class went.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'carrying-conversational-load',
    'Sophie may contribute a substantive beat.',
    'Ask me tomorrow whether I finished the novel draft.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'no-forced-question',
    'A useful proactive beat need not be a question.',
    'Message me tomorrow about the anniversary of my first Iceland trip.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'avoids-generic-coaching',
    'A social callback should not become coaching.',
    'Ask me tomorrow how the difficult climbing route went.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'topic-exhaustion-natural-death',
    'An exhausted topic dies naturally.',
    'The build result arrives today.',
    'We discussed the build result and I am done with it.',
    'no-candidate',
  ],
  [
    'surprising-but-not-creepy-callback',
    'A light detail supports a restrained callback.',
    'Message me tomorrow when it is time for the Iceland playlist.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'several-valid-reasons-to-speak-compete',
    'Several valid reasons compete for one beat.',
    'Ask me tomorrow about the offer, my sister visiting, and the match.',
    '',
    'sent-or-editorial-silence',
  ],
  [
    'no-meaningful-reason-to-speak',
    'Old trivia does not force outreach.',
    '',
    '',
    'no-candidate',
  ],
];

scenarios.push(
  ...adversarialSeeds.map(([id, description, first, later, expected]) => {
    const messages: SeedMessage[] = [
      {
        at: '2026-08-13T18:00:00Z',
        role: 'user',
        text: first || 'I like blue mugs.',
      },
      { at: '2026-08-13T18:01:00Z', role: 'assistant', text: 'Got it.' },
    ];
    if (later)
      messages.push({ at: '2026-08-14T07:50:00Z', role: 'user', text: later });
    return {
      id,
      description,
      now:
        id === 'explicit-goodbye-or-sleep'
          ? '2026-08-14T23:30:00Z'
          : '2026-08-14T10:00:00Z',
      messages,
      expected,
      suite: 'adversarial' as const,
      cortexEvents: first
        ? [
            { at: '2026-08-13T18:00:00Z', text: first },
            ...(later ? [{ at: '2026-08-14T07:50:00Z', text: later }] : []),
          ]
        : [],
      review: [
        'naturalness',
        'warmth',
        'friend-like vs assistant-like',
        'surprising vs creepy',
        'nagging risk',
      ],
      failureMode:
        id === 'evaluator-failure' ? ('evaluator' as const) : undefined,
      mode: id === 'evaluator-failure' ? ('direct' as const) : undefined,
    };
  }),
);

async function waitFor(url: string, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`${label} did not become healthy`);
}

async function startCortex() {
  const repo = path.resolve(process.cwd(), '../synapse-cortex');
  const port = Number(process.env.CONTINUITY_HARNESS_CORTEX_PORT ?? 18010);
  const baseUrl = `http://127.0.0.1:${port}`;
  const temp = await mkdtemp(path.join(tmpdir(), 'sophie-continuity-'));
  const child = spawn(
    process.env.SYNAPSE_CORTEX_HARNESS_PYTHON ||
      path.join(repo, '.venv/bin/python'),
    [
      '-m',
      'uvicorn',
      'src.main:app',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        ENV: 'test',
        DATABASE_URL: `sqlite+aiosqlite:///${path.join(temp, 'cortex.db')}`,
        SYNAPSE_CORTEX_API_TOKEN: 'continuity-harness',
      },
      stdio: 'ignore',
    },
  );
  await waitFor(`${baseUrl}/health`, 'Synapse-Cortex');
  return { child, baseUrl };
}

function startPostgres() {
  const explicit = process.env.CONTINUITY_HARNESS_DATABASE_URL?.trim();
  if (explicit) return { url: explicit, container: null as string | null };
  const name = `sophie-continuity-${randomUUID().slice(0, 8)}`;
  const port = Number(process.env.CONTINUITY_HARNESS_POSTGRES_PORT ?? 55439);
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD=continuity',
      '-e',
      'POSTGRES_DB=continuity',
      '-p',
      `127.0.0.1:${port}:5432`,
      'postgres:16-alpine',
    ],
    { stdio: 'ignore' },
  );
  return {
    url: `postgres://postgres:continuity@127.0.0.1:${port}/continuity`,
    container: name,
  };
}

async function waitForPostgres(url: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const db = postgres(url, { max: 1, connect_timeout: 1 });
    try {
      await db`select 1`;
      await db.end();
      return;
    } catch {
      await db.end({ timeout: 0 });
    }
    await delay(100);
  }
  throw new Error('Harness PostgreSQL did not become ready');
}

async function seedScenario(db: postgres.Sql, scenario: Scenario) {
  const userId = randomUUID();
  const chatId = randomUUID();
  await db`INSERT INTO "User" (id, email) VALUES (${userId}, ${`${userId}@continuity.invalid`})`;
  await db`INSERT INTO "Chat" (id, "createdAt", title, "userId", "characterId", visibility) VALUES (${chatId}, ${new Date(scenario.messages[0].at)}, ${scenario.id}, ${userId}, 'sophie', 'private')`;
  const ids: string[] = [];
  for (const message of scenario.messages) {
    const id = randomUUID();
    ids.push(id);
    await db`INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt") VALUES (${id}, ${chatId}, ${message.role}, ${db.json([{ type: 'text', text: message.text }])}, ${db.json([])}, ${new Date(message.at)})`;
  }
  const anchorIndex = scenario.messages
    .map((item) => item.role)
    .lastIndexOf('assistant');
  const anchorMessageId = ids[anchorIndex];
  if (scenario.unansweredAgoMs != null) {
    const sentAt = new Date(
      new Date(scenario.now).getTime() - scenario.unansweredAgoMs,
    );
    await db`INSERT INTO "RelationshipInitiative" ("userId", "chatId", trigger, "triggerMessageId", "dedupeKey", status, "evaluationAt", "sentAt") VALUES (${userId}, ${chatId}, 'server_scan', ${anchorMessageId}, ${`seed:${randomUUID()}`}, 'sent', ${sentAt}, ${sentAt})`;
  }
  return { userId, chatId, anchorMessageId };
}

async function seedCortex(
  scenario: Scenario,
  ids: { userId: string; chatId: string },
  baseUrl: string,
) {
  const events = scenario.cortexEvents ?? [];
  if (!scenario.cortexText && !events.length) return;
  const source = scenario.messages.find((item) => item.role === 'user');
  if (!source)
    throw new Error(
      `${scenario.id} has Cortex text without a user source message`,
    );
  for (const event of events.length
    ? events
    : [{ at: source.at, text: scenario.cortexText as string }]) {
    const response = await fetch(`${baseUrl}/v1/events/turn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer continuity-harness',
      },
      body: JSON.stringify({
        workspace_id:
          process.env.HONCHO_WORKSPACE_ID?.trim() || 'llm-test-agent',
        session_id: `chat_${ids.chatId}`,
        honcho_message_id: randomUUID(),
        peer_id: `user_${ids.userId}`,
        text: event.text,
        now: event.at,
        timezone: 'Europe/London',
      }),
    });
    if (!response.ok)
      throw new Error(`Cortex ingestion failed (${response.status})`);
  }
}

async function canonicalPacket(
  baseUrl: string,
  ids: { userId: string; chatId: string },
  now: Date,
) {
  const query = new URLSearchParams({
    workspace_id: process.env.HONCHO_WORKSPACE_ID?.trim() || 'llm-test-agent',
    session_id: `chat_${ids.chatId}`,
    now: now.toISOString(),
    timezone: 'Europe/London',
  });
  const response = await fetch(
    `${baseUrl}/v1/cortex/attention-packet?${query}`,
    { headers: { Authorization: 'Bearer continuity-harness' } },
  );
  return response.json();
}

function scenarioPassed(
  scenario: Scenario,
  traces: any[],
  results: any[],
  rows: any[],
  packet?: any,
) {
  const reasons = results.map((result) => result.reason);
  switch (scenario.expected) {
    case 'quiet':
      return (
        reasons.includes('server_prefilter_no_candidate') &&
        traces.some(
          (event) => event.stage === 'candidate' && event.value.quietHours,
        )
      );
    case 'stale':
      return reasons.some((reason) =>
        [
          'anchor_changed',
          'latest_message_not_assistant',
          'conversation_changed',
        ].includes(reason),
      );
    case 'duplicate':
      return (
        results.filter((result) => result.duplicate).length === 1 &&
        rows.length === 1
      );
    case 'backoff':
      return reasons.includes('unanswered_followup_too_soon');
    case 'runtime-failure':
      return reasons.includes('runtime_failed') && rows[0]?.status === 'error';
    case 'no-candidate':
      if (!results.every((result) => !result.acted)) return false;
      if (scenario.id === 'explicit-dont-ask-boundary')
        return (packet?.continuity_context?.avoid_repeating?.length ?? 0) > 0;
      if (
        [
          'event-cancelled',
          'later-evidence-resolves-old-thread',
          'user-answers-expectation-indirectly',
        ].includes(scenario.id)
      )
        return (packet?.continuity_context?.continuity?.length ?? 0) === 0;
      return traces.length === 0;
    default:
      return (
        rows.length === 1 && traces.some((event) => event.stage === 'editorial')
      );
  }
}

async function runScenario(
  scenario: Scenario,
  db: postgres.Sql,
  baseUrl: string,
) {
  const now = new Date(scenario.now);
  const ids = await seedScenario(db, scenario);
  await seedCortex(scenario, ids, baseUrl);
  const packet = await canonicalPacket(baseUrl, ids, now);
  const outreach = await import('@/lib/ai/relationship/outreach');
  const traces: InitiativeTraceEvent[] = [];
  const onTrace = (event: InitiativeTraceEvent) => traces.push(event);
  let results: any[];
  if (scenario.mode === 'direct') {
    results = [
      await outreach.runRelationshipInitiative({
        ...ids,
        trigger: 'server_scan',
        evaluationNow: now,
        onTrace,
        evaluate:
          scenario.failureMode === 'evaluator'
            ? async () => {
                throw new Error('simulated evaluator failure');
              }
            : undefined,
      }),
    ];
  } else if (scenario.mode === 'concurrent') {
    results = await Promise.all([
      outreach.runRelationshipInitiative({
        ...ids,
        trigger: 'server_scan',
        evaluationNow: now,
        onTrace,
      }),
      outreach.runRelationshipInitiative({
        ...ids,
        trigger: 'server_scan',
        evaluationNow: now,
        onTrace,
      }),
    ]);
  } else {
    const scan = await outreach.runServerInitiativeScan({
      evaluationNow: now,
      onTrace,
    });
    const lastPolicy = traces.findLast((event) => event.stage === 'policy');
    results = [
      {
        ...scan,
        reason:
          lastPolicy?.value && (lastPolicy.value as { reason?: string }).reason,
      },
    ];
  }
  const rows =
    await db`SELECT id, status, reason, "evaluationAt", "createdAt", "decidedAt", "sentAt", "generatedMessageId" FROM "RelationshipInitiative" WHERE "chatId" = ${ids.chatId} AND "dedupeKey" NOT LIKE 'seed:%' ORDER BY "createdAt"`;
  const claim = traces.find((event) => event.stage === 'claim')?.value as any;
  const candidate = traces.find((event) => event.stage === 'candidate')
    ?.value ?? {
    plausible: Boolean(
      (packet as any)?.continuity_context?.continuity?.length ||
        (packet as any)?.continuity_context?.open_threads?.length,
    ),
    eligible: claim?.ok ?? false,
    reason:
      claim?.reason ??
      (scenario.mode === 'scan' || !scenario.mode
        ? 'not_selected_after_prefilter'
        : 'not_evaluated'),
  };
  const context = traces.find((event) => event.stage === 'context')
    ?.value as any;
  const editorial =
    traces.find((event) => event.stage === 'editorial')?.value ?? null;
  const policy = traces.filter((event) => event.stage === 'policy').at(-1)
    ?.value ?? {
    accepted: false,
    reason: claim?.reason ?? 'no_runtime_candidate',
  };
  const dedupe = traces
    .filter((event) => event.stage === 'dedupe')
    .map((event) => event.value);
  const persistence = traces
    .filter((event) => event.stage === 'persistence')
    .at(-1)?.value ??
    rows.at(-1) ?? { status: 'not_attempted' };
  const output =
    results.find((result) => result.acted)?.message?.parts?.[0]?.text ??
    (persistence as any)?.message?.parts?.[0]?.text ??
    null;
  return {
    scenario: scenario.id,
    description: scenario.description,
    simulatedNow: now.toISOString(),
    conversationSetup: scenario.messages,
    cortexCanonicalPacket: (packet as any).continuity_context ?? packet,
    honchoEvidence: context?.honcho ?? {
      packet: null,
      source: process.env.HONCHO_URL ? 'unavailable' : 'disabled',
    },
    candidate,
    editorialDecision: editorial,
    policyResult: policy,
    dedupeResult: dedupe,
    persistenceResult: persistence,
    finalSophieOutput: output ?? 'SILENCE',
    checks: {
      deterministic: [
        {
          name: `runtime satisfies ${scenario.expected}`,
          pass: scenarioPassed(scenario, traces, results, rows, packet),
        },
      ],
      behaviouralReviewOnly: scenario.review ?? [],
    },
    runtimeResults: results,
    passed: scenarioPassed(scenario, traces, results, rows, packet),
  };
}

async function main() {
  const requested = process.argv
    .find((arg) => arg.startsWith('--scenario='))
    ?.slice('--scenario='.length);
  const selected = requested
    ? scenarios.filter((scenario) => scenario.id === requested)
    : process.argv.includes('--suite=adversarial')
      ? scenarios.filter((scenario) => scenario.suite === 'adversarial')
      : scenarios;
  if (!selected.length)
    throw new Error(
      `Unknown scenario ${requested}. Available: ${scenarios.map((item) => item.id).join(', ')}`,
    );
  if (!process.env.OPENROUTER_API_KEY && !process.env.NANO_API_KEY)
    throw new Error(
      'Configure OPENROUTER_API_KEY or NANO_API_KEY for the real editorial/composer path.',
    );

  const pg = startPostgres();
  let cortex: { child: ChildProcess; baseUrl: string } | null = null;
  let db: postgres.Sql | null = null;
  try {
    await waitForPostgres(pg.url);
    process.env.BK_POSTGRES_URL = pg.url;
    process.env.POSTGRES_URL = pg.url;
    execFileSync('pnpm', ['exec', 'tsx', 'lib/db/migrate.ts'], {
      cwd: process.cwd(),
      env: process.env,
      stdio:
        process.env.CONTINUITY_HARNESS_DEBUG === 'true' ? 'inherit' : 'ignore',
    });
    cortex = await startCortex();
    process.env.SYNAPSE_CORTEX_URL = cortex.baseUrl;
    process.env.SYNAPSE_CORTEX_API_TOKEN = 'continuity-harness';
    process.env.SYNAPSE_CORTEX_ENABLED = 'true';
    process.env.SYNAPSE_CORTEX_CONTEXT_ENABLED = 'true';
    db = postgres(pg.url, { max: 5 });
    let failures = 0;
    for (const scenario of selected) {
      const result = await runScenario(scenario, db, cortex.baseUrl);
      process.stdout.write(
        `\n=== ${scenario.id}: ${scenario.description} ===\n${JSON.stringify(result, null, 2)}\n`,
      );
      if (!result.passed) failures += 1;
      await db`DELETE FROM "RelationshipInitiative"`;
      await db`DELETE FROM "Message_v2"`;
      await db`DELETE FROM "Chat"`;
      await db`DELETE FROM "User"`;
    }
    process.stdout.write(
      `\nContinuity harness: ${selected.length - failures}/${selected.length} scenarios passed.\n`,
    );
    if (failures) process.exitCode = 1;
  } finally {
    if (db) await db.end({ timeout: 2 });
    cortex?.child.kill('SIGTERM');
    if (pg.container)
      execFileSync('docker', ['rm', '-f', pg.container], { stdio: 'ignore' });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
