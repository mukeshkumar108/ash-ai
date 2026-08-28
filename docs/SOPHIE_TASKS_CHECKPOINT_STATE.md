# Sophie Tasks — Checkpoint 2 Decision Note

## Current runtime flow (verified at HEAD 5056bda)

1. `app/(chat)/api/chat/route.ts` persists the incoming user message (`message.id`
   = stable app message id, used as `turn_id`).
2. Reply is produced EITHER by `companion-runtime` (`executeCompanionRuntimeTurn`
   → streaming/text generation with beat markers, fallback chains) OR by the
   legacy TS `executeDirectReply` path. The assistant message is persisted.
3. A single `after()` hook then runs (post-response, best-effort):
   - schedule durable initiative opportunity
   - `mirrorCompletedTurn` (Honcho)
   - `extractSophieAttentionCandidates` (Cortex)
   - **`captureExplicitTasks` → `createTask`** (the legacy semantic task owner)

`companion-runtime` emits a **text-only** `CompletedTurn` (assistant_message +
beats + execution_metadata); there is no structured action channel today. Its
generation is streaming text over raw HTTP to OpenRouter/Venice/etc. with a
fallback chain, in Python.

## Decision: Option B — app-side deterministic semantic owner

**Chosen: B** (app-side interpreter), anchored to the visible reply, with the
deterministic gates from `interpreter.ts`.

Rationale:
- Option A (runtime emits `proposed_actions`) would require a second structured
  model emission inside the streaming-text Python pipeline (or a second call
  inside the runtime), plus contract/schema churn in the 208-test runtime —
  disproportionate to a pipe that already owns text-only generation and dual
  fallback paths.
- The app runs the interpreter only AFTER the visible reply exists and passes
  the actual `assistantText` + bounded recent conversation to it, with an
  explicit normative instruction ("Sophie's visible reply is authoritative:
  if she already handled/refused/asked, emit nothing"). This avoids a second
  model contradicting the visible reply without any Python changes.
- Both reply engines (runtime and TS fallback) flow through the same
  deterministic commit path — Option A would only cover one.
- `interpreter.ts` already implements the model-proposes/code-commits gates.

## Proposed exact flow (new)

```
app message id (message.id)
  -> reply (runtime | TS fallback)  [unchanged]
  -> after(): commitTurnSemantics({
       userId, chatId, messageId, userText (currentUserText),
       assistantText (finalText), localTime, timeZone,
       recentContext (boundedEpistemicContext(uiMessages))
     })
      1. roster = listTasksForUser(userId, {status:'pending'})
      2. runCommitmentInterpreter(...)   [LLM proposes; injectable seam]
      3. commitInterpreterActions(...)   [code commits]
         - deterministic binding guard (resolveDestructiveBinding)
         - evidence-verbatim gate
         - message-scoped ledger idempotency (TurnAction pre-check)
         - create uses fast candidate key (retry-safe, Fix-3 idempotency)
         - TurnAction recorded via domain
  -> legacy captureExplicitTasks retired (no longer called)
```

## Files/contracts affected

- `lib/ai/interaction/interpreter.ts` — add `recentContext` to prompt, binding
  guard, ledger idempotency, fast candidate key, `sourceMessageId`.
- `lib/ai/interaction/commit-turn.ts` (new) — `commitTurnSemantics` orchestration.
- `app/(chat)/api/chat/route.ts` — call `commitTurnSemantics` in `after()`;
  remove `captureExplicitTasks` call/import.
- `scripts/tasks-fast-path-test.ts` (new) — Checkpoint 2 acceptance harness
  (deterministic `generate` injection; real domain/DB/ledger path).
- `tests/unit/*` — hermetic tests for the pure binding guard.

## Reuse from interpreter.ts

All of it: schemas, `runCommitmentInterpreter` (add recentContext), chip
helpers, `commitInterpreterActions` gates. No new second interpreter.

## Main risks

- Model binding wrong target on pronouns -> mitigated by deterministic
  `resolveDestructiveBinding` (fail closed to a clarification when the target
  is not lexically/contextually anchored and roster > 1).
- Retry duplication -> TurnAction message-scoped ledger pre-check + fast
  candidate key create idempotency.
- Latency/cost of one extra small model call per turn -> parity with the
  retired `captureExplicitTasks`; bounded 8s timeout, fail-open.

## Chosen/why

B. Non-invasive, uniform across both reply engines, reuses the existing
interpreter, and satisfies "model proposes, code commits."

## State

- HEAD: 5056bda (Checkpoint 1 repairs)
- Fixed invariants: user-owned Tasks; nullable chatId provenance; cross-chat
  ops; chatless/manual tasks; single proactive scheduler; model proposes/code
  commits; TurnAction ledger; candidate materialization idempotency.
- COMPLETED:
  - Checkpoint 1 (repairs) — 5056bda.
  - Checkpoint 2 (semantic ownership + fast path) — 20f3f0a. Option B (app-side
    interpreter anchored to the visible reply); commitTurnSemantics;
    resolveDestructiveBinding guard; message-scoped ledger idempotency; fast
    create candidate key; captureExplicitTasks retired as the semantic owner.
  - Checkpoint 3 (fast/slow Cortex reconciliation) — commits:
    - outbox enqueue stores app_message_id; deliverOnce resolves the app
      message's TurnAction ledger at delivery time into `materialized_actions`
      on the /v1/events/turn payload (cortex suppress contract already live).
    - acceptance harness scripts/tasks-reconciliation-test.ts (create slow-pass,
      completion slow-pass, candidate promotion -> one Task, enqueue+delivery
      retry convergence, app message id travel).
  - Checkpoint 4 (Things UI) — committed:
    - app/(chat)/things page + components/things/things-screen (first-class
      minimal surface: list/add/edit/complete/cancel/snooze/reschedule,
      chatless manual create, user-level cross-chat list, no projects/tags).
    - sidebar nav link; tests/routes/things.test.ts (CI; auth-guard, CRUD,
      ownership isolation at the HTTP boundary).
  - Checkpoint 5 (Sophie noticed) — IN PROGRESS, committed next:
    - lib/synapse-cortex.ts: listCommitmentCandidates + markCommitmentCandidate
      (owner-scoped against Cortex /v1/cortex/commitment-candidates).
    - app/api/tasks/candidates (+promote/dismiss): list pending candidates;
      promote = create canonical Task (source sophie_accepted,
      materializedCandidateKey=key -> retry idempotent) + mark materialized
      with source_object_id; dismiss durable (Cortex refuses resurrection).
    - Things UI "Sophie noticed" panel, clearly separate from canonical tasks.
    - tests/routes/candidates.test.ts (401 guards, fail-open available:false,
      malformed keys). Proven live against a running local Cortex: list/promote/
      idempotent re-promote/dismiss/no-reappear.
- Known failures: 3 pre-existing unrelated unit tests (agent-tool-schema:6,
  agent-ash:185, research-policy:441) — do not fix unless touched.
- CURRENT: Checkpoint 6 (behavioural/E2E hardening) — pending.
- NEXT: Checkpoint 6 real messy-scenario harness -> final report.