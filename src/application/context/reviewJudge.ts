import type { Review } from "../../domain/run/Review.ts";
import { replyOmitsPageCode } from "../research/verifyReply.ts";
import { asText } from "./packSession.ts";

export function parseReview(text: string): Review {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Review;
      if (parsed.achieved === false && parsed.verdict === "pass") parsed.verdict = "fail";
      if (parsed.verdict) {
        parsed.summary = asText(parsed.summary);
        parsed.missing = parsed.missing == null ? undefined : asText(parsed.missing) || undefined;
        parsed.requested = parsed.requested == null ? undefined : asText(parsed.requested) || undefined;
        parsed.knowledgeQuery = parsed.knowledgeQuery == null ? undefined : asText(parsed.knowledgeQuery) || undefined;
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
  return { verdict: "fail", summary: text.slice(0, 400), needsResearch: false };
}

export function judgeReview(text: string, latest: string, evidence = "", reply = ""): Review {
  const review = parseReview(text);
  if (review.verdict !== "pass") return review;
  const fileMiss = missingArtifactWrites(latest, evidence);
  const maskMiss = maskedArtifactWrite(latest, evidence);
  const startMiss = missingServiceStart(latest, evidence);
  const runMiss = missingRunnableRun(latest, evidence);
  const miss = reply && evidence ? replyOmitsPageCode(reply, evidence, latest) : undefined;
  const why = fileMiss || maskMiss || startMiss || runMiss || miss;
  if (!why) return review;
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
  const unrun = unrunArtifacts(latest, evidence);
  return [
    present.length ? `Already on disk (keep them, do not regenerate): ${present.join(", ")}` : "",
    missing.length ? `Not yet written: ${missing.join(", ")}` : "",
    poisoned.length ? `Last write captured a tool error (overwrite with successful output): ${poisoned.join(", ")}` : "",
    unrun.length ? `Not yet run (execute until exit 0): ${unrun.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

export function stillMissingArtifacts(latest: string, evidence: string, reviewMissing?: string): string {
  const requested = requestedArtifacts(latest);
  if (!requested.length) return reviewMissing || "the requested result";
  const missing = requested.filter((path) => !evidenceWrote(evidence, path));
  if (missing.length) return missing.join(", ");
  const unrun = unrunArtifacts(latest, evidence);
  if (unrun.length) return unrun.join(", ");
  return reviewMissing || "the requested result";
}

export function unwrittenArtifacts(latest: string, evidence: string): string[] {
  return requestedArtifacts(latest).filter((path) => !evidenceWrote(evidence, path));
}

export function unrunArtifacts(latest: string, evidence: string): string[] {
  return requestedArtifacts(latest).filter(
    (path) => needsSuccessfulRun(latest, path) && evidenceWrote(evidence, path) && !evidenceRan(evidence, path),
  );
}

export function missingRunnableRun(latest: string, evidence: string): string | undefined {
  const pending = unrunArtifacts(latest, evidence);
  if (!pending.length) return;
  return `no successful run of ${pending.join(", ")}`;
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
  return /Traceback\b|Unable to load|Could not (?:get|read|open|load)\b|SyntaxError\b|\bException\b|command failed|N\/A to N\/A/i.test(block);
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

export function missingServiceStart(latest: string, evidence: string): string | undefined {
  const port = latest.match(/listen(?:s)? on port (\d+)/i)?.[1];
  const askedStart =
    /start\/restart|\bstart or restart\b/i.test(latest) ||
    (/\b(?:start|restart|reload)\b/i.test(latest) && /\b(?:service|server|daemon)\b/i.test(latest));
  if (!port && !askedStart) return;
  if (serviceStarted(evidence, port)) return;
  return port ? `no start listening on ${port}` : "no successful start";
}

function needsSuccessfulRun(latest: string, path: string): boolean {
  const window = mentionWindow(latest, path);
  if (!window || isDataAsk(window) || isDaemonAsk(window)) return false;
  return isProgramAsk(window);
}

function isDataAsk(window: string): boolean {
  return /\bcontain(?:s|ing)?\b|\bfile that includ|\bincludes both\b|\bsave(?:d)? (?:it |them )?as\b|\bstor(?:e|ing)\b|\blog to\b/i.test(window);
}

function isDaemonAsk(window: string): boolean {
  return /\blisten(?:s)? on port\b|\bstart\/restart\b|\bstart or restart\b/i.test(window);
}

function isProgramAsk(window: string): boolean {
  if (/\b(?:script|program|executable)\b/i.test(window)) return true;
  return /\bthat\b|\bwhich\b/.test(window)
    && /\b(?:print|verif|check|run|execut|output|display|comput|succeed|work|load)/i.test(window);
}

function mentionWindow(latest: string, path: string): string {
  const base = path.split("/").filter(Boolean).at(-1) ?? path;
  const idxPath = latest.lastIndexOf(path);
  const idxBase = latest.lastIndexOf(base);
  const idx = idxPath >= 0 ? idxPath : idxBase;
  if (idx < 0) return "";
  const pathLen = idxPath >= 0 ? path.length : base.length;
  const start = latest.lastIndexOf("\n", Math.max(0, idx - 1)) + 1;
  let end = latest.indexOf("\n", idx + pathLen);
  if (end < 0) end = latest.length;
  while (end < latest.length) {
    const nextNl = latest.indexOf("\n", end + 1);
    const line = latest.slice(end + 1, nextNl < 0 ? latest.length : nextNl);
    if (!/^\s*-\s/.test(line)) break;
    end = nextNl < 0 ? latest.length : nextNl;
    if (nextNl < 0) break;
  }
  return latest.slice(start, end);
}

function evidenceRan(evidence: string, requested: string): boolean {
  for (const block of evidence.split(/(?=(?:shell|process_spawn|process_run) )/g)) {
    if (!invokesRunnable(block, requested)) continue;
    if (blockSucceeded(block)) return true;
  }
  return false;
}

function invokesRunnable(block: string, requested: string): boolean {
  const aliases = [...writeAliases(requested), requested.split("/").filter(Boolean).at(-1) ?? ""].filter(Boolean);
  const command = shellCommand(block);
  const haystack = command || block;
  for (const clause of haystack.split(/\s*(?:&&|\|\||;)\s*/)) {
    if (clauseExecutes(clause, aliases)) return true;
  }
  return false;
}

function clauseExecutes(clause: string, aliases: string[]): boolean {
  const tokens = clause.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const fileIdx = tokens.findIndex((tok) => aliases.some((alias) => tokenIsPath(tok, alias)));
  if (fileIdx < 0) return false;
  const prev = tokens[fileIdx - 1] ?? "";
  if (prev === ">" || prev === ">>" || /^tee$/i.test(prev) || /^-{1,2}(?:in|out|o|file|C)$/i.test(prev)) return false;
  if (fileIdx === 0) return true;
  const cmd = tokens[0]?.replace(/^.*\//, "") ?? "";
  return !looksLikeFileOperandCmd(cmd);
}

function tokenIsPath(token: string, alias: string): boolean {
  const tok = token.replace(/^[`'"]+|[`'"]+$/g, "");
  return tok === alias || tok === `./${alias}` || tok.endsWith(`/${alias}`);
}

function looksLikeFileOperandCmd(cmd: string): boolean {
  return /^(?:ls|cat|stat|chmod|chown|rm|mv|cp|mkdir|touch|head|tail|less|more|file|wc|tee|echo|printf|ln|dd|install|basename|dirname|readlink|sed|awk|grep)$/i.test(cmd);
}

function shellCommand(block: string): string {
  const match = block.match(/"command"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match?.[1]) return "";
  return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
}

function blockSucceeded(block: string): boolean {
  if (!/\nexit 0(?:\n|$)/.test(block)) return false;
  return !/\nexit [1-9]\d*(?:\n|$)/.test(block);
}

function serviceStarted(evidence: string, port?: string): boolean {
  if (configTestPassed(evidence) && startReloaded(evidence)) return true;
  if (port && hitLocalPort(evidence, port)) return true;
  return false;
}

function configTestPassed(evidence: string): boolean {
  return /test is successful|syntax is ok/i.test(evidence);
}

function startReloaded(evidence: string): boolean {
  const started =
    /\bprocess_spawn\b/i.test(evidence) ||
    /\b(?:systemctl|service)\s+\S+\s+(?:start|reload|restart)\b/i.test(evidence) ||
    /\S+\s+(?:-s\s+)?(?:reload|restart)\b/i.test(evidence);
  return started && /\bexit 0\b/i.test(evidence);
}

function hitLocalPort(evidence: string, port: string): boolean {
  const escaped = port.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(?:curl|wget)\\b[^\\n]*localhost(?::${escaped})?`, "i").test(evidence)) return false;
  if (/connection refused|failed to connect|err_connection/i.test(evidence)) return false;
  return /\bexit 0\b|\b200\b|HTTP\//i.test(evidence);
}
