import { expect, test } from "bun:test";
import { decideExperienceWrite } from "./experienceLayers.ts";

test("PASS without recovery is episode_only", () => {
  const d = decideExperienceWrite({
    outcomeOk: true,
    recovered: false,
    failClass: "secret-leak",
  });
  expect(d.kind).toBe("episode_only");
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
  });
  expect(d.kind).toBe("failure_rule");
});
