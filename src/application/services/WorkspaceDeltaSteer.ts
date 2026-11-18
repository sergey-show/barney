/**
 * Workspace delta → steer injection. Polls mtimes; no kernel rewrite.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type WorkspaceDelta = {
  path: string;
  mtimeMs: number;
  kind: "change" | "add";
};

export type WorkspaceDeltaSteerOptions = {
  root: string;
  /** Ignore globs / directory names. */
  skipNames?: Set<string>;
  maxFiles?: number;
  debounceMs?: number;
};

const DEFAULT_SKIP = new Set([
  ".git",
  "node_modules",
  "dist",
  ".barney",
  "coverage",
  ".next",
  "target",
]);

export class WorkspaceDeltaSteer {
  private readonly skip: Set<string>;
  private readonly maxFiles: number;
  private readonly debounceMs: number;
  private snapshot = new Map<string, number>();
  private lastEmitAt = 0;

  constructor(private readonly opts: WorkspaceDeltaSteerOptions) {
    this.skip = opts.skipNames ?? DEFAULT_SKIP;
    this.maxFiles = opts.maxFiles ?? 400;
    this.debounceMs = opts.debounceMs ?? 1_500;
  }

  /** Take baseline so the first poll does not flood. */
  baseline(): number {
    this.snapshot = this.scan();
    return this.snapshot.size;
  }

  poll(): { deltas: WorkspaceDelta[]; steerText: string | null } {
    const now = Date.now();
    if (now - this.lastEmitAt < this.debounceMs) {
      return { deltas: [], steerText: null };
    }
    const next = this.scan();
    const deltas: WorkspaceDelta[] = [];
    for (const [path, mtimeMs] of next) {
      const prev = this.snapshot.get(path);
      if (prev == null) deltas.push({ path, mtimeMs, kind: "add" });
      else if (mtimeMs > prev) deltas.push({ path, mtimeMs, kind: "change" });
    }
    this.snapshot = next;
    if (!deltas.length) return { deltas, steerText: null };
    this.lastEmitAt = now;
    const lines = deltas.slice(0, 24).map((d) => `- ${d.kind}: ${d.path}`);
    const steerText = [
      "[workspace_delta] External worktree changes detected:",
      ...lines,
      "Re-check affected files before assuming prior edits still hold.",
    ].join("\n");
    return { deltas, steerText };
  }

  private scan(): Map<string, number> {
    const out = new Map<string, number>();
    const root = this.opts.root;
    if (!existsSync(root)) return out;
    const stack = [root];
    while (stack.length && out.size < this.maxFiles) {
      const dir = stack.pop()!;
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (this.skip.has(name)) continue;
        const abs = join(dir, name);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!st.isFile()) continue;
        const rel = relative(root, abs).replaceAll("\\", "/") || name;
        out.set(rel, st.mtimeMs);
        if (out.size >= this.maxFiles) break;
      }
    }
    return out;
  }
}
