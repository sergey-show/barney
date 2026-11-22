/**
 * External admission for durable body writes.
 *
 * Policy gate (decideExperienceWrite) chooses *kind*.
 * Admission decides whether the writer may pin into the body.
 *
 * Gated mode: evidence must come from outside the author's cheerleading
 * (artifact verify, prediction error, structural fail, house convention, or
 * delayed skill exam path). Self-report alone is rejected.
 *
 * Self-report mode: matched-budget ablation — pin on the author's claim.
 */

import type { ExperienceWriteKind } from "./experienceLayers.ts";

export type BodyWriteMode = "gated" | "selfreport";

export const BODY_WRITE_MODE_ENV = "BARNEY_BODY_WRITE_MODE";

export type AdmissionEvidenceKind =
  | "artifact_verified"
  | "prediction_error"
  | "structural_fail"
  | "house_convention"
  | "skill_exam_path"
  | "self_report";

export type BodyAdmissionDecision = {
  admit: boolean;
  reason: string;
  evidence: AdmissionEvidenceKind | null;
  mode: BodyWriteMode;
};

export function parseBodyWriteMode(raw: string | undefined | null): BodyWriteMode {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "selfreport" || value === "self-report" || value === "self_report") {
    return "selfreport";
  }
  return "gated";
}

/**
 * Admit a durable pin after decideExperienceWrite chose a non-episode kind.
 * episode_only is never admitted here (caller should skip).
 */
export function admitBodyWrite(input: {
  writeKind: ExperienceWriteKind;
  mode?: BodyWriteMode;
  outcomeOk: boolean;
  predictionError?: 0 | 1;
  structuralFail?: boolean;
  pinConvention?: boolean;
  /** External verifier of deliverable / train fixture (not the LLM). */
  artifactVerified?: boolean;
  hasConcreteDirective?: boolean;
}): BodyAdmissionDecision {
  const mode = input.mode ?? "gated";
  if (input.writeKind === "episode_only") {
    return {
      admit: false,
      reason: "episode_only — nothing to admit",
      evidence: null,
      mode,
    };
  }

  if (mode === "selfreport") {
    if (input.writeKind === "skill_candidate") {
      return {
        admit: true,
        reason: "selfreport · skill candidate (quarantine still applies)",
        evidence: "self_report",
        mode,
      };
    }
    if (input.hasConcreteDirective || input.pinConvention || input.writeKind === "lesson_pin") {
      return {
        admit: true,
        reason: "selfreport · author claim accepted",
        evidence: "self_report",
        mode,
      };
    }
    return {
      admit: true,
      reason: "selfreport · pin without external check",
      evidence: "self_report",
      mode,
    };
  }

  // --- gated ---
  if (input.writeKind === "skill_candidate") {
    // Durable promotion still requires later recall+use exam; mint is provisional.
    return {
      admit: true,
      reason: "gated · quarantine skill; exam later",
      evidence: "skill_exam_path",
      mode,
    };
  }

  if (input.writeKind === "lesson_pin") {
    if (input.artifactVerified === true) {
      return {
        admit: true,
        reason: "gated · house lesson with verified artifact",
        evidence: "artifact_verified",
        mode,
      };
    }
    if (input.pinConvention && input.outcomeOk) {
      return {
        admit: true,
        reason: "gated · house convention on successful path",
        evidence: "house_convention",
        mode,
      };
    }
    return {
      admit: false,
      reason: "gated · lesson_pin without convention or verified artifact",
      evidence: null,
      mode,
    };
  }

  // failure_rule
  if (input.artifactVerified === true && input.outcomeOk === false) {
    // Fail path rarely has artifactVerified=true; if caller passes false-ok verify, ignore.
  }
  if (input.structuralFail) {
    if (input.hasConcreteDirective === false) {
      return {
        admit: false,
        reason: "gated · structural fail without concrete directive",
        evidence: "structural_fail",
        mode,
      };
    }
    return {
      admit: true,
      reason: "gated · structural fail with directive",
      evidence: "structural_fail",
      mode,
    };
  }
  if (input.predictionError === 1 && input.hasConcreteDirective !== false) {
    return {
      admit: true,
      reason: "gated · prediction error with directive",
      evidence: "prediction_error",
      mode,
    };
  }
  if (input.hasConcreteDirective && !input.structuralFail && input.predictionError !== 1) {
    return {
      admit: false,
      reason: "gated · reject self-report directive without PE/structural evidence",
      evidence: null,
      mode,
    };
  }
  return {
    admit: false,
    reason: "gated · insufficient external evidence",
    evidence: null,
    mode,
  };
}

/**
 * Self-report ablation: pin on any fail with a usable class, or any success
 * with a directive/convention — ignores PE/repeat thresholds.
 */
export function decideSelfReportWrite(input: {
  outcomeOk: boolean;
  failClass: string;
  hasConcreteDirective?: boolean;
  pinConvention?: boolean;
  recovered?: boolean;
}): { kind: ExperienceWriteKind; reason: string } {
  const usable = Boolean(
    input.failClass && input.failClass !== "general" && input.failClass !== "aborted-unfinished",
  );
  if (input.outcomeOk && input.recovered && usable) {
    return { kind: "skill_candidate", reason: "selfreport · recovery claimed" };
  }
  if (input.outcomeOk && (input.pinConvention || input.hasConcreteDirective)) {
    return { kind: "lesson_pin", reason: "selfreport · success claim" };
  }
  if (!input.outcomeOk && usable && input.hasConcreteDirective !== false) {
    return { kind: "failure_rule", reason: "selfreport · fail claim" };
  }
  return { kind: "episode_only", reason: "selfreport · nothing to claim" };
}
