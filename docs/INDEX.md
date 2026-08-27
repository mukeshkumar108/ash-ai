# Docs Index

This project splits **process/rules** at the repo root and **system knowledge** under `/docs`.

## Repo Rules & Operations (root)

- **/AGENT_RULES.md** — Operating modes (PLAN / READ / ACT), output limits, budgets.
- **/CONTRIBUTING.md** — How to change code & docs together (tiny, incremental patches).
- **/ENTRYPOINTS.md** — Key surfaces to modify (API routes, tools, handlers).
- **/RUNBOOK.md** — Operate, debug, common incidents, how to ask for help.
- **/TESTING.md** — How to run tests, acceptance checks, what “done” means.
- _Optional_: **/AGENT_QUICKSTART.md** — Copy/paste prompts for agents.
- _Optional_: **/CLINE_PLAYBOOK.md** — Cline-specific PLAN/READ/ACT prompts.
- **/.agentignore** — paths the agent must not scan (build, deps, secrets)

## System Knowledge (/docs)

- **/docs/COMPANION_PLATFORM_RUNTIME.md** — Canonical production handoff across
  Vercel, Companion Runtime, Synapse-Cortex, Honcho, prompt compilation,
  persistence, validation and roadmap. Read this first.
- **/docs/DOCUMENTATION_STATUS.md** — Which documents are current authority,
  behavioral evidence, or legacy subsystem history.
- **/docs/ARCHITECTURE.md** — High-level map: Next.js, chat route, artifacts, flows.
- **/docs/MEMORY_SYSTEM.md** — Advanced memory system: structured extraction, pattern matching, recency weighting.
- **/docs/HONCHO_WRITE_ONLY_INTEGRATION.md** — Targeted Honcho memory, identity mapping, observability, and local validation.
- **/docs/MODEL_MAP.md** — Model wiring (chat, reasoning, artifact) + where used.
- **/docs/FLOWS.md** — User journeys: chat → tools → handlers → DB.
- **/docs/FEATURES.md** — Current features + short roadmap.
- **/docs/ACTOR_ATTRIBUTION_PLAN.md** — Surgical plan for actor role attribution and domain guard.
- **/docs/ACTOR_ATTRIBUTION_WALKTHROUGH.md** — Walkthrough of the completed Actor Attribution & Domain Guard implementation.
- **/docs/RELATIONAL_SYSTEM_AUDIT.md** — In-depth audit of memory, active state, and intimacy escalation scoring.

## Conventions

- Root files = _how_ we work (rules, process, ops).
- `/docs/*`   = _what_ the system is and _how_ it behaves.
- Any code change that alters behavior **must** come with a doc change (see `/CONTRIBUTING.md`).
