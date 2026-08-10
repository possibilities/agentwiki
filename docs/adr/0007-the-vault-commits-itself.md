# 0007 — The vault commits itself, mechanically

Agents edit vault files directly with their ordinary tools, which is the whole
point of [files being the source of truth](0001-files-are-the-source-of-truth.md).
The consequence is that agentwiki never sees most writes: there is no write
path to hang a commit on. So the end of every command is the hook — whatever
the vault looks like when a command finishes is what gets committed, whether
this process wrote it or an agent did behind our back.

`ensureGit` therefore runs on every write and is idempotent, rather than
initializing only at creation. A vault made by hand, restored from a backup, or
predating this code must still gain a history; the previous behavior left those
vaults with no repository forever, and agents reported the absence rather than
working around it.

Commit messages are mechanical: git's own status letters and literal paths,
never a summary of what a change meant. Nothing infers intent from a diff.
Prose about a change belongs in the document it changed, and a human or agent
with something to say can say it through `agentwiki commit --message`.

The derived index is gitignored. It is rebuilt by any read, it is a binary
rewritten wholesale on every change, and SQLite's `-wal` and `-shm` are live
process state that must never be restored out of step with the database.

Every git call is best-effort and silent: no git binary, a read-only checkout,
or an unreachable remote must never turn a search into an error. Pushes are
detached so a read never waits on the network; a failed push leaves its commits
for the next one, and `doctor` reports the backlog. The vault is the source of
truth, and it remains completely usable with no history at all.

Two costs are accepted. `serve` never returns, so it never reaches the hook —
`agentwiki commit` is the explicit form for that gap. And a commit records
whatever state a file is in when a command runs, so a document caught mid-edit
is committed mid-edit. For a trail whose purpose is to show every state, that
is the granularity working, not a defect.
