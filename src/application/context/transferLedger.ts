/**
 * "Got smarter" ledger — separates memorize (same goal) from transfer (cross-class reuse).
 * Persisted as a single memory note; callers own I/O.
 */

export type ReuseKind = "memorize" | "transfer" | "in_class" | "fresh";

export type TransferStats = {
  memorize: number;
  transfer: number;
  inClass: number;
  freshSuccess: number;
  freshFail: number;
  updatedAt: string;
};

export function emptyTransferStats(): TransferStats {
  return {
    memorize: 0,
    transfer: 0,
    inClass: 0,
    freshSuccess: 0,
    freshFail: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function parseTransferStats(body: string): TransferStats {
  try {
    const parsed = JSON.parse(body) as TransferStats;
    if (parsed && typeof parsed.transfer === "number") {
      return { ...emptyTransferStats(), ...parsed };
    }
  } catch {
    /* fall through */
  }
  return emptyTransferStats();
}

/** Stable short hash of the operator goal — hold-out for memorize vs smarter. */
export function goalHash(goal: string): string {
  const norm = goal.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 400);
  let h = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function transferMemoryKey(agentId: string): string {
  return `metrics/transfer/${agentId}`;
}

/**
 * Classify this run's learning signal.
 * - memorize: this exact goal hash was seen before
 * - transfer: recalled knowledge from another taskClass
 * - in_class: new goal, only same-class priors
 * - fresh: no recalled priors
 */
export function classifyReuse(input: {
  goalHash: string;
  priorGoalHashes: string[];
  currentClass: string;
  recalledFromClasses: string[];
}): ReuseKind {
  if (input.priorGoalHashes.includes(input.goalHash)) return "memorize";
  const foreign = input.recalledFromClasses.filter((c) => c && c !== input.currentClass);
  if (foreign.length) return "transfer";
  if (input.recalledFromClasses.length) return "in_class";
  return "fresh";
}

export function recordReuse(
  stats: TransferStats,
  kind: ReuseKind,
  outcome: "success" | "fail",
): TransferStats {
  const next = { ...stats, updatedAt: new Date().toISOString() };
  if (outcome === "fail") {
    if (kind === "fresh") next.freshFail += 1;
    return next;
  }
  if (kind === "memorize") next.memorize += 1;
  else if (kind === "transfer") next.transfer += 1;
  else if (kind === "in_class") next.inClass += 1;
  else next.freshSuccess += 1;
  return next;
}

/** Transfer rate among non-memorize successes — the "smarter" signal. */
export function transferRate(stats: TransferStats): number | null {
  const smarter = stats.transfer + stats.inClass + stats.freshSuccess;
  if (smarter + stats.memorize === 0) return null;
  if (smarter === 0) return 0;
  return stats.transfer / smarter;
}

export function formatTransferHint(stats: TransferStats): string {
  const rate = transferRate(stats);
  const rateTxt = rate == null ? "n/a" : `${Math.round(rate * 100)}%`;
  return (
    `Learning signal: transfer ${stats.transfer}, in-class ${stats.inClass}, ` +
    `fresh ${stats.freshSuccess}, memorize ${stats.memorize} (transfer share among non-memorize successes: ${rateTxt}). ` +
    `Same goal-hash repeats count as memorize, not smarter.`
  );
}

export function extractGoalHashes(episodes: Array<{ markers: string[]; goal?: string }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ep of episodes) {
    const fromMarker = ep.markers.find((m) => m.startsWith("goalHash:"))?.slice("goalHash:".length);
    const hash = fromMarker || (ep.goal ? goalHash(ep.goal) : "");
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    out.push(hash);
  }
  return out;
}
