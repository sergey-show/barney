/**
 * Experience law: write rarely, recall mandatorily, prove on a new task, else drop.
 *
 * Three layers — measure separately. Do not pin everything that PASSes.
 */

export type ExperienceLayer = "episode" | "rule" | "skill";

export type ExperienceWriteKind =
  | "episode_only"
  | "failure_rule"
  | "skill_candidate";

export type ExperienceWriteDecision = {
  kind: ExperienceWriteKind;
  reason: string;
};

/**
 * Decide what may enter the body after a turn.
 * PASS without a distinct recovery → episode only.
 * FAIL with a concrete mode → failure rule.
 * PASS after failed path → different path → skill candidate (quarantine).
 */
export function decideExperienceWrite(input: {
  outcomeOk: boolean;
  recovered: boolean;
  failClass: string;
  structuralFail?: boolean;
  modeRepeatCount?: number;
  hasConcreteDirective?: boolean;
}): ExperienceWriteDecision {
  const klass = input.failClass;
  const usableClass = Boolean(klass && klass !== "general" && klass !== "aborted-unfinished");

  if (input.outcomeOk && input.recovered && usableClass) {
    return {
      kind: "skill_candidate",
      reason: "recovery: failed path then different path succeeded",
    };
  }

  if (!input.outcomeOk && usableClass) {
    const repeats = input.modeRepeatCount ?? 0;
    const structural = input.structuralFail === true;
    const directive = input.hasConcreteDirective !== false;
    if ((repeats >= 2 || structural) && directive) {
      return {
        kind: "failure_rule",
        reason: structural
          ? "structural failure with concrete directive"
          : "failure mode repeated with concrete directive",
      };
    }
  }

  return {
    kind: "episode_only",
    reason: input.outcomeOk
      ? "pass without distinct reusable recovery — episode only"
      : "fail without repeat/structural signal — episode only",
  };
}

export const STRUCTURAL_FAIL_CLASSES = new Set([
  "missing-artifact",
  "masked-deliverable",
  "identification-without-action",
  "unrun-program",
  "secret-leak",
]);
