import { expect, test } from "bun:test";
import { HUD, LOGO_ROWS, renderMarkdown, workSummary, workView } from "./render.ts";

test("CLI HUD tokens match the portal blue palette", () => {
  expect(HUD.text).toBe("#f2f4f8");
  expect(HUD.muted).toBe("#8d96a7");
  expect(HUD.accent).toBe("#6f8cff");
  expect(HUD.line).toBe("#252b36");
  expect(HUD.error).toBe("#ef4444");
});

test("logo rows are the same width", () => {
  const widths = LOGO_ROWS.map((row) => row.join("").length);
  expect(new Set(widths).size).toBe(1);
  expect(widths[0]).toBeGreaterThan(24);
});

test("workView keeps a fixed height and the tail of the buffer", () => {
  expect(workView("a\nb\nc\nd", 80, 2)).toEqual(["c", "d"]);
  expect(workView("", 80, 3)).toEqual(["", "", ""]);
  expect(workView("hello", 80, 1)).toEqual(["hello"]);
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
