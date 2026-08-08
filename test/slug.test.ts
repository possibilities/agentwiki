import { describe, expect, test } from "bun:test";
import { humanize, normalizeTags, parseTagList, slugify } from "../src/slug.ts";

describe("slugify", () => {
  test("kebab-cases a spoken title", () => {
    expect(slugify("Bluetooth Q30 HFP trap")).toBe("bluetooth-q30-hfp-trap");
  });

  test("folds accents so one document does not become two", () => {
    expect(slugify("Café notes")).toBe("cafe-notes");
  });

  test("drops apostrophes rather than turning them into separators", () => {
    expect(slugify("Mike's plan")).toBe("mikes-plan");
  });

  test("collapses punctuation runs and trims the edges", () => {
    expect(slugify("  ---hello,   world!!! ")).toBe("hello-world");
  });

  test("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });

  test("clips long titles at a word boundary", () => {
    const slug = slugify(`${"a".repeat(40)} ${"b".repeat(60)}`);
    expect(slug).toBe("a".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
  });

  test("is idempotent", () => {
    const once = slugify("Some Mixed Title — 2026");
    expect(slugify(once)).toBe(once);
  });
});

describe("humanize", () => {
  test("turns a slug back into a readable fallback title", () => {
    expect(humanize("bluetooth-q30-hfp-trap")).toBe("Bluetooth Q30 Hfp Trap");
  });

  test("survives an empty slug", () => {
    expect(humanize("")).toBe("Untitled");
  });
});

describe("tags", () => {
  test("splits, slugs, dedupes and sorts a flag list", () => {
    expect(parseTagList("Audio, evidence,audio")).toEqual(["audio", "evidence"]);
  });

  test("accepts frontmatter arrays and comma strings alike", () => {
    expect(normalizeTags(["Voice", "voice", "Q30"])).toEqual(["q30", "voice"]);
    expect(normalizeTags("voice,q30")).toEqual(["q30", "voice"]);
  });

  test("ignores non-string entries and empty input", () => {
    expect(normalizeTags([null, undefined, {}, "ok"])).toEqual(["ok"]);
    expect(parseTagList(undefined)).toEqual([]);
  });
});
