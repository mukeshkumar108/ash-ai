# Gems system

Gems are a reusable platform currency. The implementation lives in `lib/gems`, while product features (currently image generation) only declare a price and call the ledger service.

## Current policy

- A wallet is created lazily for every authenticated account with 20 gems.
- Opening the app claims 5 gems once per UTC day, for five distinct days (25 total). Claims are idempotent.
- Image models cost 1 or 2 gems per output. Multi-output requests multiply the displayed price.
- A failed provider or storage operation is refunded. Validation and remix-baseline failures happen before charging.
- Promo codes are stored as SHA-256 hashes and may be used once per account. They can have global redemption and expiry limits.
- Developer mode is auditable rather than infinite: below 500 gems, it tops the account back up to 1,000. In production, the account email must be listed in `GEMS_OWNER_EMAILS`.
- Stripe test checkout offers 50/$5, 100/$10, and 200/$20 bundles. Purchases are credited only by a signature-verified webhook and are idempotent by Checkout Session ID.

## Ledger invariants

`GemAccount.balance` is the transactionally locked fast balance. `GemTransaction` is the append-only audit trail. Every spend, grant, refund, promo, and purchase uses a unique reference key. Never update a balance without creating the corresponding transaction in the same database transaction.

For a new product, choose a stable request ID, calculate a positive integer cost, call `spendGems` immediately before the billable provider operation, and call `refundGems` on every unsuccessful exit. Video can use the same API with a `video_generation` kind and metadata such as model, duration, and resolution. Pricing belongs in that product's model catalog, not in the wallet.

## Local setup

1. Run `pnpm db:migrate` against the local database.
2. Set `GEMS_DEV_CODE` in `.env.local`. In production also set `GEMS_OWNER_EMAILS`.
3. Create a gift code with `pnpm gems:promo CODE GEMS [MAX_REDEMPTIONS] [LABEL]`.
4. For purchases, set Stripe test `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, then forward Stripe events to `/api/webhooks/stripe`. Checkout stays visibly disabled without both values.

The current credentials flow does not verify email addresses. Promo redemption therefore requires an authenticated account but not a verified email. Before public or adversarial use, add email verification and rate limits; do not represent the present prototype as email-verified.

## Extension ideas

Task rewards should be server-authoritative and use an idempotency key such as `task:<task-id>:<user-id>`. Administrative gifts should use a separate authenticated operator endpoint or script, never a client-selected amount. If this module is extracted into another product, preserve the tables, unique reference keys, row locks, and webhook verification together.
