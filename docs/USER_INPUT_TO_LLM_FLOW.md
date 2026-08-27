# User input to companion response

The current end-to-end flow is documented in
[`COMPANION_PLATFORM_RUNTIME.md`](./COMPANION_PLATFORM_RUNTIME.md).

The canonical entry remains `app/(chat)/api/chat/route.ts`, but normal Sophie
reply-only generation is delegated to Companion Runtime. Do not use historical
examples of direct `streamText(systemPrompt + MEMORY)` as the production prompt
path.

In summary:

`client message → app auth/sanitize/chronology/persist → Companion Runtime
context + authority + gear + prompt + provider → streamed result/provenance →
app assistant/session persistence → asynchronous Cortex outbox`.

Voice adds durable local recording/upload and transcription before the same
canonical text turn. Tools, artifacts, image and research lanes may follow
specialist paths and should be audited independently when changed.
