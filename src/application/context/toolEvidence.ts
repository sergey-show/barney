/** Facts from tool stdout. The model may paraphrase; the harness pins the exact lines. */

const TOOL_HEAD = /^[a-z][a-z0-9_]*\s+\{/;
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
 * Pin exact tool lines into file content only when the write already references them.
 * Appends a missing atom when a long enough prefix is already present — no format repair.
 */
export function pinRelatedEvidence(content: string, evidence: string[]): string {
  let out = content ?? "";
  for (const atom of unique(evidence)) {
    if (!atom || out.includes(atom)) continue;
    const frag = distinctiveFragment(atom);
    if (!frag || !out.includes(frag)) continue;
    out = out.trim() ? `${out.trim()}\n\n${atom}` : atom;
  }
  return out;
}

/** fs_write / fs_append / fs_edit: carry exact tool lines the model already tried to include. */
export function bindFsWriteArgs(
  name: string,
  args: Record<string, unknown>,
  evidence: string[],
): Record<string, unknown> {
  if (name !== "fs_write" && name !== "fs_append" && name !== "fs_edit") return args;
  const next = { ...args };
  if ((name === "fs_write" || name === "fs_append") && typeof next.content === "string") {
    next.content = pinRelatedEvidence(String(next.content), evidence);
  }
  if (name === "fs_edit" && typeof next.new === "string") {
    next.new = pinRelatedEvidence(String(next.new), evidence);
  }
  return next;
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

/** Contiguous fragment long enough to prove the model meant this atom but mangled it. */
function distinctiveFragment(atom: string): string | undefined {
  const trimmed = atom.trim();
  if (trimmed.length < 12) return;
  return trimmed.slice(0, Math.min(24, Math.max(12, Math.floor(trimmed.length * 0.4))));
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
