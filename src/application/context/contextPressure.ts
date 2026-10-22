/**
 * Context pressure — escalate packing before budget hard-fail (summarize-on-90% budget).
 */

export type ContextPressureLevel = "ok" | "warn" | "critical";

export type ContextPressure = {
  level: ContextPressureLevel;
  reason: string;
  /** Tighter packSession knobs. */
  recentCount: number;
  maxRecentChars: number;
};

const DEFAULT_RECENT = 14;
const DEFAULT_MAX_RECENT = 12_000;

export function assessContextPressure(input: {
  transcriptChars: number;
  durableTurns: number;
  tokensUsed: number;
  tokenLimit: number;
}): ContextPressure {
  const ratio = input.tokenLimit > 0 ? input.tokensUsed / input.tokenLimit : 0;
  if (ratio >= 0.9 || input.transcriptChars >= 120_000 || input.durableTurns >= 80) {
    return {
      level: "critical",
      reason: `tokens=${pct(ratio)} durable=${input.durableTurns} chars=${input.transcriptChars}`,
      recentCount: 6,
      maxRecentChars: 6_000,
    };
  }
  if (ratio >= 0.7 || input.transcriptChars >= 60_000 || input.durableTurns >= 40) {
    return {
      level: "warn",
      reason: `tokens=${pct(ratio)} durable=${input.durableTurns} chars=${input.transcriptChars}`,
      recentCount: 10,
      maxRecentChars: 9_000,
    };
  }
  return {
    level: "ok",
    reason: "within budget",
    recentCount: DEFAULT_RECENT,
    maxRecentChars: DEFAULT_MAX_RECENT,
  };
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
