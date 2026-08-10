# Relationship initiative prototype

This in-repo runtime tests whether Sophie feels more alive when she can have a separate afterthought or speak after an active chat has gone quiet. It is intentionally not a scheduler, notification service, friendship score, onboarding questionnaire, or knowledge graph.

## Ownership

- PostgreSQL is canonical for initiative attempts, decisions, messages, dedupe state and reply attribution.
- Honcho provides targeted, fallible evidence about the user. It does not decide timing or schedule outreach.
- The evaluator decides whether there is a reason to act and may return no action.
- The composer expresses one short message in Sophie's voice. Curiosity is judged by conversational coherence, not question-mark count.
- The browser supplies `post_turn` and `active_idle` triggers only. The server revalidates every condition.

## Behaviour

After a normal streamed reply finishes, the client waits about 2.8 seconds and submits a `post_turn` trigger anchored to that assistant message. An open chat that remains idle for about five minutes submits `active_idle`. If the user sends anything or another message appears, the anchor is stale and the server suppresses the initiative.

The server checks ownership, the latest canonical message, minimum idle duration, daily limits, unanswered count and a unique trigger/anchor key. It retrieves a compact Honcho evidence packet, evaluates a structured candidate, applies topic, departure and sensitive-content policy, composes the message, rechecks the anchor in the insertion transaction and persists an ordinary `Message_v2` assistant message. The UI appends the returned canonical message; reloads retrieve it normally.

`RelationshipInitiative` records sent, declined, suppressed and failed evaluations, including trigger, kind, reason, topic key, evidence, guidance, generated message and subsequent direct reply. This is enough to inspect why Sophie spoke and whether the user responded.

Each evaluation also records a semantic conversational orientation and a relational posture: `hold`, `ask`, or `nudge`. Ask means active conversational expansion and is normal for social connection. It may be one question, several linked questions, an observation, playful provocation, remembered connection, new topic or invitation; it must not collapse into an interview or profile-extraction checklist. Hold is a positive contextual decision—not a default—and requires explicit justification such as storytelling, emotional disclosure or a request for listening. It can still be warm and substantive. Nudge requires high confidence, explicit justification and supporting evidence, but may be an observation rather than advice. The posture shapes composition but never overrides a user task. Social connection and company are valid orientations even when no task exists.

## Restraint defaults

- Eight total sent initiatives per UTC database day, of which at most four may be active-idle outreach
- One unanswered initiative may receive one later follow-up after a stable per-conversation gap of roughly 25–75 minutes
- Two unanswered initiatives stop further outreach until the user replies
- The existing evaluator semantically classifies conversational availability as `open`, `closing`, `reopened`, `paused`, `busy`, `seeking_company`, or `unclear`; deterministic policy suppresses sufficiently confident closing/paused/busy states
- Boundary interpretation works on meaning in the original language—there is no goodbye phrase list, translation step or language-specific keyword matching
- Local time is supplied to the evaluator so social evening conversations can support warmer, more personal curiosity
- Recent topic-key dedupe
- Sensitive candidates require supporting memory evidence
- 420 characters maximum; no mechanical question-count cap
- All model, Honcho and persistence errors fail closed

## Models and tuning

Both evaluator and composer default to `deepseek/deepseek-v4-flash`. Configure them independently with `RELATIONSHIP_EVALUATOR_MODEL` and `RELATIONSHIP_COMPOSER_MODEL`. Other timing and restraint controls are listed in `.env.example`.

For faster local testing, set `RELATIONSHIP_IDLE_MS` to a smaller server value. The browser currently uses the product experiment's five-minute idle trigger, so test turn-tail normally or temporarily adjust the client constant on a disposable local test branch if sub-five-minute idle testing is required.
