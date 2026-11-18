import { expect, test } from "bun:test";
import { consolidateMemories, redactMemorySecrets } from "./memoryConsolidator.ts";

test("preferences outrank tasks and secrets are redacted", () => {
  const result = consolidateMemories([
    {
      key: "task/old",
      title: "Old task",
      body: "fixed cookie bug",
      tags: ["task"],
      updatedAt: "2020-01-01",
    },
    {
      key: "pref/style",
      title: "User preference",
      body: "prefer short answers api_key=sk-abcdefghijklmnopqrstuvwxyz",
      tags: ["preference"],
      updatedAt: "2026-01-01",
    },
  ], { budgetBytes: 10_000 });
  expect(result.preferences.some((row) => row.includes("preference"))).toBe(true);
  expect(result.summary).toContain("[redacted]");
  expect(redactMemorySecrets("token=abc")).toContain("[redacted]");
});

test("respects byte budget", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    key: `task/${i}`,
    title: `Task ${i}`,
    body: "x".repeat(200),
    tags: ["task"],
  }));
  const result = consolidateMemories(items, { budgetBytes: 800 });
  expect(result.bytes).toBeLessThanOrEqual(800);
  expect(result.dropped).toBeGreaterThan(0);
});
