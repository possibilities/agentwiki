import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildContract, walkCommands } from "../src/contract.ts";
import { REGISTRY } from "../src/main.ts";

/**
 * This repository owns its conformance. The schema lives in agentstart and is
 * executed by its validator, so the shape is checked there rather than
 * restated here; what these tests add is the agreement between the contract
 * and the code it describes, which no external validator can see.
 */

const ENTRY = join(import.meta.dir, "..", "src", "main.ts");
const AGENTSTART = process.env["AGENTSTART_ROOT"] ?? join(homedir(), "code", "agentstart");
const VALIDATOR = join(AGENTSTART, "scripts", "validate-agent-contract.ts");

const contract = buildContract({ vaultRoot: "/tmp/vault", artifactHome: "/tmp/artifacts" });
const nodes = walkCommands(contract.commands);

describe("the agent contract", () => {
  test("guide --json emits it inside the envelope", () => {
    const run = Bun.spawnSync({
      cmd: ["bun", ENTRY, "guide", "--json"],
      env: { PATH: process.env["PATH"] ?? "", HOME: homedir(), AGENTWIKI_VAULT: "/tmp/no-vault" },
    });
    expect(run.exitCode).toBe(0);
    const body = JSON.parse(run.stdout.toString());
    expect(body).toMatchObject({ schema_version: 1, ok: true, error: null });
    expect(body.data.contract_version).toBe(1);
    expect(body.data.meta).toMatchObject({ name: "agentwiki", audience: "agent" });
  });

  test("it validates against the fleet schema", () => {
    if (!existsSync(VALIDATOR)) {
      // The validator ships in agentstart; without that checkout the shape is
      // unverifiable here, and a silently passing assertion would be a lie.
      console.warn(`skipped: no ${VALIDATOR} (set AGENTSTART_ROOT to point at one)`);
      return;
    }
    const file = join(process.env["TMPDIR"] ?? "/tmp", `agentwiki-contract-${process.pid}.json`);
    Bun.write(file, JSON.stringify({ schema_version: 1, ok: true, error: null, data: contract }));
    const run = Bun.spawnSync({ cmd: ["bun", VALIDATOR, "--file", file] });
    expect(run.stderr.toString() + run.stdout.toString()).toContain("conforms to version 1");
    expect(run.exitCode).toBe(0);
  });

  test("every dispatched command is described, and every described one dispatches", () => {
    const described = contract.commands.map((command) => command.name);
    // `help` is answered before dispatch, so it has no registry entry — and it
    // is still a command a caller can run, so it is still in the contract.
    expect(described.filter((name) => name !== "help").sort()).toEqual(
      Object.keys(REGISTRY).sort(),
    );
    expect(described).toContain("help");
  });

  test("the error codes are exactly the ones the code can raise", () => {
    const raised = new Set<string>();
    for (const file of readdirSync(join(import.meta.dir, "..", "src"))) {
      if (!file.endsWith(".ts") || file === "contract.ts") continue;
      const source = readFileSync(join(import.meta.dir, "..", "src", file), "utf8");
      for (const match of source.matchAll(/new CliError\(\s*"([a-z_]+)"/g)) raised.add(match[1]!);
    }
    const declared = new Set(contract.concepts.error_codes.map((entry) => entry.code));
    expect([...raised].filter((code) => !declared.has(code))).toEqual([]);
    expect([...declared].filter((code) => !raised.has(code))).toEqual([]);
  });

  test("read_only_commands is exactly the non-mutating leaves, by full path", () => {
    const expected = nodes
      .filter((node) => node.command.mutates === false)
      .map((node) => node.path);
    expect(contract.concepts.read_only_commands).toEqual(expected);
    expect(expected).toContain("artifacts list");
  });

  test("every leaf declares mutates and arguments, and no group does", () => {
    for (const { path, command } of nodes) {
      if (command.subcommands === undefined) {
        expect(`${path}: ${command.mutates}`).toMatch(/: (true|false)$/);
        expect(command.arguments, path).toBeDefined();
      } else {
        expect(command.mutates, path).toBeUndefined();
        expect(command.arguments, path).toBeUndefined();
      }
    }
  });

  test("the declared flags are the flags the parser accepts", () => {
    const run = (args: string[]) =>
      Bun.spawnSync({
        cmd: ["bun", ENTRY, ...args],
        env: { PATH: process.env["PATH"] ?? "", HOME: homedir(), AGENTWIKI_VAULT: "/tmp/no-vault" },
      });
    for (const { path, command } of nodes) {
      for (const argument of command.arguments ?? []) {
        if (argument.positional === true || argument.type === "boolean") continue;
        const result = run([...path.split(" "), argument.name]);
        // A declared flag is known to the grammar: it may complain that the
        // value is missing, but never that the option itself is unknown.
        expect(result.stderr.toString(), `${path} ${argument.name}`).not.toContain(
          `unknown option "${argument.name}"`,
        );
      }
    }
    expect(run(["list", "--nonesuch"]).stderr.toString()).toContain('unknown option "--nonesuch"');
  });

  test("an agent command never requires stdin, because a caller has no pipe", () => {
    for (const { path, command } of nodes) {
      if (command.audience !== "agent") continue;
      expect(command.stdin?.required, path).not.toBe(true);
    }
    // add is the case that forced the rule: --content is the reachable channel.
    const add = contract.commands.find((command) => command.name === "add");
    expect(add?.arguments?.map((argument) => argument.name)).toContain("--content");
  });
});
