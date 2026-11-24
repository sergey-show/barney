/**
 * Adversarial ZPD fuzz (P.4): in idle, stress-test frozen skills against
 * trigger variants to catch drift before a real run trips over it.
 *
 * A frozen skill is a capsule that *used* to recover a class of failures.
 * Its `bornFromClass` is the trigger; its `procedure` is the tool-family
 * sequence that recovered. Over time the environment shifts (new lib
 * versions, renamed flags, moved paths) and the capsule silently rots —
 * the matcher still returns it, but the procedure no longer works. The
 * roadmap calls this "adversarial ZPD": probe frozen skills with shifted
 * triggers and demote the ones that no longer self-match.
 *
 * This module is pure (no LLM, no I/O). It builds adversarial trigger
 * variants scoped to the skill's own capsule (same `bornFromClass` domain,
 * same procedure vocabulary) and asks the existing matchers whether the
 * skill is still discoverable on each variant. A skill that drops off its
 * own variants has drifted; a skill that survives them is reinforced.
 *
 * Scope rule: variants never leave the skill's `bornFromClass` domain.
 * We do not fuzz a `shell:openssl` skill with a `python:parse` trigger —
 * that would be noise. Variants are casing/spacing/noise/ordering shifts
 * of the *same* domain tokens.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";
import { selectBodyFastPath } from "../experience/bodyFastPath.ts";
import { matchSubtasks, buildSubtaskIndex, type SubtaskIndex } from "../experience/subtaskIndex.ts";

export type FuzzVerdict =
  | { outcome: "survive"; skill: string; reason: string }
  | { outcome: "drift"; skill: string; reason: string; variantsTried: number; matches: number };

/**
 * Pick a frozen skill to fuzz. Prefers the longest-stale (oldest
 * `updatedAt`) so drift is caught before a real run hits it. Skips
 * skills fuzzed within the cooldown window.
 */
export function selectFuzzTarget(input: {
  skills: SkillBodyRecord[];
  nowMs?: number;
  /** Map of skill name → last fuzzed at (ms). */
  lastFuzzedAt?: Map<string, number>;
  cooldownMs?: number;
}): SkillBodyRecord | null {
  const now = input.nowMs ?? Date.now();
  const cooldown = input.cooldownMs ?? FUZZ_COOLDOWN_MS;
  const last = input.lastFuzzedAt ?? new Map();
  const frozen = input.skills.filter(
    (rec) => rec.status === "frozen" && (rec.procedure ?? []).length >= 2,
  );
  if (!frozen.length) return null;
  const eligible = frozen.filter((rec) => {
    const lastAt = last.get(rec.name) ?? 0;
    return now - lastAt >= cooldown;
  });
  if (!eligible.length) return null;
  // Oldest updatedAt first — catch the stalesest drift.
  return [...eligible].sort((a, b) => {
    const aT = Date.parse(a.updatedAt) || 0;
    const bT = Date.parse(b.updatedAt) || 0;
    return aT - bT;
  })[0] ?? null;
}

/** Build adversarial trigger variants scoped to the skill's own capsule. */
export function buildAdversarialTriggers(rec: SkillBodyRecord): string[] {
  const base = rec.bornFromClass || rec.name;
  const procedure = rec.procedure ?? [];
  const variants: string[] = [];

  // 1. Case shift — matcher should be case-insensitive.
  variants.push(base.toUpperCase());
  variants.push(base.toLowerCase());

  // 2. Whitespace noise — extra spaces, tabs, newlines mid-trigger.
  if (base.includes(" ")) {
    variants.push(base.replace(/\s+/g, "  "));
    variants.push(base.replace(/ /g, "\t"));
  }

  // 3. Domain-token reordering — same vocabulary, different order.
  //    (e.g. "shell openssl decrypt" → "openssl shell decrypt")
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3) {
    const swapped = [...tokens];
    const tmp = swapped[0]!;
    swapped[0] = swapped[1]!;
    swapped[1] = tmp;
    variants.push(swapped.join(" "));
  }

  // 4. Procedure-step mention as trigger — a real goal often names the
  //    tool family, not the class. The skill should still self-match.
  if (procedure.length >= 2) {
    variants.push(procedure.slice(0, 2).join(" "));
  }

  // 5. Truncated trigger — first half of the class. Drift check: does
  //    the matcher still find the skill on a partial trigger?
  if (base.length > 12) {
    variants.push(base.slice(0, Math.floor(base.length / 2)));
  }

  return [...new Set(variants)].filter((v) => v && v !== base);
}

/**
 * Judge whether the skill survives its own adversarial variants.
 * A variant "matches" if either the whole-path matcher (`selectBodyFastPath`)
 * or the sub-task matcher (`matchSubtasks`) returns this skill.
 *
 * - All variants match → survive (skill is robust; reinforce).
 * - Some variants match → survive (partial robustness is fine).
 * - No variant matches → drift (skill no longer self-discovers; demote).
 */
export function judgeFuzzOutcome(input: {
  rec: SkillBodyRecord;
  variants: string[];
  skills: SkillBodyRecord[];
  /** Prebuilt subtask index over `skills`. If omitted, built lazily. */
  index?: SubtaskIndex;
}): FuzzVerdict {
  const { rec, variants, skills } = input;
  if (!variants.length) {
    return { outcome: "survive", skill: rec.name, reason: "no variants generated" };
  }
  const index = input.index ?? buildSubtaskIndex(skills);
  let matches = 0;
  for (const variant of variants) {
    const whole = selectBodyFastPath({ skills, query: variant, minScore: 0.25 });
    const subs = matchSubtasks({ index, query: variant, topK: 3, minScore: 0.18 });
    const hit = whole?.skill === rec.name
      || subs.some((s) => s.skill === rec.name);
    if (hit) matches += 1;
  }
  if (matches === 0) {
    return {
      outcome: "drift",
      skill: rec.name,
      reason: `skill ${rec.name} no longer self-discovers on any of ${variants.length} adversarial variants (bornFromClass="${rec.bornFromClass}")`,
      variantsTried: variants.length,
      matches,
    };
  }
  return {
    outcome: "survive",
    skill: rec.name,
    reason: `skill ${rec.name} survived ${matches}/${variants.length} adversarial variants`,
  };
}

/** Apply fuzz verdict to the skill record: reinforce on survive, demote on drift. */
export function applyFuzzVerdict(rec: SkillBodyRecord, verdict: FuzzVerdict): SkillBodyRecord {
  if (verdict.outcome === "survive") {
    // Reinforce: small strength bump + wins increment. Capped at 1.0.
    const strength = Math.min(1, (rec.strength ?? 0.4) + 0.02);
    return {
      ...rec,
      strength,
      wins: rec.wins + 1,
      updatedAt: new Date().toISOString(),
    };
  }
  // Drift: demote frozen → verified so reconsolidation can rewrite it.
  return {
    ...rec,
    status: "verified",
    strength: Math.max(0.1, (rec.strength ?? 0.4) - 0.15),
    fails: rec.fails + 1,
    updatedAt: new Date().toISOString(),
  };
}

export const FUZZ_COOLDOWN_MS = 30 * 60_000; // 30 min per skill
