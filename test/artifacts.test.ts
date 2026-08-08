import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addressOf,
  bundleManifestText,
  inferKind,
  MAX_ARTIFACT_BYTES,
  mediaTypeFor,
  objectPath,
  sha256,
} from "../src/artifacts.ts";
import type { CliError } from "../src/errors.ts";

const temporary: string[] = [];

function scratch(): string {
  const path = mkdtempSync(join(tmpdir(), "agentwiki-cas-"));
  temporary.push(path);
  return path;
}

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop()!, { recursive: true, force: true });
});

describe("sha256", () => {
  test("is the plain hash of the bytes", () => {
    expect(sha256(Buffer.from("abc", "utf8"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("bundleManifestText", () => {
  test("is a stable two-space-separated hash and path listing", () => {
    expect(
      bundleManifestText([
        { relative: "a.txt", hash: "aa" },
        { relative: "b/c.txt", hash: "bb" },
      ]),
    ).toBe("aa  a.txt\nbb  b/c.txt\n");
  });
});

describe("addressOf", () => {
  test("hashes a single file's bytes", () => {
    const root = scratch();
    const file = join(root, "page.html");
    writeFileSync(file, "<h1>hi</h1>");
    const address = addressOf(file);
    expect(address.version).toBe(sha256(Buffer.from("<h1>hi</h1>", "utf8")));
    expect(address.isDirectory).toBe(false);
    expect(address.fileCount).toBe(1);
    expect(address.entry).toBeNull();
    expect(address.mediaType).toBe("text/html; charset=utf-8");
  });

  test("a directory hashes to the same version regardless of write order", () => {
    const first = scratch();
    mkdirSync(join(first, "assets"), { recursive: true });
    writeFileSync(join(first, "index.html"), "<h1>one</h1>");
    writeFileSync(join(first, "assets", "app.css"), "body{}");

    const second = scratch();
    mkdirSync(join(second, "assets"), { recursive: true });
    writeFileSync(join(second, "assets", "app.css"), "body{}");
    writeFileSync(join(second, "index.html"), "<h1>one</h1>");

    const a = addressOf(first);
    const b = addressOf(second);
    expect(a.version).toBe(b.version);
    expect(a.fileCount).toBe(2);
    expect(a.entry).toBe("index.html");
    expect(a.isDirectory).toBe(true);
  });

  test("changed content changes the version", () => {
    const root = scratch();
    writeFileSync(join(root, "index.html"), "<h1>one</h1>");
    const before = addressOf(root).version;
    writeFileSync(join(root, "index.html"), "<h1>two</h1>");
    expect(addressOf(root).version).not.toBe(before);
  });

  test("a directory without an index.html has no entry point", () => {
    const root = scratch();
    writeFileSync(join(root, "run.log"), "lines");
    expect(addressOf(root).entry).toBeNull();
  });

  test("vcs and editor droppings do not change the version", () => {
    const root = scratch();
    writeFileSync(join(root, "index.html"), "<h1>one</h1>");
    const clean = addressOf(root).version;
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main");
    writeFileSync(join(root, ".DS_Store"), "junk");
    expect(addressOf(root).version).toBe(clean);
  });

  test("an empty directory is refused with a code", () => {
    const root = scratch();
    mkdirSync(join(root, "nested"), { recursive: true });
    try {
      addressOf(root);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as CliError).code).toBe("empty_artifact");
    }
  });
});

describe("kind and media type inference", () => {
  test("directories are bundles and html files are pages", () => {
    expect(inferKind("/tmp/dist", true)).toBe("bundle");
    expect(inferKind("/tmp/report.html", false)).toBe("page");
  });

  test("images and video are media, everything else is evidence", () => {
    expect(inferKind("/tmp/shot.png", false)).toBe("media");
    expect(inferKind("/tmp/clip.mp4", false)).toBe("media");
    expect(inferKind("/tmp/run.log", false)).toBe("evidence");
  });

  test("unknown extensions serve as opaque bytes", () => {
    expect(mediaTypeFor("/tmp/thing.zzz")).toBe("application/octet-stream");
  });
});

describe("objectPath", () => {
  test("shards on the first two hex characters", () => {
    const version = "ab".padEnd(64, "c");
    expect(objectPath("/cas", version)).toBe(join("/cas", "ab", version));
  });
});

describe("the publish cap", () => {
  test("is 50 MB", () => {
    expect(MAX_ARTIFACT_BYTES).toBe(50 * 1024 * 1024);
  });
});
