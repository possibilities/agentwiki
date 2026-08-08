import { describe, expect, test } from "bun:test";
import {
  documentTitle,
  editFrontmatter,
  frontmatterString,
  serializeDocument,
  splitDocument,
} from "../src/frontmatter.ts";

const DOCUMENT = `---
title: Bluetooth Q30 HFP trap
tags:
  - evidence
  - audio
custom_key: kept
---

# Bluetooth Q30 HFP trap

The mic flips the sink to HFP.
`;

describe("splitDocument", () => {
  test("separates frontmatter from body", () => {
    const split = splitDocument(DOCUMENT);
    expect(split.hasFrontmatter).toBe(true);
    expect(split.frontmatter["title"]).toBe("Bluetooth Q30 HFP trap");
    expect(split.frontmatter["tags"]).toEqual(["evidence", "audio"]);
    expect(split.body.startsWith("\n# Bluetooth")).toBe(true);
  });

  test("treats a file with no block as all body", () => {
    const split = splitDocument("# Just a heading\n");
    expect(split.hasFrontmatter).toBe(false);
    expect(split.frontmatter).toEqual({});
    expect(split.body).toBe("# Just a heading\n");
  });

  test("a --- rule further down is body, not a delimiter", () => {
    const split = splitDocument("intro\n\n---\n\nrest\n");
    expect(split.hasFrontmatter).toBe(false);
  });

  test("an unterminated block is not frontmatter", () => {
    const split = splitDocument("---\ntitle: x\n");
    expect(split.hasFrontmatter).toBe(false);
    expect(split.body).toBe("---\ntitle: x\n");
  });

  test("malformed yaml still yields a readable document", () => {
    const split = splitDocument("---\ntitle: [unclosed\n---\nbody\n");
    expect(split.hasFrontmatter).toBe(true);
    expect(split.frontmatter).toEqual({});
    expect(split.body).toBe("body\n");
  });
});

describe("serializeDocument", () => {
  test("round-trips through splitDocument", () => {
    const text = serializeDocument({ title: "A", tags: ["b"] }, "\nbody\n");
    const split = splitDocument(text);
    expect(split.frontmatter).toEqual({ title: "A", tags: ["b"] });
    expect(split.body).toBe("\nbody\n");
  });

  test("emits no block at all for empty frontmatter", () => {
    expect(serializeDocument({}, "body")).toBe("body");
  });
});

describe("editFrontmatter", () => {
  test("sets a key while preserving every other key and the body", () => {
    const edited = editFrontmatter(DOCUMENT, { deleted: "2026-08-08T00:00:00.000Z" });
    const split = splitDocument(edited);
    expect(split.frontmatter["deleted"]).toBe("2026-08-08T00:00:00.000Z");
    expect(split.frontmatter["custom_key"]).toBe("kept");
    expect(split.frontmatter["tags"]).toEqual(["evidence", "audio"]);
    expect(split.body).toBe(splitDocument(DOCUMENT).body);
  });

  test("undefined removes a key", () => {
    const stamped = editFrontmatter(DOCUMENT, { deleted: "now", deleted_reason: "why" });
    const lifted = editFrontmatter(stamped, { deleted: undefined, deleted_reason: undefined });
    const split = splitDocument(lifted);
    expect("deleted" in split.frontmatter).toBe(false);
    expect("deleted_reason" in split.frontmatter).toBe(false);
    expect(split.frontmatter["title"]).toBe("Bluetooth Q30 HFP trap");
  });

  test("adds a block to a document that had none", () => {
    const edited = editFrontmatter("# Heading\n", { title: "Heading" });
    expect(splitDocument(edited).frontmatter["title"]).toBe("Heading");
    expect(splitDocument(edited).body).toBe("# Heading\n");
  });

  test("keeps comments an agent wrote by hand", () => {
    const source = "---\n# why this exists\ntitle: X\n---\nbody\n";
    const edited = editFrontmatter(source, { updated: "2026-08-08" });
    expect(edited).toContain("# why this exists");
    expect(splitDocument(edited).frontmatter["updated"]).toBe("2026-08-08");
  });
});

describe("documentTitle", () => {
  test("prefers declared frontmatter", () => {
    expect(documentTitle({ title: "Declared" }, "# Heading", "slug")).toBe("Declared");
  });

  test("falls back to the first heading, then the given fallback", () => {
    expect(documentTitle({}, "\n## Heading here\n", "slug")).toBe("Heading here");
    expect(documentTitle({}, "no heading", "Fallback")).toBe("Fallback");
  });

  test("ignores an empty title string", () => {
    expect(documentTitle({ title: "  " }, "# Heading", "slug")).toBe("Heading");
  });
});

describe("frontmatterString", () => {
  test("coerces dates and numbers and rejects blanks", () => {
    expect(frontmatterString({ n: 3 }, "n")).toBe("3");
    expect(frontmatterString({ s: "  " }, "s")).toBeUndefined();
    expect(frontmatterString({}, "missing")).toBeUndefined();
  });
});
