/**
 * Risk review pass — policy layer before accepting done / destructive settles.
 * Mechanical SPI verify stays separate; this catches risk signals in evidence.
 */

import type { Review, ReviewVerdict } from "../../domain/run/Review.ts";

export type RiskSignal = {
  code: string;
  detail: string;
  weight: number;
};

export type RiskReviewResult = {
  ok: boolean;
  reopen: boolean;
  verdict: ReviewVerdict;
  summary: string;
  signals: RiskSignal[];
  line: string;
};

const DESTRUCTIVE_RE = /\b(rm\s+-rf|git\s+push\s+--force|drop\s+table|mkfs|chmod\s+-R\s+777)\b/i;
const SECRET_LEAK_RE = /(api[_-]?key|sk-[a-z0-9]{16,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY)/i;
const UNVERIFIED_RE = /\b(unverified|not run|didn't run|todo: test|spi_verify: fail)\b/i;

export function collectRiskSignals(input: {
  review: Review;
  transcriptTexts?: string[];
  destructiveTools?: string[];
  spiOk?: boolean | null;
  worldRisks?: string[];
}): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const blob = [
    input.review.summary ?? "",
    ...(input.transcriptTexts ?? []).slice(-40),
    ...(input.destructiveTools ?? []),
    ...(input.worldRisks ?? []),
  ].join("\n");

  if (input.review.verdict === "fail") {
    signals.push({ code: "review_fail", detail: "review verdict fail", weight: 3 });
  }
  if (input.spiOk === false) {
    signals.push({ code: "spi_fail", detail: "spi verify failed", weight: 3 });
  }
  if (DESTRUCTIVE_RE.test(blob)) {
    signals.push({ code: "destructive", detail: "destructive command evidence", weight: 2 });
  }
  if (SECRET_LEAK_RE.test(blob)) {
    signals.push({ code: "secret", detail: "possible secret in evidence", weight: 3 });
  }
  if (UNVERIFIED_RE.test(blob) && input.review.verdict === "pass") {
    signals.push({ code: "unverified", detail: "pass claimed with unverified markers", weight: 2 });
  }
  for (const risk of input.worldRisks ?? []) {
    if (risk.trim()) signals.push({ code: "world_risk", detail: risk.slice(0, 120), weight: 1 });
  }
  return signals;
}

export function runRiskReviewPass(input: {
  review: Review;
  transcriptTexts?: string[];
  destructiveTools?: string[];
  spiOk?: boolean | null;
  worldRisks?: string[];
  /** When true, medium risk on pass reopens instead of soft-warning. */
  strict?: boolean;
}): RiskReviewResult {
  const signals = collectRiskSignals(input);
  const weight = signals.reduce((sum, row) => sum + row.weight, 0);
  const strict = input.strict ?? false;

  if (!signals.length) {
    return {
      ok: true,
      reopen: false,
      verdict: input.review.verdict,
      summary: input.review.summary,
      signals,
      line: "risk_review: ok",
    };
  }

  const hard = weight >= 3 || signals.some((row) => row.code === "secret" || row.code === "spi_fail");
  const reopen = hard || (strict && weight >= 2 && input.review.verdict === "pass");
  const verdict: ReviewVerdict = reopen
    ? (input.review.verdict === "pass" ? "fail" : input.review.verdict)
    : input.review.verdict;

  return {
    ok: !reopen,
    reopen,
    verdict,
    summary: reopen
      ? `risk review reopen: ${signals.map((s) => s.code).join(",")}`
      : input.review.summary,
    signals,
    line: `risk_review: ${reopen ? "reopen" : "warn"} weight=${weight} ${signals.map((s) => s.code).join(",")}`,
  };
}

export function destructiveToolNames(toolNames: string[]): string[] {
  return toolNames.filter((name) =>
    /^(shell|process_spawn|fs_write|fs_edit|patch|mcp_write|provider_write)$/i.test(name)
  );
}
