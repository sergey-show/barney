/**
 * Semantic recall for Shadow / fail notes without requiring a vector DB.
 * Prefers embeddings when the provider exposes /v1/embeddings; otherwise token overlap.
 */

export type RecallItem = {
  key: string;
  text: string;
  tags?: string[];
};

export function rankBySimilarity(query: string, items: RecallItem[], limit = 3): RecallItem[] {
  if (!query.trim() || !items.length || limit <= 0) return [];
  const qTokens = tokenize(query);
  const scored = items.map((item) => {
    const text = `${item.key} ${item.text}`.toLowerCase();
    const tokens = tokenize(text);
    const hits = qTokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
    const failBoost = item.tags?.some((tag) => /fail|rule|shadow|experience/i.test(tag)) ? 0.5 : 0;
    return { item, score: hits + failBoost + Math.min(jaccard(qTokens, tokens), 1) };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);
}

export function rankByEmbeddings(
  queryVec: number[],
  items: Array<RecallItem & { vector: number[] }>,
  limit = 3,
): RecallItem[] {
  if (!queryVec.length || !items.length || limit <= 0) return [];
  return items
    .map((item) => ({ item, score: cosine(queryVec, item.vector) }))
    .filter((row) => Number.isFinite(row.score) && row.score > 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.item);
}

export function formatShadowWarnings(items: RecallItem[]): string {
  if (!items.length) return "";
  return `Shadow warnings (similar past fails — change approach before repeating):\n${items
    .map((item) => `- ${clip(item.text, 160)}`)
    .join("\n")}`;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    left += x * x;
    right += y * y;
  }
  const denom = Math.sqrt(left) * Math.sqrt(right);
  return denom ? dot / denom : 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}:]+/u)
    .flatMap((token) => token.split("-"))
    .filter((token) => token.length > 2);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const right = new Set(b);
  let inter = 0;
  for (const token of new Set(a)) {
    if (right.has(token)) inter += 1;
  }
  return inter / new Set([...a, ...b]).size;
}

function clip(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}
