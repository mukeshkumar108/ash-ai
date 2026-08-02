# RPD2 Research and Change Log

RPD2 is the test bed for companion continuity, retrieval, relationship
behaviour, model routing, and interface experiments that may later inform
Synapse and Sophie. It is not Sophie and should not inherit Sophie's full
complexity.

This log records why material changes are made, what evidence motivated them,
how they were tested, and what remains uncertain. Add new entries at the top.

## 2026-07-30 — Research programme baseline

### Product problems in scope

- Important incidents are flattened into vague or sympathetic prose.
- People and their histories can disappear or become misattributed.
- Stored memory can fail at capture, persistence, retrieval, prompt rendering,
  or response use, while all five failures appear to the user as "forgetting."
- Multiple overlapping continuity representations increase token cost and make
  it difficult to identify the source of truth.
- A failed model stream can leave the interface with no visible reply or useful
  recovery action.
- Model aliases obscure which provider is actually serving a request.
- Long message lists and overlapping UI state can feel slow or fail to display
  the latest server-persisted response.

### Changes made

1. Exhausting every chat-model candidate now fails the UI stream explicitly
   instead of ending successfully with no assistant content.
2. The chat interface now keeps an inline, accessible error with a retry action;
   the user's already-persisted message is not silently discarded.
3. Slash-containing model IDs are no longer automatically routed to NanoGPT.
   Only explicitly registered NanoGPT IDs use NanoGPT; other IDs follow the
   configured Venice/OpenRouter route.
4. This research/change log was introduced.
5. Removed the legacy artifact data-stream runtime and document/weather tool
   rendering from companion chat. Image sharing remains supported and the file
   chooser is restricted to JPEG and PNG.
6. Replaced inherited generic-chatbot metadata with companion-product metadata.
7. Extended continuity events with optional objective record, per-actor
   perspectives, responsibility, consequences, source-message IDs, and scene
   linkage. Extended person models with stable identity and provenance fields
   while remaining compatible with existing stored JSON.
8. People now merge through names and aliases into a stable server-owned
   `person_id`, accumulating behaviours, evidence, linked incidents, status,
   and trajectory instead of being recreated on each extraction.
9. Prompt retrieval ranks explicitly mentioned people first and caps the people
   block rather than injecting the entire registry.
10. Scene changes now supersede the prior active scene frame in the ontology.
    The previous frame remains inspectable history while only the new frame is
    active.
11. Removed the public document and suggestion API routes and the unused
    document, suggestion, and weather AI tools. Image upload remains.
12. Third-party mode now requires explicit relational permission. Genre words,
    narrator instructions, NPC dialogue, and terms such as "hotwife",
    "cuckold", "breed", or "watch" cannot open the relationship.
13. Generation guidance now treats action as distinct from identity. A
    character-inconsistent act creates dissonance, responsibility, and an open
    repair thread; it cannot silently rewrite immutable love, loyalty, or
    relational priority.
14. Background memory patches pass through a deterministic authority gate.
    Behaviour, arousal, silence, repetition, and model prose cannot create
    relationship rules, agreements, boundaries, durable desires, or fantasies.
15. Repair remains unresolved across apologies, guilt, calmer scenes, personal
    growth, and time jumps. Only explicit user evidence can establish
    forgiveness or closure.
16. Existing memories self-heal the specific legacy inference patterns that
    created implicit affairs, erased fidelity boundaries, or treated performed
    behaviour as evidence of durable desire. Objective incidents remain.

### Why

The previous route logged `chat-models-exhausted` and then returned normally.
That made an operational failure indistinguishable from a valid empty response.
The client watchdog could only reconcile a response if one had actually been
persisted, so it could not repair this case.

The broad `modelId.includes('/')` NanoGPT rule also meant a newly added
OpenRouter-style ID silently changed provider whenever a NanoGPT key existed.
Provider routing must be explicit and inspectable.

### Verification

- Type-check the route and client changes.
- Run focused unit tests and the production build.
- Manually test a forced provider failure and confirm that the inline retry
  state appears without losing the user message.
- Production build before legacy runtime removal: `/chat/[id]` approximately
  839 kB first-load JavaScript.
- Production build after removal: `/chat/[id]` approximately 471 kB, a reduction
  of about 44%.

### Remaining questions

- The UI still needs measured profiling before broad React refactoring.
- Provider health and fallback latency need structured telemetry.
- A cross-provider fallback policy should be explicit configuration rather than
  inferred from available environment variables.

## Research roadmap

### Phase 1 — Observability and reliability

- Record capture, persistence, retrieval, prompt inclusion, and response-use as
  separate stages.
- Give each generation a request ID, provider/model route, first-token latency,
  total latency, fallback reason, and terminal outcome.
- Add a continuity inspector that links injected records to source messages.
- Profile initial chat load, long-thread rendering, scrolling, and stream
  reconciliation before changing UI architecture.

### Phase 2 — Canonical continuity

- Introduce a stable people registry with aliases and source-message evidence.
- Introduce explicit scene boundaries and scene participation.
- Store objective incidents separately from claims, interpretations, emotional
  meaning, responsibility, and relationship consequences.
- Append reframes and resolutions; never rewrite the original incident.
- Converge extraction on one structured observation pipeline.

### Phase 3 — Retrieval policy

- Always include the immutable relationship contract and current scene.
- Retrieve people, incidents, commitments, and unresolved threads according to
  relevance and relational importance.
- Apply an explicit token budget with observable inclusion and eviction reasons.
- Keep generated prompt prose disposable; structured records remain canonical.

### Phase 4 — Evaluation

- Run 25, 100, 250, 500, and 1,000-turn simulations.
- Measure capture recall, retrieval recall, actor attribution, person survival,
  contradiction rate, premature resolution, relational-priority failures,
  prompt tokens, latency, and cost.
- Compare current RPD2, GlasHaus, and hybrid retrieval/storage approaches.

### Phase 5 — Evidence-based proactivity

- Generate proactive candidates from commitments, upcoming events, unresolved
  ruptures, interrupted emotional scenes, and explicit companion intentions.
- Require source evidence, a timing reason, relational intention, freshness
  validation, repetition checks, and quiet-hours policy.
- Treat silence as a valid outcome.

## JanitorAI Scripts: lessons to test

JanitorAI's scripts expose a useful product idea: deterministic rules can
activate small pieces of lore or behaviour based on conditions, triggers, and
message context. For RPD2 this should become an inspectable **context policy**
layer, not canonical memory and not arbitrary creator JavaScript.

Potential experiment:

```text
stored canon
  -> current message and scene signals
  -> deterministic activation rules
  -> ranked context candidates
  -> token-budgeted prompt packet
  -> activation receipts in the inspector
```

Useful properties:

- Small atomic injections rather than permanent prompt bloat.
- Priority, exclusions, minimum evidence, and scene/person filters.
- Debug output showing exactly which rule activated and why.
- Templates that non-engineers can configure safely.

Do not copy:

- Keyword matching as the primary memory mechanism.
- State hidden inside prompt text.
- Rules that run independently and race to rewrite the same scenario.
- Unbounded lore activation.
- Companion-authored facts without source evidence.

The first test should compare deterministic activation against semantic
retrieval for NPC re-entry, unresolved incidents, commitments, and scene
transitions.
