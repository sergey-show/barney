/**
 * Synaptic competition for recall: top-k by weight × similarity (fayr §3, §6.3).
 */

import { clipText } from "../context/packSession.ts";

export type WeightedCandidate = {
  line: string;
  kind: "shadow" | "rule" | "skill" | "episode";
  /** Synaptic weight / strength 0..1+ */
  weight: number;
};

export type ScoredCandidate = WeightedCandidate & {
  similarity: number;
  score: number;
};

export function tokenizeRecall(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}:]+/u)
    .flatMap((token) => token.split("-"))
    .filter((token) => token.length > 2);
}

export function recallSimilarity(query: string, line: string): number {
  const q = tokenizeRecall(query);
  const t = tokenizeRecall(line);
  if (!q.length || !t.length) return 0;
  const right = new Set(t);
  let hits = 0;
  for (const token of new Set(q)) {
    if (right.has(token)) hits += 1;
  }
  const jaccard = hits / (new Set([...q, ...t]).size || 1);
  const coverage = hits / q.length;
  return Math.min(1, jaccard * 0.6 + coverage * 0.4);
}

/** score = weight × (0.15 + similarity) — weak weight still competes if very similar. */
export function scoreCandidate(query: string, item: WeightedCandidate): ScoredCandidate {
  const similarity = recallSimilarity(query, item.line);
  const weight = Math.max(0.05, item.weight);
  return {
    ...item,
    similarity,
    score: weight * (0.15 + similarity),
  };
}

export function topKByWeightSimilarity(
  query: string,
  items: WeightedCandidate[],
  limit: number,
): ScoredCandidate[] {
  if (limit <= 0 || !items.length) return [];
  return items
    .map((item) => scoreCandidate(query, item))
    .filter((row) => row.similarity > 0 || row.weight >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function renderScoredBag(kind: WeightedCandidate["kind"], rows: ScoredCandidate[]): string[] {
  return rows
    .filter((row) => row.kind === kind)
    .map((row) => clipText(row.line, 200));
}
