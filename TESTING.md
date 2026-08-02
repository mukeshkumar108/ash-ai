Local Testing & Verification (No-Exec for Agents)

Humans verify changes locally. Typical steps:

## Quick checks
1. Install deps: `pnpm install`
2. Lint: `pnpm lint`
3. Types: `pnpm typecheck` (or `tsc --noEmit`)
4. Dev boot: `pnpm dev` and open the app

## Chat & Tools smoke
- Send a simple chat message and confirm a streamed response.
- Trigger `createDocument` (text) and verify an artifact appears and persists.
- Trigger `updateDocument` and confirm minimal changes stream into the artifact.

## Notes
- Agents never run commands. Paste **errors/warnings only** into the chat if something fails.
- If environment variables are missing, copy `.env.example` → `.env.local` and fill in secrets.

