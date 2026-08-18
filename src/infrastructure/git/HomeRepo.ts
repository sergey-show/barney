import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HomeRepoPort } from "../../application/ports.ts";

const IGNORE = [
  "barney.sqlite",
  "*.sqlite",
  "*.sqlite-journal",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "worktrees/",
  "browser/",
  ".tmp/",
  ".env",
  ".env.*",
  "**/.DS_Store",
].join("\n") + "\n";

const README = `# Barney body

This is not the kernel. The kernel is immutable.

Here the agent writes itself: the Self, plugins, skills.
Git is the biography of becoming. Apply and roll back.

Do not commit secrets or sessions (sqlite / worktrees are in .gitignore).
`;

const TRACKED = ["plugins", "skills", "mcp", "self", ".gitignore"];

export class HomeRepo implements HomeRepoPort {
  constructor(private readonly home: string) {}

  async ensure(): Promise<void> {
    mkdirSync(join(this.home, "plugins"), { recursive: true });
    mkdirSync(join(this.home, "skills"), { recursive: true });
    mkdirSync(join(this.home, "mcp"), { recursive: true });
    mkdirSync(join(this.home, "self"), { recursive: true });
    writeFileSync(join(this.home, ".gitignore"), IGNORE);
    writeFileSync(join(this.home, "self", "README.md"), README);
    if (!existsSync(join(this.home, ".git"))) {
      runGit(this.home, ["init"]);
    }
    await this.commit("barney: home body");
  }

  async exportSamost(body: string): Promise<void> {
    mkdirSync(join(this.home, "self"), { recursive: true });
    writeFileSync(join(this.home, "self", "samost.md"), body.endsWith("\n") ? body : `${body}\n`);
  }

  async commit(message: string): Promise<string> {
    const staged = runGit(this.home, ["add", "--", ...TRACKED.filter((name) => existsSync(join(this.home, name)) || name === ".gitignore")]);
    if (staged.code !== 0) return `git add failed: ${staged.err || staged.out}`.trim();
    const dirty = runGit(this.home, ["status", "--porcelain", "--", ...TRACKED]);
    if (!dirty.out.trim()) return "clean";
    const committed = runGit(this.home, ["commit", "-m", message.trim() || "become"]);
    if (committed.code !== 0) {
      if (/nothing to commit/i.test(committed.out + committed.err)) return "clean";
      return `git commit failed: ${committed.err || committed.out}`.trim();
    }
    const sha = runGit(this.home, ["rev-parse", "--short", "HEAD"]);
    return sha.out.trim() || "committed";
  }

  async status(): Promise<string> {
    const head = runGit(this.home, ["rev-parse", "--short", "HEAD"]);
    const porcelain = runGit(this.home, ["status", "--porcelain", "--", ...TRACKED]);
    return [`HEAD ${head.out.trim() || "(none)"}`, porcelain.out.trim() || "clean"].join("\n");
  }

  async log(limit = 12): Promise<string> {
    const logged = runGit(this.home, ["log", `-${Math.max(1, Math.min(limit, 40))}`, "--oneline"]);
    if (logged.code !== 0) return logged.err.trim() || "no history yet";
    return logged.out.trim() || "no history yet";
  }

  async rollback(rev: string): Promise<string> {
    const safe = rev.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/~-]*$/.test(safe) || safe.includes("..") || safe.startsWith("/")) {
      return "error: refuse rollback revision";
    }
    const resolved = runGit(this.home, ["rev-parse", "--verify", `${safe}^{commit}`]);
    if (resolved.code !== 0) return `error: unknown revision ${safe}`;
    const reset = runGit(this.home, ["reset", "--hard", safe]);
    if (reset.code !== 0) return `error: ${reset.err || reset.out}`.trim();
    return `rolled back to ${resolved.out.trim()}\n${reset.out.trim()}`.trim();
  }
}

function runGit(home: string, args: string[]): { code: number; out: string; err: string } {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=barney", "-c", "user.email=barney@local", ...args],
    { cwd: home, stdout: "pipe", stderr: "pipe" },
  );
  return {
    code: result.exitCode ?? 1,
    out: Buffer.from(result.stdout).toString(),
    err: Buffer.from(result.stderr).toString(),
  };
}
