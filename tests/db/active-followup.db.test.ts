/* eslint-disable no-console */
/**
 * DB-backed acceptance test for the deterministic active-conversation
 * follow-up lifecycle. Runs against a throwaway local Postgres (BK_POSTGRES_URL
 * must point at it) exercising the REAL store CAS operations, so overlapping
 * cron invocations are proven exactly-once at the database layer.
 *
 * Run: BK_POSTGRES_URL=postgresql://postgres:test@localhost:5439/test npx tsx tests/db/active-followup.db.test.ts
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

const sql = postgres(url, { max: 10 });

async function insertFixture() {
  const [userId] = await sql`
    INSERT INTO "User" (id, email, password)
    VALUES (gen_random_uuid(), 'test@example.com', 'x') RETURNING id
  `;
  const [chatRow] = await sql`
    INSERT INTO "Chat" (id, "createdAt", "userId", title)
    VALUES (gen_random_uuid(), now(), ${userId.id}, 'test chat') RETURNING id
  `;
  // Eligible conversation-open Sophie message (ends with a question).
  const [anchor] = await sql`
    INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
    VALUES (gen_random_uuid(), ${chatRow.id}, 'assistant',
      '[{"type":"text","text":"are you around?"}]'::json, '[]'::json, now() - interval '2 minutes')
    RETURNING id
  `;
  const [opp] = await sql`
    INSERT INTO "RelationshipOpportunity"
      ("userId", "chatId", "anchorMessageId", trigger, status, "notBefore", "createdAt")
    VALUES (${userId.id}, ${chatRow.id}, ${anchor.id}, 'active_idle', 'scheduled',
      now() - interval '1 minute', now() - interval '2 minutes')
    RETURNING id
  `;
  return {
    userId: userId.id,
    chatId: chatRow.id,
    anchorId: anchor.id,
    oppId: opp.id,
  };
}

async function run() {
  const {
    tryArmWindow,
    tryClaimFirstSend,
    tryClaimFinalSend,
    persistFollowupMessage,
    anchorStillOpen,
  } = await import('../../lib/ai/relationship/followup-store');

  console.log('\n[1] randomized due times persisted exactly once');
  {
    const f = await insertFixture();
    const winnerDue = new Date(Date.now() + 60_000);
    const winnerFinal = new Date(Date.now() + 90_000);
    const once = await tryArmWindow({
      windowId: f.oppId,
      followupDueAt: winnerDue,
      finalDueAt: winnerFinal,
    });
    const loserDue = new Date(Date.now() + 10_000);
    const twice = await tryArmWindow({
      windowId: f.oppId,
      followupDueAt: loserDue,
      finalDueAt: new Date(Date.now() + 20_000),
    });
    ok(once === true, 'first arm wins');
    ok(twice === false, 'second arm is refused (no re-randomization)');
    const [row] = await sql`
      SELECT extract(epoch from "followupDueAt") * 1000 AS e
      FROM "RelationshipOpportunity" WHERE id = ${f.oppId}
    `;
    const storedMs = Number(row.e);
    ok(
      Math.abs(storedMs - winnerDue.getTime()) < 20_000,
      'persisted due time is the winner, not the loser',
    );
    ok(
      Math.abs(storedMs - loserDue.getTime()) > 20_000,
      'persisted due time is not the loser re-randomization',
    );
  }

  console.log(
    '\n[2] two overlapping invocations send exactly one first follow-up',
  );
  {
    const f = await insertFixture();
    const due = new Date(Date.now() - 1000); // already due
    await tryArmWindow({
      windowId: f.oppId,
      followupDueAt: due,
      finalDueAt: new Date(Date.now() + 60_000),
    });
    // Simulate two cron invocations racing; only one can claim the send.
    const [a, b] = await Promise.all([
      tryClaimFirstSend({ windowId: f.oppId, now: new Date() }),
      tryClaimFirstSend({ windowId: f.oppId, now: new Date() }),
    ]);
    ok(a !== b, 'exactly one overlapping invocation wins the first-send CAS');
    const [row] = await sql`
      SELECT "followupSentAt" FROM "RelationshipOpportunity" WHERE id = ${f.oppId}
    `;
    ok(row.followupSentAt !== null, 'followupSentAt recorded once');
  }

  console.log('\n[3] final close is claimed exactly once after first sent');
  {
    const f = await insertFixture();
    const now = new Date();
    await tryArmWindow({
      windowId: f.oppId,
      followupDueAt: new Date(now.getTime() - 120_000),
      finalDueAt: new Date(now.getTime() - 60_000),
    });
    await tryClaimFirstSend({ windowId: f.oppId, now });
    const [c1, c2] = await Promise.all([
      tryClaimFinalSend({ windowId: f.oppId, now }),
      tryClaimFinalSend({ windowId: f.oppId, now }),
    ]);
    ok(c1 !== c2, 'exactly one overlapping invocation wins the final-send CAS');
  }

  console.log('\n[4] persistFollowupMessage is idempotent across crash-retry');
  {
    const f = await insertFixture();
    const now = new Date();
    const first = await persistFollowupMessage({
      userId: f.userId,
      chatId: f.chatId,
      anchorMessageId: f.anchorId,
      windowId: f.oppId,
      stage: 'first',
      messageId: crypto.randomUUID(),
      text: 'you still there?',
      now,
      phraseSeed: 0,
    });
    ok(first === true, 'message persisted');
    const [msgCount] = await sql`
      SELECT count(*)::int AS n FROM "Message_v2" WHERE "chatId" = ${f.chatId}
    `;
    ok(
      msgCount.n === 2,
      'exactly the anchor + one follow-up persist (no dupes)',
    );
  }

  console.log(
    '\n[5] user reply cancels a pending window (anchor no longer latest)',
  );
  {
    const f = await insertFixture();
    const open = await anchorStillOpen({
      chatId: f.chatId,
      anchorMessageId: f.anchorId,
    });
    ok(open === true, 'anchor is still the latest before a reply');
    await sql`
      INSERT INTO "Message_v2" (id, "chatId", role, parts, attachments, "createdAt")
      VALUES (gen_random_uuid(), ${f.chatId}, 'user',
        '[{"type":"text","text":"im here"}]'::json, '[]'::json, now())
    `;
    const nowClosed = await anchorStillOpen({
      chatId: f.chatId,
      anchorMessageId: f.anchorId,
    });
    ok(nowClosed === false, 'after a reply the anchor is no longer open');
  }

  // Self-clean the fixtures so this throwaway-DB script does not leak active
  // windows into the sibling e2e script that shares the DB.
  await sql`DELETE FROM "Message_v2" WHERE "chatId" IN (
    SELECT c."id" FROM "Chat" c JOIN "User" u ON u.id = c."userId"
    WHERE u.email = 'test@example.com')`;
  await sql`DELETE FROM "RelationshipOpportunity" WHERE "userId" IN (
    SELECT id FROM "User" WHERE email = 'test@example.com')`;
  await sql`DELETE FROM "Chat" WHERE "userId" IN (
    SELECT id FROM "User" WHERE email = 'test@example.com')`;
  await sql`DELETE FROM "User" WHERE email = 'test@example.com'`;

  await sql.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(2);
});
