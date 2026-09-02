/* eslint-disable no-console */
/**
 * END-TO-END: starts from the normal production message path, not a seeded
 * opportunity. Mirrors exactly what app/(chat)/api/chat/route.ts does after an
 * ordinary Sophie reply:
 *   1. a real user message + Sophie assistant message are persisted
 *   2. initiativeOpportunityForRuntimeOutcome(execution_metadata, createdAt)
 *      + scheduleInitiativeOpportunity(...) create the durable opportunity
 *   3. the deterministic cron sweep drives arm -> first -> final -> closed
 *
 * provider_call_count must be 0 for the whole chain: no OpenRouter, no provider
 * fetch, no cortex. A global fetch interceptor fails the test on any model URL.
 *
 * Run: BK_POSTGRES_URL=postgresql://postgres:test@localhost:5439/test
 *      npx tsx tests/db/active-followup.e2e.test.ts
 */
import postgres from 'postgres';

const url = process.env.BK_POSTGRES_URL ?? process.env.POSTGRES_URL;
if (!url) throw new Error('BK_POSTGRES_URL required');

let pass = 0;
let fail = 0;
function ok(cond: unknown, name: string) {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}`);
  }
}

// ── LLM provider interceptor: any model/provider fetch fails the test ───────
const PROVIDER_MARKERS = [
  'openrouter.ai',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'nano-gpt.com',
  'api.venice.ai',
  '/chat/completions',
];
let providerCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = String(input);
  const hitsProvider = PROVIDER_MARKERS.some((m) => raw.includes(m));
  if (hitsProvider) {
    providerCalls += 1;
    console.error(`  ✗ provider fetch attempted: ${raw.slice(0, 120)}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

const sql = postgres(url, { max: 10 });

async function run() {
  console.log(
    '== E2E: ordinary Sophie reply -> production opportunity -> deterministic follow-up (provider_count=0) ==\n',
  );

  // 1) A real conversation: user message then Sophie assistant message, using
  //    the same tables/columns the chat route writes via its canonical insert.
  const [userRow] = await sql`
    INSERT INTO "User" (email) VALUES ('e2e@example.com') RETURNING id
  `;
  const [chatRow] = await sql`
    INSERT INTO "Chat" (id, "createdAt", "userId", title)
    VALUES (gen_random_uuid(), now(), ${userRow.id}, 'E2E chat') RETURNING id
  `;
  const userCreatedAt = new Date(Date.now() - 3 * 60_000);
  const [userMsg] = await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${chatRow.id}, 'user',
      '[{"type":"text","text":"hey, are you free this evening?"}]'::json, '[]'::json, ${userCreatedAt})
    RETURNING id
  `;
  const assistantCreatedAt = new Date(Date.now() - 2 * 60_000);
  const [assistantMsg] = await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${chatRow.id}, 'assistant',
      '[{"type":"text","text":"yeah I\u2019m around! what\u2019s on your mind?"}]'::json, '[]'::json, ${assistantCreatedAt})
    RETURNING id
  `;
  ok(
    Boolean(userMsg.id) && Boolean(assistantMsg.id),
    'real user + Sophie assistant messages persisted',
  );

  // 2) THE PRODUCTION SEAM: exactly what the live chat route runs after every
  //    assistant reply (route.ts:289-302). execution_metadata is the ordinary
  //    reply shape: director_plan present, no concrete owned object.
  const { initiativeOpportunityForRuntimeOutcome } = await import(
    '../../lib/ai/relationship/policy'
  );
  const { scheduleInitiativeOpportunity } = await import(
    '../../lib/ai/relationship/store'
  );
  const executionMetadata = {
    director_plan: {
      intent: 'social',
      primaryAct: 'respond',
      contribution: 'offering availability for the evening',
      objective: 'answer and offer availability',
      initiativeEligible: false,
    },
    executed_outcome: {
      executedAct: 'respond',
      objectActionExecuted: 'none',
      ownedObject: null,
    },
  };
  const opportunity = initiativeOpportunityForRuntimeOutcome(
    executionMetadata,
    assistantCreatedAt,
  );
  ok(
    opportunity.trigger === 'active_idle',
    `opportunity trigger is active_idle (got ${opportunity.trigger})`,
  );
  await scheduleInitiativeOpportunity({
    userId: userRow.id,
    chatId: chatRow.id,
    anchorMessageId: assistantMsg.id,
    trigger: opportunity.trigger,
    notBefore: opportunity.notBefore,
    context: opportunity.context,
  });

  const [opp] = await sql`
    SELECT id, trigger, status, "anchorMessageId",
      extract(epoch from "notBefore")*1000 AS "nbMs"
    FROM "RelationshipOpportunity"
    WHERE "anchorMessageId" = ${assistantMsg.id}
  `;
  ok(Boolean(opp), 'production code created a RelationshipOpportunity row');
  ok(
    opp?.trigger === 'active_idle' && opp?.status === 'scheduled',
    'opportunity is a scheduled active_idle',
  );
  ok(
    // notBefore = assistantCreatedAt + idleMs (5 min default).
    Math.abs(Number(opp?.nbMs) - (assistantCreatedAt.getTime() + 5 * 60_000)) <
      30_000,
    'opportunity notBefore is assistant reply + idleMs (5 min)',
  );

  // 3) No user reply. Run the deterministic cron sweep over the lifecycle with
  //    realistic 1-minute ticks (the production cron cadence), so the whole
  //    chain fits inside the 15-minute finite active window.
const mod = (await import('../../lib/ai/relationship/followup')) as unknown as {
    sweepActiveConversationFollowups: (
      input: Record<string, unknown>,
    ) => Promise<Record<string, number>>;
  };
  const sweep = mod.sweepActiveConversationFollowups;
  const rand = () => 0; // deterministic: first = anchor+2m, final = first+3m

  // Tick before idle window elapses (notBefore in future): nothing.
  const preIdle = new Date(assistantCreatedAt.getTime() + 1 * 60_000);
  const s0 = await sweep({ now: preIdle, random: rand, timeZone: 'UTC' });
  ok(
    s0.windows === 0 && s0.sentFirst === 0 && s0.sentFinal === 0,
    'tick before idle window: no-op (no arm, no send)',
  );

  // Tick after idle window (notBefore = anchor+5m passed): arm once.
  const armTick = new Date(assistantCreatedAt.getTime() + 6 * 60_000);
  const s1 = await sweep({ now: armTick, random: rand, timeZone: 'UTC' });
  ok(
    s1.windows === 1 && s1.sentFirst === 0 && s1.sentFinal === 0,
    'tick after idle window arms exactly one window (no send yet)',
  );

  const [armedOpp] = await sql`
    SELECT "followupDueAt" IS NOT NULL AS armed, "finalDueAt" IS NOT NULL AS finalarmed
    FROM "RelationshipOpportunity" WHERE "anchorMessageId" = ${assistantMsg.id}
  `;
  ok(
    armedOpp.armed && armedOpp.finalarmed,
    'randomized due timestamps persisted once',
  );

  // Now tick minute-by-minute. expected with rand()=0:
  //   followupDueAt = anchor + 2m (already past at the 6m arm tick)
  //   finalDueAt    = followupDueAt + 3m = anchor + 5m
  // With 1-minute ticks after the 6m arm tick, the 7m tick sends first and the
  // 8m tick sends final — all comfortably inside the 15m finite window.
  const t7 = new Date(assistantCreatedAt.getTime() + 7 * 60_000);
  const sFirst = await sweep({ now: t7, random: rand, timeZone: 'UTC' });
  ok(
    sFirst.sentFirst === 1 && sFirst.sentFinal === 0,
    '7m tick sends exactly one first follow-up phrase',
  );

  const t8 = new Date(assistantCreatedAt.getTime() + 8 * 60_000);
  const sFinal = await sweep({ now: t8, random: rand, timeZone: 'UTC' });
  ok(sFinal.sentFinal === 1, '8m tick sends exactly one final-close phrase');

  const [closedOpp] = await sql`
    SELECT status, "closedAt" IS NOT NULL AS closed FROM "RelationshipOpportunity"
    WHERE "anchorMessageId" = ${assistantMsg.id}
  `;
  ok(
    closedOpp.status === 'closed' && closedOpp.closed,
    'opportunity window closed',
  );

  // 1000 subsequent cron ticks must do nothing after close.
  const terminalTick = new Date(assistantCreatedAt.getTime() + 3_600_000);
  const later = { windows: 0, sentFirst: 0, sentFinal: 0, cancelled: 0 };
  for (let i = 0; i < 1000; i += 1) {
    const s = await sweep({ now: terminalTick, random: rand, timeZone: 'UTC' });
    later.windows += s.windows;
    later.sentFirst += s.sentFirst;
    later.sentFinal += s.sentFinal;
    later.cancelled += s.cancelled;
  }
  ok(
    later.sentFirst === 0 && later.sentFinal === 0,
    '1000 post-close ticks send nothing',
  );

  const sentRows = await sql`
    SELECT trigger, "topicKey", status FROM "RelationshipInitiative" WHERE "chatId" = ${chatRow.id}
  `;
  ok(
    sentRows.length === 2,
    'two deterministic follow-up ledger rows (first + final)',
  );
  ok(
    sentRows.every(
      (r: any) => r.trigger === 'active_idle' && r.status === 'sent',
    ),
    'both are active_idle sent ledger rows',
  );

  const messages = await sql`
    SELECT parts::text AS parts FROM "Message_v2" WHERE "chatId" = ${chatRow.id} ORDER BY "createdAt"
  `;
  const texts = messages.map((r: any) =>
    JSON.parse(r.parts)
      .map((p: any) => p.text)
      .join(' '),
  );
  // user message + Sophie anchor + follow-up #1 + final close = 4 rows.
  ok(
    texts.length === 4,
    `exactly user + anchor + first + final messages (${texts.length})`,
  );
  ok(texts[1].includes('what'), 'anchor is the original Sophie reply');
  type PhraseModule = typeof import('../../lib/ai/relationship/followup-phrases');
  const banks = (await import(
    '../../lib/ai/relationship/followup-phrases',
  )) as unknown as PhraseModule;
  ok(
    (banks.ACTIVE_FOLLOWUP_PHRASES as readonly string[]).includes(texts[2]) ||
      (banks.ACTIVE_FOLLOWUP_PHRASES as readonly string[]).some(
        (p) => p === texts[2],
      ),
    `first phrase is from the follow-up bank (${texts[2]})`,
  );
  ok(
    (banks.ACTIVE_FINAL_CLOSE_PHRASES as readonly string[]).includes(
      texts[3],
    ) ||
      (banks.NIGHT_FINAL_CLOSE_PHRASES as readonly string[]).includes(texts[3]),
    `final phrase is from a close bank (${texts[3]})`,
  );

  // 4) The zero-provider guarantee for the WHOLE chain.
  ok(providerCalls === 0, `provider_call_count = 0 (was ${providerCalls})`);

  await sql.end();
  globalThis.fetch = realFetch;
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(`provider_call_count = ${providerCalls}`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  globalThis.fetch = realFetch;
  console.error(e);
  process.exit(2);
});
