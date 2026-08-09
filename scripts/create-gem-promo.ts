import { createHash } from 'node:crypto';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.local' });

const [code, gemsArg, maxArg, ...labelParts] = process.argv.slice(2);
const gems = Number(gemsArg);
const maxRedemptions = maxArg ? Number(maxArg) : null;
if (
  !code ||
  !Number.isInteger(gems) ||
  gems < 1 ||
  (maxRedemptions !== null &&
    (!Number.isInteger(maxRedemptions) || maxRedemptions < 1))
) {
  throw new Error('Usage: pnpm gems:promo CODE GEMS [MAX_REDEMPTIONS] [LABEL]');
}
const databaseUrl = process.env.BK_POSTGRES_URL || process.env.POSTGRES_URL;
if (!databaseUrl)
  throw new Error('BK_POSTGRES_URL or POSTGRES_URL is required');
const codeHash = createHash('sha256')
  .update(code.trim().toUpperCase().replace(/\s+/g, ''))
  .digest('hex');
const sql = postgres(databaseUrl, { max: 1 });
try {
  await sql`
    INSERT INTO "GemPromoCode" ("codeHash", "label", "gems", "maxRedemptions")
    VALUES (${codeHash}, ${labelParts.join(' ') || 'Gift code'}, ${gems}, ${maxRedemptions})
  `;
  console.log(
    `Created a ${gems}-gem promo with ${maxRedemptions ?? 'unlimited'} redemptions.`,
  );
} finally {
  await sql.end();
}
