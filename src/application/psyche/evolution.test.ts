import { expect, test } from "bun:test";
import { admitNewSkill, graduateSkillStatus } from "../context/bodyStability.ts";
import {
  bucketSkills,
  buildPsycheEvolution,
  parseFrustrationFromMarkers,
  parseFrustrationFromTranscript,
} from "./evolution.ts";

test("bucketSkills splits quarantine / verified / frozen", () => {
  const q = admitNewSkill("q-skill", "sanitize", "fail");
  const v = graduateSkillStatus({ ...admitNewSkill("v-skill", "sanitize", "fail"), wins: 2 });
  const f = graduateSkillStatus({ ...admitNewSkill("f-skill", "sanitize", "fail"), wins: 3, transfers: 1 });
  const buckets = bucketSkills([q, v, f]);
  expect(buckets.quarantine).toEqual(["q-skill"]);
  expect(buckets.verified).toContain("v-skill");
  expect(buckets.frozen).toContain("f-skill");
});

test("frustration parsers read episode markers and transcript", () => {
  expect(parseFrustrationFromMarkers(["pe:1", "frustration:4"])).toBe(4);
  expect(parseFrustrationFromTranscript([
    { kind: "assistant", text: "ok" },
    { kind: "system", text: "frustration: 3 · wanting" },
  ])).toBe(3);
});

test("buildPsycheEvolution is read-only aggregate", () => {
  const evo = buildPsycheEvolution({
    shadow: ["a", "b"],
    light: ["ok"],
    skills: [admitNewSkill("house-redact", "sanitize", "fail")],
    agenda: [{
      id: "a1",
      goal: "drill redact",
      reason: "gap",
      failClass: "sanitize",
      status: "pending",
      createdAt: "2026-01-01T00:00:00.000Z",
      zpdLevel: 2,
    }],
    designSealed: true,
    frustration: 2,
    frustrationSource: "episode",
    dreamBody: "Compressed shadow into: prefer house tokens",
    dreamUpdatedAt: "2026-01-02T00:00:00.000Z",
    now: "2026-01-03T00:00:00.000Z",
  });
  expect(evo.shadowCount).toBe(2);
  expect(evo.skills.quarantineCount).toBe(1);
  expect(evo.agenda.nextGoal).toBe("drill redact");
  expect(evo.lastDreamSummary).toContain("house tokens");
  expect(evo.frustration).toBe(2);
});
