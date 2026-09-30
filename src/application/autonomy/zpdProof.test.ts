import { expect, test } from "bun:test";
import { judgeZpd3Proof, ZPD_FAIL_MARK, ZPD_PASS_MARK, zpd3ProofPath } from "./zpdProof.ts";
import { drillGoalForZpd, proposeAgendaItem } from "./agenda.ts";

test("zpd3 proof path is local executable", () => {
  expect(zpd3ProofPath("secret-leak")).toBe("proof-secret-leak.py");
});

test("ZPD-3 drill goal requires fail/pass markers", () => {
  const goal = drillGoalForZpd({
    failClass: "secret-leak",
    hint: "mask keys",
    count: 5,
    source: "capability",
  }, 3);
  expect(goal).toMatch(/ZPD-3/);
  expect(goal).toContain("proof-secret-leak.py");
  expect(goal).toContain(ZPD_FAIL_MARK);
  expect(goal).toContain(ZPD_PASS_MARK);
  expect(goal).not.toMatch(/rehearsal-/);
  expect(proposeAgendaItem({
    failClass: "a",
    hint: "h",
    count: 5,
    source: "backlog",
  }).goal).toMatch(/proof-a\.py|ZPD_PROOF/);
});

test("judgeZpd3Proof requires script and both markers", () => {
  const fail = judgeZpd3Proof({
    failClass: "secret-leak",
    evidence: "wrote recovery-secret-leak.md only",
    goal: "ZPD-3",
  });
  expect(fail.ok).toBe(false);
  expect(fail.reason).toMatch(/missing executable proof/);

  const half = judgeZpd3Proof({
    failClass: "secret-leak",
    evidence: `
fs_write path=proof-secret-leak.py
fs_write path=recovery-secret-leak.md
shell: ${ZPD_FAIL_MARK}
`,
  });
  expect(half.ok).toBe(false);
  expect(half.passShown).toBe(false);

  const ok = judgeZpd3Proof({
    failClass: "secret-leak",
    evidence: `
wrote proof-secret-leak.py
wrote recovery-secret-leak.md
console: ${ZPD_FAIL_MARK}
console: ${ZPD_PASS_MARK}
`,
  });
  expect(ok.ok).toBe(true);
  expect(ok.reason).toMatch(/fail\+pass/);
});
