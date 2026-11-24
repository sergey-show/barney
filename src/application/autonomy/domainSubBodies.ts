/**
 * Domain sub-bodies (P.2): cluster skills by domain and score each cluster
 * as a sub-body, so individuation can report "shell sub-body: strong, python
 * sub-body: weak" instead of only per-skill bands.
 *
 * The roadmap names this "domain sub-bodies / Ability Map clustering + body
 * branching": the body is not one flat pool of skills — it specializes into
 * domain sub-bodies (shell, python, fs, web, spi, …). A sub-body is strong
 * when its skills are strong, weak when they are weak, and the agent's
 * self-model should reflect that branching so drills target the weak
 * *sub-body*, not just the weak skill.
 *
 * This module is pure (no I/O, no LLM). It:
 *   1. Extracts a domain key from each skill's `bornFromClass` (the first
 *      colon-separated segment, or the first token if no colon).
 *   2. Clusters skills by domain.
 *   3. Scores each cluster's band from the aggregate of its skills' bands
 *      (strong/ok/weak/decay) — majority wins, with decay dominating if any
 *      skill is decaying and none are strong.
 *   4. Returns a sorted list of sub-bodies for the self-model + prompt hint.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";
import { scoreSkillCapability, type CapabilityBand } from "../context/capabilityMap.ts";

export type DomainSubBody = {
  domain: string;
  band: CapabilityBand;
  skillCount: number;
  strongCount: number;
  okCount: number;
  weakCount: number;
  decayCount: number;
  avgStrength: number;
  /** Skill names in the cluster, sorted by capability score desc. */
  skills: string[];
};

/**
 * Extract a domain key from a skill's bornFromClass.
 * "shell:openssl" → "shell"; "python pandas merge" → "python";
 * "fs_write" → "fs"; "general" → "general".
 */
export function domainKey(bornFromClass: string): string {
  const raw = (bornFromClass ?? "").trim().toLowerCase();
  if (!raw) return "general";
  // Colon-separated: take the first non-empty segment
  // (e.g. "shell:openssl" → "shell"; ":openssl" → "openssl").
  if (raw.includes(":")) {
    const parts = raw.split(":").map((p) => p.trim()).filter(Boolean);
    const first = parts[0];
    if (first && first !== "general") return first;
  }
  // Otherwise: first token (e.g. "python pandas merge" → "python").
  const first = raw.split(/[^a-z0-9_-]+/i).map((p) => p.trim()).filter(Boolean)[0];
  return first || "general";
}

/**
 * Cluster skills by domain. Returns a Map ordered by domain key.
 */
export function clusterSkillsByDomain(skills: SkillBodyRecord[]): Map<string, SkillBodyRecord[]> {
  const clusters = new Map<string, SkillBodyRecord[]>();
  for (const rec of skills) {
    const key = domainKey(rec.bornFromClass || rec.bornFromMode || rec.name);
    const list = clusters.get(key) ?? [];
    list.push(rec);
    clusters.set(key, list);
  }
  return clusters;
}

/**
 * Score a single domain cluster's band from the aggregate of its skills.
 * Rules (deterministic):
 *   - decay dominates: if any skill is decay AND no skill is strong → decay.
 *   - strong majority: >=60% strong → strong.
 *   - weak majority: >=50% weak (and not strong) → weak.
 *   - else ok (mixed or all-ok).
 *   - empty cluster → unknown.
 */
export function scoreDomainBand(skillsInDomain: SkillBodyRecord[], nowMs = Date.now()): {
  band: CapabilityBand;
  strongCount: number;
  okCount: number;
  weakCount: number;
  decayCount: number;
  avgStrength: number;
} {
  if (!skillsInDomain.length) {
    return { band: "unknown", strongCount: 0, okCount: 0, weakCount: 0, decayCount: 0, avgStrength: 0 };
  }
  const bands = skillsInDomain.map((rec) => scoreSkillCapability(rec, nowMs).band);
  const strongCount = bands.filter((b) => b === "strong").length;
  const okCount = bands.filter((b) => b === "ok").length;
  const weakCount = bands.filter((b) => b === "weak").length;
  const decayCount = bands.filter((b) => b === "decay").length;
  const total = bands.length;
  const avgStrength = skillsInDomain.reduce((sum, rec) => sum + (rec.strength ?? 0.4), 0) / total;

  // decay dominates if no strong and any decay
  if (decayCount > 0 && strongCount === 0) {
    return { band: "decay", strongCount, okCount, weakCount, decayCount, avgStrength };
  }
  // strong majority (>=60%)
  if (strongCount / total >= 0.6) {
    return { band: "strong", strongCount, okCount, weakCount, decayCount, avgStrength };
  }
  // weak majority (>=50% weak, and not strong-majority)
  if (weakCount / total >= 0.5) {
    return { band: "weak", strongCount, okCount, weakCount, decayCount, avgStrength };
  }
  // mixed / all-ok
  return { band: "ok", strongCount, okCount, weakCount, decayCount, avgStrength };
}

/**
 * Build the full domain sub-body map. Sorted by band priority (weak/decay first
 * for drill targeting, then ok, then strong), then by skill count desc.
 */
export function buildDomainSubBodies(skills: SkillBodyRecord[], nowMs = Date.now()): DomainSubBody[] {
  const clusters = clusterSkillsByDomain(skills);
  const bodies: DomainSubBody[] = [];
  for (const [domain, recs] of clusters) {
    const score = scoreDomainBand(recs, nowMs);
    const sortedSkills = recs
      .map((rec) => ({ rec, score: scoreSkillCapability(rec, nowMs).score }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.rec.name);
    bodies.push({
      domain,
      band: score.band,
      skillCount: recs.length,
      strongCount: score.strongCount,
      okCount: score.okCount,
      weakCount: score.weakCount,
      decayCount: score.decayCount,
      avgStrength: Number(score.avgStrength.toFixed(2)),
      skills: sortedSkills,
    });
  }
  // Sort: weak/decay first (drill targets), then unknown, then ok, then strong.
  const bandOrder: Record<CapabilityBand, number> = {
    weak: 0,
    decay: 1,
    unknown: 2,
    ok: 3,
    strong: 4,
  };
  return bodies.sort((a, b) => {
    const bd = bandOrder[a.band] - bandOrder[b.band];
    if (bd !== 0) return bd;
    return b.skillCount - a.skillCount;
  });
}

/**
 * Format a compact hint for prompt injection — like formatCapabilityHint but
 * per-domain. Shows weak/decay sub-bodies first (what to drill), then strong.
 */
export function formatDomainSubBodiesHint(bodies: DomainSubBody[], limit = 6): string {
  if (!bodies.length) return "";
  const lines: string[] = [];
  const weak = bodies.filter((b) => b.band === "weak" || b.band === "decay").slice(0, 3);
  const strong = bodies.filter((b) => b.band === "strong").slice(0, 3);
  if (weak.length) {
    lines.push(
      `Sub-body weak/decay: ${weak.map((b) => `${b.domain}(${b.band}·${b.skillCount})`).join(", ")}`,
    );
  }
  if (strong.length) {
    lines.push(
      `Sub-body strong: ${strong.map((b) => `${b.domain}(${b.skillCount})`).join(", ")}`,
    );
  }
  return lines.join(". ");
}

/**
 * Gaps for agenda: weak/decay sub-bodies become drill targets, with the
 * domain as the failClass hint so runAutonomyDrill can scope the goal.
 */
export function gapsFromDomainSubBodies(bodies: DomainSubBody[]): Array<{
  domain: string;
  band: CapabilityBand;
  skillCount: number;
  hint: string;
}> {
  return bodies
    .filter((b) => b.band === "weak" || b.band === "decay")
    .slice(0, 4)
    .map((b) => ({
      domain: b.domain,
      band: b.band,
      skillCount: b.skillCount,
      hint: `Sub-body ${b.band}: domain ${b.domain} (${b.skillCount} skills, ${b.weakCount} weak, ${b.decayCount} decay). Rehearse the recovery path for this domain.`,
    }));
}
