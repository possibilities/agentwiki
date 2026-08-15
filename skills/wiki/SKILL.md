---
name: wiki
description: Capture, find, link, and publish durable markdown with the agentwiki CLI — a plain-file vault that is the source of truth, full-text search, a wikilink graph, and immutable content-addressed artifacts. The vault is the operator's library — authored documents meant to be found again by name. Use when the user asks for a document ("write this up", "document this"); when finished research, exploration, or a ruled decision deserves a durable named home; when the user asks where something was written down ("where did we document X?", "find that write-up"); when publishing an immutable citable artifact; or when linking documents to each other. Working state, briefs, and successor-session context are ~/handoffs/ files, not wiki pages.
---

# Wiki — the durable document vault

`agentwiki` is an agent-first document store. A directory of plain markdown
files — `~/wiki` by default — is the *sole* source of truth; the SQLite index
beside it is derived, rebuildable, and reconciles itself before every read.
That single decision shapes everything below: you do not write documents
*through* this CLI, you ask it where a document lives and then edit the file
with your ordinary tools.

The vault is the operator's library, not the session's memory: a wiki
document is authored, durable, and meant to be found again *by name*. What
happened needs no writing — every session on this machine is already indexed
(the `chats` skill); the plan's state lives on the board; context written
for one particular successor session is a dated file in `~/handoffs/`,
deleted when consumed, never a page here. If nobody would ever ask for it by
name, it does not belong. The `document-placement-policy` page in this vault
is the contract.

Verified against agentwiki 0.1.0. The CLI is self-describing — when this
document and the installed binary disagree, the binary wins; see
[Discovery and drift](#discovery-and-drift).

## Non-negotiables

- **Never round-trip a document body through CLI arguments.** There is no
  `edit` command and that is deliberate. `agentwiki path <ref>` hands back an
  absolute path; edit the file there directly. The next command already
  sees the change.
- **Speak refs; don't invent slugs.** Every `<ref>` accepts a slug, an exact
  title, or a spoken phrase. A phrase matching two documents is an
  `ambiguous_ref` *error naming the candidates*, never a guess — re-ask with a
  slug or run `resolve`.
- **Nothing is deleted.** `rm --reason` stamps a tombstone into frontmatter and
  leaves the file where inbound links already point. `gc` is the only command
  that frees bytes, and only for already-tombstoned artifacts.
- **`--json` on every call.** Domain failures are `ok:false` envelopes on
  stdout with exit 1; usage faults print help to **stderr** with exit 2 and are
  never envelopes. Parse stdout, branch on `error.code`.
- **`serve` never returns, and you rarely need it.** A resident launch agent
  already serves the default vault. Run it by hand only for another vault or
  port, and then background it, bound it, or hand the command to the user —
  never call it inline and wait.
- **Never commit or push the vault yourself.** It is a git repository and it
  maintains itself: every command commits whatever it finds changed — including
  files *you* edited directly — and pushes when a remote exists. Running `git`
  against the vault by hand is not needed, and hand-written messages are not
  wanted. See [History](#history-is-automatic).

## Preflight

```bash
agentwiki guide --json     # the machine card: paths, ref tiers, kinds, commands
agentwiki doctor --json    # vault + index health, dangling links, orphans
agentwiki list --limit 10  # what is actually in here
```

`vault_not_found` means no vault exists yet. Reads never conjure one — an
empty vault and a missing vault are different answers — but any write creates
it, and any write also makes it a git repository if it is not one already. The
vault resolves as `--vault` > `AGENTWIKI_VAULT` > `~/wiki`.

One asymmetry worth knowing: the artifact store at
`~/.local/share/agentwiki/` is **per user, not per vault**. `--vault` does not
scope artifacts; only `XDG_DATA_HOME` does. `guide --json` reports both paths.

## The core loop

### Capture

```bash
agentwiki new "Bluetooth Q30 HFP trap" --tags evidence,audio --json
cat report.md | agentwiki add --title "Q30 probe run" --tags evidence --json
agentwiki add ./findings.md --json
```

| | `new` | `add` |
|---|---|---|
| Source | a title; body is `# Title` or a template | a file argument or stdin |
| Slug taken | fails with `document_exists` | slides to `<slug>-2`, never fails |
| Use when | starting a document you are about to write | capturing something that already exists |

`add` is the one that must not interrupt you mid-thought, so it refuses only
empty input (`empty_document`). Non-markdown text files keep their extension
and are indexed for search — but they cannot carry frontmatter, so `rm` on one
is `not_markdown`.

`new --template <name>` reads `<vault>/.agentwiki/templates/<name>.md` and
substitutes `{{title}}`, `{{slug}}`, `{{date}}`, `{{now}}`. Templates are plain
markdown files; create one and it exists.

### Retrieve

```bash
agentwiki search "bluetooth hfp" --json --limit 10   # FTS5, ranked, snippets
agentwiki search "probe" --tag evidence --json       # scoped to a tag
agentwiki list --tag decision --limit 20 --json      # newest updated first
agentwiki get bluetooth-q30-hfp-trap --json          # body + frontmatter
agentwiki get "the bluetooth trap" --meta-only --json
```

`get` reads the file from disk, not the indexed copy, so it hands back exactly
what is there right now. Search hits carry `slug`, `title`, `path`, `tags`,
`snippet` (matches bracketed), and `score` — bm25, so it is *negative and lower
is better*; hits already arrive best-first, so rank them by order, not by
sorting `score` descending.

Query terms are quoted for you, so apostrophes and hyphens search rather than
blow up FTS5. A trailing `*` survives as a prefix search. A query with no
searchable term at all is `empty_query`.

### Edit — the signature workflow

```bash
P=$(agentwiki path "the bluetooth trap")
# …edit the file at $P directly…
agentwiki get "the bluetooth trap" --json    # the change is already visible
```

Every read command reconciles the index by size and mtime first. There is no
sync step, no cache to bust, no `reindex` to remember. This is the whole point
of the design — use it.

### Link

Wikilinks are written into the body: `[[slug]]`, `[[Exact Title]]`, or
`[[target|alias]]`. They resolve exactly or normalized and **never fuzzily** —
a typo surfaces as dangling in `doctor` rather than silently pointing at a
neighbour. A second, softer edge appears on its own: a *mention*, another
document's title (≥4 characters) appearing verbatim in the body, word-bounded,
with code and existing wikilinks excluded.

```bash
agentwiki links use-hfp-fallback --json      # outgoing + dangling, with reasons
agentwiki backlinks the-duplex-device --json # incoming, kind wikilink|mention
agentwiki graph --json                       # {nodes, edges, dangling}, absolute paths
agentwiki tags                               # every tag with live counts
```

Linking buys discovery: a document nobody points at is an orphan in `doctor`,
and a board item that references a document (`agentboard link <ref> --wiki
<slug>`) is how work and writing stay attached.

### Publish

```bash
agentwiki publish ./dist --name q30-probe --kind bundle --tag audio --json
agentwiki artifacts list --json
agentwiki artifacts versions q30-probe
agentwiki artifacts show q30-probe --json
```

A version **is** the content hash: sha256 of the bytes for a file, of the
sorted `(file hash, relative path)` manifest for a directory. Republishing
identical bytes returns `status: "unchanged"` and the same version; changing
one byte mints a new one and moves the name's latest pointer. Kinds
(`page`, `bundle`, `media`, `render`, `evidence`) are manifest metadata only,
never engine behavior. Cap is 50 MB.

Publishing also writes a **stub document** at `<vault>/artifacts/<name>.md`,
which is what puts an artifact inside the searchable, linkable graph. Two
things about the stub, both verified:

- Its frontmatter `version:` moves with each publish; the version URL written
  into the *body* is prose from the first publish and does not move. Trust
  `artifacts show`, not the stub's body text.
- Republishing without repeating `--tag` publishes the new version with no
  tags. Tags are per-version manifest data, not sticky per name.

## History is automatic

The vault is a git repository and it maintains itself. Every command commits
whatever it finds changed on its way out, then pushes best-effort when a remote
exists. Because agents edit vault files directly, the command *after* your edit
is what records it — which is the same reconcile-on-read property that makes
`get` already see your change, applied to history.

```bash
P=$(agentwiki path "the bluetooth trap")
# …edit the file at $P directly…
agentwiki get "the bluetooth trap" --json   # reads the edit *and* commits it
```

Messages are mechanical — git's own status letter and the literal path — and
nothing infers what a change meant:

```console
A bluetooth-q30-hfp-trap.md      # one file: status and path
3 files changed                  # several: the body lists each one
```

Say something about a change and it belongs in the document, not the message.
When a commit genuinely needs prose, ask for it explicitly:

```bash
agentwiki commit --message "Record the duplex decision" --json
agentwiki commit --json          # no message: mechanical, like every other commit
```

`commit` exists for the one gap the automatic hook leaves: **`serve` never
returns, so it never commits.** It is also the answer for a document written
and then not read again before you finish.

Four things worth knowing:

- **The derived index is gitignored.** It is rebuilt by any read and must never
  enter history — a binary rewritten wholesale per commit, whose `-wal` and
  `-shm` are live process state.
- **Every git call is best-effort and silent.** No git binary, a read-only
  vault, or an unreachable remote is a no-op, never an error. The vault is the
  source of truth and works completely without history.
- **A push failure is not lost work.** The commits stay; the next push carries
  them. `agentwiki doctor` reports branch, remote, and how many are unpushed,
  and `guide --json` carries the same block.
- **No remote means nothing to push to.** Adding one is ordinary git
  (`git -C ~/wiki remote add origin <url>`) and is a decision about where your
  notes go — agentwiki will not invent it.

## Refs resolve in tiers

Five tiers, tried in order; the first that matches wins, and a fuzzy hit never
competes with an exact slug.

| Tier | `<ref>` | Matches |
|---|---|---|
| slug | `bluetooth-q30-hfp-trap` | exact slug |
| title | `Bluetooth Q30 HFP trap` | exact title |
| normalized | `the bluetooth q30 hfp trap` | case- and leading-article-insensitive |
| fuzzy | `q30-hfp` | unambiguous substring of slug or title |
| words | `the bluetooth trap` | the spoken words present **in order** |

Two matches inside one tier is `ambiguous_ref` naming the candidates. The
recovery is a slug, or:

```bash
agentwiki resolve "Q30 probe run" --json   # ranked candidates with match tier
```

`resolve` never errors on a phrase that matches nothing — it returns an empty
candidate list, because that is precisely the question being asked. Positional
arguments are joined with spaces before use, so `agentwiki get the bluetooth
trap` works unquoted, which is how a voice agent reaches this CLI.

Tombstoning changes resolution: once a duplicate is tombstoned, the phrase that
was ambiguous resolves cleanly.

## Tombstones

```bash
agentwiki rm q30-probe-run-2 --reason "duplicate capture" --json
agentwiki restore q30-probe-run-2 --json
```

`rm` writes `deleted:` and `deleted_reason:` into the file's frontmatter and
**does not move the file**. Inbound links keep resolving, every reader excludes
it mechanically, and `restore` unstamps it. `--reason` is required and its
absence is a usage fault (exit 2), not a domain error.

Artifacts tombstone in the manifest and keep their bytes. Tombstoning one
version among several leaves the stub alone; tombstoning the last live version
takes the stub with it, stamped with that last version. `agentwiki gc` is the
only command that removes content — it is never automatic, reports
`{reclaimed, orphans, bytes}`, and leaves the manifest row marked reclaimed.
After collection, `artifacts restore` is `content_reclaimed`: publish the bytes
again under the same name and, being content-addressed, they land on the very
same version hash.

## Serving

**The default vault is already being served.** `agentwiki.server` is a resident
user launch agent, installed by AgentStart with the rest of the fleet's
services, and it holds both loopback ports from login. You do not start it, and
you should not `serve` the default vault by hand — the ports are taken.

```bash
agentwiki open q30-probe --json    # opens the latest URL in a browser
agentwiki serve --vault ~/other --port 7900 --artifact-port 7901
                                   # by hand only for another vault or port
```

Static bytes and rendered markdown, no server-side execution. Every other
command works with the server down, and the service is the reason
`server_not_running` is now a rare answer rather than the usual one.

| URL | Behavior |
|---|---|
| `/a/<name>/v/<hash>/` | immutable — safe to cite durably, cache forever |
| `/a/<name>/` | tracks latest; moves as new versions land |
| `/d/<slug>` | renders a document as HTML (tombstoned → 404) |
| `/` | the document index |

Two origins, one process: documents on `--port` (7777), artifact bytes on
`--artifact-port` (7778). Artifacts get an origin of their own so their
scripts can use storage and load and fetch their own files, while reaching
neither the documents nor the network — `/a/…` on the document port is a
redirect there, so every path in this table is still the one to cite.

`open` looks the artifact up before probing the port, so a name with no live
version is `artifact_not_found` — `server_not_running` (with the exact `serve`
command as its recovery) only appears once the artifact exists. `open` will
never start a server for you; leaving a listening socket behind is the user's
decision, not yours.

## Output contract

```json
{"schema_version": 1, "ok": true, "error": null, "data": {…}}
{"schema_version": 1, "ok": false, "error": {"code": "…", "message": "…", "recovery": "…"}, "data": null}
```

| Exit | Stream | Shape | Move |
|---|---|---|---|
| 0 | stdout | `ok:true` envelope | parse `data` |
| 1 | stdout | `ok:false` envelope | branch on `error.code`, follow `recovery` |
| 2 | stderr | help text, **never JSON** | you got the grammar wrong; fix the flags |

`--jsonl` streams one record per line for `list`, `search`, `resolve`, and
`artifacts list` — use it when piping into a filter, `--json` when you need the
envelope. Error codes are stable snake_case, and `recovery` is written to be
run verbatim.

## Errors and recovery moves

| Code | Means | Move |
|---|---|---|
| `ambiguous_ref` | the phrase names several documents | `agentwiki resolve "<phrase>" --json`, then re-ask with a slug |
| `document_not_found` | no tier matched | `agentwiki search "<phrase>" --json` — it may not exist yet |
| `document_exists` | `new`'s slug is taken | read it with `get`, or capture alongside with `add` |
| `vault_not_found` | reading before anything was written | write something; reads never create a vault |
| `empty_query` / `bad_query` | nothing searchable, or FTS5 syntax | plain words; quotes and `NEAR/AND/OR` are FTS5 syntax |
| `template_not_found` | no such file in `.agentwiki/templates/` | create the markdown file, retry |
| `not_markdown` | tombstoning a non-markdown capture | move it out of the vault, or convert it |
| `empty_document` | `add` got nothing | check the pipe actually produced bytes |
| `artifact_not_found` | no live version of that name | `agentwiki artifacts list --json` |
| `content_reclaimed` | `gc` already collected it | publish the content again under the same name |
| `server_not_running` | `open` with nothing listening | run the `serve` command in `recovery`, or hand it to the human |
| `artifact_too_large` | over the 50 MB cap | publish a render, keep the original outside the store |
| `unsupported_schema_version` | a newer agentwiki wrote the store | upgrade; never downgrade the manifest |

## Recipes

**"Write this up."** Create, then edit the file — never compose the body on the
command line:

```bash
agentwiki new "Q30 HFP fallback decision" --tags decision --json
agentwiki path "Q30 HFP fallback decision"   # edit that file
```

**"Save this for later."** Capture something that already exists, without
caring whether the name collides:

```bash
cat /tmp/probe-output.md | agentwiki add --title "Q30 probe run" --tags evidence --json
```

**"Where did we document X?"** Search broadly, disambiguate, then read:

```bash
agentwiki search "hfp fallback" --json --limit 10
agentwiki resolve "the fallback decision" --json    # if the phrase is loose
agentwiki get <slug> --json
```

**Follow the thread.** Backlinks answer "what else touched this?" better than
search does, because someone deliberately wrote the edge:

```bash
agentwiki backlinks bluetooth-q30-hfp-trap --json
agentwiki links bluetooth-q30-hfp-trap --json
```

**Publish a citable artifact.** Cite the `/a/<name>/v/<hash>/` URL, never the
latest pointer, when the citation must stay true:

```bash
agentwiki publish ./report.html --name q30-report --kind page --tag audio --json
# → data.version_url is immutable; data.url tracks latest
```

**Wire a new document into the graph.** Write `[[Exact Title]]` into the body
while editing, then confirm the edge landed rather than assuming it did:

```bash
agentwiki links <ref> --json    # dangling[] names what did not resolve, and why
```

**Weekly hygiene.** `doctor` is cheap and honest:

```bash
agentwiki doctor --json   # dangling, ambiguous_links, duplicate_slugs, orphans,
                          # broken_artifact_stubs, healthy
```

## Health and drift

`doctor` reports the vault; `reindex` rebuilds the derived index from the
files. Reindex is never needed for correctness — every read reconciles first —
so reach for it only when the index is deleted, doubted, or refused by a schema
check. Deleting `<vault>/.agentwiki/index.sqlite3` loses nothing.

The one inconsistency the vault cannot repair alone is a stub document naming
an artifact the manifest no longer serves: the vault says it exists, only the
manifest knows it does not. That is `broken_artifact_stubs` in `doctor`.

```bash
agentwiki guide --json      # the stable machine card — the five-second re-sync
agentwiki --agent-help      # the in-binary runbook this skill deepens
agentwiki help <command>    # per-command flags
```

After an agentwiki upgrade, re-verify this skill's claims against the live CLI
before trusting its prose.

## Anti-patterns

| Don't | Do |
|---|---|
| Pass a document body as a CLI argument | `agentwiki path <ref>`, then edit the file |
| Guess a slug from a title you half-remember | `resolve` the phrase, or `search` for it |
| Retry a different phrase after `ambiguous_ref` | use one of the slugs the error named |
| `rm` a file out of the vault with `rm(1)` | `agentwiki rm <ref> --reason "…"` — links stay stable |
| Run `gc` to tidy up | it is the only irreversible command; run it deliberately |
| Publish a mutable copy and cite `/a/<name>/` | cite `/a/<name>/v/<hash>/` |
| Republish and assume the tags carried over | repeat `--tag` on every publish |
| Call `serve` and wait for it to return | it never returns; background it or hand it over |
| `serve` the default vault to "start" it | a launch agent already holds both ports |
| `reindex` reflexively after editing a file | reads reconcile; just read |
| `git -C ~/wiki commit` after writing a document | nothing; the next command commits it |
| Report that the vault "isn't a git repo" | any write makes it one; `doctor` says what is true |
| Write a thoughtful commit message for the vault | put the prose in the document; messages are mechanical |
| Scrape human output with grep/awk | `--json`, or `--jsonl` into a filter |

## Sibling skills

Three CLIs share this house style; route by what the thing *is*, not by which
one you used last.

- **`board`** (agentboard) — work items: things to do, their state and order.
  Items reference documents outward with `agentboard link <ref> --wiki <slug>`,
  and `agentboard render --publish` hands its HTML snapshot to
  `agentwiki publish`, so board snapshots land in this vault as artifacts.
- **`brain`** (agentbrain) — the *ingested* research cache: pages, PDFs, and
  sources someone else wrote, chunked for retrieval. Ingested source material
  belongs there; something you or the user authored belongs here.
- **`chats`** (cass) — past coding-agent sessions. Transcripts, not documents:
  search there for what was *said*, here for what was *written down*.

A fourth neighbour is a convention, not a CLI: `~/handoffs/` holds dated
standalone transfer files — briefs and continuation context for one named
successor session, deleted by their consumer. The routing between all of
these stores is the `document-placement-policy` page in this vault.

If a thing is authored, durable, and meant to be found again by name, it is
a wiki document; if only one particular future session will read it, it is a
handoff.

## For the human

When the user wants to read rather than delegate, `agentwiki serve` gives them
a browsable local site — the document index at `/`, rendered markdown at
`/d/<slug>`, and every artifact at its own URL — and `agentwiki open <name>`
launches one in their browser. Suggest it after publishing something a person
is going to want to look at, and tell them it is loopback-only, binds two
ports, and stops with ctrl-c.
