import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { escapeDeniedMessage } from "../../domain/guard/outsideAccess.ts";
import { denyShell } from "../../domain/guard/ShellPolicy.ts";
import type { WorkspacePort } from "../../application/ports.ts";
import { wrapSandboxed } from "../sandbox/OsSandbox.ts";

const SHELL_TIMEOUT_MS = 120_000;
const MAX_SHELL_OUT = 16_000;

const SKIP = new Set([".git", "node_modules", "dist", ".barney"]);
const MAX_READ = 200_000;
const MAX_SEARCH_HITS = 40;
const MAX_WALK = 400;

/** Optional gate for absolute paths outside the worktree (session grants / eval auto-approve). */
export type OutsideAccess = {
  isAllowed: (absPath: string) => boolean;
};

export class NodeWorkspace implements WorkspacePort {
  constructor(
    private readonly root: string,
    private readonly mask: (text: string, path?: string) => string,
    private readonly unmask: (text: string) => string = (text) => text,
    private readonly outside?: OutsideAccess,
  ) {}

  async list(rel = "."): Promise<string> {
    const abs = this.resolveSafe(rel);
    const entries = readdirSync(abs, { withFileTypes: true })
      .filter((e) => !SKIP.has(e.name))
      .map((e) => `${e.isDirectory() ? "dir" : "file"}\t${e.name}`)
      .sort();
    return entries.join("\n") || "(empty)";
  }

  async stat(rel: string): Promise<string> {
    const abs = this.resolveSafe(rel);
    const st = statSync(abs);
    return JSON.stringify({
      path: rel,
      type: st.isDirectory() ? "dir" : "file",
      size: st.size,
      modified: st.mtime.toISOString(),
    });
  }

  async read(rel: string): Promise<string> {
    const abs = this.resolveSafe(rel);
    const st = statSync(abs);
    if (st.isDirectory()) return `directory: ${rel}`;
    if (st.size > MAX_READ) return `file too large (${st.size} bytes), read a smaller file`;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return "binary file, not shown";
    return this.mask(buf.toString("utf8"), abs);
  }

  async write(rel: string, content: string): Promise<string> {
    const abs = this.resolveSafe(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return `wrote ${rel} (${content.length} chars)`;
  }

  async edit(rel: string, old: string, next: string): Promise<string> {
    if (!old) throw new Error("old text is empty");
    const abs = this.resolveSafe(rel);
    const st = statSync(abs);
    if (st.isDirectory()) throw new Error(`directory: ${rel}`);
    if (st.size > MAX_READ) throw new Error(`file too large (${st.size} bytes)`);
    const buf = readFileSync(abs);
    if (buf.includes(0)) throw new Error("binary file");
    const current = buf.toString("utf8");
    const needle = this.unmask(old);
    const count = current.split(needle).length - 1;
    if (count === 0) throw new Error(`old text not found in ${rel}`);
    if (count > 1) throw new Error(`old text appears ${count} times in ${rel}; make it unique`);
    writeFileSync(abs, current.replace(needle, next), "utf8");
    return `edited ${rel} (${old.length} → ${next.length} chars)`;
  }

  async append(rel: string, content: string): Promise<string> {
    const abs = this.resolveSafe(rel);
    mkdirSync(dirname(abs), { recursive: true });
    let prefix = "";
    if (existsSync(abs)) {
      const st = statSync(abs);
      if (st.isDirectory()) throw new Error(`directory: ${rel}`);
      if (st.size > 0) {
        const tail = readFileSync(abs, "utf8").slice(-1);
        if (tail && tail !== "\n") prefix = "\n";
      }
    }
    appendFileSync(abs, `${prefix}${content}`, "utf8");
    return `appended ${rel} (${content.length} chars)`;
  }

  async mkdir(rel: string): Promise<string> {
    const abs = this.resolveSafe(rel);
    mkdirSync(abs, { recursive: true });
    return `mkdir ${rel}`;
  }

  async search(query: string, rel = "."): Promise<string> {
    const start = this.resolveSafe(rel);
    const hits: string[] = [];
    this.walk(start, (file) => {
      if (hits.length >= MAX_SEARCH_HITS) return;
      try {
        const buf = readFileSync(file);
        if (buf.includes(0) || buf.length > MAX_READ) return;
        const text = buf.toString("utf8");
        const needle = this.unmask(query);
        const idx = text.toLowerCase().indexOf(needle.toLowerCase());
        if (idx < 0) return;
        const line = text.slice(0, idx).split(/\r?\n/).length;
        const relPath = relative(this.root, file).split(sep).join("/");
        hits.push(`${relPath}:${line}`);
      } catch {
        /* skip unreadable */
      }
    });
    return hits.join("\n") || "no matches";
  }

  async remove(rel: string): Promise<string> {
    const abs = this.resolveSafe(rel);
    if (resolve(abs) === resolve(this.root)) throw new Error("cannot remove worktree root");
    rmSync(abs, { recursive: false, force: false });
    return `removed ${rel}`;
  }

  async shell(command: string, signal?: AbortSignal): Promise<string> {
    const trimmed = command.trim();
    if (!trimmed) throw new Error("empty command");
    if (trimmed.length > 4000) throw new Error("command too long");
    const denied = denyShell(trimmed);
    if (denied) throw new Error(`blocked: ${denied}. Use fs_* inside the worktree.`);
    const invocation = shellInvocation(this.unmask(trimmed));
    const launched = wrapSandboxed({ cwd: this.root, command: invocation.command, args: invocation.args });
    const proc = Bun.spawn([launched.command, ...launched.args], {
      cwd: this.root,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: shellEnv(this.root),
    });
    const kill = () => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    };
    const timer = setTimeout(kill, SHELL_TIMEOUT_MS);
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    try {
      const [out, err, code] = await Promise.all([
        proc.stdout instanceof ReadableStream ? new Response(proc.stdout).text() : Promise.resolve(""),
        proc.stderr instanceof ReadableStream ? new Response(proc.stderr).text() : Promise.resolve(""),
        proc.exited,
      ]);
      const raw = [out, err].filter(Boolean).join("\n") || "(no output)";
      const clipped = raw.length > MAX_SHELL_OUT ? `${raw.slice(0, MAX_SHELL_OUT)}\n…truncated` : raw;
      return `exit ${code}\n${this.mask(clipped)}`;
    } finally {
      clearTimeout(timer);
    }
  }

  resolveSafe(rel = "."): string {
    const raw = String(rel || ".").replaceAll("\\", "/");
    if (raw.includes("\0")) throw new Error("invalid path");
    const root = resolve(this.root);
    const abs = isAbsolute(raw) || raw.startsWith("/")
      ? resolve(raw)
      : resolve(root, raw.replace(/^\/+/, ""));
    const relToRoot = relative(root, abs);
    if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
      if (this.outside?.isAllowed(abs)) return abs;
      if (this.outside) throw new Error(escapeDeniedMessage(abs));
      throw new Error("path escapes worktree");
    }
    return abs;
  }

  private walk(dir: string, visit: (file: string) => void, n = { count: 0 }): void {
    if (n.count > MAX_WALK) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) this.walk(full, visit, n);
      else {
        n.count += 1;
        visit(full);
      }
    }
  }
}

function shellInvocation(command: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { command: "/bin/sh", args: ["-c", command] };
}

function shellEnv(cwd: string): Record<string, string> {
  const keep = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "PATHEXT",
    "ComSpec",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "USERPROFILE",
  ];
  const env: Record<string, string> = {};
  for (const key of keep) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.PWD = cwd;
  return env;
}
