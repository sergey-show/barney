import { expect, test } from "bun:test";
import { computePredictionError } from "./predictionError.ts";
import { decideExperienceWrite } from "./experienceLayers.ts";
import { topKByWeightSimilarity, recallSimilarity } from "./weightedRecall.ts";
import { planSpacedProbes, summarizeSpacedRetention } from "../evaluation/spacedTransfer.ts";
import { mergeFailureRules } from "../psyche/dream.ts";

test("prediction error fires on review fail and recovery path", () => {
  expect(computePredictionError({ reviewFail: true, hadFailedFamily: false }).error).toBe(1);
  expect(computePredictionError({ reviewFail: false, hadFailedFamily: true }).error).toBe(1);
  expect(computePredictionError({ reviewFail: false, hadFailedFamily: false }).error).toBe(0);
});

test("skill_candidate requires prediction error", () => {
  const blocked = decideExperienceWrite({
    outcomeOk: true,
    recovered: true,
    failClass: "secret-leak",
    predictionError: 0,
  });
  expect(blocked.kind).toBe("episode_only");
  const ok = decideExperienceWrite({
    outcomeOk: true,
    recovered: true,
    failClass: "secret-leak",
    predictionError: 1,
  });
  expect(ok.kind).toBe("skill_candidate");
});

test("top-k prefers high weight × similarity", () => {
  expect(recallSimilarity("house redact aws", "use barney-redact-aws for aws keys")).toBeGreaterThan(0);
  const ranked = topKByWeightSimilarity(
    "sanitize secrets with house tokens",
    [
      { line: "unrelated git tip", kind: "rule", weight: 0.9 },
      { line: "[rule:r1] use house redact tokens for aws", kind: "rule", weight: 0.4 },
      { line: "[skill:learned-secret-leak] strength=0.8", kind: "skill", weight: 0.85 },
    ],
    2,
  );
  expect(ranked[0]!.line).toMatch(/house|secret|skill/i);
});

test("mergeFailureRules collapses near-duplicates", () => {
  const merged = mergeFailureRules([
    "Do not repeat shell:openssl after TLS fail",
    "Don't repeat shell openssl when TLS fails again",
    "Prefer browser network tools for cookies",
  ]);
  expect(merged.length).toBeLessThan(3);
  expect(merged.some((line) => /browser|cookie/i.test(line))).toBe(true);
});

test("spaced retention summary", () => {
  const plan = planSpacedProbes();
  expect(plan.map((p) => p.delayHours)).toEqual([0, 24, 168]);
  const report = summarizeSpacedRetention("house-redact", [
    { caseId: "house-redact", delayHours: 0, transferSuccessLift: 1 },
    { caseId: "house-redact", delayHours: 24, transferSuccessLift: 1 },
    { caseId: "house-redact", delayHours: 168, transferSuccessLift: 0 },
  ]);
  expect(report.verdict).toBe("fades");
  expect(report.forgetting).toBe(1);
});
