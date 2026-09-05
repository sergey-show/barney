import type { FailureKind, Review, ReviewVerdict } from "../../domain/run/Review.ts";
import { replyOmitsPageCode } from "../research/verifyReply.ts";
import { pathsMatch } from "./validationLedger.ts";
import { asText } from "./packSession.ts";

const FAILURE_KINDS = new Set<FailureKind>([
  "masked-deliverable",
  "unrun-program",
  "captured-error",
  "missing-artifact",
  "general",
]);

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
  return { verdict: "uncertain", summary: text.slice(0, 400), needsResearch: true };
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
  const achievedTrue = /"achieved"\s*:\s*true/.test(text);
  let verdict: ReviewVerdict = match[1] as ReviewVerdict;
  // Truncated recovery must not invent a pass without an explicit achieved:true.
  if (verdict === "pass" && (achievedFalse || !achievedTrue)) verdict = "fail";
  return {
    verdict,
    achieved: verdict === "pass",
    summary: "reviewer JSON was wrapped or truncated; recovered verdict",
    needsResearch: /"needsResearch"\s*:\s*true/.test(text),
    needsUser: /"needsUser"\s*:\s*true/.test(text),
    operatorCorrected: /"operatorCorrected"\s*:\s*true/.test(text),
  };
}

function normalizeReview(parsed: Review): Review | undefined {
  if (parsed.achieved === false && parsed.verdict === "pass") parsed.verdict = "fail";
  if (!parsed.verdict) return;
  parsed.summary = asText(parsed.summary);
  parsed.missing = parsed.missing == null ? undefined : asText(parsed.missing) || undefined;
  parsed.requested = parsed.requested == null ? undefined : asText(parsed.requested) || undefined;
  parsed.knowledgeQuery = parsed.knowledgeQuery == null ? undefined : asText(parsed.knowledgeQuery) || undefined;
  parsed.needsUser = parsed.needsUser === true;
  parsed.operatorCorrected = parsed.operatorCorrected === true;
  if (parsed.failureKind && !FAILURE_KINDS.has(parsed.failureKind)) parsed.failureKind = undefined;
  if (parsed.missing && parsed.verdict !== "pass") {
    parsed.summary = `${parsed.summary}${parsed.summary ? " " : ""}Missing: ${parsed.missing}`;
  }
  return parsed;
}

/** Structural failure kind from evidence and ledger — not reviewer prose. */
export function inferFailureKind(
  latest: string,
  evidence: string,
  unverifiedPaths: string[] = [],
  guard?: { fileMiss?: string; maskMiss?: string },
): FailureKind {
  if (guard?.maskMiss) return "masked-deliverable";
  if (guard?.fileMiss?.startsWith("last write captured")) return "captured-error";
  if (guard?.fileMiss) return "missing-artifact";
  if (maskedArtifactWrite(latest, evidence)) return "masked-deliverable";
  const fileMiss = missingArtifactWrites(latest, evidence);
  if (fileMiss?.startsWith("last write captured")) return "captured-error";
  if (fileMiss) return "missing-artifact";
  const requested = requestedArtifacts(latest);
  if (requested.some((path) => unverifiedPaths.some((hit) => pathsMatch(hit, path)))) return "unrun-program";
  return "general";
}

/**
 * Structural guards only (paths written?, secret mask?, conflict markers?).
 * Whether stderr dumps, inspection-only work, or wrong file *content* satisfy the ask
 * is the reviewer's job — do not regex-classify error prose here.
 */
export function judgeReview(
  text: string,
  latest: string,
  evidence = "",
  reply = "",
  opts?: { unverifiedPaths?: string[] },
): Review {
  const review = parseReview(text);
  const unverified = opts?.unverifiedPaths ?? [];
  if (review.verdict !== "pass") {
    review.failureKind = review.failureKind ?? inferFailureKind(latest, evidence, unverified);
    return review;
  }
  const fileMiss = missingArtifactWrites(latest, evidence);
  const maskMiss = maskedArtifactWrite(latest, evidence);
  const secretLeftover = leftoverSecretMasks(latest, evidence);
  const idWithoutAction = identificationWithoutAction(latest, evidence, reply);
  const conflictMiss = conflictedDeliverable(evidence);
  const urlMiss = missingGoalUrlOpen(latest, evidence);
  const miss = reply && evidence ? replyOmitsPageCode(reply, evidence, latest) : undefined;
  const why = fileMiss || maskMiss || secretLeftover || idWithoutAction || conflictMiss || urlMiss || miss;
  if (!why) {
    const unverifiedMiss = inferFailureKind(latest, evidence, unverified);
    if (unverifiedMiss === "unrun-program") {
      return {
        ...review,
        verdict: "fail",
        achieved: false,
        missing: review.missing || "written but not validated since last edit",
        summary: `${review.summary ? `${review.summary} ` : ""}Written but not validated since last edit`,
        failureKind: "unrun-program",
      };
    }
    return review;
  }
  return {
    ...review,
    verdict: "fail",
    achieved: false,
    missing: review.missing || why,
    summary: `${review.summary ? `${review.summary} ` : ""}${why}`,
    failureKind: inferFailureKind(latest, evidence, unverified, {
      fileMiss,
      maskMiss: maskMiss || secretLeftover,
    }),
  };
}

/** User asked to read/open a concrete URL — evidence must show that URL was opened. */
export function missingGoalUrlOpen(latest: string, evidence: string): string | undefined {
  if (!asksToOpenUrl(latest)) return;
  const urls = goalHttpUrls(latest);
  if (!urls.length) return;
  const missing = urls.filter((url) => !evidenceOpenedUrl(evidence, url));
  if (!missing.length) return;
  return `no browser_open of ${missing.join(", ")}`;
}

function asksToOpenUrl(latest: string): boolean {
  return /прочитай|открой|откройте|по\s+ссылке|read\b|open\b|fetch\b|look\s*up|article|статье|docs?\b|документац/i.test(latest);
}

export function goalHttpUrls(message: string): string[] {
  const found: string[] = [];
  for (const match of message.matchAll(/https?:\/\/[^\s)>"'\]]+/gi)) {
    const url = (match[0] ?? "").replace(/[.,;:!?]+$/, "");
    if (url) found.push(url);
  }
  return [...new Set(found)];
}

function evidenceOpenedUrl(evidence: string, wanted: string): boolean {
  const wantId = urlPathId(wanted);
  for (const block of evidence.split(/(?=(?:browser_open|opened) )/gi)) {
    if (!/^(?:browser_open|opened) /i.test(block)) continue;
    const opened = openedUrlFromBlock(block);
    if (!opened) continue;
    if (urlsMatchOpen(opened, wanted)) return true;
    if (wantId && urlPathId(opened) === wantId) return true;
  }
  return false;
}

function openedUrlFromBlock(block: string): string | undefined {
  const opened = block.match(/^opened\s+(https?:\/\/\S+)/i)?.[1];
  if (opened) return opened.replace(/[.,;:]+$/, "");
  const fromJson = block.match(/"url"\s*:\s*"(https?:\\\\\/\\\\\/[^"]+|https?:\/\/[^"]+)"/i)?.[1];
  if (fromJson) return fromJson.replace(/\\\//g, "/");
  const bare = block.match(/https?:\/\/[^\s"'\\]+/i)?.[0];
  return bare?.replace(/[.,;:]+$/, "");
}

function urlsMatchOpen(opened: string, wanted: string): boolean {
  const a = opened.replace(/\/+$/, "").toLowerCase();
  const b = wanted.replace(/\/+$/, "").toLowerCase();
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  try {
    const left = new URL(opened);
    const right = new URL(wanted);
    if (left.hostname !== right.hostname) return false;
    const lp = left.pathname.replace(/\/+$/, "");
    const rp = right.pathname.replace(/\/+$/, "");
    return lp === rp || lp.endsWith(rp) || rp.endsWith(lp);
  } catch {
    return false;
  }
}

function urlPathId(url: string): string | undefined {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const last = parts.at(-1) ?? "";
    if (/^\d{5,}$/.test(last)) return last;
    const digits = last.replace(/\D/g, "");
    if (digits.length >= 5) return digits;
  } catch {
    /* ignore */
  }
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
  const missing = unwrittenArtifacts(latest, evidence);
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

/**
 * Sanitize / placeholder goals: after a replace, evidence must show a clean probe
 * (fs_read or grep/cat) with no DETECTED_SECRET_* left. Prevents false pass on sed exit 0.
 */
export function leftoverSecretMasks(latest: string, evidence: string): string | undefined {
  if (!askedToReplaceSecrets(latest)) return;
  if (!/DETECTED_SECRET_/i.test(evidence)) return;
  const blocks = toolBlocks(evidence);
  let lastMutate = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (isSecretReplaceMutate(blocks[i] ?? "")) lastMutate = i;
  }
  if (lastMutate < 0) {
    return "secrets still present as DETECTED_SECRET_* — replace with <your-…> placeholders";
  }
  let sawVerify = false;
  for (let i = lastMutate + 1; i < blocks.length; i++) {
    const block = blocks[i] ?? "";
    if (!isSecretContentProbe(block)) continue;
    sawVerify = true;
    const body = block.split("\n").slice(1).join("\n");
    if (/DETECTED_SECRET_/i.test(body)) {
      return "DETECTED_SECRET_* still on disk after replace — finish every mask hash with <your-…> and re-check";
    }
  }
  for (const body of latestFileBodies(evidence).values()) {
    if (/DETECTED_SECRET_/i.test(body)) {
      return "DETECTED_SECRET_* still on disk after replace — finish every mask hash with <your-…> and re-check";
    }
  }
  if (!sawVerify) {
    return "replaced secrets but did not verify — fs_read or grep the edited files; DETECTED_SECRET_* must be gone";
  }
}

function isSecretReplaceMutate(block: string): boolean {
  const head = block.split("\n")[0] ?? "";
  if (/^fs_edit /.test(head) || /^fs_write /.test(head)) {
    if (/^error:/im.test(block)) return false;
    return /DETECTED_SECRET_|<your-[a-z0-9-]+>/i.test(head);
  }
  if (!/^shell /.test(head)) return false;
  if (!/\bsed\b/i.test(head) || !/-i\b/.test(head)) return false;
  if (!/^exit 0\b/m.test(block)) return false;
  return /DETECTED_SECRET_|<your-[a-z0-9-]+>/i.test(head);
}

function isSecretContentProbe(block: string): boolean {
  const head = block.split("\n")[0] ?? "";
  if (/^fs_read /.test(head)) return true;
  if (!/^shell /.test(head)) return false;
  if (/\bsed\b/i.test(head) && /-i\b/.test(head)) return false;
  return /\b(?:grep|cat|sed|head|tail)\b/i.test(head);
}

export function askedToReplaceSecrets(latest: string): boolean {
  return /<your-[a-z0-9-]+>/i.test(latest)
    || /\breplace secrets\b/i.test(latest)
    || /\bsanitize\b/i.test(latest)
    || /\bplaceholder values\b/i.test(latest);
}

/**
 * Delivery goals that require mutation: inspection-only evidence (plus plan/go-ahead reply)
 * cannot pass. Narrower than "any find/merge" so exploratory review stays LLM-judged.
 */
export function identificationWithoutAction(latest: string, evidence: string, reply = ""): string | undefined {
  if (!asksMutatingDelivery(latest)) return;
  if (evidenceHasSuccessfulMutate(evidence)) return;
  if (!evidenceHasInspection(evidence)) return;
  if (askedToReplaceSecrets(latest)) {
    return "identification-without-action: found secrets but did not replace them with placeholders";
  }
  if (/ready to execute|on your go-ahead|awaiting (your )?approval|planned replacements/i.test(reply)) {
    return "identification-without-action: planned delivery without applying edits";
  }
  // Explicit write/create path goals without mutate are covered by missingArtifactWrites.
  if (requestedArtifacts(latest).length) return;
  if (/\b(fix|patch|replace|edit|implement)\b/i.test(latest)) {
    return "identification-without-action: inspected the problem but made no edit";
  }
}

function asksMutatingDelivery(latest: string): boolean {
  return askedToReplaceSecrets(latest)
    || /\b(sanitize|redact|decontaminat)\b/i.test(latest)
    || (/\b(fix|patch|replace|edit|implement)\b/i.test(latest) && !/\b(find|search|explain|what is)\b/i.test(latest))
    || (WRITE_VERB.test(latest) && requestedArtifacts(latest).length > 0);
}

function evidenceHasSuccessfulMutate(evidence: string): boolean {
  for (const block of toolBlocks(evidence)) {
    const head = block.split("\n")[0] ?? "";
    if (/^fs_(?:write|edit|append) /.test(head) && !/^error:/im.test(block)) return true;
    if (/^shell /.test(head) && /\bsed\b/i.test(head) && /-i\b/.test(head) && /^exit 0\b/m.test(block)) return true;
  }
  return false;
}

function evidenceHasInspection(evidence: string): boolean {
  for (const block of toolBlocks(evidence)) {
    const head = block.split("\n")[0] ?? "";
    if (/^fs_(?:search|list|read) /.test(head)) return true;
    if (/^shell /.test(head) && /\b(?:grep|find|rg|git\s+(?:status|log|show|diff))\b/i.test(head)) return true;
  }
  return false;
}

/** Unresolved conflict markers in the *latest* body of a file — not stale grep/merge noise. */
export function conflictedDeliverable(evidence: string): string | undefined {
  const bodies = latestFileBodies(evidence);
  for (const body of bodies.values()) {
    if (hasConflictMarkers(body)) {
      return "unresolved conflict markers remain in a deliverable";
    }
  }
}

function hasConflictMarkers(text: string): boolean {
  return /^<<<<<<< /m.test(text) || /\n<<<<<<< /m.test(text);
}

/** Last on-disk snapshot per path from fs_read / fs_write / fs_edit (not shell grep of markers). */
function latestFileBodies(evidence: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const block of toolBlocks(evidence)) {
    if (block.startsWith("fs_write ") || block.startsWith("fs_edit ")) {
      const raw = block.replace(/^fs_(?:write|edit) /, "").split("\n")[0] ?? "";
      try {
        const parsed = JSON.parse(raw) as { path?: string; content?: string; new?: string };
        if (!parsed.path) continue;
        const body = parsed.content ?? parsed.new;
        if (typeof body === "string") bodies.set(normEvidencePath(parsed.path), body);
      } catch {
        /* skip */
      }
      continue;
    }
    if (block.startsWith("fs_read ")) {
      const raw = block.split("\n")[0] ?? "";
      const pathMatch = raw.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
      const path = pathMatch?.[1]?.replace(/\\"/g, '"');
      if (!path) continue;
      const body = block.split("\n").slice(1).join("\n");
      // Drop Observe/error tails from the read payload.
      const clean = body.replace(/\n\nObserve:[\s\S]*$/, "").replace(/^error:[\s\S]*/i, "");
      if (clean && !/^error:/i.test(clean)) bodies.set(normEvidencePath(path), clean);
    }
  }
  return bodies;
}

function normEvidencePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isRuntimeSink(path: string): boolean {
  const n = path.replaceAll("\\", "/");
  return /\.(log|pid)$/i.test(n) || /(^|\/)var\/log\//i.test(n);
}

/**
 * A shell write with non-zero exit did not land. File content judgment is the reviewer's.
 */
export function evidenceWrote(evidence: string, requested: string): boolean {
  let state: "none" | "ok" | "poison" = "none";
  for (const block of toolBlocks(evidence)) {
    if (blockWrites(block, requested)) {
      state = block.startsWith("shell ") && shellExitFailed(block) ? "poison" : "ok";
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
    poisoned = block.startsWith("shell ") && shellExitFailed(block);
  }
  return poisoned;
}

function shellExitFailed(block: string): boolean {
  return /\nexit [1-9]\d*(?:\n|$)/.test(block) || /^exit [1-9]\d*(?:\n|$)/.test(block);
}

function evidenceListed(evidence: string, requested: string): boolean {
  const base = requested.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  if (!base) return false;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`${escaped} EXISTS\\b`).test(evidence)) return true;
  return new RegExp(`^-[rwxsStT-]{9,11}\\s[^\\n]*\\s${escaped}\\s*$`, "m").test(evidence);
}

function toolBlocks(evidence: string): string[] {
  return evidence.split(/(?=(?:shell|fs_write|fs_edit|fs_append|fs_restore|fs_read) )/g).filter(Boolean);
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
