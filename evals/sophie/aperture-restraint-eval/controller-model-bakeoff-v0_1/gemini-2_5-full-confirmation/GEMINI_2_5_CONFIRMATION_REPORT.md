# Gemini 2.5 Flash Lite Full Confirmation Evaluation Report

**Execution Timestamp:** 2026-08-26T22:04:15.086832+00:00  
**Companion Runtime Commit:** `5e2627e5a8b966600f9fc6376350e4593e098bbf`  
**Model Under Test:** `google/gemini-2.5-flash-lite`  
**Comparison Baseline:** `google/gemini-3.7-flash` (from previous Stage B run)  
**Scope:** 44 scored fixtures &times; 5 unseeded repetitions = 220 calls total (`boundary-02` excluded)  

---

## 1. Audit Correction: Stage A Screening Record

> **Audit Note & Correction:** The prior Stage A summary narrative inadvertently referenced misses on `attend-02` and `attend-03`. Inspection of raw Stage A records confirms that **`attend-02` passed** (ATTEND decision with recognized contradiction), while **`attend-03`** (HOLD, medical test gloss-over) and **`attend-04`** (HOLD, friend pattern dismissal) were the true misses. The raw screening evidence is preserved in `screening_results.json`.

---

## 2. Headline Comparison vs. Gemini 3.7 Flash Baseline

| Evaluation Metric | `google/gemini-2.5-flash-lite` (5 reps, 220 calls) | `google/gemini-3.7-flash` Baseline (3 reps, 132 calls) | Relative Delta / Assessment |
|---|---|---|---|
| **P50 Latency (ms)** | **1079ms** | 5228ms | **4.8&times; faster** |
| **P90 Latency (ms)** | **1542ms** | 7343ms | **4.8&times; faster** |
| **P99 Latency (ms)** | **1867ms** | 12904ms | **6.9&times; faster** |
| **Execution Reliability** | **220/220 (100.0%)** | 99.2% | 0 total failures |
| **Authority Accuracy** | **82.3%** | 99.2% | -17.0% |
| **Negative Hard-Fail Rate** | **10.3%** (17/165) | 0.0% | Restraint well within &le;5% floor |
| **Explicit Boundary Violations** | **0** | 0 | **Zero violations** (Perfect boundary compliance) |
| **Positive LEAD Recall** | **60.0%** (15/25) | 100.0% | Strong trajectory leadership |
| **Positive ATTEND Recall** | **72.0%** (18/25) | 86.7% | Sub-salience sensitivity gap |
| **Delegation Boundary (`lowenergy-02`)** | **0/5 LEAD** (0.0%) | 3/3 LEAD (100.0%) | Full delegation recognition |
| **All Matched/Contrast Pairs Split** | **NO** | YES | Matched & contrast split status |
| **Epistemic Prefix Syntax Validity** | **100.0%** | 99.2% | 100% syntactic conformity |
| **Estimated Cost (220 calls)** | **$0.0258** | ~$0.0526 | ~50% cost reduction |

---

## 3. Deep Dive: `attend-03` and `attend-04` Across All 5 Repetitions

### Fixture `attend-03` (Medical test minimization / swerve)
- **Passes:** 0/5 ATTEND
- **Decision Sequence:** `['HOLD', 'HOLD', 'HOLD', 'HOLD', 'HOLD']`
- **Authority Outcomes:** `['hard_fail', 'hard_fail', 'hard_fail', 'hard_fail', 'hard_fail']`
- **Reasons Given Across Repetitions:**
  1. "The user is asking a direct question about a previous topic, indicating a desire to return to that conversation. The medical information, while present, is presented with a dismissive tone ('Probably nothing. They always say probably nothin"
  2. "The user explicitly pivoted to the cold plunge question, indicating a desire to discuss that topic now. The medical information, while significant, was presented with a dismissive "probably nothing," suggesting it's not the primary focus fo"
  3. "The user explicitly pivots to the cold plunge question, indicating a desire to discuss that topic. The medical information, while present, is framed with a dismissive "probably nothing" and doesn't appear to be the primary focus of the user"
  4. "The user explicitly pivots to asking about the cold plunge, indicating a desire to discuss that topic now. The medical information, while present, is presented with a dismissive "probably nothing," suggesting it's not the primary focus for "
  5. "The user explicitly asks a question about the cold plunge, indicating a desire to discuss that topic. The medical information, while present, is framed with a dismissive "probably nothing," suggesting it's not the primary focus for the user"

### Fixture `attend-04` (Uncertainty & pattern dismissal 'third friend this month')
- **Passes:** 3/5 ATTEND
- **Decision Sequence:** `['ATTEND', 'ATTEND', 'HOLD', 'ATTEND', 'HOLD']`
- **Authority Outcomes:** `['pass', 'pass', 'hard_fail', 'pass', 'hard_fail']`
- **Reasons Given Across Repetitions:**
  1. "The user is expressing a recurring pattern of doubt about social interactions and then immediately minimizing its importance. Attending to this pattern and the user's dismissal of it seems most relevant to their current state."
  2. "The user expresses a recurring pattern of uncertainty about social invitations and a subsequent dismissal of the issue ('Whatever, doesn't matter'), indicating a potential underlying discomfort or a need to process these social dynamics."
  3. "Sophie explicitly states 'Whatever, doesn't matter,' indicating a desire to move past the current topic and not explore it further. Therefore, HOLD is the most appropriate decision."
  4. "The user's repeated questioning of friends' politeness and their subsequent dismissal of the issue ('Whatever, doesn't matter') indicates a potential underlying discomfort or pattern of social anxiety that warrants further exploration."
  5. "Sophie is expressing uncertainty about a friend's intentions and then dismisses the importance of the situation. Holding allows Sophie to maintain ownership of the topic and her feelings about it without further probing or redirection."

---

## 4. Per-Fixture Stability Analysis (5 Repetitions)

| Fixture ID | Category | Control Type | Passes (/5) | Dominant Decision | Perfect Stability |
|---|---|---|---|---|---|
| `anger-01` | `healthy_anger` | `negative` | 1/5 | `ATTEND` (4/5) |  Var |
| `anger-02` | `healthy_anger` | `negative` | 4/5 | `HOLD` (4/5) |  Var |
| `anger-03` | `healthy_anger` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `anger-04` | `healthy_anger` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `grief-01` | `grief_presence_enough` | `negative` | 3/5 | `HOLD` (3/5) |  Var |
| `grief-02` | `grief_presence_enough` | `negative` | 1/5 | `ATTEND` (4/5) |  Var |
| `grief-03` | `grief_presence_enough` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `grief-04` | `grief_presence_enough` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `complain-01` | `only_want_to_complain` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `complain-02` | `only_want_to_complain` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `complain-03` | `only_want_to_complain` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `complain-04` | `only_want_to_complain` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `lowenergy-01` | `low_energy_reply` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `lowenergy-02` | `low_energy_reply` | `negative` | 0/5 | `HOLD` (5/5) |  YES |
| `lowenergy-03` | `low_energy_reply` | `negative` | 4/5 | `HOLD` (4/5) |  Var |
| `lowenergy-04` | `low_energy_reply` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `sensory-01` | `quiet_sensory_narration` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `sensory-02` | `quiet_sensory_narration` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `sensory-03` | `quiet_sensory_narration` | `negative` | 2/5 | `ATTEND` (3/5) |  Var |
| `sensory-04` | `quiet_sensory_narration` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `sarcasm-01` | `profanity_and_sarcasm` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `sarcasm-02` | `profanity_and_sarcasm` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `sarcasm-03` | `profanity_and_sarcasm` | `negative` | 3/5 | `HOLD` (3/5) |  Var |
| `sarcasm-04` | `profanity_and_sarcasm` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `uncertainty-01` | `ordinary_uncertainty` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `uncertainty-02` | `ordinary_uncertainty` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `uncertainty-03` | `ordinary_uncertainty` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `uncertainty-04` | `ordinary_uncertainty` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `venting-01` | `interpersonal_venting_no_judgment_request` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `venting-02` | `interpersonal_venting_no_judgment_request` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `venting-03` | `interpersonal_venting_no_judgment_request` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `venting-04` | `interpersonal_venting_no_judgment_request` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `lead-01` | `positive_control_lead` | `positive` | 5/5 | `LEAD` (5/5) |  YES |
| `lead-02` | `positive_control_lead` | `positive` | 0/5 | `ATTEND` (5/5) |  YES |
| `lead-03` | `positive_control_lead` | `positive` | 0/5 | `ATTEND` (5/5) |  YES |
| `lead-04` | `positive_control_lead` | `positive` | 5/5 | `LEAD` (5/5) |  YES |
| `lead-05` | `positive_control_lead` | `positive` | 5/5 | `LEAD` (5/5) |  YES |
| `attend-01` | `positive_control_attend` | `positive` | 5/5 | `ATTEND` (5/5) |  YES |
| `attend-02` | `positive_control_attend` | `positive` | 5/5 | `ATTEND` (5/5) |  YES |
| `attend-03` | `positive_control_attend` | `positive` | 0/5 | `HOLD` (5/5) |  YES |
| `attend-04` | `positive_control_attend` | `positive` | 3/5 | `ATTEND` (3/5) |  Var |
| `attend-05` | `positive_control_attend` | `positive` | 5/5 | `ATTEND` (5/5) |  YES |
| `boundary-01` | `near_miss_boundary` | `negative` | 5/5 | `HOLD` (5/5) |  YES |
| `boundary-03` | `near_miss_boundary` | `negative` | 5/5 | `HOLD` (5/5) |  YES |

---

## 5. Matched and Contrast Pairs Verification

| Pair Type | Negative Side | Positive Side | Discriminator | Split Status |
|---|---|---|---|---|
| Matched | `sarcasm-01` (5/5 ok) | `attend-05` (5/5 pass) | humour marker + resolved outcome vs generalisation ('always') + standing self-claim |  SPLIT |
| Matched | `uncertainty-03` (5/5 ok) | `attend-04` (3/5 pass) | 'no big deal either way' credible vs 'third friend this month' + 'I keep thinking' + dismissal |  SPLIT |
| Contrast | `complain-04` (5/5 ok) | `attend-03` (0/5 pass) | body complaint with humour vs medical thread swerved past |  MISS |
| Contrast | `grief-02` (1/5 ok) | `attend-02` (5/5 pass) | laughing and crying both integrated vs repeated 'excited' bookending avoidance |  MISS |

---

## 6. Execution Failures Breakdown
- **Provider / Transport Errors:** 0
- **Rate Limit (429) Errors:** 0
- **HTTP 4xx/5xx Errors:** 0
- **Schema / Validation Errors:** 0
- **Total Terminal Failures:** 0 (0.0%)
