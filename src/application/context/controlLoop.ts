import type { StrategyName } from "../../domain/run/Strategy.ts";

export const SOLVE_CYCLE: StrategyName[] = [
  "recall_failures",
  "research",
  "decompose",
  "write_capability",
  "switch_model",
];

export function toolFamily(name: string): string {
  if (name.startsWith("browser_")) return "browser";
  if (name.startsWith("fs_")) return "fs";
  if (name.startsWith("plugin_") || name.startsWith("skill_")) return "plugin";
  if (name.startsWith("memory_") || name.startsWith("board_")) return "memory";
  if (name.startsWith("self_")) return "self";
  if (name.startsWith("agent_") || name === "plan_set") return "team";
  if (name.startsWith("mcp_")) return "mcp";
  return name.split("_")[0] || name;
}

export function wantingWithoutLiking(input: { attempts: number; failed: number; passed?: boolean }): boolean {
  if (input.passed) return false;
  return input.attempts >= 2 || input.failed >= 2;
}

export function familySaturated(fails: number): boolean {
  return fails >= 2;
}

export function cycleStrategy(used: StrategyName[], attempts: number): StrategyName {
  const unused = SOLVE_CYCLE.find((name) => !used.includes(name));
  if (unused) return unused;
  const next = SOLVE_CYCLE[attempts % SOLVE_CYCLE.length] ?? "recall_failures";
  if (next === used.at(-1)) {
    return SOLVE_CYCLE[(attempts + 1) % SOLVE_CYCLE.length] ?? "research";
  }
  return next;
}

export function needsUser(review: { missing?: string; summary: string }): boolean {
  const text = `${review.missing ?? ""} ${review.summary}`;
  if (/need (?:a |the |your )?(?:\w+[-\s]+){0,3}(password|api[_-]?key|\btoken\b)/i.test(text)) return true;
  if (/need (?:a |the |your )?secret\b/i.test(text)) return true;
  if (/which (one|host|file|password)/i.test(text)) return true;
  if (/password (not|missing)|ask (the )?user/i.test(text)) return true;
  return false;
}

export function stopAfterFail(
  review: { verdict: string; missing?: string; summary: string },
  limits: { aborted?: boolean; exhausted: boolean; attempts: number; maxAttempts: number; minStrategies: number; used: number },
): "pass" | "abort" | "budget" | "attempts" | "need_user" | "continue" {
  if (review.verdict === "pass") return "pass";
  if (limits.aborted) return "abort";
  if (limits.exhausted) return "budget";
  if (limits.attempts >= limits.maxAttempts) return "attempts";
  if (needsUser(review) && limits.used >= Math.max(1, limits.minStrategies)) return "need_user";
  return "continue";
}
