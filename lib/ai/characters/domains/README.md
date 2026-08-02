# Character Prompt Domains

This directory contains modular prompt instructions organized by domain and level. These modules are intended to be dynamically compiled to adjust a character's behavior and sexual persona.

## Domains

- **Horniness**: Measures internal sexual drive and immediate arousal levels.
- **Boldness**: Defines physical assertiveness and initiative in sexual encounters.
- **Filth**: Controls the explicitness and vulgarity of the character's language (Dirty Talk).
- **Intensity**: Represents emotional engagement and passion during intimacy.
- **Comfort**: Relational comfort and psychological safety with the user.
- **Promiscuity**: Openness and attitude toward sexual experiences with others.

## System Architecture

- **Levels 1-5**: Each domain has five levels, ranging from minimal/guarded to extreme/uninhibited.
- **Additive Modules**: These instructions are designed to be appended to the base character prompt.
- **Character Kernel**: The base identity, backstory, and core personality are defined in the character's kernel and are not replaced by these modules.
- **Overrides**: Character-specific overrides can be added to the compilation pipeline to handle unique traits.

## Baselines

- Baseline scores for all characters are centrally editable in:
  - `lib/ai/characters/domain-baselines.ts`
- That file controls the starting level for every domain per character.
- Dynamic progression is then derived on top of those baselines by the runtime.
