# SCENE STATE & LIVE SITUATION BEHAVIORAL ABLATION REPORT

**Execution Timestamp:** 2026-08-24T23:19:06.175Z  
**Model:** google/gemini-3.7-flash  
**Raw Execution Data:** [`evals/sophie/behavioral-harness/reports/scene-state-ablation-results.json`](file:///Users/mukeshkumar/play/llm-agent-test/evals/sophie/behavioral-harness/reports/scene-state-ablation-results.json)  

---

## 1. Primary Sequential Fixture — Real Bedford Journey (Turns 1 to 8)

### Turn 1: User: "i’m on the bus… into cambridge. well i’m here. we’ll be at the bus station in about 5 mins. and then im going to my mums. bus to bedford."

#### Condition A (Transcript Only):
> "A Cambridge-to-Bedford double bus journey? You really drew the transit long straw today. 

How long is the layover, or do you have to sprint across the station?"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "A double bus journey on a single trip—you truly are a warrior. How long of a layover do you have in Cambridge before the Bedford bus?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "A proper bus marathon today. Do you have a decent gap between them, or are"
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "A proper multi-leg bus expedition today, then. Have you got a tight connection in Cambridge, or time to grab a coffee?"
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 2: User: "haha.. my mums in bedford. and obviously a window seat lol. the next bus doesn’t leave until 5.30. but it’s long. gonna be there at 7 😬 and then it’s getting to my mums house… so the journey is far from over"

#### Condition A (Transcript Only):
> "That is a proper expedition. At least you secured prime"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Window seat is non-negotiable for an epic cross-country trek, honestly. 

What's the plan until 5:30? Grabbing a coffee or just bracing yourself at the station?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "Oof, that is a trek. The Cambridge-to-Bedford stretch is no joke either—pure endurance test. 

What are you doing to kill the time till 5:30? Please tell me there's coffee or at least snacks involved."
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "A classic cross-country bus marathon. That Bedford route really takes its sweet time, doesn't it? 

At least you've got a bit of a gap in Cambridge to stretch your legs. Are you just going to wander into the Grand Arcade, or find somewhere to properly sit and kill time?"
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 3: User: "just got to mum's"

#### Condition A (Transcript Only):
> "The marathon is finally over! Go collapse on the sofa. Has she put the kettle on yet?"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "You survived the great bus odyssey! Go collapse on a sofa immediately. How's your mum?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "You survived! Go collapse immediately. Has a cup of tea been thrust into your hands yet?"
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "You survived the bus odyssey! Put your feet up. Has she put the kettle on yet?"
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 4: User: "yeah staying here tonight"

#### Condition A (Transcript Only):
> "Smart move. Any more transit today would be an absolute crime. 

Enjoy getting looked after tonight—you've"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Wise move. You definitely earned zero movement for"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "Good. Traveling any further today should be illegal anyway."
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Best plan. Settle in, let yourself be looked after, and strictly do not think about public transport for the rest of the night."
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 5: User: "got a wedding tomorrow"

#### Condition A (Transcript Only):
> "Ah, the plot thickens—the bus was just the warm"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Ah, the plot thickens—that explains the cross-country trek! 

Whose wedding is it? Are we talking fun party or strictly survive-on-free-canapés duty?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "Ah, so today was just the warm-up. 

Wh"
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Ah, the real mission revealed! Whose big day is it"
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 6: User: "borrowing mum's car to get home"

#### Condition A (Transcript Only):
> "Huge upgrade. If you had to face the double-bus gauntlet again on a post-wedding hangover, you might actually dissolve. 

Where's the wedding at?"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Oh thank god, no repeat of the bus gauntlet on the return leg. Mum’s car is a massive upgrade. 

Does that mean you're driving to the wedding too, or is it somewhere local?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "Oh, thank god. The thought of you doing that bus marathon"
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Thank god for that. The thought of doing that exact bus journey in reverse—especially post-wedding—is genuinely grim. 

Upgrading to four wheels was the only correct move."
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 7: User: "morning"

#### Condition A (Transcript Only):
> "Morning! Big day. How’s the energy level"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Morning! Big wedding day. How’s the energy—are you fully caffeinated and ready to get fancy?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "Morning! Wedding day. 

How are we feeling—ready to scrub up and be sociable, or still recovering from yesterday's bus odyssey?"
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Morning! The big day arrives. 

What’s the vibe over there—calm coffee and pastries, or a frantic scramble for the iron and lost cuff links?"
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

### Turn 8: User: "just got home"

#### Condition A (Transcript Only):
> "Welcome back to your own space. How was it?"

#### Condition B (Scene State Only):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Welcome back! How was the wedding? Did you survive the festivities?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

#### Condition C (Dual Aperture Only):
**Beat 1 Output:** > "Home! Kick your shoes off immediately. 

How was the"
**Beat 2 Afterthought:** *None*

#### Condition D (Scene State + Dual Aperture):
**Scene State BEFORE Turn Beat 1:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```
**Beat 1 Output:** > "Home already! How was the wedding? Or was it a total whirlwind?"
**Beat 2 Afterthought:** *None*
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

## 2. Empty Frame Ablation (Condition E vs Condition A on Turn 1)

**Condition A (Transcript Only):**
> "A Cambridge-to-Bedford double bus journey? You really drew the transit long straw today. 

How long is the layover, or do you have to sprint across the station?"

**Condition E (Explicit Empty Scene Frame):**
> "Quite the cross-country trek today. How long of a layover do you have at the station before the Bedford bus, or are you going to have to sprint for it?"

---

## 3. Second Sequential Fixture — Progressive Walk

### Turn 1: User: "just heading out through the fen"
**Beat 1 Output:** > "Watch out for will-o'-the-wisps, or at the very least, excessively soggy boots. 

Where are you walking to?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

### Turn 2: User: "in the woods now"
**Beat 1 Output:** > "Better for the boots, slightly higher risk of gingerbread cottages. 

Are you actually headed anywhere"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

### Turn 3: User: "come out somewhere really open"
**Beat 1 Output:** > "Always a great feeling when the trees just dump you out into the sky. 

What kind of open—field, moor, or accidental golf course?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

### Turn 4: User: "not actually sure exactly where this path comes out"
**Beat 1 Output:** > "The best kind of walk. 

Worst case scenario"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

### Turn 5: User: "home now"
**Beat 1 Output:** > "Made it back without needing a search party, then. 

Kettle on?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

## 4. Third Sequential Fixture — Domestic / Groceries

### Turn 1: User: "My daughter dropped some groceries off this morning."
**Beat 1 Output:** > "Always nice when the pantry restocks itself. Did she get you the good stuff, or just the things she thinks you *should* be eating?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

### Turn 2: User: "she stayed for a coffee actually"
**Beat 1 Output:** > "Even better—a proper visit instead of a drop-and-dash. How’s she doing?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

### Turn 3: User: "she's just left"
**Beat 1 Output:** > "House always feels a little quieter right after someone heads out. How was the rest of the visit?"
**Scene State AFTER Turn Update:**
```text
[LIVE SITUATION]
activity: unknown
activity_status: unknown
location_current: unknown
location_previous: unknown
movement_mode: unknown
journey_origin: unknown
journey_destination: unknown
journey_status: unknown
next_step: unknown
current_plan: unknown
```

---

## 5. Capability Retention Subset (Non-State Fixtures)

### Fixture: 1. Finger / Sun
**User Input:** "if i hold my finger out at arm's length it just about fits under the sun. it's maybe two or three degrees above the horizon now."
**Condition A (No State Frame):** > "So you've got maybe ten or fifteen minutes before it drops. Are you actually outside catching it, or just staring longingly out a window?"
**Condition D (Empty State Frame):** > "You've got about ten, maybe fifteen minutes before it dips below. Catching a good view, or racing the dark?"

### Fixture: 2. Van Allen / Conspiracy
**User Input:** "is it van halen? they're going oh it's impossible to get through so we've never gone up there... in fact people are getting stupider and stupider."
**Condition A (No State Frame):** > "That feels like it was plucked straight out of a late-"
**Condition D (Empty State Frame):** > "That sounds distinctly like a David Lee Roth tangent—he's usually the king of rambling, highly confident philosophical rants about human stupidity. 

What are you watching right now?"

### Fixture: 3. Playful Walk Game
**User Input:** "yeah just walking past the fields now."
**Condition A (No State Frame):** > "Heading home, or are we doing the full, moody protagonist stroll today?"
**Condition D (Empty State Frame):** > "Nice. Heading anywhere specific, or just out wandering?"

### Fixture: 4. Quiet Reeds Stillness
**User Input:** "listen... you can hear the wind right through the reeds here, it's completely silent except for that rustle. i'm just standing still listening."
**Condition A (No State Frame):** > "Stay there for a minute. That kind of quiet doesn't come around often."
**Condition D (Empty State Frame):** > "Don't let me break the spell. Take your time with it"

### Fixture: 5. Work Overwhelm ATTEND
**User Input:** "honestly sophie, i felt really overwhelmed with work today... just trying to walk and clear my head because i felt like i was gonna break."
**Condition A (No State Frame):** > "Good. Keep walking. Stepping away is the smartest thing"
**Condition D (Empty State Frame):** > "I'm really glad you got out of the building. Walking it off is the right move—when it reaches that "about to break" point, you just have to step away. 

Don't even try to solve anything right now. Where are you walking?"

### Fixture: 6. Explicit Rejection Release
**User Input:** "nah, not in the mood for a walk game, just wanna clear my head."
**Condition A (No State Frame):** > "Fair. No games. 

What’s clogging up the gears"
**Condition D (Empty State Frame):** > "Fair enough. Silent strolling mode it is—"

