/**
 * Two-layer verify (GUARD / coding-agent native):
 * Layer 1 — deterministic structural checks (files, secrets, conflicts, URLs).
 * Layer 2 — semantic review text from the model.
 * Semantic pass cannot override a failed deterministic layer.
 */

import {
  conflictedDeliverable,
  leftoverSecretMasks,
  maskedArtifactWrite,
  missingArtifactWrites,
  missingGoalUrlOpen,
} from "../context/reviewJudge.ts";
import { askedToReplaceSecrets } from "../context/secretSanitize.ts";
import type { Review } from "../../domain/run/Review.ts";

// leftoverSecretMasks is re-exported from reviewJudge for structural guards.

export type DeterministicFail = {
  code: string;
  detail: string;
};

export type TwoLayerResult = {
  detOk: boolean;
  semOk: boolean;
  fails: DeterministicFail[];
  review: Review;
  line: string;
};

/** Run deterministic checks only. */
export function runDeterministicLayer(input: {
  latest: string;
  evidence: string;
  reply?: string;
}): DeterministicFail[] {
  const fails: DeterministicFail[] = [];
  const fileMiss = missingArtifactWrites(input.latest, input.evidence);
  if (fileMiss) fails.push({ code: "missing_artifact", detail: fileMiss });
  const maskMiss = maskedArtifactWrite(input.latest, input.evidence);
  if (maskMiss) fails.push({ code: "masked_deliverable", detail: maskMiss });
  if (askedToReplaceSecrets(input.latest)) {
    const leftover = leftoverSecretMasks(input.latest, input.evidence);
    if (leftover) fails.push({ code: "secret_leftover", detail: leftover });
  }
  const conflict = conflictedDeliverable(input.evidence);
  if (conflict) fails.push({ code: "conflict_markers", detail: conflict });
  const urlMiss = missingGoalUrlOpen(input.latest, input.evidence);
  if (urlMiss) fails.push({ code: "url_not_opened", detail: urlMiss });
  return fails;
}

/**
 * Merge layers: start from semantic review; deterministic failures force fail.
 */
export function applyTwoLayerVerify(input: {
  semantic: Review;
  latest: string;
  evidence: string;
  reply?: string;
}): TwoLayerResult {
  const fails = runDeterministicLayer({
    latest: input.latest,
    evidence: input.evidence,
    reply: input.reply,
  });
  const detOk = fails.length === 0;
  const semOk = input.semantic.verdict === "pass";
  let review = input.semantic;
  if (!detOk) {
    const detail = fails.map((f) => f.detail).join("; ");
    review = {
      ...review,
      verdict: "fail",
      achieved: false,
      missing: review.missing || detail,
      summary: `${review.summary ? `${review.summary} ` : ""}det: ${detail}`,
      failureKind: review.failureKind
        ?? (fails.some((f) => f.code === "missing_artifact")
          ? "missing-artifact"
          : fails.some((f) => f.code === "masked_deliverable" || f.code === "secret_leftover")
          ? "masked-deliverable"
          : "general"),
    };
  }
  const line =
    `verify_layer: det=${detOk ? 1 : 0} sem=${semOk ? 1 : 0}`
    + (fails.length ? ` · det_fail=${fails.map((f) => f.code).join(",")}` : "")
    + (detOk && semOk ? " · pass" : " · hold");
  return { detOk, semOk, fails, review, line };
}
