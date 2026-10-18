import { expect, test } from "bun:test";
import { JsonSchemaOracle } from "./JsonSchemaOracle.ts";
import type { ExpectationMatrix } from "../../domain/oracle/Oracle.ts";

const matrix: ExpectationMatrix = {
  domain: "api_contract",
  requiredEntities: ["id", "status"],
  forbiddenPatterns: [],
  constraints: {},
};

test("JsonSchemaOracle accepts matching JSON object", () => {
  const oracle = new JsonSchemaOracle();
  const v = oracle.verify('```json\n{"id":"1","status":"ok"}\n```', matrix);
  expect(v.ok).toBe(true);
});

test("JsonSchemaOracle rejects missing properties", () => {
  const oracle = new JsonSchemaOracle();
  const v = oracle.verify('{"id":"1"}', matrix);
  expect(v.ok).toBe(false);
  expect(v.evidence).toMatch(/missing required property: "status"/);
});

test("JsonSchemaOracle rejects non-JSON", () => {
  const oracle = new JsonSchemaOracle();
  const v = oracle.verify("not json at all", matrix);
  expect(v.ok).toBe(false);
  expect(v.markers.structuralMiss).toBe(true);
});
