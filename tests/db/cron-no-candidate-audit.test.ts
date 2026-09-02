/* eslint-disable no-console */
/**
 * READ-ONLY AUDIT PROBE: when there are NO non-active-idle opportunities due,
 * does /api/cron/relationship-initiative (i.e. runServerInitiativeScan) reach
 * any model provider / OpenRouter?
 *
 * Seeds only an active conversation that has already *closed* its follow-up
 * window (no candidate should be due), plus a stale chat with no opportunity.
 * Wraps global fetch to count any provider/model endpoint hit. Runs the real
 * runServerInitiativeScan cron handler.
 *
 * Run: BK_POSTGRES_URL=postgresql://postgres:test@localhost:5439/test
 *      npx tsx tests/db/cron-no-candidate-audit.test.ts
 */
import postgres from 'postgres';

const url = process.env.BK_POSTGRES_URL ?? process.env.POSTGRES_URL;
if (!url) throw new Error('BK_POSTGRES_URL required');

let pass = 0;
let fail = 0;
function ok(cond: unknown, name: string) {
  if (cond) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.error(`FAIL  ${name}`); }
}

const PROVIDER_MARKERS = [
  'openrouter.ai', 'api.openai.com', 'generativelanguage.googleapis.com',
  'nano-gpt.com', 'api.venice.ai', '/chat/completions',
];
let providerCalls = 0;
const modelUrls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = String(input);
  if (PROVIDER_MARKERS.some((m) => raw.includes(m))) {
    providerCalls += 1;
    modelUrls.push(raw.slice(0, 150));
  }
  return realFetch(input, init);
}) as typeof fetch;

const sql = postgres(url, { max: 10 });

async function run() {
  console.log('== AUDIT: no due non-active-idle opportunities -> provider_call_count ==\n');

  // Seed two users/chats that must NOT produce any model candidate:
  // 1) a conversation whose active_idle window already fully closed,
  // 2) a stale assistant-last chat with no opportunity at all.
  const [u1] = await sql`
    INSERT INTO "User" (email) VALUES ('noop1@example.com') RETURNING id
  `;
  const [c1] = await sql`
    INSERT INTO "Chat" (id, "createdAt", "userId", title)
    VALUES (gen_random_uuid(), now(), ${u1.id}, 'closed window chat') RETURNING id
  `;
  const userAt = new Date(Date.now() - 60 * 60_000);
  const anchorAt = new Date(Date.now() - 59 * 60_000);
  await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${c1.id}, 'user',
      '[{"type":"text","text":"hey are you free?"}]'::json, '[]'::json, ${userAt})
  `;
  const [anchor] = await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${c1.id}, 'assistant',
      '[{"type":"text","text":"yeah im around what on your mind?"}]'::json, '[]'::json, ${anchorAt})
    RETURNING id
  `;
  const nb = new Date(anchorAt.getTime() + 5 * 60_000);
  await sql`
    INSERT INTO "RelationshipOpportunity"
      ("userId", "chatId", "anchorMessageId", trigger, status, "notBefore", "createdAt")
    VALUES (${u1.id}, ${c1.id}, ${anchor.id}, 'active_idle', 'cancelled', ${nb}, ${anchorAt})
  `;

  const [u2] = await sql`
    INSERT INTO "User" (email) VALUES ('noop2@example.com') RETURNING id
  `;
  const [c2] = await sql`
    INSERT INTO "Chat" (id, "createdAt", "userId", title)
    VALUES (gen_random_uuid(), now(), ${u2.id}, 'stale chat') RETURNING id
  `;
  const staleAt = new Date(Date.now() - 6 * 60 * 60_000);
  await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${c2.id}, 'user',
      '[{"type":"text","text":"ok thanks!"}]'::json, '[]'::json, ${staleAt})
  `;
  const ancientTime = new Date(staleAt.getTime() + 60_000);
  await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${c2.id}, 'assistant',
      '[{"type":"text","text":"anytime!"}]'::json, '[]'::json, ${ancientTime})
  `;

  // Preconditions: no scheduled active_idle, no second_thought, no task
  // reminder, no calendar followup in the window.
  const [due] = await sql`
    SELECT count(*)::int AS n FROM "RelationshipOpportunity"
    WHERE status = 'scheduled'
  `;
  const [tasks] = await sql`
    SELECT count(*)::int AS n FROM "TaskReminder" WHERE status = 'scheduled'
  `;
  const [cal] = await sql`
    SELECT count(*)::int AS n FROM "CalendarEventSync"
    WHERE status = 'confirmed' AND "completedAt" IS NOT NULL
  `;
  ok(due.n === 0, 'no scheduled RelationshipOpportunity');
  ok(tasks.n === 0, 'no due task reminders (none seeded)');
  ok(cal.n === 0, 'no calendar followups');

  const { runServerInitiativeScan } = (await import(
    '../../lib/ai/relationship/outreach',
  )) as unknown as { runServerInitiativeScan: () => Promise<Record<string, unknown>> };

  const result = (await runServerInitiativeScan()) as {
    enabled?: boolean; scanned?: number; acted?: number;
    deterministic?: { windows: number; sentFirst: number; sentFinal: number; cancelled: number };
  };
  console.log('  cron result:', JSON.stringify(result));
  ok(result.enabled !== false, 'cron enabled');
  ok(Number(result.scanned ?? 0) === 0, `candidate loop scanned nothing (scanned=${result.scanned})`);
  ok(result.acted === 0, 'no proactive delivery');
  ok(
    (result.deterministic?.sentFirst ?? 0) === 0 &&
      (result.deterministic?.sentFinal ?? 0) === 0 &&
      (result.deterministic?.windows ?? 0) === 0,
    'deterministic sweep did nothing (closed/cancelled window not re-armed)',
  );

  ok(providerCalls === 0, `provider_call_count = 0 (was ${providerCalls})`);
  if (modelUrls.length) console.log('  model urls hit:', modelUrls);

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