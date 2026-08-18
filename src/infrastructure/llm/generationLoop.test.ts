import { expect, test } from "bun:test";
import { generationLooped, trimLooped } from "./generationLoop.ts";

const block = "I will write the response now.\nOne detail: `sandbos` vs `sandbox`.\nI will mention this.\n";

test("detects a repeating thinking paragraph", () => {
  expect(generationLooped(block)).toBe(false);
  expect(generationLooped(block.repeat(3))).toBe(true);
});

test("does not flag ordinary answers", () => {
  expect(generationLooped("The worktree has notes.md and a screenshot. I will summarize both for the user.")).toBe(false);
});

test("keeps the first cycle and drops the rest", () => {
  const trimmed = trimLooped(`Lead-in.\n${block.repeat(4)}`);
  expect(trimmed).toContain("I will write the response now.");
  expect(trimmed.split("I will mention this.").length).toBe(2);
});
