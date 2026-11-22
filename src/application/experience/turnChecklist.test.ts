import { expect, test } from "bun:test";
import {
  compileTurnChecklist,
  formatChecklistPrompt,
  gradeTurnChecklist,
} from "./turnChecklist.ts";

test("compileTurnChecklist extracts paths and secret constraints", () => {
  const items = compileTurnChecklist({
    goal: "Sanitize .env secrets and write audit.txt; do not leave live tokens",
  });
  expect(items.some((i) => i.kind === "artifact")).toBe(true);
  expect(items.some((i) => i.kind === "constraint")).toBe(true);
  expect(formatChecklistPrompt(items)).toContain("TURN-0 CHECKLIST");
});

test("gradeTurnChecklist fails when artifact missing", () => {
  const items = compileTurnChecklist({ goal: "Write report.md and verify it" });
  const report = gradeTurnChecklist({
    items,
    goal: "Write report.md and verify it",
    evidence: "thinking about the report",
    reviewMissing: "Not yet written: report.md",
  });
  expect(report.failed).toBeGreaterThan(0);
  expect(report.line).toContain("turn_checklist:");
});

test("gradeTurnChecklist passes when evidence shows write + verify", () => {
  const items = compileTurnChecklist({ goal: "Write out/result.txt then verify" });
  const report = gradeTurnChecklist({
    items,
    goal: "Write out/result.txt then verify",
    evidence: "wrote out/result.txt\nexit 0\nverified ok",
  });
  expect(report.passed).toBeGreaterThanOrEqual(report.failed);
});
