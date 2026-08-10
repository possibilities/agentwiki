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

## The skill

`skills/wiki/SKILL.md` is the canonical deep runbook for driving this CLI, and
the surface most agent sessions actually see: Funk's skills scanner installs it
globally with `npx skills add` against this checkout, discovering it by the
nested `skills/<name>/SKILL.md` layout, so every session lists its name and
frontmatter description whether or not the binary is ever run. `--agent-help`
stays as the in-binary fallback and points at it.

The skill documents the CLI as installed, grounded in real command output.
Changing the command surface means re-verifying its claims against the live
CLI before editing its prose — reads against the real vault, writes against a
throwaway `AGENTWIKI_VAULT` (and `XDG_DATA_HOME`, which is what scopes the
artifact store) — and keeping the description's trigger phrasing true, since
that description is all a session has to route on.

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

## The fleet

This checkout is one of the agent* fleet under `~/code`. Shared machinery
lives in two siblings, and some changes here must cascade:

- Skills under `skills/<name>/` ship globally through Agentdots' scan
  (`~/code/agentdots/scripts/sync-skills`, run six-hourly by Funk's
  updater): a SKILL.md edit is live within six hours, or on demand by
  running that script. Whether a new skill earns a TOOLS.md advertisement
  line is a deliberate decision — `agentwiki get tool-advertisement-policy`.
- Adding or removing a call to another fleet tool changes the fleet map:
  update `~/code/agentdots/skills/fleet/MAP.md` (served by the `fleet`
  skill, every edge with evidence) in the same change.
- General agent doctrine — collab, build, story, the resource skills — is
  `~/code/agentguidance`; tool-specific runbooks stay here.
