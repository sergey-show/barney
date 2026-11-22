/**
 * Split failure signals the way GUARD does:
 * - regression: something that used to work was broken (recalled skill/rule misfired)
 * - gap: never solved yet (no useful recall, structural miss, fresh fail)
 *
 * Ranking: regressions outrank gaps when deciding what to write next.
 */

export type EditSignalKind = "regression" | "gap" | "none";

export type EditSignal = {
  kind: EditSignalKind;
  priority: number;
  reason: string;
};

export function classifyEditSignal(input: {
  outcomeOk: boolean;
  recallUsed?: boolean;
  falseSkillCount?: number;
  /** Prior success rate for this class/mode in [0,1], if known. */
  priorSuccessRate?: number;
  structuralFail?: boolean;
}): EditSignal {
  if (input.outcomeOk) {
    return { kind: "none", priority: 0, reason: "outcome ok — no edit signal" };
  }
  const falseSkills = input.falseSkillCount ?? 0;
  if (falseSkills > 0 || input.recallUsed) {
    return {
      kind: "regression",
      priority: 2 + Math.min(3, falseSkills),
      reason: falseSkills
        ? `recalled skill misfired ×${falseSkills}`
        : "recall used but turn failed",
    };
  }
  if ((input.priorSuccessRate ?? 0) >= 0.5) {
    return {
      kind: "regression",
      priority: 2,
      reason: "class previously succeeded — treat fail as regression",
    };
  }
  return {
    kind: "gap",
    priority: input.structuralFail ? 1.5 : 1,
    reason: input.structuralFail
      ? "structural miss — capability gap"
      : "unsolved gap — no working recall to blame",
  };
}

/**
 * Scope a directive with an iff-trigger instead of a global rewrite.
 * Example: "do not invent tokens" + trigger "sanitize secrets"
 * → "when sanitize secrets: do not invent tokens"
 */
export function scopeDirectiveIff(
  directive: string,
  trigger: string,
): string {
  const body = directive.replace(/\s+/g, " ").trim().replace(/^when\s+[^:]+:\s*/i, "");
  const when = trigger.replace(/\s+/g, " ").trim().replace(/:$/, "");
  if (!body) return "";
  if (!when) return body;
  if (/^when\s+/i.test(directive) && directive.includes(":")) return directive.trim();
  return `when ${when}: ${body}`;
}

/** Prefer regression-scoped rules; leave gap rules broader but tagged. */
export function shapeFailureDirective(input: {
  directive: string;
  signal: EditSignal;
  trigger: string;
}): { body: string; tag: string } {
  const raw = input.directive.replace(/\s+/g, " ").trim();
  if (!raw) return { body: "", tag: "empty" };
  if (input.signal.kind === "regression") {
    return {
      body: scopeDirectiveIff(raw, input.trigger),
      tag: "iff-regression",
    };
  }
  if (input.signal.kind === "gap") {
    return {
      body: raw,
      tag: "gap",
    };
  }
  return { body: raw, tag: "none" };
}
