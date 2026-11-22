/**
 * Soft-HURT gate: promote a durable body write only when gain beats hurt.
 * Rejection ledger blocks near-identical resubmits of refused pins.
 *
 * Inspired by regret-guided harness promotion: do not ship an edit that
 * buys a local win by regressing what already worked.
 */

import { createHash } from "node:crypto";
import type { ExperienceWriteKind } from "./experienceLayers.ts";
import type { BodyWriteMode } from "./bodyAdmission.ts";

export const REJECTION_LEDGER_KEY = "admission/rejection-ledger";
export const SOFT_HURT_NOISE_FLOOR = 0.05;

export type SoftHurtScores = {
  gain: number;
  hurt: number;
  net: number;
};

export type SoftHurtDecision = {
  admit: boolean;
  reason: string;
  scores: SoftHurtScores;
  blockedResubmit: boolean;
};

export type RejectionLedgerEntry = {
  fingerprint: string;
  writeKind: ExperienceWriteKind | string;
  reason: string;
  at: string;
};

export type RejectionLedger = {
  entries: RejectionLedgerEntry[];
};

export function scoreSoftHurt(input: {
  outcomeOk: boolean;
  recovered?: boolean;
  pinConvention?: boolean;
  predictionError?: 0 | 1;
  structuralFail?: boolean;
  /** Recalled verified skill used but turn failed. */
  falseSkillCount?: number;
  /** Recall was used but outcome failed (rule/skill misfire). */
  recallUsedButFailed?: boolean;
}): SoftHurtScores {
  let gain = 0;
  let hurt = 0;
  if (input.outcomeOk) {
    gain += 0.55;
    if (input.recovered) gain += 0.25;
    if (input.pinConvention) gain += 0.2;
    if (input.predictionError === 1) gain += 0.1;
  } else {
    hurt += 0.35;
    if (input.structuralFail) gain += 0.25; // learning signal, not collateral
    if (input.predictionError === 1) gain += 0.2;
    if (input.recallUsedButFailed) hurt += 0.35;
    hurt += Math.min(0.4, (input.falseSkillCount ?? 0) * 0.2);
  }
  gain = clamp01(gain);
  hurt = clamp01(hurt);
  return { gain, hurt, net: gain - hurt };
}

export function softHurtDecide(input: {
  priorAdmit: boolean;
  scores: SoftHurtScores;
  mode?: BodyWriteMode;
  noiseFloor?: number;
  blockedResubmit?: boolean;
}): SoftHurtDecision {
  const floor = input.noiseFloor ?? SOFT_HURT_NOISE_FLOOR;
  if (input.blockedResubmit) {
    return {
      admit: false,
      reason: "soft-hurt · blocked resubmit of recently rejected pin",
      scores: input.scores,
      blockedResubmit: true,
    };
  }
  if (!input.priorAdmit) {
    return {
      admit: false,
      reason: "soft-hurt · prior admission already refused",
      scores: input.scores,
      blockedResubmit: false,
    };
  }
  // Ablation mode: skip net-gain filter so matched-budget contrast stays clean.
  if (input.mode === "selfreport") {
    return {
      admit: true,
      reason: "soft-hurt · skipped in selfreport mode",
      scores: input.scores,
      blockedResubmit: false,
    };
  }
  if (input.scores.net > floor) {
    return {
      admit: true,
      reason: `soft-hurt · net ${input.scores.net.toFixed(2)} > ${floor}`,
      scores: input.scores,
      blockedResubmit: false,
    };
  }
  return {
    admit: false,
    reason:
      `soft-hurt · refuse gain ${input.scores.gain.toFixed(2)}`
      + ` ≤ hurt ${input.scores.hurt.toFixed(2)} + floor ${floor}`,
    scores: input.scores,
    blockedResubmit: false,
  };
}

export function writeFingerprint(
  writeKind: string,
  body: string,
  failClass?: string,
): string {
  const norm = `${writeKind}|${failClass ?? ""}|${body.replace(/\s+/g, " ").trim().slice(0, 240)}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function parseRejectionLedger(raw: string | null | undefined): RejectionLedger {
  if (!raw?.trim()) return { entries: [] };
  try {
    const parsed = JSON.parse(raw) as RejectionLedger;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return {
      entries: parsed.entries
        .filter((row) => row && typeof row.fingerprint === "string")
        .slice(0, 80),
    };
  } catch {
    return { entries: [] };
  }
}

export function appendRejection(
  ledger: RejectionLedger,
  entry: RejectionLedgerEntry,
): RejectionLedger {
  const without = ledger.entries.filter((row) => row.fingerprint !== entry.fingerprint);
  return { entries: [entry, ...without].slice(0, 80) };
}

/** Block identical pin if rejected within the last `withinHours` (default 24). */
export function isResubmitBlocked(
  ledger: RejectionLedger,
  fingerprint: string,
  now: Date = new Date(),
  withinHours = 24,
): boolean {
  const hit = ledger.entries.find((row) => row.fingerprint === fingerprint);
  if (!hit) return false;
  const at = Date.parse(hit.at);
  if (!Number.isFinite(at)) return true;
  return (now.getTime() - at) / 3_600_000 <= withinHours;
}

export function formatRejectionLedger(ledger: RejectionLedger): string {
  return JSON.stringify(ledger);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
