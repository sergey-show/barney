import type { BoardEntry } from "./board.ts";
import { needsDream } from "./dream.ts";
import type { ExistenceBlock } from "./existence.ts";
import type { Samost } from "./samost.ts";

export const LONG_IDLE_MS = 10 * 60_000;
export const STUDY_COOLDOWN_MS = 15 * 60_000;

export type IdleItem =
  | { item: "seed_samost" }
  | { item: "absorb_shadow"; rule: string }
  | { item: "board_to_existence"; text: string }
  | { item: "dream" }
  | { item: "study"; topic: string }
  | { item: "none" };

export function nextIdleWork(input: {
  samostPresent: boolean;
  samost: Samost;
  existence: ExistenceBlock[];
  board: BoardEntry[];
  rules: string[];
  idleMs?: number;
  failHints?: string[];
  studied?: string[];
  studyCooldownMs?: number;
}): IdleItem {
  if (!input.samostPresent) return { item: "seed_samost" };

  const openBlocker = input.board.find((entry) => entry.kind === "blocker");
  const already = input.existence.some((block) => block.text === openBlocker?.text);
  if (openBlocker && !already) {
    return { item: "board_to_existence", text: openBlocker.text };
  }

  if (needsDream(input.samost.shadow)) return { item: "dream" };

  const freshRule = input.rules.find((rule) => {
    const needle = rule.toLowerCase();
    return !input.samost.shadow.some((line) => line.toLowerCase() === needle)
      && !input.samost.light.some((line) => line.toLowerCase() === needle);
  });
  if (freshRule) return { item: "absorb_shadow", rule: freshRule };

  if ((input.idleMs ?? 0) >= LONG_IDLE_MS && (input.studyCooldownMs ?? STUDY_COOLDOWN_MS) >= STUDY_COOLDOWN_MS) {
    const topic = pickStudyTopic({
      shadow: input.samost.shadow,
      failHints: input.failHints ?? [],
      studied: input.studied ?? [],
    });
    if (topic) return { item: "study", topic };
  }

  return { item: "none" };
}

export function pickStudyTopic(input: {
  shadow: string[];
  failHints: string[];
  studied: string[];
}): string | null {
  const studied = input.studied.map((item) => item.toLowerCase());
  const candidates = [...input.failHints, ...input.shadow]
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 16);
  return candidates.find((topic) => {
    const needle = topic.toLowerCase().slice(0, 48);
    return !studied.some((seen) => seen.includes(needle) || needle.includes(seen.slice(0, 48)));
  }) ?? null;
}

export function studyQuery(topic: string): string {
  return `How to recover from this agent failure without guessing URLs or repeating the same tool call: ${topic.slice(0, 180)}`;
}

export { FAST_ROLES, SLOW_ROLES } from "../../domain/provider/Role.ts";
