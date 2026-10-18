/**
 * Pilot soft-domain oracle: deterministic structure checks, no second LLM.
 * Embeddings / BERTScore can plug later behind the same OraclePort.
 */

import type { ExpectationMatrix, OracleVerdict } from "../../domain/oracle/Oracle.ts";
import { emptyOracleMarkers } from "../../domain/oracle/Oracle.ts";
import type { OraclePort } from "../../application/ports.ts";

export class TextAnalyticsOracle implements OraclePort {
  verify(artifact: string, expectations: ExpectationMatrix): OracleVerdict {
    const markers = emptyOracleMarkers();
    const logs: string[] = [];
    const text = artifact ?? "";
    const lower = text.toLowerCase();

    for (const entity of expectations.requiredEntities) {
      const needle = entity.trim();
      if (!needle) continue;
      if (!lower.includes(needle.toLowerCase())) {
        markers.structuralMiss = true;
        logs.push(`missing required entity: "${needle}"`);
      }
    }

    for (const pattern of expectations.forbiddenPatterns) {
      const raw = pattern.trim();
      if (!raw) continue;
      try {
        if (new RegExp(raw, "i").test(text)) {
          markers.structuralMiss = true;
          logs.push(`forbidden pattern: /${raw}/i`);
        }
      } catch {
        if (lower.includes(raw.toLowerCase())) {
          markers.structuralMiss = true;
          logs.push(`forbidden literal: "${raw}"`);
        }
      }
    }

    for (const anchor of expectations.constraints.semanticAnchors ?? []) {
      const needle = anchor.trim();
      if (!needle) continue;
      if (!lower.includes(needle.toLowerCase())) {
        markers.structuralMiss = true;
        logs.push(`missing semantic anchor: "${needle}"`);
      }
    }

    const minTokens = expectations.constraints.minTokens;
    if (minTokens != null && minTokens > 0) {
      const tokens = text.trim() ? text.trim().split(/\s+/).length : 0;
      if (tokens < minTokens) {
        markers.laziness = true;
        logs.push(`laziness: ${tokens} tokens < minTokens ${minTokens}`);
      }
    }

    const ok = !markers.structuralMiss && !markers.laziness;
    return {
      ok,
      markers,
      evidence: logs.join("; ") || "all structural constraints satisfied",
    };
  }
}
