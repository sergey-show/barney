import { clipPage, queryTerms } from "./clipPage.ts";

export type ReplyCheck = {
  ok: boolean;
  mismatches: string[];
};

export function pageCodeIdents(evidence: string): string[] {
  const found = new Set<string>();
  for (const match of evidence.matchAll(/\b([A-Z][A-Za-z0-9]+)\.([A-Za-z][\w]*)\b/g)) {
    const right = match[2] ?? "";
    if (/^(com|org|net|io|sh|dev|html|js|ts|md)$/i.test(right)) continue;
    found.add(`${match[1]}.${right}`);
  }
  return [...found];
}

export function replyOmitsPageCode(reply: string, evidence: string, query = ""): string | undefined {
  const idents = pageCodeIdents(evidence);
  if (!idents.length) return;
  const terms = queryTerms(query);
  const relevant = terms.length ? idents.filter((id) => terms.some((term) => id.toLowerCase().includes(term))) : idents;
  const check = relevant.length ? relevant : idents;
  if (check.some((id) => reply.includes(id))) return;
  return `reply omits documented API from the opened page (${check.slice(0, 3).join(", ")})`;
}

export function pageEvidence(transcript: Array<{ kind: string; text: string }>, query: string): string {
  return transcript
    .filter((item) => item.kind === "console" && /^(browser_open|web_search)\b/i.test(item.text))
    .slice(-6)
    .map((item) => clipPage(item.text, query, 1800))
    .join("\n---\n");
}

export function parseReplyCheck(text: string): ReplyCheck {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { ok?: boolean; mismatches?: unknown };
      const mismatches = Array.isArray(parsed.mismatches)
        ? parsed.mismatches.map((item) => String(item).trim()).filter(Boolean)
        : [];
      if (parsed.ok === true && mismatches.length) return { ok: false, mismatches };
      if (typeof parsed.ok === "boolean") return { ok: parsed.ok, mismatches };
    } catch {
      /* fallthrough */
    }
  }
  if (/\b(mismatch|does not match|contradict)/i.test(text)) {
    return { ok: false, mismatches: [text.replace(/\s+/g, " ").trim().slice(0, 280)] };
  }
  return { ok: true, mismatches: [] };
}

export const VERIFY_SYSTEM = `Role: verifier. Compare the visible reply to opened page / tool output first. A research brief is a hint, not a source.
Pass only if every concrete fact in the reply (model IDs, versions, dates, prices, URLs, hardware, API names) appears in the opened pages or tool output.
If the opened page shows a specific API in a sample and the reply uses a different one — not ok.
If the reply guessed, rounded, swapped a name, or used memory instead of the tool output — not ok.
Reply as JSON only: {"ok":true|false,"mismatches":["..."]}`;

export function verifyPacket(reply: string, evidence: string): string {
  return [
    `Visible reply:\n${reply.slice(0, 4000)}`,
    `Evidence (tools, console, research):\n${evidence || "(none)"}`,
    "Does the reply match the evidence?",
  ].join("\n\n");
}
