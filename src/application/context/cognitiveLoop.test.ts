import { expect, test } from "bun:test";
import {
  buildCapabilityMap,
  formatCapabilityHint,
  gapsFromCapabilityMap,
  scoreSkillCapability,
} from "./capabilityMap.ts";
import { admitNewSkill } from "./bodyStability.ts";
import { compileProcedure, decompileProcedure, reshapeProcedureAfterOutcome } from "./procedureCompile.ts";
import { shouldForceSystem2, system2PreferStrategies } from "./system2Force.ts";
import { episodeSalience, buildEpisodeMarkers, salienceFromMarkers } from "./episodeMarkers.ts";
import { proposeAgendaItem, zpdLevelForGap, drillGoalForZpd } from "../autonomy/agenda.ts";
import { parseInnerThinkDirectives } from "../psyche/innerThink.ts";
import { scoreCandidate } from "../experience/weightedRecall.ts";

test("capability map marks weak and decay skills", () => {
  const weak = admitNewSkill("learned-x", "sanitize", "secret-leak");
  weak.wins = 0;
  weak.fails = 3;
  weak.strength = 0.2;
  const entry = scoreSkillCapability(weak);
  expect(entry.band).toBe("weak");
  const map = buildCapabilityMap({
    skills: [weak],
    failClasses: [{ klass: "secret-leak", count: 3, hint: "mask secrets" }],
  });
  const gaps = gapsFromCapabilityMap(map);
  expect(gaps.length).toBeGreaterThan(0);
  expect(formatCapabilityHint(map)).toMatch(/weak|decay/i);
});

test("ZPD drills escalate with count", () => {
  expect(zpdLevelForGap({ failClass: "x", hint: "h", count: 2, source: "backlog" })).toBe(1);
  expect(zpdLevelForGap({ failClass: "x", hint: "h", count: 3, source: "episode" })).toBe(2);
  expect(zpdLevelForGap({ failClass: "x", hint: "h", count: 5, source: "capability" })).toBe(3);
  expect(drillGoalForZpd({ failClass: "secret-leak", hint: "hint", count: 3, source: "episode" }, 2)).toMatch(/ZPD-2/);
  expect(proposeAgendaItem({ failClass: "a", hint: "h", count: 5, source: "backlog" }).goal).toMatch(/ZPD-3|proof-a\.py|ZPD_PROOF/);
});

test("salience markers boost recall score", () => {
  const markers = buildEpisodeMarkers({
    goalHash: "abc",
    reuse: "fresh",
    predictionError: 1,
    frustration: 4,
    experience: true,
    confPredicted: 0.85,
    calibBrier: 0.72,
    overconfident: true,
  });
  expect(markers.some((m) => m.startsWith("pe:"))).toBe(true);
  expect(markers.some((m) => m.startsWith("salience:"))).toBe(true);
  expect(markers).toContain("confPred:0.85");
  expect(markers).toContain("calib:0.72");
  expect(markers).toContain("overconfident:1");
  expect(episodeSalience({ predictionError: 1, frustration: 4, experience: true })).toBeGreaterThan(0.5);
  const low = scoreCandidate("secret leak", { line: "secret leak fail", kind: "shadow", weight: 0.5, salience: 0.2 });
  const high = scoreCandidate("secret leak", { line: "secret leak fail", kind: "shadow", weight: 0.5, salience: 0.9 });
  expect(high.score).toBeGreaterThan(low.score);
  expect(salienceFromMarkers(markers)).toBeGreaterThan(0.35);
});

test("system2 force from shadow and frustration", () => {
  expect(shouldForceSystem2({ shadowHits: 2, frustration: 0 })).toBe(true);
  expect(shouldForceSystem2({ shadowHits: 1, frustration: 2 })).toBe(true);
  expect(shouldForceSystem2({ shadowHits: 0, frustration: 1 })).toBe(false);
  expect(system2PreferStrategies({ shadowHits: 2, frustration: 3 })).toContain("decompose");
});

test("procedure compile and decompile", () => {
  let rec = admitNewSkill("learned-y", "a", "b");
  rec.procedure = ["shell:openssl", "fs_write", "shell:python3", "fs_edit", "shell:grep"];
  rec.wins = 3;
  rec = compileProcedure(rec);
  expect(rec.procedure!.length).toBeLessThanOrEqual(3);
  rec.fails = 3;
  rec = decompileProcedure(rec, ["browser_open", "web_search"]);
  expect(rec.procedure).toContain("browser_open");
  const reshaped = reshapeProcedureAfterOutcome(
    { ...admitNewSkill("z", "a", "b"), wins: 4, procedure: ["a", "b", "c", "d", "e"] },
    { success: true },
  );
  expect((reshaped.procedure ?? []).length).toBeLessThanOrEqual(3);
});

test("inner think directives", () => {
  expect(parseInnerThinkDirectives("agenda: secret-leak | mask tokens")).toEqual({
    agenda: { failClass: "secret-leak", hint: "mask tokens" },
  });
  expect(parseInnerThinkDirectives("shadow: Prefer fs_edit over shell for secrets").shadow).toMatch(/fs_edit/);
  expect(parseInnerThinkDirectives("ordinary note")).toEqual({});
});
