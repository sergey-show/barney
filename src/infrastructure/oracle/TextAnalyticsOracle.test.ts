import { expect, test } from "bun:test";
import { TextAnalyticsOracle } from "./TextAnalyticsOracle.ts";
import type { ExpectationMatrix } from "../../domain/oracle/Oracle.ts";

const matrix: ExpectationMatrix = {
  domain: "text_analytics",
  requiredEntities: ["ticket", "refund"],
  forbiddenPatterns: ["as an ai"],
  constraints: { minTokens: 20, semanticAnchors: ["next step"] },
};

test("TextAnalyticsOracle flags missing entities and laziness", () => {
  const oracle = new TextAnalyticsOracle();
  const thin = oracle.verify("ok", matrix);
  expect(thin.ok).toBe(false);
  expect(thin.markers.laziness).toBe(true);
  expect(thin.markers.structuralMiss).toBe(true);
});

test("TextAnalyticsOracle rejects forbidden lubrication", () => {
  const oracle = new TextAnalyticsOracle();
  const text = [
    "As an AI I cannot process this. Please open a ticket for your refund.",
    "Next step is unclear but we care deeply about your feelings today forever.",
  ].join(" ");
  const v = oracle.verify(text, matrix);
  expect(v.ok).toBe(false);
  expect(v.markers.structuralMiss).toBe(true);
  expect(v.evidence).toMatch(/forbidden/i);
});

test("TextAnalyticsOracle accepts structured reply", () => {
  const oracle = new TextAnalyticsOracle();
  const text = [
    "Ticket T-9 covers your refund.",
    "We will update you under SLA within one business day.",
    "Next step: reply with the order number so finance can finish the transfer.",
  ].join(" ");
  const v = oracle.verify(text, matrix);
  expect(v.ok).toBe(true);
  expect(v.markers.structuralMiss).toBe(false);
  expect(v.markers.laziness).toBe(false);
});
