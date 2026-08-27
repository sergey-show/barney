import type { Review, ReviewVerdict } from "../../domain/run/Review.ts";
import { replyOmitsPageCode } from "../research/verifyReply.ts";
import { asText } from "./packSession.ts";

export function parseReview(text: string): Review {
  const stripped = stripReviewFence(text);
  for (const candidate of reviewJsonCandidates(stripped)) {
    try {
      const parsed = JSON.parse(candidate) as Review;
      const review = normalizeReview(parsed);
      if (review) return review;
    } catch {
      /* next candidate */
    }
  }
  const recovered = recoverReviewVerdict(stripped);
  if (recovered) return recovered;
  if (/unknown_api|needs?\s*docs|vendor api/i.test(text)) {
    return { verdict: "unknown_api", summary: text.slice(0, 400), needsResearch: true, knowledgeQuery: text.slice(0, 120) };
  }
  return { verdict: "fail", summary: text.slice(0, 400), needsResearch: false };
}

function stripReviewFence(text: string): string {
  return text.replace(/```(?:json)?/gi, "").trim();
}

function reviewJsonCandidates(text: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const window = text.slice(i, i + 480);
    if (!/"verdict"\s*:/.test(window)) continue;
    const obj = balancedJsonObject(text.slice(i));
    if (obj) found.push(obj);
  }
  return found;
}

function balancedJsonObject(text: string): string | undefined {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(0, i + 1);
    }
  }
}

function recoverReviewVerdict(text: string): Review | undefined {
  const match = text.match(/"verdict"\s*:\s*"(pass|fail|uncertain|unknown_api|gap)"/);
  if (!match?.[1]) return;
  const achievedFalse = /"achieved"\s*:\s*false/.test(text);
  const verdict: ReviewVerdict = match[1] === "pass" && achievedFalse ? "fail" : match[1] as ReviewVerdict;
  return {
    verdict,
    achieved: verdict === "pass",
    summary: "reviewer JSON was wrapped or truncated; recovered verdict",
    needsResearch: /"needsResearch"\s*:\s*true/.test(text),
  };
}

function normalizeReview(parsed: Review): Review | undefined {
  if (parsed.achieved === false && parsed.verdict === "pass") parsed.verdict = "fail";
  if (!parsed.verdict) return;
  parsed.summary = asText(parsed.summary);
  parsed.missing = parsed.missing == null ? undefined : asText(parsed.missing) || undefined;
  parsed.requested = parsed.requested == null ? undefined : asText(parsed.requested) || undefined;
  parsed.knowledgeQuery = parsed.knowledgeQuery == null ? undefined : asText(parsed.knowledgeQuery) || undefined;
  if (parsed.missing && parsed.verdict !== "pass") {
    parsed.summary = `${parsed.summary}${parsed.summary ? " " : ""}Missing: ${parsed.missing}`;
  }
  return parsed;
}

/** Trust the reviewer; apply only guard and explicit deliverable checks — no task-shaped turn-law. */
export function judgeReview(text: string, latest: string, evidence = "", reply = ""): Review {
  const review = parseReview(text);
  if (review.verdict !== "pass") return review;
  const fileMiss = missingArtifactWrites(latest, evidence);
  const maskMiss = maskedArtifactWrite(latest, evidence);
  const miss = reply && evidence ? replyOmitsPageCode(reply, evidence, latest) : undefined;
  const why = fileMiss || maskMiss || miss;
  if (!why) return review;
  return {
    ...review,
    verdict: "fail",
    achieved: false,
    missing: review.missing || why,
    summary: `${review.summary ? `${review.summary} ` : ""}${why}`,
  };
}

const WRITE_VERB = /\b(?:write|create|save|put|place|output|produce|store|generate)\b/i;

export function requestedArtifacts(message: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const path = raw.replaceAll("\\", "/").replace(/[.,;:]+$/, "");
    if (path && isDeliverablePath(path)) found.push(path);
  };
  for (const match of message.matchAll(/`(\/?[\w./-]+\.[A-Za-z0-9.]+)`/g)) add(match[1] ?? "");
  for (const match of message.matchAll(/\b(?:write|create|save|put|place)\b[^.\n`]{0,120}?(\/?[\w./-]+\.[A-Za-z][A-Za-z0-9.]*)/gi)) {
    add(match[1] ?? "");
  }
  for (const match of message.matchAll(/\b(?:in|to|into|at)\s+(\/[\w./-]+\.[A-Za-z][A-Za-z0-9.]*)/gi)) {
    const idx = match.index ?? 0;
    const clause = (message.slice(Math.max(0, idx - 160), idx).split(/[.\n]/).pop() ?? "");
    if (WRITE_VERB.test(clause)) add(match[1] ?? "");
  }
  return [...new Set(found)];
}

function isDeliverablePath(path: string): boolean {
  if (isRuntimeSink(path)) return false;
  const base = path.split("/").filter(Boolean).at(-1) ?? "";
  if (!base.includes(".")) return false;
  if (/^\d+(\.\d+)+$/.test(base)) return false;
  return /\.[A-Za-z]/.test(base);
}

export function missingArtifactWrites(latest: string, evidence: string): string | undefined {
  const missing = requestedArtifacts(latest).filter((path) => !evidenceWrote(evidence, path));
  if (!missing.length) return;
  const poisoned = missing.filter((path) => writeCapturedError(evidence, path));
  if (poisoned.length && poisoned.length === missing.length) {
    return `last write captured a tool error for ${poisoned.join(", ")}`;
  }
  return `no write of ${missing.join(", ")}`;
}

export function artifactPins(latest: string, evidence: string): string {
  const requested = requestedArtifacts(latest);
  if (!requested.length) return "";
  const present = requested.filter((path) => evidenceWrote(evidence, path));
  const missing = requested.filter((path) => !evidenceWrote(evidence, path));
  const poisoned = requested.filter((path) => writeCapturedError(evidence, path));
  return [
    present.length ? `Already on disk (keep them, do not regenerate): ${present.join(", ")}` : "",
    missing.length ? `Not yet written: ${missing.join(", ")}` : "",
    poisoned.length ? `Last write captured a tool error (overwrite with successful output): ${poisoned.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export function stillMissingArtifacts(latest: string, evidence: string, reviewMissing?: string): string {
  const requested = requestedArtifacts(latest);
  if (!requested.length) return reviewMissing || "the requested result";
  const missing = requested.filter((path) => !evidenceWrote(evidence, path));
  if (missing.length) return missing.join(", ");
  return reviewMissing || "the requested result";
}

export function unwrittenArtifacts(latest: string, evidence: string): string[] {
  return requestedArtifacts(latest).filter((path) => !evidenceWrote(evidence, path));
}

export function missingIsLocalArtifact(missing?: string, latest = ""): boolean {
  const miss = missing ?? "";
  if (/https?:\/\/|unknown_api|vendor api|needs?\s*docs/i.test(miss)) return false;
  const files = requestedArtifacts(latest);
  if (files.length && !miss.trim()) return true;
  if (!miss.trim()) return false;
  if (files.some((path) => {
    const base = path.split("/").filter(Boolean).at(-1) ?? "";
    return miss.includes(path) || (base.length > 3 && miss.includes(base));
  })) return true;
  return /(?:^|[\s,;:`])\/?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+\b/.test(miss)
    || /(?:^|[\s,;:`])[\w.-]+\.[A-Za-z0-9]+\b/.test(miss);
}

export function maskedArtifactWrite(latest: string, evidence: string): string | undefined {
  if (askedToReplaceSecrets(latest)) return;
  const paths = requestedArtifacts(latest);
  if (!paths.length || !/DETECTED_SECRET_/i.test(evidence)) return;
  for (const line of evidence.split("\n")) {
    if (!line.startsWith("fs_write ")) continue;
    let parsed: { path?: string; content?: string };
    try {
      parsed = JSON.parse(line.slice("fs_write ".length)) as { path?: string; content?: string };
    } catch {
      continue;
    }
    const path = parsed.path;
    const content = parsed.content ?? "";
    if (!path || !/DETECTED_SECRET_/i.test(content)) continue;
    const asked = paths.some((item) => writeAliases(item).some((alias) => path === alias || path.endsWith(alias) || alias.endsWith(path)));
    if (asked) return `wrote DETECTED_SECRET mask into ${path} instead of the live value`;
  }
}

function askedToReplaceSecrets(latest: string): boolean {
  return /<your-[a-z0-9-]+>/i.test(latest) || /\breplace secrets\b/i.test(latest);
}

function isRuntimeSink(path: string): boolean {
  const n = path.replaceAll("\\", "/");
  return /\.(log|pid)$/i.test(n) || /(^|\/)var\/log\//i.test(n);
}

export function evidenceWrote(evidence: string, requested: string): boolean {
  let state: "none" | "ok" | "poison" = "none";
  for (const block of toolBlocks(evidence)) {
    if (blockWrites(block, requested)) {
      state = block.startsWith("shell ") && blockLooksFailed(block) ? "poison" : "ok";
      continue;
    }
    if (state === "none" && evidenceListed(block, requested)) state = "ok";
  }
  if (state === "poison") return false;
  if (state === "ok") return true;
  return evidenceListed(evidence, requested);
}

export function writeCapturedError(evidence: string, requested: string): boolean {
  let poisoned = false;
  for (const block of toolBlocks(evidence)) {
    if (!blockWrites(block, requested)) continue;
    poisoned = block.startsWith("shell ") && blockLooksFailed(block);
  }
  return poisoned;
}

function evidenceListed(evidence: string, requested: string): boolean {
  const base = requested.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  if (!base) return false;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`${escaped} EXISTS\\b`).test(evidence)) return true;
  return new RegExp(`^-[rwxsStT-]{9,11}\\s[^\\n]*\\s${escaped}\\s*$`, "m").test(evidence);
}

function toolBlocks(evidence: string): string[] {
  return evidence.split(/(?=(?:shell|fs_write|fs_edit) )/g).filter(Boolean);
}

function blockWrites(block: string, requested: string): boolean {
  return writeAliases(requested).some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:wrote |edited |(?:-out|-o|>|>>)\\s*|path"\\s*:\\s*"|sed\\s+-i\\b[^\\n]*\\s|tee\\s+)${escaped}(?:\\s|"|\\(|$|<<)`,
      "i",
    ).test(block);
  });
}

function blockLooksFailed(block: string): boolean {
  return /Traceback\b|Unable to load|Could not (?:get|read|open|load)\b|SyntaxError\b|IndentationError\b|NameError\b|\bException\b|command failed|N\/A to N\/A/i.test(block);
}

function writeAliases(requested: string): string[] {
  const n = requested.replaceAll("\\", "/").replace(/\/+$/, "");
  const aliases = [n];
  const base = n.split("/").filter(Boolean).at(-1);
  if (base) aliases.push(base);
  if (n.startsWith("/")) {
    const parts = n.split("/").filter(Boolean);
    if (parts.length >= 2) aliases.push(parts.slice(1).join("/"));
  }
  return [...new Set(aliases)];
}
