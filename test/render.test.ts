import { describe, expect, test } from "bun:test";
import { escapeHtml, renderMarkdown } from "../src/render.ts";

describe("escapeHtml", () => {
  const cases: Array<[name: string, input: string, expected: string]> = [
    ["leaves ordinary prose alone", "the bluetooth trap", "the bluetooth trap"],
    ["escapes tag delimiters", "<script>", "&lt;script&gt;"],
    ["escapes both quote styles", `a "b" 'c'`, "a &quot;b&quot; &#39;c&#39;"],
    ["escapes the ampersand", "a & b", "a &amp; b"],
    ["escapes the ampersand first, so entities are inert", "&lt;", "&amp;lt;"],
    ["neutralizes an attribute break-out", `" onerror="x`, "&quot; onerror=&quot;x"],
    ["is a no-op on the empty string", "", ""],
  ];

  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(escapeHtml(input)).toBe(expected);
    });
  }
});

const never = (): null => null;
const always = (href: string) => (): string => href;

describe("renderMarkdown", () => {
  test("rewrites a resolved wikilink to an anchor", () => {
    expect(renderMarkdown("see [[q30]]", always("/d/q30"))).toContain('href="/d/q30"');
  });

  test("uses the alias as the link text", () => {
    const html = renderMarkdown("see [[q30|the trap]]", always("/d/q30"));
    expect(html).toContain(">the trap<");
    expect(html).not.toContain("q30<");
  });

  test("marks an unresolved target dangling instead of linking it", () => {
    const html = renderMarkdown("see [[missing]]", never);
    expect(html).toContain('<span class="dangling">missing</span>');
    expect(html).not.toContain("<a ");
  });

  test("escapes a dangling target rather than emitting its markup", () => {
    const html = renderMarkdown("see [[<img src=x onerror=alert(1)>]]", never);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });

  test("drops raw HTML in the body — markdown-it runs with html:false", () => {
    const html = renderMarkdown("<script>alert(1)</script>", never);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("leaves a wikilink inside code as prose", () => {
    const html = renderMarkdown("`[[q30]]`", always("/d/q30"));
    expect(html).toContain("[[q30]]");
    expect(html).not.toContain("href=");
  });

  test("passes a targetless [[]] through as literal text", () => {
    expect(renderMarkdown("[[]] alone", never)).toContain("[[]]");
  });

  test("resolves each of several links on one line", () => {
    const html = renderMarkdown("[[a]] and [[b]]", (target) => `/d/${target}`);
    expect(html).toContain('href="/d/a"');
    expect(html).toContain('href="/d/b"');
  });
});
