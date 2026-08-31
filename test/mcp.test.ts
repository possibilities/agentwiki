/**
 * The generated MCP surface.
 *
 * Two halves, and both matter. The mapping is checked in process against
 * `mcp-tools.ts` — what becomes a tool, what is suppressed, and how each
 * constraint lands in the schema. Then a real `agentwiki mcp` is spawned and
 * driven over stdio by a real MCP client: initialize, tools/list, tools/call.
 * A mapping that is only unit-tested is a mapping that has never once been
 * spoken to.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as z4mini from "zod/v4-mini";
import { buildContract, walkCommands } from "../src/contract.ts";
import { ANNOTATION_EXCEPTIONS, agentTools, serverInstructions } from "../src/mcp-tools.ts";

const ENTRY = join(import.meta.dir, "..", "src", "main.ts");

const CONTRACT = buildContract({ vaultRoot: "/tmp/agentwiki-mcp-test", artifactHome: "/tmp/cas" });
const TOOLS = agentTools(CONTRACT);
const LEAVES = walkCommands(CONTRACT.commands).filter(
  (node) => node.command.subcommands === undefined,
);

/** The advertised JSON Schema, as a host sees it after the SDK converts. */
function schemaOf(name: string): Record<string, unknown> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return z4mini.toJSONSchema(tool.input, { target: "draft-2020-12", io: "input" }) as Record<
    string,
    unknown
  >;
}

function propertiesOf(name: string): Record<string, Record<string, unknown>> {
  return (schemaOf(name)["properties"] ?? {}) as Record<string, Record<string, unknown>>;
}

describe("which commands become tools", () => {
  test("exactly the agent leaves, and every one of them", () => {
    const wanted = LEAVES.filter((node) => node.command.audience === "agent").map((node) =>
      node.path.replace(/ /g, "_"),
    );
    expect(TOOLS.map((tool) => tool.name).sort()).toEqual([...wanted].sort());
    // 28 leaves in the contract — the 27 that predate this server, plus `mcp`
    // itself — and 21 of them an agent's to call.
    expect(LEAVES.length).toBe(28);
    expect(wanted.length).toBe(21);
  });

  test("no operator or internal leaf is exposed, mcp included", () => {
    const exposed = new Set(TOOLS.map((tool) => tool.name));
    const hidden = LEAVES.filter((node) => node.command.audience !== "agent");
    expect(hidden.map((node) => node.path).sort()).toEqual([
      "doctor",
      "gc",
      "help",
      "mcp",
      "open",
      "reindex",
      "serve",
    ]);
    for (const node of hidden) expect(exposed.has(node.path.replace(/ /g, "_"))).toBe(false);
  });

  test("serve declares that it blocks, and is not exposed as a tool", () => {
    const serve = CONTRACT.commands.find((command) => command.name === "serve");
    expect(serve?.blocking).toBe(true);
    expect(TOOLS.map((tool) => tool.name)).not.toContain("serve");
  });

  test("mcp declares itself internal, mutating, and blocking", () => {
    const mcp = CONTRACT.commands.find((command) => command.name === "mcp");
    expect(mcp).toBeDefined();
    expect(mcp?.audience).toBe("internal");
    expect(mcp?.mutates).toBe(true);
    expect(mcp?.blocking).toBe(true);
  });

  test("a nested leaf is named by its full path, joined with an underscore", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(names).toContain("artifacts_list");
    expect(names).toContain("artifacts_versions");
    expect(names).toContain("artifacts_show");
    expect(names).toContain("artifacts_rm");
    expect(names).toContain("artifacts_restore");
    // The group itself is not invocable, and is not a tool.
    expect(names).not.toContain("artifacts");
    // Never prefixed with the CLI name: the host namespaces by server.
    expect(TOOLS.every((tool) => !tool.name.startsWith("agentwiki"))).toBe(true);
  });
});

describe("the input schema", () => {
  test("every global is suppressed, because none of them is a call knob", () => {
    for (const global of CONTRACT.global_arguments) {
      expect(global.role ?? "call").not.toBe("call");
    }
    for (const tool of TOOLS) {
      const properties = Object.keys(propertiesOf(tool.name));
      for (const global of CONTRACT.global_arguments) {
        expect(properties).not.toContain(global.name.replace(/^--/, ""));
      }
    }
  });

  test("a ref stays a string and says a phrase resolves, ambiguity and all", () => {
    const ref = propertiesOf("get")["ref"] as { type: string; description: string };
    expect(ref.type).toBe("string");
    expect(ref.description).toContain("unambiguous spoken phrase");
    expect(ref.description).toContain("ambiguous_ref");
    expect(ref.description).toContain("resolve");
    expect(schemaOf("get")["required"]).toEqual(["ref"]);
  });

  test("a csv argument stays a string and says so", () => {
    const tags = propertiesOf("add")["tags"] as { type: string; description: string };
    expect(tags.type).toBe("string");
    expect(tags.description).toContain("Comma-joined into one string");
  });

  test("add exposes content, the channel a caller with no pipe has", () => {
    const content = propertiesOf("add")["content"] as { type: string; description: string };
    expect(content.type).toBe("string");
    expect(content.description).toContain("no pipe");
  });

  test("choices become an enum and a default becomes a default", () => {
    expect(propertiesOf("publish")["kind"]?.["enum"]).toBeDefined();
    expect(propertiesOf("list")["limit"]?.["default"]).toBe(20);
    expect(propertiesOf("list")["limit"]?.["type"]).toBe("integer");
  });

  test("a declared bound reaches the schema as minimum and maximum", () => {
    // The contract's bounds are the ones the CLI enforces, and a bound that
    // stops at the contract is a bound the caller still violates.
    expect(propertiesOf("list")["limit"]?.["minimum"]).toBe(1);
    expect(propertiesOf("search")["limit"]?.["minimum"]).toBe(1);
    expect(propertiesOf("resolve")["limit"]?.["minimum"]).toBe(1);
    // The contract declares no upper bound on --limit and none is invented:
    // what lands is zod's own integer ceiling, not a cap the CLI would refuse.
    expect(propertiesOf("list")["limit"]?.["maximum"]).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("the worked invocations reach the tool description", () => {
    const publish = TOOLS.find((tool) => tool.name === "publish");
    expect(publish?.description).toContain("Examples:");
    expect(publish?.description).toContain("agentwiki publish ./dist --name q30-probe");
    // Declared only where one teaches something: every agent leaf that had a
    // worked invocation in the hand-written help carries it here.
    for (const name of ["new", "add", "get", "path", "list", "search", "resolve", "rm"]) {
      expect(TOOLS.find((tool) => tool.name === name)?.description, name).toContain("Examples:");
    }
  });

  test("an in path warns that a relative one is resolved somewhere else", () => {
    const path = propertiesOf("publish")["path"] as { description: string };
    expect(path.description).toContain("working directory this caller did not choose");
  });
});

describe("constraints", () => {
  test("an optional one_of is prose, because no keyword says at most one", () => {
    expect(schemaOf("add")["oneOf"]).toBeUndefined();
    const add = TOOLS.find((tool) => tool.name === "add");
    expect(add?.description).toContain("Give at most one of file, content.");
    // The contract's own qualification rides along with the sentence.
    expect(add?.description).toContain("the body is read from stdin");
  });
});

describe("annotations", () => {
  const annotationsOf = (name: string) =>
    TOOLS.find((tool) => tool.name === name)?.annotations ?? {};

  test("readOnlyHint is the contract's own mutates judgment", () => {
    for (const tool of TOOLS) {
      expect(tool.annotations.readOnlyHint).toBe(tool.leaf.mutates === false);
    }
    expect(annotationsOf("path")).toMatchObject({ readOnlyHint: true, idempotentHint: true });
  });

  test("a removing verb is destructive and a capture is not", () => {
    expect(annotationsOf("rm")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(annotationsOf("artifacts_rm")).toMatchObject({ destructiveHint: true });
    // Capture slides the slug rather than failing, so a replay captures again.
    expect(annotationsOf("add")).toMatchObject({ destructiveHint: false, idempotentHint: false });
    // Republishing identical bytes is the same version and changes nothing.
    expect(annotationsOf("publish")).toMatchObject({ idempotentHint: true });
  });

  test("only the command whose job is the remote is open-world", () => {
    for (const tool of TOOLS) {
      expect(tool.annotations.openWorldHint).toBe(tool.name === "commit");
    }
  });

  test("the mapping's exception lists name commands that exist", () => {
    // The two hints the contract cannot state are lists of exceptions rather
    // than a hint per command, so nothing else would notice one going stale.
    const paths = new Set(TOOLS.map((tool) => tool.path.join(" ")));
    for (const path of ANNOTATION_EXCEPTIONS.appending) expect(paths.has(path)).toBe(true);
    for (const path of ANNOTATION_EXCEPTIONS.network) expect(paths.has(path)).toBe(true);
  });
});

describe("the server's instructions", () => {
  const instructions = serverInstructions(CONTRACT);

  test("carry the guidance, the envelope, every error code, and the opening moves", () => {
    expect(instructions).toContain("A vault of plain markdown files is the source of truth");
    expect(instructions).toContain("schema_version");
    for (const entry of CONTRACT.concepts.error_codes) {
      expect(instructions).toContain(entry.code);
      if (entry.recovery !== undefined) expect(instructions).toContain(entry.recovery);
    }
    for (const line of CONTRACT.concepts.agent_defaults) expect(instructions).toContain(line);
  });
});

/**
 * The round trip. A real server process, a real client, a real handshake — the
 * one thing that cannot be faked by agreeing with the mapping module.
 */
describe("a live stdio server", () => {
  let sandbox: string;
  let client: Client;

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), "agentwiki-mcp-"));
    mkdirSync(join(sandbox, "home"), { recursive: true });
    client = new Client({ name: "agentwiki-test", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: "bun",
        args: [ENTRY, "mcp", "--vault", join(sandbox, "vault")],
        // The artifact store is not vault-scoped, so the sandbox has to reach
        // it through the environment or this test would read the real one.
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: join(sandbox, "home"),
          XDG_DATA_HOME: join(sandbox, "data"),
          XDG_STATE_HOME: join(sandbox, "state"),
        },
      }),
    );
  });

  afterAll(async () => {
    await client.close();
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("initialize names the CLI and hands back the contract's instructions", () => {
    expect(client.getServerVersion()?.name).toBe("agentwiki");
    expect(client.getInstructions() ?? "").toContain("A vault of plain markdown files");
  });

  test("tools/list is exactly the agent leaves the mapping generated", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
    expect(tools.length).toBe(21);
    expect(tools.map((tool) => tool.name)).toContain("artifacts_list");
    expect(tools.map((tool) => tool.name)).not.toContain("mcp");
    expect(tools.map((tool) => tool.name)).not.toContain("serve");
  });

  test("a read-only tool returns the CLI's own envelope", async () => {
    const result = (await client.callTool({ name: "guide", arguments: {} })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    expect(result.isError ?? false).toBe(false);
    const envelope = JSON.parse(result.content[0]!.text);
    expect(envelope).toMatchObject({ schema_version: 1, ok: true, error: null });
    expect(envelope.data).toMatchObject({ contract_version: 1 });
  });

  test("a mutating tool writes the vault the server was started against", async () => {
    const added = (await client.callTool({
      name: "add",
      // --content is why this verb is reachable at all: an out-of-process
      // caller has no pipe to write a body through.
      arguments: { content: "# The bluetooth trap\n\nbody", title: "Bluetooth Q30 HFP trap" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(added.isError ?? false).toBe(false);
    expect(JSON.parse(added.content[0]!.text).data).toMatchObject({
      slug: "bluetooth-q30-hfp-trap",
    });

    // Resolved by phrase, not by the slug the caller was never given.
    const path = (await client.callTool({
      name: "path",
      arguments: { ref: "the bluetooth trap" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(path.isError ?? false).toBe(false);
    expect(JSON.parse(path.content[0]!.text).data.path).toEndWith(
      join(sandbox, "vault", "bluetooth-q30-hfp-trap.md"),
    );
  });

  test("a nested tool dispatches through its group", async () => {
    const result = (await client.callTool({ name: "artifacts_list", arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError ?? false).toBe(false);
    expect(JSON.parse(result.content[0]!.text).data).toMatchObject({ artifacts: [], count: 0 });
  });

  test("a refusal leads with its code and carries its recovery", async () => {
    const result = (await client.callTool({
      name: "new",
      arguments: { title: "Bluetooth Q30 HFP trap" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text.startsWith("document_exists:")).toBe(true);
    expect(text).toContain("recovery: ");
    expect(JSON.parse(text.slice(text.indexOf("{")))).toMatchObject({ ok: false });
  });

  test("an ambiguous ref reaches the caller naming its candidates", async () => {
    await client.callTool({
      name: "add",
      arguments: { content: "another one", title: "Bluetooth trap notes" },
    });
    await client.callTool({
      name: "add",
      arguments: { content: "and another", title: "Bluetooth trap review" },
    });
    const result = (await client.callTool({
      name: "get",
      arguments: { ref: "bluetooth trap" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text.startsWith("ambiguous_ref:")).toBe(true);
    expect(text).toContain("bluetooth-trap-notes");
    expect(text).toContain("bluetooth-trap-review");
    expect(text).toContain("agentwiki resolve");
  });

  test("a usage fault comes back as an invalid call, not as an error code", async () => {
    // stdin is the transport, so a call with no body is the fault the CLI
    // raises for a terminal with nothing piped — and it names --content.
    const result = (await client.callTool({ name: "add", arguments: {} })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toStartWith("invalid call: ");
    expect(result.content[0]!.text).toContain("--content");
  });
});
