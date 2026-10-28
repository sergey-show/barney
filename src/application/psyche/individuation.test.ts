import { expect, test } from "bun:test";
import {
  appraiseSelf,
  emptyLedger,
  migrateSamostLines,
  projectSamost,
  pruneSelfLedger,
  renderAppraisalPrompt,
  syncFromCapability,
  upsertLight,
  upsertShadow,
} from "./individuation.ts";
import { seedSamost } from "./samost.ts";
import type { ExperienceRecallBags } from "../experience/experienceRecall.ts";

const emptyBags: ExperienceRecallBags = { shadow: [], rules: [], skills: [], episodeLines: [] };
const hitBags: ExperienceRecallBags = {
  shadow: [],
  rules: ["[rule:x] prefer placeholders"],
  skills: [],
  episodeLines: [],
};

test("upsertLight requires refs and rejects vanity", () => {
  let ledger = emptyLedger();
  ledger = upsertLight(ledger, { kind: "domain", claim: "I am an expert", refs: ["x"], confidence: 0.9 });
  expect(ledger.light).toHaveLength(0);
  ledger = upsertLight(ledger, { kind: "skill", claim: "Skill redact · strong", refs: ["skill:redact"], confidence: 0.6, band: "strong" });
  expect(ledger.light).toHaveLength(1);
  expect(ledger.light[0]?.refs).toContain("skill:redact");
});

test("rejected shadow needs pathChanged", () => {
  let ledger = emptyLedger();
  ledger = upsertShadow(ledger, { kind: "rejected", claim: "skip grep", refs: ["fam:grep"] });
  expect(ledger.shadow).toHaveLength(0);
  ledger = upsertShadow(ledger, { kind: "rejected", claim: "skip grep", refs: ["fam:grep"], pathChanged: true });
  expect(ledger.shadow).toHaveLength(1);
});

test("appraisal: fresh+empty → blind/study", () => {
  const a = appraiseSelf({
    query: "wire stripe webhooks",
    reuse: "fresh",
    bags: emptyBags,
    ledger: emptyLedger(),
    onBlind: "study",
  });
  expect(a.verdict).toBe("blind");
  expect(a.path).toBe("study");
  expect(a.line).toContain("self_appraisal:");
});

test("appraisal: strong light → competent/act", () => {
  let ledger = emptyLedger();
  ledger = upsertLight(ledger, {
    kind: "skill",
    claim: "Skill stripe-hook · strong",
    refs: ["skill:stripe-hook"],
    confidence: 0.7,
    band: "strong",
    helped: true,
  });
  const a = appraiseSelf({
    query: "stripe webhook",
    reuse: "in_class",
    bags: hitBags,
    ledger,
  });
  expect(a.verdict).toBe("competent");
  expect(a.path).toBe("act");
});

test("appraisal: constrained without light → park", () => {
  let ledger = emptyLedger();
  ledger = upsertShadow(ledger, {
    kind: "limit",
    claim: "sandbox deny write outside cwd",
    refs: ["limit:sandbox"],
    weight: 2,
  });
  const a = appraiseSelf({
    query: "write /etc/passwd",
    reuse: "fresh",
    bags: emptyBags,
    ledger,
    constrained: true,
    onConstrained: "park",
  });
  expect(a.verdict).toBe("constrained");
  expect(a.path).toBe("park");
});

test("projectSamost and migrate legacy lines", () => {
  const samost = seedSamost();
  let ledger = migrateSamostLines(emptyLedger(), samost);
  expect(ledger.shadow.length).toBeGreaterThan(0);
  ledger = upsertLight(ledger, {
    kind: "method",
    claim: "Prefer fs_edit after inspect",
    refs: ["method:fs_edit"],
    confidence: 0.6,
    band: "ok",
  });
  const projected = projectSamost(samost, ledger);
  expect(projected.light.some((line) => /fs_edit/i.test(line))).toBe(true);
  expect(renderAppraisalPrompt(appraiseSelf({
    query: "edit files",
    reuse: "transfer",
    bags: hitBags,
    ledger,
  }))).toContain("Self-appraisal:");
});

test("syncFromCapability and prune", () => {
  let ledger = syncFromCapability(emptyLedger(), [
    {
      key: "house-redact",
      kind: "skill",
      band: "strong",
      score: 3,
      wins: 4,
      fails: 0,
      strength: 0.8,
      ageDays: 1,
      hint: "frozen",
    },
    {
      key: "secret-leak",
      kind: "failClass",
      band: "weak",
      score: -3,
      wins: 0,
      fails: 3,
      strength: 0,
      ageDays: 0,
      hint: "repeat",
    },
  ]);
  expect(ledger.light.some((l) => l.refs.includes("skill:house-redact"))).toBe(true);
  expect(ledger.shadow.some((s) => s.kind === "blind")).toBe(true);
  ledger = pruneSelfLedger(ledger);
  expect(ledger.light.length + ledger.shadow.length).toBeGreaterThan(0);
});
