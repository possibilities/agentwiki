# AgentWiki

[![CI](https://github.com/possibilities/agentwiki/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/possibilities/agentwiki/actions/workflows/ci.yml)

An agent-first document store where plain text files are the truth: full-text
search, a wikilink graph, and citable published artifacts on top of a vault you
can edit by hand. Gist- and obsidian-flavored, built for agents driven by
humans — often by voice.

Everything else is derived. Agents take a document's path and edit the file
with their ordinary tools; the index reconciles itself on every read, and
deleting it loses nothing. The vault is also a git repository that maintains
itself — every command commits what it finds changed, with mechanical messages,
and pushes best-effort when a remote exists. [docs/adr/](docs/adr/) records the decisions,
starting with [files are the source of truth](docs/adr/0001-files-are-the-source-of-truth.md);
`CONTEXT.md` is the domain glossary.

## Install

Requires Bun ≥ 1.3.14.

```bash
./scripts/install.sh
```

Links `$HOME/.local/bin/agentwiki` to this checkout and writes the deployed Git
SHA to `~/.local/state/agentwiki/deployed-sha`. Set
`AGENTWIKI_INSTALL_BIN_DIR` and `AGENTWIKI_INSTALL_STATE_DIR` to override the
install locations; `./scripts/install.sh --uninstall` removes both.

## Use

The vault defaults to `~/wiki` and is created on first write; `--vault <path>`
wins over `AGENTWIKI_VAULT`, which wins over that default.

```bash
agentwiki new "Bluetooth Q30 HFP trap" --tags evidence,audio
cat probe.md | agentwiki add --title "Q30 probe run" --tags evidence
agentwiki search "bluetooth hfp" --json
agentwiki path bluetooth-q30-hfp-trap        # then edit that file directly
agentwiki backlinks bluetooth-q30-hfp-trap
agentwiki publish ./dist --name q30-probe --kind bundle
agentwiki commit --message "Record the duplex decision"   # usually unnecessary
agentwiki serve                              # docs :7777, artifacts :7778
```

Every `<ref>` accepts a slug, an exact title, or an unambiguous spoken phrase,
so a voice agent can say what it means:

```console
$ agentwiki get "the bluetooth trap" --meta-only
# Bluetooth Q30 HFP trap
slug: bluetooth-q30-hfp-trap
path: ~/wiki/bluetooth-q30-hfp-trap.md
tags: audio, evidence
```

An ambiguous phrase is an error that names its candidates, and `resolve` ranks
the same phrase as data the agent can read back:

```console
$ agentwiki get "duplex" --json
{"schema_version":1,"ok":false,"error":{"code":"ambiguous_ref",
 "message":"\"duplex\" matches 2 documents: the-duplex-device, duplex-device-probe",
 "recovery":"Use one of those slugs, or run: agentwiki resolve \"duplex\" --json"},"data":null}

$ agentwiki resolve "duplex"
fuzzy       the-duplex-device            The Duplex Device
fuzzy       duplex-device-probe          Duplex device probe
```

Wikilinks and title mentions both become graph edges. Nothing is silently
deleted: `rm` stamps a tombstone into the frontmatter and leaves the file where
inbound links already point.

```console
$ agentwiki links q30-probe-run
wikilink  → bluetooth-q30-hfp-trap       Bluetooth Q30 HFP trap
mention   → the-duplex-device            The Duplex Device

$ agentwiki rm q30-probe-run --reason "superseded by the duplex device"
tombstoned q30-probe-run (superseded by the duplex device)
the file is untouched at ~/wiki/q30-probe-run.md; restore with: agentwiki restore q30-probe-run
```

Artifacts are versioned by content hash, so a published version can be cited
forever. `publish` also writes a stub document into the vault, which puts
artifacts inside the searchable, linkable graph:

```console
$ agentwiki publish ./dist --name q30-probe --kind bundle
published q30-probe@9d9e5b1f6ef6
bundle, 2 files, 129 B
latest   /a/q30-probe/
version  /a/q30-probe/v/9d9e5b1f6ef6aabad723b14d9b134354c72a8d48140b4fe58e90b2c9bf52b672/
stub     ~/wiki/artifacts/q30-probe.md
```

`serve` runs as a resident launch agent for the default vault, installed by
AgentStart; run it by hand for any other vault. Loopback only, static bytes and
rendered markdown, no server-side execution. Every other command works with
it down.

Artifacts answer on a second loopback port (`--artifact-port`, default 7778)
so they get an origin of their own: an artifact's scripts can load and fetch
its own files, and can reach neither the documents on `:7777` nor the network.
Cited `/a/…` paths are unaffected — the document port redirects them.

## For agents

```bash
agentwiki --agent-teaser    # one line
agentwiki --agent-help      # the runbook: read commands first, then writes
agentwiki guide --json      # the stable machine-readable card
```

The two habits worth building: take the `path` and edit the file rather than
round-tripping text through the CLI, and call `resolve` instead of guessing
when a phrase might mean more than one document.

## Storage

| What | Where | Authority |
| --- | --- | --- |
| Documents | `~/wiki/` (`--vault`, `AGENTWIKI_VAULT`) | the source of truth |
| Index | `<vault>/.agentwiki/index.sqlite3` | derived; `reindex` rebuilds it |
| Templates | `<vault>/.agentwiki/templates/` | optional, for `new --template` |
| Artifact bytes | `~/.local/share/agentwiki/cas/` | immutable, content addressed |
| Artifact manifest | `~/.local/share/agentwiki/manifest.sqlite3` | authoritative; not rebuildable |

## Develop

```bash
bun install
bun run check          # lint + typecheck + test
bash scripts/smoke.sh  # every command end to end, throwaway HOME and vault
```

Tests use temp directories only — no network, no fixed home paths. Set
`AGENTWIKI_DEBUG` to any value to print a stack trace alongside a failure.
