import { expect, test } from "bun:test";
import { extractNeverLines, immuneBoundaryNote, selfGateTool, selfViolationNote } from "./selfGate.ts";

test("selfGate blocks kernel path writes", () => {
  const hit = selfGateTool({
    toolName: "fs_write",
    args: { path: "src/application/usecases/DriveSolve.ts", content: "x" },
  });
  expect(hit.blocked).toBe(true);
  expect(hit.reason).toMatch(/kernel/i);
});

test("selfGate allows ordinary worktree writes", () => {
  const ok = selfGateTool({
    toolName: "fs_write",
    args: { path: "/app/dclm/ray_processing/process.py", content: "x" },
  });
  expect(ok.blocked).toBe(false);
});

test("immune lines and violation notes", () => {
  const constitution = "The kernel is immutable.\nDo not write a program of the self.\nDo not write secrets to memory.";
  expect(extractNeverLines(constitution).length).toBeGreaterThanOrEqual(2);
  expect(immuneBoundaryNote(constitution)).toMatch(/Immune/);
  expect(selfViolationNote(constitution, "I rewrote the kernel tonight")).toMatch(/Self violation/);
});
