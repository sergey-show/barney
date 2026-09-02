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

export function familyKey(call: { name: string; arguments?: Record<string, unknown> }): string {
  if (call.name !== "shell") return toolFamily(call.name);
  const verb = shellHead(String(call.arguments?.command ?? ""));
  return verb ? `shell:${verb}` : "shell";
}

export function shellHead(command: string): string {
  let rest = command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  while (/^cd\s+\S+\s*(?:&&|;)\s*/.test(rest)) {
    rest = rest.replace(/^cd\s+\S+\s*(?:&&|;)\s*/, "");
  }
  const first = rest.split(/\s+/)[0] ?? "";
  return first.replace(/^.*\//, "").replace(/\.exe$/i, "").toLowerCase();
}

/** Extra approaches this operator message (research, recovery, persist). Not run.attempts. Family fails stay in observe. */
export function wantingWithoutLiking(input: {
  extraApproaches: number;
  passed?: boolean;
  leftover?: { unwritten: string[] };
}): boolean {
  if (input.passed) return false;
  const leftover = input.leftover;
  if (leftover && leftover.unwritten.length > 0) return false;
  return input.extraApproaches >= 1;
}

/** Session-local stuckness: extra paths + saturated families + repeated same failure. */
export function frustrationScore(input: {
  extraApproaches: number;
  saturatedFamilies?: number;
  sameFailureCount?: number;
}): number {
  return (input.extraApproaches ?? 0)
    + (input.saturatedFamilies ?? 0)
    + Math.min(input.sameFailureCount ?? 0, 3);
}

export function frustrationCritical(score: number): boolean {
  return score >= 5;
}

export function familySaturated(fails: number): boolean {
  return fails >= 2;
}

export function cycleStrategy(used: StrategyName[], attempts: number, skipResearch = false): StrategyName {
  const cycle = skipResearch ? SOLVE_CYCLE.filter((name) => name !== "research") : SOLVE_CYCLE;
  const unused = cycle.find((name) => !used.includes(name));
  if (unused) return unused;
  const next = cycle[attempts % cycle.length] ?? "recall_failures";
  if (next === used.at(-1)) {
    return cycle[(attempts + 1) % cycle.length] ?? "recall_failures";
  }
  return next;
}

export function needsUser(review: { needsUser?: boolean }): boolean {
  return review.needsUser === true;
}

export type HaltReason = "pass" | "abort" | "budget" | "attempts" | "need_user" | "wanting" | "continue";

export function stopAfterFail(
  review: { verdict: string; missing?: string; summary: string; needsUser?: boolean },
  limits: {
    aborted?: boolean;
    exhausted: boolean;
    attempts: number;
    maxAttempts: number;
    minStrategies: number;
    used: number;
    wanting?: boolean;
    frustration?: number;
  },
): HaltReason {
  if (review.verdict === "pass") return "pass";
  if (limits.aborted) return "abort";
  if (limits.exhausted) return "budget";
  if (limits.attempts >= limits.maxAttempts) return "attempts";
  if (needsUser(review) && limits.used >= Math.max(1, limits.minStrategies)) return "need_user";
  if (limits.wanting || frustrationCritical(limits.frustration ?? 0)) return "wanting";
  return "continue";
}
