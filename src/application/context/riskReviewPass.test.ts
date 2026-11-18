import { expect, test } from "bun:test";
import { runRiskReviewPass } from "./riskReviewPass.ts";

test("pass with secret evidence reopens", () => {
  const result = runRiskReviewPass({
    review: { verdict: "pass", summary: "ok" },
    transcriptTexts: ["exported BEGIN RSA PRIVATE KEY"],
    strict: true,
  });
  expect(result.reopen).toBe(true);
  expect(result.line).toContain("reopen");
});

test("clean pass stays ok", () => {
  const result = runRiskReviewPass({
    review: { verdict: "pass", summary: "shipped" },
    transcriptTexts: ["fs_write ok"],
    spiOk: true,
  });
  expect(result.ok).toBe(true);
  expect(result.reopen).toBe(false);
});
