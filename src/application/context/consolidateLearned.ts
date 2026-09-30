/**
 * Consolidate # Learned appendages on the agent constitution.
 * Immune base (everything before the first # Learned) is never rewritten.
 */

const LEARNED_HEAD = /^#\s*Learned\s*$/im;

export type LearnedConsolidation = {
  constitution: string;
  changed: boolean;
  before: number;
  after: number;
};

export function needsLearnedConsolidation(constitution: string, minBlocks = 6): boolean {
  return splitLearnedBlocks(constitution).blocks.length >= minBlocks;
}

export function splitLearnedBlocks(constitution: string): {
  base: string;
  blocks: string[];
} {
  const text = constitution.replace(/\r\n/g, "\n").trim();
  const match = LEARNED_HEAD.exec(text);
  if (!match || match.index == null) {
    return { base: text, blocks: [] };
  }
  const base = text.slice(0, match.index).trim();
  const rest = text.slice(match.index + match[0].length);
  const chunks = rest
    .split(LEARNED_HEAD)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length > 8);
  return { base, blocks: chunks };
}

/**
 * Deduplicate Learned notes (token overlap), keep shorter phrasing, cap count.
 * Does not touch the immune base above the first # Learned.
 */
export function consolidateLearnedBlocks(
  constitution: string,
  limit = 8,
): LearnedConsolidation {
  const { base, blocks } = splitLearnedBlocks(constitution);
  if (!blocks.length) {
    return { constitution: constitution.trim(), changed: false, before: 0, after: 0 };
  }
  const merged = mergeSimilar(blocks, limit);
  const next = merged.length
    ? `${base}\n\n# Learned\n${merged.join("\n\n# Learned\n")}`.trim()
    : base;
  return {
    constitution: next,
    changed: next !== constitution.trim(),
    before: blocks.length,
    after: merged.length,
  };
}

/**
 * Collapse near-duplicate rule note bodies (same spirit as dream.mergeFailureRules).
 * Returns shorter unique lines for rewriting memory notes' display / dream input.
 */
export function consolidateRuleLines(rules: string[], limit = 12): {
  lines: string[];
  before: number;
  after: number;
  changed: boolean;
} {
  const cleaned = rules
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 12);
  const merged = mergeSimilar(cleaned, limit);
  return {
    lines: merged,
    before: cleaned.length,
    after: merged.length,
    changed: merged.join("\n") !== cleaned.join("\n"),
  };
}

function mergeSimilar(lines: string[], limit: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const tokens = tokenize(line);
    const idx = out.findIndex((other) => overlap(tokenize(other), tokens) >= 2);
    if (idx >= 0) {
      if (line.length < out[idx]!.length) out[idx] = clip(line);
      continue;
    }
    out.push(clip(line));
    if (out.length >= limit) break;
  }
  return out;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}:]+/u)
    .filter((token) => token.length > 2);
}

function overlap(a: string[], b: string[]): number {
  const set = new Set(b);
  return a.reduce((sum, token) => sum + (set.has(token) ? 1 : 0), 0);
}

function clip(line: string): string {
  return line.replace(/\s+/g, " ").trim().slice(0, 240);
}
