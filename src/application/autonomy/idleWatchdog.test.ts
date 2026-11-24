import { expect, test } from "bun:test";
import {
  progressSignature,
  StaleTracker,
  detectStaleProgress,
  staleProgressNudge,
} from "./idleWatchdog.ts";

const WRITE = (path: string) => `fs_write ${JSON.stringify({ path })}\nWrote ${path} (42 bytes)`;
const CHECK = "shell python -m pytest\nCheck passed: 3 tests";
const READ = "shell cat input.txt\nsome content here";
const EMPTY = "";

test("progressSignature keeps write/check/EXISTS lines, drops reads", () => {
  const sig = progressSignature([WRITE("a.txt"), CHECK, READ].join("\n"));
  expect(sig).toContain("fs_write");
  expect(sig).toContain("Check passed");
  expect(sig).not.toContain("some content here");
});

test("progressSignature empty when only reads", () => {
  expect(progressSignature(READ)).toBe("");
  expect(progressSignature(EMPTY)).toBe("");
});

test("StaleTracker: not stale before window threshold", () => {
  const t = new StaleTracker(4);
  for (let i = 0; i < 3; i++) t.note(READ);
  expect(t.verdict(2).stale).toBe(false);
});

test("StaleTracker: stale when only reads for windowSteps", () => {
  const t = new StaleTracker(4);
  for (let i = 0; i < 4; i++) t.note(READ);
  const v = t.verdict(3);
  expect(v.stale).toBe(true);
  if (v.stale) expect(v.reason).toContain("no artifact-evidence progress");
});

test("StaleTracker: not stale when a write appears mid-window", () => {
  const t = new StaleTracker(4);
  t.note(READ);
  t.note(READ);
  t.note(WRITE("a.txt")); // progress here
  t.note(READ);
  expect(t.verdict(3).stale).toBe(false);
});

test("StaleTracker: stale when same write signature repeats (no new writes)", () => {
  const t = new StaleTracker(4);
  // Same write repeated 4 times — no NEW progress, just the same file.
  for (let i = 0; i < 4; i++) t.note(WRITE("a.txt"));
  const v = t.verdict(3);
  expect(v.stale).toBe(true);
  if (v.stale) expect(v.reason).toContain("frozen");
});

test("StaleTracker: reset clears state", () => {
  const t = new StaleTracker(4);
  for (let i = 0; i < 4; i++) t.note(READ);
  expect(t.verdict(3).stale).toBe(true);
  t.reset();
  t.note(WRITE("a.txt"));
  expect(t.verdict(0).stale).toBe(false);
});

test("detectStaleProgress: not stale when window shorter than threshold", () => {
  const v = detectStaleProgress({ evidenceWindow: [READ, READ], windowSteps: 4 });
  expect(v.stale).toBe(false);
});

test("detectStaleProgress: stale when all reads in window", () => {
  const v = detectStaleProgress({ evidenceWindow: [READ, READ, READ, READ], windowSteps: 4 });
  expect(v.stale).toBe(true);
  if (v.stale) expect(v.reason).toContain("only reads");
});

test("detectStaleProgress: not stale when a write appears in window", () => {
  const v = detectStaleProgress({ evidenceWindow: [READ, READ, WRITE("a.txt"), READ], windowSteps: 4 });
  expect(v.stale).toBe(false);
});

test("detectStaleProgress: stale when same non-empty signature repeats", () => {
  const v = detectStaleProgress({
    evidenceWindow: [WRITE("a.txt"), WRITE("a.txt"), WRITE("a.txt"), WRITE("a.txt")],
    windowSteps: 4,
  });
  expect(v.stale).toBe(true);
  if (v.stale) expect(v.reason).toContain("frozen");
});

test("staleProgressNudge is imperative and names options", () => {
  const n = staleProgressNudge({ stale: true, reason: "no progress for 4 steps" });
  expect(n).toContain("[stale-watchdog]");
  expect(n).toContain("fs_write");
  expect(n).toContain("verify");
  expect(n).toContain("blocked");
});
