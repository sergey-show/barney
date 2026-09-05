import { absorbIntoSamost, type Samost } from "./samost.ts";

/** Shadow this long → idle Dream compresses raw fails into heuristics. */
export const DREAM_SHADOW_MIN = 8;
export const DREAM_KEEP = 6;

export function needsDream(shadow: string[]): boolean {
  return shadow.filter((line) => line.trim().length > 12).length >= DREAM_SHADOW_MIN;
}

export function dreamSystemPrompt(): string {
  return `You compress an agent's Shadow (past failures) into lasting heuristics.
Return ONLY a JSON array of 3 to 6 short imperative strings (English).
Each line: one concrete rule (tool family / approach to avoid or prefer). No markdown, no preamble.`;
}

export function dreamUserPrompt(shadow: string[], rules: string[] = []): string {
  const lines = [
    ...shadow.map((line) => `- ${line}`),
    ...rules.slice(0, 8).map((line) => `- (lesson) ${line}`),
  ];
  return `Compress these failure notes into heuristics:\n${lines.join("\n")}`;
}

export function parseDreamHeuristics(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const json = trimmed.match(/\[[\s\S]*\]/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed)) {
        return cleanHeuristics(parsed.map((item) => String(item)));
      }
    } catch {
      /* fall through */
    }
  }
  return cleanHeuristics(
    trimmed
      .split("\n")
      .map((line) => line.replace(/^\s*[-*\d.]+\s*/, "").replace(/^["']|["']$/g, "").trim())
      .filter(Boolean),
  );
}

/** Offline fallback when the LLM is unavailable — keep distinctive stems. */
export function compressShadowLocally(shadow: string[], limit = DREAM_KEEP): string[] {
  const scored = shadow
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 16)
    .map((line, index) => ({ line, tokens: tokenize(line), index }));
  const kept: string[] = [];
  for (const row of scored) {
    if (kept.length >= limit) break;
    const dup = kept.some((other) => overlap(tokenize(other), row.tokens) >= 2);
    if (dup) continue;
    kept.push(clipHeuristic(row.line));
  }
  return kept;
}

export function applyDreamHeuristics(samost: Samost, heuristics: string[]): Samost {
  const cleaned = cleanHeuristics(heuristics).slice(0, DREAM_KEEP);
  if (!cleaned.length) return samost;
  let next: Samost = {
    ...samost,
    shadow: seedShadows(samost.shadow),
  };
  for (const line of [...cleaned].reverse()) {
    next = absorbIntoSamost(next, line, "shadow");
  }
  return next;
}

function seedShadows(shadow: string[]): string[] {
  return shadow.filter((line) =>
    /guess without evidence|change the tool|do not halt/i.test(line),
  );
}

function cleanHeuristics(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const line = clipHeuristic(raw);
    if (line.length < 16) continue;
    if (/agent successfully|json array|compress these/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function clipHeuristic(line: string): string {
  return line.replace(/\s+/g, " ").trim().slice(0, 180);
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
