import { ARTIFACT_KINDS, MAX_ARTIFACT_BYTES } from "./artifacts.ts";
import { VERSION } from "./help.ts";
import { INDEX_SCHEMA_VERSION } from "./index.ts";
import { MIN_MENTION_LENGTH } from "./links.ts";
import { DEFAULT_PORT } from "./urls.ts";
import { DEFAULT_VAULT } from "./vault.ts";

/** The card an agent reads once, before it knows anything else. Stable shape:
 * fields may be added, never renamed or removed without a schema bump. */
export function buildGuide(vaultRoot: string, artifactHome: string): unknown {
  return {
    name: "agentwiki",
    version: VERSION,
    purpose:
      "Agent-first document store: a vault of plain text files that is the source of truth, a derived full-text index, a wikilink graph, and immutable content-addressed artifacts served statically on demand.",
    storage: {
      vault: vaultRoot,
      vault_default: DEFAULT_VAULT,
      vault_override: "--vault <path> or AGENTWIKI_VAULT",
      index: `${vaultRoot}/.agentwiki/index.sqlite3`,
      index_schema_version: INDEX_SCHEMA_VERSION,
      templates: `${vaultRoot}/.agentwiki/templates/`,
      artifact_store: artifactHome,
      artifact_content: `${artifactHome}/cas/`,
      artifact_manifest: `${artifactHome}/manifest.sqlite3`,
      authority:
        "Files are truth and the index is derived: deleting the index loses nothing and reindex rebuilds it. The artifact manifest is authoritative and cannot be rebuilt from the vault.",
    },
    addressing: {
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
      urls: {
        latest: "/a/<name>/",
        immutable: "/a/<name>/v/<hash>/",
        document: "/d/<slug>",
      },
    },
    serving: {
      command: `agentwiki serve --port ${DEFAULT_PORT}`,
      host: "loopback only",
      execution: "none — static bytes and rendered markdown only",
      daemon: "no; every other command works without the server",
    },
    global_flags: [
      {
        flag: "--vault <path>",
        meaning: `Vault directory (default ${DEFAULT_VAULT}; env AGENTWIKI_VAULT)`,
      },
      { flag: "--json", meaning: "Emit the stable JSON envelope" },
      {
        flag: "--jsonl",
        meaning: "Emit newline-delimited records (list, search, resolve, artifacts list)",
      },
      { flag: "--agent-help", meaning: "Agent runbook" },
      { flag: "--agent-teaser", meaning: "One-line capability summary" },
    ],
    output_contract: {
      envelope: {
        schema_version: 1,
        ok: "boolean",
        error: "{code, message, recovery?} | null",
        data: "T | null",
      },
      domain_failure: "ok:false envelope on stdout, exit 1",
      usage_fault: "help on stderr, exit 2, never an envelope",
      error_codes: "snake_case, with a recovery where one is actionable",
    },
    commands: [
      {
        name: "new",
        usage: "new <title> [--tags a,b] [--template name]",
        effect: "creates <vault>/<slug>.md",
      },
      {
        name: "add",
        usage: "add [file] [--title t] [--tags a,b]",
        effect: "captures a file or stdin; slug slides on clash",
      },
      { name: "get", usage: "get <ref> [--meta-only]", effect: "reads the vault file" },
      { name: "path", usage: "path <ref>", effect: "absolute path for direct editing" },
      { name: "list", usage: "list [--tag t] [--limit n]", effect: "read-only" },
      { name: "search", usage: "search <query> [--tag t] [--limit n]", effect: "read-only FTS5" },
      { name: "tags", usage: "tags", effect: "read-only" },
      {
        name: "resolve",
        usage: "resolve <phrase> [--limit n]",
        effect: "read-only; never errors on no match",
      },
      { name: "links", usage: "links <ref>", effect: "read-only" },
      { name: "backlinks", usage: "backlinks <ref>", effect: "read-only" },
      { name: "graph", usage: "graph", effect: "read-only full node/edge export" },
      { name: "doctor", usage: "doctor", effect: "read-only health report" },
      { name: "reindex", usage: "reindex", effect: "rebuilds the derived index only" },
      { name: "rm", usage: "rm <ref> --reason <why>", effect: "tombstones; the file stays" },
      { name: "restore", usage: "restore <ref>", effect: "lifts a tombstone" },
      {
        name: "publish",
        usage: "publish <path> --name n [--kind k] [--title t] [--tag a,b]",
        effect: "writes CAS bytes, a manifest row, and a stub document",
      },
      {
        name: "artifacts",
        usage: "artifacts <list|versions|show|rm|restore> [name]",
        effect: "manifest reads; rm and restore are tombstone moves",
      },
      {
        name: "open",
        usage: "open <name> [--port n]",
        effect: "launches a browser; requires serve",
      },
      { name: "gc", usage: "gc", effect: "deletes tombstoned artifact bytes" },
      { name: "serve", usage: "serve [--port n]", effect: "blocks; localhost static server" },
      { name: "guide", usage: "guide --json", effect: "this card" },
    ],
  };
}
