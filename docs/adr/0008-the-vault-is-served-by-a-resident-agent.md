# 0008 — The vault is served by a resident launch agent

Supersedes [0003 — Serving is on demand; there is no daemon](0003-serve-on-demand.md).

`serve` is now supervised by a user launch agent, `agentwiki.serve`, installed
by AgentStart along with every other fleet service. It binds both loopback
origins at login and stays up.

What forced the reversal was evidence rather than preference. ADR 0003's
reasoning — that an agent must not silently leave a listening socket behind —
was right about the hazard and wrong about the remedy. Leaving the lifetime to
whoever typed the command produced ten orphaned `serve` processes on one
machine, each holding an artifact port, each pointed at a vault directory that
had already been deleted. Unsupervised foreground processes did not avoid a
resident listener; they produced ten of them, none of which any operator knew
about. One supervised socket whose owner, ports, and logs are declared is the
smaller exposure.

Everything ADR 0003 protected still holds. The service binds loopback only,
serves static bytes and rendered markdown, executes nothing server-side, and
keeps artifacts on their own origin so their scripts reach neither the
documents nor the network. Both ports are named in the template rather than
defaulted, so a resident service cannot move a port because a default changed.

Two consequences are accepted:

- `open` still reports `server_not_running` with a recovery, but on a machine
  with the service installed that error is nearly unreachable. It stays for the
  machine that has the CLI without the service — a fleet checkout installed on
  its own, or a `--vault` served by hand — because those cases are still real.
- `serve` never returns, so it never reaches the commit hook of
  [0007](0007-the-vault-commits-itself.md). A resident server therefore
  contributes nothing to history no matter how long it runs; `agentwiki commit`
  remains the answer for a change made while nothing else runs.

Running `serve` by hand is still supported and is still how a second vault or a
different port gets served. What changed is only that the default vault no
longer depends on somebody remembering to start, or to stop, anything.
