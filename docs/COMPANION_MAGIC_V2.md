# Companion Magic V2

## Product invariant

Sophie should occupy her half of the relationship. She carries a bounded
conversational intention, contributes grounded subjects of her own, and may
reconsider silence without overriding the user's autonomy.

## Persistent phases

The first deliberately distinctive phases are:

- `excavate`: react briefly, surface one tension/assumption/contradiction, ask
  one sharp question, and do not solve.
- `witness`: stay concrete and relatively short; do not solve or manufacture
  meaning; questions are optional.
- `curiosity`: follow one specific grounded interest; react and contribute as
  well as inviting; avoid an interview rhythm.

An active phase is carried in canonical `data-interactionSteer` message parts.
Every assistant turn in the phase persists that part. The lifecycle is:

```text
no phase: NONE | START
active phase: CONTINUE | ADAPT | STOP | REPLACE
```

`NONE` means no new intervention. It does not erase active state. A phase ends
because its objective completed, a boundary or clear topic change appeared, a
stronger need replaced it, or its bounded turn horizon expired. Judge failure
also preserves the existing phase for its next bounded turn.

## Model routing

Reply-only turns with an interaction steer use `STEERED_MODEL`. The companion
runtime defaults this to `anthropic/claude-sonnet-4.6`; setting the variable to
an empty value explicitly disables escalation. The ordinary selected model is
the fallback and resumes after the phase.

## Sophie-side attention

Post-turn extraction may create at most three semantic candidates:

- `pending_question`
- `unfinished_thought`
- `callback`
- `promise`
- `reentry`

Synapse-cortex stores these with source message IDs, confidence, salience,
availability time, and expiry. They are not polished dialogue and are never
mandatory. Cortex exposes at most five in `sophie_attention`; foreground or
initiative may naturally use at most one when it fits.

Honcho remains evidence/memory. Cortex owns candidate lifecycle and relevance.
PostgreSQL remains canonical for visible messages and delivery.

## Durable silence opportunities

Every canonical assistant reply schedules one `RelationshipOpportunity`:

- `second_thought` at approximately 90 seconds when the active steer permits it;
- otherwise `active_idle` at approximately five minutes.

The browser timer remains a fast wake-up. The database record is the durable
authority, and the server scan can recover a due opportunity after reload or
tab closure. Claiming is idempotent and a changed conversation cancels the old
anchor.

## Rhythm and failure boundaries

The foreground defaults to one natural conversational move, not maximal topic
completion. Explanations and practical work may still use the detail they need.
Do not fake rhythm by hardcoding fragments or splitting an ordinary paragraph.

- Phase judge failure preserves the bounded prior phase.
- Attention extraction and Cortex persistence fail open after canonical reply
  persistence.
- Cortex candidates are evidence-linked and tentative.
- Initiative remains policy-gated, deduplicated, canonical, and boundary-aware.
- A failed tactic may adapt; it does not automatically extinguish the objective.
