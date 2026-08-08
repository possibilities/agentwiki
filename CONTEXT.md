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
