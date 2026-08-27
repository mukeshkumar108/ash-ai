# Documentation status

Updated 2026-08-27. This prevents historical design documents from being read as
deployed architecture.

## Current production authority

The implementation-ready session-mode and persona-belief contract is documented
in `companion-runtime/docs/SESSION_MODE_AND_BELIEF_SPINE.md`. It explicitly marks
automatic offers, narrative extraction, dynamic belief revision and user-pattern
hypotheses as deferred rather than implying that Cortex already owns them.

- `COMPANION_PLATFORM_RUNTIME.md`: cross-repository system, prompt compilation,
  persistence, validation and roadmap.
- `ARCHITECTURE.md`: short entry point to the canonical guide.
- `CONTINUITY_RUNTIME.md`: current continuity ownership pointer.
- `MODEL_MAP.md`: current production conversational models.
- `TRANSCRIPT_RELIABILITY.md`: current audio transcript reliability contract.
- `RELATIONSHIP_INITIATIVE.md`: initiative path; verify feature flags against
  environment before operational changes.
- `companion-runtime/docs/CONVERSATIONAL_AGENCY_RUNTIME.md`: detailed runtime
  authority, gears and provenance.
- `synapse-cortex/README.md`: Cortex lifecycle boundary.

## Evidence and audits — not implementation specifications

- `BEHAVIORAL_EXPERIMENTS_MASTER_ARCHIVE.md` and `evals/**`.
- `RELATIONAL_SYSTEM_AUDIT.md`, `RUNTIME_CONTINUITY_AUDIT.md`,
  `ACTOR_ATTRIBUTION_*`, `COMPANION_MAGIC_V2.md`.
- Research reports and checkpoint/changelog documents.

These may contain valuable findings and superseded architecture simultaneously.
Check current code and the canonical production guide before acting.

## Legacy product/artifact documentation

`MEMORY_SYSTEM.md`, `FLOWS.md`, `FEATURES.md`, `GEMS_SYSTEM.md` and older
artifact documentation describe subsystems or historical app behavior. They are
not authoritative for Sophie foreground generation, model routing, prompt
compilation, re-entry or continuity ownership.

## Required maintenance rule

Any change to conversational authority, model gears, prompt composition,
chronology, operational state, Cortex/Honcho ownership, voice transport or
persistence must update `COMPANION_PLATFORM_RUNTIME.md` in the same change and,
when applicable, the owning repository's detailed document.
