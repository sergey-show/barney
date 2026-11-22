/**
 * Body fast-path (CPU-ARC / SkillCache analogue):
 * try a frozen/verified procedure first; on miss or failure fall through
 * to the full model loop. Never bypasses safety gates.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";

export type BodyFastPath = {
  skill: string;
  status: string;
  procedure: string[];
  score: number;
  line: string;
  prompt: string;
};

export function selectBodyFastPath(input: {
  skills: SkillBodyRecord[];
  query: string;
  /** Minimum similarity-ish score 0..1 */
  minScore?: number;
}): BodyFastPath | null {
  const minScore = input.minScore ?? 0.35;
  const query = input.query.toLowerCase();
  const queryTokens = tokenize(query);
  let best: BodyFastPath | null = null;

  for (const rec of input.skills) {
    if (rec.status !== "frozen" && rec.status !== "verified") continue;
    const procedure = (rec.procedure ?? []).map((s) => s.trim()).filter(Boolean);
    if (!procedure.length) continue;
    const hay = `${rec.name} ${rec.bornFromClass} ${procedure.join(" ")}`.toLowerCase();
    const score = overlapScore(queryTokens, tokenize(hay));
    if (score < minScore) continue;
    if (best && score <= best.score) continue;
    best = {
      skill: rec.name,
      status: rec.status,
      procedure,
      score,
      line: `body_fast_path: try=${rec.name} status=${rec.status} score=${score.toFixed(2)} steps=${procedure.length}`,
      prompt: formatFastPathPrompt(rec.name, procedure),
    };
  }
  return best;
}

export function formatFastPathPrompt(skill: string, procedure: string[]): string {
  const steps = procedure.map((step, i) => `${i + 1}. ${step}`).join("\n");
  return [
    `BODY FAST-PATH (skill:${skill}): prefer this procedure before inventing a new plan.`,
    "Fill <binding> slots from the current request. If a step fails, deoptimize only that step and continue; if the path collapses, fall through to full reasoning.",
    steps,
  ].join("\n");
}

export function fastPathFallthrough(input: {
  attemptedSkill: string | null | undefined;
  outcomeOk: boolean;
  falseSkills?: string[];
  recallUsed?: boolean;
}): { fallthrough: boolean; line: string } {
  if (!input.attemptedSkill) {
    return { fallthrough: false, line: "body_fast_path_fallthrough: 0 · none attempted" };
  }
  const falseHit = (input.falseSkills ?? []).includes(input.attemptedSkill);
  const fallthrough = !input.outcomeOk && (falseHit || Boolean(input.recallUsed));
  return {
    fallthrough,
    line: fallthrough
      ? `body_fast_path_fallthrough: 1 · skill=${input.attemptedSkill} · resume full loop`
      : `body_fast_path_fallthrough: 0 · skill=${input.attemptedSkill}`,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_<>-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

function overlapScore(query: string[], hay: string[]): number {
  if (!query.length || !hay.length) return 0;
  const set = new Set(hay);
  let hit = 0;
  for (const token of query) {
    if (set.has(token)) hit += 1;
  }
  return hit / query.length;
}
