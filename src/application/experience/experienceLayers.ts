/**
 * Experience law: write rarely, recall mandatorily, prove on a new task, else drop.
 *
 * Three layers — measure separately. Do not pin everything that PASSes.
 */

export type ExperienceLayer = "episode" | "rule" | "skill";

export type ExperienceWriteKind =
  | "episode_only"
  | "failure_rule"
  | "skill_candidate"
  | "lesson_pin";

export type ExperienceWriteDecision = {
  kind: ExperienceWriteKind;
  reason: string;
};

/**
 * Decide what may enter the body after a turn.
 * Metaplasticity + prediction error (fayr): prefer writes when expectation failed.
 */
export function decideExperienceWrite(input: {
  outcomeOk: boolean;
  recovered: boolean;
  failClass: string;
  structuralFail?: boolean;
  modeRepeatCount?: number;
  hasConcreteDirective?: boolean;
  /** Distinct reusable convention stated in the successful path (house tokens/canon). */
  pinConvention?: boolean;
  /** 0..1 from plasticWritePressure — alters fail write threshold. */
  plasticPressure?: number;
  /** 1 when turn had prediction error — required for most pins. */
  predictionError?: 0 | 1;
}): ExperienceWriteDecision {
  const klass = input.failClass;
  const usableClass = Boolean(klass && klass !== "general" && klass !== "aborted-unfinished");
  const pressure = input.plasticPressure ?? 0.4;
  const pe = input.predictionError ?? (input.recovered || input.structuralFail ? 1 : 0);

  if (input.outcomeOk && input.recovered && usableClass && pe === 1) {
    return {
      kind: "skill_candidate",
      reason: "prediction error then recovery — procedural candidate",
    };
  }

  if (input.outcomeOk && input.pinConvention) {
    return {
      kind: "lesson_pin",
      reason: "successful path pinned a house convention for transfer",
    };
  }

  if (!input.outcomeOk && usableClass) {
    if (pe !== 1 && !input.structuralFail) {
      return {
        kind: "episode_only",
        reason: "no prediction error — episode only",
      };
    }
    const repeats = input.modeRepeatCount ?? 0;
    const structural = input.structuralFail === true;
    const directive = input.hasConcreteDirective !== false;
    const repeatNeed = pressure >= 0.7 ? 1 : pressure <= 0.2 ? 3 : 2;
    if (pressure <= 0.2 && !structural) {
      return {
        kind: "episode_only",
        reason: "low plastic pressure — suppress non-structural rule writes",
      };
    }
    if ((repeats >= repeatNeed || structural) && directive) {
      return {
        kind: "failure_rule",
        reason: structural
          ? "structural prediction error with concrete directive"
          : `prediction error×${repeats} (need ${repeatNeed} @ pressure ${pressure.toFixed(2)})`,
      };
    }
  }

  return {
    kind: "episode_only",
    reason: input.outcomeOk
      ? pe === 1 && !input.recovered
        ? "prediction error without distinct recovery — episode only"
        : "pass without distinct reusable recovery — episode only"
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
