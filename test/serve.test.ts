import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveObjectPath } from "../src/serve.ts";

/** One artifact-shaped tree plus an out-of-store secret to aim at:
 *
 *   <temp>/secret.txt          the file no request may reach
 *   <temp>/object/index.html   a real artifact file
 *   <temp>/object/sub/deep.txt a real file one level down
 *   <temp>/object/escape       symlink → <temp>          (intermediate)
 *   <temp>/object/leak.txt     symlink → <temp>/secret.txt (leaf)
 */
const root = mkdtempSync(join(tmpdir(), "agentwiki-serve-"));
const object = join(root, "object");
mkdirSync(join(object, "sub"), { recursive: true });
writeFileSync(join(root, "secret.txt"), "secret");
writeFileSync(join(object, "index.html"), "<p>hi</p>");
writeFileSync(join(object, "sub", "deep.txt"), "deep");
symlinkSync(root, join(object, "escape"));
symlinkSync(join(root, "secret.txt"), join(object, "leak.txt"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveObjectPath refuses", () => {
  const refused: Array<[name: string, subPath: string]> = [
    ["a plain parent traversal", "../secret.txt"],
    ["a traversal after a real segment", "sub/../../secret.txt"],
    ["a percent-encoded parent", "%2e%2e/secret.txt"],
    ["a double-encoded parent — one decode, so no such segment", "%252e%252e/secret.txt"],
    ["an encoded separator inside a segment", "sub%2fdeep.txt"],
    ["an encoded backslash separator", "sub%5cdeep.txt"],
    ["an encoded NUL", "index.html%00.png"],
    ["a bare dot segment", "./index.html"],
    ["an absolute-looking path", "/etc/passwd"],
    ["a symlinked leaf", "leak.txt"],
    ["a symlinked intermediate directory", "escape/secret.txt"],
    ["a malformed percent escape", "%zz"],
    ["a segment that does not exist", "nope.txt"],
  ];

  for (const [name, subPath] of refused) {
    test(name, () => {
      expect(resolveObjectPath(object, subPath)).toBeNull();
    });
  }
});

describe("resolveObjectPath allows", () => {
  test("the empty sub-path, as the object root", () => {
    const resolved = resolveObjectPath(object, "");
    expect(resolved?.segments).toEqual([]);
    expect(resolved?.stats.isDirectory()).toBe(true);
  });

  test("a trailing slash, as the object root", () => {
    expect(resolveObjectPath(object, "/")?.segments).toEqual([]);
  });

  test("a file at the root", () => {
    const resolved = resolveObjectPath(object, "index.html");
    expect(resolved?.segments).toEqual(["index.html"]);
    expect(resolved?.path).toBe(join(object, "index.html"));
    expect(resolved?.stats.isFile()).toBe(true);
  });

  test("a file one directory down", () => {
    expect(resolveObjectPath(object, "sub/deep.txt")?.segments).toEqual(["sub", "deep.txt"]);
  });

  test("a directory with its trailing slash trimmed", () => {
    const resolved = resolveObjectPath(object, "sub/");
    expect(resolved?.segments).toEqual(["sub"]);
    expect(resolved?.stats.isDirectory()).toBe(true);
  });

  test("a percent-encoded space in a real name", () => {
    writeFileSync(join(object, "a b.txt"), "spaced");
    expect(resolveObjectPath(object, "a%20b.txt")?.segments).toEqual(["a b.txt"]);
  });
});

test("an object root that does not exist resolves to null", () => {
  expect(resolveObjectPath(join(root, "absent"), "")).toBeNull();
});
