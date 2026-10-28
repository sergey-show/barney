/**
 * Body-side diagnostics via local CLIs (tsc / bun) — not an in-process language server.
 * Keeps Core free of vscode-jsonrpc; swap for SPI verify providers when needed.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LspDiagnostic, LspDiagnosticsPort } from "../../application/lsp/LspDiagnostics.ts";

export class ShellLspDiagnostics implements LspDiagnosticsPort {
  async collect(worktree: string, paths: string[] = []): Promise<LspDiagnostic[]> {
    const out: LspDiagnostic[] = [];
    if (existsSync(join(worktree, "tsconfig.json")) || existsSync(join(worktree, "package.json"))) {
      const tsc = await runCapture(worktree, ["bunx", "--bun", "tsc", "--noEmit", "--pretty", "false"]);
      out.push(...parseTsc(tsc, paths));
    }
    return out;
  }
}

async function runCapture(cwd: string, argv: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(argv, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* */
      }
    }, 45_000);
    try {
      const [stdout, stderr] = await Promise.all([
        proc.stdout instanceof ReadableStream ? new Response(proc.stdout).text() : Promise.resolve(""),
        proc.stderr instanceof ReadableStream ? new Response(proc.stderr).text() : Promise.resolve(""),
      ]);
      await proc.exited;
      return `${stdout}\n${stderr}`;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return "";
  }
}

/** `file(line,col): error TS1234: message` */
function parseTsc(text: string, filterPaths: string[]): LspDiagnostic[] {
  const rows: LspDiagnostic[] = [];
  const re = /^(.+?)\((\d+),\d+\):\s+(error|warning)\s+TS\d+:\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const path = match[1]!.replace(/\\/g, "/");
    if (filterPaths.length && !filterPaths.some((p) => path.endsWith(p) || path.includes(p))) {
      continue;
    }
    rows.push({
      path,
      line: Number(match[2]),
      severity: match[3] === "warning" ? "warning" : "error",
      message: match[4]!.trim(),
    });
    if (rows.length >= 40) break;
  }
  return rows;
}
