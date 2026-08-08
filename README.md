# agentwiki

Agent-first document store: a plain-file vault with an embedded search index,
plus versioned immutable artifacts — gist/obsidian-flavored, built for agents
driven by humans (often by voice).

## Install

```sh
bash scripts/install.sh
```

## Use

Landing with the build. `agentwiki --agent-help` is the agent runbook;
`agentwiki guide --json` is the machine-readable card.

## Develop

```sh
bun install
bun run check   # lint + typecheck + test
```
