import { expect, test } from "bun:test";
import { cycleStrategy, needsUser, stopAfterFail, toolFamily, wantingWithoutLiking } from "./controlLoop.ts";

test("wanting without liking forces a family change, not more of the same", () => {
  expect(wantingWithoutLiking({ attempts: 1, failed: 1 })).toBe(false);
  expect(wantingWithoutLiking({ attempts: 2, failed: 1 })).toBe(true);
  expect(wantingWithoutLiking({ attempts: 3, failed: 4, passed: true })).toBe(false);
  expect(toolFamily("browser_open")).toBe("browser");
  expect(toolFamily("shell")).toBe("shell");
});

test("cycles unused strategies then rotates instead of parking", () => {
  expect(cycleStrategy(["retry_with_error"], 1)).toBe("recall_failures");
  const used = ["retry_with_error", "recall_failures", "research", "decompose", "write_capability", "switch_model"] as const;
  const a = cycleStrategy([...used], 6);
  const b = cycleStrategy([...used], 7);
  expect(a).not.toBe("park_and_ask");
  expect(b).not.toBe(a);
});

test("needsUser only for a real secret or choice", () => {
  expect(needsUser({ summary: "no VM list yet", missing: "open the host" })).toBe(false);
  expect(needsUser({ summary: "blocked", missing: "need the vcenter password" })).toBe(true);
  expect(needsUser({
    summary: "replace secrets with <your-github-token>",
    missing: "Actual file modifications replacing secrets with placeholders",
  })).toBe(false);
  expect(needsUser({
    summary: "still missing replacements",
    missing: "need to replace secrets in ray_cluster.yaml",
  })).toBe(false);
});

test("keeps going until pass, budget, or a user blocker", () => {
  const review = { verdict: "fail", summary: "no list", missing: "VM list" };
  expect(stopAfterFail(review, { exhausted: false, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 2 })).toBe("continue");
  expect(stopAfterFail(review, { exhausted: true, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 2 })).toBe("budget");
  expect(stopAfterFail({ verdict: "fail", summary: "x", missing: "which host should I use" }, {
    exhausted: false, attempts: 4, maxAttempts: 12, minStrategies: 3, used: 3,
  })).toBe("need_user");
});
