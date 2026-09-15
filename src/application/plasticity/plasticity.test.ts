import { expect, test } from "bun:test";
import { admitNewSkill } from "../context/bodyStability.ts";
import {
  envMatches,
  filterSkillsForRecall,
  needsPlasticSleep,
  planPlasticSleep,
  plasticWritePressure,
  reconsolidateSkill,
  reconsolidateSynapse,
  emptySynapse,
  resolveSkillDuel,
  skillUtility,
  shouldArchiveSkill,
} from "./plasticity.ts";

test("reconsolidation strengthens on used+pass and weakens on used+fail", () => {
  let rec = admitNewSkill("learned-x", "sanitize", "secret-leak");
  const base = rec.strength;
  rec = reconsolidateSkill(rec, { recalled: true, used: true, outcomeOk: true });
  expect(rec.strength).toBeGreaterThan(base);
  expect(rec.lastUsedAt).toBeTruthy();
  const mid = rec.strength;
  rec = reconsolidateSkill(rec, { recalled: true, used: true, outcomeOk: false });
  expect(rec.strength).toBeLessThan(mid);
  expect(rec.fails).toBe(1);
});

test("utility and archive of unused quarantine", () => {
  const rec = admitNewSkill("learned-old", "a", "b");
  rec.updatedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  rec.lastUsedAt = rec.updatedAt;
  rec.strength = 0.05;
  rec.fails = 4;
  expect(skillUtility(rec)).toBeLessThan(0);
  expect(shouldArchiveSkill(rec)).toBe(true);
});

test("metaplastic pressure changes write eagerness signal", () => {
  expect(plasticWritePressure({ frustration: 0, gapCount: 0 }).pressure).toBeLessThan(0.3);
  expect(plasticWritePressure({ frustration: 6, gapCount: 3, sameFailureCount: 3 }).pressure).toBeGreaterThan(0.7);
});

test("env match and recall filter drop deprecated", () => {
  const host = { os: "darwin", runtime: "node", runtimeVersion: "20.0.0", compat: "any" as const };
  const ok = admitNewSkill("good", "c", "m", { os: "darwin", compat: "any" });
  const bad = admitNewSkill("bad", "c", "m");
  bad.status = "deprecated";
  expect(envMatches({ os: "linux", compat: "exact" }, host)).toBe(false);
  expect(filterSkillsForRecall([ok, bad], host).map((r) => r.name)).toEqual(["good"]);
});

test("plastic sleep deprecates duel loser and archives dead quarantine", () => {
  const a = admitNewSkill("learned-a", "sanitize", "secret-leak");
  a.status = "verified";
  a.wins = 5;
  a.strength = 0.9;
  a.lastUsedAt = new Date().toISOString();
  const b = admitNewSkill("learned-b", "sanitize", "secret-leak");
  b.status = "verified";
  b.wins = 0;
  b.strength = 0.2;
  b.lastUsedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  b.updatedAt = b.lastUsedAt;
  expect(needsPlasticSleep([a, b])).toBe(true);
  const duel = resolveSkillDuel(a, b);
  expect(duel.winner).toBe("learned-a");
  const { next, actions } = planPlasticSleep([a, b]);
  expect(actions.some((action) => action.op === "deprecate" && action.name === "learned-b")).toBe(true);
  expect(next.find((r) => r.name === "learned-b")?.status).toBe("deprecated");
});

test("synapse reconsolidation archives chronic hurts", () => {
  let syn = emptySynapse("rule", "rule/x");
  syn = reconsolidateSynapse(syn, { recalled: true, used: true, outcomeOk: false });
  syn = reconsolidateSynapse(syn, { recalled: true, used: true, outcomeOk: false });
  syn = reconsolidateSynapse(syn, { recalled: true, used: true, outcomeOk: false });
  expect(syn.hurts).toBeGreaterThanOrEqual(2);
});
