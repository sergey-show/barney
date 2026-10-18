/**
 * Soft-domain expectation matrix: declared plan before act.
 * Only explicit / fenced matrices enable OraclePort — DevOps stays byte-grounded.
 * Never invent default entities (must/deliver).
 */

import type { ExpectationMatrix, OracleDomain } from "../../domain/oracle/Oracle.ts";

const DOMAINS: OracleDomain[] = ["text_analytics", "api_contract", "legal_compliance", "general"];

export function isSoftFailClass(failClass: string): boolean {
  return /^soft[-_]/i.test(failClass.trim());
}

/** Soft path activates only with a declared matrix fence or soft-domain keywords — not bare soft_* tokens. */
export function looksSoftGoal(goal: string): boolean {
  if (/```expectations?\b/i.test(goal)) return true;
  if (/\bsoft[-_]domain\b|\bExpectationMatrix\b/i.test(goal)) return true;
  return false;
}

/** Parse ```expectation JSON ``` or a bare JSON object with requiredEntities. */
export function parseExpectationMatrix(text: string): ExpectationMatrix | null {
  const fenced = text.match(/```expectations?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? extractJsonObject(text) ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeMatrix(parsed);
  } catch {
    return null;
  }
}

/**
 * Resolve matrix for a run. Soft failClass alone never invents a matrix —
 * callers must supply ```expectation``` or an explicit matrix.
 */
export function resolveExpectations(input: {
  goal: string;
  failClass?: string;
  explicit?: ExpectationMatrix | null;
}): ExpectationMatrix | null {
  if (input.explicit) return input.explicit;
  const fromGoal = parseExpectationMatrix(input.goal);
  if (fromGoal) return fromGoal;
  return null;
}

/**
 * Soft artifact = last assistant reply.
 * Strip thinking fences only — keep JSON/code fences (deliverables).
 */
export function softArtifactFromTranscript(
  items: Array<{ kind: string; text: string }>,
): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== "assistant") continue;
    const text = stripThinkingFences(item.text).trim();
    if (text.length > 0) return text;
  }
  return "";
}

function normalizeMatrix(parsed: Record<string, unknown>): ExpectationMatrix | null {
  const required = asStringList(
    parsed.requiredEntities ?? parsed.required_entities ?? parsed.entities,
  );
  const forbidden = asStringList(
    parsed.forbiddenPatterns ?? parsed.forbidden_patterns ?? parsed.forbidden,
  );
  const domainRaw = String(parsed.domain ?? "text_analytics");
  const domain = (DOMAINS.includes(domainRaw as OracleDomain) ? domainRaw : "general") as OracleDomain;
  const constraintsRaw = (parsed.constraints ?? {}) as Record<string, unknown>;
  const minTokens = Number(
    constraintsRaw.minTokens ?? constraintsRaw.min_tokens ?? constraintsRaw.min_fact_density ?? 0,
  );
  const semanticAnchors = asStringList(
    constraintsRaw.semanticAnchors ?? constraintsRaw.semantic_anchors,
  );
  const min = Number.isFinite(minTokens) && minTokens > 0 ? minTokens : undefined;
  if (!required.length && !forbidden.length && !min && !semanticAnchors.length) return null;
  return {
    domain,
    requiredEntities: required,
    forbiddenPatterns: forbidden,
    constraints: {
      minTokens: min,
      semanticAnchors,
    },
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function stripThinkingFences(text: string): string {
  return text
    .replace(/```(?:thinking|reasoning|thought|scratchpad)[\s\S]*?```/gi, " ")
    .replace(/\s+/g, " ");
}
