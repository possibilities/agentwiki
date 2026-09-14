---
name: wiki
description: >-
  Create, find, edit, and link durable authored documents in agentwiki, or
  publish requested citable artifacts. Use for write-ups, reports, designs,
  and decisions worth finding again; use brain for collected sources and chats
  for transcripts.
---

# Wiki — authored documents

Use the `agentwiki` MCP server directly. Select the tool from the harness's
catalog or tool search, inspect its input schema, and call it with JSON
arguments. The host may prefix tool names with the server name. `guide`
provides the installed command contract and recovery guidance.
Find and create documents in the human's durable library.

The vault's files are the source of truth. The index is derived and reconciles
before reads, so native file editing and MCP discovery work together. Use the
wiki for authored reports, designs, and decisions meant to be found again by
name. Collected source material belongs in `brain`, past conversations in
`chats`, and durable work state in `hud`. Session-specific continuation material
can stay in the workspace or a dated handoff; it need not become a wiki page.

## Find and edit

Use `search` for a topic, `get` for the body and metadata, and `path` for the
absolute source file. A ref can be a returned slug, title, or unambiguous
phrase. Resolve an ambiguous result using the supplied candidates; do not
invent a slug or silently choose a neighboring document.

Edit an existing document at the path returned by `path`, using the native
file tools. Read it back with `get` to confirm the intended content. There is
no separate reindex step. Search results arrive in relevance order; lower
negative BM25 scores are better, so do not reverse their order.

## Create a durable result

Choose the creation operation by what you have:

- `new` starts a titled document, optionally from a vault template. It refuses
  an existing slug, which is a cue to inspect the existing document.
- `add` imports a completed local file or accepts a body in its structured
  `content` field. This is a supported MCP input, not shell interpolation.
  It avoids a slug collision by creating a suffixed name.

For a short completed note, `add` can receive:

```json
{"title":"Browser session decision","content":"# Browser session decision\n\nUse explicit session identity for every page operation.\n","tags":"browser,decision"}
```

For a larger write-up already in a file, pass its absolute `file` path instead.
For a document you expect to revise interactively, create it and then edit the
returned vault path. Preserve existing metadata and content outside the edit.

Use wikilinks such as `[[slug]]`, `[[Exact Title]]`, or `[[target|label]]` when
connecting related documents. Link resolution is exact/normalized, not fuzzy;
inspect `links` or `backlinks` when checking a relationship. Put reasoning and
context in the document itself so another reader can understand it later.

## Publish when needed

`publish` stores a file or directory as a named, immutable artifact version
and creates a searchable stub document. Supply an absolute path and use the
returned version URL when a stable citation is wanted. Publishing identical
bytes returns the same version. Repeat intended tags on every version; tags
are not inherited automatically.

Read [artifacts and history](references/artifacts-and-history.md) for version
URLs, tombstones, service behavior, and automatic history. Publishing is useful
for a requested shareable render or artifact; ordinary document editing does
not require it.

## Verify without a second storage workflow

Inspect MCP `isError` and Agentwiki's `{schema_version, ok, error, data}`
envelope in `structuredContent`. If the host returns only content blocks,
parse the standalone JSON block and keep diagnostic prose separate. Read
`error.code` and `recovery` before retrying or claiming success.

Wiki commands automatically record changed vault files in history and perform
the vault's configured best-effort sync. Never manually commit or push the
vault. If a direct edit has no subsequent read, the `commit` MCP operation can
record it without a custom message. Git failures do not erase the source file.

Removal uses the tool's reasoned tombstone operation, preserving bytes and
links; it is not a filesystem deletion. Reclamation is a separate irreversible
operator operation. The default server is managed by AgentStart: diagnose or
repair it through the supported owner, rather than starting a competing
process from a generic recovery suggestion.
