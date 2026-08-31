#!/usr/bin/env bun
import { ArtifactStore, artifactHome } from "./artifacts.ts";
import type { CommandResult, Context, Handler } from "./context.ts";
import { assertVaultExists, nowIso, openIndex, readAllStdin } from "./context.ts";
import type { Contract, ContractCommand } from "./contract.ts";
import { buildContract, findCommand, flagNames, VERSION } from "./contract.ts";
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
import { agentHelp, agentTeaser, commandHelp, topHelp } from "./help.ts";
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

/** The registry is the dispatch table and nothing more: every flag a command
 * accepts is authored once, in the contract, and read back out here. A
 * grammar maintained beside the contract is the second authorship this whole
 * change exists to delete. */
export const REGISTRY: Record<string, Handler> = {
  new: newDocument,
  add: addDocument,
  get: getDocument,
  path: documentPath,
  list: listDocuments,
  search: searchDocuments,
  tags: listTags,
  resolve: resolveCommand,
  links: documentLinks,
  backlinks: documentBacklinks,
  graph: graphCommand,
  doctor: doctorCommand,
  reindex: reindexCommand,
  rm: removeDocument,
  restore: restoreDocument,
  publish: publishCommand,
  artifacts: artifactsCommand,
  open: openCommand,
  gc: gcCommand,
  serve: serveCommand,
  mcp: mcpCommand,
  commit: commitCommand,
  guide: guideCommand,
};

function specFor(contract: Contract, command: ContractCommand): FlagSpec {
  const global = flagNames({
    name: "",
    summary: "",
    audience: "operator",
    arguments: contract.global_arguments,
  });
  const own = flagNames(command);
  return {
    value: new Set([...global.value, ...own.value]),
    bool: new Set([...global.bool, ...own.bool]),
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

/** The contract itself: one authored description of this CLI, of which every
 * help surface is a render. */
function guideCommand(context: Context, flags: ParsedFlags): CommandResult {
  if (flags.positional.length > 0) throw new UsageError("guide takes no positional arguments");
  const contract = buildContract({
    vaultRoot: context.vaultRoot,
    artifactHome: artifactHome(context.env, context.home),
  });
  return { data: contract, human: JSON.stringify(contract, null, 2) };
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

/** The second command that does not return: it holds stdio as an MCP transport
 * until the host closes it. Nothing may print while it runs — stdout is the
 * protocol channel — and nothing does, because a handler that never resolves
 * never reaches `emit`. The server dispatches every tool call back through the
 * registry above, in this process. */
async function mcpCommand(context: Context, flags: ParsedFlags): Promise<CommandResult> {
  if (flags.positional.length > 0) throw new UsageError("mcp takes no positional arguments");
  // Imported here, not at the top: the server imports this module back for its
  // dispatcher, and no other command should pay for loading the protocol SDK.
  const { serveAgentwikiMcp } = await import("./mcp.ts");
  await serveAgentwikiMcp({
    env: context.env,
    home: context.home,
    cwd: context.cwd,
    vaultRoot: context.vaultRoot,
  });
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

async function main(argv: string[]): Promise<number> {
  const home = process.env["HOME"] ?? "";
  // Help is answered before any command runs, so it reads the contract at the
  // vault the environment names; --vault only steers a command's own output.
  const contract = buildContract({
    vaultRoot: resolveVaultRoot(process.env, home, undefined),
    artifactHome: artifactHome(process.env, home),
  });
  /** A help topic is a command path — `help artifacts rm` reaches the leaf
   * that actually owns --reason. */
  const helpFor = (path: readonly string[]): string => commandHelp(contract, path);
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h") {
    console.log(topHelp(contract));
    return 0;
  }
  if (command === "--version" || command === "-V") {
    console.log(VERSION);
    return 0;
  }
  if (command === "--agent-help") {
    console.log(agentHelp(contract));
    return 0;
  }
  if (command === "--agent-teaser") {
    console.log(agentTeaser(contract));
    return 0;
  }
  if (command === "help") {
    const topic = argv.slice(1);
    console.log(topic.length === 0 ? topHelp(contract) : helpFor(topic));
    return 0;
  }
  const run = REGISTRY[command];
  const described = findCommand(contract.commands, [command]);
  if (run === undefined || described === undefined) {
    console.error(`unknown command "${command}"`);
    console.error(topHelp(contract));
    return 2;
  }
  const rest = argv.slice(1);
  // `artifacts rm --help` is the leaf's help, not the group's.
  const topic =
    rest[0] !== undefined && findCommand(contract.commands, [command, rest[0]]) !== undefined
      ? [command, rest[0]]
      : [command];
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(helpFor(topic));
    return 0;
  }

  let flags: ParsedFlags;
  try {
    flags = parseFlags(rest, specFor(contract, described));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    console.error(helpFor(topic));
    return 2;
  }

  const mode = flags.bools.has("jsonl") ? "jsonl" : flags.bools.has("json") ? "json" : "human";
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
    emit(await run(context, flags), mode);
    // The vault records itself. Agents edit its files with their own tools, so
    // the end of a command is the only moment agentwiki can see what moved —
    // and emitting first keeps git off the path the caller waits on.
    syncVault(context.vaultRoot);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(helpFor(topic));
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

// Guarded so the registry and the contract can be imported and compared by
// the conformance test without running a command.
if (import.meta.main) process.exit(await main(process.argv.slice(2)));
