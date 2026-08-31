/**
 * The MCP server `agentwiki mcp` serves, constructed but not connected.
 *
 * Two things make this a generated surface rather than a second one. The tools
 * come from the contract through `mcp-tools.ts`, so adding a command to
 * `contract.ts` adds a tool with no edit here. And every call is dispatched
 * through `main.ts`'s own `REGISTRY`, in this process — the same function
 * `agentwiki add` runs, reached with the same parsed flags, with nothing
 * spawned and no argv re-parsed.
 *
 * `mcp.ts` is the entrypoint that connects a transport to what this returns.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { artifactHome } from "./artifacts.ts";
import type { Context } from "./context.ts";
import { nowIso } from "./context.ts";
import { buildContract, VERSION } from "./contract.ts";
import { failure, success } from "./envelope.ts";
import { CliError, UsageError } from "./errors.ts";
import { syncVault } from "./git.ts";
import { REGISTRY } from "./main.ts";
import { type AgentTool, agentTools, invocationFor, serverInstructions } from "./mcp-tools.ts";
import type { Environ } from "./paths.ts";

const SCHEMA_VERSION = 1;

export interface ServerOptions {
  env: Environ;
  home: string;
  cwd: string;
  /** The vault every tool call uses, resolved once when the server starts.
   * `--vault` is an operator's choice about which vault is being served, which
   * is exactly why it is not a tool argument. */
  vaultRoot: string;
}

export function createAgentwikiMcpServer(options: ServerOptions): McpServer {
  const contract = buildContract({
    vaultRoot: options.vaultRoot,
    artifactHome: artifactHome(options.env, options.home),
  });
  const server = new McpServer(
    { name: contract.meta.name, version: VERSION },
    { instructions: serverInstructions(contract) },
  );
  for (const tool of agentTools(contract)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.annotations,
      },
      // The SDK infers the callback's argument type from the input schema, which
      // is built at runtime and so infers to nothing useful. The shape is
      // whatever the schema just validated: a plain object of argument values.
      (args: unknown) => callTool(tool, (args ?? {}) as Record<string, unknown>, options),
    );
  }
  return server;
}

/**
 * The context a tool call runs in — what `main` assembles from argv, minus the
 * two things a protocol caller does not have.
 *
 * stdin is the transport, so it can never be a document body: a call is told it
 * has no terminal and no pipe, which is exactly the usage fault `add` raises
 * when neither a file nor --content is given. `--content` exists for this
 * caller, and the refusal names it.
 */
function contextFor(options: ServerOptions): Context {
  return {
    env: options.env,
    home: options.home,
    cwd: options.cwd,
    vaultRoot: options.vaultRoot,
    now: nowIso,
    readStdin: () => {
      throw new UsageError("stdin is the MCP transport here; pass the body as content");
    },
    // Reported as a terminal so nothing waits on a pipe that will never close.
    stdinIsTerminal: true,
  };
}

/**
 * One tool call, dispatched in process.
 *
 * The vault records itself on the way out exactly as a terminal invocation
 * would — the same commit-and-push every command performs, including for files
 * the caller edited itself after asking for their path. Without it a session
 * that only ever reaches agentwiki through this server would leave every direct
 * edit unrecorded, which is the model the guidance promises.
 */
async function callTool(
  tool: AgentTool,
  args: Record<string, unknown>,
  options: ServerOptions,
): Promise<CallToolResult> {
  try {
    const invocation = invocationFor(tool, args);
    const run = REGISTRY[invocation.name];
    if (run === undefined) throw new Error(`no handler for ${invocation.name}`);
    const context = contextFor(options);
    const result = await run(context, invocation.flags);
    syncVault(context.vaultRoot);
    const envelope = success(SCHEMA_VERSION, result.data);
    return { content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }] };
  } catch (error) {
    return toolError(error);
  }
}

/**
 * A refusal, as MCP.md rules: the message leads with `error.code`, then the
 * message, then `recovery` when the contract gives one — the recovery line is
 * the difference between a caller that retries correctly and one that retries
 * identically. An ambiguous_ref names its candidates in the message, so the
 * caller that has to re-ask gets the answer in the same breath. The envelope
 * follows, so anything already parsing agentwiki parses the same shape here.
 *
 * A usage fault is not an envelope anywhere: at a terminal it is exit 2 with
 * help on stderr and no `error.code` at all. It comes back here as a plain tool
 * error for that reason — inventing a code would be one the contract lists and
 * the CLI cannot emit.
 */
function toolError(error: unknown): CallToolResult {
  if (error instanceof UsageError) {
    return { isError: true, content: [{ type: "text", text: `invalid call: ${error.message}` }] };
  }
  const domain =
    error instanceof CliError
      ? error
      : new CliError("internal_error", error instanceof Error ? error.message : String(error));
  const lines = [`${domain.code}: ${domain.message}`];
  if (domain.recovery !== undefined) lines.push(`recovery: ${domain.recovery}`);
  lines.push(JSON.stringify(failure(SCHEMA_VERSION, domain), null, 2));
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}
