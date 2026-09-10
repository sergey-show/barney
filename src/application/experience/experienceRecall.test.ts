import { expect, test } from "bun:test";
import {
  detectRecallUsed,
  experienceRecallHit,
  finalizeRecallSignal,
  formatBagsCount,
  renderExperienceRecall,
  type ExperienceRecallBags,
} from "./experienceRecall.ts";

const bags: ExperienceRecallBags = {
  shadow: ["[fail:secret-leak] do not echo live keys"],
  rules: ["[rule:rule/sanitize/mode/secret-leak] Prefer placeholders; do not write AWS keys"],
  skills: ["[skill:recover-secret-leak] status=quarantine class=sanitize"],
  episodeLines: ["[ok:sanitize] sanitize .env → use placeholders"],
};

test("formatBagsCount and hit", () => {
  expect(formatBagsCount(bags)).toBe("shadow=1 rules=1 skills=1 episodes=1");
  expect(experienceRecallHit(bags)).toBe(true);
  expect(experienceRecallHit({ shadow: [], rules: [], skills: [], episodeLines: [] })).toBe(false);
});

test("renderExperienceRecall includes three bags", () => {
  const text = renderExperienceRecall(bags);
  expect(text).toContain("Shadow recall");
  expect(text).toContain("Rule recall");
  expect(text).toContain("Skill recall");
});

test("detectRecallUsed fingerprints rule key and skill", () => {
  expect(detectRecallUsed(bags, "I will follow rule/sanitize/mode/secret-leak")).toBe(true);
  expect(detectRecallUsed(bags, "invoke recover-secret-leak")).toBe(true);
  expect(detectRecallUsed(bags, "hello world")).toBe(false);
});

test("finalizeRecallSignal sets hit/used/helped", () => {
  const used = finalizeRecallSignal({
    bags,
    actText: "Use placeholders; avoid secret-leak",
    planText: "prefer fs_write",
    outcomeOk: true,
  });
  expect(used.recallHit).toBe(true);
  expect(used.recallUsed).toBe(true);
  expect(used.recallHelped).toBe(true);
  expect(used.line).toContain("recall_hit: 1");
  expect(used.line).toContain("recall_used: 1");

  const ignored = finalizeRecallSignal({
    bags,
    actText: "unrelated chatter",
    outcomeOk: false,
  });
  expect(ignored.recallUsed).toBe(false);
  expect(ignored.recallHelped).toBe(false);
});
