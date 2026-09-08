import { expect, test } from "bun:test";
import {
  buildTransferTrials,
  estimateTransferEffect,
  runTransferExperiment,
  type TransferObservation,
} from "./counterfactualTransfer.ts";

test("builds balanced paired trials across different task classes", () => {
  const trials = buildTransferTrials([{
    id: "cert-to-config",
    sourceClass: "certificate-repair",
    targetClass: "repository-sanitization",
    goal: "sanitize fixture",
  }], 4, 7);

  expect(trials).toHaveLength(8);
  for (let trial = 0; trial < 4; trial++) {
    const pair = trials.filter((item) => item.trial === trial);
    expect(new Set(pair.map((item) => item.arm))).toEqual(new Set(["experience", "ablated"]));
    expect(new Set(pair.map((item) => item.order))).toEqual(new Set([0, 1]));
  }
});

test("rejects an in-class case masquerading as transfer", () => {
  expect(() => buildTransferTrials([{
    id: "same-class",
    sourceClass: "scripts",
    targetClass: "scripts",
    goal: "write another script",
  }], 1)).toThrow(/must cross task classes/);
});

test("estimates a positive paired treatment effect", () => {
  const observations: TransferObservation[] = [];
  for (let trial = 0; trial < 8; trial++) {
    observations.push(
      { caseId: "x", trial, seed: trial, arm: "experience", order: 0, success: true, score: 1 },
      { caseId: "x", trial, seed: trial, arm: "ablated", order: 1, success: false, score: 0 },
    );
  }

  const effect = estimateTransferEffect(observations);
  expect(effect.pairs).toBe(8);
  expect(effect.meanScoreLift).toBe(1);
  expect(effect.successRateLift).toBe(1);
  expect(effect.signTestPValue).toBeLessThan(0.05);
  expect(effect.verdict).toBe("positive");
});

test("runs both arms through the same runner contract", async () => {
  const seen: string[] = [];
  const result = await runTransferExperiment({
    cases: [{
      id: "cross-domain",
      sourceClass: "network-debug",
      targetClass: "build-repair",
      goal: "repair fixture",
    }],
    repeats: 2,
    runner: {
      async run(testCase, trial) {
        seen.push(`${testCase.id}:${trial.trial}:${trial.arm}`);
        return {
          success: trial.arm === "experience",
          score: trial.arm === "experience" ? 0.8 : 0.2,
        };
      },
    },
  });

  expect(seen).toHaveLength(4);
  expect(result.effect.pairs).toBe(2);
  expect(result.effect.warnings).toContain("fewer than 5 paired trials");
});
