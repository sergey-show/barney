import { expect, test } from "bun:test";
import {
  sampleExperienceCases,
  weightForCase,
} from "./experienceCurriculumSample.ts";
import { HARD_TRANSFER_CASES } from "./fourHandCurriculum.ts";

test("weights rise with recent fails and low lift", () => {
  const item = HARD_TRANSFER_CASES[0]!;
  const base = weightForCase(item);
  const heavy = weightForCase(item, {
    caseId: item.id,
    recentFails: 3,
    recentLift: 0,
    falseSkillRate: 0.5,
  });
  expect(heavy).toBeGreaterThan(base);
});

test("sample without hints returns all cases sorted by weight", () => {
  const sampled = sampleExperienceCases({});
  expect(sampled.length).toBe(HARD_TRANSFER_CASES.length);
  expect(sampled.map((s) => s.case.id).sort()).toEqual(
    HARD_TRANSFER_CASES.map((c) => c.id).sort(),
  );
});

test("seeded sample is deterministic", () => {
  const a = sampleExperienceCases({ count: 4, seed: 42 }).map((s) => s.case.id);
  const b = sampleExperienceCases({ count: 4, seed: 42 }).map((s) => s.case.id);
  expect(a).toEqual(b);
});

test("failure hints prefer the failing case under seed", () => {
  const sampled = sampleExperienceCases({
    count: 6,
    seed: 7,
    hints: [
      { caseId: "house-merge", recentFails: 10, recentLift: 0 },
      { caseId: "house-redact", recentFails: 0, recentLift: 1 },
    ],
  });
  const merge = sampled.filter((s) => s.case.id === "house-merge").length;
  const redact = sampled.filter((s) => s.case.id === "house-redact").length;
  expect(merge).toBeGreaterThanOrEqual(redact);
});
