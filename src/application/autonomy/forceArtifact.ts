/**
 * Force-Artifact: mid-budget circuit-breaker for the act↔tools loop.
 *
 * Problem the roadmap names "Force-Artifact": on long goals the agent can
 * spend the whole turn budget exploring (reads, probes, partial writes)
 * without ever producing the one deliverable the ZPD-3 gate will check.
 * When budget runs out, the run drops with `missing-artifact` even though
 * a minimal verifiable artifact was within reach two or three steps earlier.
 *
 * This module decides *when* to force and *what* to force, deterministically
 * (no LLM, no embeddings). The actual injection happens in DriveSolve via a
 * steer message; the selector here stays pure so it can be unit-tested.
 *
 * "Mid-budget" = past the halfway point of the configured tool-step budget.
 * "Target artifact" = a path the user explicitly asked to be written, as
 * detected by `requestedArtifacts`. "Already produced" = the path appears
 * in tool evidence (a successful fs_write/shell redirect). When the loop
 * crosses the midpoint with at least one requested artifact still
 * unwritten, we emit a Force-Artifact nudge targeting the *first* missing
 * path — the smallest verifiable deliverable that closes the gate.
 */

import { requestedArtifacts, unwrittenArtifacts, writeCapturedError } from "../context/reviewJudge.ts";

export type ForceArtifactDecision =
  | { force: false }
  | { force: true; path: string; reason: string };

/**
 * Decide whether to force artifact creation at this point in the loop.
 *
 * @param step      zero-based step index just completed
 * @param maxSteps  configured tool-step budget (`DEFAULT_AGENT_LOOP.maxSteps`)
 * @param goal      the run goal (user message)
 * @param evidence  accumulated tool evidence (console transcript text)
 */
export function decideForceArtifact(input: {
  step: number;
  maxSteps: number;
  goal: string;
  evidence: string;
}): ForceArtifactDecision {
  const { step, maxSteps, goal, evidence } = input;
  if (maxSteps < 4) return { force: false }; // loop too short for a midpoint
  const midpoint = Math.floor(maxSteps / 2);
  if (step < midpoint) return { force: false };

  const requested = requestedArtifacts(goal);
  if (!requested.length) return { force: false }; // no target artifact to force

  const missing = unwrittenArtifacts(goal, evidence);
  if (!missing.length) return { force: false }; // already produced

  const target = missing[0]!;
  const alreadyFailed = writeCapturedError(evidence, target);
  return {
    force: true,
    path: target,
    reason: alreadyFailed
      ? `previous write of ${target} captured an error — overwrite with successful minimal output`
      : `mid-budget (${step + 1}/${maxSteps}) and ${target} still unwritten — produce minimal verifiable artifact now`,
  };
}

/**
 * Format the Force-Artifact nudge injected as a steer message into the convo.
 * Tone: imperative, concrete, no fluff. The agent must write the file body
 * from what it already gathered — no new tool calls unless strictly needed.
 */
export function forceArtifactNudge(decision: { force: true; path: string; reason: string }): string {
  return [
    `[force-artifact] ${decision.reason}`,
    `Write the complete contents of \`${decision.path}\` now using fs_write.`,
    `Use only facts already gathered in this run. No new exploration, no plan prose.`,
    `If a full solution is not ready, write a minimal version that compiles/parses and covers the core case — it must be a real artifact on disk, not a stub.`,
  ].join(" ");
}

/**
 * Post-review forced write: after the reviewer pins `Not yet written: PATH` or
 * `failureKind: "missing-artifact"`, the persist loop must force a write —
 * not another analysis round. This closes the non-delivery gap the roadmap
 * names as the main weakness on Harbor: the agent can spend the whole
 * persist budget re-reading and re-planning while the deliverable stays
 * unwritten.
 *
 * Unlike `decideForceArtifact` (mid-budget, turn-loop), this fires on every
 * persist iteration where the review verdict is fail with a missing local
 * artifact. It targets the first unwritten path — from `review.missing` if
 * the reviewer named one, else from `unwrittenArtifacts(goal, evidence)`.
 */
export function decideForceArtifactPostReview(input: {
  goal: string;
  evidence: string;
  /** Review verdict — only fires on non-pass with missing-artifact signal. */
  reviewVerdict: string;
  reviewFailureKind?: string;
  reviewMissing?: string;
}): ForceArtifactDecision {
  // Only fire when the reviewer failed and flagged a missing artifact.
  if (input.reviewVerdict === "pass") return { force: false };
  const missing = input.reviewMissing ?? "";
  const hasPathWithExt = /\b\w+\.\w+\b/i.test(missing) || /`\w+\.\w+`/.test(missing);
  const isMissingArtifact = input.reviewFailureKind === "missing-artifact"
    || /not yet written/i.test(missing)
    || (/\bmissing\b/i.test(missing) && hasPathWithExt);
  if (!isMissingArtifact) return { force: false };

  // Target: first unwritten path. Prefer paths named in review.missing,
  // fall back to requestedArtifacts(goal) not yet in evidence.
  const fromReview = extractPathsFromMissing(input.reviewMissing ?? "");
  const fromGoal = unwrittenArtifacts(input.goal, input.evidence);
  const target = fromReview.find((p) => !evidenceWrote(input.evidence, p))
    ?? fromGoal[0];
  if (!target) return { force: false };

  const alreadyFailed = writeCapturedError(input.evidence, target);
  return {
    force: true,
    path: target,
    reason: alreadyFailed
      ? `review pinned ${target} as missing and a prior write captured an error — overwrite with successful minimal output now`
      : `review pinned ${target} as not yet written — write it now, do not re-analyze`,
  };
}

/** Extract backtick-quoted or bare file paths from a review.missing string. */
function extractPathsFromMissing(missing: string): string[] {
  const found: string[] = [];
  // Backtick-quoted paths: `out/report.md`
  for (const m of missing.matchAll(/`([^`]+\.[A-Za-z][A-Za-z0-9.]*)`/g)) {
    found.push(m[1] ?? "");
  }
  // Bare paths with extension: out/report.md
  for (const m of missing.matchAll(/\b([\w./-]+\.[A-Za-z][A-Za-z0-9.]*)\b/g)) {
    const p = m[1] ?? "";
    if (!found.includes(p)) found.push(p);
  }
  return found.filter((p) => p && !/^https?:/i.test(p));
}

/** True if evidence shows a successful write of path (mirrors reviewJudge.evidenceWrote lightly). */
function evidenceWrote(evidence: string, path: string): boolean {
  // fs_write block for path with non-error body, or shell redirect success.
  const lines = evidence.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i] ?? "";
    if (/^fs_write\b/.test(line) && line.includes(path)) {
      const body = (lines[i + 1] ?? "").trim();
      if (body && !/^error:/i.test(body)) return true;
    }
  }
  // ls/stat EXISTS check
  const base = path.split("/").filter(Boolean).at(-1) ?? path;
  return new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\d+\\s+bytes\\b`, "i").test(evidence)
    || new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\bEXISTS`, "i").test(evidence);
}

// (No re-export: artifactEvidence is a local helper in DriveSolve; the loop
// already has it in scope and passes evidence into decideForceArtifact.)
