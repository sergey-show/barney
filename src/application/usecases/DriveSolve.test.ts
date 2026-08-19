import { expect, test } from "bun:test";
import { requestedFile, wantsArtifact } from "./DriveSolve.ts";

test("detects a requested markdown file without a special product slug", () => {
  const goal = "break down the plan and delegate, analyze the map, create an md file, write how to finetune a small model on it";
  expect(wantsArtifact(goal)).toBe(true);
  expect(requestedFile(goal)).toBe("notes.md");
});

test("keeps an explicit filename from the prompt", () => {
  expect(requestedFile("create outline.md in the worktree")).toBe("outline.md");
});

test("does not treat a requested data file as a markdown article", () => {
  const ask = "Create `/work/report.txt` and `/work/check.py` with computed dates";
  expect(requestedFile(ask)).toBeNull();
  expect(wantsArtifact(ask)).toBe(true);
});
