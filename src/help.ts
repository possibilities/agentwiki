import type { Contract, ContractArgument, ContractCommand } from "./contract.ts";
import { findCommand, walkCommands } from "./contract.ts";

/**
 * Every help surface is a render of the contract — `--help`, `agentwiki help
 * <command>`, `--agent-help` and `--agent-teaser` all read the document
 * `guide --json` prints. Nothing here may state a fact about the CLI that the
 * contract does not already carry: the moment it does, the two can disagree
 * and nothing will notice.
 */

const WIDTH = 78;
const GUTTER = 21;

function wrap(text: string, width = WIDTH, indent = ""): string {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.trim() === "") {
      out.push("");
      continue;
    }
    let line = indent;
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line.trim() !== "" && line.length + 1 + word.length > width) {
        out.push(line);
        line = indent + word;
      } else line = line.trim() === "" ? indent + word : `${line} ${word}`;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Two columns with a hanging indent, so a long description stays readable
 * beside a short flag. */
function column(left: string, right: string, gutter = GUTTER): string {
  const pad = " ".repeat(gutter);
  const wrapped = wrap(right, WIDTH - gutter).split("\n");
  // A label too long for the gutter takes its own line rather than shunting
  // the description one character to the right of every other row.
  if (left.length + 4 > gutter)
    return [`  ${left}`, ...wrapped.map((line) => pad + line)].join("\n");
  const first = `  ${left.padEnd(gutter - 2)}${wrapped[0] ?? ""}`.trimEnd();
  return [first, ...wrapped.slice(1).map((line) => pad + line)].join("\n");
}

function placeholder(argument: ContractArgument): string {
  if (argument.type === "boolean") return "";
  if (argument.choices !== undefined) return ` <${argument.choices.join("|")}>`;
  if (argument.format === "path") return " <path>";
  if (argument.type === "integer" || argument.type === "number") return " <n>";
  return " <value>";
}

function annotate(argument: ContractArgument): string {
  const notes: string[] = [];
  if (argument.required === true) notes.push("required");
  if (argument.default !== undefined) notes.push(`default ${String(argument.default)}`);
  if (argument.aliases !== undefined && argument.aliases.length > 0) {
    notes.push(argument.aliases.join(", "));
  }
  if (argument.direction === "out") notes.push("written by the command");
  return notes.length === 0
    ? argument.description
    : `${argument.description} (${notes.join("; ")})`;
}

function usageLine(path: string, command: ContractCommand): string {
  const parts = [`agentwiki ${path}`];
  if (command.subcommands !== undefined) parts.push("<subcommand>");
  const args = command.arguments ?? [];
  for (const argument of args.filter((argument) => argument.positional === true)) {
    parts.push(argument.required === true ? `<${argument.name}>` : `[${argument.name}]`);
  }
  for (const argument of args) {
    if (argument.positional === true || argument.required !== true) continue;
    parts.push(`${argument.name}${placeholder(argument)}`);
  }
  if (args.some((argument) => argument.positional !== true && argument.required !== true)) {
    parts.push("[options]");
  }
  return parts.join(" ");
}

function commandIndex(commands: readonly ContractCommand[], mark: boolean): string {
  const lines: string[] = [];
  for (const { path, command } of walkCommands(commands)) {
    const depth = path.split(" ").length - 1;
    const label = `${"  ".repeat(depth)}${command.name}`;
    const suffix = mark && command.audience !== "agent" ? ` [${command.audience}]` : "";
    lines.push(column(label, `${command.summary}${suffix}`, 15));
  }
  return lines.join("\n");
}

function optionLines(args: readonly ContractArgument[]): string {
  return args
    .filter((argument) => argument.positional !== true)
    .map((argument) => column(`${argument.name}${placeholder(argument)}`, annotate(argument)))
    .join("\n");
}

function positionalLines(args: readonly ContractArgument[]): string {
  return args
    .filter((argument) => argument.positional === true)
    .map((argument) =>
      column(
        argument.required === true ? `<${argument.name}>` : `[${argument.name}]`,
        annotate(argument),
      ),
    )
    .join("\n");
}

function section(title: string, body: string): string[] {
  return body.trim() === "" ? [] : [`${title}:`, body, ""];
}

export function agentTeaser(contract: Contract): string {
  return contract.meta.purpose;
}

export function topHelp(contract: Contract): string {
  const model = contract.concepts.model as {
    addressing: { ref_summary: string };
    top_level_flags: { flag: string; meaning: string }[];
  };
  const lines: string[] = [
    `agentwiki ${contract.meta.version}`,
    wrap(contract.meta.purpose),
    "",
    "Usage:",
    "  agentwiki <command> [options]",
    "",
    ...section(
      "Global options",
      contract.global_arguments
        .map((argument) => column(`${argument.name}${placeholder(argument)}`, annotate(argument)))
        .join("\n"),
    ),
    ...section(
      "Top-level options (before any command)",
      model.top_level_flags.map((entry) => column(entry.flag, entry.meaning)).join("\n"),
    ),
    ...section("Commands", commandIndex(contract.commands, false)),
    wrap(model.addressing.ref_summary),
    "",
    "Run agentwiki --agent-help for the agent runbook, or agentwiki help <command>.",
  ];
  return `${lines.join("\n")}\n`;
}

export function commandHelp(contract: Contract, path: readonly string[]): string {
  const command = findCommand(contract.commands, path);
  if (command === undefined) return topHelp(contract);
  const joined = path.join(" ");
  const args = command.arguments ?? [];
  const lines: string[] = [
    "Usage:",
    `  ${usageLine(joined, command)}`,
    "",
    wrap(command.summary),
    "",
    ...section(
      "Subcommands",
      command.subcommands === undefined ? "" : commandIndex(command.subcommands, true),
    ),
    ...section("Arguments", positionalLines(args)),
    ...section("Options", optionLines(args)),
  ];
  if (command.stdin !== undefined) {
    lines.push(
      ...section(
        "Standard input",
        column(
          command.stdin.accepts,
          command.stdin.required === true
            ? `${command.stdin.description} (required)`
            : command.stdin.description,
        ),
      ),
    );
  }
  lines.push(
    ...section(
      "Constraints",
      (command.constraints ?? [])
        .map((constraint) =>
          column(
            constraint.kind.replace("_", " "),
            [
              constraint.arguments.join(", "),
              constraint.required === true ? " (one is required)" : "",
              constraint.description === undefined ? "" : ` — ${constraint.description}`,
            ].join(""),
          ),
        )
        .join("\n"),
    ),
  );
  if (command.guidance !== undefined) lines.push(wrap(command.guidance), "");
  if (command.subcommands !== undefined) {
    lines.push(`Run agentwiki help ${joined} <subcommand> for one of them.`, "");
  }
  lines.push(
    `Global options: ${contract.global_arguments.map((argument) => argument.name).join(", ")}.`,
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function agentHelp(contract: Contract): string {
  const exits = Object.entries(contract.concepts.output_contract.exit_codes)
    .map(([code, meaning]) => column(`exit ${code}`, meaning, 10))
    .join("\n");
  const envelope = JSON.stringify(contract.concepts.output_contract.envelope, null, 2)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  const codes = contract.concepts.error_codes
    .map((entry) =>
      column(
        entry.code,
        entry.recovery === undefined ? entry.meaning : `${entry.meaning} → ${entry.recovery}`,
        28,
      ),
    )
    .join("\n");
  const lines: string[] = [
    `agentwiki ${contract.meta.version} — agent runbook`,
    "",
    wrap(contract.meta.purpose),
    "",
    contract.guidance,
    "",
    ...section(
      "Defaults",
      contract.concepts.agent_defaults.map((line) => wrap(line, WIDTH, "  ")).join("\n"),
    ),
    ...section("Contract", `${envelope}\n${exits}`),
    ...section("Error codes", codes),
    ...section("Commands", commandIndex(contract.commands, true)),
    "Deep runbook: the wiki agent skill; this text is the in-binary fallback.",
    "Full machine-readable contract: agentwiki guide --json",
  ];
  return `${lines.join("\n")}\n`;
}
