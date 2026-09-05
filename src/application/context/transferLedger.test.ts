import { expect, test } from "bun:test";
import {
  classifyReuse,
  emptyTransferStats,
  extractGoalHashes,
  formatTransferHint,
  goalHash,
  recordReuse,
  transferRate,
} from "./transferLedger.ts";

test("same goal hash is memorize, foreign class is transfer", () => {
  const g = goalHash("Write check.py and run it");
  expect(classifyReuse({
    goalHash: g,
    priorGoalHashes: [g],
    currentClass: "scripts",
    recalledFromClasses: ["certs"],
  })).toBe("memorize");
  expect(classifyReuse({
    goalHash: goalHash("new goal entirely"),
    priorGoalHashes: [g],
    currentClass: "scripts",
    recalledFromClasses: ["certs"],
  })).toBe("transfer");
  expect(classifyReuse({
    goalHash: goalHash("another scripts goal"),
    priorGoalHashes: [g],
    currentClass: "scripts",
    recalledFromClasses: ["scripts"],
  })).toBe("in_class");
  expect(classifyReuse({
    goalHash: goalHash("brand new"),
    priorGoalHashes: [],
    currentClass: "scripts",
    recalledFromClasses: [],
  })).toBe("fresh");
});

test("transfer rate ignores memorize successes", () => {
  let stats = emptyTransferStats();
  stats = recordReuse(stats, "memorize", "success");
  stats = recordReuse(stats, "memorize", "success");
  stats = recordReuse(stats, "transfer", "success");
  stats = recordReuse(stats, "in_class", "success");
  expect(transferRate(stats)).toBeCloseTo(0.5);
  expect(formatTransferHint(stats)).toMatch(/transfer 1/);
  expect(extractGoalHashes([
    { markers: ["goalHash:abc"], goal: "x" },
    { markers: [], goal: "Write check.py" },
  ]).length).toBe(2);
});
