# agentwiki — repository guidance

Agent-first document store: a vault of plain text files (the source of truth),
a derived SQLite index, and content-addressed versioned artifacts served
statically on demand. Read `README.md` for usage, `CONTEXT.md` for the
glossary — use its canonical terms in code, comments, and commit messages.

## Commands

- `bun test` — unit tests (temp dirs only; no network, no fixed home paths)
- `bun run typecheck` — `tsc --noEmit`, strict with `noUncheckedIndexedAccess`
- `bun run lint` / `bun run format` — Biome check / autofix
- `bun run check` — lint + typecheck + test, the gate for every commit
- `bash scripts/smoke.sh` — every command end to end against a throwaway
  HOME and vault; run it before finishing anything that touches the surface

## Map

`src/` is flat: one module per concern, and the pure ones carry the tests.

- `src/main.ts` — CLI entry: the command registry, flag grammar per command,
  envelope rendering, and the exit-code contract
- `src/help.ts` / `src/guide.ts` — the human help, the agent runbook, and the
  machine-readable card; adding a command means touching both
- `src/context.ts` — the injected `Context` (env, home, cwd, vault, clock,
  stdin) and `CommandResult`; handlers are pure of `process`
- `src/documents.ts` / `src/publish.ts` — command handlers, document side and
  artifact side
- `src/vault.ts` — vault location, the file walk, and file → document parsing
- `src/index.ts` — the derived SQLite index (the glossary's *index*, not a
  package entry point): schema, incremental reconcile, FTS5 search
- `src/artifacts.ts` — content addressing, the CAS, and the artifact manifest
- `src/serve.ts` / `src/render.ts` — the on-demand HTTP view
- `src/frontmatter.ts`, `src/slug.ts`, `src/links.ts`, `src/resolve.ts`,
  `src/graph.ts`, `src/urls.ts` — pure logic, all directly tested
- `src/envelope.ts`, `src/errors.ts`, `src/flags.ts`, `src/paths.ts` — the
  shared CLI core, copied byte-identical into agentboard

## Load-bearing decisions

Each has an ADR under `docs/adr/`.

- **Files are the source of truth; the index is derived.** Deleting the index
  must never lose data; `reindex` rebuilds it. Agents may edit vault files
  directly (editing is deliberately not wrapped), so every invocation
  reconciles the index incrementally before reading it.
- **Artifacts are immutable.** A version is its content hash; a name's latest
  pointer moves, versions never change. No server-side execution — the server
  serves static bytes only. The manifest is authoritative and cannot be
  rebuilt from the vault; the index can.
- **Tombstones, never deletes.** `rm` marks; `restore` unmarks; only `gc`
  reclaims, explicitly.
- **No daemon.** `serve` runs on demand; every other command works without it.
- **Refs resolve in tiers, and ambiguity is an error.** Exact slug, exact
  title, case- and article-insensitive, unambiguous fuzzy contains, then the
  spoken words present in order — the first tier that matches wins, and two
  matches inside a tier is `ambiguous_ref` naming the candidates. The last
  tier is what makes "the bluetooth trap" find `bluetooth-q30-hfp-trap`;
  it requires the words in order so a rearrangement never resolves. Wikilinks
  stop after the normalized tier: a typed link that nearly matches must
  surface as dangling, not guess.

## Conventions

- Output: `--json` emits the stable `{schema_version, ok, error, data}`
  envelope; domain failures are `ok:false` envelopes on stdout with exit 1
  (in human mode, the message goes to stderr with the same exit 1); usage
  faults print help to stderr with exit 2 and are never envelopes.
- Errors carry a stable snake_case `code` and, where actionable, a `recovery`
  spelled as a command the agent can run.
- Positional arguments are joined with spaces before use, so a voice agent can
  pass `get the bluetooth trap` without shell quoting.
- Comments state constraints the code can't show; no narration.
- `Record<string, unknown>` access uses bracket keys (Biome `useLiteralKeys`
  is off).
- Shared modules (`envelope.ts`, `errors.ts`, `flags.ts`, `paths.ts`) are
  copied byte-identical in the agentboard repo; changing them here means
  porting the change there in the same working session.
