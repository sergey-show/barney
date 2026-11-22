import { expect, test } from "bun:test";
import {
  admitBodyWrite,
  decideSelfReportWrite,
  parseBodyWriteMode,
} from "./bodyAdmission.ts";

test("parseBodyWriteMode defaults gated", () => {
  expect(parseBodyWriteMode(undefined)).toBe("gated");
  expect(parseBodyWriteMode("selfreport")).toBe("selfreport");
});

test("gated rejects self-report directive without PE", () => {
  const d = admitBodyWrite({
    writeKind: "failure_rule",
    mode: "gated",
    outcomeOk: false,
    hasConcreteDirective: true,
    predictionError: 0,
    structuralFail: false,
  });
  expect(d.admit).toBe(false);
  expect(d.reason).toContain("reject self-report");
});

test("gated admits structural failure_rule", () => {
  const d = admitBodyWrite({
    writeKind: "failure_rule",
    mode: "gated",
    outcomeOk: false,
    structuralFail: true,
    hasConcreteDirective: true,
  });
  expect(d.admit).toBe(true);
  expect(d.evidence).toBe("structural_fail");
});

test("gated admits lesson_pin with house convention", () => {
  const d = admitBodyWrite({
    writeKind: "lesson_pin",
    mode: "gated",
    outcomeOk: true,
    pinConvention: true,
  });
  expect(d.admit).toBe(true);
  expect(d.evidence).toBe("house_convention");
});

test("gated admits lesson_pin with verified artifact", () => {
  const d = admitBodyWrite({
    writeKind: "lesson_pin",
    mode: "gated",
    outcomeOk: true,
    artifactVerified: true,
  });
  expect(d.admit).toBe(true);
  expect(d.evidence).toBe("artifact_verified");
});

test("gated skill_candidate uses exam path", () => {
  const d = admitBodyWrite({
    writeKind: "skill_candidate",
    mode: "gated",
    outcomeOk: true,
  });
  expect(d.admit).toBe(true);
  expect(d.evidence).toBe("skill_exam_path");
});

test("selfreport admits author claim", () => {
  const d = admitBodyWrite({
    writeKind: "failure_rule",
    mode: "selfreport",
    outcomeOk: false,
    hasConcreteDirective: true,
    predictionError: 0,
  });
  expect(d.admit).toBe(true);
  expect(d.evidence).toBe("self_report");
});

test("decideSelfReportWrite pins fails without PE", () => {
  const d = decideSelfReportWrite({
    outcomeOk: false,
    failClass: "wrong-format",
    hasConcreteDirective: true,
  });
  expect(d.kind).toBe("failure_rule");
});
