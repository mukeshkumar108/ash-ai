# llm-test-agent: agent working agreement

This repository is a working Sophie prototype used by real test users. Preserve
the behavior and boundaries below when making changes. Read the relevant code
and tests before changing architecture; do not replace working subsystems just
because another approach is more fashionable.

## Product architecture

- PostgreSQL is the canonical store for users, chats, visible messages, image
  generation metadata, profiles, and provenance.
- Auth.js credentials sessions identify users by the stable PostgreSQL `User.id`.
  Every user-owned read and mutation must filter or authorize by that ID.
- Honcho is an external, derived memory subsystem. Visible completed user/Sophie
  text turns are mirrored best-effort after canonical persistence. Honcho failure
  must never fail a chat turn.
- Sophie memory is targeted/JIT. The memory compiler decides whether older
  context materially helps, then retrieves a small result. Never inject the
  entire Honcho representation or conclusion dump by default.
- Current explicit user statements and current conversation outrank remembered
  context. Memory can be stale and must be treated as evidence, not truth.
- Voice is only an adapter: LemonFox STT produces canonical user text and
  ElevenLabs speaks the canonical assistant text. Do not create a separate voice
  reasoning or memory path.
- Image generation metadata belongs in `Generation`. Blob storage is shared and
  has no trustworthy owner index; never globally list blobs to users.
- Gems use the append-only ledger documented in `docs/GEMS_SYSTEM.md`. Every
  balance change must be atomic, auditable, and idempotent; billable provider
  failures must refund the matching spend.

## Image remix invariants

- A generated image returned to the UI must use the persisted `generationId`,
  never a temporary client ID, before it can become a remix baseline.
- Each remix records `parentGenerationId`, `parentOutputPathname`,
  `generationIndex`, the raw edit `instruction`, resolved `inputImages`, and the
  compact `remixState`.
- The selected parent output is the visual source of truth. The prompt compiler
  may use compact parent state and targeted ancestry to resolve references, but
  must not regenerate from a biography of the lineage or override the baseline.
- Load ancestor history only when the instruction refers to an earlier version.
- All generation/remix lookup and deletion operations must include the current
  authenticated `userId`.

## Security and data isolation

- Never return another user's chats, messages, generations, uploads, profile,
  memory, or integration data—even as a recovery/orphan fallback.
- Do not log or print secrets. Vercel marks sensitive values as `[SENSITIVE]`
  when pulled; that placeholder is not the original value and must never be
  copied into another environment.
- Provider credentials remain server-side. Do not use `NEXT_PUBLIC_` for keys.
- Preserve bounded upload validation and never fetch arbitrary user-supplied
  remote URLs.

## Deployment topology

- Production app: `https://project-z963i.vercel.app`.
- Vercel Production and Preview have separate environment scopes; update both
  when a shared prototype service changes, then redeploy.
- Honcho is served at `https://wa-api.skillstap.com:8443`. Its SDK uses absolute
  `/v3/...` paths, so `HONCHO_URL` must not include `/honcho`.
- Workspace Connect is served at
  `https://wa-api.skillstap.com/workspace-connect` and is a separate service.
- Do not use `vercel env pull` output as the source for sensitive values.
- `eslint-plugin-tailwindcss` currently emits a non-fatal Tailwind 4 export
  warning during `next build`; distinguish it from an actual build failure.

## Change discipline

- Preserve unrelated working-tree changes. Do not reset or overwrite other
  agents' work.
- Prefer small, typed changes with focused regression tests.
- After UI changes, test mobile behavior as well as desktop behavior.
- Run focused Playwright tests and `pnpm run build` before deployment.
- Do not commit, push, migrate, delete data, rotate credentials, or deploy unless
  the current user request authorizes it.
- If changing chat routing, memory, auth, database ownership, image provenance,
  or deployment configuration, explain the invariant being preserved in the
  handoff.
