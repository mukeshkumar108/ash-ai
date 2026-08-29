# Continuity runtime

The current path is documented in
[`COMPANION_PLATFORM_RUNTIME.md`](./COMPANION_PLATFORM_RUNTIME.md).

Ownership is deliberately split:

- app/Postgres: chronology, canonical messages, user-owned immediate scene,
  behavioral corrections and per-chat runtime state;
- Honcho: semantic evidence and retrieval;
- Synapse-Cortex: expectations, open loops, suppressions, deadlines,
  resolutions and bounded JIT continuity;
- Companion Runtime: context selection, conversational authority and foreground
  prompt use.

Earlier Gemini/Nex “re-entry seed” and Social Agency V3 burst descriptions are
historical and must not be used as the production model map. Current authority,
gears, prompt precedence, entry bands, initiative and roadmap live in the
canonical guide.
