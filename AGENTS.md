# agentwiki — repository guidance

Agent-first document store: a vault of plain text files (the source of truth),
a derived SQLite index, and content-addressed versioned artifacts served
statically on demand. Read `README.md` for usage, `CONTEXT.md` for the
glossary — use its canonical terms in code, comments, and commit messages.

## Commands

`package.json` has the scripts; `bun run check` is the gate for every commit.
The one that is not in there: `bash scripts/smoke.sh` runs every command that
returns end to end against a throwaway HOME and vault, and is the check to run
before finishing anything that touches the command surface. `serve` and `mcp`
are not among those — both hold the process until something outside it stops
them — so `test/mcp.test.ts` spawns the server and drives it with a real MCP
client instead.

## Map

`src/` is flat: one module per concern, and the pure ones carry the tests.
Three things a listing will not tell you:

- `src/index.ts` is the *domain* index — the derived SQLite index of the
  glossary, not a package entry point.
- `src/contract.ts` is the single authored description of the CLI — the fleet
  agent contract `guide --json` emits. `src/help.ts` renders it: `--help`,
  `agentwiki help <command>`, `--agent-help` and `--agent-teaser` are all
  renders, and `src/main.ts` reads each command's flag grammar back out of it.
  Adding or changing a command means editing the contract, and nothing else.
- `src/mcp-tools.ts` is the whole contract → MCP mapping and nothing else:
  which leaves become tools, their names, input schemas, constraint keywords,
  annotations, the server's instructions, and how a tool call becomes parsed
  flags. It implements agentstart's `config/agent-contract/MCP.md`, which is
  normative and which the sibling CLIs also implement, so it stays dull and
  carries no dispatch. `src/mcp-server.ts` registers what it generates and
  dispatches each call through `REGISTRY` in this process; `src/mcp.ts`
  connects the stdio transport. There is no second list of tools: a command
  added to the contract becomes one with no other edit.
- `src/envelope.ts`, `src/errors.ts`, `src/flags.ts`, `src/paths.ts` are the
  shared CLI core, copied byte-identical into agentboard.

## The skill

`skills/wiki/SKILL.md` is the canonical deep runbook for driving this CLI, and
the surface most agent sessions actually see: AgentStart's skills scan copies
it into the fixed private fleet resources with `npx skills add --copy` against this
checkout, discovering it by the nested `skills/<name>/SKILL.md` layout, so
every session lists its name and
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
artifacts are immutable, serving is on demand, tombstones never delete, refs
resolve in tiers, artifacts get their own origin, and the vault commits itself.

`src/git.ts` is the only module that shells out to git, and every call in it is
best-effort by construction: the vault is the source of truth and must stay
fully usable with no history at all, so nothing in there may throw into a
command. Commit messages are mechanical on purpose — status letter and literal
path, never a summary — so that nothing in this codebase is in the business of
inferring what a change meant.

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

- Skills under `skills/<name>/` ship into AgentStart's fixed private
  fleet resources (`~/code/agentstart/scripts/sync-skills`, run six-hourly
  by the scheduled updater). AgentLaunch loads them into every managed
  session: Claude Code exposes `/agent:<name>`, and Codex uses
  `$agent:<name>`. A SKILL.md edit is live within
  six hours, or on demand by running that script. Whether a new skill earns a TOOLS.md
  advertisement line is a deliberate decision —
  `agentwiki get tool-advertisement-policy`.
- Adding or removing a call to another fleet tool changes the fleet map:
  update `~/code/agentstart/skills/fleet/MAP.md` (served by the `fleet`
  skill, every edge with evidence) in the same change.
- General agent doctrine — collab, build, maintain, story, the resource
  skills — is `~/code/agentguidance`; tool-specific runbooks stay here.
