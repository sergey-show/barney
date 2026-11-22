/**
 * Failure-weighted sampling for experience curriculum.
 * Prefer cases whose family / fail history is currently scarce or failing,
 * instead of always running a fixed equal list.
 */

import {
  HARD_TRANSFER_CASES,
  hardTransferCaseById,
  type HardTransferCase,
} from "./fourHandCurriculum.ts";

export type CaseWeightHint = {
  caseId: string;
  /** Recent fail count for this family/case (higher → sample more). */
  recentFails?: number;
  /** Recent false-skill rate 0..1 (higher → sample more). */
  falseSkillRate?: number;
  /** Recent transfer lift (lower/negative → sample more). */
  recentLift?: number;
  /** Manual boost. */
  boost?: number;
};

export type SampledCase = {
  case: HardTransferCase;
  weight: number;
};

/** Base prior: sanitize/merge families start equal; extend via hints. */
export function weightForCase(
  item: HardTransferCase,
  hint?: CaseWeightHint,
): number {
  let weight = 1;
  if (hint?.recentFails != null) weight += Math.max(0, hint.recentFails);
  if (hint?.falseSkillRate != null) weight += Math.max(0, hint.falseSkillRate) * 2;
  if (hint?.recentLift != null) {
    // Low or negative lift → need more probes.
    weight += Math.max(0, 1 - hint.recentLift) * 2;
  }
  if (hint?.boost != null) weight += Math.max(0, hint.boost);
  // Slight prior toward families that historically bind experience (sanitize).
  if (item.family === "sanitize") weight += 0.25;
  return Math.max(0.05, weight);
}

export function sampleExperienceCases(input: {
  caseIds?: string[];
  hints?: CaseWeightHint[];
  /** How many cases to pick (with replacement if pool smaller and count larger). */
  count?: number;
  /** Deterministic RNG seed via mulberry32; default random. */
  seed?: number;
}): SampledCase[] {
  const pool = (input.caseIds?.length
    ? input.caseIds.map((id) => {
      const found = hardTransferCaseById(id);
      if (!found) throw new Error(`unknown hard transfer case: ${id}`);
      return found;
    })
    : HARD_TRANSFER_CASES);
  const hintMap = new Map((input.hints ?? []).map((h) => [h.caseId, h]));
  const weighted = pool.map((item) => ({
    case: item,
    weight: weightForCase(item, hintMap.get(item.id)),
  }));
  const count = input.count ?? weighted.length;
  if (count <= 0) return [];
  // If count == pool size and no hints forcing reweight order, return stable order
  // but sorted by weight desc so failure-heavy cases run first.
  if (count === weighted.length && input.seed == null && !(input.hints?.length)) {
    return [...weighted].sort((a, b) => b.weight - a.weight || a.case.id.localeCompare(b.case.id));
  }
  const rng = mulberry32(input.seed ?? Date.now() >>> 0);
  const picked: SampledCase[] = [];
  const total = () => weighted.reduce((sum, row) => sum + row.weight, 0);
  for (let i = 0; i < count; i++) {
    let r = rng() * total();
    let chosen = weighted[0]!;
    for (const row of weighted) {
      r -= row.weight;
      if (r <= 0) {
        chosen = row;
        break;
      }
    }
    picked.push(chosen);
  }
  return picked;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
