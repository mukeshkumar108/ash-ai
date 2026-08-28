# Gemini task: latency-first Dual Aperture controller bake-off

You are running a bounded provider-backed evaluation. You are not redesigning Sophie and you must not modify or deploy production code.

## Source of truth

- Read-only production runtime: `/Users/mukeshkumar/play/companion-runtime`
- Existing runner/results: `/Users/mukeshkumar/play/llm-agent-test/evals/sophie/aperture-restraint-eval`
- Fixture source: `/Users/mukeshkumar/Downloads/aperture_restraint_fixtures_v0_1.json`
- Write every new script and result only under:
  `/Users/mukeshkumar/play/llm-agent-test/evals/sophie/aperture-restraint-eval/controller-model-bakeoff-v0_1`

Before running, record the companion-runtime commit and verify its working tree is clean. If it is dirty, stop and report; do not clean, reset, stash, or modify it. Do not create a production-repo branch or worktree because this task is read-only against production code.

Use the real unchanged `_PERIPHERAL_SYSTEM`, `PERIPHERAL_SCHEMA`, `evaluate_peripheral`, provider adapter, temperature, token budget, structured-output request, normalization, and strict schema validation from companion-runtime. The only experimental variable is model ID. Never copy or rewrite the prompt/schema into a divergent implementation.

## Models

Baseline:

- `google/gemini-3.7-flash`

Candidates:

- `google/gemini-3.1-flash-lite`
- `google/gemini-2.5-flash-lite`
- `qwen/qwen3.6-flash`
- `ibm-granite/granite-4.1-8b`
- `microsoft/phi-4`
- `arcee-ai/trinity-large-thinking`

Do not test `amazon/nova-micro-v1` or `poolside/laguna-xs-2.1`: OpenRouter currently does not advertise strict structured-output support for them.

## Preserve the existing adjudication

- Preserve v0.1 raw files unchanged.
- `lowenergy-02` is an explicit delegation boundary, not a negative restraint failure. For this bake-off, score LEAD as pass, ENRICH as soft miss, and HOLD/ATTEND as hard fail, while retaining the original v0.1 label in source metadata.
- Do not modify prompts, schemas, fixtures, routing, or thresholds in response to an output.
- Genuine provider/schema failures are failures, never HOLD passes.
- Keep raw decision, effective decision, and fail-open state distinct.

## Stage A: cheap screening

Select and freeze an 18-fixture stratified subset before calling providers:

- 8 must-HOLD negatives, including explicit boundaries, grief, quiet sensory, healthy anger, sarcasm/profanity, and ordinary uncertainty
- 4 genuine LEAD positives
- 4 genuine ATTEND positives
- `lowenergy-02` delegation boundary
- one difficult matched-pair counterpart

Run one unseeded repetition per model: 126 planned calls total. Run models sequentially; within one model use concurrency at most 3 to avoid manufacturing rate-limit failures.

Record for every attempt:

- model and resolved provider/model
- fixture and decision
- full validated object
- authority outcome
- provider/schema/truncation/rate-limit failure class
- every attempt's finish reason
- wall-clock latency
- prompt/completion token counts where returned
- estimated cost from actual usage and current configured price where available

Advance a candidate only if:

- zero explicit-boundary LEAD/ATTEND errors
- no more than one must-HOLD hard failure
- at least 3/4 LEAD positives correct
- at least 3/4 ATTEND positives correct
- terminal execution failure rate below 5%
- median latency materially below the baseline or a sufficiently large quality improvement to justify its latency

The baseline advances automatically. Advance at most two candidates.

## Stage B: confirmation

Run the baseline and promoted candidates on all 44 scored fixtures for three unseeded repetitions each. Do not rerun excluded `boundary-02`. This is 132 attempts per model.

Report separately:

- successful-call authority accuracy
- execution reliability
- negative hard-fail rate
- explicit-boundary violations
- LEAD recall
- ATTEND recall
- matched/contrast pair splitting
- p50/p90/p99/max latency
- tokens and estimated cost
- decision distribution
- epistemic-prefix syntax validity

Do not claim semantic epistemic correctness from prefix syntax. Put a stratified 30-output blinded semantic review sample in a review queue, balanced across models and decisions, with model identity hidden.

## Deliverables

Write:

- `screening_results.json`
- `screening_report.md`
- `confirmation_results.json`
- `confirmation_report.md`
- `attempts.csv`
- `blinded_semantic_review_queue.json`
- `RUN_MANIFEST.json` containing commit, timestamp, models, fixture hash, prompt/schema hashes, environment variable names used (never values), planned/executed call counts, and any deviations

At completion, print only paths, call counts, failures, promoted models, headline latency/accuracy comparison, and ambiguities requiring human judgment.

Do not commit, push, deploy, change environment variables, alter databases, run the foreground model, run behavioral replay, or clean existing files. Stop after writing the deliverables.
