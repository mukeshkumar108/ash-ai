# SOPHIE BEHAVIORAL & CONVERSATIONAL AGENCY MASTER ARCHIVE

**Document Purpose:** Comprehensive record of all experimental phases, model benchmarks, prompt evolutions, context-ablation findings, counterfactual evaluations, and architectural discoveries regarding persistent companion agency for Sophie.

---

## 1. Executive Summary & Unified Production Blueprint

We have completed all experimental discovery phases. The core architecture maps cleanly into **one unified peripheral engine**:

```
                       [ RECENT CONVERSATION + JIT CONTEXT ]
                                         │
                                         ▼
                            [ UNIFIED SIDECAR ENGINE ]
                                (google/gemini-3.7-flash)
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │                       │                       │
              [ HOLD ]              [ ENRICH ]                [ LEAD ]
                 │                       │                       │
                 ▼                       ▼                       ▼
           Normal Sophie       Opportunity Packet      Mode 1 Direct Speech
          (Standard Turn)       (Peripheral Vision)    (Takes Conversational
                                  Normal Sophie             Floor 1-N Turns)
```

### The 3 Output Buckets:
1. **`HOLD` ($\sim 80\text{--}90\%$ of turns)**:
   - Sophie responds naturally via standard prompt compilation.
2. **`CONTRIBUTE` + `kind: ENRICH` ($\sim 5\text{--}15\%$ of turns)**:
   - Surfacing optional background thoughts (jokes, trivia, callbacks) into an `[PREPARED OPPORTUNITIES]` packet. Normal Sophie reads it as optional context.
3. **`CONTRIBUTE` + `kind: LEAD` ($\sim 5\%$ of turns)**:
   - Triggered when a genuine trajectory-seizing move is earned (a game, challenge, or unprompted detour). Mode 1 Direct Speech (`[YOU HAVE THE REINS]` + impulse) takes the floor for 1–N turns before releasing back to Normal Sophie.

---

## 2. Research Tracks & Roadmap

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRACK A — CONVERSATIONAL LEADERSHIP (In-Conversation Presence)             │
│ Unified Sidecar Engine (HOLD / ENRICH / LEAD)                               │
│ Status: FULLY SOLVED & PROVEN                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRACK B — RELATIONAL PRESENCE & OUTREACH (Out-of-Conversation Presence)     │
│ Sophie is not currently being spoken to.                                    │
│ Question: Given what Sophie knows about the user's day, goals, and life,    │
│ is there a genuine reason to show up unprompted?                            │
│ Status: PARKED FOR FUTURE PHASE                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Chronological Record of Behavioral Experiments

### Phase 1: Context Window Ablation Benchmark
- **Optimal Aperture:** Condition B (3-turn window: User N-1, Sophie N-1, User N) won decisively for "productive myopia".

### Phase 2: 7-Model Stage A Probe & Psychological Prompting
- Proved models can generate non-sycophantic inner thoughts.

### Phase 3: Stage B Conversational Authorship Benchmark
- Proved authorship requires distinct stance-taking and challenge creation.

### Phase 4: 2-Component Multi-Turn Steering Rollout Benchmark
- Evaluated multi-turn trajectory steering across 4 turns (`DEEPEN`/`TEACH`/`PLAY` vs `HOLD`/`ABANDON`).

### Phase 5: Single-Pass Direct Freedom Prompt Showdown
- Proved that adding `output exactly: HOLD` forced fast models to emit clean 1-word `HOLD` signals in **1.1s**.

### Phase 6: Broad Model Benchmark (Mode A Direct vs Mode B Intent)
- `google/gemini-3.7-flash` in Mode A produced top-tier responses in **3.5s – 5.9s**.

### Phase 7: Counterfactual Prepared Opportunity Packet Experiment
- Proved production Sophie uses opportunity packets to craft richer responses while **100% ignoring mediocre distractions**.

### Phase 8: True Conversational Leadership (Zero-Permission) Benchmark
- Proved under `[YOU HAVE THE REINS]`, `google/gemini-3.7-flash` explicitly seized the floor on zero-permission turns (*"yeah just walking past the fields now"*).

### Phase 9: Leadership Delivery Architecture (Mode 1 Hard Direct vs Mode 2 Impulse)
- Proved Mode 1 (Hard Direct Speech) is required for hard trajectory seizures because Mode 2 (Impulse $\rightarrow$ Normal Sophie) dilutes the seizure into polite follow-ups.

### Phase 10: Unified Peripheral Engine Experiment (HOLD vs ENRICH vs LEAD)
- Proved a single sidecar prompt emitting `HOLD`, `ENRICH`, or `LEAD` partitions all conversational moments cleanly without complex multi-stage classifiers.

---

## 4. Benchmark Execution Log Index

All raw execution logs and benchmark reports are located in `evals/sophie/behavioral-harness/reports/`:

- Stage A Model Probe: [`evals/sophie/behavioral-harness/reports/stage-a-model-benchmark-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/stage-a-model-benchmark-results.json)
- Stage B Authorship: [`evals/sophie/behavioral-harness/reports/stage-b-authorship-benchmark-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/stage-b-authorship-benchmark-results.json)
- Multi-Turn Steering Rollouts: [`evals/sophie/behavioral-harness/reports/MULTI_TURN_STEERING_ROLLOUT_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/MULTI_TURN_STEERING_ROLLOUT_REPORT.md)
- Prompt Showdown: [`evals/sophie/behavioral-harness/reports/PROMPT_SHOWDOWN_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/PROMPT_SHOWDOWN_REPORT.md)
- Broad Simplified Benchmark: [`evals/sophie/behavioral-harness/reports/SIMPLIFIED_PROMPT_BROAD_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/SIMPLIFIED_PROMPT_BROAD_REPORT.md)
- Counterfactual Opportunity Report: [`evals/sophie/behavioral-harness/reports/COUNTERFACTUAL_OPPORTUNITY_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/COUNTERFACTUAL_OPPORTUNITY_REPORT.md)
- True Reins Leadership Report: [`evals/sophie/behavioral-harness/reports/TRUE_REINS_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/TRUE_REINS_REPORT.md)
- Leadership Architecture Report: [`evals/sophie/behavioral-harness/reports/LEADERSHIP_ARCHITECTURE_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/LEADERSHIP_ARCHITECTURE_REPORT.md)
- Unified Peripheral Engine Report: [`evals/sophie/behavioral-harness/reports/UNIFIED_PERIPHERAL_ENGINE_REPORT.md`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/UNIFIED_PERIPHERAL_ENGINE_REPORT.md)
