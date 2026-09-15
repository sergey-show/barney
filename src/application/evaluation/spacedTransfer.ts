/**
 * Spaced four-hand: retention of transfer lift over delays (fayr §6.6).
 * Default schedule: immediate / +1d / +7d. Runner may execute delay=0 only;
 * longer delays are planned and scored when observations arrive.
 */

export const SPACED_DELAYS_HOURS = [0, 24, 168] as const;

export type SpacedProbePlan = {
  delayHours: number;
  label: string;
};

export type SpacedLiftObservation = {
  caseId: string;
  delayHours: number;
  transferSuccessLift: number;
};

export type SpacedRetentionReport = {
  caseId: string;
  probes: SpacedLiftObservation[];
  /** Mean lift across delays that were measured. */
  meanLift: number;
  /** Lift at longest measured delay (retention). */
  retainedLift: number;
  /** immediate lift − retained lift (forgetting). */
  forgetting: number;
  verdict: "retains" | "fades" | "inconclusive";
};

export function planSpacedProbes(
  delaysHours: readonly number[] = SPACED_DELAYS_HOURS,
): SpacedProbePlan[] {
  return delaysHours.map((delayHours) => ({
    delayHours,
    label: delayHours === 0 ? "immediate" : delayHours < 48 ? `+${delayHours}h` : `+${Math.round(delayHours / 24)}d`,
  }));
}

export function summarizeSpacedRetention(
  caseId: string,
  probes: SpacedLiftObservation[],
): SpacedRetentionReport {
  const mine = probes
    .filter((probe) => probe.caseId === caseId)
    .sort((a, b) => a.delayHours - b.delayHours);
  if (!mine.length) {
    return {
      caseId,
      probes: [],
      meanLift: 0,
      retainedLift: 0,
      forgetting: 0,
      verdict: "inconclusive",
    };
  }
  const meanLift = mine.reduce((sum, probe) => sum + probe.transferSuccessLift, 0) / mine.length;
  const immediate = mine.find((probe) => probe.delayHours === 0)?.transferSuccessLift ?? mine[0]!.transferSuccessLift;
  const retainedLift = mine.at(-1)!.transferSuccessLift;
  const forgetting = immediate - retainedLift;
  let verdict: SpacedRetentionReport["verdict"] = "inconclusive";
  if (mine.length >= 2) {
    verdict = retainedLift > 0 ? "retains" : forgetting > 0 ? "fades" : "inconclusive";
  }
  return { caseId, probes: mine, meanLift, retainedLift, forgetting, verdict };
}
