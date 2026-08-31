/** Facts from tool stdout for reply pinning. File bodies are written as the model sent them. */

const TOOL_HEAD = /^[a-z][a-z0-9_]*\s+\{/;
/** Harness protocol lines only — not an error/language catalog. */
const SKIP = /^(exit \d+|\(no output\)|ok|Observe:|BLOCKED:)/i;
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
  return capEvidence(found);
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

/**
 * Do not rewrite fs_* payloads. Injecting stdout into files mixed shell errors into scripts.
 * Evidence stays for replies via ensureToolEvidence; the model owns file contents.
 */
export function bindFsWriteArgs(
  name: string,
  args: Record<string, unknown>,
  _evidence: string[],
): Record<string, unknown> {
  void name;
  void _evidence;
  return args;
}

function capEvidence(found: string[]): string[] {
  if (found.length <= MAX_ATOMS) return found;
  const ranked = found
    .map((text, index) => ({ text, index, score: text.length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_ATOMS);
  const keep = new Set(ranked.map((item) => item.text));
  return found.filter((text) => keep.has(text));
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
