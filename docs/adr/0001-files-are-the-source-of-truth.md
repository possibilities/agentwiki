# 0001 — Files are the source of truth; the index is derived

The vault is plain text files and nothing else is authoritative: agents edit
them with their ordinary tools, and `agentwiki` deliberately does not wrap
editing. The SQLite index at `<vault>/.agentwiki/index.sqlite3` therefore holds
only what can be recomputed from those files, and every read command
reconciles it incrementally (by size and mtime) before querying it.

Deleting the index must lose nothing; `reindex` rebuilds it. The cost is a
directory walk per invocation, which is the price of letting agents write to
the vault behind our back.
