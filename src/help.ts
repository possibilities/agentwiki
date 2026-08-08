export const VERSION = "0.1.0";

export const COMMANDS = [
  { name: "new", summary: "Create a document from a title, optionally from a template" },
  { name: "add", summary: "Capture a file or stdin as a document" },
  { name: "get", summary: "Print a document's content and metadata" },
  { name: "path", summary: "Print a document's absolute file path" },
  { name: "list", summary: "List documents, most recently updated first" },
  { name: "search", summary: "Full-text search the vault" },
  { name: "tags", summary: "List tags with document counts" },
  { name: "resolve", summary: "Rank the documents a spoken phrase could mean" },
  { name: "links", summary: "Outgoing links and mentions for a document" },
  { name: "backlinks", summary: "Incoming links and mentions for a document" },
  { name: "graph", summary: "Export the whole document graph as nodes and edges" },
  { name: "doctor", summary: "Report dangling links, orphans, and index health" },
  { name: "reindex", summary: "Rebuild the derived index from the vault" },
  { name: "rm", summary: "Tombstone a document with a reason" },
  { name: "restore", summary: "Lift a document's tombstone" },
  { name: "publish", summary: "Publish a file or directory as an immutable artifact" },
  { name: "artifacts", summary: "List, inspect, tombstone, and restore artifacts" },
  { name: "open", summary: "Open an artifact's latest URL in the browser" },
  { name: "gc", summary: "Reclaim the bytes behind tombstoned artifacts" },
  { name: "serve", summary: "Serve documents and artifacts on demand" },
  { name: "guide", summary: "Print the stable machine-readable agent contract" },
  { name: "help", summary: "Show help for a command" },
] as const;

const COMMAND_LINES = COMMANDS.map(
  (command) => `  ${command.name.padEnd(10)} ${command.summary}`,
).join("\n");

export const TOP_HELP = `agentwiki — agent-first document store

Usage:
  agentwiki <command> [options]

Global options:
  --vault <path>     Vault directory (default: ~/wiki; env: AGENTWIKI_VAULT)
  --json             Emit the stable JSON envelope
  --jsonl            Emit newline-delimited records (list, search, resolve, artifacts list)
  --help, -h         Show this help
  --version, -V      Show the version
  --agent-help       Show the agent runbook
  --agent-teaser     Show a one-line capability summary

Commands:
${COMMAND_LINES}

Every <ref> accepts a slug, an exact title, or an unambiguous spoken phrase.
Ambiguity is an error that names the candidates; agentwiki resolve <phrase>
ranks them as data.

Run agentwiki --agent-help for the agent runbook, or agentwiki help <command>.
`;

export const AGENT_TEASER =
  "Capture, search, link, and publish: a plain-file document vault with full-text search, a wikilink graph, and immutable versioned artifacts served on demand.";

export const AGENT_HELP = `agentwiki — agent-first document store (agent runbook)

A vault of plain markdown files is the source of truth. The SQLite index is
derived and reconciles itself on every read, so you may edit vault files
directly with your normal tools — get the path, edit it, and the next command
already sees the change.

Reading (safe anytime)
  agentwiki search "bluetooth hfp" --json    Ranked FTS hits with snippets.
  agentwiki list --tag decision --json       Newest first; --limit to bound.
  agentwiki get bluetooth-q30-hfp-trap --json
                                             Body plus frontmatter; add
                                             --meta-only to skip the body.
  agentwiki path bluetooth-q30 --json        Absolute path — edit that file
                                             directly, do not round-trip text.
  agentwiki resolve "the bluetooth trap" --json
                                             Ranked candidates when a spoken
                                             phrase might mean several docs.
  agentwiki backlinks bluetooth-q30 --json   Who points here (wikilink|mention).
  agentwiki links <ref> · graph · tags · doctor

  A <ref> resolves in tiers: exact slug, exact title, case- and article-
  insensitive match, then unambiguous fuzzy contains. Two matches in a tier is
  an ambiguous_ref error naming the candidates — re-ask with a slug.

Writing (files change on disk)
  agentwiki new "Bluetooth Q30 HFP trap" --tags evidence,audio
                                             Fails with document_exists if the
                                             slug is taken.
  cat report.md | agentwiki add --title "Q30 probe run" --tags evidence
                                             Capture never fails on a name
                                             clash; the slug slides to -2.
  agentwiki rm <ref> --reason "superseded by the duplex device"
                                             Stamps deleted: in frontmatter.
                                             The file never moves, links stay
                                             stable, readers exclude it.
  agentwiki restore <ref>                    Unstamps it.

Artifacts (immutable, content-addressed)
  agentwiki publish ./dist --name q30-probe --kind bundle --tag audio
                                             Version = content hash. Same bytes
                                             republished = same version. Writes
                                             a stub document under artifacts/
                                             so the artifact is in the graph.
  agentwiki artifacts list|versions <name>|show <name>
  agentwiki artifacts rm <name> --reason "wrong build"
                                             Tombstone only; the stub document
                                             tombstones with the last version.
  agentwiki gc                               The only command that frees bytes.

Serving (no daemon)
  agentwiki serve --port 7777                Static bytes, localhost, no
                                             server-side execution. Immutable
                                             /a/<name>/v/<hash>/ URLs are safe
                                             to cite; /a/<name>/ tracks latest;
                                             /d/<slug> renders a document.
  agentwiki open <name>                      Errors with a recovery if serve
                                             is not already running.

Contract
  --json emits {schema_version, ok, error, data}; domain failures are ok:false
  envelopes on stdout with exit 1; usage faults print help to stderr with exit 2
  and are never envelopes. Error codes are snake_case and carry a recovery
  where one exists.

Full machine-readable card: agentwiki guide --json
`;

export const HELP: Record<string, string> = {
  new: `agentwiki new <title> — create a document

  --tags a,b          Tags to write into frontmatter
  --template <name>   A markdown file in <vault>/.agentwiki/templates/;
                      {{title}}, {{slug}}, {{date}} and {{now}} are substituted

The slug is derived from the title. An existing slug is a document_exists
error rather than a silent second file — use add to capture alongside it.`,

  add: `agentwiki add [file] — capture a file or stdin as a document

  --title <t>         Title; otherwise taken from frontmatter, the first
                      heading, or the file name
  --tags a,b          Tags merged with any already in the file's frontmatter

With no file argument, content is read from stdin. Non-markdown text files
keep their extension and are indexed for search only. A slug clash slides to
<slug>-2 rather than failing: capture must not interrupt.`,

  get: `agentwiki get <ref> — print a document

  --meta-only         Metadata without the body

Content comes from the vault file, not a cache. To change a document, take its
path and edit the file directly.`,

  path: "agentwiki path <ref> — print the absolute path of a document's file",

  list: `agentwiki list — list documents, most recently updated first

  --tag <t>           Only documents carrying this tag
  --limit <n>         Maximum rows (default 20)`,

  search: `agentwiki search <query> — full-text search

  --tag <t>           Restrict to a tag
  --limit <n>         Maximum hits (default 20)

Query terms are quoted for you, so apostrophes and hyphens search rather than
fail. A trailing * is kept as a prefix search.`,

  tags: "agentwiki tags — list tags with live document counts",

  resolve: `agentwiki resolve <phrase> — rank the documents a phrase could mean

  --limit <n>         Maximum candidates (default 20)

Never an error for a phrase that matches nothing: this is the call a voice
agent makes precisely to find out.`,

  links: "agentwiki links <ref> — outgoing wikilinks, mentions, and dangling targets",

  backlinks: "agentwiki backlinks <ref> — incoming wikilinks and mentions",

  graph: `agentwiki graph — export the document graph

Nodes are live documents; edges are wikilink or mention. Unresolved and
ambiguous link targets are reported separately as dangling.`,

  doctor: `agentwiki doctor — report vault and index health

Dangling wikilinks, ambiguous link targets, duplicate slugs, orphan documents,
and artifact stubs whose artifact the manifest no longer serves.`,

  reindex: `agentwiki reindex — rebuild the derived index from the vault

Never needed for correctness: every read reconciles incrementally first. This
is the escape hatch for a doubted or deleted index.`,

  rm: `agentwiki rm <ref> --reason <why> — tombstone a document

  --reason <why>      Required; recorded in frontmatter

Stamps deleted: and deleted_reason: into the file's frontmatter. The file never
moves, so inbound links stay stable and restore is always possible.`,

  restore:
    "agentwiki restore <ref> — lift a tombstone; the ref resolves among tombstoned documents",

  publish: `agentwiki publish <file-or-dir> --name <name> — publish an immutable artifact

  --name <name>       Required; the stable name whose latest pointer moves
  --kind <k>          page | bundle | media | render | evidence
                      (default: dir→bundle, .html→page, image→media)
  --title <t>         Human title for the manifest and the stub document
  --tag a,b           Tags for the manifest and the stub document

The version is the content hash: a single file hashes its bytes, a directory
hashes its sorted (file hash, relative path) manifest. Republishing identical
bytes yields the same version and changes nothing. Cap: 50 MB.`,

  artifacts: `agentwiki artifacts <list|versions|show|rm|restore> [name]

  list                Every name at its latest live version
  versions <name>     Every version, newest first
  show <name>         Full manifest detail for the latest version
  rm <name> --reason <why> [--version <hash>]   Tombstone; bytes survive,
                      and the stub document tombstones with the last live version
  restore <name> [--version <hash>]             Lift a tombstone`,

  open: `agentwiki open <name> — open an artifact's latest URL in the browser

  --port <n>          Where serve is listening (default 7777)

Errors with server_not_running, and a recovery, when nothing answers.`,

  gc: `agentwiki gc — reclaim the bytes behind tombstoned artifacts

The only command that deletes content, and only for versions already
tombstoned. Manifest rows survive, marked reclaimed.`,

  serve: `agentwiki serve — serve documents and artifacts on demand

  --port <n>          Listen port (default 7777)

Localhost only, static bytes only, no server-side execution, no daemon. Every
other command works without it.`,

  guide: "agentwiki guide — print the stable machine-readable agent contract (use --json)",

  help: "agentwiki help <command> — show help for a command",
};
