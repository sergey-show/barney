/**
 * Soft-domain grounding for the immune Core.
 * Body may propose expectations and artifacts; only an OraclePort may set PE/ZPD markers.
 * No LLM weights here — implementations stay deterministic or call external APIs.
 */

export type OracleDomain = "text_analytics" | "api_contract" | "legal_compliance" | "general";

/** Declared plan before act — what must hold in the artifact. */
export type ExpectationMatrix = {
  domain: OracleDomain;
  requiredEntities: string[];
  forbiddenPatterns: string[];
  constraints: {
    /** Minimum whitespace-separated tokens (anti-laziness floor). */
    minTokens?: number;
    /** Optional anchor phrases that must survive paraphrasing. */
    semanticAnchors?: string[];
  };
};

export type OracleMarkers = {
  /** Old path failed under the oracle (ZPD-3 fail arm). */
  zpdFail: boolean;
  /** New path passed under the oracle (ZPD-3 pass arm). */
  zpdPass: boolean;
  /** Required structure / entities / anchors missing. */
  structuralMiss: boolean;
  /** Artifact too thin vs declared constraints. */
  laziness: boolean;
};

export type OracleVerdict = {
  ok: boolean;
  markers: OracleMarkers;
  /** Deterministic log: diffs, regex hits, API statuses — never model prose. */
  evidence: string;
};

export function emptyOracleMarkers(): OracleMarkers {
  return { zpdFail: false, zpdPass: false, structuralMiss: false, laziness: false };
}

export function formatOracleEvidence(verdict: OracleVerdict): string {
  const flags = [
    verdict.markers.structuralMiss ? "STRUCTURAL_MISS=1" : null,
    verdict.markers.laziness ? "LAZINESS=1" : null,
    verdict.markers.zpdFail ? "ZPD_FAIL=1" : null,
    verdict.markers.zpdPass ? "ZPD_PASS=1" : null,
  ].filter(Boolean);
  return `oracle: ok=${verdict.ok ? 1 : 0}${flags.length ? ` · ${flags.join(" ")}` : ""} · ${verdict.evidence}`;
}
