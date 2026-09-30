import { expect, test } from "bun:test";
import {
  formatCalibrationLine,
  parseConfidenceFromNote,
  predictFromRecalls,
  scoreCalibration,
  updateConfidenceToward,
  updateRuleQuality,
} from "./calibration.ts";

test("parseConfidenceFromNote reads conf tag and body", () => {
  expect(parseConfidenceFromNote({ tags: ["rule", "conf:0.70"], body: "x" })).toBe(0.7);
  expect(parseConfidenceFromNote({
    tags: ["rule"],
    body: "Do not repeat shell:grep. (v2, conf 0.85) [from run-1]",
  })).toBe(0.85);
  expect(parseConfidenceFromNote({ tags: ["rule"], body: "plain" })).toBeUndefined();
});

test("scoreCalibration flags overconfidence", () => {
  const sample = scoreCalibration(0.9, false);
  expect(sample.outcome).toBe(0);
  expect(sample.brier).toBeGreaterThan(0.5);
  expect(sample.overconfident).toBe(true);
  expect(sample.underconfident).toBe(false);
  expect(formatCalibrationLine(sample)).toMatch(/calibration: pred=0\.90 out=0/);
});

test("predictFromRecalls averages rule conf and skill strength", () => {
  expect(predictFromRecalls({ fallback: 0.5 })).toBe(0.5);
  expect(predictFromRecalls({ ruleConfidences: [0.8], skillStrengths: [0.4] })).toBeCloseTo(0.6);
});

test("updateConfidenceToward moves toward outcome", () => {
  expect(updateConfidenceToward(0.8, false)).toBeLessThan(0.8);
  expect(updateConfidenceToward(0.2, true)).toBeGreaterThan(0.2);
});

test("updateRuleQuality penalizes used+fail", () => {
  expect(updateRuleQuality(0.8, { recallUsed: true, outcomeOk: false })).toBeLessThan(0.7);
  expect(updateRuleQuality(0.5, { recallUsed: false, outcomeOk: true })).toBe(0.65);
});
