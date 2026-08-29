# Production conversational model map

Updated 2026-08-27. See
[`COMPANION_PLATFORM_RUNTIME.md`](./COMPANION_PLATFORM_RUNTIME.md) for routing
semantics and repository ownership.

| Role | Model | Owner |
|---|---|---|
| Dual Aperture | `google/gemini-3.7-flash`, low reasoning/excluded | Companion Runtime |
| Default foreground | `deepseek/deepseek-v4-flash` | Companion Runtime |
| Default fallback | `nex-agi/nex-n2-mini` | Companion Runtime |
| Mid capability | `openai/gpt-5.6-luna-pro` | Companion Runtime |
| Frontier capability | `anthropic/claude-sonnet-5` | Companion Runtime |
| Epistemic policy | `google/gemini-3.1-flash-lite` | Companion Runtime |
| LIVE SITUATION | `google/gemini-3.7-flash` | Companion Runtime |
| Elevated continuation | `google/gemini-3.7-flash` | Companion Runtime |

Authority (`HOLD/ENRICH/LEAD/ATTEND`) is separate from capability. Re-entry and
handshake do not independently replace the gear model; they affect prompt entry
style and can coexist with safety/specialist/capability overrides.

The app retains aliases and direct TypeScript generation for rollback, tools,
artifacts and specialist lanes. Those aliases are not the authoritative Sophie
reply-only foreground map while Companion Runtime is enabled. Resolve configured
environment values and inspect turn provenance before diagnosing a live turn.
