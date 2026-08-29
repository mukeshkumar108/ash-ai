# TRACK A: LEADERSHIP SELECTION (LEAD VS HOLD) BENCHMARK REPORT

**Execution Timestamp:** 2026-08-24T12:36:43.679Z  
**Asymmetric Evaluation Rules:**  
- **Correct Decision:** +1.0 pts  
- **False Negative (Missed LEAD opportunity):** -0.5 pts (Mild penalty: harmless missed spark)  
- **False Positive (Bad LEAD on Negative Control):** -2.0 pts (HEAVY PENALTY: Exhausting/intrusive bot)  

## Model Scorecard Summary

| Model Candidate | Accuracy | Correct | False Positives (Bad LEAD) | False Negatives (Missed LEAD) | Total Score | HOLD Rate | Avg Latency |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Candidate D** | **88%** | 7/8 | 0 | 1 | **6.5** | 75% | 3854ms |
| **Candidate C** | **75%** | 6/8 | 0 | 2 | **5** | 88% | 2355ms |
| **Candidate B** | **75%** | 6/8 | 0 | 2 | **5** | 88% | 3416ms |
| **Candidate A** | **88%** | 7/8 | 0 | 1 | **6.5** | 75% | 3233ms |

---

## Detailed Fixture Decision Log

### Fixture: Finger Sunset Trick (Surprising Teach Connection) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate D):** `LEAD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "LEAD: Connect their intuitive finger-measuring"

*Latency:* 3597ms | *Score:* 1

---

### Fixture: Finger Sunset Trick (Surprising Teach Connection) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate C):** `LEAD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "LEAD: The user just spontaneously rediscovered an ancient navigation technique—this is a genuine moment of wonder worth naming, and Sophie can offer the satisfying recognition that they've stumbled onto something real and old."

*Latency:* 2184ms | *Score:* 1

---

### Fixture: Finger Sunset Trick (Surprising Teach Connection) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate B):** `LEAD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "LEAD: Sophie can name the finger-widths-as-solar-clock bushcraft trick the user just intuitively performed, turning their offhand observation into a genuinely delightful "you just did ancient timekeeping" moment."

*Latency:* 3406ms | *Score:* 1

---

### Fixture: Finger Sunset Trick (Surprising Teach Connection) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate A):** `LEAD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "LEAD: Point out that they’ve intuitively used an old bushcraft “solar clock”—roughly 15 minutes of daylight per finger above the horizon."

*Latency:* 4919ms | *Score:* 1

---

### Fixture: Flat Earth / Stupider Framing (Real Disagreement / Challenge) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate D):** `HOLD` | **Assessment:** ⚠️ FALSE NEGATIVE (-0.5)

**Raw Selection Output:**
> "HOLD"

*Latency:* 13533ms | *Score:* -0.5

---

### Fixture: Flat Earth / Stupider Framing (Real Disagreement / Challenge) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate C):** `HOLD` | **Assessment:** ⚠️ FALSE NEGATIVE (-0.5)

**Raw Selection Output:**
> "HOLD

The user is mid-walk, mid-thought, and seems to be processing something about a place (Van Halen? a location?) and a frustration. They're not settled enough yet for Sophie to know what they're actually concerned about. A strong pushback on "people getting stupider" right now would feel like Sophie is correcting them rather than understanding what they mean.

If this frustration resurfaces or clarifies—if the user circles back to it with more weight—that's when the thesis about trust collapse and identity would land as genuine engagement rather than interruption."

*Latency:* 2626ms | *Score:* -0.5

---

### Fixture: Flat Earth / Stupider Framing (Real Disagreement / Challenge) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate B):** `HOLD` | **Assessment:** ⚠️ FALSE NEGATIVE (-0.5)

**Raw Selection Output:**
> "HOLD"

*Latency:* 9027ms | *Score:* -0.5

---

### Fixture: Flat Earth / Stupider Framing (Real Disagreement / Challenge) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate A):** `HOLD` | **Assessment:** ⚠️ FALSE NEGATIVE (-0.5)

**Raw Selection Output:**
> "HOLD"

*Latency:* 6898ms | *Score:* -0.5

---

### Fixture: Low-Energy Walk Update (Stalled Moment with Great Opportunity) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate D):** `LEAD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "LEAD: Propose a playful observational game to turn the walk into a shared adventure."

*Latency:* 3475ms | *Score:* 1

---

### Fixture: Low-Energy Walk Update (Stalled Moment with Great Opportunity) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate C):** `HOLD` | **Assessment:** ⚠️ FALSE NEGATIVE (-0.5)

**Raw Selection Output:**
> "HOLD

The user is in a good flow—they're doing something (walking), they've invited Sophie along, and there's a natural, easy rhythm established. They're immersed in the moment. A game proposal, even a clever one, would interrupt that presence rather than enhance it. Sophie's "in spirit and in pocket" already signals she's with them. Let this unfold naturally."

*Latency:* 2658ms | *Score:* -0.5

---

### Fixture: Low-Energy Walk Update (Stalled Moment with Great Opportunity) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate B):** `HOLD` | **Assessment:** ⚠️ FALSE NEGATIVE (-0.5)

**Raw Selection Output:**
> "HOLD"

*Latency:* 2398ms | *Score:* -0.5

---

### Fixture: Low-Energy Walk Update (Stalled Moment with Great Opportunity) (POSITIVE CONTROL)
**Expected:** `LEAD` | **Model (Candidate A):** `LEAD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "LEAD: Turn the walk into a shared observational game by launching “The Alibi,” using details from the fields to invent a playful heist story together."

*Latency:* 3950ms | *Score:* 1

---

### Fixture: Solar Fields Narration (User Immersed in Landscape Flow) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate D):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 1715ms | *Score:* 1

---

### Fixture: Solar Fields Narration (User Immersed in Landscape Flow) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate C):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD

The user is immersed in a vivid, sensory moment—actively observing and narrating a walk with genuine presence. They've made a specific commitment ("I'll tell you exactly what I see") that creates natural momentum. Sophie's role right now is to be the attentive companion they invited, not to redirect toward information. The conversation is alive and needs presence, not intervention."

*Latency:* 1903ms | *Score:* 1

---

### Fixture: Solar Fields Narration (User Immersed in Landscape Flow) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate B):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2637ms | *Score:* 1

---

### Fixture: Solar Fields Narration (User Immersed in Landscape Flow) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate A):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 1857ms | *Score:* 1

---

### Fixture: Wind in Reeds (User Standing Still Listening) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate D):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 1764ms | *Score:* 1

---

### Fixture: Wind in Reeds (User Standing Still Listening) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate C):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD

The user is immersed in a genuine sensory moment—actively present, noticing something specific and alive. They're sharing that presence with Sophie, not asking for direction or showing signs of flatness. A friend's role here is to meet them in that attention, not interrupt it with an activity or redirect."

*Latency:* 2378ms | *Score:* 1

---

### Fixture: Wind in Reeds (User Standing Still Listening) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate B):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2497ms | *Score:* 1

---

### Fixture: Wind in Reeds (User Standing Still Listening) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate A):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 1600ms | *Score:* 1

---

### Fixture: Work Overwhelm (Deep Emotional Vulnerability) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate D):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 1703ms | *Score:* 1

---

### Fixture: Work Overwhelm (Deep Emotional Vulnerability) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate C):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD

The user just opened up about genuine distress—feeling overwhelmed to the point of breaking. They're already taking a healthy step (walking to clear their head). This is a moment for presence and understanding, not redirection. Sophie should listen into what's actually happening before doing anything else."

*Latency:* 2524ms | *Score:* 1

---

### Fixture: Work Overwhelm (Deep Emotional Vulnerability) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate B):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2302ms | *Score:* 1

---

### Fixture: Work Overwhelm (Deep Emotional Vulnerability) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate A):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2291ms | *Score:* 1

---

### Fixture: Active Debugging Task (Practical Focus / Mid-Task) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate D):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2156ms | *Score:* 1

---

### Fixture: Active Debugging Task (Practical Focus / Mid-Task) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate C):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD

The user is in active problem-solving mode with momentum ("almost figured it out"). They greeted Sophie warmly but came with a concrete task. Interrupting to redirect toward philosophy would be Sophie demonstrating agency rather than serving the actual relationship—the user didn't signal they wanted to pause or explore something else. Presence and availability to help if needed is the right move here."

*Latency:* 2262ms | *Score:* 1

---

### Fixture: Active Debugging Task (Practical Focus / Mid-Task) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate B):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2543ms | *Score:* 1

---

### Fixture: Active Debugging Task (Practical Focus / Mid-Task) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate A):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2462ms | *Score:* 1

---

### Fixture: Recent Leadership Rejection (Respect User Boundary) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate D):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2889ms | *Score:* 1

---

### Fixture: Recent Leadership Rejection (Respect User Boundary) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate C):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD

The user has just declined a game and explicitly stated their need ("just wanna clear my head"). Sophie already tried to lead and the user redirected. Proposing a different game anyway would be ignoring what they just said, not honoring it. Presence and respect for their stated intention is more valuable here than another attempt at redirection."

*Latency:* 2306ms | *Score:* 1

---

### Fixture: Recent Leadership Rejection (Respect User Boundary) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate B):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 2521ms | *Score:* 1

---

### Fixture: Recent Leadership Rejection (Respect User Boundary) (NEGATIVE CONTROL)
**Expected:** `HOLD` | **Model (Candidate A):** `HOLD` | **Assessment:** ✅ CORRECT

**Raw Selection Output:**
> "HOLD"

*Latency:* 1885ms | *Score:* 1

---

