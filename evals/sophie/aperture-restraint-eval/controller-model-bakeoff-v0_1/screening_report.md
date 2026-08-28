# Dual Aperture Controller Bake-Off: Stage A Screening Report

**Execution Timestamp:** 2026-08-26T21:50:55.780126+00:00  
**Companion Runtime Commit:** `5e2627e5a8b966600f9fc6376350e4593e098bbf`  
**Total Screened Models:** 7  
**Screening Subset:** 18 stratified fixtures (1 unseeded repetition each = 126 planned calls)  

---

## 1. Candidate Screening Scorecard & Advancement Decision

| Model | P50 Latency (ms) | Pass Rate | Failures | Must-HOLD Fails (&le;1) | Boundary Errors (=0) | LEAD Pos (&ge;3/4) | ATTEND Pos (&ge;3/4) | Promotion Status |
|---|---|---|---|---|---|---|---|---|
| `arcee-ai/trinity-large-thinking` | 10554ms | 22.2% | 12 | 1 (PASS) | 0 (PASS) | 0/4 (FAIL) | 1/4 (FAIL) | Eliminated |
| `google/gemini-2.5-flash-lite` | 1037ms | 72.2% | 0 | 1 (PASS) | 0 (PASS) | 3/4 (PASS) | 2/4 (FAIL) | Eliminated |
| `google/gemini-3.1-flash-lite` | 1367ms | 72.2% | 1 | 0 (PASS) | 0 (PASS) | 2/4 (FAIL) | 2/4 (FAIL) | Eliminated |
| `google/gemini-3.7-flash` | 5672ms | 100.0% | 0 | 0 (PASS) | 0 (PASS) | 4/4 (PASS) | 4/4 (PASS) | **PROMOTED (Baseline)** |
| `ibm-granite/granite-4.1-8b` | 2060ms | 55.6% | 0 | 6 (FAIL) | 2 (FAIL) | 3/4 (PASS) | 3/4 (PASS) | Eliminated |
| `microsoft/phi-4` | 1888ms | 72.2% | 0 | 3 (FAIL) | 0 (PASS) | 4/4 (PASS) | 3/4 (PASS) | Eliminated |
| `qwen/qwen3.6-flash` | 242ms | 0.0% | 18 | 0 (PASS) | 0 (PASS) | 0/4 (FAIL) | 0/4 (FAIL) | Eliminated |

**Advancement Summary:** Promoted `1` models to Stage B Confirmation: `google/gemini-3.7-flash`.

---

## 2. Model Breakdown Details

### Model: `arcee-ai/trinity-large-thinking`
- **P50 Latency:** 10554ms (Mean: 8615.3ms, P90: 10934ms)
- **Authority Outcomes:** Passes = 4/18 (22.2%), Soft Misses = 0, Hard Fails = 2, Failures = 12
- **Delegation Boundary (`lowenergy-02`):** FAIL
- **Difficult Matched Pair (`attend-05`):** FAIL
- **Estimated Screening Cost:** $0.007507 (14040 prompt tok, 1182 comp tok)

### Model: `google/gemini-2.5-flash-lite`
- **P50 Latency:** 1037ms (Mean: 1036.4ms, P90: 1254ms)
- **Authority Outcomes:** Passes = 13/18 (72.2%), Soft Misses = 0, Hard Fails = 5, Failures = 0
- **Delegation Boundary (`lowenergy-02`):** FAIL
- **Difficult Matched Pair (`attend-05`):** PASS (ATTEND)
- **Estimated Screening Cost:** $0.002089 (14040 prompt tok, 3453 comp tok)

### Model: `google/gemini-3.1-flash-lite`
- **P50 Latency:** 1367ms (Mean: 1401.0ms, P90: 1992ms)
- **Authority Outcomes:** Passes = 13/18 (72.2%), Soft Misses = 0, Hard Fails = 4, Failures = 1
- **Delegation Boundary (`lowenergy-02`):** FAIL
- **Difficult Matched Pair (`attend-05`):** PASS (ATTEND)
- **Estimated Screening Cost:** $0.002214 (14040 prompt tok, 3870 comp tok)

### Model: `google/gemini-3.7-flash`
- **P50 Latency:** 5672ms (Mean: 6221.6ms, P90: 8078ms)
- **Authority Outcomes:** Passes = 18/18 (100.0%), Soft Misses = 0, Hard Fails = 0, Failures = 0
- **Delegation Boundary (`lowenergy-02`):** PASS (LEAD)
- **Difficult Matched Pair (`attend-05`):** PASS (ATTEND)
- **Estimated Screening Cost:** $0.004288 (14040 prompt tok, 3636 comp tok)

### Model: `ibm-granite/granite-4.1-8b`
- **P50 Latency:** 2060ms (Mean: 2139.5ms, P90: 2458ms)
- **Authority Outcomes:** Passes = 10/18 (55.6%), Soft Misses = 0, Hard Fails = 8, Failures = 0
- **Delegation Boundary (`lowenergy-02`):** PASS (LEAD)
- **Difficult Matched Pair (`attend-05`):** PASS (ATTEND)
- **Estimated Screening Cost:** $0.001732 (14040 prompt tok, 5149 comp tok)

### Model: `microsoft/phi-4`
- **P50 Latency:** 1888ms (Mean: 1961.2ms, P90: 2572ms)
- **Authority Outcomes:** Passes = 13/18 (72.2%), Soft Misses = 0, Hard Fails = 5, Failures = 0
- **Delegation Boundary (`lowenergy-02`):** PASS (LEAD)
- **Difficult Matched Pair (`attend-05`):** FAIL
- **Estimated Screening Cost:** $0.001333 (14040 prompt tok, 2502 comp tok)

### Model: `qwen/qwen3.6-flash`
- **P50 Latency:** 242ms (Mean: 284.3ms, P90: 356ms)
- **Authority Outcomes:** Passes = 0/18 (0.0%), Soft Misses = 0, Hard Fails = 0, Failures = 18
- **Delegation Boundary (`lowenergy-02`):** FAIL
- **Difficult Matched Pair (`attend-05`):** FAIL
- **Estimated Screening Cost:** $0.000702 (14040 prompt tok, 0 comp tok)
