import { expect, test } from "bun:test";
import {
  admitNewSkill,
  canRewriteSkill,
  recordSkillOutcome,
} from "./bodyStability.ts";

test("quarantine promotes to verified then frozen; frozen is not rewritten", () => {
  let rec = admitNewSkill("learned-unrun-program", "certs", "unrun-program");
  expect(rec.status).toBe("quarantine");
  expect(canRewriteSkill(rec)).toBe(true);
  rec = recordSkillOutcome(rec, { success: true, transfer: false });
  expect(rec.status).toBe("quarantine");
  rec = recordSkillOutcome(rec, { success: true, transfer: false });
  expect(rec.status).toBe("verified");
  expect(canRewriteSkill(rec)).toBe(false);
  rec = recordSkillOutcome(rec, { success: true, transfer: true });
  expect(rec.status).toBe("frozen");
  expect(canRewriteSkill(rec)).toBe(false);
});

test("single transfer graduates quarantine immediately", () => {
  let rec = admitNewSkill("learned-x", "a", "general");
  rec = recordSkillOutcome(rec, { success: true, transfer: true });
  expect(rec.status).toBe("frozen");
});
