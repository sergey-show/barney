/**
 * Lightweight cross-run task-class stats for strategy prior (generalization seed).
 * Stored as a single memory note body; callers own persistence.
 */

export type StrategyStat = {
  strategy: string;
  wins: number;
  fails: number;
};

export type TaskClassStats = {
  taskClass: string;
  strategies: StrategyStat[];
  updatedAt: string;
};

export function emptyStats(taskClass: string): TaskClassStats {
  return { taskClass, strategies: [], updatedAt: new Date().toISOString() };
}

export function parseTaskClassStats(body: string, taskClass: string): TaskClassStats {
  try {
    const parsed = JSON.parse(body) as TaskClassStats;
    if (parsed && parsed.taskClass && Array.isArray(parsed.strategies)) return parsed;
  } catch {
    /* fall through */
  }
  return emptyStats(taskClass);
}

export function recordStrategyOutcome(
  stats: TaskClassStats,
  strategy: string,
  outcome: "success" | "fail",
): TaskClassStats {
  const next = {
    taskClass: stats.taskClass,
    strategies: stats.strategies.map((row) => ({ ...row })),
    updatedAt: new Date().toISOString(),
  };
  let row = next.strategies.find((item) => item.strategy === strategy);
  if (!row) {
    row = { strategy, wins: 0, fails: 0 };
    next.strategies.push(row);
  }
  if (outcome === "success") row.wins += 1;
  else row.fails += 1;
  return next;
}

/** Prefer strategies with ≥3 samples and ≥60% win rate; else unused. */
export function preferredStrategies(stats: TaskClassStats, limit = 2): string[] {
  return [...stats.strategies]
    .map((row) => {
      const n = row.wins + row.fails;
      const rate = n ? row.wins / n : 0;
      return { strategy: row.strategy, n, rate };
    })
    .filter((row) => row.n >= 3 && row.rate >= 0.6)
    .sort((a, b) => b.rate - a.rate || b.n - a.n)
    .slice(0, limit)
    .map((row) => row.strategy);
}

export function statsMemoryKey(taskClass: string): string {
  return `stats/${taskClass || "general"}`;
}

export function formatStatsHint(stats: TaskClassStats): string {
  const prefs = preferredStrategies(stats);
  if (!prefs.length) return "";
  const detail = prefs.map((name) => {
    const row = stats.strategies.find((item) => item.strategy === name);
    if (!row) return name;
    const n = row.wins + row.fails;
    const pct = Math.round((row.wins / n) * 100);
    return `${name} (${pct}% of ${n})`;
  });
  return `Task-class prior: prefer ${detail.join(", ")} when stuck.`;
}
