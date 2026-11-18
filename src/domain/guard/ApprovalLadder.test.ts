import { expect, test } from "bun:test";
import {
  approvalSignature,
  decideApproval,
  toolApprovalRisk,
} from "./ApprovalLadder.ts";

test("shell rm is high risk; plain shell and fs_write are medium", () => {
  expect(toolApprovalRisk("shell", { command: "rm -rf build" })).toBe("high");
  expect(toolApprovalRisk("shell", { command: "git status" })).toBe("medium");
  expect(toolApprovalRisk("fs_write", { path: "a.ts" })).toBe("medium");
  expect(toolApprovalRisk("fs_read", { path: "a.ts" })).toBe("low");
});

test("unless_trusted asks only for high risk", () => {
  const ask = decideApproval({
    mode: "unless_trusted",
    toolName: "shell",
    args: { command: "rm -rf build" },
  });
  expect(ask.decision).toBe("ask");
  const allow = decideApproval({
    mode: "unless_trusted",
    toolName: "shell",
    args: { command: "git status" },
  });
  expect(allow.decision).toBe("allow");
});

test("session allow and deny win", () => {
  const signature = approvalSignature("shell", { command: "rm -rf build" });
  expect(decideApproval({
    mode: "on_request",
    toolName: "shell",
    args: { command: "rm -rf build" },
    sessionAllows: [signature],
  }).decision).toBe("allow");
  expect(decideApproval({
    mode: "never",
    toolName: "shell",
    args: { command: "rm -rf build" },
    sessionDenies: [signature],
  }).decision).toBe("deny");
});

test("trusted prefix skips ask", () => {
  const verdict = decideApproval({
    mode: "on_request",
    toolName: "shell",
    args: { command: "npm test" },
    trustedPrefixes: ["shell:npm test"],
  });
  expect(verdict.decision).toBe("trusted");
});
