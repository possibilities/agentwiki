# 0006 — Artifacts get their own origin

Artifact bytes are arbitrary published content served next to a vault of
private notes. They used to share the document origin and were held apart by
`Content-Security-Policy: sandbox allow-scripts`, which forced an opaque
origin: a page artifact could run its own JS but could not read `/d/<slug>`.

That isolation also took away things artifacts legitimately need. An opaque
origin makes `localStorage` and cookies throw, and turns an artifact's fetch
of its own sibling file into a cross-origin request with no CORS headers to
satisfy it — so a `bundle` could not read its own `data.json`. It left the
network open in the other direction: a sandboxed artifact could still send
requests anywhere.

`serve` now binds a second loopback port (`--artifact-port`, default 7778) and
serves artifact bytes only from there, with no sandbox and an explicit policy:
`default-src 'none'`, permissive script and style sources so a render still
runs its own JS, and `connect-src 'self'` so it can reach its own files and
nothing else — not the document origin, not another loopback port, not the
internet.

The isolation is now the origin, which is what an origin is for. `'self'`
means the artifact's own origin, the vault sits behind a real origin boundary,
and exfiltration has nowhere to go.

Every artifact URL ever written down is a path — stub documents, publish
envelopes, and citations all record `/a/<name>/v/<hash>/` — so the split moves
no recorded link. The document origin answers `/a/…` with a temporary redirect
to the artifact origin, which keeps the front door working; temporary, because
the artifact port is configurable and a cached permanent redirect would
outlive the setting.

The residual risk is accepted: artifacts share one origin with each other, so
storage and fetch are common between them. Separating them further would mean
an origin per artifact, which loopback ports cannot give at this scale, and
the material worth protecting is the vault — which is now on the other side of
a boundary the browser enforces.
