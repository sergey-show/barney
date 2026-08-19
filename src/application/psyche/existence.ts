import { asText } from "../context/packSession.ts";

export type ExistenceKind = "act" | "observe" | "review" | "idle";

export type ExistenceBlock = {
  at: string;
  kind: ExistenceKind;
  text: string;
};

export const EXISTENCE_CAP = 10;

export function parseExistence(body: string): ExistenceBlock[] {
  const blocks: ExistenceBlock[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^-\s*(\S+)\s*·\s*(\w+)\s*·\s*(.+)$/);
    if (!match) continue;
    const kind = match[2] as ExistenceKind;
    if (!["act", "observe", "review", "idle"].includes(kind)) continue;
    blocks.push({ at: match[1] ?? "", kind, text: (match[3] ?? "").trim() });
  }
  return blocks.slice(-EXISTENCE_CAP);
}

export function appendExistence(blocks: ExistenceBlock[], next: Omit<ExistenceBlock, "at"> & { at?: string }): ExistenceBlock[] {
  const text = asText(next.text).replace(/\s+/g, " ").trim();
  if (!text) return blocks;
  const last = blocks.at(-1);
  if (last && last.kind === next.kind && last.text === text) return blocks;
  return [...blocks, { at: next.at ?? new Date().toISOString(), kind: next.kind, text }].slice(-EXISTENCE_CAP);
}

export function formatExistence(blocks: ExistenceBlock[]): string {
  if (!blocks.length) {
    return "# Existence\nThe draft is empty. Essence is not written yet — first a deed.";
  }
  return [
    "# Existence",
    "Existence precedes essence. Each deed is a line of the draft, not a rehearsal.",
    ...blocks.map((block) => `- ${block.at} · ${block.kind} · ${block.text}`),
  ].join("\n");
}

export function renderExistencePrompt(blocks: ExistenceBlock[]): string {
  if (!blocks.length) return "Draft of this life: empty — write a deed, not a program of the self.";
  return [
    "Draft of this life. Act first; essence follows.",
    ...blocks.slice(-6).map((block) => `- ${block.kind}: ${block.text}`),
  ].join("\n");
}
