import { expect, test } from "bun:test";
import { HUD, renderMarkdown, workSummary } from "./render.ts";

test("CLI HUD tokens match the portal amber palette", () => {
  expect(HUD.text).toBe("#f8f4ea");
  expect(HUD.muted).toBe("#b8a88a");
  expect(HUD.accent).toBe("#e8b86d");
  expect(HUD.line).toBe("#3d3420");
  expect(HUD.error).toBe("#ef4444");
});

test("workSummary matches the portal fold", () => {
  expect(workSummary([], true)).toBe("in progress");
  expect(workSummary([
    { id: "1", kind: "thinking", text: "hmm", at: "" },
    { id: "2", kind: "thinking", text: "ok", at: "" },
    { id: "3", kind: "console", text: "ls", at: "" },
  ])).toBe("2 thinking · 1 console");
});

test("renderMarkdown keeps headings lists and fences", () => {
  const out = renderMarkdown("# Title\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n");
  expect(out).toContain("Title");
  expect(out).toContain("• one");
  expect(out).toContain("TS");
  expect(out).toContain("const x = 1");
});
