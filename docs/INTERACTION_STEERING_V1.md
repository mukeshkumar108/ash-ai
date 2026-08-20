# Temporary interaction steering V1

This dogfood experiment is disabled unless
`INTERACTION_STEERING_ENABLED=true`.

## Ownership and flow

- Honcho remains evidence and memory only.
- Synapse-Cortex remains the deterministic continuity packet source. Its
  current checkout is not version-controlled, so V1 does not add a second
  model service there.
- `llm-agent-test` evaluates the immediate conversational moment in
  `lib/ai/interaction/judge.ts`, stores the bounded steer as an assistant data
  part, and reuses the initiative runtime for a permitted 90-second second
  thought.
- `companion-runtime` receives the typed steer, injects it at the end of the
  Sophie prompt, and optionally selects `STEERED_MODEL`. The normal decision
  model is the first fallback.

No steer is a normal result. A timer creates an evaluation opportunity, never
an obligation to speak.

## Configuration

App:

```text
INTERACTION_STEERING_ENABLED=true
INTERACTION_STEER_JUDGE_MODEL=google/gemini-3.5-flash-lite
INTERACTION_STEER_TIMEOUT_MS=8000
RELATIONSHIP_SECOND_THOUGHT_MS=90000
```

Runtime:

```text
STEERED_MODEL=openai/gpt-5.6-luna-pro
```

If `STEERED_MODEL` is empty, the runtime logs that escalation did not occur and
uses the normal model.

## Harness

```bash
pnpm exec tsx scripts/interaction-steer-harness.ts sad
pnpm exec tsx scripts/interaction-steer-harness.ts tutoring
pnpm exec tsx scripts/interaction-steer-harness.ts boredom
pnpm exec tsx scripts/interaction-steer-harness.ts burst
pnpm exec tsx scripts/interaction-steer-harness.ts ambient
pnpm exec tsx scripts/interaction-steer-harness.ts control
```

The harness uses configured model access and prints the interpretation,
decision, structured steer, expression shape, initiative permission, and
compiled late instruction.
