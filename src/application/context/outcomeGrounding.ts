/**
 * Soft vs DevOps outcome grounding.
 * Soft: OraclePort owns truth inside the persist loop.
 * DevOps: structural Review + byte evidence; oracle only if matrix declared.
 */

import type { ExpectationMatrix, OracleVerdict } from "../../domain/oracle/Oracle.ts";
import { formatOracleEvidence } from "../../domain/oracle/Oracle.ts";
import type { Review } from "../../domain/run/Review.ts";
import type { OraclePort } from "../ports.ts";
import { resolveExpectations, softArtifactFromTranscript } from "./expectationMatrix.ts";

export type SoftGrounding = {
  expectations: ExpectationMatrix | null;
  verdict: OracleVerdict | null;
  evidenceLine: string | null;
  /** Review forced to fail so persistUntilDone can reopen repair. */
  review: Review;
};

export function groundWithOracle(input: {
  oracle: OraclePort;
  goal: string;
  failClass?: string;
  explicit?: ExpectationMatrix | null;
  transcript: Array<{ kind: string; text: string }>;
  fallbackArtifact?: string;
  review: Review;
}): SoftGrounding {
  const expectations = resolveExpectations({
    goal: input.goal,
    failClass: input.failClass,
    explicit: input.explicit,
  });
  if (!expectations) {
    return {
      expectations: null,
      verdict: null,
      evidenceLine: null,
      review: input.review,
    };
  }
  const artifact =
    softArtifactFromTranscript(input.transcript)
    || (input.fallbackArtifact ?? "").trim();
  const verdict = input.oracle.verify(artifact, expectations);
  const evidenceLine = formatOracleEvidence(verdict);
  return {
    expectations,
    verdict,
    evidenceLine,
    review: applyOracleToReview(input.review, verdict),
  };
}

/** Soft fail forces Review fail so the same-turn persist loop continues. */
export function applyOracleToReview(review: Review, verdict: OracleVerdict): Review {
  if (verdict.ok) return review;
  return {
    ...review,
    verdict: "fail",
    summary: review.summary?.trim()
      ? `${review.summary} · oracle rejected soft artifact`
      : "oracle rejected soft artifact",
    missing: clip(verdict.evidence, 240) || review.missing || "soft matrix not satisfied",
    failureKind: review.failureKind ?? "general",
    needsResearch: false,
  };
}

/**
 * Soft goals (matrix present): oracle owns outcomeOk.
 * DevOps: Review pass ∧ ¬corrected ∧ (no oracle ∨ oracle.ok).
 */
export function resolveOutcomeOk(input: {
  soft: boolean;
  reviewPass: boolean;
  corrected: boolean;
  oracle: OracleVerdict | null;
}): boolean {
  if (input.corrected) return false;
  if (input.soft) return Boolean(input.oracle?.ok);
  return input.reviewPass && (!input.oracle || input.oracle.ok);
}

/** PE reviewFail: soft path should not double-count oracle into reviewFail. */
export function resolveReviewFailForPe(input: {
  soft: boolean;
  reviewPass: boolean;
  corrected: boolean;
  oracleOk: boolean | null;
}): boolean {
  if (input.corrected) return true;
  if (input.soft) return false; // oracle handled via softPredictionFromOracle
  return !input.reviewPass;
}

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
