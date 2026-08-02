# Changelog Checkpoint — 2025-07-27

## State before refactor

### What's working
- Identity-driven kernels (Isa, Elena) with concrete behavioral defaults
- Ontology extraction with event class checklist (10 classes)
- Person models with accumulated evaluations
- Expression domains gated on NPC presence
- Canonical event safety net (high-reliability binary extraction)
- CURRENT_BELIEFS suppressed in closed mode (breaks feedback loop)
- [OTHER PERSON NOW] block with user emotion extraction
- Repair agency language in response style
- Scene state replacement on change detection
- Preview route gates domain display on NPC presence

### Issues identified
1. **Compiler blocks too verbose** — prose paragraphs where bullet-point facts would be more effective
2. **[ESTABLISHED] mixes traits and events** — durable character traits and recent past events in same block
3. **Kernel has too much "do" language** — tells the model what to DO rather than who to BE
4. **Context collapse risk** — verbose blocks dilute signal as scene length grows

### Changes applied
1. Compressed all compiler blocks to bullet-point facts — removed prose paragraphs, narrative commentary
2. Split [ESTABLISHED] into [CHARACTER] (traits, values, bond) and [RECENT] (canonical events, scene frame)
3. Renamed blocks for concision: [OTHER PERSON NOW] → [OTHER PERSON], [CURRENT BELIEFS] → [BELIEVES], [CURRENT FEELINGS] → [FEELINGS], [RELATIONSHIP REALITY] → [REALITY], [FAILED STRATEGIES] → [FAILED], [RESPONSE STYLE] → [STYLE]
4. Compressed [PEOPLE] block to single-line per person
5. Compressed [EXPRESSION] block to compact format
6. Compressed [MODE] block to single-line
7. Kernel "do" language retained — describes identity through behavior, appropriate for character definition
8. Total blocks: 14 (compressed from equivalent 17 lines of logic to ~70 lines of code)
9. No new primitives, no new storage

### Still open
- Model capability profiles (full/compact/minimal prompt tiers)
- Reorientation primitive (user correction detection)
- New chat API

