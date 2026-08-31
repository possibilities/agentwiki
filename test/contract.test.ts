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
const AGENTSTART = process.env["AGENTSTART_HOME"] ?? join(homedir(), "code", "agentstart");
const VALIDATOR_PATH = join("scripts", "validate-agent-contract.ts");

/**
 * Where the fleet validator is, or why there is none.
 *
 * A gate that skips is not a gate: the previous form called existsSync on one
 * path and passed silently when it missed, which is exactly what it did while
 * the validator sat unmerged on a branch. So there are three outcomes and only
 * one of them is quiet.
 *
 * 1. No agentstart checkout at all — the fleet's optional-checkout rule, and
 *    the one case where skipping is correct.
 * 2. A checkout, with the validator in it, or in one of its worktrees. Worktree
 *    discovery is what makes this pass before the validator merges, and step 2
 *    hits directly once it does.
 * 3. A checkout and no validator anywhere — a failure naming every path tried,
 *    because a validator that has moved is news.
 */
function findValidator(): { path: string } | { tried: string[] } | "no-checkout" {
  if (!existsSync(AGENTSTART)) return "no-checkout";
  const tried: string[] = [];
  const check = (root: string): string | undefined => {
    const candidate = join(root, VALIDATOR_PATH);
    tried.push(candidate);
    return existsSync(candidate) ? candidate : undefined;
  };
  const direct = check(AGENTSTART);
  if (direct !== undefined) return { path: direct };
  const listed = Bun.spawnSync({ cmd: ["git", "-C", AGENTSTART, "worktree", "list"] });
  if (listed.exitCode === 0) {
    for (const line of listed.stdout.toString().split("\n")) {
      const root = line.split(/\s+/)[0];
      if (root === undefined || root === "" || root === AGENTSTART) continue;
      const found = check(root);
      if (found !== undefined) return { path: found };
    }
  }
  return { tried };
}

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
    const found = findValidator();
    if (found === "no-checkout") {
      // No agentstart on this machine: the fleet's optional-checkout rule, and
      // the only silence this test allows itself.
      console.warn(`skipped: no agentstart checkout at ${AGENTSTART} (set AGENTSTART_HOME)`);
      return;
    }
    if (!("path" in found)) {
      throw new Error(
        `agentstart is checked out at ${AGENTSTART} but ${VALIDATOR_PATH} is in none of:\n` +
          found.tried.map((candidate) => `  ${candidate}`).join("\n"),
      );
    }
    const file = join(process.env["TMPDIR"] ?? "/tmp", `agentwiki-contract-${process.pid}.json`);
    Bun.write(file, JSON.stringify({ schema_version: 1, ok: true, error: null, data: contract }));
    const run = Bun.spawnSync({ cmd: ["bun", found.path, "--file", file] });
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
