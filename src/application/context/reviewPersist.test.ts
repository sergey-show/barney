import { expect, test } from "bun:test";
import { oraclePersistHint, softReviewMissing } from "./reviewPersist.ts";

test("oraclePersistHint empty when missing", () => {
  expect(oraclePersistHint(null)).toBe("");
  expect(oraclePersistHint("  ")).toBe("");
});

test("oraclePersistHint wraps evidence", () => {
  expect(oraclePersistHint("oracle: ok=0 · miss")).toContain("Oracle fact");
});

test("softReviewMissing falls back", () => {
  expect(softReviewMissing({
    verdict: "fail",
    summary: "",
    needsResearch: false,
    missing: "ticket",
  })).toBe("ticket");
});
