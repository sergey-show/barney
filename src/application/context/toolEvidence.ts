/** Facts from tool stdout. The model may paraphrase; the harness pins the exact lines. */

const TOOL_HEAD = /^[a-z][a-z0-9_]*\s+\{/;
const SKIP = /^(exit \d+|\(no output\)|ok)$/i;
const MIN = 6;
const MAX = 240;
const MAX_ATOMS = 24;

export function extractToolEvidence(...parts: unknown[]): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const part of parts) {
    const body = typeof part === "string" ? part : part == null ? "" : String(part);
    for (const line of body.split("\n")) {
      const text = line.trim().replace(/[.,;:]+$/g, "");
      if (text.length < MIN || text.length > MAX) continue;
      if (SKIP.test(text) || TOOL_HEAD.test(text) || seen.has(text)) continue;
      seen.add(text);
      found.push(text);
    }
  }
  return found.slice(0, MAX_ATOMS);
}

/** If a tool line is missing from the reply, append it verbatim — no script tables, no fuzzy match. */
export function ensureToolEvidence(text: string, evidence: string[]): string {
  let out = (text ?? "").trim();
  for (const atom of unique(evidence)) {
    if (!atom || out.includes(atom)) continue;
    out = out ? `${out}\n\n${atom}` : atom;
  }
  return out;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
