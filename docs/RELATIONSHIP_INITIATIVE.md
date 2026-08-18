# Relationship initiative prototype

This in-repo runtime tests whether Sophie feels more alive when she can have a separate afterthought or speak after an active chat has gone quiet. It is intentionally not a scheduler, notification service, friendship score, onboarding questionnaire, or knowledge graph.

## Ownership

- PostgreSQL is canonical for initiative attempts, decisions, messages, dedupe state and reply attribution.
- Honcho provides targeted, fallible evidence about the user. It does not decide timing or schedule outreach.
- The evaluator decides whether there is a reason to act and may return no action.
- The composer expresses one short message in Sophie's voice. Curiosity is judged by conversational coherence, not question-mark count.
- The browser may supply `active_idle`; an authenticated Vercel cron supplies bounded `server_scan` and `ambient_scan` wake-ups. The server revalidates every condition. The former blind 2.8-second `post_turn` trigger is no longer emitted by the client.

## Behaviour

An open chat that remains idle for about five minutes may submit `active_idle`. Independently, a cron scan inspects the single most recently active eligible chat per user. It may evaluate when Cortex supplies a canonical continuity candidate or during the deliberately narrow 18:00–22:00 local ambient window. The window is permission to consider the moment, not an instruction to ask about the day. If the user sends anything or another message appears, the anchor is stale and the server suppresses the initiative.

Each cron invocation considers at most five users by default and has a five-minute function budget. This keeps the sequential editorial/composer path bounded while remaining ample for the current dogfood population.

The server checks ownership, the latest canonical message, minimum idle duration, daily limits, unanswered count and a unique trigger/anchor or daily ambient key. The evaluator receives a compact situational packet containing explicit local date/time, weekday, numeric hour, daypart, elapsed interaction time, today's bounded conversation, interaction count, first-interaction evidence, optional trusted harness facts and existing Cortex continuity. It applies topic, departure, quiet-time, repetition and sensitive-content policy, composes the message, rechecks the anchor in the insertion transaction and persists an ordinary `Message_v2` assistant message. An open writable chat polls its existing ownership-checked message endpoint every 20 seconds while visible and ready, and also reconciles on focus, so server-created messages appear without reload and merge by message ID.

“How was your day?” is not tied to first interaction. It is unavailable as an automatic ambient reason before 18:00, may be considered in the evening whether or not this is the first interaction, and must be skipped when today's conversation already covered the day. A user-wide local-date ambient dedupe key permits at most one evaluation of that automatic opportunity per day. Stable facts and routines are evidence, not obligations; `UNKNOWN` remains unknown.

`RelationshipInitiative` records sent, declined, suppressed and failed evaluations, including trigger, kind, reason, topic key, evidence, guidance, generated message and subsequent direct reply. This is enough to inspect why Sophie spoke and whether the user responded.

The evaluator also derives an active conversational beat from the latest ordinary or proactive assistant message. It records a compact summary, whether that beat is awaiting a user response, the proposed next beat, whether it is new, extending or repetitive, and why it adds new value. Semantic paraphrases and intensified retries are suppressed. A bounded lexical-topic overlap check provides a deterministic second guard after composition.

Each evaluation also records a semantic conversational orientation and a relational posture: `hold`, `ask`, or `nudge`. Ask means active conversational expansion and is normal for social connection. It may be one natural question or no question at all—an observation, playful provocation, remembered connection, new topic or invitation can carry the beat. It must not stack questions into an interview or append one merely to sustain engagement. Hold is a positive contextual decision—not a default—and requires explicit justification such as storytelling, emotional disclosure or a request for listening. It can still be warm and substantive. Nudge requires high confidence, explicit justification and supporting evidence, but may be an observation rather than advice. The posture shapes composition but never overrides a user task. Social connection and company are valid orientations even when no task exists.

## Restraint defaults

- 24 total sent initiatives per database day, of which at most 16 may be active-idle/ambient outreach; these are emergency ceilings, not target cadence
- One unanswered initiative may receive one later follow-up after a stable per-conversation gap of roughly 25–75 minutes
- Two unanswered initiatives stop further outreach until the user replies
- The existing evaluator semantically classifies conversational availability as `open`, `closing`, `reopened`, `paused`, `busy`, `seeking_company`, or `unclear`; deterministic policy suppresses sufficiently confident closing/paused/busy states
- Boundary interpretation works on meaning in the original language—there is no goodbye phrase list, translation step or language-specific keyword matching
- Local time is supplied to the evaluator so social evening conversations can support warmer, more personal curiosity
- Recent topic-key dedupe
- Sensitive candidates require supporting memory evidence
- 420 characters maximum; no mechanical question-count cap. Composition prefers one clear entry point and avoids stacked/interview-style questions.
- Continuity events are candidates rather than automatic messages; `act=false` is normal
- All model, Honcho and persistence errors fail closed

## Models and tuning

Both evaluator and composer default to `deepseek/deepseek-v4-flash`. Configure them independently with `RELATIONSHIP_EVALUATOR_MODEL` and `RELATIONSHIP_COMPOSER_MODEL`. Other timing and restraint controls are listed in `.env.example`.

For faster local testing, set `RELATIONSHIP_IDLE_MS` to a smaller server value. The browser currently uses the product experiment's five-minute idle trigger, so test turn-tail normally or temporarily adjust the client constant on a disposable local test branch if sub-five-minute idle testing is required.

## Ambient dogfood harness

The isolated continuity harness accepts a disposable YAML profile and optional JSON context. These inputs never become production profile data:

```bash
pnpm continuity:harness -- --scenario=ambient-evening-open --profile=data/dogfood/mukesh-context.yaml
pnpm continuity:harness -- --scenario=ambient-walk-weather --profile=data/dogfood/mukesh-context.yaml
pnpm continuity:harness -- --scenario=ambient-school-finish
pnpm continuity:harness -- --scenario=ambient-evening-day-covered
pnpm continuity:harness -- --scenario=ambient-pre-evening
pnpm continuity:harness -- --scenario=ambient-evening-open --now=2026-08-21T18:30:00+01:00 --context='{"calendar":{"event":"Dinner with Sam ended an hour ago"}}'
```

Each run prints the trigger, effective time, situational and Cortex packets, ambient candidate, editorial decision, policy and dedupe results, final output and persistence result. Edit `data/dogfood/mukesh-context.yaml` freely; it is disposable scaffolding for testing judgment, including correct handling of `UNKNOWN`.
