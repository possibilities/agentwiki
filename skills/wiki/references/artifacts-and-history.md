# Artifacts and history

## Versions and links

A file version is its content hash. A directory version hashes a sorted
manifest of file hashes and relative paths. Publishing changed bytes creates
a version and moves the name's latest pointer; identical bytes return
`status: "unchanged"`. Artifact kind is descriptive metadata, not execution
behavior. Use the live schema and contract for current size limits.

The artifact stub under the vault makes the artifact searchable and linkable.
Its frontmatter tracks the current version, but the body may retain the first
published URL. Read `artifacts_show` for the authoritative current version and
URLs; use `artifacts_versions` when selecting a past one.

A version URL such as `/a/<name>/v/<hash>/` is immutable; `/a/<name>/` tracks
latest. Documents render at `/d/<slug>`. These are local service URLs unless
an explicitly configured delivery path says otherwise. Do not imply that a
loopback link is public or reachable on another device.

Agentwiki serves documents and artifact bytes on separate origins. Artifact
scripts do not gain access to the document origin. The default service is
already owned by AgentStart; `publish` stores content and does not need a
second server. If serving is unavailable, preserve the artifact and its source,
report the limitation, and repair the managed service only within the task's
scope. An operator-only `serve` command in a recovery string is not an MCP tool.

## History

After a successful command, Agentwiki records changed vault files, including
edits made through native file tools. Messages are mechanical; put substantive
explanations in the document. `commit` covers a direct edit that would otherwise
have no following command. Do not add a manual git workflow around the vault.

Git operations are best-effort. The files remain usable without git or when a
configured remote is unavailable. A failed push leaves the local commit for a
later sync; it does not mean the document was lost. Do not change remotes or
credential configuration as incidental document cleanup.

The artifact store is per user, not per vault. Selecting another vault alone
does not isolate artifact data; an operator's isolated test must also use the
store's supported data-root override. A shared MCP connection has a configured
vault/store and cwd; use absolute file paths and do not infer another vault
from the caller's working directory.

## Tombstones

Document removal marks frontmatter with the deletion reason and leaves the
file at its stable location. Ordinary readers exclude the tombstone; `restore`
reverses it. This differs from deleting a file through the shell.

Artifact removal marks the manifest and retains bytes. Removing the final live
version also tombstones its stub. Garbage collection frees already-tombstoned
bytes and cannot be undone by `artifacts_restore`; `content_reclaimed` means
the original bytes must be published again. Never run collection just to make
an inventory look tidy.

## Common outcomes

An ambiguous ref supplies candidate documents. A missing document calls for
search or creation according to the task; an empty search is not permission to
replace a similarly named file. `document_exists` is expected from `new` when
the slug is taken. `add` avoids that collision, but use it only when another
document is actually wanted. A missing vault differs from an empty one; normal
writes initialize a vault, while reads do not create one.
