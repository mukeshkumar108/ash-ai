# Doc Sync Checklist
When code changes:
- Update /docs/ARCHITECTURE.md if components/layers changed
- Update /docs/FLOWS.md if flows/tools/handlers changed
- Update /docs/MODEL_MAP.md if models or provider wiring changed
- Update /docs/FEATURES.md if behavior users see changed
- Update /docs/ENTRYPOINTS.md if new endpoints/tools were added

## Doc Sync Checklist (tick these before you open a PR)
- [ ] If you changed model wiring or tool behavior → update `docs/MODEL_MAP.md` and `docs/FLOWS.md`.
- [ ] If you changed artifact handlers or prompts → update `docs/ARCHITECTURE.md` and relevant `artifacts/*/server.ts` notes.
- [ ] If you added/removed scripts or entrypoints → update `docs/ENTRYPOINTS.md`.
- [ ] If your change affects how we verify locally → update `docs/TESTING.md` and `docs/RUNBOOK.md`.
- [ ] Keep patches **tiny**: separate functional change from doc updates if either exceeds ~150 lines.

Guidelines:
- Keep patches tiny (unified diffs)
- No wholesale rewrites
- Prefer adding one or two lines to the relevant section

## Linting and Formatting
- Use `pnpm lint:check` for linting without auto-fixing.
- Use `pnpm lint` for linting with auto-fixing using Biome's `--write --unsafe` flag, which can modify files.
- The `tailwindcss/no-custom-classname` rule is disabled to allow custom class names, as the project uses a mix of Tailwind and custom CSS.
