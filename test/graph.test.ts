import { describe, expect, test } from "bun:test";
import type { GraphDocument } from "../src/graph.ts";
import { buildGraph, edgesFrom, edgesTo, orphanSlugs } from "../src/graph.ts";

function document(id: number, slug: string, title: string, body: string): GraphDocument {
  return { id, slug, title, path: `${slug}.md`, tags: [], body };
}

describe("buildGraph", () => {
  const documents = [
    document(1, "duplex-device", "Duplex Device", "the device itself"),
    document(2, "probe-run", "Probe run", "see [[duplex-device]] for context"),
    document(3, "field-notes", "Field notes", "the Duplex Device flipped to HFP"),
    document(4, "loner", "Loner", "nothing points here"),
  ];
  const links = [
    { sourceId: 2, target: "duplex-device" },
    { sourceId: 2, target: "no-such-doc" },
  ];

  test("wikilinks become wikilink edges", () => {
    const snapshot = buildGraph(documents, links);
    expect(snapshot.edges).toContainEqual({
      from: "probe-run",
      to: "duplex-device",
      kind: "wikilink",
    });
  });

  test("a title appearing in another body becomes a mention edge", () => {
    const snapshot = buildGraph(documents, links);
    expect(snapshot.edges).toContainEqual({
      from: "field-notes",
      to: "duplex-device",
      kind: "mention",
    });
  });

  test("an explicit link suppresses the duplicate mention edge", () => {
    const snapshot = buildGraph(documents, links);
    const pair = snapshot.edges.filter(
      (edge) => edge.from === "probe-run" && edge.to === "duplex-device",
    );
    expect(pair).toEqual([{ from: "probe-run", to: "duplex-device", kind: "wikilink" }]);
  });

  test("an unresolved target is dangling, not an edge", () => {
    const snapshot = buildGraph(documents, links);
    expect(snapshot.dangling).toContainEqual({
      from: "probe-run",
      target: "no-such-doc",
      reason: "unresolved",
      candidates: [],
    });
    expect(snapshot.edges.some((edge) => edge.to === "no-such-doc")).toBe(false);
  });

  test("a target matching two documents is reported as ambiguous", () => {
    const ambiguous = [
      document(1, "a-shared", "Shared", ""),
      document(2, "b-shared", "Shared", ""),
      document(3, "source", "Source", "[[Shared]]"),
    ];
    const snapshot = buildGraph(ambiguous, [{ sourceId: 3, target: "Shared" }]);
    expect(snapshot.dangling).toEqual([
      {
        from: "source",
        target: "Shared",
        reason: "ambiguous",
        candidates: ["a-shared", "b-shared"],
      },
    ]);
  });

  test("self-links never become edges", () => {
    const snapshot = buildGraph(
      [document(1, "self", "Self ref", "[[self]]")],
      [{ sourceId: 1, target: "self" }],
    );
    expect(snapshot.edges).toEqual([]);
  });

  test("nodes are every live document, sorted", () => {
    const snapshot = buildGraph(documents, links);
    expect(snapshot.nodes.map((node) => node.slug)).toEqual([
      "duplex-device",
      "field-notes",
      "loner",
      "probe-run",
    ]);
  });

  test("edges are deterministic across two identical builds", () => {
    expect(buildGraph(documents, links).edges).toEqual(buildGraph(documents, links).edges);
  });
});

describe("graph queries", () => {
  const documents = [
    document(1, "a", "Alpha doc", ""),
    document(2, "b", "Bravo doc", "[[a]]"),
    document(3, "c", "Charlie doc", ""),
  ];
  const snapshot = buildGraph(documents, [{ sourceId: 2, target: "a" }]);

  test("edgesFrom and edgesTo are complements", () => {
    expect(edgesFrom(snapshot, "b")).toEqual([{ from: "b", to: "a", kind: "wikilink" }]);
    expect(edgesTo(snapshot, "a")).toEqual([{ from: "b", to: "a", kind: "wikilink" }]);
  });

  test("orphans are the documents with no edge in either direction", () => {
    expect(orphanSlugs(snapshot)).toEqual(["c"]);
  });
});
