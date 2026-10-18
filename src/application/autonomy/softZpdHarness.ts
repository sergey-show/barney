/**
 * Parse soft ZPD-3 harness JSON from transcript/evidence (agent-authored file content).
 */

import type { ExpectationMatrix } from "../../domain/oracle/Oracle.ts";
import { parseExpectationMatrix } from "../context/expectationMatrix.ts";
import type { SoftZpdHarness } from "./zpdProof.ts";

export function parseSoftZpdHarness(blob: string, failClass: string): SoftZpdHarness | null {
  const fenced = blob.match(/```(?:json)?\s*(\{[\s\S]*?"failArtifact"[\s\S]*?\})\s*```/i);
  const fromFence = fenced?.[1];
  const candidates = [
    fromFence,
    extractHarnessObject(blob),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const failArtifact = String(parsed.failArtifact ?? parsed.fail_artifact ?? "").trim();
      const passArtifact = String(parsed.passArtifact ?? parsed.pass_artifact ?? "").trim();
      if (!failArtifact || !passArtifact) continue;
      const expectations =
        normalizeExpectations(parsed.expectations)
        ?? parseExpectationMatrix(JSON.stringify(parsed.expectations ?? {}))
        ?? null;
      if (!expectations) continue;
      const recoveryNote = String(
        parsed.recoveryNote ?? parsed.recovery_note ?? extractRecovery(blob, failClass) ?? "",
      ).trim();
      return {
        failClass,
        failArtifact,
        passArtifact,
        expectations,
        recoveryNote: recoveryNote || `recovery for ${failClass}`,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizeExpectations(value: unknown): ExpectationMatrix | null {
  if (!value || typeof value !== "object") return null;
  return parseExpectationMatrix(JSON.stringify(value));
}

function extractHarnessObject(blob: string): string | null {
  const key = blob.search(/"failArtifact"\s*:/);
  if (key < 0) return null;
  let start = key;
  while (start > 0 && blob[start] !== "{") start -= 1;
  if (blob[start] !== "{") return null;
  let depth = 0;
  for (let i = start; i < blob.length; i++) {
    const ch = blob[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return blob.slice(start, i + 1);
    }
  }
  return null;
}

function extractRecovery(blob: string, failClass: string): string | null {
  const name = `recovery-${failClass}`;
  if (!blob.includes(name) && !/## What failed/i.test(blob)) return null;
  const section = blob.match(/## What failed[\s\S]{0,800}/i);
  return section?.[0]?.slice(0, 400) ?? `soft recovery ${failClass}`;
}
