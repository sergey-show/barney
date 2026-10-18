import { expect, test } from "bun:test";
import { runSoftCurriculum, softComplaintCases } from "./softTransferCurriculum.ts";
import { judgeSoftZpd3 } from "../autonomy/zpdProof.ts";
import { TextAnalyticsOracle } from "../../infrastructure/oracle/TextAnalyticsOracle.ts";
import { softPredictionFromOracle } from "../experience/predictionError.ts";

test("soft curriculum: bad fails oracle+PE, good passes, ZPD fail→pass", () => {
  const results = runSoftCurriculum();
  expect(results.length).toBe(softComplaintCases.length);
  for (const r of results) {
    expect(r.oracleRejectsBad).toBe(true);
    expect(r.oracleAcceptsGood).toBe(true);
    expect(r.peOnBad).toBe(1);
    expect(r.peOnGood).toBe(0);
    expect(r.zpdOk).toBe(true);
  }
});

test("soft ZPD rejects when pass arm still violates matrix", () => {
  const c = softComplaintCases[0]!;
  const oracle = new TextAnalyticsOracle();
  const zpd = judgeSoftZpd3(oracle, {
    failClass: c.failClass,
    failArtifact: c.lazyOrBad,
    passArtifact: "Still too short and empty.",
    expectations: c.expectations,
    recoveryNote: c.recoveryNote,
  });
  expect(zpd.ok).toBe(false);
  expect(zpd.passShown).toBe(false);
});

test("softPredictionFromOracle captures plan≠fact", () => {
  const oracle = new TextAnalyticsOracle();
  const c = softComplaintCases[0]!;
  const bad = oracle.verify(c.lazyOrBad, c.expectations);
  expect(softPredictionFromOracle(true, bad).error).toBe(1);
  const good = oracle.verify(c.good, c.expectations);
  expect(softPredictionFromOracle(true, good).error).toBe(0);
});
