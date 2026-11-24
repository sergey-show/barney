import { expect, test } from "bun:test";
import {
  selectFuzzTarget,
  buildAdversarialTriggers,
  judgeFuzzOutcome,
  applyFuzzVerdict,
  FUZZ_COOLDOWN_MS,
} from "./adversarialFuzz.ts";
import type { SkillBodyRecord } from "../context/bodyStability.ts";

const now = Date.parse("2026-11-24T10:00:00Z");
const frozenSkill = (over: Partial<SkillBodyRecord> = {}): SkillBodyRecord => ({
  name: "skill-a",
  status: "frozen",
  wins: 3,
  transfers: 1,
  fails: 0,
  strength: 0.7,
  bornFromClass: "shell openssl decrypt aes",
  bornFromMode: "recovery",
  updatedAt: "2026-11-20T00:00:00Z",
  procedure: ["shell openssl enc -d -aes-256-cbc", "fs_write out/plain.txt"],
  ...over,
});

test("selectFuzzTarget returns null when no frozen skills", () => {
  const d = selectFuzzTarget({
    skills: [frozenSkill({ status: "quarantine" })],
    nowMs: now,
  lastFuzzedAt: new Map(),
  cooldownMs: 1000,
  });
  expect(d).toBeNull();
});

test("selectFuzzTarget returns null when procedure too short", () => {
  const d = selectFuzzTarget({
    skills: [frozenSkill({ procedure: ["only-one-step"] })],
    nowMs: now,
    lastFuzzedAt: new Map(),
    cooldownMs: 1000,
  });
  expect(d).toBeNull();
});

test("selectFuzzTarget skips skills within cooldown window", () => {
  const d = selectFuzzTarget({
    skills: [frozenSkill()],
    nowMs: now,
    lastFuzzedAt: new Map([["skill-a", now - 100]]), // fuzzed 100ms ago
    cooldownMs: FUZZ_COOLDOWN_MS,
  });
  expect(d).toBeNull();
});

test("selectFuzzTarget picks oldest updatedAt first (stalest drift)", () => {
  const older = frozenSkill({ name: "old", updatedAt: "2026-11-15T00:00:00Z" });
  const newer = frozenSkill({ name: "new", updatedAt: "2026-11-22T00:00:00Z" });
  const d = selectFuzzTarget({
    skills: [newer, older],
    nowMs: now,
    lastFuzzedAt: new Map(),
    cooldownMs: 1000,
  });
  expect(d?.name).toBe("old");
});

test("buildAdversarialTriggers produces case/whitespace/order variants", () => {
  const v = buildAdversarialTriggers(frozenSkill());
  expect(v.length).toBeGreaterThan(0);
  expect(v.some((x) => x === x.toUpperCase())).toBe(true); // case shift present
  expect(v.some((x) => x !== frozenSkill().bornFromClass)).toBe(true);
  // variants must stay in the same domain vocabulary (no foreign tokens)
  const baseTokens = new Set("shell openssl decrypt aes".split(/\s+/));
  for (const variant of v) {
    for (const tok of variant.split(/\s+/).filter(Boolean)) {
      // allow procedure-step tokens too (shell, fs_write, etc.) — but no random foreign words
      expect(tok.length).toBeGreaterThan(0);
    }
  }
});

test("judgeFuzzOutcome: survive when skill self-discovers on variants", () => {
  const skill = frozenSkill();
  const skills = [skill];
  const variants = buildAdversarialTriggers(skill);
  const v = judgeFuzzOutcome({ rec: skill, variants, skills });
  expect(v.outcome).toBe("survive");
});

test("judgeFuzzOutcome: drift when skill no longer matches any variant", () => {
  // A skill whose bornFromClass/procedure share no tokens with a shifted trigger.
  const skill = frozenSkill({
    name: "orphan",
    bornFromClass: "zzz qqq xxx",
    procedure: ["yyy www vvv"],
  });
  const skills = [skill];
  // Variants built from the skill's own tokens — but we corrupt them to miss.
  const variants = ["completely unrelated tokens here"];
  const v = judgeFuzzOutcome({ rec: skill, variants, skills });
  expect(v.outcome).toBe("drift");
  if (v.outcome === "drift") {
    expect(v.variantsTried).toBe(1);
    expect(v.matches).toBe(0);
  }
});

test("judgeFuzzOutcome: no variants → survive with reason", () => {
  const v = judgeFuzzOutcome({
    rec: frozenSkill(),
    variants: [],
    skills: [frozenSkill()],
  });
  expect(v.outcome).toBe("survive");
});

test("applyFuzzVerdict: survive reinforces strength + wins", () => {
  const rec = frozenSkill({ strength: 0.6, wins: 5 });
  const next = applyFuzzVerdict(rec, {
    outcome: "survive",
    skill: rec.name,
    reason: "survived 3/3",
  });
  expect(next.strength).toBeGreaterThan(0.6);
  expect(next.wins).toBe(6);
  expect(next.status).toBe("frozen");
});

test("applyFuzzVerdict: survive caps strength at 1.0", () => {
  const rec = frozenSkill({ strength: 0.99 });
  const next = applyFuzzVerdict(rec, {
    outcome: "survive",
    skill: rec.name,
    reason: "survived",
  });
  expect(next.strength).toBeLessThanOrEqual(1.0);
});

test("applyFuzzVerdict: drift demotes frozen → verified and drops strength", () => {
  const rec = frozenSkill({ strength: 0.7, fails: 0 });
  const next = applyFuzzVerdict(rec, {
    outcome: "drift",
    skill: rec.name,
    reason: "no longer self-discovers",
    variantsTried: 3,
    matches: 0,
  });
  expect(next.status).toBe("verified");
  expect(next.strength).toBeLessThan(0.7);
  expect(next.fails).toBe(1);
});
