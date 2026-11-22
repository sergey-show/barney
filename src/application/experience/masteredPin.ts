/**
 * Mastered pin (GUARD): frozen skills and high-confidence rules are not
 * overwritten by broader/global drafts. New text may only narrow (iff) or add.
 */

import type { SkillBodyRecord } from "../context/bodyStability.ts";

export type MasteredRule = {
  key: string;
  body: string;
  confidence?: number;
  tags?: string[];
};

export type MasteredPinDecision = {
  allow: boolean;
  reason: string;
  mode: "replace" | "narrow" | "reject" | "create";
};

const MASTERED_CONF = 0.75;

export function isMasteredSkill(rec: SkillBodyRecord | null | undefined): boolean {
  return Boolean(rec && rec.status === "frozen");
}

export function isMasteredRule(rule: MasteredRule | null | undefined): boolean {
  if (!rule?.body?.trim()) return false;
  if ((rule.confidence ?? 0) >= MASTERED_CONF) return true;
  const tags = rule.tags ?? [];
  return tags.includes("mastered") || tags.includes("frozen") || tags.includes("house");
}

/**
 * Decide whether a new skill body may replace an incumbent.
 * Frozen: only allow procedure annotation/narrowing (deopt marks), not wholesale rewrite.
 */
export function gateSkillRewrite(input: {
  incumbent: SkillBodyRecord | null | undefined;
  next: SkillBodyRecord;
}): MasteredPinDecision {
  if (!input.incumbent) {
    return { allow: true, reason: "no incumbent · create", mode: "create" };
  }
  if (!isMasteredSkill(input.incumbent)) {
    return { allow: true, reason: "incumbent not frozen · replace ok", mode: "replace" };
  }
  // Frozen: status must stay frozen; procedure may gain [deopt] marks or binding lifts only.
  if (input.next.status !== "frozen" && input.next.status !== "verified") {
    return {
      allow: false,
      reason: "mastered pin · refuse demoting frozen skill",
      mode: "reject",
    };
  }
  const prev = (input.incumbent.procedure ?? []).map(stripDeopt);
  const next = (input.next.procedure ?? []).map(stripDeopt);
  if (next.length && prev.length && !isNarrowOrAnnotate(prev, next)) {
    return {
      allow: false,
      reason: "mastered pin · refuse broad procedure rewrite on frozen skill",
      mode: "reject",
    };
  }
  return {
    allow: true,
    reason: "mastered pin · narrow/annotate frozen skill",
    mode: "narrow",
  };
}

/**
 * Decide whether a new rule body may replace a mastered rule.
 * Allowed: identical, iff-narrowing, or additive when-clause. Rejected: unrelated global rewrite.
 */
export function gateRuleRewrite(input: {
  incumbent: MasteredRule | null | undefined;
  nextBody: string;
}): MasteredPinDecision {
  if (!input.incumbent || !isMasteredRule(input.incumbent)) {
    return { allow: true, reason: "no mastered incumbent · write ok", mode: "create" };
  }
  const prev = norm(input.incumbent.body);
  const next = norm(input.nextBody);
  if (!next) {
    return { allow: false, reason: "mastered pin · empty rewrite refused", mode: "reject" };
  }
  if (next === prev) {
    return { allow: true, reason: "mastered pin · unchanged", mode: "replace" };
  }
  if (next.startsWith("when ") && (prev.startsWith("when ") ? next.includes(stripWhen(prev)) : next.includes(prev))) {
    return { allow: true, reason: "mastered pin · iff narrow ok", mode: "narrow" };
  }
  if (prev.startsWith("when ") && next.includes(stripWhen(prev))) {
    return { allow: true, reason: "mastered pin · keep scoped core", mode: "narrow" };
  }
  // Completely different directive — refuse clobber.
  if (tokenOverlap(prev, next) < 0.4) {
    return {
      allow: false,
      reason: "mastered pin · refuse clobber of mastered rule",
      mode: "reject",
    };
  }
  return { allow: true, reason: "mastered pin · related update", mode: "replace" };
}

function stripDeopt(step: string): string {
  return step.replace(/\s*\[deopt\]\s*$/i, "").trim();
}

function isNarrowOrAnnotate(prev: string[], next: string[]): boolean {
  // Same multiset of cores, or next is subset, or next only adds [deopt]-style noise already stripped.
  const p = new Set(prev);
  const n = new Set(next);
  let shared = 0;
  for (const step of n) {
    if (p.has(step)) shared += 1;
  }
  if (shared === n.size) return true; // next ⊆ prev (narrow)
  if (shared === p.size && n.size <= p.size + 1) return true;
  return shared / Math.max(p.size, 1) >= 0.7;
}

function norm(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function stripWhen(body: string): string {
  return norm(body).replace(/^when\s+[^:]+:\s*/, "");
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tb = b.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!ta.size || !tb.length) return 0;
  let hit = 0;
  for (const t of tb) {
    if (ta.has(t)) hit += 1;
  }
  return hit / tb.length;
}
