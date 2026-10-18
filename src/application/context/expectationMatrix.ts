/**
 * Soft-domain expectation matrix: declared plan before act.
 * Only explicit matrices (or soft-* goals) enable OraclePort — DevOps stays byte-grounded.
 */

import type { ExpectationMatrix, OracleDomain } from "../../domain/oracle/Oracle.ts";

const DOMAINS: OracleDomain[] = ["text_analytics", "api_contract", "legal_compliance", "general"];

export function isSoftFailClass(failClass: string): boolean {
  return /^soft[-_]/i.test(failClass.trim());
}

export function looksSoftGoal(goal: string): boolean {
  if (/```expectations?\b/i.test(goal)) return true;
  if (/\bsoft[-_]domain\b|\bExpectationMatrix\b/i.test(goal)) return true;
  if (/\bsoft[-_][a-z0-9_-]+\b/i.test(goal)) return true;
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

export function resolveExpectations(input: {
  goal: string;
  failClass?: string;
  explicit?: ExpectationMatrix | null;
}): ExpectationMatrix | null {
  if (input.explicit) return input.explicit;
  const fromGoal = parseExpectationMatrix(input.goal);
  if (fromGoal) return fromGoal;
  if (input.failClass && isSoftFailClass(input.failClass) && looksSoftGoal(input.goal)) {
    return defaultSoftMatrix(input.goal);
  }
  if (looksSoftGoal(input.goal)) return defaultSoftMatrix(input.goal);
  return null;
}

/** Soft artifact = last assistant reply (visible text), not shell evidence. */
export function softArtifactFromTranscript(
  items: Array<{ kind: string; text: string }>,
): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind !== "assistant") continue;
    const text = stripFenceNoise(item.text).trim();
    if (text.length > 0) return text;
  }
  return "";
}

function defaultSoftMatrix(goal: string): ExpectationMatrix {
  const entities = extractQuotedOrBacktick(goal).slice(0, 8);
  const forbidden = [/as an ai/i.test(goal) ? "as an ai" : null].filter(Boolean) as string[];
  return {
    domain: "text_analytics",
    requiredEntities: entities.length ? entities : ["must", "deliver"],
    forbiddenPatterns: forbidden.length ? forbidden : ["as an ai", "i cannot help"],
    constraints: {
      minTokens: 40,
      semanticAnchors: entities.slice(0, 2),
    },
  };
}

function normalizeMatrix(parsed: Record<string, unknown>): ExpectationMatrix | null {
  const required = asStringList(
    parsed.requiredEntities ?? parsed.required_entities ?? parsed.entities,
  );
  const forbidden = asStringList(
    parsed.forbiddenPatterns ?? parsed.forbidden_patterns ?? parsed.forbidden,
  );
  if (!required.length && !forbidden.length && !parsed.constraints) return null;
  const domainRaw = String(parsed.domain ?? "text_analytics");
  const domain = (DOMAINS.includes(domainRaw as OracleDomain) ? domainRaw : "general") as OracleDomain;
  const constraintsRaw = (parsed.constraints ?? {}) as Record<string, unknown>;
  const minTokens = Number(
    constraintsRaw.minTokens ?? constraintsRaw.min_tokens ?? constraintsRaw.min_fact_density ?? 0,
  );
  return {
    domain,
    requiredEntities: required,
    forbiddenPatterns: forbidden,
    constraints: {
      minTokens: Number.isFinite(minTokens) && minTokens > 0 ? minTokens : undefined,
      semanticAnchors: asStringList(
        constraintsRaw.semanticAnchors ?? constraintsRaw.semantic_anchors,
      ),
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

function extractQuotedOrBacktick(goal: string): string[] {
  const out: string[] = [];
  for (const match of goal.matchAll(/`([^`]+)`|"([^"]+)"/g)) {
    const token = (match[1] ?? match[2] ?? "").trim();
    if (token.length >= 3 && token.length <= 40) out.push(token);
  }
  return [...new Set(out)];
}

function stripFenceNoise(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ");
}
