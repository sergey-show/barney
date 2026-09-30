/**
 * ZPD-3 executable proof: fail the old path, pass the new — review-by-result for drills.
 * Script must emit both markers on stdout (kernel checks transcript/evidence).
 */

export const ZPD_FAIL_MARK = "ZPD_PROOF fail=1";
export const ZPD_PASS_MARK = "ZPD_PROOF pass=1";

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
