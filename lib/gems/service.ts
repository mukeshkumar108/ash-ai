import 'server-only';

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';

import { getDatabaseUrl } from '@/lib/db/env';
import { calculateDevTopUp, GEM_POLICY, getGemBundle } from './catalog';

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;

function db() {
  if (!client) client = postgres(getDatabaseUrl(), { max: 5 });
  return client;
}

export function normalizePromoCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function hashPromoCode(code: string) {
  return createHash('sha256').update(normalizePromoCode(code)).digest('hex');
}

async function ensureAccount(sql: any, userId: string) {
  const inserted = await sql`
    INSERT INTO "GemAccount" ("userId", "balance")
    VALUES (${userId}, ${GEM_POLICY.initialGrant})
    ON CONFLICT ("userId") DO NOTHING
    RETURNING "userId"
  `;
  if (inserted.length) {
    await sql`
      INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
      VALUES (${userId}, ${GEM_POLICY.initialGrant}, 'initial_grant', ${`initial:${userId}`}, ${sql.json({ source: 'account_creation' })})
      ON CONFLICT ("referenceKey") DO NOTHING
    `;
  }
}

async function applyDevTopUp(sql: any, userId: string, balance: number) {
  const amount = calculateDevTopUp(balance);
  if (!amount) return balance;
  await sql`
    UPDATE "GemAccount"
    SET "balance" = "balance" + ${amount}, "updatedAt" = now()
    WHERE "userId" = ${userId}
  `;
  await sql`
    INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
    VALUES (${userId}, ${amount}, 'dev_top_up', ${`dev:${userId}:${randomUUID()}`}, ${sql.json({ target: GEM_POLICY.devTarget })})
  `;
  return balance + amount;
}

export async function getGemStatus(userId: string, claimDaily = true) {
  return db().begin(async (sql) => {
    await ensureAccount(sql, userId);
    let [account] = await sql`
      SELECT "balance", "dailyGrantCount", "lastDailyGrantOn", "devMode"
      FROM "GemAccount" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const today = new Date().toISOString().slice(0, 10);
    const lastDay = account.lastDailyGrantOn
      ? new Date(account.lastDailyGrantOn).toISOString().slice(0, 10)
      : null;
    if (
      claimDaily &&
      account.dailyGrantCount < GEM_POLICY.dailyGrantDays &&
      lastDay !== today
    ) {
      await sql`
        UPDATE "GemAccount" SET
          "balance" = "balance" + ${GEM_POLICY.dailyGrant},
          "dailyGrantCount" = "dailyGrantCount" + 1,
          "lastDailyGrantOn" = CURRENT_DATE,
          "updatedAt" = now()
        WHERE "userId" = ${userId}
      `;
      await sql`
        INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
        VALUES (${userId}, ${GEM_POLICY.dailyGrant}, 'daily_login', ${`daily:${userId}:${today}`}, ${sql.json({ day: account.dailyGrantCount + 1 })})
        ON CONFLICT ("referenceKey") DO NOTHING
      `;
      account = {
        ...account,
        balance: account.balance + GEM_POLICY.dailyGrant,
        dailyGrantCount: account.dailyGrantCount + 1,
        lastDailyGrantOn: today,
      };
    }
    if (account.devMode) {
      account.balance = await applyDevTopUp(sql, userId, account.balance);
    }
    return {
      balance: Number(account.balance),
      dailyGrantCount: Number(account.dailyGrantCount),
      dailyGrantDays: GEM_POLICY.dailyGrantDays,
      dailyGrantAmount: GEM_POLICY.dailyGrant,
      devMode: Boolean(account.devMode),
      purchasesEnabled: Boolean(
        process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
      ),
    };
  });
}

export async function spendGems(input: {
  userId: string;
  amount: number;
  kind: string;
  referenceKey: string;
  metadata?: Record<string, unknown>;
}) {
  if (!Number.isInteger(input.amount) || input.amount < 1) {
    throw new Error('Gem spend must be a positive integer');
  }
  await getGemStatus(input.userId, true);
  return db().begin(async (sql) => {
    const existing = await sql`
      SELECT "amount" FROM "GemTransaction"
      WHERE "referenceKey" = ${input.referenceKey} AND "userId" = ${input.userId}
    `;
    const [account] = await sql`
      SELECT "balance" FROM "GemAccount" WHERE "userId" = ${input.userId} FOR UPDATE
    `;
    if (existing.length) {
      return {
        ok: true as const,
        balance: Number(account.balance),
        duplicate: true,
      };
    }
    if (Number(account.balance) < input.amount) {
      return {
        ok: false as const,
        balance: Number(account.balance),
        required: input.amount,
      };
    }
    await sql`
      UPDATE "GemAccount" SET "balance" = "balance" - ${input.amount}, "updatedAt" = now()
      WHERE "userId" = ${input.userId}
    `;
    await sql`
      INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
      VALUES (${input.userId}, ${-input.amount}, ${input.kind}, ${input.referenceKey}, ${sql.json((input.metadata ?? {}) as any)})
    `;
    return {
      ok: true as const,
      balance: Number(account.balance) - input.amount,
      duplicate: false,
    };
  });
}

export async function refundGems(input: {
  userId: string;
  amount: number;
  spendReferenceKey: string;
  reason: string;
}) {
  const referenceKey = `refund:${input.spendReferenceKey}`;
  return db().begin(async (sql) => {
    await ensureAccount(sql, input.userId);
    const inserted = await sql`
      INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
      VALUES (${input.userId}, ${input.amount}, 'refund', ${referenceKey}, ${sql.json({ reason: input.reason, spendReferenceKey: input.spendReferenceKey })})
      ON CONFLICT ("referenceKey") DO NOTHING RETURNING "id"
    `;
    if (inserted.length) {
      await sql`
        UPDATE "GemAccount" SET "balance" = "balance" + ${input.amount}, "updatedAt" = now()
        WHERE "userId" = ${input.userId}
      `;
    }
  });
}

export async function redeemPromoCode(userId: string, rawCode: string) {
  const codeHash = hashPromoCode(rawCode);
  return db().begin(async (sql) => {
    await ensureAccount(sql, userId);
    const [promo] = await sql`
      SELECT * FROM "GemPromoCode" WHERE "codeHash" = ${codeHash} FOR UPDATE
    `;
    if (
      !promo ||
      !promo.active ||
      (promo.expiresAt && new Date(promo.expiresAt) <= new Date())
    ) {
      return { ok: false as const, error: 'This code is invalid or expired.' };
    }
    if (
      promo.maxRedemptions !== null &&
      promo.redemptionCount >= promo.maxRedemptions
    ) {
      return {
        ok: false as const,
        error: 'This code has reached its redemption limit.',
      };
    }
    const redeemed = await sql`
      INSERT INTO "GemPromoRedemption" ("promoCodeId", "userId")
      VALUES (${promo.id}, ${userId}) ON CONFLICT DO NOTHING RETURNING "id"
    `;
    if (!redeemed.length)
      return { ok: false as const, error: 'You have already used this code.' };
    await sql`UPDATE "GemPromoCode" SET "redemptionCount" = "redemptionCount" + 1 WHERE "id" = ${promo.id}`;
    await sql`UPDATE "GemAccount" SET "balance" = "balance" + ${promo.gems}, "updatedAt" = now() WHERE "userId" = ${userId}`;
    await sql`
      INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
      VALUES (${userId}, ${promo.gems}, 'promo', ${`promo:${promo.id}:${userId}`}, ${sql.json({ label: promo.label })})
    `;
    return {
      ok: true as const,
      gems: Number(promo.gems),
      message: `${promo.gems} gems added.`,
    };
  });
}

function safeSecretMatch(provided: string, configured: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function enableGemDevMode(
  userId: string,
  email: string,
  code: string,
) {
  const configured = process.env.GEMS_DEV_CODE;
  if (!configured || !safeSecretMatch(code, configured)) return false;
  if (process.env.NODE_ENV === 'production') {
    const owners = (process.env.GEMS_OWNER_EMAILS ?? '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
    if (!owners.includes(email.toLowerCase())) return false;
  }
  await db().begin(async (sql) => {
    await ensureAccount(sql, userId);
    const [account] =
      await sql`UPDATE "GemAccount" SET "devMode" = true, "updatedAt" = now() WHERE "userId" = ${userId} RETURNING "balance"`;
    await applyDevTopUp(sql, userId, Number(account.balance));
  });
  return true;
}

export async function fulfillGemPurchase(input: {
  userId: string;
  checkoutSessionId: string;
  bundleId: string;
  amountPaidCents: number;
  currency: string;
}) {
  const bundle = getGemBundle(input.bundleId);
  if (!bundle || input.amountPaidCents < bundle.amountCents)
    throw new Error('Invalid gem bundle payment');
  return db().begin(async (sql) => {
    await ensureAccount(sql, input.userId);
    const purchase = await sql`
      INSERT INTO "GemPurchase" ("userId", "checkoutSessionId", "bundleId", "gems", "amountPaidCents", "currency")
      VALUES (${input.userId}, ${input.checkoutSessionId}, ${bundle.id}, ${bundle.gems}, ${input.amountPaidCents}, ${input.currency})
      ON CONFLICT ("checkoutSessionId") DO NOTHING RETURNING "id"
    `;
    if (!purchase.length) return false;
    await sql`UPDATE "GemAccount" SET "balance" = "balance" + ${bundle.gems}, "updatedAt" = now() WHERE "userId" = ${input.userId}`;
    await sql`
      INSERT INTO "GemTransaction" ("userId", "amount", "kind", "referenceKey", "metadata")
      VALUES (${input.userId}, ${bundle.gems}, 'purchase', ${`purchase:${input.checkoutSessionId}`}, ${sql.json({ bundleId: bundle.id, amountPaidCents: input.amountPaidCents })})
    `;
    return true;
  });
}
