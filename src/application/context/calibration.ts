/**
 * Confidence calibration: stated P(success) vs binary outcome.
 * Law: overconfidence is a pathology — train against Brier, not prose certainty.
 */

export type CalibrationSample = {
  predicted: number;
  outcome: 0 | 1;
  /** (p − o)² — lower is better. */
  brier: number;
  absError: number;
  /** High pred + fail. */
  overconfident: boolean;
  /** Low pred + success. */
  underconfident: boolean;
};

const CONF_TAG = /^conf:([01](?:\.\d+)?)$/i;
const CONF_BODY = /\bconf(?:idence)?\s*[:=]?\s*([01](?:\.\d+)?)\b/i;

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Parse confidence from memory tags (`conf:0.70`) or lesson body. */
export function parseConfidenceFromNote(note: {
  tags?: string[];
  body?: string;
}): number | undefined {
  for (const tag of note.tags ?? []) {
    const m = tag.match(CONF_TAG);
    if (m) return clamp01(Number(m[1]));
  }
  const body = note.body ?? "";
  const fromParen = body.match(/\(v\d+,\s*conf\s+([01](?:\.\d+)?)\)/i);
  if (fromParen) return clamp01(Number(fromParen[1]));
  const loose = body.match(CONF_BODY);
  if (loose) return clamp01(Number(loose[1]));
  return undefined;
}

/** Mean of stated probabilities from recalled rules + skill strengths. */
export function predictFromRecalls(input: {
  ruleConfidences?: number[];
  skillStrengths?: number[];
  /** Fallback when nothing recalled (neutral prior). */
  fallback?: number;
}): number {
  const vals = [
    ...(input.ruleConfidences ?? []).map(clamp01),
    ...(input.skillStrengths ?? []).map(clamp01),
  ].filter((n) => Number.isFinite(n));
  if (!vals.length) return clamp01(input.fallback ?? 0.5);
  return clamp01(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function scoreCalibration(
  predicted: number,
  outcomeOk: boolean,
): CalibrationSample {
  const p = clamp01(predicted);
  const o: 0 | 1 = outcomeOk ? 1 : 0;
  const absError = Math.abs(p - o);
  const brier = (p - o) ** 2;
  return {
    predicted: p,
    outcome: o,
    brier,
    absError,
    overconfident: p >= 0.7 && o === 0,
    underconfident: p <= 0.3 && o === 1,
  };
}

export function formatCalibrationLine(sample: CalibrationSample): string {
  const flags = [
    sample.overconfident ? "over=1" : "over=0",
    sample.underconfident ? "under=1" : "under=0",
  ].join(" ");
  return `calibration: pred=${sample.predicted.toFixed(2)} out=${sample.outcome} brier=${sample.brier.toFixed(2)} ${flags}`;
}

/**
 * Online update of a predictive confidence toward the observed outcome.
 * lr=0.2 keeps steps small (rare-write friendly).
 */
export function updateConfidenceToward(
  prior: number,
  outcomeOk: boolean,
  lr = 0.2,
): number {
  const p = clamp01(prior);
  const o = outcomeOk ? 1 : 0;
  return clamp01(p + lr * (o - p));
}

/**
 * Rule-quality confidence after re-observation.
 * Used+fail → cut (false / overconfident rule). Reconfirm → small bump.
 */
export function updateRuleQuality(
  prior: number,
  input: { recallUsed: boolean; outcomeOk: boolean },
): number {
  const p = clamp01(prior > 0 ? prior : 0.4);
  if (input.recallUsed && !input.outcomeOk) {
    return clamp01(p - 0.2);
  }
  return clamp01(p + 0.15);
}
