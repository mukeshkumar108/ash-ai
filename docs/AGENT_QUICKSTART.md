# Agent Quickstart

The agent must follow `/AGENT_RULES.md` and `/.agentignore`. Start in **PLAN MODE**. Only switch modes after approval.


---
## NEW SESSION

## PLAN MODE. 

Confirm you will obey /AGENT_RULES.md and /.agentignore.

Goal: Build context from docs only (no repo-wide reads).
Propose:
1) Plan (≤5 bullets)
2) Requested Reads (in this exact order, path:lineStart-lineEnd) + one-line reason each
3) Rough token budget (≤ 4k) + current meter

Approved doc read order:
- docs/INDEX.md:1-200 (table of contents)
- docs/ARCHITECTURE.md:1-400 (system map)
- docs/FLOWS.md:1-400 (chat→tools→handlers)
- docs/MODEL_MAP.md:1-200 (model wiring)
- docs/FEATURES.md:1-300 (user-facing)
- docs/ENTRYPOINTS.md:1-300 (endpoints/tools)

Do not open any source files yet. Stop and wait.

---
## NEW SESSION
## READ MODE (docs-only).
For each approved doc:
- 2–3 bullet summary
- Evidence: ≤2 lines per file (no boilerplate)

Stop after summaries. Do NOT propose code.

---

## PLAN MODE (default) — copy/paste

I confirm you must obey /AGENT_RULES.md and /.agentignore.

Goal: [ADD YOUR TASK — e.g., “Add a login page and route protected chat behind auth.”]

First, read ONLY:
- docs/ARCHITECTURE.md
- docs/FLOWS.md
- docs/MODEL_MAP.md
- docs/FEATURES.md
- docs/ENTRYPOINTS.md

Then respond with:
1) Plan (≤5 bullets)
2) Requested Reads (path:lineStart-lineEnd) + one-line reason each — keep it tight
3) Budget (≤8k) + current meter

Do NOT output code, diffs, or file content. Stop and wait.

Example: 

Confirm you’ve read `/AGENT_RULES.md` and `/.agentignore`.  
Propose a tiny plan and the *exact reads you need*, with line ranges and a budget. **Do not read files yet.**

**Prompt:**
I confirm you must obey `/AGENT_RULES.md` and `/.agentignore`.

PLAN MODE:
- Return ONLY:
  1) Plan (≤5 bullets)
  2) Requested Reads (path:lineStart-lineEnd) + one-line reason each
  3) Rough token budget (≤ 8k) and current meter
- Do NOT output code, diffs, or file content.

Scope for this pass:
- `lib/ai/providers.ts:1-80`
- `lib/ai/tools/create-document.ts:1-120`
- `lib/artifacts/server.ts:1-120`
- `artifacts/text/server.ts:1-140`

Budget: ≤ 8k tokens. Stop and wait.

---

## READ MODE (after approval) — copy/paste

READ MODE. Read only what I approved. For each file:
- 2–3 bullet summary
- Evidence: ≤3 lines total per file (no imports/boilerplate)
Overall evidence cap: ≤12 lines. Then stop.

Example 

Now read only what I approved. Summaries only, with tiny evidence.

**Prompt:**
READ MODE. Read only the approved ranges. Output for each file:
- 2–3 bullet summary
- Evidence: ≤ 3 lines total per file (no imports/boilerplate)

Overall evidence cap: ≤ 12 lines across all files. Then stop and wait.

---

## ACT MODE (explicit only) — copy/paste

Rules:
- Output **unified diffs only** with ±3 lines context.
- No full files. No screenshots. No prose outside the diffs + short rationale.
- Each diff: 2–4 bullet rationale + rollback note
- If any diff >150 lines, STOP and ask before proceeding.
- After patching, STOP. Do not output full files.

Doc-sync requirement (MANDATORY):
- For every code change, also patch the smallest necessary updates in /docs:
  - ARCHITECTURE.md (if components/layers changed)
  - FLOWS.md (if flows/tools/handlers changed)
  - MODEL_MAP.md (if models/wiring changed)
  - FEATURES.md (if user-facing behavior changed)
  - ENTRYPOINTS.md (if new endpoints/tools/commands added)
- Keep doc patches **incremental** (tiny hunks). Do NOT rewrite whole files.

For each diff, include:
- 2–4 bullet Rationale
- Rollback note (how to undo)

Target task: <describe the code change you want here>


Example 

Only produce unified diffs. No full files.

**Prompt:**
ACT MODE.
- Output **unified diffs only** with ±3 lines context
- Each diff: 2–4 bullet rationale + rollback note
- If any diff >150 lines, stop and ask before proceeding
- After patching, stop. Do not output full files.

Target changes:
1) Create `/docs/ARCHITECTURE.md` with the high-level map (as discussed).
2) Create `/docs/MODEL_MAP.md` documenting model IDs and where used.
3) Create `/docs/FLOWS.md` outlining chat → tools → handlers.
4) Create `/docs/FEATURES.md` listing user-facing capabilities.

