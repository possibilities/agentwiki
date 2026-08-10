# Glossary

**Vault** — the directory of plain text files that is the sole source of truth for documents.
Default `~/wiki`, overridable with `--vault` / `AGENTWIKI_VAULT`. _Avoid_: notebook, workspace.

**Document** — one text file in the vault. Markdown is first-class (frontmatter, wikilinks);
any text file is indexed for search. _Avoid_: note, page.

**Slug** — a document's filename-derived identifier; speakable, unique within the vault.
_Avoid_: id, uuid.

**Ref** — how a document is addressed from outside: slug, exact title, or an unambiguous fuzzy
phrase. Ambiguity is an error that names the candidates. _Avoid_: pointer, locator.

**Index** — the derived, rebuildable SQLite FTS database at `<vault>/.agentwiki/index.sqlite3`;
never authoritative, always safe to delete. _Avoid_: database of record.

**Artifact** — a named, versioned, immutable static bundle — a single self-contained file or a
directory with an `index.html` entry point — stored content-addressed with a manifest row.
_Avoid_: attachment, upload.

**Version** — an artifact's content hash; immutable once published. _Avoid_: revision.

**Kind** — artifact manifest metadata (`page | bundle | media | render | evidence`); never
engine behavior. _Avoid_: type.

**Stub document** — the vault document written on publish that places an artifact inside the
document graph (backlinks, tags, search). _Avoid_: catalog entry.

**Tombstone** — the removal marker; nothing is silently deleted, and restore is possible until
`gc` collects tombstoned content. _Avoid_: delete (as a verb for what `rm` does).

**Reconcile** — the incremental size/mtime pass every read command runs before querying the
index, so a file an agent edited by hand is already visible. _Avoid_: sync, refresh.

**Mention** — the soft edge kind: one document's title appearing verbatim in another's body,
word-bounded and outside code. _Avoid_: implicit link, backlink (which is a direction, not a kind).

**Dangling** — a wikilink target that resolves to nothing, or ambiguously to several documents.
_Avoid_: broken link.

**Latest pointer** — the mutable per-name reference to an artifact version, behind `/a/<name>/`.
The version it names is still immutable. _Avoid_: head, current.

**Envelope** — the `{schema_version, ok, error, data}` object `--json` emits. _Avoid_: response,
payload.

**Artifact origin** — the second loopback port `serve` binds (`--artifact-port`, default 7778),
which serves artifact bytes and nothing else. Its whole job is to be a different origin from the
documents, so the browser keeps an artifact's scripts away from the vault. _Avoid_: artifact
server, sandbox, static host.
