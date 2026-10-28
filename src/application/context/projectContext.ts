/**
 * Project context-file ingest (AGENTS.md, CLAUDE.md, and cousins).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".pi/AGENTS.md",
  "AGENT.md",
  ".barney/AGENTS.md",
] as const;

const MAX_CHARS = 6_000;

export function loadProjectContextFiles(worktree: string): string {
  const chunks: string[] = [];
  for (const name of CANDIDATES) {
    const path = join(worktree, name);
    if (!existsSync(path)) continue;
    try {
      const body = readFileSync(path, "utf8").trim();
      if (!body) continue;
      const clipped = body.length > MAX_CHARS
        ? `${body.slice(0, MAX_CHARS)}\n…[truncated]`
        : body;
      chunks.push(`## ${name}\n${clipped}`);
    } catch {
      /* skip unreadable */
    }
  }
  if (!chunks.length) return "";
  return `Project instructions (from repo files — obey unless the user overrides):\n${chunks.join("\n\n")}`;
}
