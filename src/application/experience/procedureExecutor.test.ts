import { expect, test } from "bun:test";
import {
  classifyProcedure,
  planProcedureExec,
  stepFamily,
} from "./procedureExecutor.ts";

test("stepFamily maps free text and trail keys", () => {
  expect(stepFamily("shell:grep")).toBe("shell:grep");
  expect(stepFamily("write audit.txt")).toBe("fs");
  expect(stepFamily("decide which approach is better")).toBe("semantic");
});

test("planProcedureExec runs consecutive mechanical streak then handoff", () => {
  const plan = planProcedureExec({
    skill: "house-redact",
    procedure: [
      "replace secrets with house tokens",
      "write audit.txt",
      "verify with grep",
      "judge whether the report is complete",
    ],
  });
  expect(plan.streak.length).toBe(3);
  expect(plan.stopAt).toBe(3);
  expect(plan.prompt).toContain("PROCEDURE EXEC");
  expect(plan.prompt).toContain("judge whether");
  expect(plan.line).toContain("streak=3");
});

test("classifyProcedure marks judgment steps semantic", () => {
  const steps = classifyProcedure([
    "fs",
    "shell:grep",
    "choose the right narrative for the user",
  ]);
  expect(steps[0]!.kind).toBe("mechanical");
  expect(steps[1]!.kind).toBe("mechanical");
  expect(steps[2]!.kind).toBe("semantic");
});
