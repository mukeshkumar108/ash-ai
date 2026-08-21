# Sophie continuity runtime

This document records the live path shared by the Vercel BFF, Companion Runtime,
Honcho, and Synapse-Cortex. It describes code contracts, not production secrets.

## Sophie re-entry routing V1

The existing handshake answers “how are we entering now?” and compact Cortex context supplies the live handover: only durable semantic residue that may deserve to cross the boundary. No Synapse-v3 handover path is connected.

Classification is deterministic. A gap of at most 15 minutes is `CONTINUATION`; over 15 minutes but below 8 hours is `SOFT_REENTRY`; 8 hours or more is `HARD_REENTRY`. Crossing a local date with at least a 6-hour gap is also hard, and an explicit goodnight followed by a new local day takes precedence. An explicit `brb`-style return within 90 minutes stays continuation. Fewer than two prior canonical user turns takes precedence as `COLD_START`; new-chat status alone does not.

`HARD_REENTRY` and `COLD_START` use `google/gemini-3.7-flash` for foreground turns 1–2, then `nex-agi/nex-n2-mini`. `SOFT_REENTRY` uses Gemini for turn 1, then Nex. `CONTINUATION` uses Nex. Both foreground IDs use OpenRouter. Existing research, safety, celebration, live-data, image-capability and judgment routes remain escape paths.

The seeded turns receive a bounded natural-language handover steer from the existing handshake and compact Cortex sources; later turns retain only temporal orientation. On hard re-entry, lightweight games, transient tactics and conversational excavation become historical callbacks rather than active directives. Durable health, event, promise, reminder, relationship and work continuity remains eligible.

Normal UI exposes no model selector. For developer testing, add `?devModel=<model-id>` and enable `SOPHIE_DEV_MODEL_OVERRIDE_ENABLED=true` server-side. Without that flag the value is ignored. Logs/runtime metadata record the selected foreground model, route reason, class, turn index and override state.

## Sophie session orchestration V1

After re-entry, Companion Runtime evaluates the standing objective against the bounded recent transcript. Its model-driven decision is one of `ALIGNED`, `STATE_UPDATE`, `STEER`, `STOP`, or `HIGH_CONSEQUENCE`. `STATE_UPDATE` replaces the objective and retains the previous value for inspection; it must never be treated as drift. `STOP` clears it. `STEER` means the objective remains valid but conversational trajectory or agency has failed. The resulting state is persisted in PostgreSQL on `Chat.session_routing`; it is not a second memory or continuity store.

A `STEER` decision starts a persisted Gemini 3.7 Flash burst with a UUID, reason, evidence fingerprint, turn index and two-turn minimum. After the minimum, `ALIGNED`, `STATE_UPDATE`, or `STOP` returns the speaker to Nex; continued `STEER` keeps Gemini active. A two-turn cooldown after exit prevents immediate burst thrashing unless the persisted lifecycle advances beyond it.

`HIGH_CONSEQUENCE` is a model-judged segment, not a keyword route. Consequential medical, relationship, legal, safety, financial/life and complex interpersonal decisions use `anthropic/claude-sonnet-5` through OpenRouter until `STATE_UPDATE` or `STOP` establishes a lightweight trajectory. Ordinary aches, annoyance and casual complaints remain eligible for Nex.

Foreground precedence is: safety hard requirement; enabled developer override; active high-consequence segment; active steering burst; re-entry seed; existing specialist/judgment/celebration escape; Nex ambient. Research and tool lanes remain workers/deferred capabilities and do not implicitly choose the conversational speaker. Runtime metadata stores worker and actual speaker separately.

Relationship initiative judgment uses Gemini 3.7 independently of the foreground speaker. Ordinary initiative composition uses Nex because the output is a small relational speaking task after Gemini has made the semantic decision; high-consequence composition uses Claude Sonnet 5. `SILENCE` remains first-class. Future `contractual_cadence` must remain a distinct initiative source rather than being inferred from memory, relational expectations, event expectations, reminders, or watches; product-specific cadence execution is intentionally deferred.

The developer inspector is hidden in production unless `NEXT_PUBLIC_SOPHIE_DEBUG_INSPECTOR=true`. It shows speaker/worker models, route reason, re-entry class/index, controller decision, objective transition, burst status, high-consequence state and override status without exposing any of this in Sophie's reply.

## Reactive turn path

1. `app/(chat)/api/chat/route.ts` persists the user message and sends a bounded
   canonical history to `executeCompanionRuntimeTurn`. The app window defaults to
   40 messages (`CONTEXT_WINDOW_SIZE`, minimum 3). A configured runtime URL and
   secret enable this path by default; `COMPANION_RUNTIME_REPLY_ONLY_ENABLED=false`
   remains an explicit rollback override.
2. `companion_core/runtime/turn_executor.py::execute_turn` builds a bounded
   classifier/memory context: last 6 messages, 700 characters each, 3,500
   characters total.
3. `adapters/honcho/client.py::prepare_turn_memory` runs the memory compiler only
   when `HONCHO_URL` is configured. The compiler has a 10s default timeout and
   requires `needsMemory`, a question, and confidence >=
   `MEMORY_DECISION_THRESHOLD` (0.65). Retrieval has a 12s default timeout.
   Conclusions use 20 candidates and retain 10; message fallback retains 6.
   `build_memory_packet` caps retrieved content at 1,200 characters. Every error
   fails open to a null packet.
4. In parallel, `adapters/cortex/client.py::fetch_cortex_context` calls
   `GET /v1/cortex/attention-packet` and `POST /v1/cortex/handshake`. A configured
   `SYNAPSE_CORTEX_URL` enables the path by default. Explicit
   `SYNAPSE_CORTEX_ENABLED=false` or
   `SYNAPSE_CORTEX_CONTEXT_ENABLED=false` remains available for rollback/debug.
   Calls use a 1.5s default timeout; either failure fails open.
5. `synapse-cortex/src/services/cortex_packet_service.py` reads expectations,
   open loops, suppressions, deadlines and recent resolutions. It emits the
   bounded `continuity_context`: at most 5 current continuity items, 3 open
   threads, 3 recent resolutions, 5 avoid entries, and 8 Honcho evidence refs.
   It also includes local ISO time, timezone and daypart. This calculation uses
   no LLM.
6. `adapters/cortex/client.py::compact_cortex_context` preserves that canonical
   object as `continuityContext`; it builds an equivalent bounded fallback for
   older Cortex deployments. Legacy TypeScript uses the matching implementation
   in `lib/synapse-cortex.ts`.
7. `companion_core/prompts/sophie_prompt_builder.py` serializes the canonical
   object into `[CORTEX CONTINUITY]`. The prompt explicitly treats it as optional
   situational awareness, makes current intent dominant, permits silence, bans
   suppressed/recently repeated topics, and treats evidence as fallible.
8. The final provider call receives that system prompt plus the canonical message
   window and current user message. Therefore the canonical Cortex payload and a
   successful Honcho memory packet both reach the final model request.

The precedence is: current user turn, trusted time/current scene, Cortex
continuity, retrieved Honcho memory, older history.

## Representative decision packets

| Scenario | Cortex result | Final-model treatment |
| --- | --- | --- |
| Yesterday: walk tomorrow morning | `expectation_due`, `window_open`, morning | Available for one natural callback; not mandatory |
| Appointment/result due today | due/deadline candidate with `why_relevant_now` | May ask when it fits; current request wins |
| Stargazing last night, return next morning | Only surfaces if ingested as an open loop/expectation or retrieved by Honcho | No invented callback from daypart alone |
| Unresolved personal/project thread | bounded `open_threads` item | Optional continuation, subject to repetition and suppression |
| No relevant state | empty candidate arrays | Explicitly permits silence; no callback should be fabricated |

`tests/test_canonical_continuity_context.py` and
`companion-runtime/tests/test_canonical_continuity.py` are safe synthetic debug
fixtures for inspecting these packets and prompt placement. They do not read
production data.

## Initiative path

Browser `active_idle` remains a convenience wake-up, but the blind 2.8-second
`post_turn` timer has been removed. Initiative now fetches the same canonical
Cortex context using `fetchCanonicalContinuityContext`, adds the last four
assistant messages as `recently_addressed_topics`, and passes the result to the
editorial evaluator. Honcho remains separate fallible evidence.

Continuity is a candidate, not an instruction:

`Cortex candidate -> deterministic eligibility/quiet-hour prefilter -> editorial
decision (including act=false) -> deterministic topic/repetition policy ->
composer -> second semantic repetition check -> transactional insert`.

The authenticated Vercel cron route wakes a bounded scan every ten minutes. It
is active by default and can be explicitly disabled with
`RELATIONSHIP_SERVER_INITIATIVE_ENABLED=false`; it requires `CRON_SECRET`. The scan examines only chats whose canonical latest message is an
assistant message between the configured idle threshold and 48 hours old. It
requests Cortex before any model call and skips empty candidate sets. Night is a
quiet daypart. Existing daily, unanswered, stale-anchor and cadence checks still
apply.

Multiple workers converge on the existing unique dedupe key
`user:chat:server_scan:anchorMessageId`; the claim uses `ON CONFLICT DO NOTHING`,
and insertion rechecks the anchor under a row lock.

## Synapse-v3

`synapse-v3` has richer standalone instruction/handover and composer surfaces,
but the continuity facts needed here already exist in Synapse-Cortex. Wiring the
V3 packet would introduce a second expectation/context authority. It remains
disconnected; no Synapse-v3 files are changed.

## Fast scenario harness

The harness starts an isolated local Synapse-Cortex with a temporary SQLite
database, injects scenario clocks into the real ingest/attention/handshake paths,
uses configured Honcho and actual model providers, and prints Cortex, Honcho,
editorial, policy/dedupe and final reactive/proactive outputs.

Run all scenarios:

```bash
pnpm continuity:harness
```

Run one scenario interactively:

```bash
pnpm continuity:harness -- --scenario=next-morning
```

Available IDs are `next-morning`, `due-expectation`, `current-intent-wins`,
`irrelevant-memory-silence`, `repeated-topic`, `unanswered-backoff`, and
`future-follow-up`. No browser, cron, deployment, or real-time wait is used.
