# 0002 — Artifacts are immutable and content addressed

An artifact version *is* its content hash — sha256 of the bytes for a single
file, sha256 of the sorted `(file hash, relative path)` manifest for a
directory — so the same tree published twice is the same version, and a cited
`/a/<name>/v/<hash>/` URL can never change under the citation.

Only a name's latest pointer moves. The manifest at
`~/.local/share/agentwiki/manifest.sqlite3` is authoritative and, unlike the
index, cannot be rebuilt from the vault, so a newer schema is refused rather
than migrated down.
