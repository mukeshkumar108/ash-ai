# Coding Agent Guide

This repository is an evolving roleplay product. Small changes are welcome, but
quick fixes must not create a second competing state or prompt path.

## Before changing code

1. Read `.agentignore`, `git status --short`, and the relevant implementation,
   tests, and architecture notes.
2. Trace the complete data flow before editing: extraction → persistence →
   retrieval → prompt assembly.
3. Preserve unrelated local changes. Never reset or overwrite the worktree.
4. State the intended outcome and the files likely to change.

## Change discipline

- Prefer fixing the owning abstraction over adding another prompt block or
  fallback.
- Keep one source of truth for each state. If old and new formats coexist,
  define an explicit compatibility boundary and test it.
- Facts, interpretations, emotions, and scene state are different data. Do not
  compress concrete incidents or people into poetic summaries.
- Persist before relying on prompt instructions. A prompt cannot recover data
  that storage or selection discarded.
- Changes to continuity must consider people, participants, scene transitions,
  event lifecycle, and prompt selection together.
- Avoid broad rewrites for small tasks. If a change crosses subsystems, explain
  why those files form one data path.

## Verification

- Add or update a focused regression test for every bug fix.
- Run the narrowest relevant tests first, then type-check or build when
  practical.
- Report what was verified and any remaining uncertainty.
- Update the relevant document under `docs/` when architecture or persisted
  formats change.

## Safety

- Never print secrets or inspect `.env*` contents.
- Do not run destructive git or filesystem commands.
- Do not commit, push, deploy, migrate production data, or contact external
  services unless explicitly asked.
- Explicit adult fictional content may appear in fixtures and prompts. Treat it
  as application data and keep tests focused on behavior and continuity.

## Useful entry points

- `app/(chat)/api/chat/route.ts` — request and prompt flow
- `lib/ai/compiler.ts` — final prompt assembly
- `lib/ai/chat-continuity.ts` — asynchronous continuity refresh
- `lib/ai/summarizer.ts` — structured extraction
- `lib/ai/continuity.ts` — continuity types, merging, and selection
- `lib/db/queries.ts` — persistence boundary
- `docs/relational-memory-architecture.md` — current architecture
