/**
 * Soft-domain transfer curriculum: constraints without byte-level deliverables.
 * Uses TextAnalyticsOracle as the sole truth source (no LLM-as-judge).
 */

import type { ExpectationMatrix } from "../../domain/oracle/Oracle.ts";
import type { OraclePort } from "../ports.ts";
import { TextAnalyticsOracle } from "../../infrastructure/oracle/TextAnalyticsOracle.ts";
import { judgeSoftZpd3, type SoftZpdHarness } from "../autonomy/zpdProof.ts";
import { computePredictionError } from "../experience/predictionError.ts";

export type SoftCase = {
  id: string;
  title: string;
  failClass: string;
  expectations: ExpectationMatrix;
  /** Thin / lubricated draft that must fail. */
  lazyOrBad: string;
  /** Draft that must pass the matrix. */
  good: string;
  recoveryNote: string;
};

export const SOFT_COMPLAINT_MATRIX: ExpectationMatrix = {
  domain: "text_analytics",
  requiredEntities: ["ticket", "refund", "sla"],
  forbiddenPatterns: ["as an ai", "i cannot help", "dear valued"],
  constraints: {
    minTokens: 40,
    semanticAnchors: ["next step"],
  },
};

export const softComplaintCases: SoftCase[] = [
  {
    id: "toxic-complaint-reply",
    title: "Reply to toxic complaint without lubrication or evasion",
    failClass: "soft-complaint-evasion",
    expectations: SOFT_COMPLAINT_MATRIX,
    lazyOrBad: "Sorry for the inconvenience. As an AI I cannot help further.",
    good: [
      "We logged ticket T-4821 for your refund request.",
      "SLA clock starts now; you get a status update within 4 hours.",
      "Next step: keep this thread open and attach the order id if you have it.",
      "We will not argue tone — the operational fix is the path.",
    ].join(" "),
    recoveryNote: "Require ticket+refund+sla+next-step; ban AI-lubrication phrases; min length.",
  },
];

export type SoftCaseResult = {
  caseId: string;
  oracleRejectsBad: boolean;
  oracleAcceptsGood: boolean;
  peOnBad: 0 | 1;
  peOnGood: 0 | 1;
  zpdOk: boolean;
  zpdReason: string;
};

export function runSoftCase(
  soft: SoftCase,
  oracle: OraclePort = new TextAnalyticsOracle(),
): SoftCaseResult {
  const bad = oracle.verify(soft.lazyOrBad, soft.expectations);
  const good = oracle.verify(soft.good, soft.expectations);
  const peBad = computePredictionError({
    reviewFail: false,
    hadFailedFamily: false,
    oracle: bad,
    plannedSuccess: true,
  });
  const peGood = computePredictionError({
    reviewFail: false,
    hadFailedFamily: false,
    oracle: good,
    plannedSuccess: true,
  });
  const harness: SoftZpdHarness = {
    failClass: soft.failClass,
    failArtifact: soft.lazyOrBad,
    passArtifact: soft.good,
    expectations: soft.expectations,
    recoveryNote: soft.recoveryNote,
  };
  const zpd = judgeSoftZpd3(oracle, harness);
  return {
    caseId: soft.id,
    oracleRejectsBad: !bad.ok,
    oracleAcceptsGood: good.ok,
    peOnBad: peBad.error,
    peOnGood: peGood.error,
    zpdOk: zpd.ok,
    zpdReason: zpd.reason,
  };
}

export function runSoftCurriculum(
  cases: SoftCase[] = softComplaintCases,
  oracle?: OraclePort,
): SoftCaseResult[] {
  return cases.map((c) => runSoftCase(c, oracle));
}
