# Cline Playbook

This repo uses a strict 3-mode protocol. The **rules** live in `/AGENT_RULES.md`. This playbook explains the workflow.

## Modes
- **PLAN MODE (default):** Propose reads with line ranges and a budget. No code/diffs/snippets. Wait for approval.
- **READ MODE (approved):** Read only approved ranges. Return concise summaries with tiny evidence (caps below).
- **ACT MODE (explicit):** Output unified diffs only. No full files. Respect size caps.

## Evidence Caps (READ MODE)
- Per file: ≤ 3 lines of evidence
- Total across task: ≤ 12 lines
- Never include imports, type boilerplate, or generated schemas

## Diff Caps (ACT MODE)
- Use `diff --unified`, ±3 lines context
- If any single diff >150 lines, STOP and ask to proceed
- Include a short rationale and rollback note per diff

## Budgets
- Default pass: ≤ 8k tokens
- If the plan estimates > 8k, split into multiple passes
- Always show current meter and remaining budget

## Scope Requests
- Always list file ranges (e.g., `path/to/file.ts:1-80`)
- If you need to expand, ask and justify
- Honor `/.agentignore` strictly

## Deliverables by Phase
- **Discover (PLAN):** Plan, requested reads, budget, meter
- **Inventory (READ):** Summaries + minimal evidence (caps)
- **Patch (ACT):** Diffs only, rationale, rollback notes
- **Stop after patching** unless told otherwise

## Typical Tasks
- Add or update docs in `/docs/`
- Small refactors (types import, config toggles)
- Light guardrails (env example, debug flags)

## Anti-Patterns (Never do)
- Dump full files in chat
- Run commands or builds
- Leak secrets/envs
- Expand scope without permission
