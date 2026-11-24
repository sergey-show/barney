/**
 * Idle watchdog (B.2): detect stale progress in the act↔tools loop.
 *
 * Problem the roadmap names "idle watchdog": `acting` without progress in
 * transcript/LLM → the run dies silently. The existing `DoomTracker` catches
 * repeated *identical* tool failures, but a run can stall without any
 * repeated failure — the agent keeps calling different read/probe tools,
 * the transcript grows, but no new artifact lands on disk and no check
 * passes. Long tasks die quietly because nothing signals "you are not
 * making progress, re-prompt or abort."
 *
 * This module is pure (no I/O, no LLM). It compares a snapshot of artifact
 * evidence across a sliding window of recent steps and decides whether the
 * loop is stale. "Stale" = the evidence signature did not change for
 * `windowSteps` consecutive steps. The signature is a cheap hash of write
 * lines, check-pass lines, and EXISTS lines — the signals that mean "real
 * progress on disk", not just "more reading".
 *
 * The actual re-prompt injection lives in DriveSolve; this module only
 * decides *when* the loop is stale so it can be unit-tested.
 */

export type StaleVerdict =
  | { stale: false }
  | { stale: true; reason: string; stepsStale: number };

/** Lines that count as "real progress" — writes, check passes, existence. */
const PROGRESS_RE = /^fs_write\b|^\s*Check passed|EXISTS\b|Wrote\s+\S+\s+\(?\d+\s*bytes\)?/i;

/**
 * Compute the progress signature of an evidence string: the set of lines
 * matching PROGRESS_RE. Two equal signatures mean "no new progress on disk".
 */
export function progressSignature(evidence: string): string {
  return evidence
    .split("\n")
    .filter((line) => PROGRESS_RE.test(line))
    .join("\n");
}

/**
 * Track per-step progress signatures and detect staleness.
 * Call `note` after each step with the current evidence; call `verdict` to
 * check whether the loop is stale.
 */
export class StaleTracker {
  private signatures: string[] = [];
  private lastChangedAt = 0;

  constructor(private readonly windowSteps: number = 4) {}

  /** Record the evidence snapshot after a step. Returns the step index. */
  note(evidence: string): number {
    const sig = progressSignature(evidence);
    const step = this.signatures.length;
    if (step === 0 || sig !== this.signatures[step - 1]) {
      this.lastChangedAt = step;
    }
    this.signatures.push(sig);
    return step;
  }

  /** Whether the loop is stale: no progress signature change for windowSteps
   * consecutive snapshots. `windowSteps=4` means "4 identical signatures in
   * a row" → stale after the 4th. */
  verdict(currentStep: number): StaleVerdict {
    // Need at least `windowSteps` snapshots recorded.
    if (currentStep < this.windowSteps - 1) return { stale: false };
    const stepsSinceChange = currentStep - this.lastChangedAt;
    // stale when the last `windowSteps` snapshots are all the same as the
    // one at lastChangedAt (i.e. no change for windowSteps-1 transitions).
    if (stepsSinceChange < this.windowSteps - 1) return { stale: false };
    const frozenSig = this.signatures[currentStep] ?? "";
    const isEmpty = frozenSig === "";
    return {
      stale: true,
      reason: isEmpty
        ? `no artifact-evidence progress for ${stepsSinceChange + 1} steps (window=${this.windowSteps}) — only reads/probes, no writes or checks`
        : `artifact evidence frozen for ${stepsSinceChange + 1} steps (window=${this.windowSteps}) — same write/check signature repeated`,
      stepsStale: stepsSinceChange + 1,
    };
  }

  /** Reset for a new act round (e.g. after a re-prompt). */
  reset(): void {
    this.signatures = [];
    this.lastChangedAt = 0;
  }
}

/**
 * Functional variant: decide staleness from a window of evidence snapshots.
 * Useful when the caller keeps its own transcript and does not want a
 * stateful tracker.
 */
export function detectStaleProgress(input: {
  /** Evidence snapshots, oldest first; one per step. */
  evidenceWindow: string[];
  windowSteps?: number;
}): StaleVerdict {
  const window = input.evidenceWindow;
  const threshold = input.windowSteps ?? 4;
  if (window.length < threshold) return { stale: false };
  // Take the last `threshold` snapshots and check if all are equal.
  const tail = window.slice(window.length - threshold);
  const first = progressSignature(tail[0] ?? "");
  const allSame = tail.every((e) => progressSignature(e) === first);
  // Stale only if the signature is also empty (no progress lines at all)
  // OR the same non-empty signature repeated (writes that didn't change).
  if (!allSame) return { stale: false };
  const isEmpty = first === "";
  return {
    stale: true,
    reason: isEmpty
      ? `no artifact-evidence progress for ${threshold} steps — only reads/probes, no writes or checks`
      : `artifact evidence frozen for ${threshold} steps — same write/check signature repeated`,
    stepsStale: threshold,
  };
}

/** Format the re-prompt nudge injected when the watchdog fires. */
export function staleProgressNudge(verdict: { stale: true; reason: string }): string {
  return [
    `[stale-watchdog] ${verdict.reason}`,
    "You have not produced new artifact evidence (writes, check passes, EXISTS) recently.",
    "Stop re-reading and re-planning. Either:",
    "  1. fs_write the deliverable now from what you already gathered, or",
    "  2. run the verify/test command that proves the current state, or",
    "  3. if you are truly blocked, say so explicitly — do not loop silently.",
  ].join(" ");
}
