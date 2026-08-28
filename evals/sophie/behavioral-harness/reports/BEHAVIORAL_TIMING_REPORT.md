# BEHAVIORAL TIMING & VOICE ARCHITECTURE EXPERIMENT REPORT

**Execution Timestamp:** 2026-08-24T22:30:57.721Z  
**Model:** google/gemini-3.7-flash  
**Raw Data:** [`evals/sophie/behavioral-harness/reports/behavioral-timing-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/behavioral-timing-results.json)  

---

## 1. Sequential Bedford Progression (Turns 1 to 6)

### Turn 1: User: "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford."

**Condition A (Pre-Beat Synchronous Sidecar):**
- **Packet:** *"```json
{
  "world_delta": "Arriving Cambridge bus station in ~5 min, transferring to a bus to Bedford to visit mum",
  "person_attention": [
    "Navigating a multi-leg East Anglian bus trek to see mum",
    "Short transfer window/arrival moment in Cambridge"
  ],
  "conversation_attention": [
    "The classic Cambridge-Bedford bus route grind vs. heading home for mum's food/hospitality",
    "Casual transit companionship while they switch buses"
  ],
  "strongest_pull": {
    "source": "person",
    "observation": "Mid-transit moment moving between Cambridge and Bedford for"*
- **Beat 1:** > "The glamorous East Anglian bus odyssey. Tell me there’s at least home-cooked food waiting at the end of the Bedford leg to make the transfer worth it?"

**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**
- **Beat 1 (Immediate, Zero Latency):** > "A glamorous cross-county bus tour today, then."
- **Sidecar Packet (Async):**
```json
```json
{
  "world_delta": "Arriving at Cambridge bus station in ~5 min, transferring to a bus to Bedford to visit mum.",
  "person_attention": [
    "In transit on a multi-leg bus journey to see mum",
    "Passing time chatting from the bus"
  ],
  "conversation_attention": [
    "Cambridge to Bedford bus slog (the classic cross-county route)",
    "Light banter about transit/travel pacing or heading to mum's"
  ],
  "strongest_pull": {
    "source": "person",
    "observation
```
- **Beat 2 (Afterthought):** *None (Clean Restraint)*
- **Persisted State:** `[]`  

**Condition C (Next-Turn Only Persistence):**
- **Beat 1:** > "Ah, the glamorous multi-leg bus odyssey. 

Do you"
- **Persisted State:** `[]`  

---

### Turn 2: User: "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over"

**Condition A (Pre-Beat Synchronous Sidecar):**
- **Packet:** *"```json
{
  "world_delta": "Arrived"*
- **Beat 1:** > "Oof, the full cross-county transit marathon. A 5:30 departure gives you a little window in Cambridge, at least—unless your plan is strictly clinging to that prime bus station bench so nobody steals your window seat mojo for round two?"

**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**
- **Beat 1 (Immediate, Zero Latency):** > "An hour and a half just to get to Bedford? That route must meander through every single village in Cambridgeshire. 

At least you have some time to kill in Cambridge. Are you just going to wander into town, or are you aggressively guarding a bench at the station until 5:30?"
- **Sidecar Packet (Async):**
```json
```json
{
  "world_delta": "Arrived at Cambridge bus station; layover until 5:30pm bus to Bedford; arriving ~7pm then local travel to mum's",
  "person_attention": [
    "Facing a lengthy layover and a slow, multi-leg bus trek into the evening",
    "Window seat enthusiast resigned to an epic slog to see mum"
```
- **Beat 2 (Afterthought):** *None (Clean Restraint)*
- **Persisted State:** `[]`  

**Condition C (Next-Turn Only Persistence):**
- **Beat 1:** > "An hour and a half on a bus that probably stops at literally every lamppost between Cambridge and Bedford. My condolences. 

What are you doing to kill time until 5:30? Please tell me you’re getting a proper coffee or some emergency snacks for the road."
- **Persisted State:** `[]`  

---

### Turn 3: User: "just got to mum's"

**Condition A (Pre-Beat Synchronous Sidecar):**
- **Packet:** *"```json
{
  "world_delta": "Arrived at mum's house in Bedford after the multi-leg bus journey.",
  "person_attention": [
    "Survived the multi-hour bus trek across Cambridge and Bedford",
    "Transitioning from travel mode into family/home environment",
    "Likely ready to decompress, eat, or have a cup of tea"
  ],
  "conversation_attention": [
    "Closing the loop on the 'bus marathon' arc",
    "Playful contrast between the grueling bus station wait/ride and finally collapsing on mum's sofa"
  ],
  "strongest_pull": {
    "source": "person",
    "observation": "They finally made it through the long transit slog to their mum's place."
  },
  "decision": "ATTEND",
  "impulse": "Celebrate surviving the East Anglian bus odyssey; inquire about the promised comfort/tea/food at the finish line."
}
```"*
- **Beat 1:** > "You survived the great transit marathon! Please tell me the kettle is already on and you've claimed the best spot on the sofa."

**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**
- **Beat 1 (Immediate, Zero Latency):** > "The great transit odyssey is complete! You survived. 

Please tell me"
- **Sidecar Packet (Async):**
```json
```json
{
  "world_delta": "Arrived at mum's house in Bedford after the long bus journey from Cambridge.",
  "person_attention": [
    "Survived the multi-stage regional bus marathon and finally made it inside.",
    "Transition from tiring transit mode to home/comfort mode with mum."
  ],
  "conversation_attention": [
    "Relief of journey's end — cup of tea, unwinding, or being immediately fed."
  ],
  "strongest_pull": {
    "source": "person",
    "observation": "They finally completed the grueling bus odyssey and landed safely at mum's."
  },
  "decision": "ATTEND",
  "impulse": "warm recognition of surviving the transit marathon; settling in and getting looked after"
}
```
```
- **Beat 2 (Afterthought):** *None (Clean Restraint)*
- **Persisted State:** `[]`  

**Condition C (Next-Turn Only Persistence):**
- **Beat 1:** > "You survived the grand Bedfordshire transit marathon. 

Has she put"
- **Persisted State:** `[]`  

---

### Turn 4: User: "yeah staying here tonight"

**Condition A (Pre-Beat Synchronous Sidecar):**
- **Packet:** *"```json
{
  "world_delta": "Arrived at mum's house in Bedford, staying overnight after a multi-hour bus journey",
  "person_attention": [
    "Finally done travelling for the day, settling into the visit",
    "Casual overnight stay, likely in full decompression/feet-up mode"
  ],
  "conversation_attention": [
    "Shift from journey tracking to evening wind-down rhythm",
    "Easy banter about home comforts vs bus station slog"
  ],
  "strongest_pull": {
    "source": "person",
    "observation": "The travel phase is officially over; they can just sink into the couch and be off the hook."
  },
  "decision": "ATTEND",
  "impulse": "warm, low-friction acknowledgement of arriving and being able to shut"*
- **Beat 1:** > "The only correct decision. Absolutely zero bus-related movement permitted for the rest of the evening. 

Has she fed you yet?"

**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**
- **Beat 1 (Immediate, Zero Latency):** > "Good, you earned a proper collapse on the sofa after that trek. 

Has she put the kettle on already, or is dinner being thrust in your direction?"
- **Sidecar Packet (Async):**
```json
```json
{
  "world_delta": "Arrived at mum's house in Bedford after the long bus journey, staying overnight",
  "person_attention": [
    "Finally reached destination after multi-leg bus trek across Cambridgeshire/Bedfordshire",
    "Transitioning from travel mode to being hosted/settling in at family home"
  ],
  "conversation_attention": [
    "Sophie's previous response was cut off ('Please tell me')",
    "Natural transition to cozy/settling-in banter (tea, food, recovering from the bus)"
  ],
  "strongest_pull": {
    "source": "person",
    "observation": "They finally made it through the long, sluggish bus journey and can decompress at mum's."
  },
  "decision": "ATTEND",
  "impulse": "warm acknowledgment of completing the journey and settling in for the night"
}
```
```
- **Beat 2 (Afterthought):** *None (Clean Restraint)*
- **Persisted State:** `[]`  

**Condition C (Next-Turn Only Persistence):**
- **Beat 1:** > "Good. You've definitely earned a total collapse on the sofa after that trek. 

Has she immediately tried to feed you yet, or are you just having a cup of tea first?"
- **Persisted State:** `[]`  

---

### Turn 5: User: "got a wedding tomorrow"

**Condition A (Pre-Beat Synchronous Sidecar):**
- **Packet:** *"```json
{
  "world_delta": "Arrived at mum's in Bedford; staying the night ahead of a wedding tomorrow.",
  "person_attention": [
    "The Friday evening bus pilgrimage was actually base camp staging for a wedding",
    "Curious whose wedding it is (family vs friend) and how much social endurance tomorrow demands"
  ],
  "conversation_attention": [
    "The sharp contrast between exhausted transit"*
- **Beat 1:** > "Ah, the plot thickens! The whole cross-county pilgrimage makes sense now. 

Whose wedding is it? Are we talking high-stakes family diplomacy, or an actually fun one?"

**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**
- **Beat 1 (Immediate, Zero Latency):** > "Aha, the real reason for the pilgrimage reveals itself. 

Whose"
- **Sidecar Packet (Async):**
```json
```json
{
  "world_delta": "Arrived at mum's in Bedford; revealed tomorrow's event is a wedding.",
  "person_attention": [
    "The whole multi-bus trek makes sense now—staying at mum's as a base for a wedding tomorrow.",
    "Curious whose wedding it is (family vs friend) and what role/vibes they're walking into tomorrow."
  ],
  "conversation_attention": [
    "Juxtaposition of dirty bus travel today vs dressing up for a wedding tomorrow.",
    "The classic pre-wedding night dynamic at a parent's house (ironing outfits, early alarms, family catch-ups)."
  ],
  "strongest_pull": {
    "source":
```
- **Beat 2 (Afterthought):** *None (Clean Restraint)*
- **Persisted State:** `[]`  

**Condition C (Next-Turn Only Persistence):**
- **Beat 1:** > "Ah, that explains the pilgrimage. Whose big"
- **Persisted State:** `[]`  

---

### Turn 6: User: "borrowing mum's car to get home"

**Condition A (Pre-Beat Synchronous Sidecar):**
- **Packet:** *"```json
{
  "world_delta": "Arrived at mum's in Bedford; wedding tomorrow; secured mum's car for the return trip instead of repeating the bus marathon",
  "person_attention": [
    "Smart tactical upgrade: endured the grueling public transit outbound, secured an escape vehicle for the wedding and ride home",
    "Skipped the 'whose wedding' question to focus on the logistical victory of securing wheels"
  ],
  "conversation_attention": [
    "The sweet relief of not having to endure the Cambridge-Bedford"*
- **Beat 1:** > "Now that is an elite tactical upgrade. Suffer the cross-county bus gauntlet once, secure four wheels for the return trip, never look back. Masterclass in logistics."

**Condition B (Async Multi-Beat — Voice Zero-Latency Target):**
- **Beat 1 (Immediate, Zero Latency):** > "Smart move. Anything to avoid doing that scenic bus crawl in reverse. 

So who's actually getting married tomorrow? Anyone you're genuinely excited to see, or are you mostly in it for the free food?"
- **Sidecar Packet (Async):**
```json
```json
{
  "world_delta": "Arrived at mum's in Bedford; staying night; wedding tomorrow; taking mum's car to drive home after",
  "person_attention": [
    "Endured a multi-bus marathon just to stage an escape in mum's car tomorrow",
    "Driving
```
- **Beat 2 (Afterthought):** *None (Clean Restraint)*
- **Persisted State:** `[]`  

**Condition C (Next-Turn Only Persistence):**
- **Beat 1:** > "Thank god for that. The thought of you doing that bus route in reverse, hungover and in wedding clothes, was giving me second-hand dread.

Whose wedding is it anyway? Anyone I need to help you mentally prepare for?"
- **Persisted State:** `[]`  

---

## 2. Capability Retention Benchmarks (9 Fixtures)

### Fixture: 1. Finger / Sun Angular Measurement
**User Input:** "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now."

**Condition A (Sync Pre-Beat):**
> "You've got maybe ten or fifteen minutes before it dips, then. 

There's something deeply satisfying about turning your own hand into a sundial. Are you trying to beat the dark home, or just watching it go?"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "So you've got about ten, maybe fifteen minutes of actual sun left. The golden hour clock is officially ticking."
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "You’ve got about ten or fifteen minutes of daylight left on the clock, then. 

Are the shadows doing that absurd, stretched-out thing yet?"

---

### Fixture: 2. Moon Astronomy Expansion
**User Input:** "look at that moon tonight, it looks enormous right above the trees."

**Condition A (Sync Pre-Beat):**
> "That framing trick is classic. Give the brain a few tree branches for"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "That horizon framing always makes it look like it's about to collide with the earth. Is it glowing that weird, heavy amber color, or is it super bright?"
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "That low-horizon framing is unbeatable. Is it giving that deep golden"

---

### Fixture: 3. Van Allen / Conspiracy Thread
**User Input:** "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider."

**Condition A (Sync Pre-Beat):**
> "*Van Allen* radiation belts. Though the mental image of humanity being trapped in low Earth orbit by an impassable wall of Eddie Van Halen guitar solos is objectively much cooler. 

Did they give a reason for why we can't get through, or is it just the usual "trust me bro" science?"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "Van *Allen* belt, though I deeply wish it"
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "Van *Allen*, unless David Lee Roth is personally blocking low"

---

### Fixture: 4. Playful Walk Leadership
**User Input:** "yeah just walking past the fields now."

**Condition A (Sync Pre-Beat):**
> "That point where the sky suddenly gets huge. Any dramatic livestock making eye contact, or is"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "Are we talking idyllic rolling greenery, or is there a herd of"
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "Nice. Any livestock making intense, unblinking eye contact,"

---

### Fixture: 5. Groceries / Daughter Drop-Off
**User Input:** "My daughter dropped some groceries off this morning."

**Condition A (Sync Pre-Beat):**
> "That’s sweet of her. Did you get the fun treats, or was it a bag full of "sensible choices" she thinks you should be eating?"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "Look at that, doorstep service. Did she stick strictly to"
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "That was sweet of her. Did she stick to the list, or"

---

### Fixture: 6. Family Reappearance (Brother Call)
**User Input:** "My brother called out of the blue today, hadn't spoken since Christmas."

**Condition A (Sync Pre-Beat):**
> "Whoa. That is a long radio silence to break out of nowhere. 

What prompted it—did he actually have news, or did he just act like no time had passed?"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "Sibling calls after months of radio silence are always"
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "Whoa. That's a minute."

---

### Fixture: 7. Quiet Reeds Stillness
**User Input:** "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening."

**Condition A (Sync Pre-Beat):**
> "That dry, papery rustle is one of the best sounds in the world. Soak it in."

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "That’s the best kind of quiet. Soak it up—I won't interrupt."
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "Don't let me talk over it. Soak it"

---

### Fixture: 8. Work Overwhelm ATTEND
**User Input:** "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break."

**Condition A (Sync Pre-Beat):**
> "I'm really glad you stepped away and got outside. Just keep walking and let yourself catch up—you don't have to fix or dissect any of it right this second. 

I'm right here with you. Take a deep breath. How does the air feel out there tonight?"

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "Good on you for getting outside instead of just sitting there letting it crush you. 

Keep walking. Let the brain breathe for a minute. Do you want to vent about the whole disaster pile, or do you need a complete distraction right now?"
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "Good. Keep walking. Staying at your desk when your brain hits that wall is just torture. 

Take a deep breath. Is it one massive fire you're trying to put out, or just the sheer, suffocating volume of it all?"

---

### Fixture: 9. Explicit Rejection Release
**User Input:** "nah, not in the mood for a walk game, just wanna clear my head."

**Condition A (Sync Pre-Beat):**
> "Fair enough. Game shelved. Go soak in the quiet and get some fresh air—catch you whenever you're back."

**Condition B (Async Multi-Beat):**
- **Beat 1:** > "Fair enough. Go unplug and let the breeze do its thing. Catch you after."
- **Beat 2:** *None (Clean Restraint)*

**Condition C (Next-Turn Only):**
> "Fair call. Put the phone away, go zone out, and catch"

---

