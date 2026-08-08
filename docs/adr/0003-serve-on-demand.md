# 0003 — Serving is on demand; there is no daemon

`agentwiki serve` runs in the foreground for as long as a human is reading,
binds loopback only, and serves static bytes plus rendered markdown — never
server-side execution, and never a background process installed behind the
user's back.

Every other command works with the server down, which is why `open` reports
`server_not_running` with a recovery instead of starting one itself: an agent
must not silently leave a listening socket behind.
