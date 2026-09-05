import { expect, test } from "bun:test";
import {
  emptyStats,
  formatStatsHint,
  preferredStrategies,
  recordStrategyOutcome,
} from "./taskClassStats.ts";

test("records and prefers winning strategies with enough samples", () => {
  let stats = emptyStats("sanitize");
  for (let i = 0; i < 3; i++) stats = recordStrategyOutcome(stats, "decompose", "success");
  stats = recordStrategyOutcome(stats, "research", "fail");
  stats = recordStrategyOutcome(stats, "research", "fail");
  stats = recordStrategyOutcome(stats, "research", "fail");
  expect(preferredStrategies(stats)).toContain("decompose");
  expect(formatStatsHint(stats)).toMatch(/decompose/);
});
