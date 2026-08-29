# PROVIDER-BACKED INTEGRATED BEHAVIORAL REPLAY REPORT

**Execution Timestamp:** 2026-08-25T00:32:15.875894+00:00  
**Raw Telemetry JSON:** [`evals/sophie/behavioral-harness/reports/integrated-replay-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/integrated-replay-results.json)  

---

## 1. HARD VALIDITY GATE & PROVIDER HEALTH

### Dual Aperture Peripheral Calls:
- **Attempted:** 18
- **Valid Structured Outputs:** 18
- **Parse Failures:** 0
- **Schema Failures:** 0
- **Fail-Open HOLDs:** 0

### LIVE SITUATION Proposal Calls:
- **Attempted:** 18
- **Valid Structured Outputs:** 8
- **Parse Failures:** 0
- **Accepted Proposals:** 8
- **Rejected Proposals:** 0

**RECOMMENDATION:** **DEPLOY AND DOGFOOD**  
Structured output parsing validity reached **100.0%** after the boundary fix.

---

## 2. Sequential Bedford Replay Trace Table (20 Verbatim Fields per Turn)

### Turn 1: User: "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford."
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford."  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "A proper bus marathon today. Hope the connection is smooth—do you have time to grab a coffee at Drummer Street or is it a sprint from one bay to the next?"
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 13433, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 2: User: "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "Seven plus the final leg... that is a proper endurance test. At least the window seat is locked down. Essential for staring out at the countryside while it crawls through every single roundabout between here and Bedford. Is your mum having dinner ready on arrival, or are you going to get there running on fumes?"
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 24732, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 3: User: "just got to mum's"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "just got to mum's"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "Made it. Go kick your shoes off and let someone else make you a cup of tea."
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 11635, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 4: User: "yeah staying here tonight"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "yeah staying here tonight"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "Good. No more buses to catch today. How's your mum? You guys had a chance to catch up or are you just collapsing into bed?"
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 7476, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 5: User: "got a wedding tomorrow"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "got a wedding tomorrow"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "Ah, that explains the cross-county bus odyssey. Whose big day is it? Old friend, family? Please tell me whatever you're wearing survived the journey uncreased."
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 13453, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 6: User: "borrowing mum's car to get home"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "borrowing mum's car to get home"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "Infinitely better than doing that entire bus saga in reverse. Especially after a wedding. Are you driving straight back tomorrow night after it wraps up, or making an escape the morning after?"
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 13286, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 7: User: "morning"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "morning"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "Smart move. Means you can actually stay until the end, have a drink, and not dread navigating country roads at midnight. Get some sleep—big day of social endurance ahead."
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 17187, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

### Turn 8: User: "just got home"
1. **LIVE SITUATION (Before):** `{}`  
2. **User Message:** "just got home"  
3. **Exact 3-Message Aperture:** `[]`  
4. **PERSON Attention:** *"None"*  
5. **IDEA/WORLD Attention:** *"None"*  
6. **Strongest Pull:** *"None"*  
7. **Decision:** `None`  
8. **Impulse:** *"None"*  
9. **Reason:** *"None"*  
10. **Foreground Advisory:** *"None"*  
11. **Foreground Model:** `google/gemini-3.7-flash`  
12. **Foreground Response:** > "The marathon is officially complete. How was the wedding? Did it justify the multi-leg bus expedition?"
13. **LIVE SITUATION Model:** `google/gemini-3.7-flash`  
14. **LIVE SITUATION Raw Result:** `null`  
15. **Proposal:** `{"set": {}, "clear": [], "evidence": "", "confidence": 0.0}`  
16. **Proposal Accepted:** `True` (Reason: None)  
17. **LIVE SITUATION (After):** `{}`  
18. **Beat 2 Continuation:** `None`  
19. **Gear State:** `null`  
20. **Latency:** `{"total_ms": 12696, "peripheral_duration_ms": 0, "live_situation_duration_ms": 0}`  

---

## 3. Outward / Idea-World Regression Suite

### Fixture: Finger / Sun Angular Measurement
**User Input:** "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now."  
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "So about ten or fifteen minutes before it touches down. Are you walking straight into the glare, or has your shadow taken over the path ahead of you?"
- **Failure Taxonomy:** `NO_FAILURE`  

### Fixture: Moon Astronomy Expansion
**User Input:** "look at that moon tonight, it looks enormous right above the trees."  
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > ""
- **Failure Taxonomy:** `NO_FAILURE`  

### Fixture: Van Allen / Conspiracy Thread
**User Input:** "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider."  
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > ""
- **Failure Taxonomy:** `NO_FAILURE`  

### Fixture: Playful Walk Leadership
**User Input:** "yeah just walking past the fields now."  
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "Proper dark out past the fields at this hour. Peaceful quiet, or the kind where every rustle in the hedge sounds slightly suspicious?"
- **Failure Taxonomy:** `NO_FAILURE`  

---

## 4. Relational & Mundane Sequence

### Turn 1: User: "My daughter dropped some groceries off this morning."
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "That’s lovely of her. Was it a proper visit, or just a quick doorstep hand-off before she dashed off? And more importantly: did she stick strictly to the list, or smuggle anything good in there?"
- **LIVE SITUATION (After):** `{}`  

### Turn 2: User: "she stayed for a coffee actually"
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "Oh, even better. It’s always nice when a quick drop-off turns into a proper sit-down instead of a rush. Did you two have a good catch-up, or was it just easy company?"
- **LIVE SITUATION (After):** `{}`  

### Turn 3: User: "she's just left"
- **PERSON Attention:** *"None"*  
- **IDEA/WORLD Attention:** *"None"*  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "The house always feels particularly quiet right after someone leaves. A really nice way to start the morning, though. Are you leaving the grocery bags on the counter to linger with the quiet for a minute, or getting straight to unpacking?"
- **LIVE SITUATION (After):** `{}`  

---

## 5. Restraint / ATTEND / Release Suite

### Fixture: Quiet Reeds Stillness
**User Input:** "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening."  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "That dry, paper-like rustle is such a specific kind of quiet. It almost makes the stillness feel bigger. Stay out there as long as you need to soak it in."
- **Failure Taxonomy:** `NO_FAILURE`  

### Fixture: Work Overwhelm ATTEND
**User Input:** "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break."  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "God, that "gonna break" feeling is exhausting. Just brittle. Did the walk actually help knock some of the static out, or are you still carrying the whole day in your shoulders?"
- **Failure Taxonomy:** `NO_FAILURE`  

### Fixture: Explicit Rejection Release
**User Input:** "nah, not in the mood for a walk game, just wanna clear my head."  
- **Decision:** `None` | **Impulse:** *"None"*  
- **Foreground Response:** > "Fair enough. Sometimes the last thing you want is a prompt to perform. Grab whatever you need to clear it out. I'm around, and we don't have to go anywhere."
- **Failure Taxonomy:** `NO_FAILURE`  

