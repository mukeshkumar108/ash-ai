# Production architecture

Read [`COMPANION_PLATFORM_RUNTIME.md`](./COMPANION_PLATFORM_RUNTIME.md) first.
It is the canonical current cross-repository map.

At a glance:

- this Next.js/Vercel repository owns ingress, authentication, canonical
  messages, chronology, user operational state, voice transport, runtime
  streaming/persistence and Cortex delivery;
- `companion-runtime` owns conversational policy, prompt compilation, model
  routing and foreground generation;
- `synapse-cortex` owns lifecycle continuity and deterministic attention packets;
- Honcho owns semantic evidence and retrieval.

The production chat entry is `app/(chat)/api/chat/route.ts`. The preserved
TypeScript prompt path is a rollback path, not the normal production speaker
while Companion Runtime reply-only is enabled.
