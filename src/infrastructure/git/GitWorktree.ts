import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { WorktreePort } from "../../application/ports.ts";

export class GitWorktree implements WorktreePort {
  constructor(private readonly root: string) {}

  async create(runId: string, repoDir = process.cwd()): Promise<string> {
    const dest = join(this.root, "worktrees", runId);
    mkdirSync(join(this.root, "worktrees"), { recursive: true });
    if (existsSync(dest)) return dest;

    const gitDir = join(repoDir, ".git");
    if (existsSync(gitDir)) {
      const branch = `barney/${runId}`;
      const created = Bun.spawnSync(["git", "worktree", "add", "-b", branch, dest, "HEAD"], {
        cwd: repoDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (created.exitCode === 0) return dest;
    }

    mkdirSync(dest, { recursive: true });
    Bun.spawnSync(["git", "init"], { cwd: dest, stdout: "pipe", stderr: "pipe" });
    return dest;
  }
}
