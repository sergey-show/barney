import { expect, test } from "bun:test";
import { AutonomyScheduler } from "./AutonomyScheduler.ts";

test("AutonomyScheduler enforces idle gap", () => {
  const s = new AutonomyScheduler({ idleAt: 1_000 }, 45_000);
  expect(s.tryBeginIdle(10_000)).toBe(false);
  expect(s.tryBeginIdle(50_000)).toBe(true);
  expect(s.tryBeginIdle(50_100)).toBe(false);
});

test("AutonomyScheduler marks study cooldown", () => {
  const s = new AutonomyScheduler();
  s.mark("study", 100);
  expect(s.cooldownMs("study", 250)).toBe(150);
});
