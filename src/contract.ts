import { ARTIFACT_KINDS, MAX_ARTIFACT_BYTES } from "./artifacts.ts";
import { INDEX_SCHEMA_VERSION } from "./index.ts";
import { MIN_MENTION_LENGTH } from "./links.ts";
import { DEFAULT_ARTIFACT_PORT, DEFAULT_PORT } from "./urls.ts";
import { DEFAULT_VAULT } from "./vault.ts";

export const VERSION = "0.1.0";

/**
 * The fleet agent contract, version 1 — the single authored description of
 * this CLI. `guide --json` emits it, and `--help`, `--agent-help` and
 * `--agent-teaser` are renders of it rather than second authorships: a
 * summary, an error code or a flag written twice is a pair that goes stale
 * without anything noticing.
 *
 * The schema lives at agentstart/config/agent-contract/schema.json and is
 * normative; agentstart/scripts/validate-agent-contract.ts executes it, and
 * test/contract.test.ts holds this repository to it.
 */

export type ContractAudience = "agent" | "operator" | "internal";

export interface ContractArgument {
  name: string;
  type: "string" | "boolean" | "integer" | "number";
  description: string;
  format?: "path" | "url" | "duration" | "ref" | "json";
  direction?: "in" | "out";
  required?: boolean;
  positional?: boolean;
  repeatable?: boolean;
  choices?: string[];
  default?: unknown;
  aliases?: string[];
}

export interface ContractConstraint {
  kind: "one_of" | "conflicts" | "requires";
  arguments: string[];
  required?: boolean;
  description?: string;
}

export interface ContractStdin {
  accepts: "text" | "json";
  required?: boolean;
  description: string;
}

export interface ContractCommand {
  name: string;
  summary: string;
  audience: ContractAudience;
  mutates?: boolean;
  guidance?: string;
  arguments?: ContractArgument[];
  subcommands?: ContractCommand[];
  stdin?: ContractStdin;
  constraints?: ContractConstraint[];
}

export interface Contract {
  contract_version: 1;
  meta: { name: string; version: string; purpose: string; audience: "agent" | "operator" };
  guidance: string;
  concepts: {
    model: Record<string, unknown>;
    output_contract: { envelope: Record<string, unknown>; exit_codes: Record<string, string> };
    error_codes: { code: string; meaning: string; recovery?: string }[];
    read_only_commands: string[];
    agent_defaults: string[];
  };
  global_arguments: ContractArgument[];
  commands: ContractCommand[];
}

const PURPOSE =
  "Capture, search, link, and publish: a plain-file document vault that is the source of truth, with full-text search, a wikilink graph, and immutable versioned artifacts served on demand.";

/** Prose, on purpose: which verb to reach for, and what a caller gets wrong.
 * Rendered verbatim by --agent-help, so it is written to be read by an agent
 * that has nothing else. */
const GUIDANCE = `A vault of plain markdown files is the source of truth. The SQLite index is
derived and reconciles itself on every read, so you may edit vault files
directly with your normal tools — get the path, edit it, and the next command
already sees the change.

Reading (safe anytime)
  agentwiki search "bluetooth hfp" --json    Ranked FTS hits with snippets.
  agentwiki list --tag decision --json       Newest first; --limit to bound.
  agentwiki get bluetooth-q30-hfp-trap --json
                                             Body plus frontmatter; add
                                             --meta-only to skip the body.
  agentwiki path bluetooth-q30 --json        Absolute path — edit that file
                                             directly, do not round-trip text
                                             through get and add.
  agentwiki resolve "the bluetooth trap" --json
                                             Ranked candidates when a spoken
                                             phrase might mean several docs.
  agentwiki backlinks bluetooth-q30 --json   Who points here (wikilink|mention).
  agentwiki links <ref> · graph · tags · doctor

  A <ref> resolves in tiers: exact slug, exact title, case- and article-
  insensitive match, unambiguous fuzzy contains, then the spoken words present
  in order ("the bluetooth trap" finds bluetooth-q30-hfp-trap). Two matches in
  a tier is an ambiguous_ref error naming the candidates — re-ask with a slug.

Editing (the path is the point)
  Nothing here rewrites a body for you. Take the path, edit the file with your
  own tools, and the next command indexes and commits what you changed.

Writing (files change on disk)
  agentwiki new "Bluetooth Q30 HFP trap" --tags evidence,audio
                                             Fails with document_exists if the
                                             slug is taken.
  agentwiki add --content "$body" --title "Q30 probe run" --tags evidence
                                             Capture never fails on a name
                                             clash; the slug slides to -2.
                                             A file argument or a pipe on stdin
                                             works too, but --content is the
                                             channel an out-of-process caller
                                             always has.
  agentwiki rm <ref> --reason "superseded by the duplex device"
                                             Stamps deleted: in frontmatter.
                                             The file never moves, links stay
                                             stable, readers exclude it.
  agentwiki restore <ref>                    Unstamps it.

Artifacts (immutable, content-addressed)
  agentwiki publish ./dist --name q30-probe --kind bundle --tag audio
                                             Version = content hash. Same bytes
                                             republished = same version. Writes
                                             a stub document under artifacts/
                                             so the artifact is in the graph.
  agentwiki artifacts list|versions <name>|show <name>
  agentwiki artifacts rm <name> --reason "wrong build"
                                             Tombstone only; the stub document
                                             tombstones with the last version.
  agentwiki gc                               The only command that frees bytes.

Serving (a resident launch agent)
  agentwiki serve --port 7777                Static bytes, localhost, no
                                             server-side execution. Immutable
                                             /a/<name>/v/<hash>/ URLs are safe
                                             to cite; /a/<name>/ tracks latest;
                                             /d/<slug> renders a document.
                                             Artifacts answer on their own
                                             origin (--artifact-port, default
                                             7778) so their scripts reach
                                             neither the vault nor the network;
                                             /a/… on the document port
                                             redirects there.
  agentwiki open <name>                      Errors with a recovery if serve
                                             is not already running.

History (automatic — do not commit the vault yourself)
  The vault is a git repository, and every command commits whatever it finds
  changed on its way out, then pushes best-effort when a remote exists. That
  includes files you edited directly: the command after your edit records it.
  A read-only command therefore still records an edit you already made — it
  writes nothing of its own. The derived index is gitignored and never enters
  history.

  agentwiki commit --message "..."           Record now rather than on the next
                                             command, with your own subject.
                                             The one gap it fills: serve never
                                             returns, so it never commits.
  agentwiki doctor                           Reports branch, remote, and how
                                             many commits are unpushed.`;

const ERROR_CODES: Contract["concepts"]["error_codes"] = [
  {
    code: "ambiguous_ref",
    meaning: "A ref matched more than one document in the same resolution tier.",
    recovery: "Use one of the named slugs, or run: agentwiki resolve <phrase> --json",
  },
  {
    code: "document_not_found",
    meaning: "No document matches that ref.",
    recovery: "Run: agentwiki search <words> --json",
  },
  {
    code: "document_exists",
    meaning: "new refused because the slug is already taken.",
    recovery: "Read the existing document, or capture alongside it with: agentwiki add",
  },
  {
    code: "empty_document",
    meaning: "The content to capture was empty or whitespace.",
  },
  {
    code: "file_not_found",
    meaning: "The file argument does not exist.",
  },
  {
    code: "not_markdown",
    meaning: "A non-markdown document cannot carry a tombstone in frontmatter.",
    recovery: "Move the file out of the vault, or convert it to markdown first.",
  },
  {
    code: "no_tombstones",
    meaning: "restore found no tombstoned documents at all.",
  },
  {
    code: "slug_exhausted",
    meaning: "Every slug near the derived one is taken.",
    recovery: "Capture under a different title.",
  },
  {
    code: "template_not_found",
    meaning: "No template of that name in <vault>/.agentwiki/templates/.",
    recovery: "Templates are plain markdown files; create one there and retry.",
  },
  {
    code: "vault_not_found",
    meaning: "A read found no vault directory; reads never create one.",
    recovery: 'Create one by capturing something: agentwiki new "First document"',
  },
  {
    code: "empty_query",
    meaning: "The search query held no searchable term.",
  },
  {
    code: "bad_query",
    meaning: "FTS5 could not parse the query.",
    recovery: "Try plain words; quotes and NEAR/AND/OR are FTS5 syntax.",
  },
  {
    code: "artifact_not_found",
    meaning: "No artifact, or no live version, under that name.",
    recovery: "Run: agentwiki artifacts list --json",
  },
  {
    code: "artifact_not_readable",
    meaning: "The path given to publish does not exist.",
  },
  {
    code: "artifact_unreadable",
    meaning: "The source could not be read while publishing.",
  },
  {
    code: "artifact_too_large",
    meaning: `The artifact is over the ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB publish cap.`,
    recovery:
      "Trim the bundle, or keep the large original outside the artifact store and publish a render of it.",
  },
  {
    code: "empty_artifact",
    meaning: "The directory given to publish contains no files.",
  },
  {
    code: "bad_artifact_name",
    meaning: "The name given held no usable artifact name.",
  },
  {
    code: "content_reclaimed",
    meaning: "Every tombstoned version of that artifact was already collected by gc.",
    recovery: "Publish the content again under the same name.",
  },
  {
    code: "server_not_running",
    meaning: "open found nothing serving the artifact URL.",
    recovery: "Start it first: agentwiki serve",
  },
  {
    code: "bad_schema_version",
    meaning: "The index or artifact manifest carries a non-integer schema_version.",
  },
  {
    code: "unsupported_schema_version",
    meaning: "The index or manifest was written by a newer agentwiki.",
    recovery: "Upgrade agentwiki; the manifest is authoritative and must not be downgraded.",
  },
  {
    code: "internal_error",
    meaning: "An unexpected failure, wrapped so stdout is still an envelope.",
    recovery: "Rerun with AGENTWIKI_DEBUG=1 for a stack trace.",
  },
];

const REF: ContractArgument = {
  name: "ref",
  type: "string",
  description: "Document: a slug, an exact title, or an unambiguous spoken phrase.",
  positional: true,
  required: true,
  format: "ref",
};

const ARTIFACT_NAME: ContractArgument = {
  name: "name",
  type: "string",
  description: "Artifact name; several words are joined.",
  positional: true,
  required: true,
};

const VERSION_FLAG: ContractArgument = {
  name: "--version",
  type: "string",
  description: "One content hash instead of every version of the name.",
};

const LIMIT: ContractArgument = {
  name: "--limit",
  type: "integer",
  description: "Maximum rows.",
  default: 20,
};

const COMMANDS: ContractCommand[] = [
  {
    name: "new",
    summary: "Create a document from a title, optionally from a template",
    audience: "agent",
    mutates: true,
    guidance:
      "The slug is derived from the title. An existing slug is a document_exists error rather than a silent second file — use add to capture alongside it.",
    arguments: [
      {
        name: "title",
        type: "string",
        description: "Document title; several words are joined, so quoting is optional.",
        positional: true,
        required: true,
      },
      {
        name: "--tags",
        type: "string",
        description: "Comma-joined tags for frontmatter; not repeatable.",
      },
      {
        name: "--template",
        type: "string",
        description:
          "A markdown file in <vault>/.agentwiki/templates/; {{title}}, {{slug}}, {{date}} and {{now}} are substituted.",
      },
    ],
  },
  {
    name: "add",
    summary: "Capture a file, inline content, or stdin as a document",
    audience: "agent",
    mutates: true,
    guidance:
      "Capture must not interrupt: a slug clash slides to <slug>-2 rather than failing the way new does. The title comes from --title, else frontmatter, the first heading, or the file name. Non-markdown text files keep their extension and are indexed for search only.",
    stdin: {
      accepts: "text",
      description: "The document body, when neither a file nor --content is given.",
    },
    constraints: [
      {
        kind: "one_of",
        arguments: ["file", "--content"],
        description: "At most one; with neither, the body is read from stdin.",
      },
    ],
    arguments: [
      {
        name: "file",
        type: "string",
        description: "File to capture.",
        positional: true,
        format: "path",
        direction: "in",
      },
      {
        name: "--content",
        type: "string",
        description: "The document body inline — the channel a caller with no pipe uses.",
      },
      {
        name: "--title",
        type: "string",
        description:
          "Title; otherwise taken from frontmatter, the first heading, or the file name.",
      },
      {
        name: "--tags",
        type: "string",
        description: "Comma-joined tags, merged with any already in the content's frontmatter.",
      },
    ],
  },
  {
    name: "get",
    summary: "Print a document's content and metadata",
    audience: "agent",
    mutates: false,
    guidance:
      "Content comes from the vault file, not a cache. To change a document, take its path and edit the file directly.",
    arguments: [
      REF,
      { name: "--meta-only", type: "boolean", description: "Metadata without the body." },
    ],
  },
  {
    name: "path",
    summary: "Print a document's absolute file path",
    audience: "agent",
    mutates: false,
    guidance:
      "The editing entrypoint: fetch the path, edit that file with your own tools, and the next command indexes and commits the change.",
    arguments: [REF],
  },
  {
    name: "list",
    summary: "List documents, most recently updated first",
    audience: "agent",
    mutates: false,
    arguments: [
      { name: "--tag", type: "string", description: "Only documents carrying this tag." },
      LIMIT,
    ],
  },
  {
    name: "search",
    summary: "Full-text search the vault",
    audience: "agent",
    mutates: false,
    guidance:
      "Query terms are quoted for you, so apostrophes and hyphens search rather than fail. A trailing * is kept as a prefix search.",
    arguments: [
      {
        name: "query",
        type: "string",
        description: "Search terms; several words are joined.",
        positional: true,
        required: true,
      },
      { name: "--tag", type: "string", description: "Restrict to a tag." },
      LIMIT,
    ],
  },
  {
    name: "tags",
    summary: "List tags with live document counts",
    audience: "agent",
    mutates: false,
    arguments: [],
  },
  {
    name: "resolve",
    summary: "Rank the documents a spoken phrase could mean",
    audience: "agent",
    mutates: false,
    guidance:
      "Never an error for a phrase that matches nothing: this is the call to make precisely to find out, and the answer to an ambiguous_ref.",
    arguments: [
      {
        name: "phrase",
        type: "string",
        description: "Spoken words; several are joined.",
        positional: true,
        required: true,
      },
      LIMIT,
    ],
  },
  {
    name: "links",
    summary: "Outgoing wikilinks, mentions, and dangling targets",
    audience: "agent",
    mutates: false,
    arguments: [REF],
  },
  {
    name: "backlinks",
    summary: "Incoming wikilinks and mentions",
    audience: "agent",
    mutates: false,
    arguments: [REF],
  },
  {
    name: "graph",
    summary: "Export the whole document graph as nodes and edges",
    audience: "agent",
    mutates: false,
    guidance:
      "Nodes are live documents; edges are wikilink or mention. Unresolved and ambiguous targets are reported separately as dangling.",
    arguments: [],
  },
  {
    name: "doctor",
    summary: "Report dangling links, orphans, index and git health",
    audience: "operator",
    mutates: false,
    guidance:
      "Dangling wikilinks, ambiguous link targets, duplicate slugs, orphan documents, artifact stubs whose artifact the manifest no longer serves, and the vault's branch, remote and unpushed count.",
    arguments: [],
  },
  {
    name: "reindex",
    summary: "Rebuild the derived index from the vault",
    audience: "operator",
    mutates: true,
    guidance:
      "Never needed for correctness: every read reconciles incrementally first. This is the escape hatch for a doubted or deleted index, and it touches nothing but the index.",
    arguments: [],
  },
  {
    name: "rm",
    summary: "Tombstone a document with a reason",
    audience: "agent",
    mutates: true,
    guidance:
      "Stamps deleted: and deleted_reason: into the file's frontmatter. The file never moves, so inbound links stay stable and restore is always possible.",
    arguments: [
      REF,
      {
        name: "--reason",
        type: "string",
        description: "Why it was removed; recorded in frontmatter.",
        required: true,
      },
    ],
  },
  {
    name: "restore",
    summary: "Lift a document's tombstone",
    audience: "agent",
    mutates: true,
    guidance: "The ref resolves among tombstoned documents only.",
    arguments: [REF],
  },
  {
    name: "publish",
    summary: "Publish a file or directory as an immutable artifact",
    audience: "agent",
    mutates: true,
    guidance:
      "The version is the content hash: a single file hashes its bytes, a directory hashes its sorted (file hash, relative path) manifest. Republishing identical bytes yields the same version and changes nothing. Writes a stub document under artifacts/ so the artifact is inside the document graph.",
    arguments: [
      {
        name: "path",
        type: "string",
        description: "File or directory to publish.",
        positional: true,
        required: true,
        format: "path",
        direction: "in",
      },
      {
        name: "--name",
        type: "string",
        description: "The stable name whose latest pointer moves.",
        required: true,
      },
      {
        name: "--kind",
        type: "string",
        description: "Manifest metadata only, never engine behavior.",
        choices: [...ARTIFACT_KINDS],
      },
      {
        name: "--title",
        type: "string",
        description: "Human title for the manifest and the stub document.",
      },
      {
        name: "--tag",
        type: "string",
        description: "Comma-joined tags for the manifest and the stub document; not repeatable.",
      },
      {
        name: "--tags",
        type: "string",
        description: "Accepted spelling of --tag; both are merged.",
      },
    ],
  },
  {
    name: "artifacts",
    summary: "List, inspect, tombstone, and restore artifacts",
    audience: "agent",
    subcommands: [
      {
        name: "list",
        summary: "Every artifact name at its latest live version",
        audience: "agent",
        mutates: false,
        arguments: [],
      },
      {
        name: "versions",
        summary: "Every version of one name, newest first",
        audience: "agent",
        mutates: false,
        arguments: [ARTIFACT_NAME],
      },
      {
        name: "show",
        summary: "Full manifest detail for a name's latest version",
        audience: "agent",
        mutates: false,
        arguments: [ARTIFACT_NAME],
      },
      {
        name: "rm",
        summary: "Tombstone an artifact, or one version of it",
        audience: "agent",
        mutates: true,
        guidance:
          "Bytes survive until gc. The stub document tombstones with the last live version.",
        arguments: [
          ARTIFACT_NAME,
          {
            name: "--reason",
            type: "string",
            description: "Why it was removed; recorded in the manifest.",
            required: true,
          },
          VERSION_FLAG,
        ],
      },
      {
        name: "restore",
        summary: "Lift an artifact's tombstone",
        audience: "agent",
        mutates: true,
        arguments: [ARTIFACT_NAME, VERSION_FLAG],
      },
    ],
  },
  {
    name: "open",
    summary: "Open an artifact's latest URL in the browser",
    audience: "operator",
    mutates: true,
    guidance:
      "Launches a browser on the human's screen, and errors with server_not_running, plus a recovery, when nothing answers.",
    arguments: [
      ARTIFACT_NAME,
      {
        name: "--port",
        type: "integer",
        description: "Where serve is listening.",
        default: DEFAULT_PORT,
      },
    ],
  },
  {
    name: "gc",
    summary: "Reclaim the bytes behind tombstoned artifacts",
    audience: "operator",
    mutates: true,
    guidance:
      "The only command that deletes content, and only for versions already tombstoned. Manifest rows survive, marked reclaimed.",
    arguments: [],
  },
  {
    name: "serve",
    summary: "Serve documents and artifacts on demand",
    audience: "operator",
    mutates: true,
    guidance:
      "Blocks until interrupted, so it never returns and never commits. Localhost only, static bytes only, no server-side execution. A resident launch agent (agentwiki.server, installed by AgentStart) already serves the default vault; run this by hand only for a different vault or port. Artifacts bind the second port so they land on an origin of their own: their scripts cannot read /d/<slug> or reach the network. The two ports must differ.",
    arguments: [
      {
        name: "--port",
        type: "integer",
        description: "Document listen port.",
        default: DEFAULT_PORT,
      },
      {
        name: "--artifact-port",
        type: "integer",
        description: "Artifact listen port; must differ from --port.",
        default: DEFAULT_ARTIFACT_PORT,
      },
    ],
  },
  {
    name: "commit",
    summary: "Record vault changes in git now, instead of on the next command",
    audience: "agent",
    mutates: true,
    guidance:
      "Every command already commits what it finds changed on its way out, and pushes when a remote exists. This is the explicit form, for a document written and then not read again — and the only way to give the commit your own message.",
    arguments: [
      {
        name: "--message",
        type: "string",
        description: "Commit subject, instead of one derived from the changes.",
      },
    ],
  },
  {
    name: "guide",
    summary: "Print this contract, the machine-readable description of the CLI",
    audience: "agent",
    mutates: false,
    guidance:
      "--help, --agent-help and --agent-teaser are renders of this document; nothing about the CLI is written twice.",
    arguments: [],
  },
  {
    name: "help",
    summary: "Show help for a command",
    audience: "operator",
    mutates: false,
    guidance: "An agent wants guide --json, which carries everything this prints and more.",
    arguments: [
      {
        name: "command",
        type: "string",
        description: "Command, or command and subcommand.",
        positional: true,
      },
    ],
  },
];

const GLOBAL_ARGUMENTS: ContractArgument[] = [
  {
    name: "--vault",
    type: "string",
    description: "Vault directory (env AGENTWIKI_VAULT).",
    format: "path",
    direction: "in",
    default: DEFAULT_VAULT,
  },
  { name: "--json", type: "boolean", description: "Emit the stable JSON envelope." },
  {
    name: "--jsonl",
    type: "boolean",
    description:
      "Emit newline-delimited records instead of one envelope (list, search, resolve, artifacts list, artifacts versions).",
  },
  {
    name: "--help",
    type: "boolean",
    description: "Show help for the command and exit.",
    aliases: ["-h"],
  },
];

/** Walk every node with its full space-joined path — the identity everything
 * addressing a command uses. */
export function walkCommands(
  commands: readonly ContractCommand[],
  prefix: string[] = [],
): { path: string; command: ContractCommand }[] {
  const out: { path: string; command: ContractCommand }[] = [];
  for (const command of commands) {
    const path = [...prefix, command.name];
    out.push({ path: path.join(" "), command });
    if (command.subcommands !== undefined) out.push(...walkCommands(command.subcommands, path));
  }
  return out;
}

/** Derived, never hand-listed: a read-only list authored beside `mutates` is
 * exactly the pair that drifts. */
function readOnlyCommands(commands: readonly ContractCommand[]): string[] {
  return walkCommands(commands)
    .filter((node) => node.command.mutates === false)
    .map((node) => node.path);
}

export interface ContractPaths {
  vaultRoot: string;
  artifactHome: string;
}

export function buildContract(paths: ContractPaths): Contract {
  return {
    contract_version: 1,
    meta: { name: "agentwiki", version: VERSION, purpose: PURPOSE, audience: "agent" },
    guidance: GUIDANCE,
    concepts: {
      model: {
        storage: {
          vault: paths.vaultRoot,
          vault_default: DEFAULT_VAULT,
          vault_override: "--vault <path> or AGENTWIKI_VAULT",
          index: `${paths.vaultRoot}/.agentwiki/index.sqlite3`,
          index_schema_version: INDEX_SCHEMA_VERSION,
          templates: `${paths.vaultRoot}/.agentwiki/templates/`,
          artifact_store: paths.artifactHome,
          artifact_content: `${paths.artifactHome}/cas/`,
          artifact_manifest: `${paths.artifactHome}/manifest.sqlite3`,
          authority:
            "Files are truth and the index is derived: deleting the index loses nothing and reindex rebuilds it. The artifact manifest is authoritative and cannot be rebuilt from the vault.",
        },
        git: {
          behavior:
            "The vault is a git repository and every command commits whatever it finds changed, then pushes best-effort when a remote exists. Never commit or push the vault yourself.",
          read_only_commands:
            "A command declaring mutates: false writes nothing of its own, but still records edits you made yourself, because the commit happens on every command's way out.",
          derived_index: "gitignored — it is rebuilt by any read and must not enter history",
          gap: "serve never returns, so it never commits; agentwiki commit is the explicit form",
        },
        addressing: {
          ref_summary:
            "Every <ref> accepts a slug, an exact title, or an unambiguous spoken phrase. Ambiguity is an error that names the candidates; agentwiki resolve <phrase> ranks them as data.",
          ref_tiers: [
            "exact slug",
            "exact title",
            "case- and article-insensitive",
            "unambiguous fuzzy contains",
            "spoken words present in order",
          ],
          ambiguity: "ambiguous_ref error naming the candidates",
          disambiguation_command: "agentwiki resolve <phrase> --json",
          slug: "kebab-case, derived from the file name, unique within the vault",
        },
        graph: {
          edge_kinds: ["wikilink", "mention"],
          wikilink:
            "[[slug]], [[Exact Title]] or [[target|alias]]; resolved exactly or normalized, never fuzzily",
          mention: `another document's title appearing verbatim in the body (minimum ${MIN_MENTION_LENGTH} characters, word-bounded, code and existing wikilinks excluded)`,
          dangling: "unresolved or ambiguous link targets, reported by links, graph and doctor",
        },
        tombstones: {
          documents:
            "rm stamps deleted: and deleted_reason: in frontmatter; the file never moves; restore unstamps",
          artifacts:
            "artifacts rm marks the manifest row, and tombstones the stub document once no live version remains; bytes survive until gc",
          collection:
            "gc is the only command that deletes content, and only for already-tombstoned versions",
        },
        artifacts: {
          kinds: ARTIFACT_KINDS,
          kind_meaning: "manifest metadata only, never engine behavior",
          version:
            "content hash — sha256 of the bytes for a file, of the sorted (file hash, relative path) manifest for a directory",
          immutability: "a version never changes; a name's latest pointer moves",
          max_bytes: MAX_ARTIFACT_BYTES,
          stub_document:
            "artifacts/<name>.md in the vault, so every artifact is inside the document graph",
          urls: { latest: "/a/<name>/", immutable: "/a/<name>/v/<hash>/", document: "/d/<slug>" },
        },
        serving: {
          command: `agentwiki serve --port ${DEFAULT_PORT}`,
          host: "loopback only",
          execution: "none — static bytes and rendered markdown only",
          daemon:
            "agentwiki.server, a user launch agent installed by AgentStart; every other command still works with it stopped",
          document_port: DEFAULT_PORT,
          artifact_port: DEFAULT_ARTIFACT_PORT,
          artifact_isolation:
            "artifacts answer on their own origin, so their scripts can read neither /d/<slug> nor the network; /a/… on the document port redirects there",
        },
        /** Read off argv[0] before any command dispatch, so `agentwiki search
         * foo --agent-help` is a usage fault, not a runbook. */
        top_level_flags: [
          { flag: "--version, -V", meaning: "Print the version" },
          { flag: "--agent-help", meaning: "Agent runbook" },
          { flag: "--agent-teaser", meaning: "One-line capability summary" },
        ],
      },
      output_contract: {
        envelope: {
          schema_version: "number",
          ok: "boolean",
          error: "{code, message, recovery?} | null",
          data: "payload | null",
        },
        exit_codes: {
          "0": "success — an ok:true envelope on stdout under --json",
          "1": "domain failure — an ok:false envelope on stdout under --json",
          "2": "usage fault — help on stderr, never an envelope",
        },
      },
      error_codes: ERROR_CODES,
      read_only_commands: readOnlyCommands(COMMANDS),
      agent_defaults: [
        "Search or resolve before writing: the vault probably already says it.",
        "To change a document, take its path and edit the file — never round-trip the body through get and add.",
        "Never run git in the vault; every command commits and pushes on its way out.",
      ],
    },
    global_arguments: GLOBAL_ARGUMENTS,
    commands: COMMANDS,
  };
}

/** The flag grammar main.ts dispatches with is read off the contract, so an
 * argument exists in exactly one place. A group takes the union of its
 * subtree, because its handler parses the subcommand out of the positionals. */
export function flagNames(command: ContractCommand): { value: string[]; bool: string[] } {
  const value: string[] = [];
  const bool: string[] = [];
  for (const node of walkCommands([command])) {
    for (const argument of node.command.arguments ?? []) {
      if (argument.positional === true) continue;
      const into = argument.type === "boolean" ? bool : value;
      if (!into.includes(argument.name)) into.push(argument.name);
    }
  }
  return { value, bool };
}

export function findCommand(
  commands: readonly ContractCommand[],
  path: readonly string[],
): ContractCommand | undefined {
  let found: ContractCommand | undefined;
  let level: readonly ContractCommand[] = commands;
  for (const segment of path) {
    found = level.find((command) => command.name === segment);
    if (found === undefined) return undefined;
    level = found.subcommands ?? [];
  }
  return found;
}

export const CONTRACT_COMMANDS: readonly ContractCommand[] = COMMANDS;
