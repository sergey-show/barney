import { redactSecrets } from "./packSession.ts";
import { slugKey } from "../../domain/memory/MemoryNote.ts";

export type LessonTrail = {
  failedFamily: string;
  recoveredBy: string;
};

export function emptyTrail(): LessonTrail {
  return { failedFamily: "", recoveredBy: "" };
}

/** Only a tool family id. Never copy the goal or a URL into the lesson. */
export function clipFamily(raw?: string): string {
  const text = (raw ?? "").trim().toLowerCase().slice(0, 40);
  return /^[a-z][a-z0-9:_-]*$/.test(text) ? text : "";
}

export function noteTrail(trail: LessonTrail, family: string, failed: boolean): void {
  const fam = clipFamily(family);
  if (!fam) return;
  if (failed) {
    trail.failedFamily = fam;
    return;
  }
  if (trail.failedFamily && fam !== trail.failedFamily) trail.recoveredBy = fam;
}

export type LessonInput = {
  taskClass: string;
  goal: string;
  latest?: string;
  verdict: string;
  summary: string;
  missing?: string;
  anchors?: string[];
  operatorCorrected?: boolean;
  failClass?: string;
  failedFamily?: string;
  recoveredBy?: string;
  /** How many times this family failed before the rule was written. */
  familyFailCount?: number;
  /** Episode / run ids that birthed this rule. */
  sources?: string[];
  /** Prior confidence when reinforcing an existing rule. */
  priorConfidence?: number;
  priorVersion?: number;
};

export type LessonRule = {
  key: string;
  title: string;
  body: string;
  topic: string;
  confidence: number;
  version: number;
  sources: string[];
};

export function lessonRule(input: LessonInput): LessonRule {
  const topic = ruleTopic(input);
  const body = redactSecrets(specificLesson(input) ?? trailLesson(input, topic) ?? genericLesson(input, topic));
  const priorConf = input.priorConfidence ?? 0;
  const priorVer = input.priorVersion ?? 0;
  const confirmed = priorConf > 0;
  const confidence = confirmed
    ? Math.min(1, priorConf + 0.15)
    : crystallizeConfidence(input);
  const version = confirmed ? priorVer + 1 : 1;
  const sources = [...(input.sources ?? [])].slice(0, 5);
  return {
    key: slugKey(`rule/${input.taskClass}/${topic}`),
    title: `Rule: ${topic}`,
    body,
    topic,
    confidence,
    version,
    sources,
  };
}

/** Prompt / memory line with version, confidence, and episode provenance. */
export function formatLessonLine(rule: LessonRule): string {
  const conf = ` (v${rule.version}, conf ${rule.confidence.toFixed(2)})`;
  const provenance = rule.sources.length ? ` [from ${rule.sources.join(", ")}]` : "";
  return `${rule.body}${conf}${provenance}`;
}

function crystallizeConfidence(input: LessonInput): number {
  if (input.operatorCorrected) return 0.9;
  if ((input.familyFailCount ?? 0) >= 2 && input.failedFamily) return 0.75;
  if (input.failedFamily && input.recoveredBy) return 0.7;
  if (input.verdict === "pass" && input.failedFamily) return 0.65;
  if (input.failClass && input.failClass !== "general") return 0.55;
  return 0.4;
}

export function pickRules(
  notes: Array<{ key: string; title: string; body: string; tags: string[] }>,
  taskClass: string,
  limit = 5,
  relatedKeys: string[] = [],
): string[] {
  const rules = notes.filter((note) => note.tags.includes("rule") || note.key.startsWith("rule/"));
  const related = new Set(relatedKeys);
  const ranked = [
    ...rules.filter((note) =>
      (note.tags.includes("fail") || note.tags.includes("experience"))
      && (note.tags.includes(taskClass) || note.key.includes(`/${taskClass}/`)),
    ),
    ...rules.filter((note) => related.has(note.key)),
    ...rules.filter((note) => note.tags.includes(taskClass) && !note.tags.includes("fail")),
  ];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const note of ranked) {
    const line = redactSecrets(note.body.split("\n")[0] ?? "").trim();
    if (!line || seen.has(line) || isRecapLesson(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

function specificLesson(input: LessonInput): string | null {
  if (input.operatorCorrected) {
    return "If the operator says the last answer was wrong, fail it and re-check with tools; do not repeat the same claim.";
  }
  return null;
}

function trailLesson(input: LessonInput, topic: string): string | null {
  const failed = clipFamily(input.failedFamily);
  const recovered = clipFamily(input.recoveredBy);
  const klass = classTag(input.failClass);
  const prefix = klass ? `[${klass}] ` : "";
  const repeats = input.familyFailCount ?? 0;
  if (input.verdict === "pass") {
    if (failed && recovered && recovered !== failed) {
      return oneSentence(`For ${topic}: after ${failed} failed, ${recovered} delivered.`);
    }
    return null;
  }
  if (!failed) return null;
  if (repeats >= 2) {
    return oneSentence(
      `${prefix}when ${failed} fails twice on ${topic}, switch family before a third try` +
        (recovered && recovered !== failed ? `; ${recovered} recovered` : ""),
    );
  }
  if (recovered && recovered !== failed) {
    return oneSentence(`${prefix}if ${failed} fails, do not repeat ${failed}; next was ${recovered}.`);
  }
  return oneSentence(`${prefix}if ${failed} fails, do not repeat ${failed}.`);
}

function classTag(failClass?: string): string {
  if (!failClass || failClass === "general" || failClass === "aborted-unfinished") return "";
  return failClass;
}

function genericLesson(input: LessonInput, topic: string): string {
  if (input.verdict === "pass") {
    return oneSentence(passTactic(input, topic));
  }
  const miss = input.missing || input.summary || "the previous approach failed";
  const klass = classTag(input.failClass);
  if (klass) {
    return oneSentence(`[${klass}] if ${miss}, change path; do not repeat the failed call.`);
  }
  return oneSentence(`For ${topic}: if ${miss}, change tool or path; do not repeat the failed call.`);
}

function passTactic(input: LessonInput, topic: string): string {
  return `For ${topic}: ${input.summary}`;
}

function ruleTopic(input: LessonInput): string {
  for (const anchor of input.anchors ?? []) {
    try {
      const host = new URL(anchor).hostname.replace(/\.$/, "");
      if (host) return host;
    } catch {
      const ip = anchor.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
      if (ip) return ip;
    }
  }
  return input.taskClass || "general";
}

export function isRecapLesson(line: string): boolean {
  return /session closed by user/i.test(line)
    || /agent successfully|successfully (opened|answered|read|used|retrieved)/i.test(line)
    || (/^For \w+:/i.test(line) && /successfully/i.test(line))
    || (/^When working on /i.test(line) && /successfully|agent (successfully|correctly)/i.test(line));
}

function oneSentence(text: string): string {
  const compact = text.replace(/\s+/g, " ").replace(/Missing:\s*/gi, "").trim();
  const sentence = compact.split(/(?<=[.!?])\s/)[0] ?? compact;
  return sentence.length > 180 ? `${sentence.slice(0, 179)}…` : sentence;
}
