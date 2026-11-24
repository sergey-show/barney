import { expect, test } from "bun:test";
import {
  domainKey,
  clusterSkillsByDomain,
  scoreDomainBand,
  buildDomainSubBodies,
  formatDomainSubBodiesHint,
  gapsFromDomainSubBodies,
} from "./domainSubBodies.ts";
import type { SkillBodyRecord } from "../context/bodyStability.ts";

const now = Date.parse("2026-11-24T10:00:00Z");

const skill = (over: Partial<SkillBodyRecord> = {}): SkillBodyRecord => ({
  name: "skill-x",
  status: "frozen",
  wins: 3,
  transfers: 0,
  fails: 0,
  strength: 0.7,
  bornFromClass: "shell:openssl",
  bornFromMode: "recovery",
  updatedAt: "2026-11-20T00:00:00Z",
  lastUsedAt: "2026-11-22T00:00:00Z",
  procedure: ["shell openssl enc -d"],
  ...over,
});

test("domainKey extracts first colon segment", () => {
  expect(domainKey("shell:openssl")).toBe("shell");
  expect(domainKey("python:pandas:merge")).toBe("python");
  expect(domainKey("fs_write")).toBe("fs_write"); // no separator → whole token is domain
  expect(domainKey("python pandas merge")).toBe("python");
  expect(domainKey("general")).toBe("general");
  expect(domainKey("")).toBe("general");
  expect(domainKey(":openssl")).toBe("openssl");
});

test("clusterSkillsByDomain groups by domain key", () => {
  const skills = [
    skill({ name: "a", bornFromClass: "shell:openssl" }),
    skill({ name: "b", bornFromClass: "shell:tar" }),
    skill({ name: "c", bornFromClass: "python:pandas" }),
  ];
  const clusters = clusterSkillsByDomain(skills);
  expect(clusters.size).toBe(2);
  expect(clusters.get("shell")?.length).toBe(2);
  expect(clusters.get("python")?.length).toBe(1);
});

test("scoreDomainBand: empty cluster → unknown", () => {
  const r = scoreDomainBand([], now);
  expect(r.band).toBe("unknown");
});

test("scoreDomainBand: strong majority (>=60%) → strong", () => {
  const skills = [
    skill({ name: "a", wins: 5, fails: 0, strength: 0.8, status: "frozen" }),
    skill({ name: "b", wins: 4, fails: 0, strength: 0.7, status: "frozen" }),
    skill({ name: "c", wins: 1, fails: 0, strength: 0.5, status: "verified" }),
  ];
  const r = scoreDomainBand(skills, now);
  expect(r.band).toBe("strong");
  expect(r.strongCount).toBe(2);
});

test("scoreDomainBand: weak majority (>=50%) → weak", () => {
  const skills = [
    skill({ name: "a", wins: 0, fails: 3, strength: 0.2, status: "quarantine" }),
    skill({ name: "b", wins: 0, fails: 2, strength: 0.3, status: "quarantine" }),
    skill({ name: "c", wins: 1, fails: 0, strength: 0.5, status: "verified" }),
  ];
  const r = scoreDomainBand(skills, now);
  expect(r.band).toBe("weak");
  expect(r.weakCount).toBe(2);
});

test("scoreDomainBand: decay dominates when no strong", () => {
  const skills = [
    skill({ name: "a", wins: 1, fails: 0, strength: 0.4, status: "verified", updatedAt: "2025-01-01T00:00:00Z", lastUsedAt: "2025-01-01T00:00:00Z" }),
    skill({ name: "b", wins: 1, fails: 0, strength: 0.5, status: "verified" }),
  ];
  const r = scoreDomainBand(skills, now);
  expect(r.band).toBe("decay");
  expect(r.decayCount).toBe(1);
});

test("scoreDomainBand: mixed → ok", () => {
  const skills = [
    skill({ name: "a", wins: 2, fails: 0, strength: 0.5, status: "verified" }),
    skill({ name: "b", wins: 1, fails: 1, strength: 0.4, status: "verified" }),
  ];
  const r = scoreDomainBand(skills, now);
  expect(r.band).toBe("ok");
});

test("buildDomainSubBodies sorts weak/decay first for drill targeting", () => {
  const skills = [
    skill({ name: "strong-a", bornFromClass: "shell:openssl", wins: 5, fails: 0, strength: 0.8, status: "frozen" }),
    skill({ name: "strong-b", bornFromClass: "shell:tar", wins: 4, fails: 0, strength: 0.7, status: "frozen" }),
    skill({ name: "weak-a", bornFromClass: "python:pandas", wins: 0, fails: 3, strength: 0.2, status: "quarantine" }),
    skill({ name: "weak-b", bornFromClass: "python:numpy", wins: 0, fails: 2, strength: 0.3, status: "quarantine" }),
  ];
  const bodies = buildDomainSubBodies(skills, now);
  expect(bodies.length).toBe(2);
  // python (weak) should come before shell (strong)
  expect(bodies[0]!.domain).toBe("python");
  expect(bodies[0]!.band).toBe("weak");
  expect(bodies[1]!.domain).toBe("shell");
  expect(bodies[1]!.band).toBe("strong");
});

test("buildDomainSubBodies includes skill names sorted by capability score", () => {
  const skills = [
    skill({ name: "weaker", bornFromClass: "shell:openssl", wins: 1, fails: 2, strength: 0.3, status: "quarantine" }),
    skill({ name: "stronger", bornFromClass: "shell:tar", wins: 5, fails: 0, strength: 0.8, status: "frozen" }),
  ];
  const bodies = buildDomainSubBodies(skills, now);
  expect(bodies[0]!.skills[0]).toBe("stronger");
  expect(bodies[0]!.skills[1]).toBe("weaker");
});

test("formatDomainSubBodiesHint shows weak and strong sub-bodies", () => {
  const bodies: ReturnType<typeof buildDomainSubBodies> = [
    { domain: "python", band: "weak", skillCount: 2, strongCount: 0, okCount: 0, weakCount: 2, decayCount: 0, avgStrength: 0.25, skills: ["a", "b"] },
    { domain: "shell", band: "strong", skillCount: 2, strongCount: 2, okCount: 0, weakCount: 0, decayCount: 0, avgStrength: 0.75, skills: ["c", "d"] },
  ];
  const hint = formatDomainSubBodiesHint(bodies);
  expect(hint).toContain("Sub-body weak/decay: python(weak·2)");
  expect(hint).toContain("Sub-body strong: shell(2)");
});

test("formatDomainSubBodiesHint empty when no bodies", () => {
  expect(formatDomainSubBodiesHint([])).toBe("");
});

test("gapsFromDomainSubBodies returns weak/decay domains as drill targets", () => {
  const bodies: ReturnType<typeof buildDomainSubBodies> = [
    { domain: "python", band: "weak", skillCount: 2, strongCount: 0, okCount: 0, weakCount: 2, decayCount: 0, avgStrength: 0.25, skills: ["a"] },
    { domain: "shell", band: "strong", skillCount: 2, strongCount: 2, okCount: 0, weakCount: 0, decayCount: 0, avgStrength: 0.75, skills: ["b"] },
    { domain: "fs", band: "decay", skillCount: 1, strongCount: 0, okCount: 0, weakCount: 0, decayCount: 1, avgStrength: 0.4, skills: ["c"] },
  ];
  const gaps = gapsFromDomainSubBodies(bodies);
  expect(gaps.length).toBe(2); // python + fs, not shell
  expect(gaps.some((g) => g.domain === "python")).toBe(true);
  expect(gaps.some((g) => g.domain === "fs")).toBe(true);
  expect(gaps.every((g) => g.band === "weak" || g.band === "decay")).toBe(true);
});
