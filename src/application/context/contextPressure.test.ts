import { expect, test } from "bun:test";
import { assessContextPressure } from "./contextPressure.ts";

test("ok when under thresholds", () => {
  const p = assessContextPressure({
    transcriptChars: 1_000,
    durableTurns: 4,
    tokensUsed: 100,
    tokenLimit: 10_000,
  });
  expect(p.level).toBe("ok");
  expect(p.recentCount).toBe(14);
});

test("warn at ~70% tokens or large transcript", () => {
  const byTokens = assessContextPressure({
    transcriptChars: 1_000,
    durableTurns: 4,
    tokensUsed: 7_200,
    tokenLimit: 10_000,
  });
  expect(byTokens.level).toBe("warn");
  expect(byTokens.recentCount).toBe(10);

  const byChars = assessContextPressure({
    transcriptChars: 65_000,
    durableTurns: 4,
    tokensUsed: 100,
    tokenLimit: 10_000,
  });
  expect(byChars.level).toBe("warn");
});

test("critical at ~90% tokens — tightest pack", () => {
  const p = assessContextPressure({
    transcriptChars: 1_000,
    durableTurns: 4,
    tokensUsed: 9_100,
    tokenLimit: 10_000,
  });
  expect(p.level).toBe("critical");
  expect(p.recentCount).toBe(6);
  expect(p.maxRecentChars).toBe(6_000);
});
