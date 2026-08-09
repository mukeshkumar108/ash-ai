CREATE TABLE IF NOT EXISTS "GemAccount" (
  "userId" uuid PRIMARY KEY NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "balance" integer DEFAULT 20 NOT NULL,
  "dailyGrantCount" integer DEFAULT 0 NOT NULL,
  "lastDailyGrantOn" date,
  "devMode" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "GemTransaction" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "amount" integer NOT NULL,
  "kind" varchar(40) NOT NULL,
  "referenceKey" varchar(240) NOT NULL,
  "metadata" json,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "GemTransaction_referenceKey_idx" ON "GemTransaction" ("referenceKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "GemTransaction_user_created_idx" ON "GemTransaction" ("userId", "createdAt");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "GemPromoCode" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "codeHash" varchar(64) NOT NULL,
  "label" varchar(120) NOT NULL,
  "gems" integer NOT NULL,
  "maxRedemptions" integer,
  "redemptionCount" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "expiresAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "GemPromoCode_codeHash_idx" ON "GemPromoCode" ("codeHash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "GemPromoRedemption" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "promoCodeId" uuid NOT NULL REFERENCES "GemPromoCode"("id") ON DELETE cascade,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "GemPromoRedemption_code_user_idx" ON "GemPromoRedemption" ("promoCodeId", "userId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "GemPurchase" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "User"("id") ON DELETE cascade,
  "checkoutSessionId" varchar(255) NOT NULL,
  "bundleId" varchar(40) NOT NULL,
  "gems" integer NOT NULL,
  "amountPaidCents" integer NOT NULL,
  "currency" varchar(10) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "GemPurchase_checkout_idx" ON "GemPurchase" ("checkoutSessionId");
