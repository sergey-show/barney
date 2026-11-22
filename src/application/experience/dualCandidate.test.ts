import { expect, test } from "bun:test";
import { admitByContrast, contrastCandidates } from "./dualCandidate.ts";

test("contrastCandidates prefers evidence-aligned draft", () => {
  const result = contrastCandidates({
    a: {
      id: "vague",
      body: "be careful always",
      confidence: 0.4,
    },
    b: {
      id: "scoped",
      body: "when sanitize secrets: replace live tokens then write audit.txt and verify with grep",
      confidence: 0.5,
    },
    evidence: "sanitize secrets audit.txt grep DETECTED_SECRET",
    signal: { kind: "regression", priority: 2, reason: "misfire" },
  });
  expect(result.winner.id).toBe("scoped");
  expect(result.line).toContain("dual_candidate:");
});

test("admitByContrast keeps incumbent on tie/weaker challenger", () => {
  const decision = admitByContrast({
    incumbent: {
      id: "incumbent",
      body: "when sanitize secrets: use house tokens only",
      confidence: 0.8,
    },
    challenger: {
      id: "challenger",
      body: "try something else",
      confidence: 0.3,
    },
    evidence: "sanitize secrets house tokens",
    signal: { kind: "regression", priority: 2, reason: "misfire" },
  });
  expect(decision.replace).toBe(false);
  expect(decision.winner.id).toBe("incumbent");
});
