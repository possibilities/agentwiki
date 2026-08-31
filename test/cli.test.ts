import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The envelope contract is a promise to agents, so it is exercised through
 * the real binary rather than by calling handlers directly. */
const ENTRY = join(import.meta.dir, "..", "src", "main.ts");

let sandbox: string;
let home: string;
let vault: string;

function run(args: string[], stdin?: string): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: ["bun", ENTRY, ...args],
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_STATE_HOME: join(sandbox, "state"),
      AGENTWIKI_VAULT: vault,
      AGENTWIKI_CREATOR: "test-agent",
    },
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin, "utf8"),
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function envelope(args: string[], stdin?: string): { status: number; body: any } {
  const result = run(args, stdin);
  return { status: result.status, body: JSON.parse(result.stdout) };
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "agentwiki-cli-"));
  home = join(sandbox, "home");
  vault = join(sandbox, "vault");
  mkdirSync(home, { recursive: true });
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("the output contract", () => {
  test("a success is an ok:true envelope with a schema version", () => {
    const { status, body } = envelope([
      "new",
      "Bluetooth Q30 HFP trap",
      "--tags",
      "evidence,audio",
      "--json",
    ]);
    expect(status).toBe(0);
    expect(body).toMatchObject({ schema_version: 1, ok: true, error: null });
    expect(body.data.slug).toBe("bluetooth-q30-hfp-trap");
    expect(body.data.tags).toEqual(["audio", "evidence"]);
  });

  test("a domain failure is an ok:false envelope on stdout with exit 1", () => {
    const { status, body } = envelope(["get", "no-such-document", "--json"]);
    expect(status).toBe(1);
    expect(body.ok).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("document_not_found");
    expect(body.error.recovery).toContain("agentwiki search");
  });

  test("a usage fault prints help to stderr, exits 2, and is never an envelope", () => {
    const missing = run(["get"]);
    expect(missing.status).toBe(2);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("agentwiki get");

    const unknown = run(["list", "--nope"]);
    expect(unknown.status).toBe(2);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toContain('unknown option "--nope"');
  });

  test("an ambiguous ref names its candidates", () => {
    run(["new", "Duplex device probe", "--json"]);
    run(["new", "Duplex device notes", "--json"]);
    const { status, body } = envelope(["get", "duplex device", "--json"]);
    expect(status).toBe(1);
    expect(body.error.code).toBe("ambiguous_ref");
    expect(body.error.message).toContain("duplex-device-probe");
    expect(body.error.message).toContain("duplex-device-notes");
  });

  test("--jsonl emits one record per line, not an envelope", () => {
    const result = run(["list", "--jsonl"]);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(typeof JSON.parse(line).slug).toBe("string");
  });

  test("human output is plain text with no envelope", () => {
    const result = run(["path", "bluetooth-q30-hfp-trap"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(join(vault, "bluetooth-q30-hfp-trap.md"));
  });
});

describe("capture and read", () => {
  test("add reads stdin and never fails on a slug clash", () => {
    const first = envelope(["add", "--title", "Capture", "--json"], "# Capture\n\nfirst\n");
    expect(first.body.data.slug).toBe("capture");
    const second = envelope(["add", "--title", "Capture", "--json"], "# Capture\n\nsecond\n");
    expect(second.body.data.slug).toBe("capture-2");
  });

  test("add takes the body inline, for a caller that has no pipe", () => {
    const added = envelope([
      "add",
      "--content",
      "# Inline\n\nbody from argv\n",
      "--title",
      "Inline capture",
      "--json",
    ]);
    expect(added.status).toBe(0);
    expect(added.body.data.slug).toBe("inline-capture");
    expect(envelope(["get", "inline-capture", "--json"]).body.data.content).toContain(
      "body from argv",
    );
    const both = run(["add", "--content", "x", "somefile.md", "--json"]);
    expect(both.status).toBe(2);
    expect(both.stderr).toContain("not both");
  });

  test("get returns the body and the frontmatter, and --meta-only drops the body", () => {
    const full = envelope(["get", "capture", "--json"]);
    expect(full.body.data.content).toContain("first");
    expect(full.body.data.frontmatter.title).toBe("Capture");
    const meta = envelope(["get", "capture", "--meta-only", "--json"]);
    expect("content" in meta.body.data).toBe(false);
  });

  test("an edit made directly to the file is visible to the next command", () => {
    const path = join(vault, "capture.md");
    writeFileSync(path, "---\ntitle: Capture\ntags: [edited]\n---\n\nrewritten by hand\n");
    const hit = envelope(["search", "rewritten", "--json"]);
    expect(hit.body.data.hits[0].slug).toBe("capture");
    expect(envelope(["get", "capture", "--json"]).body.data.tags).toEqual(["edited"]);
  });

  test("deleting the index loses nothing", () => {
    const before = envelope(["list", "--json"]).body.data.count;
    rmSync(join(vault, ".agentwiki", "index.sqlite3"), { force: true });
    rmSync(join(vault, ".agentwiki", "index.sqlite3-wal"), { force: true });
    rmSync(join(vault, ".agentwiki", "index.sqlite3-shm"), { force: true });
    expect(envelope(["list", "--json"]).body.data.count).toBe(before);
  });
});

describe("tombstones", () => {
  test("rm hides a document, leaves the file, and restore brings it back", () => {
    const removed = envelope(["rm", "capture-2", "--reason", "duplicate of capture", "--json"]);
    expect(removed.status).toBe(0);
    expect(removed.body.data.reason).toBe("duplicate of capture");
    const listed = envelope(["list", "--json"]).body.data.documents.map((row: any) => row.slug);
    expect(listed).not.toContain("capture-2");
    expect(Bun.file(join(vault, "capture-2.md")).size).toBeGreaterThan(0);

    const restored = envelope(["restore", "capture-2", "--json"]);
    expect(restored.status).toBe(0);
    expect(envelope(["list", "--json"]).body.data.documents.map((row: any) => row.slug)).toContain(
      "capture-2",
    );
  });

  test("rm without a reason is a usage fault", () => {
    const result = run(["rm", "capture", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });
});

describe("artifacts", () => {
  test("publish is content addressed and republishing identical bytes changes nothing", () => {
    const file = join(sandbox, "report.html");
    writeFileSync(file, "<h1>probe</h1>");
    const first = envelope(["publish", file, "--name", "probe-report", "--json"]);
    expect(first.status).toBe(0);
    expect(first.body.data.status).toBe("created");
    expect(first.body.data.kind).toBe("page");
    expect(first.body.data.version).toMatch(/^[0-9a-f]{64}$/);
    expect(first.body.data.url).toBe("/a/probe-report/");
    expect(first.body.data.version_url).toBe(`/a/probe-report/v/${first.body.data.version}/`);
    expect(first.body.data.creator).toBe("test-agent");

    const again = envelope(["publish", file, "--name", "probe-report", "--json"]);
    expect(again.body.data.status).toBe("unchanged");
    expect(again.body.data.version).toBe(first.body.data.version);
  });

  test("publish writes a stub document into the graph", () => {
    const stub = envelope(["get", "probe-report", "--json"]);
    expect(stub.body.data.tags).toContain("artifact");
    expect(stub.body.data.frontmatter.artifact).toBe("probe-report");
    expect(envelope(["list", "--tag", "artifact", "--json"]).body.data.count).toBe(1);
  });

  test("a changed file publishes a new version and moves the latest pointer", () => {
    const file = join(sandbox, "report.html");
    writeFileSync(file, "<h1>probe v2</h1>");
    const second = envelope(["publish", file, "--name", "probe-report", "--json"]);
    expect(second.body.data.status).toBe("created");
    const versions = envelope(["artifacts", "versions", "probe-report", "--json"]).body.data
      .versions;
    expect(versions).toHaveLength(2);
    expect(versions.filter((row: any) => row.latest)).toHaveLength(1);
    expect(versions.find((row: any) => row.latest).version).toBe(second.body.data.version);
  });

  test("a directory publishes as a bundle with an entry point", () => {
    const directory = join(sandbox, "dist");
    mkdirSync(join(directory, "assets"), { recursive: true });
    writeFileSync(join(directory, "index.html"), "<h1>bundle</h1>");
    writeFileSync(join(directory, "assets", "app.css"), "body{}");
    const published = envelope(["publish", directory, "--name", "probe-bundle", "--json"]);
    expect(published.body.data.kind).toBe("bundle");
    expect(published.body.data.entry).toBe("index.html");
    expect(published.body.data.files).toBe(2);
  });

  test("tombstoning takes the stub with it and keeps the bytes until gc", () => {
    expect(envelope(["list", "--json"]).body.data.documents.map((row: any) => row.slug)).toContain(
      "probe-bundle",
    );
    const removed = envelope([
      "artifacts",
      "rm",
      "probe-bundle",
      "--reason",
      "wrong build",
      "--json",
    ]);
    expect(removed.status).toBe(0);
    expect(removed.body.data.stub).toContain("probe-bundle.md");
    expect(
      envelope(["artifacts", "list", "--json"]).body.data.artifacts.map((row: any) => row.name),
    ).toEqual(["probe-report"]);
    // A stub must not outlive its artifact as a live document promising a URL
    // that now 404s, so doctor stays clean instead of growing a finding.
    expect(
      envelope(["list", "--json"]).body.data.documents.map((row: any) => row.slug),
    ).not.toContain("probe-bundle");
    expect(envelope(["doctor", "--json"]).body.data.broken_artifact_stubs).toEqual([]);
    const collected = envelope(["gc", "--json"]);
    expect(collected.status).toBe(0);
    expect(collected.body.data.reclaimed.map((row: any) => row.name)).toContain("probe-bundle");
    expect(collected.body.data.bytes).toBeGreaterThan(0);
  });

  test("open refuses with a recovery when nothing is serving", () => {
    const { status, body } = envelope(["open", "probe-report", "--port", "7", "--json"]);
    expect(status).toBe(1);
    expect(body.error.code).toBe("server_not_running");
    expect(body.error.recovery).toContain("agentwiki serve");
  });
});

describe("the agent surface", () => {
  test("the teaser is one line", () => {
    const result = run(["--agent-teaser"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
  });

  test("the runbook leads with reading and ends with the contract", () => {
    const result = run(["--agent-help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Reading (safe anytime)");
    expect(result.stdout.indexOf("Reading")).toBeLessThan(result.stdout.indexOf("Writing"));
    // The contract section is rendered from concepts.output_contract, so the
    // exit codes an agent relies on are printed rather than restated.
    expect(result.stdout).toContain("exit 2");
    expect(result.stdout).toContain("usage fault");
  });

  test("the runbook points at the wiki skill as the deeper runbook", () => {
    const result = run(["--agent-help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("the wiki agent skill");
    expect(result.stdout).toContain("in-binary fallback");
  });

  test("command help renders the contract's worked invocations", () => {
    const result = run(["help", "publish"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("agentwiki publish ./dist --name q30-probe");
    // The inferred kind is a fact of the CLI the hand-written help carried, and
    // it lives in the contract now rather than in a second authorship.
    expect(result.stdout).toContain("a directory is a bundle");
  });

  test("command help shows the bounds and the blocking warning it is given", () => {
    const serve = run(["help", "serve"]);
    expect(serve.status).toBe(0);
    expect(serve.stdout).toContain("Blocks:");
    expect(serve.stdout).toContain("1..65535");

    const list = run(["help", "list"]);
    expect(list.stdout).toContain("minimum 1");
  });

  test("the guide is the agent contract, and names the storage it uses", () => {
    const { status, body } = envelope(["guide", "--json"]);
    expect(status).toBe(0);
    expect(body.data.contract_version).toBe(1);
    expect(body.data.meta.name).toBe("agentwiki");
    expect(body.data.concepts.model.storage.vault).toBe(vault);
    expect(body.data.concepts.output_contract.exit_codes["2"]).toContain("usage fault");
    expect(body.data.commands.length).toBeGreaterThan(15);
    expect(body.data.concepts.read_only_commands).toContain("artifacts list");
  });

  test("doctor reports a dangling link it can see", () => {
    writeFileSync(
      join(vault, "dangler.md"),
      "---\ntitle: Dangler\n---\n\npoints at [[nowhere-at-all]]\n",
    );
    const { status, body } = envelope(["doctor", "--json"]);
    expect(status).toBe(0);
    expect(body.data.dangling).toContainEqual({
      from: "dangler",
      target: "nowhere-at-all",
      reason: "unresolved",
      candidates: [],
    });
    expect(body.data.healthy).toBe(false);
  });

  test("graph exports absolute paths, like every other command", () => {
    const { status, body } = envelope(["graph", "--json"]);
    expect(status).toBe(0);
    expect(body.data.nodes.length).toBeGreaterThan(0);
    for (const node of body.data.nodes) expect(node.path.startsWith(vault)).toBe(true);
  });

  test("resolve is data, never an error, even for a phrase that matches nothing", () => {
    const { status, body } = envelope(["resolve", "absolutely nothing like this", "--json"]);
    expect(status).toBe(0);
    expect(body.ok).toBe(true);
    expect(body.data.candidates).toEqual([]);
  });
});

describe("the vault records itself", () => {
  function log(args: string[]): string {
    const result = Bun.spawnSync({ cmd: ["git", "-C", vault, ...args] });
    return result.stdout.toString().trim();
  }

  test("a write makes the vault a repository and commits what it wrote", () => {
    expect(run(["new", "Committed On Write"]).status).toBe(0);
    expect(log(["rev-parse", "--is-inside-work-tree"])).toBe("true");
    expect(log(["ls-files"])).toContain("committed-on-write.md");
  });

  // The headline behavior: agents edit vault files with their own tools, so a
  // change agentwiki never saw still has to reach the history.
  test("a file edited directly is committed by the very next command", () => {
    run(["new", "Edited Behind Our Back"]);
    writeFileSync(
      join(vault, "edited-behind-our-back.md"),
      "# Edited behind our back\n\nnew body\n",
    );
    expect(log(["status", "--porcelain"])).not.toBe("");
    run(["get", "edited-behind-our-back", "--json"]);
    expect(log(["status", "--porcelain"])).toBe("");
    expect(log(["log", "-1", "--format=%s"])).toBe("M edited-behind-our-back.md");
  });

  test("the derived index never enters the history", () => {
    run(["search", "anything", "--json"]);
    expect(log(["ls-files"])).not.toContain("index.sqlite3");
    expect(log(["status", "--porcelain"])).toBe("");
  });

  test("commit is the explicit form and takes a message of its own", () => {
    writeFileSync(join(vault, "explicitly-committed.md"), "# Explicitly committed\n");
    const { status, body } = envelope([
      "commit",
      "--message",
      "Record the duplex decision",
      "--json",
    ]);
    expect(status).toBe(0);
    expect(body.data.committed).toBe(true);
    expect(log(["log", "-1", "--format=%s"])).toBe("Record the duplex decision");
  });

  test("commit reports honestly when there is nothing to record", () => {
    const { body } = envelope(["commit", "--json"]);
    expect(body.data.committed).toBe(false);
    expect(body.data.repo).toBe(true);
  });
});
