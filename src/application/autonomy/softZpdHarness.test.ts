import { expect, test } from "bun:test";
import { parseSoftZpdHarness } from "./softZpdHarness.ts";
import { judgeSoftZpd3 } from "./zpdProof.ts";
import { TextAnalyticsOracle } from "../../infrastructure/oracle/TextAnalyticsOracle.ts";

test("parseSoftZpdHarness + judgeSoftZpd3 end-to-end", () => {
  const harnessJson = {
    failArtifact: "As an AI I cannot help.",
    passArtifact: [
      "Ticket T-1 covers your refund under SLA.",
      "Next step: reply with the order id so we can finish within four hours.",
      "We stay on the operational path without arguing tone.",
    ].join(" "),
    expectations: {
      domain: "text_analytics",
      requiredEntities: ["ticket", "refund", "sla"],
      forbiddenPatterns: ["as an ai"],
      constraints: { minTokens: 30, semanticAnchors: ["next step"] },
    },
    recoveryNote: "Require ticket/refund/sla; ban AI lubrication.",
  };
  const blob = `assistant: wrote soft-zpd-soft-complaint.json\n\`\`\`json\n${JSON.stringify(harnessJson)}\n\`\`\`\n## What failed\nbad reply`;
  const harness = parseSoftZpdHarness(blob, "soft-complaint-evasion");
  expect(harness).not.toBeNull();
  const verdict = judgeSoftZpd3(new TextAnalyticsOracle(), harness!);
  expect(verdict.ok).toBe(true);
  expect(verdict.evidenceLine).toMatch(/ZPD_PROOF fail=1/);
  expect(verdict.evidenceLine).toMatch(/ZPD_PROOF pass=1/);
});
