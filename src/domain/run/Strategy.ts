export const STRATEGIES = [
  "retry_with_error",
  "recall_failures",
  "research",
  "decompose",
  "write_capability",
  "switch_model",
  "park_and_ask",
] as const;

export type StrategyName = (typeof STRATEGIES)[number];

export function planHash(strategy: StrategyName, detail: string): string {
  return `${strategy}:${detail.trim().toLowerCase()}`;
}
