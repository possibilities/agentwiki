import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitVault, ensureGit, gitReport, isRepo, syncVault } from "../src/git.ts";

let root: string;

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return (result.stdout ?? "").trim();
}

function subjectOf(cwd: string): string {
  return git(cwd, ["log", "-1", "--format=%s"]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentwiki-git-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("ensureGit", () => {
  // The bug this exists to fix: the old code only ran git init when it created
  // the vault, so a directory made by hand never gained a history at all.
  test("makes an existing directory a repository", () => {
    writeFileSync(join(root, "already-here.md"), "# Already here\n");
    expect(isRepo(root)).toBe(false);
    expect(ensureGit(root)).toBe(true);
    expect(isRepo(root)).toBe(true);
  });

  test("is idempotent and preserves history across repeat calls", () => {
    ensureGit(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    commitVault(root);
    const first = git(root, ["rev-parse", "HEAD"]);
    ensureGit(root);
    ensureGit(root);
    expect(git(root, ["rev-parse", "HEAD"])).toBe(first);
  });

  test("writes an ignore file that excludes the derived index", () => {
    ensureGit(root);
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore).toContain(".agentwiki/index.sqlite3*");
    mkdirSync(join(root, ".agentwiki"), { recursive: true });
    writeFileSync(join(root, ".agentwiki", "index.sqlite3"), "binary");
    writeFileSync(join(root, "doc.md"), "# Doc\n");
    commitVault(root);
    expect(git(root, ["ls-files"])).not.toContain("index.sqlite3");
  });

  test("does not overwrite an ignore file the user already wrote", () => {
    ensureGit(root);
    writeFileSync(join(root, ".gitignore"), "custom\n");
    ensureGit(root);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("custom\n");
  });

  test("untracks a derived index committed before the ignore existed", () => {
    ensureGit(root);
    rmSync(join(root, ".gitignore"));
    mkdirSync(join(root, ".agentwiki"), { recursive: true });
    writeFileSync(join(root, ".agentwiki", "index.sqlite3"), "binary");
    git(root, ["add", "--all"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "with index"]);
    expect(git(root, ["ls-files"])).toContain(".agentwiki/index.sqlite3");
    ensureGit(root);
    expect(git(root, ["diff", "--cached", "--name-only"])).toContain(".agentwiki/index.sqlite3");
  });
});

describe("isRepo", () => {
  // Without this, a vault under a repo'd $HOME would commit documents into
  // that repository rather than its own.
  test("is false for a directory that merely sits inside a repository", () => {
    ensureGit(root);
    const nested = join(root, "nested");
    mkdirSync(nested, { recursive: true });
    expect(isRepo(nested)).toBe(false);
  });
});

describe("commitVault", () => {
  test("records a file edited directly, behind agentwiki's back", () => {
    ensureGit(root);
    writeFileSync(join(root, "edited-by-hand.md"), "# Edited by hand\n");
    expect(commitVault(root)).toBe(true);
    expect(git(root, ["ls-files"])).toContain("edited-by-hand.md");
  });

  test("reports no commit when nothing changed", () => {
    ensureGit(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    expect(commitVault(root)).toBe(true);
    expect(commitVault(root)).toBe(false);
  });

  // ensureGit writes the ignore file but does not commit it, so it rides along
  // in whatever the vault's first content commit turns out to be.
  test("carries the ignore file into the first commit", () => {
    ensureGit(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    commitVault(root);
    expect(subjectOf(root)).toBe("2 files changed");
    expect(git(root, ["log", "-1", "--format=%b"])).toContain("A  .gitignore");
  });

  test("names a single change with git's own status letter and literal path", () => {
    ensureGit(root);
    commitVault(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    commitVault(root);
    expect(subjectOf(root)).toBe("A one.md");
    writeFileSync(join(root, "one.md"), "# One, revised\n");
    commitVault(root);
    expect(subjectOf(root)).toBe("M one.md");
  });

  test("counts a multi-file change and lists the files in the body", () => {
    ensureGit(root);
    commitVault(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    writeFileSync(join(root, "two.md"), "# Two\n");
    commitVault(root);
    expect(subjectOf(root)).toBe("2 files changed");
    const body = git(root, ["log", "-1", "--format=%b"]);
    expect(body).toContain("A  one.md");
    expect(body).toContain("A  two.md");
  });

  test("uses a supplied message verbatim", () => {
    ensureGit(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    commitVault(root, "Record the duplex decision");
    expect(subjectOf(root)).toBe("Record the duplex decision");
  });

  test("commits on a machine with no configured git identity", () => {
    ensureGit(root);
    git(root, ["config", "user.email", ""]);
    git(root, ["config", "user.name", ""]);
    writeFileSync(join(root, "one.md"), "# One\n");
    expect(commitVault(root)).toBe(true);
  });
});

describe("best-effort", () => {
  test("a directory that is not a repository is a silent no-op", () => {
    writeFileSync(join(root, "one.md"), "# One\n");
    expect(commitVault(root)).toBe(false);
    expect(() => syncVault(root)).not.toThrow();
    expect(existsSync(join(root, ".git"))).toBe(false);
  });

  test("a vault that does not exist neither throws nor is conjured", () => {
    const missing = join(root, "absent");
    expect(() => syncVault(missing)).not.toThrow();
    expect(ensureGit(missing)).toBe(false);
    expect(existsSync(missing)).toBe(false);
  });
});

describe("gitReport", () => {
  test("says a plain directory is not a repository", () => {
    expect(gitReport(root).repo).toBe(false);
  });

  test("reports the head commit, and no remote as null rather than empty", () => {
    ensureGit(root);
    commitVault(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    commitVault(root);
    const report = gitReport(root);
    expect(report.repo).toBe(true);
    expect(report.remote).toBeNull();
    expect(report.last_commit?.subject).toBe("A one.md");
    expect(report.clean).toBe(true);
  });

  // A vault with no upstream has no answer to "how far behind?", which is a
  // different fact from being fully pushed.
  test("reports an unanswerable backlog as null, not zero", () => {
    ensureGit(root);
    writeFileSync(join(root, "one.md"), "# One\n");
    commitVault(root);
    expect(gitReport(root).unpushed).toBeNull();
  });
});
