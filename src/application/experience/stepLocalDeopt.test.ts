import { expect, test } from "bun:test";
import {
  annotateProcedureDeopt,
  locateFailedStep,
  planStepLocalDeopt,
} from "./stepLocalDeopt.ts";

test("locateFailedStep prefers step tokens found in evidence", () => {
  const proc = [
    "replace live secrets with house tokens",
    "write audit.txt counts",
    "run grep verify",
  ];
  const idx = locateFailedStep({
    procedure: proc,
    evidence: "grep failed: DETECTED_SECRET still present",
  });
  expect(idx).toBe(2);
});

test("planStepLocalDeopt keeps prior steps and resumes after", () => {
  const plan = planStepLocalDeopt({
    skill: "house-redact",
    procedure: ["replace secrets", "write audit", "verify tree"],
    evidence: "write audit failed permission denied",
  });
  expect(plan.failedStep).toBe(1);
  expect(plan.keep).toEqual(["replace secrets"]);
  expect(plan.retry).toContain("write audit");
  expect(plan.resume).toEqual(["verify tree"]);
  expect(plan.prompt).toContain("STEP-LOCAL DEOPT");
});

test("annotateProcedureDeopt marks only failed step", () => {
  const next = annotateProcedureDeopt(["a", "b", "c"], 1);
  expect(next[1]).toContain("[deopt]");
  expect(next[0]).toBe("a");
});
