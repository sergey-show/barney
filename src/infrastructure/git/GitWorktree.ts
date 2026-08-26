import { existsSync, mkdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { WorkspaceLayout, WorktreePort } from "../../application/ports.ts";

export class GitWorktree implements WorktreePort {
  constructor(private readonly root: string) {}

  /**
   * Always creates ~/.barney/worktrees/<runId> (session folder).
   * CLI passes the launch directory as repoDir: that becomes the project worktree
   * (tools cwd). Never attach a git worktree to the kernel or the body repo.
   */
  async create(runId: string, repoDir?: string): Promise<WorkspaceLayout> {
    const sessionDir = join(this.root, "worktrees", runId);
    mkdirSync(join(this.root, "worktrees"), { recursive: true });
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
      Bun.spawnSync(["git", "init"], { cwd: sessionDir, stdout: "pipe", stderr: "pipe" });
    }
    const launch = repoDir ? resolve(repoDir) : undefined;
    if (launch && this.isProjectDir(launch)) return { worktree: launch, sessionDir };
    return { worktree: sessionDir, sessionDir };
  }

  private isProjectDir(abs: string): boolean {
    try {
      if (!existsSync(abs) || !statSync(abs).isDirectory()) return false;
    } catch {
      return false;
    }
    const home = resolve(this.root);
    if (abs === home) return false;
    const rel = relative(home, abs);
    if (!rel || rel === "") return false;
    if (!rel.startsWith("..") && !isAbsolute(rel)) return false;
    return true;
  }
}
