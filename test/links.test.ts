import { describe, expect, test } from "bun:test";
import { extractWikilinks, findMentions, mentionHaystack, stripCode } from "../src/links.ts";

describe("extractWikilinks", () => {
  test("reads plain and aliased targets", () => {
    expect(extractWikilinks("see [[bluetooth-q30]] and [[Duplex Device|the device]]")).toEqual([
      { target: "bluetooth-q30" },
      { target: "Duplex Device", alias: "the device" },
    ]);
  });

  test("trims targets and drops empty ones", () => {
    expect(extractWikilinks("[[  spaced  ]] [[]] [[ | alias ]]")).toEqual([{ target: "spaced" }]);
  });

  test("dedupes an identical link written twice", () => {
    expect(extractWikilinks("[[a]] then [[a]]")).toEqual([{ target: "a" }]);
  });

  test("ignores links inside fenced and inline code", () => {
    const body = "real [[kept]]\n\n```\n[[fenced]]\n```\n\nand `[[inline]]` too";
    expect(extractWikilinks(body)).toEqual([{ target: "kept" }]);
  });
});

describe("stripCode", () => {
  test("blanks code without moving anything else", () => {
    const body = "a\n```\nxx\n```\nb";
    const stripped = stripCode(body);
    expect(stripped.length).toBe(body.length);
    expect(stripped).toContain("a\n");
    expect(stripped).not.toContain("xx");
  });
});

describe("findMentions", () => {
  const candidates = [
    { slug: "duplex-device", title: "Duplex Device" },
    { slug: "bluetooth-q30", title: "Bluetooth Q30" },
    { slug: "log", title: "Log" },
  ];

  test("matches a title verbatim, case-insensitively", () => {
    expect(findMentions("we shipped the duplex device today", candidates, "notes")).toEqual([
      "duplex-device",
    ]);
  });

  test("requires word boundaries", () => {
    expect(findMentions("duplex devices everywhere", candidates, "notes")).toEqual([]);
  });

  test("never mentions itself", () => {
    expect(findMentions("Duplex Device", candidates, "duplex-device")).toEqual([]);
  });

  test("ignores titles too short to be signal", () => {
    expect(findMentions("check the log", candidates, "notes")).toEqual([]);
  });

  test("the haystack excludes explicit links so they are not double counted", () => {
    const body = "[[Duplex Device]] and Bluetooth Q30";
    expect(findMentions(mentionHaystack(body), candidates, "notes")).toEqual(["bluetooth-q30"]);
  });
});
