# Sophie Current-State Handoff

> Compact handoff for the next agent. Read together with the existing runtime
> map (the comprehensive system diagram / execution-path document produced
> 2026-08-29/30). This file only records what changed since then and what to
> investigate next. Do not treat anything here as architecture documentation.

## Current deployed commits (all on `main`, pushed)

| Repo | Commit | Note |
|---|---|---|
| llm-agent-test | `9171021` | Isa quarantine + chief-of-staff catch-up (`cff8276`) |
| companion-runtime | `f635115` | working-set replaces legacy packet payload |
| synapse-cortex | `40cf92e` | belief reconciliation, NOT_FULFILLED, counterfactual guard |
| Honcho (VPS) | existing stack | unmodified |

Production: Vercel `project-z963i` (auto-deploys from main), VPS
`deploy@161.97.150.246` docker compose (companion-runtime :8080 via
wa-ai.skillstap.com, synapse-cortex :8010 via wa-api.skillstap.com/synapse-cortex/,
Honcho stack, nginx reverse proxy). Local dev stack also running
(app :3001, companion :8080, cortex :8002, honcho :8001).

Databases: app = Neon `neondb`; Cortex = Neon `synapse_cortex` (production
history migrated from VPS local Postgres; local Postgres container retired
from the data path). Honcho persistence = named docker volume on VPS.

## What changed since the runtime map

1. **Belief reconciliation** (`lifecycle_service.py`):
   - `_reconcile_siblings()`: after a terminal outcome (FULFILLED /
     NOT_FULFILLED / CANCELLED), sibling UNKNOWN expectations describing the
     same plan are superseded onto the resolved row. Sibling identity = same
     owner + same non-self `subject_peer_id` (e.g. "mother", "Oxford") OR
     >= 2 shared significant title tokens (plural + -ing folded). Cap 6.
     Rows are superseded, never deleted; evidence preserved.
   - `reconcile_new_expectation()`: a newly created expectation supersedes
     stale UNKNOWN siblings of the same plan, so older "tomorrow" rows cannot
     outlive newer evidence.
   - Both wired into `/v1/events/turn` (called from `v1_events.py`).
   - `subject_peer_id` only identifies a real third party when it differs
     from `owner_peer_id` — self-commitments (subject == owner) must rely on
     title identity. This distinction is load-bearing; regression tests cover
     the ambiguity-shield interactions.

2. **NOT_FULFILLED semantics**: the pre-existing `OutcomeState.NOT_FULFILLED`
   is now reachable. Explicit negative-outcome evidence ("I was meant to go…
   I didn't go", "gave it a miss", "can't get there", "won't be going",
   "didn't happen"…) maps an expectation to NOT_FULFILLED — never FULFILLED,
   never plain UNKNOWN.

3. **Counterfactual guard**: text shaped like completion but framed
   hypothetically ("would have had to", "had to do", "was meant to",
   "the plan was to", "nearly", "if he'd"…) can never become fulfillment
   evidence. Applied in both `handle_outcome_mutations` and
   `resolve_explicit_completions`. Counterfactual-without-negation leaves the
   belief UNKNOWN (context, not outcome).

4. **Double-context removed** (`sophie_prompt_builder.py`): when a
   `working_set` is present in the cortex context, the prompt's `cortex`
   module contains ONLY `now + working_set + avoid_repeating`. The legacy
   brief/continuity/open_threads payload is no longer injected alongside it
   (kept as fallback when no working set exists — older Cortex).

5. **Test DB isolation hardened** (`tests/conftest.py`): tests force
   `DATABASE_URL` to a throwaway sqlite file; pytest can never touch Neon or
   any configured store (this previously wiped the production Cortex store
   once).

## Isa / roleplay quarantine — result

- The live Cortex store and the hosted Sophie path were verified CLEAN of
  Isabella/roleplay content (the one "isa" text match was the substring in
  "d-i-s-a-ppear").
- Fossil roleplay continuity blobs (`memory_state`, `active_state`,
  `relationship_dynamics`, `continuity_events`) on the two founder chats
  (`098ac835…`, `a744ad51…`) were NULLed. Backup:
  `/tmp/fossil_backup_2026-08-30.json` (local machine, ephemeral — copy
  somewhere durable if wanted).
- Quarantine: `app/api/memory/preview/route.ts` now only runs the roleplay
  continuity writer for chats with an explicit non-`neutral` `characterId`;
  neutral Sophie chats get a read-only preview.
- The roleplay library (`lib/ai/characters/*` personas incl.
  isabella-morales, `character-prompts.ts`, `characters.ts`,
  `chat-continuity.ts`, `characterId`/`rp_*` schema columns) remains in the
  repo, dormant, per decision — do not delete before the reuse review below.

## Real Mum/Oxford replay result (eval on isolated copy, then applied)

With the fixes, replaying the actual turns: Oxford -> CANCELLED with all
sibling "upcoming Oxford" rows SUPERSEDED; Mum visit -> NOT_FULFILLED from
"I was meant to go… I didn't go"; the counterfactual turn ("had to do the
buses and then stay at my mum's") produced only transport context — never
FULFILLED. Verified on an isolated Neon `synapse_eval` copy before any
production mutation.

## Production data repair performed (deterministic, logged)

- Reverted the wrongly-FULFILLED mum-obligation expectation (`34d94e7c…`) to
  NOT_FULFILLED; its fulfillment had been decided from counterfactual text
  under the pre-fix rule (trace-documented).
- Reconciled 13 sibling expectations onto their terminal beliefs across the
  production store.
- Live brief now: `now` = 3 recurrences; Oxford/Mum contradiction gone;
  stale items in `review_needed`; `unresolved` empty.

## Remaining known residue

- 3 active recurrences pending cadence audit: "daily step goal",
  "Fix audio transcription bug" (daily), "daily talk with Ashley".
- 2 transport-leg observations (bus Bedford / Cambridge bus station) still
  UNKNOWN — benign context; dependent-plan cascade not yet formalized.
- One "recurring intention to interact with their mother" observation row
  still UNKNOWN (not a recurrence row).
- Old unused VPS stack (synapse-api/worker/falkordb, 3 months up) and three
  stale Vercel projects — decommission candidates, not urgent.

## Operational debt that still matters

- Hosted turn latency ~18s: Cortex packet against Neon + Honcho inside the
  reply path is the largest non-model cost. Timeouts were raised to 12s
  (app/companion) which masks, not fixes.
- Vercel cron `/api/cron/continuity-brief` iterates `LIMIT 100` owners with
  catch-up; fine today, will need owner-cursor + caching as users grow.
- VPS `docker compose build` can serve stale cached layers — use
  `--no-cache` (or a bust arg) in any deploy procedure.
- Local Honcho (dev) runs with auth disabled vs VPS with auth — env drift.
- pytest must never run without the conftest isolation (now enforced).

## Explicit next investigation priorities (in order)

1. **Recurrence cadence audit**: for each active recurrence
   ("daily step goal", "Fix audio transcription bug", "daily talk with
   Ashley"), pull the extraction trace + source turn and judge whether the
   exact words constituted real cadence evidence. The deterministic demotion
   guard exists; this audit tells us if it is sufficient.
2. **Honcho capability vs StructuredMemory comparison**: Honcho clearly
   handles recall. The open question: does anything in Honcho maintain
   *current authoritative belief* (facts + interpretations + provisionality
   + milestones + revocation) as evidence revises? If not, the dormant
   `lib/ai/summarizer.ts` / `chat-continuity.ts` machinery
   (`enforceMemoryPatchAuthority`, `applyExplicitRevocations`,
   `filterIdentityDrift`, StructuredMemory schema) contains paid-for
   abstractions worth adapting to Sophie (reframed from the "Isa" persona
   perspective). Decide reuse vs delete only after this comparison.
3. **Tasks / recurring actions / Sophie Noticed boundaries**: founder Task
   list is empty. Once 1-2 land, run the boundary probes ("Tomorrow I need
   to call X", "Remind me to buy milk", "I need to sort my passport this
   week", "I should probably look at the visa sometime") and evaluate where
   each lands across expectation / candidate / Task.
4. **Sophie kernel / personality tuning**: with context now compact and
   beliefs coherent, evaluate voice/character module quality on real turns.
5. **Cortex/Synapse handover + background intelligence direction**: the
   scratchpad / current-world-state synthesis (e.g. "family travel plan is
   off because transport failed; old travel legs no longer active") instead
   of reasoning over historical expectation rows; also decide what the
   background layer should proactively maintain.
6. **Foreground latency / voice path later**: after 1-5; latency work
   (packet caching, regional Neon) and voice durability are deferred.

## Session-end state

All three repos clean at `main`, deployed to VPS + Vercel, local dev stack
running against the same Neon stores. Isolated eval artifacts: Neon
`synapse_eval` DB (can be dropped) and `/tmp` scripts — both disposable.
