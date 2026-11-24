/**
 * Harbor scorecard generator (B.4): parse a run trajectory into a benchmark
 * JSON scorecard with infra-fail separation and pass@k.
 *
 * The roadmap names this "clean Harbor scoreboard": full TB2, separate infra
 * fails, prebake/retry apt, pass@k. This module does the parsing layer —
 * it takes a Run (or its transcript + status) and emits a scorecard entry.
 * It does not run tasks; it turns a finished run into a comparable number.
 *
 * "Infra fail" = the run died because of environment, not the agent:
 *   - permission needed / outside path (sandbox block)
 *   - apt install / package install failure
 *   - timeout / abort
 * Infra fails are tagged separately so they do not count against pass@1 —
 * a 47% pass rate where 10% were infra is not the same as 47% pure fail.
 *
 * "pass@k" = over k attempts, did at least one succeed? Computed from an
 * array of scorecard entries (one per attempt).
 */

export type ScorecardEntry = {
  task_id: string;
  status: "pass" | "fail" | "infra_fail" | "timeout" | "aborted";
  infra_fail: boolean;
  failure_kind: string;
  tokens: number;
  usd: number;
  duration_ms: number;
  /** Step count (transcript length) — cheap complexity proxy. */
  steps: number;
  /** Final assistant reply length — cheap "did it answer" proxy. */
  reply_chars: number;
  /** Did the agent write at least one file? */
  wrote_artifact: boolean;
};

export type ScorecardInput = {
  task_id: string;
  /** Final run status: "done" | "failed" | "parked" | "aborted" | ... */
  status: string;
  /** Transcript items: kind + text. */
  transcript: Array<{ kind: string; text: string }>;
  tokens: number;
  usd: number;
  duration_ms: number;
  /** Optional: reviewer failure kind (missing-artifact, masked-deliverable, ...). */
  failureKind?: string;
};

/**
 * Build a single scorecard entry from a finished run.
 * Infra-fail detection runs first: if the transcript shows environment
 * failures (permission, apt, timeout, abort), the entry is tagged
 * `infra_fail` and `infra_fail: true` — it does not count against pass@1.
 */
export function buildScorecard(input: ScorecardInput): ScorecardEntry {
  const infra = detectInfraFail(input.transcript, input.status);
  const wroteArtifact = input.transcript.some(
    (item) => item.kind === "console" && /^fs_write\b/.test(item.text),
  );
  const replyChars = lastAssistantReply(input.transcript).length;

  let status: ScorecardEntry["status"];
  let failureKind = input.failureKind ?? "general";
  if (infra) {
    status = infra === "timeout" ? "timeout" : infra === "aborted" ? "aborted" : "infra_fail";
    failureKind = "infra";
  } else if (input.status === "done") {
    status = "pass";
  } else {
    status = "fail";
  }

  return {
    task_id: input.task_id,
    status,
    infra_fail: Boolean(infra),
    failure_kind: failureKind,
    tokens: input.tokens,
    usd: input.usd,
    duration_ms: input.duration_ms,
    steps: input.transcript.length,
    reply_chars: replyChars,
    wrote_artifact: wroteArtifact,
  };
}

/**
 * Detect infra failure from transcript signals. Returns the infra kind or null.
 * - timeout: abort + "timeout" marker
 * - aborted: abort without "done"
 * - infra_fail: permission needed, outside path, apt install failure
 */
export function detectInfraFail(
  transcript: Array<{ kind: string; text: string }>,
  status: string,
): "infra_fail" | "timeout" | "aborted" | null {
  const texts = transcript.map((item) => item.text).join("\n");
  // Timeout / abort
  if (status === "aborted" || /aborted|step interrupted/i.test(texts)) {
    if (/timeout|AbortSignal\.timeout|timed?\s*out/i.test(texts)) return "timeout";
    return "aborted";
  }
  // Permission / sandbox block
  if (/permission required:.*path escapes worktree|Outside path needs permission/i.test(texts)) {
    return "infra_fail";
  }
  // apt install / package install failure (common infra gap on fresh sandbox)
  if (/\bapt(?:[-_\s]?get)?\s+install\b[\s\S]*?(?:error|fail|E:|exit\s+[1-9])/i.test(texts)
    || /\bpip\s+install\b[\s\S]*?(?:error|fail|exit\s+[1-9])/i.test(texts)
    || /\bnpm\s+install\b[\s\S]*?(?:error|fail|exit\s+[1-9])/i.test(texts)) {
    return "infra_fail";
  }
  return null;
}

/**
 * pass@k: over k attempts, did at least one succeed (status === "pass")?
 * Also returns pass@1 (first-attempt success rate) and infra-fail count.
 */
export function passAtK(entries: ScorecardEntry[]): {
  pass_at_1: number;
  pass_at_k: number;
  k: number;
  infra_fails: number;
  pure_fails: number;
  total: number;
} {
  const total = entries.length;
  if (total === 0) {
    return { pass_at_1: 0, pass_at_k: 0, k: 0, infra_fails: 0, pure_fails: 0, total: 0 };
  }
  const passes = entries.filter((e) => e.status === "pass").length;
  const infra = entries.filter((e) => e.infra_fail).length;
  const pureFails = entries.filter((e) => e.status === "fail").length;
  return {
    pass_at_1: Number((passes / total).toFixed(4)),
    pass_at_k: passes > 0 ? 1 : 0,
    k: total,
    infra_fails: infra,
    pure_fails: pureFails,
    total,
  };
}

/** Aggregate many task scorecards into a summary scoreboard. */
export function aggregateScoreboard(entries: ScorecardEntry[]): {
  total: number;
  pass_at_1: number;
  pass_at_k: number;
  infra_fails: number;
  pure_fails: number;
  avg_tokens: number;
  avg_usd: number;
  avg_duration_ms: number;
  by_failure_kind: Record<string, number>;
} {
  const stats = passAtK(entries);
  const avg = (sel: (e: ScorecardEntry) => number) =>
    entries.length ? Math.round(entries.reduce((s, e) => s + sel(e), 0) / entries.length) : 0;
  const byKind: Record<string, number> = {};
  for (const e of entries) {
    byKind[e.failure_kind] = (byKind[e.failure_kind] ?? 0) + 1;
  }
  return {
    total: stats.total,
    pass_at_1: stats.pass_at_1,
    pass_at_k: stats.pass_at_k,
    infra_fails: stats.infra_fails,
    pure_fails: stats.pure_fails,
    avg_tokens: avg((e) => e.tokens),
    avg_usd: Number((avg((e) => e.usd)).toFixed(4)),
    avg_duration_ms: avg((e) => e.duration_ms),
    by_failure_kind: byKind,
  };
}

function lastAssistantReply(transcript: Array<{ kind: string; text: string }>): string {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const item = transcript[i];
    if (item && item.kind === "assistant") return item.text;
  }
  return "";
}
