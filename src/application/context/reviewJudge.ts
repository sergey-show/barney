import type { Review } from "../../domain/run/Review.ts";
import { replyOmitsPageCode } from "../research/verifyReply.ts";

export function parseReview(text: string): Review {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Review;
      if (parsed.achieved === false && parsed.verdict === "pass") parsed.verdict = "fail";
      if (parsed.verdict) {
        if (parsed.missing && parsed.verdict !== "pass") {
          parsed.summary = `${parsed.summary}${parsed.summary ? " " : ""}Missing: ${parsed.missing}`;
        }
        return parsed;
      }
    } catch {
      /* fallthrough */
    }
  }
  if (/unknown_api|needs?\s*docs|vendor api/i.test(text)) {
    return { verdict: "unknown_api", summary: text.slice(0, 400), needsResearch: true, knowledgeQuery: text.slice(0, 120) };
  }
  return { verdict: "fail", summary: text.slice(0, 400), needsResearch: true, knowledgeQuery: text.slice(0, 120) };
}

export function judgeReview(text: string, latest: string, evidence = "", reply = ""): Review {
  const review = parseReview(text);
  if (review.verdict !== "pass") return review;
  const miss = reply && evidence ? replyOmitsPageCode(reply, evidence, latest) : undefined;
  if (!miss) return review;
  return {
    ...review,
    verdict: "fail",
    achieved: false,
    missing: review.missing || miss,
    summary: `${review.summary ? `${review.summary} ` : ""}${miss}`,
  };
}
