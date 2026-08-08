# agentwiki — repository guidance

Agent-first document store: a vault of plain text files (the source of truth),
a derived SQLite index, and content-addressed versioned artifacts served
statically on demand. Read `README.md` for usage, `CONTEXT.md` for the
glossary — use its canonical terms in code, comments, and commit messages.

## Commands

- `bun test` — unit tests (pure logic only; no network, no fixed home paths)
- `bun run typecheck` — `tsc --noEmit`, strict with `noUncheckedIndexedAccess`
- `bun run lint` / `bun run format` — Biome check / autofix
- `bun run check` — lint + typecheck + test, the gate for every commit

## Load-bearing decisions

- **Files are the source of truth; the index is derived.** Deleting the index
  must never lose data; `reindex` rebuilds it. Agents may edit vault files
  directly (editing is deliberately not wrapped), so every invocation
  reconciles the index incrementally before reading it.
- **Artifacts are immutable.** A version is its content hash; a name's latest
  pointer moves, versions never change. No server-side execution — the server
  serves static bytes only.
- **Tombstones, never deletes.** `rm` marks; `restore` unmarks; only `gc`
  reclaims, explicitly.
- **No daemon.** `serve` runs on demand; every other command works without it.

## Conventions

- Output: `--json` emits the stable `{schema_version, ok, error, data}`
  envelope; domain failures are `ok:false` envelopes on stdout with exit 1;
  usage faults print help to stderr with exit 2 and are never envelopes.
- Errors carry a stable snake_case `code` and, where actionable, a `recovery`.
- Comments state constraints the code can't show; no narration.
- `Record<string, unknown>` access uses bracket keys (Biome `useLiteralKeys`
  is off).
- Shared modules (`envelope.ts`, `errors.ts`, `flags.ts`, `paths.ts`) are
  copied byte-identical in the agentboard repo; changing them here means
  porting the change there in the same working session.
