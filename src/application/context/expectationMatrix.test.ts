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

test("softArtifactFromTranscript takes last assistant", () => {
  const text = softArtifactFromTranscript([
    { kind: "user", text: "hi" },
    { kind: "assistant", text: "draft one" },
    { kind: "assistant", text: "final ticket refund next step reply with enough tokens here" },
  ]);
  expect(text).toMatch(/final ticket/);
});
