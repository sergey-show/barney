/**
 * api_contract domain: artifact must be JSON matching a declared JSON Schema subset.
 * Schema lives in ExpectationMatrix via requiredEntities as property names and
 * constraints.semanticAnchors unused; full schema JSON can be passed as the first
 * requiredEntities entry prefixed with "schema:" (base64) — prefer fenced matrix field.
 *
 * Minimal subset: type object, required[], properties with type string|number|boolean|object|array.
 */

import type { ExpectationMatrix, OracleVerdict } from "../../domain/oracle/Oracle.ts";
import { emptyOracleMarkers } from "../../domain/oracle/Oracle.ts";
import type { OraclePort } from "../../application/ports.ts";

export type JsonSchemaLite = {
  type?: string;
  required?: string[];
  properties?: Record<string, { type?: string }>;
};

export class JsonSchemaOracle implements OraclePort {
  verify(artifact: string, expectations: ExpectationMatrix): OracleVerdict {
    const markers = emptyOracleMarkers();
    const schema = schemaFromExpectations(expectations);
    if (!schema) {
      markers.structuralMiss = true;
      return { ok: false, markers, evidence: "api_contract: missing JSON schema in matrix" };
    }
    const json = extractJson(artifact);
    if (!json) {
      markers.structuralMiss = true;
      markers.laziness = artifact.trim().split(/\s+/).filter(Boolean).length < 8;
      return { ok: false, markers, evidence: "api_contract: artifact is not JSON" };
    }
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch (err) {
      markers.structuralMiss = true;
      return {
        ok: false,
        markers,
        evidence: `api_contract: JSON parse error · ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const issues = validateLite(value, schema);
    if (issues.length) {
      markers.structuralMiss = true;
      return { ok: false, markers, evidence: `api_contract: ${issues.slice(0, 4).join("; ")}` };
    }
    return { ok: true, markers, evidence: "api_contract: schema satisfied" };
  }
}

export function schemaFromExpectations(expectations: ExpectationMatrix): JsonSchemaLite | null {
  const fromEntity = expectations.requiredEntities.find((e) => e.startsWith("schema:"));
  if (fromEntity) {
    try {
      return JSON.parse(fromEntity.slice("schema:".length)) as JsonSchemaLite;
    } catch {
      return null;
    }
  }
  // Convention: requiredEntities = required property names; domain api_contract
  if (expectations.domain !== "api_contract" && !expectations.requiredEntities.length) return null;
  if (!expectations.requiredEntities.length) return null;
  const properties: Record<string, { type: string }> = {};
  for (const name of expectations.requiredEntities) {
    if (name.startsWith("schema:")) continue;
    properties[name] = { type: "string" };
  }
  return {
    type: "object",
    required: Object.keys(properties),
    properties,
  };
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  const a0 = text.indexOf("[");
  const a1 = text.lastIndexOf("]");
  if (a0 >= 0 && a1 > a0) return text.slice(a0, a1 + 1);
  return null;
}

function validateLite(value: unknown, schema: JsonSchemaLite): string[] {
  const issues: string[] = [];
  if (schema.type === "object" || schema.required || schema.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return ["expected object"];
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) issues.push(`missing required property: "${key}"`);
    }
    for (const [key, prop] of Object.entries(schema.properties ?? {})) {
      if (!(key in obj)) continue;
      const t = prop.type;
      if (!t) continue;
      const v = obj[key];
      if (t === "string" && typeof v !== "string") issues.push(`"${key}" expected string`);
      if (t === "number" && typeof v !== "number") issues.push(`"${key}" expected number`);
      if (t === "boolean" && typeof v !== "boolean") issues.push(`"${key}" expected boolean`);
      if (t === "object" && (!v || typeof v !== "object" || Array.isArray(v))) {
        issues.push(`"${key}" expected object`);
      }
      if (t === "array" && !Array.isArray(v)) issues.push(`"${key}" expected array`);
    }
  }
  return issues;
}
