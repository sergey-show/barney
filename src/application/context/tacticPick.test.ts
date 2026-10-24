import { expect, test } from "bun:test";
import { pickTactic } from "./tacticPick.ts";
import { measureProgress } from "./progressSignal.ts";

test("tactic pushes mutate when delivery inspected without edits", () => {
  const progress = measureProgress({
    latest: "sanitize the repo of API keys",
    evidence: [
      'fs_search {"query":"AKIA"}',
      "ray_cluster.yaml:29",
      'shell {"command":"grep -r AKIA ."}',
      "exit 0",
    ].join("\n"),
  });
  const tactic = pickTactic({
    strategy: "decompose",
    saturated: ["shell:grep"],
    progress,
    failedFamily: "shell:grep",
  });
  expect(tactic.avoidFamilies).toContain("shell:grep");
  expect(tactic.line).toMatch(/Apply edits|fs_edit|Attack/i);
  expect(tactic.preferFamilies.some((f) => f.startsWith("fs_"))).toBe(true);
});

test("stalled progress rotates away from prior prefer", () => {
  const progress = measureProgress({
    latest: "fix the bug",
    evidence: "fs_read ok\ngrep hit",
  });
  const first = pickTactic({
    strategy: "retry_with_error",
    saturated: [],
    progress,
  });
  const stalled = pickTactic({
    strategy: "retry_with_error",
    saturated: [],
    progress: { ...progress, delta: "flat", secondWind: false },
    priorPrefer: first.preferFamilies,
    stalled: true,
  });
  expect(stalled.line).toMatch(/No new evidence|change tool family/i);
  for (const fam of first.preferFamilies.slice(0, 2)) {
    expect(stalled.avoidFamilies).toContain(fam);
  }
});
