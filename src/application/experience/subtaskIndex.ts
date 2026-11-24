/**
 * Sub-task semantic index — turn SkillsLock from a museum into a working engine.
 *
 * `selectBodyFastPath` matches the WHOLE query against the WHOLE procedure of a
 * frozen/verified capsule, so a shifted task (reworded goal, slightly different
 * structure) misses even when one STEP of an old capsule is exactly the
 * subroutine the new plan needs. This module decomposes every frozen/
 * verified procedure into indexed steps and retrieves them by TF-IDF cosine
 * against the goal — no LLM, no embeddings service, deterministic and unit-tested.
 *
 * The result is a SUBROUTINE HINT, not a forced fast-path: the model is told
 * "for one step of your plan, reuse procedure step K from skill S", and may
 * take it or fall through to full reasoning. This is what moves
 * `skillReuseRate` above zero on shifted tasks.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";

export type SubtaskEntry = {
  skill: string;
  stepIndex: number;
  stepText: string;
  tokens: string[];
  /** Sparse TF-IDF vector: term -> weight. */
  vec: Map<string, number>;
};

export type SubtaskIndex = {
  entries: SubtaskEntry[];
  idf: Map<string, number>;
  /** Number of documents the index was built over (for idf). */
  n: number;
};

export type SubtaskMatch = {
  skill: string;
  stepIndex: number;
  stepText: string;
  score: number;
  line: string;
  prompt: string;
};

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by",
  "is", "are", "be", "as", "at", "it", "this", "that", "from", "into", "your",
  "you", "we", "i", "if", "then", "so", "do", "does", "not", "no", "but", "via",
  "use", "using", "used", "write", "make", "get", "set", "put", "run", "and",
  "step", "now", "next", "first", "last", "all", "any", "each", "which", "what",
]);

export function tokenizeSubtask(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_<>.-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
    .filter((t) => !STOP.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const max = Math.max(1, ...tf.values());
  for (const [k, v] of tf) tf.set(k, v / max);
  return tf;
}

/** Build a sub-task index over frozen/verified skills' procedures. */
export function buildSubtaskIndex(skills: SkillBodyRecord[]): SubtaskIndex {
  const entries: SubtaskEntry[] = [];
  const df = new Map<string, number>();

  for (const rec of skills) {
    if (rec.status !== "frozen" && rec.status !== "verified") continue;
    const procedure = (rec.procedure ?? []).map((s) => s.trim()).filter(Boolean);
    procedure.forEach((stepText, stepIndex) => {
      const tokens = tokenizeSubtask(`${rec.name} ${rec.bornFromClass} ${stepText}`);
      if (!tokens.length) return;
      for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
      entries.push({ skill: rec.name, stepIndex, stepText, tokens, vec: new Map() });
    });
  }

  const n = Math.max(1, entries.length);
  const idf = new Map<string, number>();
  for (const [term, d] of df) idf.set(term, Math.log((n + 1) / (d + 1)) + 1);

  for (const e of entries) {
    const tf = termFreq(e.tokens);
    const vec = new Map<string, number>();
    for (const [term, freq] of tf) {
      const w = freq * (idf.get(term) ?? 0);
      if (w > 0) vec.set(term, w);
    }
    e.vec = vec;
  }

  return { entries, idf, n };
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (const [k, v] of a) {
    aNorm += v * v;
    const w = b.get(k);
    if (w !== undefined) dot += v * w;
  }
  for (const [, v] of b) bNorm += v * v;
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function queryVec(query: string, idf: Map<string, number>): Map<string, number> {
  const tokens = tokenizeSubtask(query);
  const tf = termFreq(tokens);
  const vec = new Map<string, number>();
  for (const [term, freq] of tf) {
    const w = freq * (idf.get(term) ?? 0);
    if (w > 0) vec.set(term, w);
  }
  return vec;
}

/** Retrieve the top-K sub-task matches above `minScore` (default 0.18). */
export function matchSubtasks(input: {
  index: SubtaskIndex;
  query: string;
  topK?: number;
  minScore?: number;
  /** Drop near-duplicate hits from the SAME skill (keep best step per skill). */
  perSkill?: boolean;
}): SubtaskMatch[] {
  const minScore = input.minScore ?? 0.18;
  const topK = input.topK ?? 3;
  const perSkill = input.perSkill ?? true;
  const qv = queryVec(input.query, input.index.idf);
  if (qv.size === 0) return [];

  const scored = input.index.entries
    .map((e) => ({ e, score: cosine(qv, e.vec) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (perSkill) {
    const seen = new Set<string>();
    const dedup = scored.filter((s) => {
      if (seen.has(s.e.skill)) return false;
      seen.add(s.e.skill);
      return true;
    });
    return dedup.slice(0, topK).map(toMatch);
  }
  return scored.slice(0, topK).map(toMatch);
}

function toMatch(s: { e: SubtaskEntry; score: number }): SubtaskMatch {
  const { e, score } = s;
  return {
    skill: e.skill,
    stepIndex: e.stepIndex,
    stepText: e.stepText,
    score,
    line: `subtask_match: skill=${e.skill} step=${e.stepIndex + 1} score=${score.toFixed(2)} · ${e.stepText.slice(0, 80)}`,
    prompt: formatSubroutineHint(e.skill, e.stepIndex, e.stepText),
  };
}

export function formatSubroutineHint(skill: string, stepIndex: number, stepText: string): string {
  return [
    `SUBROUTINE HINT (skill:${skill} step ${stepIndex + 1}): reuse this proven step as one step of your plan; bind its slots to the current request.`,
    `  ${stepText}`,
    "If the step fails when bound, deoptimize only it and continue; do not abandon the whole plan on a single step miss.",
  ].join("\n");
}

/** Convenience: whole-match miss → subroutine matches, ready to inject. */
export function selectSubtaskFastPath(input: {
  skills: SkillBodyRecord[];
  query: string;
  topK?: number;
  minScore?: number;
}): SubtaskMatch[] {
  const index = buildSubtaskIndex(input.skills);
  if (!index.entries.length) return [];
  return matchSubtasks({
    index,
    query: input.query,
    topK: input.topK ?? 2,
    minScore: input.minScore,
  perSkill: true,
  });
}
