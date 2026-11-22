import { expect, test } from "bun:test";
import {
  appendRejection,
  isResubmitBlocked,
  parseRejectionLedger,
  scoreSoftHurt,
  softHurtDecide,
  writeFingerprint,
} from "./softHurtGate.ts";

test("success with recovery scores positive net", () => {
  const s = scoreSoftHurt({ outcomeOk: true, recovered: true, predictionError: 1 });
  expect(s.net).toBeGreaterThan(0.5);
});

test("fail with false skills scores hurt-heavy", () => {
  const s = scoreSoftHurt({
    outcomeOk: false,
    falseSkillCount: 2,
    recallUsedButFailed: true,
  });
  expect(s.hurt).toBeGreaterThan(s.gain);
});

test("softHurtDecide refuses when hurt dominates", () => {
  const scores = { gain: 0.2, hurt: 0.6, net: -0.4 };
  const d = softHurtDecide({ priorAdmit: true, scores });
  expect(d.admit).toBe(false);
  expect(d.reason).toContain("refuse");
});

test("softHurtDecide admits when net clears floor", () => {
  const scores = scoreSoftHurt({ outcomeOk: true, pinConvention: true });
  const d = softHurtDecide({ priorAdmit: true, scores });
  expect(d.admit).toBe(true);
});

test("selfreport mode skips soft-hurt filter", () => {
  const d = softHurtDecide({
    priorAdmit: true,
    mode: "selfreport",
    scores: { gain: 0, hurt: 1, net: -1 },
  });
  expect(d.admit).toBe(true);
});

test("rejection ledger blocks recent resubmit", () => {
  const fp = writeFingerprint("failure_rule", "do not invent tokens", "secret-leak");
  let ledger = parseRejectionLedger(null);
  ledger = appendRejection(ledger, {
    fingerprint: fp,
    writeKind: "failure_rule",
    reason: "soft-hurt",
    at: new Date().toISOString(),
  });
  expect(isResubmitBlocked(ledger, fp)).toBe(true);
  expect(isResubmitBlocked(ledger, "other")).toBe(false);
});
