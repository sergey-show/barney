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
  const fileMiss = missingArtifactWrites(latest, evidence);
  const miss = reply && evidence ? replyOmitsPageCode(reply, evidence, latest) : undefined;
  if (!fileMiss && !miss) return review;
  const why = fileMiss || miss || "";
  return {
    ...review,
    verdict: "fail",
    achieved: false,
    missing: review.missing || why,
    summary: `${review.summary ? `${review.summary} ` : ""}${why}`,
  };
}

export function requestedArtifacts(message: string): string[] {
  const found: string[] = [];
  for (const match of message.matchAll(/`(\/?[\w./-]+\.[A-Za-z0-9]+)`/g)) {
    const path = (match[1] ?? "").replaceAll("\\", "/");
    if (path && !isRuntimeSink(path)) found.push(path);
  }
  return [...new Set(found)];
}

export function missingArtifactWrites(latest: string, evidence: string): string | undefined {
  const missing = requestedArtifacts(latest).filter((path) => !evidenceWrote(evidence, path));
  if (!missing.length) return;
  return `no write of ${missing.join(", ")}`;
}

function isRuntimeSink(path: string): boolean {
  const n = path.replaceAll("\\", "/");
  return /\.(log|pid)$/i.test(n) || /(^|\/)var\/log\//i.test(n);
}

function evidenceWrote(evidence: string, requested: string): boolean {
  return writeAliases(requested).some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:wrote |edited |(?:-out|-o|>|>>)\\s*|path"\\s*:\\s*"|sed\\s+-i\\b[^\\n]*\\s|tee\\s+)${escaped}(?:\\s|"|\\(|$|<<)`,
      "i",
    ).test(evidence);
  });
}

function writeAliases(requested: string): string[] {
  const n = requested.replaceAll("\\", "/").replace(/\/+$/, "");
  const aliases = [n];
  if (n.startsWith("/")) {
    const parts = n.split("/").filter(Boolean);
    if (parts.length >= 2) aliases.push(parts.slice(1).join("/"));
  }
  return [...new Set(aliases)];
}
