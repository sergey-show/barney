/**
 * Task study gate — when the body has never seen this problem, force evidence
 * (deep research) before act instead of trusting parametric model knowledge.
 *
 * Wires SolvePolicy.researchOn "new_task_class".
 */

import type { ReuseKind } from "../context/transferLedger.ts";
import {
  experienceRecallHit,
  type ExperienceRecallBags,
} from "./experienceRecall.ts";

export type TaskStudyDecision = {
  force: boolean;
  reason: string;
  line: string;
};

/** Pure decision: fresh reuse + empty recall bags + policy allows new_task_class. */
export function shouldForceTaskStudy(input: {
  reuse: ReuseKind;
  bags: ExperienceRecallBags;
  researchOn: ReadonlyArray<"gap" | "unknown_api" | "new_task_class" | string>;
  /** Greeting / who-are-you — never force web study. */
  allowSkip?: boolean;
}): TaskStudyDecision {
  if (input.allowSkip) {
    return { force: false, reason: "skip", line: "" };
  }
  if (!input.researchOn.includes("new_task_class")) {
    return { force: false, reason: "policy_off", line: "" };
  }
  if (input.reuse !== "fresh") {
    return { force: false, reason: `reuse=${input.reuse}`, line: "" };
  }
  if (experienceRecallHit(input.bags)) {
    return { force: false, reason: "bags_hit", line: "" };
  }
  const reason = "reuse=fresh bags=empty";
  return {
    force: true,
    reason,
    line: `force_research: ${reason} · study task before act (do not invent from training)`,
  };
}

export const TASK_STUDY_ACT_NUDGE = [
  "Task study: no prior body experience for this goal.",
  "Treat the research brief as the source of truth for APIs, URLs, flags, and procedures.",
  "Do not invent library APIs, endpoints, or CLI flags from training memory.",
  "If the brief is thin, search/open docs with tools before writing code.",
].join(" ");

/** Who-are-you / hello — skip forced web study. */
export function isGreetingRoute(topic: string, message: string): boolean {
  const text = `${topic}\n${message}`.toLowerCase();
  if (/^(hi|hello|hey|привет|здравств)\b/.test(message.trim().toLowerCase()) && message.trim().length < 40) {
    return true;
  }
  return /\b(who are you|кто ты|what(?:'s| is) your name|как тебя зовут|greeting)\b/i.test(text);
}

export type StudyWritePlan = {
  /** Full brief kept under study/<class>/<slug>. */
  studyBody: string;
  /** Concrete directives crystallised as provisional rules for next recall. */
  directives: string[];
  skipReason?: string;
};

/** Turn a research brief into durable body records (study note + rule lines). */
export function planStudyWrite(input: {
  brief: string;
  goal: string;
  runId: string;
  maxDirectives?: number;
}): StudyWritePlan {
  const brief = input.brief.replace(/\s+\n/g, "\n").trim();
  if (!brief || brief.length < 40) {
    return { studyBody: "", directives: [], skipReason: "brief_too_thin" };
  }
  if (/unknown\s*[—-]\s*pages did not include a solution/i.test(brief) && !extractStudyDirectives(brief, 1).length) {
    return { studyBody: brief, directives: [], skipReason: "unknown_no_directives" };
  }
  const directives = extractStudyDirectives(brief, input.maxDirectives ?? 5).map((line) =>
    formatStudyDirectiveLine(line, input.runId),
  );
  return { studyBody: brief, directives };
}

/** Heuristic: actionable lines from the brief (not Sources URLs alone). */
export function extractStudyDirectives(brief: string, limit = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of brief.split("\n")) {
    const line = raw.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
    if (!line || /^##\s*Sources\b/i.test(line) || /^Deep research:/i.test(line)) {
      if (/^##\s*Sources\b/i.test(line)) break;
      continue;
    }
    if (/^Collected URLs:/i.test(line)) break;
    if (line.length < 24 || line.length > 220) continue;
    if (/^https?:\/\//i.test(line)) continue;
    const actionable =
      /^(prefer|use|do not|don't|avoid|call|set|pass|install|run|open|copy|write|read|add|enable|disable)\b/i.test(line)
      || /`[^`]+`/.test(line)
      || /\b(api|endpoint|flag|option|param|header|cli|sdk|npm|pip|curl)\b/i.test(line);
    if (!actionable) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

export function formatStudyDirectiveLine(directive: string, runId: string): string {
  const body = directive.replace(/\s+/g, " ").trim();
  return `${body} (v1, conf 0.45) [from study ${runId}]`;
}

export function studyNoteKey(taskClass: string, goal: string): string {
  const klass = (taskClass || "general").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "general";
  const slug = goal.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
  return `study/${klass}/${slug}`;
}

export function studyRuleKey(taskClass: string, directive: string, index: number): string {
  const klass = (taskClass || "general").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "general";
  const slug = directive.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || `d${index}`;
  return `rule/${klass}/study/${slug}`;
}
