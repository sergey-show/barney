/**
 * Procedure compile / decompile (ACT-R-ish) on skill bodies.
 * Wins compress the trail; fail streaks expand it back into explicit steps.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";

const COMPILE_MIN_WINS = 3;
const COMPILE_MIN_LEN = 4;
const COMPILE_KEEP = 3;
const DECOMPILE_MIN_FAILS = 3;

/** Compress a long procedure into a short family trail after repeated wins. */
export function compileProcedure(rec: SkillBodyRecord): SkillBodyRecord {
  const proc = (rec.procedure ?? []).map((s) => s.trim()).filter(Boolean);
  if ((rec.wins ?? 0) < COMPILE_MIN_WINS || proc.length < COMPILE_MIN_LEN) return rec;
  const uniq: string[] = [];
  for (const step of proc) {
    const fam = step.split(/[:>]/)[0]?.trim() || step;
    if (!uniq.includes(fam)) uniq.push(fam);
    if (uniq.length >= COMPILE_KEEP) break;
  }
  if (uniq.length >= proc.length) return rec;
  return {
    ...rec,
    procedure: uniq,
    updatedAt: new Date().toISOString(),
  };
}

/** Expand procedure when the skill keeps failing — bring back explicit steps. */
export function decompileProcedure(
  rec: SkillBodyRecord,
  trail: string[] = [],
): SkillBodyRecord {
  if ((rec.fails ?? 0) < DECOMPILE_MIN_FAILS) return rec;
  const extra = trail.map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const base = (rec.procedure ?? []).map((s) => s.trim()).filter(Boolean);
  const merged = [...base];
  for (const step of extra) {
    if (!merged.includes(step)) merged.push(step);
  }
  if (merged.length === base.length) return rec;
  return {
    ...rec,
    procedure: merged.slice(0, 8),
    updatedAt: new Date().toISOString(),
  };
}

/** Apply compile or decompile after an outcome. */
export function reshapeProcedureAfterOutcome(
  rec: SkillBodyRecord,
  input: { success: boolean; trail?: string[] },
): SkillBodyRecord {
  if (input.success) return compileProcedure(rec);
  return decompileProcedure(rec, input.trail ?? []);
}
