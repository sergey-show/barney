import { expect, test } from "bun:test";
import {
  classifyEditSignal,
  scopeDirectiveIff,
  shapeFailureDirective,
} from "./editSignal.ts";

test("recall used + fail is regression", () => {
  const s = classifyEditSignal({ outcomeOk: false, recallUsed: true });
  expect(s.kind).toBe("regression");
  expect(s.priority).toBeGreaterThan(1);
});

test("false skills raise regression priority", () => {
  const a = classifyEditSignal({ outcomeOk: false, falseSkillCount: 1 });
  const b = classifyEditSignal({ outcomeOk: false, falseSkillCount: 3 });
  expect(a.kind).toBe("regression");
  expect(b.priority).toBeGreaterThan(a.priority);
});

test("fresh fail without recall is gap", () => {
  const s = classifyEditSignal({ outcomeOk: false, structuralFail: true });
  expect(s.kind).toBe("gap");
});

test("scopeDirectiveIff prefixes when-clause", () => {
  expect(scopeDirectiveIff("do not invent tokens", "sanitize secrets")).toBe(
    "when sanitize secrets: do not invent tokens",
  );
});

test("shapeFailureDirective scopes regressions", () => {
  const shaped = shapeFailureDirective({
    directive: "prefer house redact tokens",
    signal: { kind: "regression", priority: 2, reason: "misfire" },
    trigger: "secret-leak",
  });
  expect(shaped.tag).toBe("iff-regression");
  expect(shaped.body.startsWith("when secret-leak:")).toBe(true);
});
