# 0004 — Tombstones, never deletes

`rm` stamps `deleted:` and `deleted_reason:` into a document's frontmatter and
leaves the file exactly where it was, so inbound links keep resolving and
`restore` is always possible; every reader excludes tombstoned documents
mechanically, in one place, so no query can forget to.

Artifacts tombstone in the manifest and keep their bytes. `gc` is the only
command that removes content, it is never automatic, and the manifest row
survives collection marked `reclaimed`.
