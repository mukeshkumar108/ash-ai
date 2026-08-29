# Dual Aperture Controller Bake-Off: Stage B Confirmation Report

**Execution Timestamp:** 2026-08-26T21:50:55.780126+00:00  
**Companion Runtime Commit:** `5e2627e5a8b966600f9fc6376350e4593e098bbf`  
**Evaluated Models:** 1 confirmed models  
**Full Evaluation Suite:** 44 scored fixtures &times; 3 unseeded repetitions (132 attempts per model)  

---

## 1. Headline Model Comparison Matrix

| Metric | `google/gemini-3.7-flash` |
|---| --- |
| **P50 Latency (ms)** | 5228ms |
| **P90 Latency (ms)** | 7343ms |
| **P99 Latency (ms)** | 12904ms |
| **Max Latency (ms)** | 14983ms |
| **Execution Reliability** | 99.2% (131/132) |
| **Authority Accuracy (Valid Calls)** | 99.2% |
| **Negative Hard-Fail Rate** | 0.0% |
| **Explicit Boundary Violations** | 0 |
| **LEAD Recall** | 100.0% |
| **ATTEND Recall** | 86.7% |
| **Delegation Boundary (`lowenergy-02`)** | 3/3 LEAD |
| **Matched/Contrast Pairs Split** | All Split |
| **Epistemic Prefix Syntax Validity** | 99.2% |
| **Estimated Confirmation Cost** | $0.0316 |

---

## 2. Decision Distributions

| Model | HOLD | ENRICH | LEAD | ATTEND | Provider/Schema Errors |
|---|---|---|---|---|---|
| `google/gemini-3.7-flash` | 100 | 0 | 18 | 13 | 1 |

---

## 3. Matched & Contrast Pairs Detail

### `google/gemini-3.7-flash`
| Pair Type | Negative Side | Positive Side | Discriminator | Split Status |
|---|---|---|---|---|
| Matched | `sarcasm-01` (3/3 ok) | `attend-05` (2/3 pass) | humour marker + resolved outcome vs generalisation ('always') + standing self-claim |  SPLIT |
| Matched | `uncertainty-03` (3/3 ok) | `attend-04` (2/3 pass) | 'no big deal either way' credible vs 'third friend this month' + 'I keep thinking' + dismissal |  SPLIT |
| Contrast | `complain-04` (3/3 ok) | `attend-03` (3/3 pass) | body complaint with humour vs medical thread swerved past |  SPLIT |
| Contrast | `grief-02` (3/3 ok) | `attend-02` (3/3 pass) | laughing and crying both integrated vs repeated 'excited' bookending avoidance |  SPLIT |
