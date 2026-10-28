import { expect, test } from "bun:test";
import {
  looksSoftGoal,
  parseExpectationMatrix,
  resolveExpectations,
  softArtifactFromTranscript,
} from "./expectationMatrix.ts";

test("parseExpectationMatrix reads fenced JSON", () => {
  const goal = `
Reply to the customer.
\`\`\`expectation
{"domain":"text_analytics","requiredEntities":["ticket","refund"],"forbiddenPatterns":["as an ai"],"constraints":{"minTokens":30}}
\`\`\`
`;
  const m = parseExpectationMatrix(goal);
  expect(m?.requiredEntities).toEqual(["ticket", "refund"]);
  expect(m?.constraints.minTokens).toBe(30);
  expect(looksSoftGoal(goal)).toBe(true);
});

test("resolveExpectations ignores plain devops goals", () => {
  expect(resolveExpectations({ goal: "Fix nginx access log and restart" })).toBeNull();
});

test("resolveExpectations ignores bare soft_* tokens without matrix (no invent)", () => {
  expect(resolveExpectations({ goal: "soft_restart the nginx service" })).toBeNull();
  expect(looksSoftGoal("soft_restart the nginx service")).toBe(false);
  expect(resolveExpectations({
    goal: "Handle soft_complaint without fence",
    failClass: "soft-complaint-evasion",
  })).toBeNull();
});

test("resolveExpectations never invents must/deliver defaults", () => {
  const goal = `
Soft domain reply.
\`\`\`expectation
{"domain":"text_analytics","requiredEntities":[],"forbiddenPatterns":[],"constraints":{}}
\`\`\`
`;
  // empty entities+forbidden+constraints → null from normalize
  expect(resolveExpectations({ goal })).toBeNull();
});

test("softArtifactFromTranscript keeps JSON fence content", () => {
  const text = softArtifactFromTranscript([
    { kind: "user", text: "hi" },
    {
      kind: "assistant",
      text: "```thinking\nhidden\n```\nDeliverable:\n```json\n{\"ticket\":\"T-1\",\"refund\":true}\n```",
    },
  ]);
  expect(text).toContain('"ticket"');
  expect(text).not.toContain("hidden");
});

test("softArtifactFromTranscript takes last assistant", () => {
  const text = softArtifactFromTranscript([
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "draft one" },
    { kind: "assistant", text: "final ticket refund next step reply with enough tokens here" },
  ]);
  expect(text).toMatch(/final ticket/);
});
