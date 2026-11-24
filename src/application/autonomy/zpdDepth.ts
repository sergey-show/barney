/**
 * Adaptive ZPD depth — choose soft (OraclePort regex/JSON-schema) vs full
 * (Python proof-F.py) per task, not per failClass prefix.
 *
 * Before this, `isSoftFailClass(failClass)` gated soft ZPD-3 only for
 * explicitly `soft-*` fail classes, so every house-convention or simple
 * formatting drill paid the full Python-proof tax. This selector reads
 * task complexity signals (goal wording, procedure length, expectations
 * matrix, oracle availability) and picks soft when the task is simple
 * enough to verify deterministically, full when it is multi-step or
 * SPI-bound. Conservative default: full (over-verify rather than under-verify).
 */

export type ZpdDepth = "soft" | "full";

const SOFT_GOAL_SIGNALS = [
  /\bhouse[-_ ]convention\b/i,
  /\b(redact|sanitize|mask|redaction)\b.*\btoken/i,
  /\b(canonical|canon)\b.*\bjson\b/i,
  /\bsort\b.*\bkeys\b/i,
  /\bformat(?:ting|ted)?\b/i,
  /\b(checksum|hash|digest)\b/i,
  /\b(newline|indent|trailing)\b/i,
];

const FULL_GOAL_SIGNALS = [
  /\bmulti[-_ ]step\b/i,
  /\bspi[-_ ]provider\b/i,
  /\bmulti[-_ ]file\b/i,
  /\b(pipeline|workflow|orchestrat)/i,
  /\bparse.*binary|binary.*parse\b/i,
  /\b(deploy|rollout|canary)\b/i,
  /\b(refactor|migration)\b/i,
];

export function chooseZpdDepth(input: {
  failClass: string;
  goal: string;
  /** Planned procedure steps, if known at decision time. */
  procedure?: string[];
  /** Explicit ```expectation``` matrix present in the goal. */
  hasExpectationsMatrix?: boolean;
  /** OraclePort available for the domain (soft path usable). */
  hasOracle?: boolean;
}): ZpdDepth {
  // 1. Explicit soft failClass always wins (preserves existing behavior).
  if (/^soft[-_]/i.test(input.failClass.trim())) return "soft";

  // 2. Multi-step / SPI / deploy signals force full regardless of simplicity.
  if (FULL_GOAL_SIGNALS.some((re) => re.test(input.goal))) return "full";
  if ((input.procedure ?? []).length >= 3) return "full";

  // 3. Explicit expectations matrix + available oracle → soft is safe.
  if (input.hasExpectationsMatrix && input.hasOracle) return "soft";

  // 4. Simple house-convention / format-only goals → soft.
  if (SOFT_GOAL_SIGNALS.some((re) => re.test(input.goal))) {
    // But only if an oracle can actually verify; else fall through to full.
    if (input.hasOracle) return "soft";
  }

  // 5. Conservative default: over-verify.
  return "full";
}

/** Whether the soft path is even usable for this task (oracle + matrix or soft failClass). */
export function canSoftZpd(input: {
  failClass: string;
  hasExpectationsMatrix?: boolean;
  hasOracle?: boolean;
}): boolean {
  if (/^soft[-_]/i.test(input.failClass.trim())) return true;
  return Boolean(input.hasExpectationsMatrix && input.hasOracle);
}
