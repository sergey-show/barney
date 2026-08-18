export type ReviewVerdict = "pass" | "fail" | "uncertain" | "unknown_api" | "gap";

export type Review = {
  verdict: ReviewVerdict;
  summary: string;
  needsResearch: boolean;
  knowledgeQuery?: string;
  achieved?: boolean;
  requested?: string;
  missing?: string;
};

export function reviewNeedsResearch(review: Review): boolean {
  return review.needsResearch || review.verdict === "uncertain" || review.verdict === "unknown_api" || review.verdict === "gap";
}
