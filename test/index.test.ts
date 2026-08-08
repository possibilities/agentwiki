import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "../src/errors.ts";
import { toFtsQuery, VaultIndex } from "../src/index.ts";

const vaults: string[] = [];

function vault(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "agentwiki-vault-"));
  vaults.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

afterEach(() => {
  while (vaults.length > 0) rmSync(vaults.pop()!, { recursive: true, force: true });
});

const NOTE = `---
title: Bluetooth Q30 HFP trap
tags: [evidence, audio]
---

The sink flips to HFP. See [[Duplex Device]].
`;

const DEVICE = `---
title: Duplex Device
tags: [audio]
---

A native duplex audio device.
`;

describe("reconcile", () => {
  test("indexes markdown with its frontmatter, tags and links", () => {
    const root = vault({ "trap.md": NOTE, "duplex.md": DEVICE });
    const index = VaultIndex.open(root);
    try {
      const report = index.reconcile();
      expect(report.scanned).toBe(2);
      expect(report.indexed).toBe(2);
      const documents = index.documents();
      expect(documents.map((document) => document.slug).sort()).toEqual(["duplex", "trap"]);
      const trap = documents.find((document) => document.slug === "trap")!;
      expect(trap.title).toBe("Bluetooth Q30 HFP trap");
      expect(trap.tags).toEqual(["audio", "evidence"]);
      expect(index.links().map((link) => link.target)).toEqual(["Duplex Device"]);
    } finally {
      index.close();
    }
  });

  test("reparses only what changed on disk", () => {
    const root = vault({ "a.md": "# A\n", "b.md": "# B\n" });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      expect(index.reconcile().indexed).toBe(0);
      const path = join(root, "a.md");
      writeFileSync(path, "# A changed and longer\n");
      expect(index.reconcile().indexed).toBe(1);
      expect(index.documents().find((document) => document.slug === "a")!.title).toBe(
        "A changed and longer",
      );
    } finally {
      index.close();
    }
  });

  test("a file deleted outside agentwiki leaves the index", () => {
    const root = vault({ "a.md": "# A\n", "b.md": "# B\n" });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      unlinkSync(join(root, "b.md"));
      expect(index.reconcile().removed).toBe(1);
      expect(index.documents().map((document) => document.slug)).toEqual(["a"]);
    } finally {
      index.close();
    }
  });

  test("dot directories and binaries never enter the index", () => {
    const root = vault({ "keep.md": "# Keep\n", ".agentwiki/notes.md": "# Hidden\n" });
    writeFileSync(join(root, "shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(root, "opaque.dat"), Buffer.from([0x01, 0x00, 0x02]));
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      expect(index.documents().map((document) => document.slug)).toEqual(["keep"]);
    } finally {
      index.close();
    }
  });

  test("non-markdown text is indexed for search but carries no frontmatter", () => {
    const root = vault({ "log.txt": "the sink flipped at 12:04\n" });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      const document = index.documents()[0]!;
      expect(document.markdown).toBe(false);
      expect(document.frontmatter).toEqual({});
      expect(index.search({ query: "flipped", limit: 5 })).toHaveLength(1);
    } finally {
      index.close();
    }
  });
});

describe("tombstones", () => {
  test("are excluded from every read but survive with includeDeleted", () => {
    const root = vault({
      "gone.md":
        "---\ntitle: Gone\ndeleted: 2026-08-08T00:00:00.000Z\ndeleted_reason: superseded\n---\n\nbody text\n",
      "here.md": "---\ntitle: Here\n---\n\nbody text\n",
    });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      expect(index.documents().map((document) => document.slug)).toEqual(["here"]);
      expect(index.search({ query: "body", limit: 10 }).map((hit) => hit.slug)).toEqual(["here"]);
      expect(index.tagCounts()).toEqual([]);
      const all = index.documents({ includeDeleted: true });
      expect(all).toHaveLength(2);
      expect(all.find((document) => document.slug === "gone")!.deletedReason).toBe("superseded");
      expect(index.counts()).toEqual({ documents: 1, tombstoned: 1, links: 0 });
    } finally {
      index.close();
    }
  });
});

describe("search", () => {
  test("ranks hits and returns a snippet", () => {
    const root = vault({ "trap.md": NOTE, "duplex.md": DEVICE });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      const hits = index.search({ query: "duplex", limit: 10 });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.snippet).toContain("[");
    } finally {
      index.close();
    }
  });

  test("filters by tag", () => {
    const root = vault({ "trap.md": NOTE, "duplex.md": DEVICE });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      // "audio" reaches the trap through its tags column and the device
      // through its body; the tag narrows that to one.
      expect(index.search({ query: "audio", limit: 10 })).toHaveLength(2);
      const filtered = index.search({ query: "audio", tag: "evidence", limit: 10 });
      expect(filtered.map((hit) => hit.slug)).toEqual(["trap"]);
    } finally {
      index.close();
    }
  });

  test("a query with no searchable term is a coded error", () => {
    const root = vault({ "a.md": "# A\n" });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      expect(() => index.search({ query: "!!!", limit: 5 })).toThrow(CliError);
    } finally {
      index.close();
    }
  });
});

describe("toFtsQuery", () => {
  test("quotes every term so punctuation searches instead of failing", () => {
    expect(toFtsQuery("mike's q30-trap")).toBe('"mike\'s" "q30-trap"');
  });

  test("keeps a trailing star as a prefix search", () => {
    expect(toFtsQuery("blue*")).toBe('"blue"*');
  });

  test("returns null when nothing is searchable", () => {
    expect(toFtsQuery("  !!!  ")).toBeNull();
  });
});

describe("rebuild", () => {
  test("reproduces the same documents a losable index held", () => {
    const root = vault({ "trap.md": NOTE, "duplex.md": DEVICE });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      const before = index.documents().map((document) => document.slug);
      index.rebuild();
      expect(index.documents().map((document) => document.slug)).toEqual(before);
    } finally {
      index.close();
    }
  });

  test("deleting the database file loses nothing", () => {
    const root = vault({ "trap.md": NOTE });
    const first = VaultIndex.open(root);
    first.reconcile();
    first.close();
    rmSync(join(root, ".agentwiki"), { recursive: true, force: true });
    const second = VaultIndex.open(root);
    try {
      second.reconcile();
      expect(second.documents()).toHaveLength(1);
    } finally {
      second.close();
    }
  });
});

describe("duplicate slugs", () => {
  test("are reported rather than silently collapsed", () => {
    const root = vault({ "trap.md": "# Trap\n", "nested/trap.md": "# Trap again\n" });
    const index = VaultIndex.open(root);
    try {
      index.reconcile();
      const duplicates = index.duplicateSlugs();
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]!.slug).toBe("trap");
      expect(duplicates[0]!.paths.sort()).toEqual(["nested/trap.md", "trap.md"]);
    } finally {
      index.close();
    }
  });
});

describe("schema guard", () => {
  test("refuses an index written by a newer build", () => {
    const root = vault({ "a.md": "# A\n" });
    const index = VaultIndex.open(root);
    index.reconcile();
    index.close();
    const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
    const db = new Database(join(root, ".agentwiki", "index.sqlite3"));
    db.run("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    try {
      VaultIndex.open(root);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as CliError).code).toBe("unsupported_schema_version");
    }
  });
});
