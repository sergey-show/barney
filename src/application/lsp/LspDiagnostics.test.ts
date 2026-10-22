import { expect, test } from "bun:test";
import { formatLspEvidence, lspEnabled } from "./LspDiagnostics.ts";

test("formatLspEvidence empty", () => {
  expect(formatLspEvidence([])).toBe("");
});

test("formatLspEvidence lists rows", () => {
  const text = formatLspEvidence([
    { path: "a.ts", line: 3, message: "x", severity: "error" },
  ]);
  expect(text).toContain("lsp_diagnostics:");
  expect(text).toContain("a.ts:3");
});

test("lspEnabled reads env", () => {
  expect(lspEnabled({ BARNEY_LSP: "1" })).toBe(true);
  expect(lspEnabled({})).toBe(false);
});
