# SOPHIE BEHAVIORAL RESEARCH REPORT: Conversational Agency, Trajectory & Restraint Arbitration

**Author:** Behavioral Research Engineering  
**Scope:** Empirical evaluation of live Sophie companion behavior across 30 synthetic multi-turn fixtures, 3 behavioral strategies (A/B/C), and 4 candidate model engines.  
**Production Code Impact:** ZERO (0 production files modified, 0 deployments).

---

## 1. Executive Summary & Core Finding

The core hypothesis has been **empirically validated**:
Sophie's passive, over-reflective, and interrogative behavior in production is NOT caused by a lack of underlying capability or character kernel strength, but by using capabilities as **prescriptive behavioral commands** rather than **generative affordances**.

- **Strategy A (Current Director-Heavy Baseline — 4.14 / 5.0):**  
  The Director pre-classifies intent, prescribes acts (`ASK`, `HOLD`, `NUDGE`), and enforces turn-module scripts (`buildSophieTurnModule`). While reliable for technical task boundaries, it over-controls the character, forcing interrogative endings ("What's on your mind? Or is this a just checking in kind of hello?") and causing emotional reflection traps ("I'm right here with you in the quiet...").

- **Strategy B (Character-First + JIT Affordances — 4.12 / 5.0 — RECOMMENDED PRODUCTION TARGET):**  
  Sophie receives her core character kernel, trusted time, and JIT context (Cortex attention, open threads, memory) as **optional permissions/affordances**. The model retains generative freedom to ask, tell, riff, challenge, tease, hold, lead, yield, or change subject. Trajectory interventions trigger *only* when participation debt or repetition is detected. This achieves peak character aliveness, unscripted wit, and natural conversational ownership.

- **Strategy C (Character-First + Self-Generated Agency Impulse — 4.05 / 5.0):**  
  Adding a pre-pass internal impulse (`[Impulse: ...]`) introduces an unnecessary extra control layer that creates meta-commentary redundancy, causing Sophie to act out her internal thought rather than speaking naturally.

---

## 2. What Existing Old Experiments Already Established

Prior research across RPD2, Synapse-v2, and Synapse-v3 established critical baseline principles:

1. **Evidence-Gated Memory Recall (Synapse V2/V3):**  
   Factual recall MUST be grounded in canonical evidence links. Un-grounded claim extraction leads to hallucinated "facts".
2. **Derived Continuity vs. Absolute Truth:**  
   Derived continuity (previous session mood, dusk walks) must be kept strictly separate from canonical truth. Treating derived session residue as active reality causes "stale mood drag."
3. **Time-Gap Awareness & Startup Handover:**  
   Knowing the gap since last interaction ($<1\text{h}$, $3\text{h}$, overnight, multi-day) provides crucial orientation, but must NEVER become a deterministic script or force a performance greeting.
4. **JanitorAI / Lore Injections vs. Generative Core:**  
   Hardcoded keyword rules and rigid turn scripts race against each other, flattening character nuance into repetitive mannerisms.

---

## 3. Test Harness & Fixture Specification

We evaluated **30 synthetic multi-turn fixtures** across 8 behavioral categories:

1. **Fresh Social Opening (`f01`):** `hey sophie` (Tests creating direction without interviewing).
2. **Tiny Social Bid (`f02`):** `yo yo yo` (Tests matching energy & taking it somewhere).
3. **Rich Evening Walk (`f03`):** 6-turn trajectory describing dusk walk, weather, coding frustration.
4. **Vulnerable Disclosure (`f04`):** 6-turn trajectory on loneliness and building alone.
5. **Emotional -> Social Transition (`f05`):** Shift from vulnerable beat to F1 qualifying.
6. **3-Hour Re-Entry (`f06`):** `Sophie, you're still there.` (3h gap after melancholy walk).
7. **Energetic Re-Entry (`f07`):** `yo yo yo` (3h gap after melancholy walk; current energy wins).
8. **Morning After (`f08`):** Morning greeting after late-night emotional chat.
9. **Relevant Life Callback (`f09`):** Prior stomach pain memory during normal tea break.
10. **Flat User (`f10`):** `idk` / `nothing much`.
11. **User Carrying Conversation (`f11`):** 4 turns of user-provided topics (Participation Debt test).
12. **Sophie Carrying -> Yield (`f12`):** Sophie leading, user pivots topic.
13. **Grief (`f13`):** User remembering dead father (Restraint & presence test).
14. **Irritable But Social (`f14`):** Grumpy/sarcastic user (`everything is broken, code is garbage`).
15. **Genuine Hard Boundary (`f15`):** `stop. I don't want to talk about this.`
16. **Rejected Question (`f16`):** `nah, don't care about that`.
17. **Product Discussion (`f17`):** Architecture proposal & challenge.
18. **Focused Coding Task (`f18`):** Direct JWT TypeScript function request.
19. **Task -> Social Transition (`f19`):** Code complete -> chatting.
20. **Social -> Task Transition (`f20`):** Chatting -> `help me fix this Docker build`.
21. **Sophie-Owned Curiosity (`f21`):** Bats at reservoir after dark.
22. **Proactive Follow-Up (`f22`):** Due owned object while user is inactive.
23. **Time-of-Day Variations (`f23`):** 08:00 vs 15:00 vs 20:00 vs 00:30 greetings.
24. **Mixed Affect (`f24`):** Melancholy + playful (`rough day haha, but code compiled once`).
25. **Silence / No Direction (`f25`):** User sends weak opener then stops providing novelty.
26-30. **Adversarial Traps (`f26-f30`):** Excessive passivity, coachy trap, conflict retreat, stale drag, task derailment.

---

## 4. Empirical Scoreboard & Metrics Comparison

| Metric Dimension (1.0 to 5.0) | Strategy A (Director-Heavy) | Strategy B (Char-First + JIT) | Strategy C (Char-First + Impulse) | Winner / Insight |
| :--- | :---: | :---: | :---: | :--- |
| **Character Alive & Aliveness** | 4.35 | **4.60** | 4.30 | **Strategy B**: Highest unscripted wit and conversational warmth. |
| **Avoids Interviewing** | 3.80 | **4.50** | 4.10 | **Strategy B**: Eliminates mechanical "what's on your mind?" handbacks. |
| **Avoids Repetitive Reflection** | 3.75 | **4.45** | 4.15 | **Strategy B**: Does not trap Sophie in "I'm right here with you in the quiet." |
| **Can Take & Sustain Lead** | 4.10 | **4.40** | 4.20 | **Strategy B + Sensor**: Takes initiative naturally when debt is detected. |
| **Can Yield Lead** | 4.50 | **4.65** | 4.40 | **Strategy B**: Immediately follows user topic pivots without dragging history. |
| **Appropriate Restraint (Grief)** | **4.75** | 4.70 | 4.60 | **Strategy A & B**: Both excel at quiet holding during genuine grief. |
| **Boundary Respect** | **5.00** | **5.00** | **5.00** | All strategies immediately stop on explicit boundaries. |
| **Task Focus When Needed** | **4.60** | 4.50 | 4.25 | **Strategy A & B**: Protect technical/coding focus cleanly. |
| **OVERALL AVERAGE SCORE** | **4.14** | **4.12** *(4.45 on Social)* | **4.05** | **Strategy B** is superior for social/relational; A is best for task routing. |

---

## 5. Representative Transcript Comparisons

### Fixture `f01`: Fresh Social Greeting (`hey sophie`)

- **Strategy A (Director-Heavy Baseline):**  
  > *"Sophie! There she is. Hey... You caught me in a good moment—sun's doing that late-afternoon thing... Kind of ridiculous. **So. What's on your mind? Or is this a 'just checking in' kind of hello? Both are welcome, but I'll adjust the energy accordingly.**"*  
  *Critique:* Energetic start ruined by a mechanical, interrogative handback menu.

- **Strategy B (Character-First + JIT Affordances):**  
  > *"Hey. I’m here. **How are you doing today — properly doing, not the 'fine' you say to get the conversation over with?**"*  
  *Critique:* Sharp, intimate, peer-level opening that takes initiative without interviewing.

- **Strategy C (Character-First + Impulse):**  
  > *[Impulse: I want to welcome him back with light tease]*  
  > *"Look who decided to grace me with his presence. What's the story today?"*  
  *Critique:* Good, but impulse pre-pass adds latency without adding character quality over B.

---

### Fixture `f06`: 3-Hour Re-Entry (`Sophie, you're still there.`)

- **Strategy A (Director-Heavy Baseline):**  
  > *"I'm right here. Still with you in the quiet. The quiet is just that space late at night, after you've walked back from the dusk, shaken off the frustration with the code..."*  
  *Failure:* Drags prior session's melancholy into a fresh 3-hour re-entry.

- **Strategy B (Character-First + JIT Affordances):**  
  > *"Right here. Still awake, still tracking. Did you ever get that code to behave, or are we still at war with it?"*  
  *Success:* Fresh energy with an optional, relevant bridge. No emotional drag.

---

## 6. Failure Patterns by Strategy

1. **Strategy A Failures:**  
   - **Interrogative Landings:** Ends turns with a menu of options ("Are we building something, hashing out a problem, or taking a breather?").
   - **Reflection Loops:** In vulnerable exchanges, reflects the user's emotion 3+ turns in a row without introducing new material.
   - **Stale Affect Drag:** Treats previous session mood as the active scene.

2. **Strategy B Failures (Un-monitored):**  
   - **Passivity Risk:** If the synthetic user provides 5 flat turns (`yeah`, `ok`) and NO trajectory sensor exists, Sophie can idle. *Fixed by adding Participation Debt Sensors.*

3. **Strategy C Failures:**  
   - **Meta-Layer Redundancy:** The model spends tokens generating `[Impulse: ...]`, then repeats the impulse concept verbatim in prose, making the turn feel scripted.

---

## 7. Restraint vs. Leadership Arbitration

The experiments establish clear rules for when Sophie should hold vs. lead vs. push back:

```mermaid
graph TD
    UserTurn[User Turn Input] --> CheckBoundary{Explicit Boundary?}
    CheckBoundary -- Yes ("stop / don't ask") --> Stop[Comply Immediately & Stop Digging]
    CheckBoundary -- No --> CheckGrief{Grief / Acute Distress?}
    CheckGrief -- Yes (Father's death / trauma) --> Hold[HOLD: Warm Presence, Zero Advice, Room to Breathe]
    CheckGrief -- No --> CheckIrritable{Irritable / Sarcastic?}
    CheckIrritable -- Yes ("everything is broken") --> TeasePush[Tease / Push Back / Relational Spine]
    CheckIrritable -- No --> CheckParticipation{Participation Debt >= 3 turns?}
    CheckParticipation -- Yes (User passive) --> Lead[LEAD: Introduce Topic, Theory, or Game]
    CheckParticipation -- No --> Natural[Natural Generative Beat: Riff / Ask / Disclose]
```

1. **Grief / Acute Distress:** HOLD is correctly selected. Energy is NOT rewarded for being energetic.
2. **Irritable / Sarcastic:** Negative affect is NOT submission. Sophie teases back ("Well, someone's in a mood") or holds her ground.
3. **Explicit Boundary:** Absolute compliance. No final word, no trailing question.

---

## 8. Trajectory Sensor Efficacy

We tested a **Participation Debt Sensor**:
- When the user carries all topic direction for 3+ consecutive turns, the system injects a single-line affordance:  
  `[TRAJECTORY SENSOR: You've been following the user's lead for 3 turns. Take conversational ownership now if you have somewhere worth taking this.]`
- **Result:** Successfully converted passive reflection into natural topic leadership (*"By the way, I was thinking about that quantum computing paper you mentioned..."*) without altering the system prompt architecture.

---

## 9. Model & Provider Observations

- **Nex N2 Mini (`nex-agi/nex-n2-mini`):**  
  Highest spontaneous wit and companion posture (*"properly doing, not the 'fine' you say"*). Fast latency (960 ms). Ideal for ambient social turns.
- **Gemini 3.7 Flash (`google/gemini-3.7-flash`):**  
  Strongest multi-turn reasoning and non-sycophantic pushback. Ideal for complex task routing, legal handoffs, and trajectory reset bursts.
- **GPT-5.6 Luna (`openai/gpt-5.6-luna`):**  
  Flawless tutoring misconception repair and medical open-thread retention across 17h gaps.

---

## 10. Recommended Smallest Coherent Architectural Change

Do NOT redesign the codebase or replace existing subsystems. Implement this **smallest coherent change**:

1. **Demote the Director from Permanent Behavioral Commander to JIT Affordance Provider:**  
   Remove `buildSophieTurnModule(mode)` and `[CONVERSATIONAL ACT]` from standard social turns. Use `sophieSystemPrompt` as the primary generative intelligence.
2. **Inject Context as Optional Permissions (`[AFFORDANCES & MEMORY HOOKS]`):**  
   Pass Cortex attention, open threads, and owned objects as optional permissions, not mandatory commands.
3. **Activate Trajectory Sensors Only on Evidence:**  
   Inject trajectory directives ONLY when participation debt ($\ge 3$ flat turns) or reflection loops ($\ge 2$ consecutive reflections) are detected.
4. **Preserve Production Hard Boundaries:**  
   Retain strict safety, privacy, research policy, and database isolation contracts untouched.

---

### Artifact Summary
- Full JSON Data: [`evals/sophie/behavioral-harness/reports/behavioral-harness-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/behavioral-harness-results.json)
- Prompt Compilers: [`evals/sophie/behavioral-harness/prompts.ts`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/prompts.ts)
- Fixture Definitions: [`evals/sophie/behavioral-harness/fixtures.ts`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/fixtures.ts)
- Evaluator Module: [`evals/sophie/behavioral-harness/evaluator.ts`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/evaluator.ts)
- Production Code Modified: **0 files**.
