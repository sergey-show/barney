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

  async grep(pattern: string, rel = ".", include?: string): Promise<string> {
    const start = this.resolveSafe(rel);
    const rg = await tryRipgrep(pattern, start, include);
    if (rg != null) {
      const lines = rg
        .split("\n")
        .filter(Boolean)
        .slice(0, MAX_SEARCH_HITS)
        .map((line) => {
          const abs = line.split(":")[0] ?? "";
          try {
            const relPath = relative(this.root, abs).split(sep).join("/");
            return line.replace(abs, relPath);
          } catch {
            return line;
          }
        });
      return lines.join("\n") || "no matches";
    }
    let re: RegExp;
    try {
      re = new RegExp(this.unmask(pattern), "i");
    } catch (err) {
      throw new Error(`invalid regex: ${err instanceof Error ? err.message : String(err)}`);
    }
    const hits: string[] = [];
    this.walk(start, (file) => {
      if (hits.length >= MAX_SEARCH_HITS) return;
      if (include && !globMatch(relative(start, file).split(sep).join("/"), include)) return;
      try {
        const buf = readFileSync(file);
        if (buf.includes(0) || buf.length > MAX_READ) return;
        const text = buf.toString("utf8");
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i]!)) continue;
          const relPath = relative(this.root, file).split(sep).join("/");
          hits.push(`${relPath}:${i + 1}:${lines[i]!.slice(0, 200)}`);
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
      } catch {
        /* skip */
      }
    });
    return hits.join("\n") || "no matches";
  }

  async glob(pattern: string, rel = "."): Promise<string> {
    const start = this.resolveSafe(rel);
    const matches: Array<{ path: string; mtime: number }> = [];
    this.walk(start, (file) => {
      const relPath = relative(this.root, file).split(sep).join("/");
      const fromStart = relative(start, file).split(sep).join("/");
      if (!globMatch(fromStart, pattern) && !globMatch(relPath, pattern)) return;
      try {
        matches.push({ path: relPath, mtime: statSync(file).mtimeMs });
      } catch {
        matches.push({ path: relPath, mtime: 0 });
      }
    });
    matches.sort((a, b) => b.mtime - a.mtime);
    const capped = matches.slice(0, MAX_SEARCH_HITS);
    if (!capped.length) return "no files found";
    const extra = matches.length > capped.length ? `\n… truncated ${matches.length - capped.length} more` : "";
    return `${capped.map((m) => m.path).join("\n")}${extra}`;
  }

  async patch(patchText: string): Promise<string> {
    return applyUnifiedDiff(this, this.unmask(patchText));
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
      // Soft clip here; DriveSolve offloads full body to .barney/tool-out when needed.
      const clipped = raw.length > MAX_SHELL_OUT
        ? `${raw.slice(0, MAX_SHELL_OUT)}\n…truncated (${raw.length - MAX_SHELL_OUT} more chars in tool offload if re-run via session)`
        : raw;
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

async function tryRipgrep(pattern: string, cwd: string, include?: string): Promise<string | null> {
  try {
    const args = ["-n", "--no-heading", "-e", pattern];
    if (include) args.push("--glob", include);
    args.push(".");
    const proc = Bun.spawn(["rg", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [out, code] = await Promise.all([
      proc.stdout instanceof ReadableStream ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.exited,
    ]);
    if (code === 0 || code === 1) return out;
    return null;
  } catch {
    return null;
  }
}

/** Minimal glob: * and ** and ? — enough for tool use. */
function globMatch(path: string, pattern: string): boolean {
  const norm = path.replace(/^(\.\/)+/, "");
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`).test(norm) || new RegExp(`^${escaped}$`).test(path);
}

async function applyUnifiedDiff(
  ws: NodeWorkspace,
  patchText: string,
): Promise<string> {
  const files = parseUnifiedDiff(patchText);
  if (!files.length) throw new Error("patch: no file hunks found");
  const changed: string[] = [];
  for (const file of files) {
    if (file.delete) {
      await ws.remove(file.path);
      changed.push(`deleted ${file.path}`);
      continue;
    }
    let current = "";
    try {
      current = await ws.read(file.path);
    } catch {
      if (!file.create) throw new Error(`patch: missing file ${file.path}`);
    }
    const next = applyHunks(current, file.hunks);
    await ws.write(file.path, next);
    changed.push(`updated ${file.path}`);
  }
  return changed.join("\n");
}

type DiffFile = {
  path: string;
  create?: boolean;
  delete?: boolean;
  hunks: Array<{ oldStart: number; lines: string[] }>;
};

function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("--- ")) {
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim().replace(/^[ab]\//, "");
      if (raw === "/dev/null") continue;
      current = { path: raw, hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const m = line.match(/b\/(.+)$/);
      if (m) {
        current = { path: m[1]!, hunks: [] };
        files.push(current);
      }
      continue;
    }
    if (line.startsWith("new file mode")) {
      if (current) current.create = true;
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      if (current) current.delete = true;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk && current) {
      current.hunks.push({ oldStart: Number(hunk[1]), lines: [] });
      continue;
    }
    if (current?.hunks.length && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line === "\\ No newline at end of file")) {
      if (line.startsWith("\\")) continue;
      current.hunks.at(-1)!.lines.push(line);
    }
  }
  return files.filter((f) => f.path && f.path !== "/dev/null");
}

function applyHunks(content: string, hunks: DiffFile["hunks"]): string {
  if (!hunks.length) return content;
  const endsWithNl = content.endsWith("\n");
  const lines = content === "" ? [] : content.replace(/\n$/, "").split("\n");
  // Apply from bottom so line numbers stay valid
  for (const hunk of [...hunks].reverse()) {
    const oldLines: string[] = [];
    const newLines: string[] = [];
    for (const row of hunk.lines) {
      const mark = row[0];
      const body = row.slice(1);
      if (mark === " ") {
        oldLines.push(body);
        newLines.push(body);
      } else if (mark === "-") oldLines.push(body);
      else if (mark === "+") newLines.push(body);
    }
    const start = Math.max(0, hunk.oldStart - 1);
    const slice = lines.slice(start, start + oldLines.length);
    if (oldLines.length && slice.join("\n") !== oldLines.join("\n")) {
      // fuzzy: find first occurrence of old block
      const block = oldLines.join("\n");
      const joined = lines.join("\n");
      const idx = joined.indexOf(block);
      if (idx < 0) throw new Error(`patch: hunk context mismatch at line ${hunk.oldStart}`);
      const before = joined.slice(0, idx);
      const after = joined.slice(idx + block.length);
      const rebuilt = `${before}${newLines.join("\n")}${after}`.split("\n");
      lines.length = 0;
      lines.push(...rebuilt);
      continue;
    }
    lines.splice(start, oldLines.length, ...newLines);
  }
  const out = lines.join("\n");
  return endsWithNl || out === "" ? (out.endsWith("\n") || out === "" ? out : `${out}\n`) : out;
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
