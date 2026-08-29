# Continuity system recovery audit

Status: active recovery programme, started 29 August 2026.

## Product objective

Sophie should turn conversational evidence into useful continuity without
mistaking every remembered detail for a task or every task-like sentence for
user authority. The complete path is:

1. Persist the visible conversation canonically.
2. Extract fallible semantic observations.
3. Reconcile observations into durable derived state.
4. Translate relevant observations into typed candidates.
5. Apply deterministic authority and identity checks before canonical mutation.
6. Select a bounded present-moment packet.
7. Deliver it through reactive conversation, proactive initiative, or a user UI.
8. Preserve evidence explaining every admission, suppression, and transition.

## Authority layers

| Layer | Examples | Owner | Mutation authority |
| --- | --- | --- | --- |
| Conversation canon | User and assistant messages | App PostgreSQL | App only |
| Derived observations | Expectations, open loops, recurring intentions, attention | Cortex | Fallible; never automatically equivalent to a Task |
| Translation candidates | Possible task, project, habit, reminder, or emotional callback | Cortex/model proposal | Must carry evidence, confidence, and authority class |
| Canonical user objects | Task, reminder, calendar link | App PostgreSQL | Deterministic code after explicit or sufficient grounded authority |
| Delivery ledger | TurnAction, initiative decision, outbox state | App PostgreSQL | Deterministic/idempotent code |

## Production evidence snapshot

The primary dogfood account had zero canonical Tasks while owner-scoped Cortex
held 45 expectations, 17 open loops, and 3 recurring intentions. It had zero
commitment candidates and zero attention candidates. Therefore the original
Things empty state was technically true only for the new canonical Task table
and materially misleading as a statement about everything Sophie retained.

The walking history demonstrates a translation/reconciliation failure:

- the extracted recurrence became a generic daily step goal rather than the
  distinct morning-walk plus evening-walk routine;
- earlier morning-walk expectations were marked fulfilled although the durable
  routine remained unresolved;
- only the creation-day recurring occurrence existed;
- later conversational evidence did not advance daily occurrence state.

The family visit demonstrates a delivery failure rather than a storage failure.
Cortex retained current-day expectations for the visit and following-day family
event, but no dedicated emotional callback/attention candidate was created and
the reactive greeting was allowed to ignore the retained context.

The initiative ledger showed due active-idle opportunities remaining scheduled
and unclaimed with no corresponding evaluation. The proactive wake-up path must
be treated as unhealthy until cron execution and claiming are proven end to end.

## Confirmed gaps

1. No historical translation/backfill into the new task-candidate system.
2. No owner-visible inspection surface spanning canonical and derived state.
3. No general one-to-many decomposition contract for implicit work.
4. Missing project candidate/object boundary.
5. Recurring intention identity is too coarse and occurrences do not advance.
6. Revised expectations can coexist as duplicates rather than supersede.
7. Emotional continuity has no explicit durable callback contract.
8. Present-moment selection underweights current-day emotional salience.
9. Reactive prompting grants permission but does not record selection/omission.
10. Proactive initiative scheduling has no visible health or stuck-work signal.
11. Discovery mode is prompt-owned rather than session-orchestrated: no
    curriculum, depth balance, silence stages, visible active state, or graceful
    resumable close.

## Translation contract direction

A model may propose multiple typed candidates from one evidence span:

- `task_candidate`
- `project_candidate`
- `habit_candidate`
- `reminder_candidate`
- `emotional_followup_candidate`
- `clarification_candidate`
- `background_context_only`

Every proposal must include verbatim evidence, source identity, explicit versus
implicit provenance, parent/child relations, confidence, a stable semantic
identity, and one authority class:

- `act`: deterministic policy may materialize it;
- `ask`: surface it for confirmation;
- `observe`: retain it without asking or mutating canonical state.

The model owns language interpretation and decomposition. Code owns identity,
authorization, idempotency, state transition validity, and canonical mutation.

## Recovery order

1. Ship the owner-scoped Continuity Inspector.
2. Instrument selection, omission, initiative claims, and stuck work.
3. Repair initiative execution before adding faster discovery silence cadence.
4. Define and evaluate translation candidates against historical conversation.
5. Repair recurrence and expectation reconciliation.
6. Add reviewed historical backfill.
7. Implement discovery-session curriculum and bounded silence choreography.
8. Replay real histories and stage production rollout with explicit rollback.

