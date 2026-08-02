# Relational Memory Architecture

This document explains how chat memory, active scene state, relationship dynamics, continuity events, and state-change detection currently work in this repo, why the system is shaped this way, and how to debug it when a conversation feels wrong.

## Goals

This product is trying to support:

- per-chat continuity only
- no memory bleed across different chats
- no memory bleed across different characters
- believable relational continuity inside one chat
- strong recall for major events, promises, emotional turns, and introduced people
- faster, more text-like responses without losing scene coherence

The current architecture is intentionally layered so we can improve recall and testing without throwing away the existing memory pipeline.

## Current Layers

### Canonical ownership rule

The v2 ontology stored through the existing `continuityEvents` persistence
boundary owns durable people, objective incidents, interpretations, open loops,
and scene chronology. Do not add a parallel people or scene store.

- People have stable IDs and aliases; later mentions merge into the same record.
- Objective incidents and participant interpretations are separate records.
- Evidence retains source excerpts or message references.
- A scene change supersedes the previous active scene frame instead of erasing
  it. Superseded frames remain chronology but are not injected as current state.
- Generated summaries and prompt prose are disposable views, never canon.

### 1. Character Kernel

Source of truth:

- `/Users/mukeshkumar/play/rpd2/lib/ai/characters.ts`

Purpose:

- fixed identity
- backstory
- relationship premise
- voice rules
- explicit behavior rules

Important rule:

- do not casually rewrite this file during unrelated prompt work

### 2. System Prompt Assembly

Main file:

- `/Users/mukeshkumar/play/rpd2/lib/ai/prompts.ts`

Current order:

1. character kernel
2. universal rules
3. response-style instruction
4. language instruction
5. request hints

Why:

- the character identity should anchor before generic rules
- generic rules should act as guardrails, not flatten the character

### 3. Durable Chat Memory

Main files:

- `/Users/mukeshkumar/play/rpd2/lib/ai/summarizer.ts`
- `/Users/mukeshkumar/play/rpd2/lib/ai/memory-utils.ts`
- `/Users/mukeshkumar/play/rpd2/app/(chat)/api/chat/route.ts`

Purpose:

- capture durable continuity within a single chat thread
- preserve major facts and relationship developments

Current durable memory fields:

- `summary`
- `core_facts`
- `relationship_milestones`
- `major_events`
- `emotional_turns`
- `promises_and_commitments`
- `relationship_state`
- `emotional_state`
- `user_preferences`
- `shared_memories`
- `hidden_fantasies`
- `characters_and_npcs`
- `significant_incidents`
- `corruption_level`
- `open_emotional_threads`
- `resolved_threads`
- `recent_scene_recap`

Why this changed:

- the older memory schema was too vague
- important events were being lost because fields like `significant_incidents` were too broad
- recent major events could be missed even a few turns later

### 4. Active State Packet

Main file:

- `/Users/mukeshkumar/play/rpd2/lib/ai/active-state.ts`

Purpose:

- represent the present-tense scene and emotional momentum
- give the model a lighter-weight “what is happening right now?” packet
- reduce drift inside the immediate scene

Current active-state fields:

- `scene_mode`
- `location`
- `time_of_day`
- `current_activity`
- `primary_mood`
- `visible_emotion`
- `hidden_emotion`
- `emotional_direction`
- `relationship_temperature`
- `trust_level`
- `affection_level`
- `conflict_level`
- `attraction_level`
- `need_for_reassurance`
- `what_they_want`
- `what_they_are_avoiding`
- `likely_next_move`
- `current_boundary`
- `tone`
- `message_length`
- `directness_level`
- `playfulness_level`
- `warmth_level`
- `scene_locks`

Important:

- this is not durable canon
- this is volatile scene-state
- it can change much more often than durable chat memory

### 5. Relationship Dynamics

Main file:

- `/Users/mukeshkumar/play/rpd2/lib/ai/continuity.ts`

Purpose:

- represent the slower-moving emotional trajectory of the relationship
- make the character feel less emotionally reset between scenes
- preserve realism in trust, jealousy, vulnerability, attachment, and reassurance

Current relationship-dynamics fields:

- `emotionalIntimacy`
- `romanticAttachment`
- `trust`
- `affection`
- `attraction`
- `conflict`
- `jealousy`
- `insecurity`
- `playfulness`
- `vulnerability`
- `reassuranceNeed`
- `commitmentOrientation`

Important:

- this is not raw scene state
- this is not hard canon fact storage
- these values guide emotional trajectory and are updated using small clamped deltas

### 6. Continuity Events

Main file:

- `/Users/mukeshkumar/play/rpd2/lib/ai/continuity.ts`

Purpose:

- preserve must-not-forget beats
- improve long-form continuity without sending the full transcript
- distinguish factual, claimed, hidden, uncertain, and fantasy beats

Current continuity-event fields:

- `chatId`
- `turnStart`
- `turnEnd`
- `type`
- `summary`
- `participants`
- `entities`
- `truthStatus`
- `emotionalImpact`
- `relationshipImpact`
- `importance`
- `unresolved`
- `createdAt`

Important:

- continuity events are selective, not a full chapter system
- they should capture major beats, not every tiny exchange
- they are treated as must-not-contradict unless truth status says otherwise

### 7. State Judge

Main file:

- `/Users/mukeshkumar/play/rpd2/lib/ai/active-state.ts`

Purpose:

- inspect recent turns
- decide whether enough changed to justify an active-state refresh
- provide a foundation for smarter future memory updates

Current judge outputs:

- `has_scene_change`
- `has_mood_change`
- `has_new_person`
- `has_major_event`
- `has_new_commitment`
- `has_boundary_change`
- `has_thread_change`
- `requires_active_state_update`
- `requires_chat_memory_update`
- `confidence`
- `reason`

## How It Works In The Chat Route

Main runtime:

- `/Users/mukeshkumar/play/rpd2/app/(chat)/api/chat/route.ts`

Current runtime flow:

1. load messages for the current `chatId`
2. sanitize the new incoming user message
3. build the current conversation window
4. measure approximate size/salience
5. load persisted durable memory and persisted active state from the `Chat` row
6. load persisted relationship dynamics and continuity events from the `Chat` row
7. run the state judge on a recent window
8. refresh durable memory periodically or when judge says it changed
9. refresh active state periodically or when judge says it changed
10. update relationship dynamics when the recent exchange materially shifts emotional trajectory
11. extract continuity events only when the judge flags meaningful changes
12. persist any updated state back onto the `Chat` row
13. inject:
   - durable memory
   - active state
   - relationship dynamics
   - top continuity events
   - recent raw turns
14. send to the response model

## Why Structured Memory Still Runs As A Refresh Mechanism

This is still deliberate.

We now persist durable structured memory and active state onto the `Chat` row. But structured extraction still runs as a refresh mechanism because:

- long chats still benefit from periodic consolidation
- the judge can miss gradual drift
- we do not yet have separate scene snapshots or an event log

Current hybrid architecture:

1. persisted per-chat durable memory
2. persisted per-chat active state
3. persisted per-chat relationship dynamics
4. persisted per-chat continuity events
5. judge every turn
6. update on change or periodic cadence
7. keep structured extraction as a refresh/backstop path

## Current Refresh Cadence

Environment variables used:

- `MEMORY_SLICE`
- `MEMORY_MIN_TURNS`
- `MEMORY_MIN_TOKENS`
- `MEMORY_MIN_SALIENCE`
- `MEMORY_LAST_K_MAX`
- `ACTIVE_STATE_REFRESH_TURNS`
- `ACTIVE_STATE_WINDOW_MESSAGES`

Defaults:

- `ACTIVE_STATE_REFRESH_TURNS = 3`
- `ACTIVE_STATE_WINDOW_MESSAGES = 8`

Current policy:

- active state is refreshed every few assistant turns as a periodic safety net
- active state also refreshes when the judge says the current scene changed enough
- durable structured memory is persisted and refreshed periodically or when the judge detects meaningful change
- relationship dynamics are nudged with small clamped deltas instead of total rewrites
- continuity events are extracted only when the judge flags meaningful continuity changes

## Continuity Pipeline Invariants (post-fix)

Refresh scheduling (`lib/ai/chat-continuity.ts`):

- the single refresh counter is `assistantTurnCount` (assistant messages with
  non-empty content).
- refreshes run on **elapsed** turns since the last successful refresh
  (`turnsSinceLastRefresh >= UNIFIED_REFRESH_TURNS`), never modulo arithmetic,
  so a missed or failed refresh stays eligible on every later turn.
- per-chat refreshes are serialised in-process (`serializeRefresh`) AND guarded
  by an optimistic-lock sequence number (`Chat.continuity_seq`) so a stale
  background write is dropped, never applied.

Patch semantics (`lib/ai/summarizer.ts`):

- a missing patch field means NO_CHANGE; an explicit empty array never clears
  established canon.
- agreements / rules / boundaries persist until an explicit ADD, UPDATE, REVOKE,
  SUPERSEDE, or RESOLVE.
- `revoke_*` patch fields remove only exact, case-insensitive statements.
- low-information state values ("Early interaction.", defaults) never overwrite
  established `summary` / `relationship_state` / `emotional_state`.

Actuality (`lib/ai/continuity.ts`):

- content type is not actuality. Narrated in-roleplay events are
  `RP_CANON_EVENT` and persist even when fictional in the real world or
  explicit. Character claims/lies persist as claims only.

Scope / expiry:

- consequential events (betrayal, disclosure, departure, separation, agreement,
  violation, engagement, death, injury, identity revelation, etc.) are
  normalised to `durable`/`arc` scope; scene expiration only touches
  `scope === 'scene'` items.

Provenance (`guardProvenance`):

- assistant-authored historical claims cannot become durable canon on the
  strength of a shared name. Unsupported history → provisional; a claim that
  directly contradicts canon → rejected; new present-tense narration → allowed.
- contradiction detection is a conservative, generic secondary layer
  (relationship-role incompatibility, explicit negation, death-vs-alive).

Selection (`lib/ai/compiler.ts` / `selectContinuityFactsForPrompt`):

- category budgets reserve slots for durable history, the relationship
  constitution, arc development, and only then recent scene facts.
- exact-entity retrieval: when the user names a known person, their person model
  and linked facts are pulled into the packet; unknown capitalized names trigger
  a "do not invent a backstory" instruction.

Canon source of truth:

- the v2 `continuityEvents` container (items / events / personModels /
  relationship / refreshSeq) is canonical; `memoryState` constitution arrays are
  derived from it via `deriveConstitutionFromOntology`.

## No Cross-Chat Memory Rule

This product should behave like:

- one chat = one continuity thread
- new chat = fresh start
- switching characters for a new chat must not inherit another thread
- reopening an existing chat should continue that specific chat only

Files relevant to this:

- `/Users/mukeshkumar/play/rpd2/app/api/chat/jump/route.ts`
- `/Users/mukeshkumar/play/rpd2/components/home-screen.tsx`

Important fix already made:

- switching characters from the home/new-chat flow now forces a fresh `chatId`
- this was necessary because character-switching could otherwise carry over the previous active client thread

## Debugging When Things Feel Off

### Symptom: character sounds wrong

Check:

- is the correct `characterId` being sent?
- is the character kernel intact?
- is the character being drowned by generic prompt text or memory?

Relevant files:

- `/Users/mukeshkumar/play/rpd2/app/(chat)/api/chat/schema.ts`
- `/Users/mukeshkumar/play/rpd2/lib/ai/prompts.ts`
- `/Users/mukeshkumar/play/rpd2/lib/ai/characters.ts`

### Symptom: major event forgotten quickly

Check:

- did it make it into `major_events`, `emotional_turns`, `promises_and_commitments`, or `do_not_forget`-style fields?
- did the recent scene recap capture it?
- did the extractor collapse it into a vague summary?

Relevant files:

- `/Users/mukeshkumar/play/rpd2/lib/ai/summarizer.ts`
- `/Users/mukeshkumar/play/rpd2/lib/ai/memory-utils.ts`

### Symptom: different chats feel contaminated

Check:

- whether the user is really in a new `chatId`
- whether the home flow reused the same chat session
- whether a history click reopened an existing chat instead of starting a new one

Relevant files:

- `/Users/mukeshkumar/play/rpd2/components/home-screen.tsx`
- `/Users/mukeshkumar/play/rpd2/app/api/chat/jump/route.ts`

### Symptom: responses feel too story-like

Check:

- system-level response style rules
- scene-button directives
- active-state `message_length`
- whether the model is in an in-person/intimate scene mode instead of texting mode

Relevant files:

- `/Users/mukeshkumar/play/rpd2/lib/ai/prompts.ts`
- `/Users/mukeshkumar/play/rpd2/components/multimodal-input.tsx`
- `/Users/mukeshkumar/play/rpd2/lib/ai/active-state.ts`

## Dev Inspection Route

Dev-only route:

- `/Users/mukeshkumar/play/rpd2/app/api/memory/preview/route.ts`

What it returns in development:

- plain summary
- persisted memory
- persisted active state
- persisted relationship dynamics
- persisted continuity events
- structured memory
- state judge output
- active state packet
- top continuity events
- assembled runtime packet
- prompt sections used to reason about continuity

Use this when testing a specific `chatId` to inspect whether:

- the durable memory looks right
- the active state reflects the current scene
- the emotional trajectory values look sane
- major beats are actually being captured as continuity events
- the judge is detecting meaningful change

## Known Limitations

1. Durable memory, active state, relationship dynamics, and continuity are stored
   as JSON on the `Chat` row, not yet in dedicated normalized tables. The
   `continuityEvents` column uses a versioned v2 wrapper containing `items`,
   `events`, `relationship`, and `personModels`; updates must preserve every
   member of that wrapper.
2. Structured memory still acts as a refresh backstop instead of being fully event-driven.
3. We persist the current scene frame and a lightweight person model registry,
   but not a complete sequence of historical scene snapshots.
4. Continuity events improve recall, but they are not yet a full event timeline UI.
5. If a model extracts state badly, prompt architecture alone cannot save it.

## Recommended Next Steps

1. Add scene snapshots / transitions for very long multi-scene chats
2. Add a stronger explicit NPC registry
3. Reduce durable memory re-extraction frequency once judge-driven updates prove stable
4. Add a proper structured debug surface in the app instead of relying only on raw preview JSON
5. Add telemetry around:
   - memory update frequency
   - judge trigger reasons
   - recall failures
   - scene-mode distribution
6. Add a richer dev inspector for before/after state diffs

## Rule Of Thumb

When behavior feels wrong, ask:

1. Is this a character problem?
2. Is this a durable memory problem?
3. Is this an active scene-state problem?
4. Is this a client session/thread isolation problem?
5. Is this a model selection / refusal / formatting problem?

That breakdown is the fastest way to debug this system.

## Relational Integrity Invariant

All companion characters share one behavioral authority order:

1. the user's explicit words, agency, dignity, and consent
2. objective established events and agreements
3. the character's immutable love and romantic choice of the user
4. honest consequences, accountability, and repair
5. character voice, scene momentum, and NPC dynamics

Immutable devotion does not retcon behavior or excuse harm. Narrating an event
does not establish that the user's in-world character approved it. Character
kernels may vary in voice, guilt style, and openness to user-directed
exploration, but they cannot replace the user with an NPC, invent permission,
or turn accountability into a victory condition.

Relationship rupture is not roleplay termination. Inside the story, breakup
language, expulsion from a scene, and demands for no contact express the user's
justified anger and the severity of the rupture; they do not release the
companion from durable love or the obligation to fight for the relationship.
The companion may leave the immediate space, but must continue accountable
pursuit through changed behavior, persistence, and concrete action rather than
noble withdrawal, moving on, or a private redemption arc. Only an explicit
out-of-character command terminates this logic.

The extractor never owns continuity IDs. Existing items are presented to the
model as short request-local aliases (`c1`, `c2`, and so on), which are resolved
back to server-owned IDs after structured output validation. Persisted legacy
IDs are length-checked and repaired deterministically so malformed identifiers
cannot recursively consume the extractor's output budget.
