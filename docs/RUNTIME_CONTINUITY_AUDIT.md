# Sophie continuity and initiative runtime audit

Code-path audit date: 2026-08-13. This describes the checked-out repositories,
not assumed deployment configuration. Line numbers may drift; function names are
the contract locators.

## Architecture map and real call chains

### Reactive chat

`components/chat.tsx::useChat` -> `POST app/(chat)/api/chat/route.ts` -> authenticate,
load canonical `Message_v2` history/profile/handshake and persist the user message
-> `lib/companion-runtime.ts::executeCompanionRuntimeTurn` -> VPS
`runtime_api/routes/turns.py::create_turn` ->
`TurnExecutionPipeline.execute_turn` -> concurrently:

- `assess_epistemic_policy` (LLM, deterministic fallback),
- `HonchoAdapter.prepare_turn_memory` (LLM memory decision, then Honcho v3), and
- `CortexAdapter.fetch_cortex_context` (`GET /v1/cortex/attention-packet` plus
  `POST /v1/cortex/handshake`).

Synapse-Cortex reads its state DB and computes temporal state against the request
`now`; Companion Runtime preserves `continuity_context`, builds
`[CORTEX CONTINUITY]` and optional 1,200-character Honcho memory blocks, then
calls `ProviderExecutionAdapter.execute_direct_reply`. The result crosses back to
Vercel, which persists the assistant `Message_v2`, streams it, then schedules
`mirrorCompletedTurn` after the canonical write. Honcho mirroring may then shadow
the user message to `POST synapse-cortex /v1/events/turn`, creating/updating
expectations, loops and suppressions for later turns. All external context calls
fail open; canonical message persistence remains PostgreSQL-owned.

The local TypeScript fallback follows the equivalent functions in
`lib/agent/memory.ts`, `lib/synapse-cortex.ts`, and
`lib/agent/system-prompt.ts` when Companion Runtime is explicitly disabled or
unconfigured.

### Explicit memory recall

For “what did we talk about yesterday?”, `prepare_turn_memory` receives the
current turn plus the last 6 messages (700 characters each, 3,500 total). Its LLM
must return `needsMemory=true`, confidence >= 0.65, and a question. Honcho then
uses `targeted_conclusions` by default (20 candidates, top 10), falling back to
user-authored semantic search (top 6). `targeted_chat` is an explicit experiment.
The result becomes a 1,200-character `[RELEVANT REMEMBERED CONTEXT]` block and
reaches the final provider request below current turn/time/scene/Cortex in prompt
precedence. Compiler/retrieval timeouts or errors produce no memory, never a
failed chat turn.

### Initiative

Browser `active_idle` or internal `server_scan` ->
`runRelationshipInitiative` -> `claimInitiative` transaction validates latest
anchor, idle/cadence/daily/unanswered policy and inserts a unique evaluating row
-> concurrently load the last 14 canonical messages, Honcho relational evidence,
and last 4 assistant texts -> `retrieveInitiativeContinuity` -> canonical Cortex
packet -> `evaluateInitiative` (LLM; `act=false` valid) ->
`decisionPolicyRejection` (boundary, beat novelty, posture, recent topic,
sensitivity) -> `composeInitiative` (LLM) -> deterministic composed-text topic
overlap -> `persistInitiativeMessage`, which locks/rechecks the anchor and inserts
ordinary `Message_v2` plus initiative audit state -> best-effort Honcho mirror.
Every model/service/persistence exception fails closed.

### Server initiative

Vercel `vercel.json` cron every ten minutes -> authenticated
`GET /api/cron/relationship-initiative` -> `runServerInitiativeScan` -> SQL selects
at most `RELATIONSHIP_SERVER_SCAN_LIMIT` chats whose latest assistant message is
between the idle threshold and 48 hours old -> fetch Cortex context before any
LLM -> skip empty candidate sets -> call the same `runRelationshipInitiative`
path with `server_scan`. Unique `(user, chat, trigger, anchor)` dedupe plus the
locked anchor prevents duplicate emission. The schedule wakes evaluation; it is
not a send interval.

## Runtime inventory

| Component | Repo / function | Owner and shape | Execution / consumers | Live, flags and failure | Overlap |
| --- | --- | --- | --- | --- | --- |
| Canonical chat history | llm-agent-test `Message_v2`, chat route | PostgreSQL; role/parts/timestamps | Deterministic; normal prompt and initiative snapshot | Live; DB errors fail request | Honcho mirrors but is not canonical |
| Normal memory decision | companion-runtime `HonchoAdapter.prepare_turn_memory`; TS fallback `prepareTurnMemory` | Turn-local decision `{needsMemory, memoryQuestion, confidence}` | LLM; gates Honcho retrieval | Live when Honcho configured; fail open | No Cortex ownership overlap |
| Honcho retrieval | companion-runtime `_retrieve_relevant_memory`; llm-agent-test `retrieveRelevantMemory` | Honcho evidence; conclusions/search/chat | Final reactive prompt; initiative broad evidence | `HONCHO_URL` required; fail open | Evidence may reference Cortex source IDs, never owns lifecycle state |
| Honcho writes | llm-agent-test `mirrorCompletedTurn`, `mirrorAssistantInitiative` | Derived user/assistant messages | Post-persistence background mirror | `HONCHO_URL` required; best effort | PostgreSQL remains canonical |
| Expectation ingestion | synapse-cortex `v1_events.ingest_turn_event` | Synapse-Cortex DB expectations | Deterministic extractor/shaper/grounder in current provider configuration | Live through post-Honcho shadow write; fail-open upstream | Synapse-v3 has separate overlapping transitions |
| Expectations/read model | `expectation_engine.derive_expectation_read_model` | Temporal/outcome state calculated from persisted expectation + requested `now` | Deterministic; packet/handshake | Live; no LLM | Synapse-v3 also derives expectations, unconnected |
| Open loops | `LifecycleService.create_open_loop_if_needed`, `CortexPacketService` | Synapse-Cortex DB | Deterministic ingestion/read | Live; aged/suppressed loops omitted | No llm-agent-test reimplementation |
| Recent resolutions | `CortexPacketService.compile_attention_packet` | Resolved expectations updated within 72h | Deterministic; canonical packet | Live | 72h window uses stored update time |
| Suppressions | `LifecycleService.create_suppression_if_needed`, packet service | Synapse-Cortex DB; target/type/topic/reason/until | Deterministic; filters state and emits `avoid_repeating` | Live; expiry evaluated on packet read | Initiative adds recent assistant topics separately |
| Attention packet | `GET v1_cortex.get_cortex_attention_packet` | Synapse-Cortex; full operational packet | Deterministic; handshake/reactive/initiative | Live when URL configured; request failure fails open | Canonical continuity derives from it |
| Handshake | `POST v1_cortex.get_cortex_handshake` | Synapse-Cortex; daypart/orientation/live/followups/avoid/refs | Deterministic; reactive context | Live | Some fields duplicate attention for one-call convenience |
| Canonical continuity | `CortexPacketService._compile_continuity_context` | Synapse-Cortex; bounded now/continuity/open/resolved/avoid/refs | Deterministic; reactive and initiative | Live | Sole runtime continuity authority |
| Python compaction | companion-runtime `compact_cortex_context` | Preserves canonical packet; backward-compatible fallback | Deterministic; prompt builder | Live | TS fallback mirrors contract |
| TS compaction/fetch | llm-agent-test `compactCortexContext`, `fetchCanonicalContinuityContext` | Same canonical shape | Deterministic; local reply fallback and initiative | Live | Necessary transport parity, not an authority |
| Reactive prompt | Python `build_sophie_reply_system_prompt`; TS fallback equivalent | Prompt precedence and optional-awareness policy | Deterministic assembly; final LLM consumes | Live | Scene state is separately turn-local/current |
| Scene state | companion-runtime `derive_scene_state` / TS equivalent | Current-turn temporal reality | Deterministic; reactive prompt | Live | Intentionally current-turn authority, not durable continuity |
| Initiative trigger: browser | `components/chat.tsx::requestInitiative` | UI timer emits `active_idle` | Deterministic wake-up | Live while page open; no post-turn 2.8s emission | Server scan makes browser nonessential |
| Initiative trigger: server | cron route / `runServerInitiativeScan` | Vercel schedule + PostgreSQL candidate scan | Deterministic prefilter | Live by default unless explicit false; cron secret required | Same downstream initiative path |
| Candidate prefilter | `serverInitiativeScanCandidates`, `hasPlausibleContinuityCandidate`, quiet daypart check | PostgreSQL anchor + Cortex nonempty timely state | Deterministic | Live for server scan | Editorial still decides whether to speak |
| Editorial evaluator | `evaluateInitiative` | Structured `InitiativeDecision` including beat, posture, evidence, `act` | LLM | Live; timeout/error fails closed | Does semantic novelty; policy verifies claims |
| Initiative composer | `composeInitiative` | <=420-character Sophie text after validation | LLM | Live only after approval; fail closed | Reactive composer is separate by design |
| Cadence/unanswered | `claimInitiative`, `checkInitiativeEligibility`, `unansweredFollowUpDelayMs` | PostgreSQL sent/replied rows + deterministic keyed jitter | Deterministic | Live; defaults 8/day, 4 idle/day, max 2 unanswered, first retry 25–75m | DB and JS wall clocks currently mixed |
| Repetition | evaluator beat assessment; `decisionPolicyRejection`; `repeatsRecentlyAddressedTopic` | Latest conversation, topic keys, last 4 assistant texts | LLM plus deterministic lexical-topic guard | Live | Two complementary definitions: semantic beat and cheap safety guard |
| Presence/receptivity | evaluator `conversationState`; eligibility latest-role/anchor; browser `status==='ready'` | Current conversation semantics and UI presence | LLM + deterministic | Live; server does not require presence | No durable user-presence service |
| Night suppression | canonical packet daypart; `isQuietDaypart` in server prefilter | `night` means 22:00–05:00 local | Deterministic | Server scan only; browser initiative relies on editorial boundary/time | Not a user-configurable sleep schedule |
| Dedupe | `initiativeDedupeKey`, unique DB index, claim conflict, insertion anchor lock | PostgreSQL source of truth | Deterministic | Live; duplicate claims return no action | UI also dedupes returned message IDs |
| Behavioral trace | `CompletedTurn` packets/metadata; `RelationshipInitiative`; bounded dev Honcho traces; logs | Runtime response + PostgreSQL audit rows | Deterministic recording | Partial; sensitive payloads not broadly logged | Harness can combine surfaces locally |
| Synapse-v3 handover | `core/api.py::get_instruction_packet`, startup/session composer code | Synapse-v3 experimental DB/read models | Mixed deterministic/LLM depending surface | Endpoint exists but no live Sophie caller | Overlaps Cortex continuity; intentionally disconnected |

## Canonical packet verification

Every canonical field has one existing source:

- `now`: request time plus IANA timezone, with deterministic daypart.
- `continuity`: current deadline/follow-up/active-window expectation read models.
- `open_threads`: unsuppressed, age-eligible Synapse-Cortex open loops.
- `recent_resolutions`: fulfilled/cancelled/superseded expectations updated within
  72 hours.
- `avoid_repeating`: active Synapse-Cortex suppressions with target, reason and
  optional expiry.
- `relevant_honcho_message_ids`: provenance references only. They are not
  promoted to factual or lifecycle authority.

Ordering is deadline passed/approaching first, then elapsed follow-ups, then
current windows. The canonical continuity cap is 5 after dedupe; deadlines are
admitted first. Open threads, resolutions, avoid entries and refs cap at 3, 3, 5
and 8 respectively. Full attention fields remain available in the raw endpoint;
canonical compaction intentionally excludes `waiting_on` as a separate list
because external dependencies already appear as expectations/open loops, and
excludes `important_but_can_wait` because it is currently always empty.

Two correctness defects were fixed during this audit: deadline candidates could
previously fall beyond the five-item cap and lacked evidence refs; linked invited
follow-ups exposed internal bookkeeping text instead of their expectation topic.

`avoid_repeating` is sufficient for durable user-requested suppression (topic,
reason, target type, expiry). It does not itself represent recent assistant
speech. Reactive models see that speech in canonical history; initiative adds a
bounded `recently_addressed_topics` list and applies a post-compose overlap guard.

## Flags and defaults that affect continuity

| Variable | Default/current behavior | Missing/false effect and visibility | Judgment |
| --- | --- | --- | --- |
| `COMPANION_RUNTIME_URL`, `COMPANION_RUNTIME_SECRET` | Required pair; configured pair enables runtime | Missing falls back to TS path; no user-facing notice | Necessary service config |
| `COMPANION_RUNTIME_REPLY_ONLY_ENABLED` | Enabled unless literal `false` | `false` uses TS fallback | Justified rollback override |
| `HONCHO_URL` | No default | Missing removes retrieval and all mirrors; chat silently continues | Necessary endpoint, but operational health needs monitoring |
| `HONCHO_API_KEY` | Empty | Only matters where Honcho requires auth | Necessary config |
| `HONCHO_WORKSPACE_ID` | `llm-test-agent` | Stable default identity namespace | Justified |
| `HONCHO_RETRIEVAL_MODE` | `targeted_conclusions` | `targeted_chat` opts into experimental peer chat | Justified experiment selector |
| `MEMORY_DECISION_THRESHOLD` | 0.65 | Higher values reduce implicit recall silently | Justified tuning, should be traced |
| `MEMORY_COMPILER_MODEL` | DeepSeek v4 flash | Provider failure removes memory for turn | Necessary model config |
| memory/Honcho timeouts | 10s compiler, 12s retrieval, 5s SDK | Timeout removes memory silently to user | Correct fail-open; observable in logs/metadata |
| `SYNAPSE_CORTEX_URL` | No default | Missing removes all Cortex continuity | Necessary endpoint; highest-risk silent omission |
| `SYNAPSE_CORTEX_ENABLED` | Enabled with URL unless literal `false` | Explicit false disables context and shadow ingestion | Justified rollback/debug override |
| `SYNAPSE_CORTEX_CONTEXT_ENABLED` | Enabled unless literal `false` | Explicit false disables reads while ingestion may continue | Justified diagnostic override |
| `SYNAPSE_CORTEX_TIMEOUT_MS` | 1500 | Timeout discards entire compact context | Aggressive but intentional fail-open |
| `SYNAPSE_CORTEX_API_TOKEN` | Empty | Missing fails only when sidecar enforces token | Necessary auth config |
| `ASH_TIME_ZONE` | `Europe/London` | Wrong/missing user-specific timezone shifts relevance/daypart | Current global fallback is underpowered |
| `CONTEXT_WINDOW_SIZE` | 40, minimum 3 in Python | Smaller window weakens recent-context/repetition judgment | Justified tuning |
| `RELATIONSHIP_SERVER_INITIATIVE_ENABLED` | Enabled unless literal `false` | False removes background outreach; browser idle remains | Justified rollback override |
| `CRON_SECRET` | Required, no default | Missing makes cron return 401, so background initiative disappears | Necessary security; Vercel logs only |
| `RELATIONSHIP_SERVER_SCAN_LIMIT` | 20 | Bounds each wake-up; excess chats wait for later runs | Justified load cap |
| `RELATIONSHIP_IDLE_MS` | 5m | Changes browser/server eligibility | Justified policy |
| daily/unanswered variables | 8/day, 4 idle/day, max 2 unanswered, 25–75m retry | Can suppress outreach without UI indication | Intended restraint; audit rows carry reason |
| evaluator/composer model/timeouts | DeepSeek v4 flash; 15s/20s | Failure produces no initiative | Correct fail-closed |
| evidence cache | 15m | May serve slightly stale Honcho evidence | Justified bounded cache; not lifecycle state |

`MEMORY_SLICE` and summarizer thresholds belong to the older structured RP/chat
continuity system, not this canonical Sophie Cortex path. They are overlapping
legacy capabilities but do not gate the packet described here.

## Authorities and overlap

- PostgreSQL in llm-agent-test owns visible messages, initiative attempts,
  cadence, reply attribution and dedupe.
- Honcho owns derived conversational evidence only.
- Synapse-Cortex is the live canonical owner of expectations, open loops,
  suppressions and moment continuity.
- Companion Runtime owns turn-local scene, epistemic/lane judgment, prompt
  assembly and final reactive execution.
- The relationship runtime owns initiative editorial policy/composition/delivery;
  it does not reconstruct expectation due-state.
- Synapse-v3 maintains an overlapping experimental expectation/transition,
  attention and handover system that can diverge. It has no caller on the live
  Sophie path and should remain disconnected.

There are deliberately two “recently addressed” mechanisms: canonical chat
history for the reactive model and the last four assistant texts for initiative.
There are also two repetition judgments in initiative: model-level semantic beat
novelty and a cheap deterministic lexical guard. Neither owns durable suppression;
that remains Synapse-Cortex.

## Stable contracts for deterministic tests

1. A due/passed expectation is derived against supplied `now` and survives the
   canonical packet cap with its source reference.
2. An active user suppression removes matching expectations/loops and survives
   as `avoid_repeating` with reason/expiry.
3. Linked open loops expose a meaningful topic, not internal IDs.
4. Current user intent outranks optional Cortex continuity and Honcho evidence.
5. Honcho explicit recall remains compiler-gated, bounded and fail-open.
6. Initiative and reactive chat consume the same Synapse-Cortex continuity
   authority.
7. Editorial initiative may return `act=false` without composing/persisting.
8. Semantic repeated beats and deterministic recent-topic overlap can each block
   initiative.
9. One unanswered initiative backs off; two block further outreach until reply.
10. A duplicate trigger/anchor cannot create two initiative rows/messages.
11. Empty/irrelevant continuity does not itself justify outreach.
12. Service failures never fail a normal canonical chat turn and fail initiative
    closed.

## Time and deterministic simulation assessment

Already injectable:

- Synapse-Cortex event ingestion requires `now`.
- Attention packet accepts `now`; handshake accepts `now` and
  `last_interaction_time`.
- Temporal grounding and expectation read models accept `now`.
- Reactive scene/prompt/Cortex adapters accept `now` internally.
- The existing local scenario script injects these service timestamps.

Easy to inject but currently wall-clock based:

- `runRelationshipInitiative` local-time formatting uses `new Date()`.
- evidence-cache TTL uses `Date.now()`.
- browser idle timers use `Date.now()` (irrelevant to server simulation).
- Honcho mirror fallback timestamps use `new Date()` when callers omit them.

Problematic for a complete deterministic initiative simulation:

- `claimInitiative` computes idle/unanswered gaps with `Date.now()` while its SQL
  daily counts use database `now()`.
- `serverInitiativeScanCandidates` uses database `now()` for idle and 48h bounds.
- initiative completion timestamps and sent timestamps use SQL `now()` or
  `new Date()`.
- the cron supplies no logical timestamp; it merely invokes the route.

Database-owned timestamps should remain authoritative in production, but a
future harness needs one explicit `evaluationNow` threaded into candidate scan,
claim, local-time formatting and persistence. SQL should compare against the
passed timestamptz inside the same transactions rather than globally replacing
database time. Timeout clocks should remain real monotonic time.

Model row `created_at` defaults in Synapse-Cortex use wall time for audit/age;
semantic expectation timing remains request-clock driven. For fully deterministic
age/resolution tests, ingestion should set or derive audit timestamps from event
`now` through a narrow service seam rather than monkeypatching Python globally.

## Local invocation and observability

`runRelationshipInitiative` is a callable server-only entry point and can run
without browser or cron, but it currently requires the canonical PostgreSQL rows
and uses mixed wall/database time. Therefore “evaluate now as if X” is not yet a
clean full-path contract.

The existing `continuity-scenario-harness.ts` (created in the preceding task)
can run Cortex ingestion/read models, Honcho retrieval, real editorial policy and
final models with a simulated timestamp and no wait/deployment. It intentionally
does not prove the real PostgreSQL claim/persistence transaction under simulated
time. This audit did not enlarge it.

Available per-turn debug information today:

- Reactive `CompletedTurn`: scene, epistemic result, full Honcho adapter envelope,
  compact Cortex context and execution metadata.
- Synapse-Cortex endpoints/debug route: raw attention, handshake and persisted
  lifecycle decisions.
- Initiative PostgreSQL row: trigger/status/kind/topic/reason/evidence/guidance,
  generated message and reply attribution.
- Logs: Honcho/Cortex failures, chosen context, initiative send/failure and
  expectation creation.

Missing for one unified proactive trace: the exact evaluator input snapshot,
canonical continuity packet version, selected Honcho packet, deterministic
prefilter result, post-compose repetition comparison, and persistence outcome in
one safe object. Production should store bounded hashes/IDs and reasons; a local
debug sink may retain synthetic/full payloads. Do not log user content globally.

## Recommended next harness task

Do not add another memory or expectation system. Add an `InitiativeEvaluationClock`
seam (`now(): Date`) plus optional `evaluationNow` on internal scan/claim/outreach
calls. Make PostgreSQL comparisons use that value transactionally. Add a bounded
`InitiativeDecisionTrace` returned only to internal/dev callers containing:

1. candidate anchor and deterministic prefilter;
2. raw and canonical Cortex packets;
3. bounded Honcho evidence and retrieval mode;
4. evaluator input and structured decision;
5. policy and repetition rejection reasons;
6. composed message;
7. dedupe claim and persistence result.

Then adapt the existing scenario script to call that real internal entry point
against an isolated PostgreSQL test database, assert the stable contracts above,
and keep model-scored behavioral expectations in a separate nondeterministic
layer. That is the smallest path to hours/days-in-seconds testing without cron,
browser timers, deployment, or production-sensitive logging.

## Evaluation-time seam implementation (2026-08-13)

The recommended seam is now implemented. `runServerInitiativeScan` and
`runRelationshipInitiative` capture one `evaluationNow` (actual current time when
omitted) and pass it through scan selection, claim eligibility, cadence,
unanswered backoff, local-time formatting, Cortex retrieval, and semantic message
and send timestamps. PostgreSQL computes idle and unanswered ages against the
same injected timestamp, avoiding timestamp-without-time-zone/DST conversion in
JavaScript.

`RelationshipInitiative.evaluationAt`, `Message_v2.createdAt` for the emitted
initiative, and `RelationshipInitiative.sentAt` represent effective event time.
`RelationshipInitiative.createdAt` and `decidedAt` deliberately remain database
wall time as the audit record of when processing really happened. Honcho cache
expiry, abort timeouts, UUID/container suffixes, and browser timers also remain
real elapsed time because they are operational mechanics rather than simulated
relationship chronology.

The existing harness now starts isolated PostgreSQL and Cortex instances, runs
the real scan/claim/editorial/policy/dedupe/persistence path, and removes them on
completion. It does not point at the configured application database unless an
explicit `CONTINUITY_HARNESS_DATABASE_URL` is supplied. Run all scenarios with
`pnpm continuity:harness`, or one with
`pnpm continuity:harness -- --scenario=<name>`.
