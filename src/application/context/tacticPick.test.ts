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
