import type { ReuseKind } from "./transferLedger.ts";

/** Markers persisted on Episode for transfer / hold-out / salience analytics. */
export function buildEpisodeMarkers(input: {
  source?: string;
  status?: string;
  goalHash: string;
  reuse: ReuseKind;
  rulesRecalled?: string[];
  skillsRecalled?: string[];
  skillsReused?: string[];
  skillsPromoted?: string[];
  failureMode?: string | null;
  progressScore?: number;
  experience?: boolean;
  /** Prediction error 0|1 from this turn. */
  predictionError?: 0 | 1;
  /** Frustration score at end of turn. */
  frustration?: number;
  /** Stated P(success) before outcome (calibration). */
  confPredicted?: number;
  /** Brier (p−o)² for this turn. */
  calibBrier?: number;
  overconfident?: boolean;
}): string[] {
  const markers: string[] = [];
  if (input.source) markers.push(`source:${input.source}`);
  if (input.status) markers.push(`status:${input.status}`);
  markers.push(`goalHash:${input.goalHash}`);
  markers.push(`reuse:${input.reuse}`);
  if (input.failureMode) markers.push(`failureMode:${input.failureMode}`);
  if (input.progressScore != null) markers.push(`progress:${Math.round(input.progressScore)}`);
  if (input.predictionError != null) markers.push(`pe:${input.predictionError}`);
  if (input.frustration != null && input.frustration > 0) {
    markers.push(`frustration:${Math.round(input.frustration)}`);
  }
  if (input.confPredicted != null) {
    markers.push(`confPred:${input.confPredicted.toFixed(2)}`);
  }
  if (input.calibBrier != null) {
    markers.push(`calib:${input.calibBrier.toFixed(2)}`);
  }
  if (input.overconfident) markers.push("overconfident:1");
  const salience = episodeSalience({
    predictionError: input.predictionError,
    frustration: input.frustration,
    progressScore: input.progressScore,
    experience: input.experience,
  });
  if (salience > 0.35) markers.push(`salience:${salience.toFixed(2)}`);
  for (const key of (input.rulesRecalled ?? []).slice(0, 6)) {
    markers.push(`recalled:${key}`);
  }
  for (const name of (input.skillsRecalled ?? []).slice(0, 6)) {
    markers.push(`skillRecalled:${name}`);
  }
  for (const name of (input.skillsReused ?? []).slice(0, 6)) {
    markers.push(`skillReuse:${name}`);
  }
  for (const name of (input.skillsPromoted ?? []).slice(0, 6)) {
    markers.push(`skillPromoted:${name}`);
  }
  if (input.experience) markers.push("experience:fail");
  return markers;
}

/** 0..1 salience for recall weighting (PE + frustration + fail experience). */
export function episodeSalience(input: {
  predictionError?: 0 | 1;
  frustration?: number;
  progressScore?: number;
  experience?: boolean;
}): number {
  let s = 0.25;
  if (input.predictionError === 1) s += 0.35;
  if ((input.frustration ?? 0) >= 4) s += 0.25;
  else if ((input.frustration ?? 0) >= 2) s += 0.15;
  if (input.experience) s += 0.15;
  if (input.progressScore != null && input.progressScore < 30) s += 0.1;
  return Math.max(0, Math.min(1, s));
}

export function salienceFromMarkers(markers: string[]): number {
  const raw = markers.find((m) => m.startsWith("salience:"))?.slice("salience:".length);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  const pe = markers.some((m) => m === "pe:1");
  const fr = Number(markers.find((m) => m.startsWith("frustration:"))?.split(":")[1] ?? 0);
  return episodeSalience({
    predictionError: pe ? 1 : 0,
    frustration: fr,
    experience: markers.includes("experience:fail"),
  });
}

export function ruleSourceClass(key: string, tags: string[] = []): string {
  const fromKey = key.match(/^rule\/([^/]+)\//)?.[1];
  if (fromKey && fromKey !== "mode") return fromKey;
  const mode = key.match(/^rule\/mode\/([^/]+)\//)?.[1];
  if (mode) return `mode:${mode}`;
  const tag = tags.find((t) => t && t !== "rule" && t !== "lesson" && t !== "fail" && t !== "experience" && !t.startsWith("conf:"));
  return tag || "general";
}
