import { expect, test } from "bun:test";
import {
  admitNewSkill,
  canRewriteSkill,
  graduateSkillStatus,
  recordSkillOutcome,
  skillEligibleForLock,
} from "./bodyStability.ts";

test("quarantine promotes to verified then frozen; frozen is not rewritten", () => {
  let rec = admitNewSkill("learned-unrun-program", "certs", "unrun-program");
  expect(rec.status).toBe("quarantine");
  expect(canRewriteSkill(rec)).toBe(true);
  expect(skillEligibleForLock(rec)).toBe(false);
  rec = recordSkillOutcome(rec, { success: true, transfer: false });
  expect(rec.status).toBe("quarantine");
  rec = recordSkillOutcome(rec, { success: true, transfer: false });
  expect(rec.status).toBe("verified");
  expect(skillEligibleForLock(rec)).toBe(true);
  expect(canRewriteSkill(rec)).toBe(false);
  rec = recordSkillOutcome(rec, { success: true, transfer: true });
  expect(rec.status).toBe("frozen");
  expect(canRewriteSkill(rec)).toBe(false);
});

test("single transfer graduates quarantine immediately", () => {
  let rec = admitNewSkill("learned-x", "a", "general");
  rec = recordSkillOutcome(rec, { success: true, transfer: true });
  expect(rec.status).toBe("frozen");
  expect(skillEligibleForLock(rec)).toBe(true);
});

test("graduateSkillStatus is idempotent on already-frozen", () => {
  let rec = admitNewSkill("learned-y", "a", "b");
  rec = recordSkillOutcome(rec, { success: true, transfer: true });
  const again = graduateSkillStatus(rec);
  expect(again.status).toBe("frozen");
});
