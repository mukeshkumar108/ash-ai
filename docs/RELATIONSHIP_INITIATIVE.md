# Relationship initiative prototype

This in-repo runtime tests whether Sophie feels more alive when she can have a separate afterthought or speak after an active chat has gone quiet. It is intentionally not a scheduler, notification service, friendship score, onboarding questionnaire, or knowledge graph.

## Ownership

- PostgreSQL is canonical for initiative attempts, decisions, messages, dedupe state and reply attribution.
- Honcho provides targeted, fallible evidence about the user. It does not decide timing or schedule outreach.
- The evaluator decides whether there is a reason to act and may return no action.
- The composer expresses one short message in Sophie's voice with at most one question.
- The browser supplies `post_turn` and `active_idle` triggers only. The server revalidates every condition.

## Behaviour

After a normal streamed reply finishes, the client waits about 2.8 seconds and submits a `post_turn` trigger anchored to that assistant message. An open chat that remains idle for about five minutes submits `active_idle`. If the user sends anything or another message appears, the anchor is stale and the server suppresses the initiative.

The server checks ownership, the latest canonical message, minimum idle duration, daily limit, recent unanswered initiative and a unique trigger/anchor key. It retrieves a compact Honcho evidence packet, evaluates a structured candidate, applies topic and sensitive-content policy, composes the message, rechecks the anchor in the insertion transaction and persists an ordinary `Message_v2` assistant message. The UI appends the returned canonical message; reloads retrieve it normally.

`RelationshipInitiative` records sent, declined, suppressed and failed evaluations, including trigger, kind, reason, topic key, evidence, guidance, generated message and subsequent direct reply. This is enough to inspect why Sophie spoke and whether the user responded.

## Restraint defaults

- Three sent initiatives per UTC database day
- Twelve-hour suppression after an unanswered initiative
- Recent topic-key dedupe
- Sensitive candidates require supporting memory evidence
- One question maximum and 420 characters maximum
- All model, Honcho and persistence errors fail closed

## Models and tuning

Both evaluator and composer default to `deepseek/deepseek-v4-flash`. Configure them independently with `RELATIONSHIP_EVALUATOR_MODEL` and `RELATIONSHIP_COMPOSER_MODEL`. Other timing and restraint controls are listed in `.env.example`.

For faster local testing, set `RELATIONSHIP_IDLE_MS` to a smaller server value. The browser currently uses the product experiment's five-minute idle trigger, so test turn-tail normally or temporarily adjust the client constant on a disposable local test branch if sub-five-minute idle testing is required.
