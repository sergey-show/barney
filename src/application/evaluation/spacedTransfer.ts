/**
 * Spaced four-hand: retention of transfer lift over delays.
 * Default schedule: immediate / +1d / +7d.
 *
 * Immediate is measured in the four-hand run (and train home can be persisted).
 * Later probes re-run kernel-test + kernel-fresh against the same trained home.
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

/** Pointer to a trained body that can be re-probed later. */
export type SpacedAnchor = {
  caseId: string;
  /** Absolute path to the train agent home (body). */
  trainHome: string;
  trainedAt: string;
  immediateLift: number;
  /** Due probes still outstanding (hours after trainedAt). */
  dueDelayHours: number[];
};

export function planSpacedProbes(
  delaysHours: readonly number[] = SPACED_DELAYS_HOURS,
): SpacedProbePlan[] {
  return delaysHours.map((delayHours) => ({
    delayHours,
    label: delayHours === 0
      ? "immediate"
      : delayHours < 48
      ? `+${delayHours}h`
      : `+${Math.round(delayHours / 24)}d`,
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
  const immediate = mine.find((probe) => probe.delayHours === 0)?.transferSuccessLift
    ?? mine[0]!.transferSuccessLift;
  const retainedLift = mine.at(-1)!.transferSuccessLift;
  const forgetting = immediate - retainedLift;
  let verdict: SpacedRetentionReport["verdict"] = "inconclusive";
  if (mine.length >= 2) {
    verdict = retainedLift > 0 ? "retains" : forgetting > 0 ? "fades" : "inconclusive";
  }
  return { caseId, probes: mine, meanLift, retainedLift, forgetting, verdict };
}

/** Build anchors after an immediate four-hand run. */
export function buildSpacedAnchors(input: {
  cases: Array<{ caseId: string; trainHome: string; transferSuccessLift: number }>;
  trainedAt?: string;
  delaysHours?: readonly number[];
}): SpacedAnchor[] {
  const at = input.trainedAt ?? new Date().toISOString();
  const delays = (input.delaysHours ?? SPACED_DELAYS_HOURS).filter((h) => h > 0);
  return input.cases.map((row) => ({
    caseId: row.caseId,
    trainHome: row.trainHome,
    trainedAt: at,
    immediateLift: row.transferSuccessLift,
    dueDelayHours: [...delays],
  }));
}

/**
 * Which delays are due now for an anchor (wall-clock vs trainedAt).
 * `forceDelayHours` bypasses the clock (for scheduled CI / manual probe).
 */
export function dueSpacedDelays(
  anchor: SpacedAnchor,
  now: Date = new Date(),
  forceDelayHours?: number,
): number[] {
  if (forceDelayHours != null) {
    return anchor.dueDelayHours.includes(forceDelayHours) ? [forceDelayHours] : [forceDelayHours];
  }
  const trainedMs = Date.parse(anchor.trainedAt);
  if (!Number.isFinite(trainedMs)) return [];
  const elapsedHours = (now.getTime() - trainedMs) / 3_600_000;
  return anchor.dueDelayHours.filter((delay) => elapsedHours + 1e-6 >= delay);
}

export function markDelayDone(anchor: SpacedAnchor, delayHours: number): SpacedAnchor {
  return {
    ...anchor,
    dueDelayHours: anchor.dueDelayHours.filter((d) => d !== delayHours),
  };
}
