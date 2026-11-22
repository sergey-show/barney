/**
 * Dual-candidate contrast (GUARD):
 * when two rule/skill drafts compete for the same slot, score both against
 * external evidence and keep the winner — do not clobber by recency alone.
 */

import type { EditSignal } from "./editSignal.ts";

export type CandidateDraft = {
  id: string;
  body: string;
  /** Optional procedure for skill candidates. */
  procedure?: string[];
  confidence?: number;
};

export type ContrastResult = {
  winner: CandidateDraft;
  loser: CandidateDraft;
  scores: { a: number; b: number };
  reason: string;
  line: string;
};

/**
 * Contrast A vs B. Higher score wins.
 * Scoring favors: evidence overlap, regression iff-scope, concrete verbs, confidence.
 */
export function contrastCandidates(input: {
  a: CandidateDraft;
  b: CandidateDraft;
  evidence?: string;
  goal?: string;
  signal?: EditSignal;
}): ContrastResult {
  const sa = scoreCandidate(input.a, input);
  const sb = scoreCandidate(input.b, input);
  const aWins = sa >= sb;
  const winner = aWins ? input.a : input.b;
  const loser = aWins ? input.b : input.a;
  const reason = aWins
    ? `contrast · keep ${input.a.id} (${sa.toFixed(2)} ≥ ${sb.toFixed(2)})`
    : `contrast · keep ${input.b.id} (${sb.toFixed(2)} > ${sa.toFixed(2)})`;
  return {
    winner,
    loser,
    scores: { a: sa, b: sb },
    reason,
    line: `dual_candidate: win=${winner.id} lose=${loser.id} · a=${sa.toFixed(2)} b=${sb.toFixed(2)}`,
  };
}

/**
 * Pick whether a challenger may replace an incumbent after contrast.
 * Tied or weaker challenger → keep incumbent.
 */
export function admitByContrast(input: {
  incumbent: CandidateDraft;
  challenger: CandidateDraft;
  evidence?: string;
  goal?: string;
  signal?: EditSignal;
}): ContrastResult & { replace: boolean } {
  const result = contrastCandidates({
    a: input.incumbent,
    b: input.challenger,
    evidence: input.evidence,
    goal: input.goal,
    signal: input.signal,
  });
  const replace = result.winner.id === input.challenger.id
    && result.scores.b > result.scores.a;
  return { ...result, replace };
}

function scoreCandidate(
  c: CandidateDraft,
  ctx: { evidence?: string; goal?: string; signal?: EditSignal },
): number {
  const body = norm(`${c.body} ${(c.procedure ?? []).join(" ")}`);
  if (!body) return 0;
  let score = 0.1 + Math.min(0.3, (c.confidence ?? 0) * 0.3);

  const hay = norm(`${ctx.evidence ?? ""}\n${ctx.goal ?? ""}`);
  if (hay) {
    score += 0.5 * tokenOverlap(body, hay);
  }

  // Regression edits should be iff-scoped; reward when-clause.
  if (ctx.signal?.kind === "regression") {
    score += /^when\s+[^:]+:/.test(body) ? 0.25 : -0.15;
  }

  // Prefer concrete action verbs over vague cheerleading.
  const verbs = ["replace", "write", "verify", "grep", "read", "mask", "open", "check", "run"];
  let verbHits = 0;
  for (const v of verbs) {
    if (body.includes(v)) verbHits += 1;
  }
  score += Math.min(0.2, verbHits * 0.05);

  // Penalize empty global slogans.
  if (body.length < 24 && !body.includes(":")) score -= 0.2;

  return score;
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/[^a-z0-9_<>-]+/).filter((t) => t.length > 2));
  const tb = b.split(/[^a-z0-9_<>-]+/).filter((t) => t.length > 2);
  if (!ta.size || !tb.length) return 0;
  let hit = 0;
  for (const t of tb) {
    if (ta.has(t)) hit += 1;
  }
  return hit / Math.max(tb.length, 1);
}
