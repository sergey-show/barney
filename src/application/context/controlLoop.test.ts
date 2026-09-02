import { expect, test } from "bun:test";
import {
  cycleStrategy,
  familyKey,
  frustrationCritical,
  frustrationScore,
  needsUser,
  stopAfterFail,
  toolFamily,
  wantingWithoutLiking,
} from "./controlLoop.ts";

test("wanting without liking is one extra path this message, not session age or family fails", () => {
  expect(wantingWithoutLiking({ extraApproaches: 0 })).toBe(false);
  expect(wantingWithoutLiking({ extraApproaches: 1 })).toBe(true);
  expect(wantingWithoutLiking({ extraApproaches: 4, passed: true })).toBe(false);
});

test("wanting does not stop while requested artifacts are still unwritten", () => {
  expect(wantingWithoutLiking({
    extraApproaches: 3,
    leftover: { unwritten: ["/app/program.py"] },
  })).toBe(false);
  expect(wantingWithoutLiking({
    extraApproaches: 1,
    leftover: { unwritten: [] },
  })).toBe(true);
});

test("frustration score hits critical and forces wanting halt", () => {
  expect(frustrationScore({ extraApproaches: 1, saturatedFamilies: 1, sameFailureCount: 2 })).toBe(4);
  expect(frustrationCritical(4)).toBe(false);
  expect(frustrationCritical(5)).toBe(true);
  const review = { verdict: "fail", summary: "no list", missing: "VM list" };
  expect(stopAfterFail(review, {
    exhausted: false, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 1, wanting: false, frustration: 5,
  })).toBe("wanting");
});

test("tool family and shell verb stay on the observe layer", () => {
  expect(toolFamily("browser_open")).toBe("browser");
  expect(toolFamily("shell")).toBe("shell");
  expect(familyKey({ name: "shell", arguments: { command: "openssl genrsa -out /work/key.pem 2048" } })).toBe("shell:openssl");
  expect(familyKey({ name: "shell", arguments: { command: "PATH=/usr/bin python3 /work/check.py" } })).toBe("shell:python3");
  expect(familyKey({ name: "shell", arguments: { command: "cd /app && python3 /app/filter.py" } })).toBe("shell:python3");
  expect(familyKey({ name: "shell", arguments: { command: "cd /work; python3 check.py" } })).toBe("shell:python3");
  expect(familyKey({ name: "browser_click", arguments: { text: "Login" } })).toBe("browser");
});

test("cycles unused strategies then rotates instead of parking", () => {
  expect(cycleStrategy(["retry_with_error"], 1)).toBe("recall_failures");
  const used = ["retry_with_error", "recall_failures", "research", "decompose", "write_capability", "switch_model"] as const;
  const a = cycleStrategy([...used], 6);
  const b = cycleStrategy([...used], 7);
  expect(a).not.toBe("park_and_ask");
  expect(b).not.toBe(a);
});

test("skips research when the miss is a local file", () => {
  expect(cycleStrategy(["recall_failures"], 2, true)).toBe("decompose");
  expect(cycleStrategy(["recall_failures"], 2, false)).toBe("research");
});

test("needsUser follows structured reviewer field", () => {
  expect(needsUser({ needsUser: false })).toBe(false);
  expect(needsUser({})).toBe(false);
  expect(needsUser({ needsUser: true })).toBe(true);
});

test("keeps going until pass, budget, or a user blocker", () => {
  const review = { verdict: "fail", summary: "no list", missing: "VM list" };
  expect(stopAfterFail(review, { exhausted: false, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 2 })).toBe("continue");
  expect(stopAfterFail(review, { exhausted: false, attempts: 8, maxAttempts: 12, minStrategies: 3, used: 4, wanting: false })).toBe("continue");
  expect(stopAfterFail(review, { exhausted: true, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 2 })).toBe("budget");
  expect(stopAfterFail({ verdict: "fail", summary: "x", missing: "which host", needsUser: true }, {
    exhausted: false, attempts: 4, maxAttempts: 12, minStrategies: 3, used: 3,
  })).toBe("need_user");
});

test("wanting without liking stops the persist loop, not another strategy", () => {
  const review = { verdict: "fail", summary: "no list", missing: "VM list" };
  expect(stopAfterFail(review, {
    exhausted: false, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 1, wanting: true,
  })).toBe("wanting");
  expect(stopAfterFail({ verdict: "pass", summary: "done" }, {
    exhausted: false, attempts: 2, maxAttempts: 12, minStrategies: 3, used: 1, wanting: true,
  })).toBe("pass");
});
