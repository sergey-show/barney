import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorktree } from "./GitWorktree.ts";

function gitRepo(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix));
  Bun.spawnSync(["git", "init"], { cwd, stdout: "pipe", stderr: "pipe" });
  writeFileSync(join(cwd, "kernel.ts"), "export {};\n");
  Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "kernel"], { cwd, stdout: "pipe", stderr: "pipe" });
  return cwd;
}

test("without a launch dir worktree and session dir are the same sandbox", async () => {
  const cwd = gitRepo("barney-cwd-");
  const home = mkdtempSync(join(tmpdir(), "barney-home-"));
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    const layout = await new GitWorktree(home).create("run_probe");
    expect(layout.sessionDir).toBe(join(home, "worktrees", "run_probe"));
    expect(layout.worktree).toBe(layout.sessionDir);
    expect(existsSync(join(layout.sessionDir, ".git"))).toBe(true);
    expect(existsSync(join(layout.sessionDir, "kernel.ts"))).toBe(false);
    const branches = Bun.spawnSync(["git", "branch", "--list", "barney/*"], { cwd, stdout: "pipe" });
    expect(Buffer.from(branches.stdout).toString().trim()).toBe("");
    const linked = Bun.spawnSync(["git", "worktree", "list"], { cwd, stdout: "pipe" });
    expect(Buffer.from(linked.stdout).toString()).not.toContain("run_probe");
  } finally {
    process.chdir(prev);
  }
});

test("CLI launch dir is the project worktree; session dir still exists under home", async () => {
  const project = gitRepo("barney-proj-");
  const home = mkdtempSync(join(tmpdir(), "barney-home-"));
  const layout = await new GitWorktree(home).create("run_here", project);
  expect(layout.worktree).toBe(project);
  expect(layout.sessionDir).toBe(join(home, "worktrees", "run_here"));
  expect(existsSync(layout.sessionDir)).toBe(true);
  const linked = Bun.spawnSync(["git", "worktree", "list"], { cwd: project, stdout: "pipe" });
  expect(Buffer.from(linked.stdout).toString()).not.toContain("run_here");
});

test("the body home is not a project workspace", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-home-"));
  const layout = await new GitWorktree(home).create("run_body", home);
  expect(layout.worktree).toBe(join(home, "worktrees", "run_body"));
  expect(layout.sessionDir).toBe(layout.worktree);
});
