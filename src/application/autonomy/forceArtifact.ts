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

// (No re-export: artifactEvidence is a local helper in DriveSolve; the loop
// already has it in scope and passes evidence into decideForceArtifact.)
