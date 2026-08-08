# agentwiki — repository guidance

Agent-first document store: a vault of plain text files (the source of truth),
a derived SQLite index, and content-addressed versioned artifacts served
statically on demand. Read `README.md` for usage, `CONTEXT.md` for the
glossary — use its canonical terms in code, comments, and commit messages.

## Commands

`package.json` has the scripts; `bun run check` is the gate for every commit.
The one that is not in there: `bash scripts/smoke.sh` runs every command end
to end against a throwaway HOME and vault, and is the check to run before
finishing anything that touches the command surface.

## Map

`src/` is flat: one module per concern, and the pure ones carry the tests.
Three things a listing will not tell you:

- `src/index.ts` is the *domain* index — the derived SQLite index of the
  glossary, not a package entry point.
- `src/help.ts` and `src/guide.ts` are the human help and the machine card;
  adding or changing a command means touching both.
- `src/envelope.ts`, `src/errors.ts`, `src/flags.ts`, `src/paths.ts` are the
  shared CLI core, copied byte-identical into agentboard.

## Load-bearing decisions

`docs/adr/` records them, one file each: files are the source of truth,
artifacts are immutable, serving is on demand, tombstones never delete, and
refs resolve in tiers.

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
