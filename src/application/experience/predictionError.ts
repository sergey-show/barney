/**
 * Prediction error — the teacher signal for cortical writes (fayr §3–4.5).
 * Prefer pinning skills/rules when expectation ≠ fact, then recovery/outcome.
 */

export type PredictionErrorSignal = {
  /** 1 when the turn violated expectation (fail, new mode, structural miss). */
  error: 0 | 1;
  reason: string;
};

export function computePredictionError(input: {
  reviewFail: boolean;
  hadFailedFamily: boolean;
  structuralFail?: boolean;
  operatorCorrected?: boolean;
}): PredictionErrorSignal {
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
