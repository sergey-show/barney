/**
 * Prediction error — the teacher signal for cortical writes (fayr §3–4.5).
 * Prefer pinning skills/rules when expectation ≠ fact, then recovery/outcome.
 *
 * Soft domains: when an OracleVerdict is present, plan≠fact is grounded there
 * (not LLM self-praise). Byte/harness signals remain for DevOps paths.
 */

import type { OracleVerdict } from "../../domain/oracle/Oracle.ts";

export type PredictionErrorSignal = {
  /** 1 when the turn violated expectation (fail, new mode, structural miss). */
  error: 0 | 1;
  reason: string;
};

/** Soft PE: Ego planned success vs deterministic oracle fact. */
export function softPredictionFromOracle(
  plannedSuccess: boolean,
  verdict: OracleVerdict,
): PredictionErrorSignal {
  if (verdict.markers.laziness) {
    return { error: 1, reason: "laziness — artifact too thin vs expectation matrix" };
  }
  if (verdict.markers.structuralMiss) {
    return { error: 1, reason: "structural miss — oracle matrix violated" };
  }
  if (plannedSuccess && !verdict.ok) {
    return { error: 1, reason: "plan≠fact — oracle rejected artifact" };
  }
  if (verdict.markers.zpdFail && !verdict.markers.zpdPass) {
    return { error: 1, reason: "zpd fail arm only — mutation not proven" };
  }
  return { error: 0, reason: "oracle aligned with plan" };
}

export function computePredictionError(input: {
  reviewFail: boolean;
  hadFailedFamily: boolean;
  structuralFail?: boolean;
  operatorCorrected?: boolean;
  /** Soft-domain grounding; when set, plan≠fact is read from the oracle first. */
  oracle?: OracleVerdict | null;
  /** Ego expected the artifact to satisfy the matrix (default true after claim-done). */
  plannedSuccess?: boolean;
}): PredictionErrorSignal {
  if (input.oracle) {
    const soft = softPredictionFromOracle(input.plannedSuccess ?? true, input.oracle);
    if (soft.error === 1) return soft;
  }
  if (input.operatorCorrected) {
    return { error: 1, reason: "operator correction — expectation overturned" };
  }
  if (input.structuralFail) {
    return { error: 1, reason: "structural miss — deliverable expectation failed" };
  }
  if (input.reviewFail) {
    return { error: 1, reason: "review reject — outcome ≠ prediction" };
  }
  if (input.hadFailedFamily) {
    return { error: 1, reason: "tool-family fail before recovery" };
  }
  return { error: 0, reason: "no prediction error this turn" };
}

export function formatPredictionErrorLine(signal: PredictionErrorSignal): string {
  return `prediction_error: ${signal.error} · ${signal.reason}`;
}
