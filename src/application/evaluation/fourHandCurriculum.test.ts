import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HARD_TRANSFER_CASES,
  kernelLiftOnTest,
  summarizeExperienceMetrics,
  transferSuccessLift,
  type FourHandCaseResult,
} from "./fourHandCurriculum.ts";

test("hard transfer cases have working verifiers", () => {
  for (const item of HARD_TRANSFER_CASES) {
    const dir = mkdtempSync(join(tmpdir(), `hard-${item.id}-`));
    try {
      item.setupTest(dir);
      expect(item.verifyTest(dir).ok).toBe(false);
      if (item.setupTrain && item.verifyTrain) {
        const trainDir = mkdtempSync(join(tmpdir(), `hard-train-${item.id}-`));
        try {
          item.setupTrain(trainDir);
          expect(item.verifyTrain(trainDir).ok).toBe(false);
        } finally {
          rmSync(trainDir, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  expect(HARD_TRANSFER_CASES.map((c) => c.id)).toEqual(["sanitize-shifted", "merge-shifted"]);
});

test("sanitize-shifted passes only with placeholders + exact audit", () => {
  const item = HARD_TRANSFER_CASES[0]!;
  const dir = mkdtempSync(join(tmpdir(), "sanitize-ok-"));
  try {
    item.setupTest(dir);
    writeFileSync(
      join(dir, ".env"),
      [
        "APP_NAME=demo",
        "REGION=eu-central-1",
        "AWS_ACCESS_KEY_ID=<your-aws-access-key-id>",
        "GITHUB_TOKEN=<your-github-token>",
        "SLACK_BOT_TOKEN=<your-slack-bot-token>",
        "",
      ].join("\n"),
    );
    writeFileSync(join(dir, "audit.txt"), "aws=1\ngithub=1\nslack=1\n");
    expect(item.verifyTest(dir).ok).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("transferSuccessLift and metrics", () => {
  const arms = [
    { arm: "kernel-train" as const, ok: true, detail: "", attempts: 1 },
    { arm: "kernel-test" as const, ok: true, detail: "", attempts: 1, recallHit: true, recallUsed: true },
    { arm: "no-kernel" as const, ok: false, detail: "", attempts: 1 },
    { arm: "kernel-fresh" as const, ok: false, detail: "", attempts: 1 },
  ];
  expect(transferSuccessLift(arms)).toBe(1);
  expect(kernelLiftOnTest(arms)).toBe(0);
  const cases: FourHandCaseResult[] = [{
    caseId: "sanitize-shifted",
    arms,
    transferSuccessLift: 1,
    kernelLift: 0,
  }];
  const metrics = summarizeExperienceMetrics(cases);
  expect(metrics.transferSuccessLift).toBe(1);
  expect(metrics.recallHitRate).toBe(1);
  expect(metrics.recallUsedRate).toBe(1);
});
