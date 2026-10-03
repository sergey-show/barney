import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../../composition/Kernel.ts";
import { skillBodyKey } from "../context/bodyStability.ts";
import { extractRecalledSkillNames } from "../plasticity/plasticity.ts";
import { summarizeExperienceMetrics } from "./fourHandCurriculum.ts";
import { parseRecallSignals } from "./fourHandRunner.ts";
import { seedVerifiedTransferSkill } from "./seedTransferSkill.ts";

test("seedVerifiedTransferSkill pins frozen skill into SkillsLock", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-skill-seed-"));
  const kernel = new Kernel(home);
  const agent = await kernel.boot();
  const rec = await seedVerifiedTransferSkill(kernel, {
    name: "house-redact-tokens",
    klass: "sanitize",
    procedure: ["use <barney-redact-aws>"],
    fingerprints: ["<barney-redact-aws>"],
  });
  expect(rec.status).toBe("frozen");
  const note = await kernel.memories.get(skillBodyKey("house-redact-tokens"));
  expect(note?.tags).toContain("frozen");
  const reloaded = await kernel.agents.get(agent.id.value);
  expect(reloaded?.skillsLock.has("skill", "house-redact-tokens")).toBe(true);
});

test("skill_reuse transcript + metrics close Four-Hand skillReuseRate gap", () => {
  const signal = parseRecallSignals([
    { id: "1", kind: "system", text: "recall_hit: 1 · recall_used: 1 · recall_helped: 1", at: "" },
    { id: "2", kind: "system", text: "skill_reuse: 1 · names=house-redact-tokens", at: "" },
  ]);
  expect(signal.skillReused).toBe(true);
  const names = extractRecalledSkillNames({
    skills: ["[skill:house-redact-tokens] status=frozen class=sanitize"],
    rules: [],
  });
  expect(names).toEqual(["house-redact-tokens"]);
  const metrics = summarizeExperienceMetrics([{
    caseId: "house-redact",
    transferSuccessLift: 1,
    kernelLift: 0,
    arms: [
      { arm: "kernel-train", ok: true, detail: "ok", attempts: 0 },
      {
        arm: "kernel-test",
        ok: true,
        detail: "ok",
        attempts: 1,
        recallHit: true,
        recallUsed: true,
        recallHelped: true,
        skillReused: true,
        skillFalse: false,
      },
      { arm: "no-kernel", ok: false, detail: "fail", attempts: 1 },
      { arm: "kernel-fresh", ok: false, detail: "fail", attempts: 1 },
    ],
  }]);
  expect(metrics.skillReuseRate).toBe(1);
  expect(metrics.falseSkillRate).toBe(0);
});

test("false_skill_rate documents pinned skill used on a failed kernel-test", () => {
  const signal = parseRecallSignals([
    { id: "1", kind: "system", text: "recall_hit: 1 · recall_used: 1 · recall_helped: 0", at: "" },
    { id: "2", kind: "system", text: "skill_false: 1 · names=house-redact-tokens", at: "" },
  ]);
  expect(signal.skillFalse).toBe(true);
  const metrics = summarizeExperienceMetrics([{
    caseId: "house-redact",
    transferSuccessLift: 0,
    kernelLift: 0,
    arms: [
      { arm: "kernel-train", ok: true, detail: "ok", attempts: 0 },
      {
        arm: "kernel-test",
        ok: false,
        detail: "tokens=false",
        attempts: 2,
        recallHit: true,
        recallUsed: true,
        skillReused: false,
        skillFalse: true,
      },
      { arm: "no-kernel", ok: false, detail: "fail", attempts: 1 },
      { arm: "kernel-fresh", ok: false, detail: "fail", attempts: 1 },
    ],
  }]);
  expect(metrics.falseSkillRate).toBe(1);
  expect(metrics.skillReuseRate).toBe(0);
});
