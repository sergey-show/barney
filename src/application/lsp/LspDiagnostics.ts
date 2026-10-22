/**
 * Optional LSP-style diagnostics for review evidence — Body capability, not Core.
 *
 * Enable with BARNEY_LSP=1. Prefer a SPI verify provider for project-specific
 * checkers; this helper only runs lightweight local commands when present.
 */

export type LspDiagnostic = {
  path: string;
  line?: number;
  message: string;
  severity: "error" | "warning" | "info";
};

export type LspDiagnosticsPort = {
  /** Collect diagnostics for paths under worktree (empty = whole project heuristics). */
  collect(worktree: string, paths?: string[]): Promise<LspDiagnostic[]>;
};

export function formatLspEvidence(rows: LspDiagnostic[], limit = 12): string {
  if (!rows.length) return "";
  const lines = rows.slice(0, limit).map((row) => {
    const loc = row.line != null ? `${row.path}:${row.line}` : row.path;
    return `${row.severity} ${loc} · ${row.message}`;
  });
  const more = rows.length > limit ? `\n… ${rows.length - limit} more` : "";
  return `lsp_diagnostics:\n${lines.join("\n")}${more}`;
}

export function lspEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BARNEY_LSP === "1" || env.BARNEY_LSP === "true";
}
