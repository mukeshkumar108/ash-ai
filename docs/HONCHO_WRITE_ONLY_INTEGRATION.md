# Honcho targeted-memory prototype

Honcho is an optional derived memory subsystem. PostgreSQL `Chat` and `Message_v2` rows remain canonical. Completed turns mirror asynchronously, while selected turns can receive a small just-in-time memory packet.

## Configuration

```bash
HONCHO_URL=http://localhost:8001
HONCHO_WORKSPACE_ID=llm-test-agent # optional default
HONCHO_TIMEOUT_MS=5000            # optional
HONCHO_API_KEY=                   # optional with local auth disabled
HONCHO_RETRIEVAL_MODE=targeted_conclusions # default; targeted_chat is experimental
HONCHO_RETRIEVAL_TIMEOUT_MS=12000 # optional
MEMORY_COMPILER_MODEL=deepseek/deepseek-v4-flash # optional
MEMORY_COMPILER_TIMEOUT_MS=10000  # optional
MEMORY_DECISION_THRESHOLD=0.65    # optional
```

Leaving `HONCHO_URL` unset disables both mirroring and retrieval. The response path fails open if compilation, retrieval, or Honcho itself fails.

## Read path

For each visible user turn, a small semantic compiler receives the turn plus bounded recent conversation and returns `needsMemory`, a resolved standalone memory question, a short reason, and confidence. It does not answer the user. A sufficiently confident memory request uses the thin `retrieveRelevantMemory` adapter.

The default strategy queries the user's Honcho conclusions and keeps a small, deduplicated relevant set. This proved faster and safer than `peer.chat` for straightforward recall because it excludes Sophie-authored transcript speculation. If a fresh session has not yet crossed Honcho's derivation threshold and conclusions are empty, it falls back to semantic search over messages authored by the user only. `targeted_chat` remains available behind `HONCHO_RETRIEVAL_MODE` for experiments. Global representation injection is deliberately not used.

The packet tells Sophie that memory is fallible and may be stale. Authority order is current explicit user speech, current conversation, authoritative app state, then targeted memory. The packet is only added to Sophie's normal direct-answer prompt; existing research routing is unchanged.

## Identity mapping

- Workspace: `HONCHO_WORKSPACE_ID` (default `llm-test-agent`)
- User peer: `user_<User.id>`
- Sophie peer: `sophie`
- Session: `chat_<Chat.id>`
- App message identity: `metadata.app_message_id`

Database UUIDs are stable, opaque identifiers. A user peer is reused across chats, while each chat has a separate session.

## Write path and failure behavior

The chat route first persists the visible user and assistant messages to `Message_v2`. It then registers a post-response Honcho task which ensures the workspace, peers, and session and appends the completed visible turn in user/assistant order. Recent Honcho messages are checked by `app_message_id` to avoid common retry duplication.

Honcho failures are logged with app chat/message IDs and do not fail or delay the Sophie response. There is intentionally no retry queue yet; the metadata and safe failure log preserve the identifiers a later retry mechanism needs.

## Local real-conversation workflow

1. Start Honcho and confirm `http://localhost:8001/health`.
2. Set `HONCHO_URL=http://localhost:8001` and run `pnpm dev`.
3. Chat naturally with Sophie for 10–20 turns.
4. Open `http://localhost:3000/dev/honcho` while signed in.
5. Select the chat and refresh to inspect health, mapping, raw messages, representation, conclusions, and queue status.
6. Wait for derivation and refresh again, then ask a natural cross-session recall question.
7. Start a second app chat. Its session ID changes, while the displayed user peer ID remains identical.

Both the page and its API return 404 in production. The API also verifies that the selected chat belongs to the signed-in user.

The inspector reads the user's global self-representation and other Honcho surfaces for comparison. It also shows recent in-process targeted-memory traces: exact user turn, compiler decision and resolved query, strategy, raw compact result, latency/failure/empty state, and the packet Sophie received. These traces are development-only, bounded to 100, and intentionally contain no hidden reasoning.

Sophie-authored messages remain attributed to the separate `sophie` peer. The default conclusions query therefore does not promote an old Sophie speculation into a user fact. In-process traces reset when the development server restarts and are not intended as production telemetry.
