import { describe, expect, test } from "bun:test";
import { CliError } from "../src/errors.ts";
import { buildLinkLookup, lookupLinkTarget, rankRefMatches, resolveRef } from "../src/resolve.ts";

const VAULT = [
  { slug: "bluetooth-q30-hfp-trap", title: "Bluetooth Q30 HFP trap" },
  { slug: "the-duplex-device", title: "The Duplex Device" },
  { slug: "duplex-device-probe", title: "Duplex device probe" },
  { slug: "release-notes", title: "Release notes" },
];

describe("resolveRef tiers", () => {
  test("an exact slug wins outright", () => {
    expect(resolveRef("release-notes", VAULT).slug).toBe("release-notes");
  });

  test("an exact title resolves", () => {
    expect(resolveRef("Bluetooth Q30 HFP trap", VAULT).slug).toBe("bluetooth-q30-hfp-trap");
  });

  test("case and leading articles are ignored", () => {
    expect(resolveRef("duplex device", VAULT).slug).toBe("the-duplex-device");
    expect(resolveRef("RELEASE NOTES", VAULT).slug).toBe("release-notes");
  });

  test("an unambiguous fuzzy phrase resolves", () => {
    expect(resolveRef("hfp trap", VAULT).slug).toBe("bluetooth-q30-hfp-trap");
  });

  test("spoken words resolve even with the middle of the title dropped", () => {
    expect(resolveRef("the bluetooth trap", VAULT).slug).toBe("bluetooth-q30-hfp-trap");
    expect(resolveRef("bluetooth trap", VAULT).slug).toBe("bluetooth-q30-hfp-trap");
  });

  test("words out of order do not resolve", () => {
    expect(() => resolveRef("trap bluetooth", VAULT)).toThrow(CliError);
  });

  test("a contiguous match outranks a scattered one", () => {
    const vault = [
      { slug: "release-notes", title: "Release notes" },
      { slug: "release-and-deploy-notes", title: "Release and deploy notes" },
    ];
    expect(resolveRef("release notes", vault).slug).toBe("release-notes");
  });

  test("an exact slug is never beaten by a fuzzy match on another document", () => {
    const vault = [
      { slug: "notes", title: "Notes" },
      { slug: "release-notes", title: "Release notes" },
    ];
    expect(resolveRef("notes", vault).slug).toBe("notes");
  });

  test("ambiguity names the candidates rather than guessing", () => {
    try {
      resolveRef("duplex", VAULT);
      throw new Error("expected ambiguity");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe("ambiguous_ref");
      expect((error as CliError).message).toContain("the-duplex-device");
      expect((error as CliError).message).toContain("duplex-device-probe");
      expect((error as CliError).recovery).toContain("agentwiki resolve");
    }
  });

  test("no match is a document_not_found with a search recovery", () => {
    try {
      resolveRef("nothing like this", VAULT);
      throw new Error("expected not found");
    } catch (error) {
      expect((error as CliError).code).toBe("document_not_found");
      expect((error as CliError).recovery).toContain("agentwiki search");
    }
  });
});

describe("rankRefMatches", () => {
  test("orders exact above normalized above fuzzy", () => {
    const matches = rankRefMatches("duplex device", VAULT);
    expect(matches[0]?.tier).toBe("normalized");
    expect(matches.map((match) => match.candidate.slug)).toContain("duplex-device-probe");
    expect(matches.at(-1)?.tier).toBe("fuzzy");
  });

  test("prefers the candidate with least slack inside a tier", () => {
    const matches = rankRefMatches("duplex", VAULT).filter((match) => match.tier === "fuzzy");
    expect(matches[0]?.candidate.slug).toBe("the-duplex-device");
  });

  test("returns nothing for a phrase with no searchable characters", () => {
    expect(rankRefMatches("!!!", VAULT)).toEqual([]);
  });
});

describe("link lookup", () => {
  const lookup = buildLinkLookup(VAULT);

  test("resolves by slug and by exact title", () => {
    expect(lookupLinkTarget(lookup, "release-notes")).toEqual({ slug: "release-notes" });
    expect(lookupLinkTarget(lookup, "Release notes")).toEqual({ slug: "release-notes" });
  });

  test("resolves normalized spellings", () => {
    expect(lookupLinkTarget(lookup, "Release Notes")).toEqual({ slug: "release-notes" });
  });

  test("never fuzzy-matches a written link", () => {
    expect(lookupLinkTarget(lookup, "release")).toBeNull();
  });

  test("reports ambiguity instead of picking", () => {
    const ambiguous = buildLinkLookup([
      { slug: "a-thing", title: "Shared" },
      { slug: "b-thing", title: "Shared" },
    ]);
    expect(lookupLinkTarget(ambiguous, "Shared")).toEqual({ ambiguous: ["a-thing", "b-thing"] });
  });
});
