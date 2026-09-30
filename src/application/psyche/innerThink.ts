/**
 * Bounded inner think — the agent talks to itself, not to the operator.
 *
 * Law: short LLM turn → board / memory / existence only.
 * Not a forever background loop. Cooldown + idle/waiting gate in idleTick.
 */

import { addBoard, type BoardEntry, type BoardKind, isBoardKind } from "./board.ts";

export const INNER_THINK_IDLE_MS = 5 * 60_000;
export const INNER_THINK_COOLDOWN_MS = 10 * 60_000;
export const INNER_THINK_WAITING_COOLDOWN_MS = 5 * 60_000;

export type InnerThinkDraft = {
  thoughts: string;
  board: BoardEntry[];
  note: string;
};

export function innerThinkSystemPrompt(): string {
  return `You are the agent's private inner monologue. The operator must not see this turn.
Reflect on the session board, shadow, and waiting state.
Return ONLY JSON:
{"thoughts":"1-2 short sentences","board":[{"kind":"fact|blocker|decision|note","text":"..."}],"note":"optional durable lesson or empty"}
Rules: do not change motive; do not invent tools/URLs; do not address the operator; max 3 board lines; English.
If deliberate practice is warranted, set note to: agenda: <failClass> | <short hint>
If a shadow line should be absorbed, set note to: shadow: <one imperative heuristic>`;
}

export function innerThinkUserPrompt(input: {
  reason: "waiting" | "idle";
  motive?: string;
  board: BoardEntry[];
  shadow: string[];
  failHints?: string[];
  wakeReasons?: string[];
}): string {
  const lines = [
    `Mode: ${input.reason === "waiting" ? "waiting on a wake/process — think while parked" : "idle — think without an operator turn"}`,
    input.motive ? `Motive: ${input.motive}` : "",
    input.wakeReasons?.length ? `Armed wakes:\n${input.wakeReasons.map((w) => `- ${w}`).join("\n")}` : "",
    input.board.length
      ? `Board:\n${input.board.slice(-10).map((e) => `- [${e.kind}] ${e.text}`).join("\n")}`
      : "Board: (empty)",
    input.shadow.length
      ? `Shadow (recent):\n${input.shadow.slice(-6).map((s) => `- ${s}`).join("\n")}`
      : "",
    input.failHints?.length
      ? `Fail hints:\n${input.failHints.slice(0, 4).map((h) => `- ${h}`).join("\n")}`
      : "",
  ].filter(Boolean);
  return lines.join("\n\n");
}

export function parseInnerThink(text: string): InnerThinkDraft {
  const trimmed = text.trim();
  const json = trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as {
        thoughts?: unknown;
        board?: unknown;
        note?: unknown;
      };
      const boardRaw = Array.isArray(parsed.board) ? parsed.board : [];
      const board: BoardEntry[] = [];
      for (const row of boardRaw.slice(0, 3)) {
        if (!row || typeof row !== "object") continue;
        const kind = String((row as { kind?: string }).kind ?? "");
        const textLine = String((row as { text?: string }).text ?? "").replace(/\s+/g, " ").trim();
        if (!isBoardKind(kind) || kind === "motive" || kind === "action" || kind === "operation") continue;
        if (!textLine || textLine.length < 4) continue;
        board.push({ kind: kind as BoardKind, text: textLine.slice(0, 200) });
      }
      return {
        thoughts: String(parsed.thoughts ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
        board,
        note: String(parsed.note ?? "").replace(/\s+/g, " ").trim().slice(0, 800),
      };
    } catch {
      /* fall through */
    }
  }
  return innerThinkLocalFallback({ shadow: [], board: [] });
}

/** Offline / empty LLM: promote one shadow line into a board note. */
export function innerThinkLocalFallback(input: {
  shadow: string[];
  board: BoardEntry[];
  failHints?: string[];
}): InnerThinkDraft {
  const hint = (input.failHints?.[0] || input.shadow.at(-1) || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!hint) {
    return {
      thoughts: "Nothing urgent on the board; stay ready for the next operator turn.",
      board: [],
      note: "",
    };
  }
  return {
    thoughts: `Rehearse before acting: ${hint.slice(0, 120)}`,
    board: [{ kind: "note", text: `inner: ${hint}` }],
    note: "",
  };
}

export function applyInnerThinkBoard(board: BoardEntry[], adds: BoardEntry[]): BoardEntry[] {
  let next = board;
  for (const entry of adds) {
    if (entry.kind === "motive" || entry.kind === "action" || entry.kind === "operation") continue;
    next = addBoard(next, entry);
  }
  return next;
}

/** Rare write proposals from inner think — agenda drill or shadow absorb. */
export function parseInnerThinkDirectives(note: string): {
  agenda?: { failClass: string; hint: string };
  shadow?: string;
} {
  const text = note.trim();
  if (!text) return {};
  const agenda = /^agenda:\s*([a-z0-9][a-z0-9._-]*)\s*(?:\|\s*(.+))?$/i.exec(text);
  if (agenda?.[1]) {
    return {
      agenda: {
        failClass: agenda[1].toLowerCase(),
        hint: (agenda[2] || `Inner think recommended drill for ${agenda[1]}`).trim(),
      },
    };
  }
  const shadow = /^shadow:\s*(.+)$/i.exec(text);
  if (shadow?.[1]) return { shadow: shadow[1].trim().slice(0, 200) };
  return {};
}
