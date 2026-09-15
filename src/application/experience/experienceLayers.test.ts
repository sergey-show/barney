import { expect, test } from "bun:test";
import { decideExperienceWrite } from "./experienceLayers.ts";

test("PASS with house convention is lesson_pin", () => {
  const d = decideExperienceWrite({
    outcomeOk: true,
    recovered: false,
    failClass: "general",
    pinConvention: true,
  });
  expect(d.kind).toBe("lesson_pin");
});

test("PASS after recovery is skill_candidate", () => {
  const d = decideExperienceWrite({
    outcomeOk: true,
    recovered: true,
    failClass: "secret-leak",
  });
  expect(d.kind).toBe("skill_candidate");
});

test("FAIL structural with directive is failure_rule", () => {
  const d = decideExperienceWrite({
    outcomeOk: false,
    recovered: false,
    failClass: "missing-artifact",
    structuralFail: true,
    hasConcreteDirective: true,
  });
  expect(d.kind).toBe("failure_rule");
});

test("FAIL once non-structural is episode_only", () => {
  const d = decideExperienceWrite({
    outcomeOk: false,
    recovered: false,
    failClass: "wrong-format",
    structuralFail: false,
    modeRepeatCount: 1,
    hasConcreteDirective: true,
    predictionError: 1,
  });
  expect(d.kind).toBe("episode_only");
});

test("high plastic pressure pins after one repeat", () => {
  const d = decideExperienceWrite({
    outcomeOk: false,
    recovered: false,
    failClass: "wrong-format",
    modeRepeatCount: 1,
    hasConcreteDirective: true,
    plasticPressure: 0.85,
    predictionError: 1,
  });
  expect(d.kind).toBe("failure_rule");
});

test("low plastic pressure suppresses non-structural writes", () => {
  const d = decideExperienceWrite({
    outcomeOk: false,
    recovered: false,
    failClass: "wrong-format",
    modeRepeatCount: 5,
    hasConcreteDirective: true,
    plasticPressure: 0.1,
    predictionError: 1,
  });
  expect(d.kind).toBe("episode_only");
});

test("FAIL repeated mode is failure_rule", () => {
  const d = decideExperienceWrite({
    outcomeOk: false,
    recovered: false,
    failClass: "wrong-format",
    modeRepeatCount: 2,
    hasConcreteDirective: true,
    predictionError: 1,
  });
  expect(d.kind).toBe("failure_rule");
});

test("FAIL without prediction error stays episode_only", () => {
  const d = decideExperienceWrite({
    outcomeOk: false,
    recovered: false,
    failClass: "wrong-format",
    modeRepeatCount: 5,
    hasConcreteDirective: true,
    predictionError: 0,
  });
  expect(d.kind).toBe("episode_only");
});
