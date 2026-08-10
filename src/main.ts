#!/usr/bin/env bun
import { ArtifactStore, artifactHome } from "./artifacts.ts";
import type { CommandResult, Context, Handler } from "./context.ts";
import { assertVaultExists, nowIso, openIndex, readAllStdin } from "./context.ts";
import {
  addDocument,
  doctorCommand,
  documentBacklinks,
  documentLinks,
  documentPath,
  getDocument,
  graphCommand,
  listDocuments,
  listTags,
  newDocument,
  reindexCommand,
  removeDocument,
  resolveCommand,
  restoreDocument,
  searchDocuments,
} from "./documents.ts";
import { failure, success } from "./envelope.ts";
import { CliError, UsageError } from "./errors.ts";
import type { FlagSpec, ParsedFlags } from "./flags.ts";
import { parseFlags } from "./flags.ts";
import { commitVault, ensureGit, gitReport, pushVault, syncVault } from "./git.ts";
import { buildGuide } from "./guide.ts";
import { AGENT_HELP, AGENT_TEASER, HELP, TOP_HELP, VERSION } from "./help.ts";
import {
  artifactPortOf,
  artifactsCommand,
  gcCommand,
  openCommand,
  portOf,
  publishCommand,
} from "./publish.ts";
import { startServer } from "./serve.ts";
import { absolute, DEFAULT_HOST } from "./urls.ts";
import { resolveVaultRoot } from "./vault.ts";

const SCHEMA_VERSION = 1;

/** Global flags are legal on every command, so the per-command grammar only
 * has to name what is specific to it. */
const GLOBAL: FlagSpec = {
  value: new Set(["--vault"]),
  bool: new Set(["--json", "--jsonl", "--help"]),
};

interface CommandDefinition {
  value?: string[];
  bool?: string[];
  run: Handler;
}

const REGISTRY: Record<string, CommandDefinition> = {
  new: { value: ["--tags", "--template"], run: newDocument },
  add: { value: ["--title", "--tags"], run: addDocument },
  get: { bool: ["--meta-only"], run: getDocument },
  path: { run: documentPath },
  list: { value: ["--tag", "--limit"], run: listDocuments },
  search: { value: ["--tag", "--limit"], run: searchDocuments },
  tags: { run: listTags },
  resolve: { value: ["--limit"], run: resolveCommand },
  links: { run: documentLinks },
  backlinks: { run: documentBacklinks },
  graph: { run: graphCommand },
  doctor: { run: doctorCommand },
  reindex: { run: reindexCommand },
  rm: { value: ["--reason"], run: removeDocument },
  restore: { run: restoreDocument },
  publish: { value: ["--name", "--kind", "--title", "--tag", "--tags"], run: publishCommand },
  artifacts: { value: ["--reason", "--version"], run: artifactsCommand },
  open: { value: ["--port"], run: openCommand },
  gc: { run: gcCommand },
  serve: { value: ["--port", "--artifact-port"], run: serveCommand },
  commit: { value: ["--message"], run: commitCommand },
  guide: { run: guideCommand },
};

function specFor(definition: CommandDefinition): FlagSpec {
  return {
    value: new Set([...GLOBAL.value, ...(definition.value ?? [])]),
    bool: new Set([...GLOBAL.bool, ...(definition.bool ?? [])]),
  };
}

/** The explicit form of what every command already does on its way out, for the
 * one gap that leaves: a document written and then never read again. */
function commitCommand(context: Context, flags: ParsedFlags): CommandResult {
  if (flags.positional.length > 0) throw new UsageError("commit takes no positional arguments");
  assertVaultExists(context.vaultRoot);
  ensureGit(context.vaultRoot);
  const committed = commitVault(context.vaultRoot, flags.values["message"]);
  if (committed) pushVault(context.vaultRoot);
  const report = gitReport(context.vaultRoot);
  const data = { committed, ...report };
  const lines = [
    committed
      ? `committed  ${report.last_commit?.subject ?? "(unknown)"}`
      : "committed  nothing — the vault already matches its history",
    `remote     ${report.remote ?? "none — add one to push: git -C " + context.vaultRoot + " remote add origin <url>"}`,
    `unpushed   ${report.unpushed ?? "unknown (no upstream branch)"}`,
  ];
  return { data, human: lines.join("\n") };
}

function guideCommand(context: Context, flags: ParsedFlags): CommandResult {
  if (flags.positional.length > 0) throw new UsageError("guide takes no positional arguments");
  const guide = buildGuide(context.vaultRoot, artifactHome(context.env, context.home));
  return { data: guide, human: JSON.stringify(guide, null, 2) };
}

/** The one command that does not return: it holds the index and the manifest
 * open for as long as a human is reading. */
async function serveCommand(context: Context, flags: ParsedFlags): Promise<CommandResult> {
  if (flags.positional.length > 0) throw new UsageError("serve takes no positional arguments");
  const port = portOf(flags);
  const artifactPort = artifactPortOf(flags);
  // Two listeners, one process: the same port would simply fail to bind, and
  // the split is only worth anything if the origins genuinely differ.
  if (artifactPort === port) throw new UsageError("--artifact-port must differ from --port");
  const index = openIndex(context, { create: false });
  const store = ArtifactStore.open(context.env, context.home);
  const server = startServer({
    vaultRoot: context.vaultRoot,
    casRoot: store.casRoot,
    index,
    store,
    port,
    artifactPort,
    host: DEFAULT_HOST,
  });
  const shutdown = (): void => {
    server.stop();
    store.close();
    index.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const json = flags.bools.has("json") || flags.bools.has("jsonl");
  const data = {
    url: server.url,
    port: server.port,
    artifact_url: server.artifactUrl,
    artifact_port: server.artifactPort,
    vault: context.vaultRoot,
    documents: absolute(server.port, "/"),
  };
  if (json) console.log(JSON.stringify(success(SCHEMA_VERSION, data)));
  else
    console.log(
      `serving ${context.vaultRoot} at ${server.url}\n` +
        `artifacts at ${server.artifactUrl} (their own origin; /a/… on ${server.url} redirects there)\n` +
        "press ctrl-c to stop",
    );
  // Bun keeps the process alive for the listening socket; this await simply
  // never resolves, so nothing downstream tries to print a result.
  await new Promise<never>(() => {});
  throw new Error("unreachable");
}

function emit(result: CommandResult, mode: "human" | "json" | "jsonl"): void {
  if (mode === "jsonl" && result.records !== undefined) {
    for (const record of result.records) console.log(JSON.stringify(record));
    return;
  }
  if (mode !== "human") {
    console.log(JSON.stringify(success(SCHEMA_VERSION, result.data)));
    return;
  }
  if (result.human !== "") console.log(result.human);
}

function helpFor(name: string): string {
  return HELP[name] ?? TOP_HELP;
}

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command === undefined) {
    console.log(TOP_HELP);
    return 0;
  }
  if (command === "--help" || command === "-h") {
    console.log(TOP_HELP);
    return 0;
  }
  if (command === "--version" || command === "-V") {
    console.log(VERSION);
    return 0;
  }
  if (command === "--agent-help") {
    console.log(AGENT_HELP);
    return 0;
  }
  if (command === "--agent-teaser") {
    console.log(AGENT_TEASER);
    return 0;
  }
  if (command === "help") {
    const topic = argv[1];
    console.log(topic === undefined ? TOP_HELP : helpFor(topic));
    return 0;
  }
  const definition = REGISTRY[command];
  if (definition === undefined) {
    console.error(`unknown command "${command}"`);
    console.error(TOP_HELP);
    return 2;
  }
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(helpFor(command));
    return 0;
  }

  let flags: ParsedFlags;
  try {
    flags = parseFlags(rest, specFor(definition));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    console.error(helpFor(command));
    return 2;
  }

  const mode = flags.bools.has("jsonl") ? "jsonl" : flags.bools.has("json") ? "json" : "human";
  const home = process.env["HOME"] ?? "";
  const context: Context = {
    env: process.env,
    home,
    cwd: process.cwd(),
    vaultRoot: resolveVaultRoot(process.env, home, flags.values["vault"]),
    now: nowIso,
    readStdin: readAllStdin,
    stdinIsTerminal: Boolean(process.stdin.isTTY),
  };

  try {
    emit(await definition.run(context, flags), mode);
    // The vault records itself. Agents edit its files with their own tools, so
    // the end of a command is the only moment agentwiki can see what moved —
    // and emitting first keeps git off the path the caller waits on.
    syncVault(context.vaultRoot);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(helpFor(command));
      return 2;
    }
    const domain =
      error instanceof CliError
        ? error
        : new CliError("internal_error", (error as Error).message || String(error));
    if (mode === "human") {
      console.error(`error: ${domain.message}`);
      if (domain.recovery !== undefined) console.error(domain.recovery);
    } else {
      console.log(JSON.stringify(failure(SCHEMA_VERSION, domain)));
    }
    if (context.env["AGENTWIKI_DEBUG"] !== undefined && error instanceof Error) {
      console.error(error.stack ?? "");
    }
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
