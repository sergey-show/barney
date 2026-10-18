/**
 * ZPD-3 executable proof: fail the old path, pass the new — review-by-result for drills.
 * DevOps path: script must emit both markers on stdout (kernel checks transcript/evidence).
 * Soft path: OraclePort verifies fail/pass artifacts; same marker strings for SkillsLock.
 */

import type { ExpectationMatrix } from "../../domain/oracle/Oracle.ts";
import { formatOracleEvidence } from "../../domain/oracle/Oracle.ts";
import type { OraclePort } from "../ports.ts";

export const ZPD_FAIL_MARK = "ZPD_PROOF fail=1";
export const ZPD_PASS_MARK = "ZPD_PROOF pass=1";

/** Soft ZPD-3 harness: adversarial pair + declared matrix (no .py required). */
export type SoftZpdHarness = {
  failClass: string;
  failArtifact: string;
  passArtifact: string;
  expectations: ExpectationMatrix;
  recoveryNote?: string;
};

export function zpd3ProofPath(failClass: string): string {
  const safe = failClass.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "general";
  return `proof-${safe}.py`;
}

export function zpd3RecoveryPath(failClass: string): string {
  const safe = failClass.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "general";
  return `recovery-${safe}.md`;
}

export type Zpd3ProofVerdict = {
  ok: boolean;
  reason: string;
  hasScript: boolean;
  failShown: boolean;
  passShown: boolean;
};

export type SoftZpdVerdict = Zpd3ProofVerdict & {
  evidenceLine: string;
  failOracleOk: boolean;
  passOracleOk: boolean;
};

/**
 * Soft ZPD-3 gate: oracle must reject failArtifact and accept passArtifact.
 * Emits the same ZPD_PROOF markers so SkillsLock / agenda stay domain-agnostic.
 */
export function judgeSoftZpd3(
  oracle: OraclePort,
  harness: SoftZpdHarness,
): SoftZpdVerdict {
  const failV = oracle.verify(harness.failArtifact, harness.expectations);
  const passV = oracle.verify(harness.passArtifact, harness.expectations);
  const oldFails = !failV.ok;
  const newPasses = passV.ok;
  const hasRecovery = Boolean(harness.recoveryNote?.trim());
  const evidenceLine = [
    oldFails ? ZPD_FAIL_MARK : null,
    newPasses ? ZPD_PASS_MARK : null,
    formatOracleEvidence({
      ...failV,
      markers: { ...failV.markers, zpdFail: oldFails, zpdPass: false },
    }),
    formatOracleEvidence({
      ...passV,
      markers: { ...passV.markers, zpdFail: false, zpdPass: newPasses },
    }),
  ].filter(Boolean).join("\n");

  if (!hasRecovery) {
    return {
      ok: false,
      reason: `missing recovery note for ${harness.failClass}`,
      hasScript: true,
      failShown: oldFails,
      passShown: newPasses,
      evidenceLine,
      failOracleOk: failV.ok,
      passOracleOk: passV.ok,
    };
  }
  if (!oldFails) {
    return {
      ok: false,
      reason: `fail arm did not fail under oracle (${ZPD_FAIL_MARK})`,
      hasScript: true,
      failShown: false,
      passShown: newPasses,
      evidenceLine,
      failOracleOk: failV.ok,
      passOracleOk: passV.ok,
    };
  }
  if (!newPasses) {
    return {
      ok: false,
      reason: `pass arm did not pass under oracle (${ZPD_PASS_MARK})`,
      hasScript: true,
      failShown: true,
      passShown: false,
      evidenceLine,
      failOracleOk: failV.ok,
      passOracleOk: passV.ok,
    };
  }
  return {
    ok: true,
    reason: "oracle fail→pass proven",
    hasScript: true,
    failShown: true,
    passShown: true,
    evidenceLine,
    failOracleOk: failV.ok,
    passOracleOk: passV.ok,
  };
}

/** Kernel gate: ZPD-3 done only if script exists and both proof markers appear. */
export function judgeZpd3Proof(input: {
  failClass: string;
  evidence: string;
  goal?: string;
}): Zpd3ProofVerdict {
  const script = zpd3ProofPath(input.failClass);
  const recovery = zpd3RecoveryPath(input.failClass);
  const blob = `${input.goal ?? ""}\n${input.evidence}`;
  const hasScript = evidenceWrote(blob, script) || blob.includes(script);
  const hasRecovery = evidenceWrote(blob, recovery) || blob.includes(recovery);
  const failShown = blob.includes(ZPD_FAIL_MARK);
  const passShown = blob.includes(ZPD_PASS_MARK);
  if (!hasScript) {
    return {
      ok: false,
      reason: `missing executable proof ${script}`,
      hasScript: false,
      failShown,
      passShown,
    };
  }
  if (!hasRecovery) {
    return {
      ok: false,
      reason: `missing ${recovery}`,
      hasScript: true,
      failShown,
      passShown,
    };
  }
  if (!failShown) {
    return {
      ok: false,
      reason: `proof did not show old-path fail (${ZPD_FAIL_MARK})`,
      hasScript: true,
      failShown: false,
      passShown,
    };
  }
  if (!passShown) {
    return {
      ok: false,
      reason: `proof did not show new-path pass (${ZPD_PASS_MARK})`,
      hasScript: true,
      failShown: true,
      passShown: false,
    };
  }
  return {
    ok: true,
    reason: "fail+pass markers present",
    hasScript: true,
    failShown: true,
    passShown: true,
  };
}

function evidenceWrote(evidence: string, path: string): boolean {
  const base = path.split("/").filter(Boolean).at(-1) ?? path;
  const patterns = [
    new RegExp(`(?:wrote|write|created|saved|fs_write)[^\\n]{0,80}${escapeReg(base)}`, "i"),
    new RegExp(`(?:path|file)[=:\\s]+[^\\n]*${escapeReg(base)}`, "i"),
    new RegExp(`\`${escapeReg(base)}\``),
  ];
  return patterns.some((re) => re.test(evidence));
}

function escapeReg(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
