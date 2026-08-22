import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env.local'),
    '/Users/mukeshkumar/play/llm-agent-test/.env.local',
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}
loadEnv();

import postgres from 'postgres';

async function main() {
  const dbUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('No POSTGRES_URL found in env!');
    return;
  }
  const sql = postgres(dbUrl, { max: 2 });
  console.log('=== PRODUCTION DB INITIATIVE INVESTIGATION ===');

  try {
    // 1. Column definitions
    const columns = await sql`
      SELECT column_name, data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'RelationshipInitiative'
      ORDER BY ordinal_position
    `;
    console.log('\n1. Column definitions for RelationshipInitiative:');
    for (const c of columns) {
      console.log(` - ${c.column_name}: ${c.data_type}${c.character_maximum_length ? `(${c.character_maximum_length})` : ''} | Nullable: ${c.is_nullable}`);
    }

    // 2. Total row count
    const [{ count }] = await sql`SELECT count(*)::int FROM "RelationshipInitiative"`;
    console.log(`\n2. Total RelationshipInitiative rows in DB: ${count}`);

    // 3. Inspect recent rows
    const recentRows = await sql`
      SELECT id, status, "candidateKind", "topicKey", reason, "createdAt", "evaluationAt", "decidedAt", "sentAt"
      FROM "RelationshipInitiative"
      ORDER BY "createdAt" DESC
      LIMIT 20
    `;
    console.log('\n3. Recent 20 RelationshipInitiative rows:');
    for (const r of recentRows) {
      const topicType = typeof r.topicKey;
      console.log(` - ID: ${r.id} | Status: ${r.status} | TopicKey Type: ${topicType} | TopicKey: ${JSON.stringify(r.topicKey)} | Reason: ${r.reason?.slice(0, 60)} | Created: ${r.createdAt?.toISOString()}`);
    }

    // 4. Check for non-string topicKey or errors
    const errorRows = await sql`
      SELECT id, status, reason, "topicKey", "createdAt"
      FROM "RelationshipInitiative"
      WHERE status = 'error' OR reason LIKE '%toLowerCase%' OR reason LIKE '%failed%' OR reason LIKE '%error%'
      ORDER BY "createdAt" DESC
      LIMIT 10
    `;
    console.log('\n4. Errors / Runtime Failures in RelationshipInitiative:');
    if (errorRows.length === 0) {
      console.log(' - No error status rows found.');
    } else {
      for (const e of errorRows) {
        console.log(` - ID: ${e.id} | Status: ${e.status} | Reason: ${e.reason} | Created: ${e.createdAt?.toISOString()}`);
      }
    }

    // 5. Inspect RelationshipOpportunity rows
    const [{ oppCount }] = await sql`SELECT count(*)::int FROM "RelationshipOpportunity"`;
    console.log(`\n5. Total RelationshipOpportunity rows in DB: ${oppCount}`);

    const recentOpps = await sql`
      SELECT id, trigger, "notBefore", "claimedAt", "createdAt"
      FROM "RelationshipOpportunity"
      ORDER BY "createdAt" DESC
      LIMIT 10
    `;
    console.log('Recent 10 RelationshipOpportunity rows:');
    for (const o of recentOpps) {
      console.log(` - ID: ${o.id} | Trigger: ${o.trigger} | NotBefore: ${o.notBefore?.toISOString()} | ClaimedAt: ${o.claimedAt?.toISOString()}`);
    }

  } catch (err: any) {
    console.error('DB Query Error:', err);
  } finally {
    await sql.end();
  }
}

main();
