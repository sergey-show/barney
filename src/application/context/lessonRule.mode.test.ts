import { expect, test } from "bun:test";
import { pickRuleNotes, lessonRule } from "./lessonRule.ts";

test("failure-mode rules rank above foreign task-class noise", () => {
  const picked = pickRuleNotes([
    { key: "rule/other/x", title: "x", body: "other class rule", tags: ["rule", "other"] },
    {
      key: "rule/mode/unrun-program/host",
      title: "mode",
      body: "[unrun-program] if shell:openssl fails, do not repeat shell:openssl; next was shell:python3.",
      tags: ["rule", "fail", "unrun-program", "certs"],
    },
    { key: "rule/scripts/hold", title: "hold", body: "Change tool after a fail.", tags: ["rule", "fail", "scripts"] },
  ], "scripts", 3, [], ["unrun-program"]);
  expect(picked[0]?.line).toContain("shell:openssl");
  expect(picked[0]?.sourceClass).toBe("mode:unrun-program");
});

test("lessonRule keys by failure mode when present", () => {
  const rule = lessonRule({
    taskClass: "scripts",
    goal: "run checker",
    verdict: "fail",
    summary: "openssl failed",
    failClass: "unrun-program",
    failedFamily: "shell:openssl",
    recoveredBy: "shell:python3",
  });
  expect(rule.key).toContain("mode/unrun-program");
});
