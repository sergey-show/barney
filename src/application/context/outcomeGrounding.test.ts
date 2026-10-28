import { expect, test } from "bun:test";
import type { OraclePort } from "../ports.ts";
import type { ExpectationMatrix, OracleVerdict } from "../../domain/oracle/Oracle.ts";
import type { Review } from "../../domain/run/Review.ts";
import {
  applyOracleToReview,
  groundWithOracle,
  resolveOutcomeOk,
  resolveReviewFailForPe,
} from "./outcomeGrounding.ts";

const matrix: ExpectationMatrix = {
  domain: "text_analytics",
  requiredEntities: ["ticket"],
  forbiddenPatterns: [],
  constraints: { minTokens: 5 },
};

const passReview: Review = {
  verdict: "pass",
  summary: "looks good",
  needsResearch: false,
};

function oracle(ok: boolean): OraclePort {
  return {
    verify(): OracleVerdict {
      return {
        ok,
        markers: {
          zpdFail: false,
          zpdPass: false,
          structuralMiss: !ok,
          laziness: false,
        },
        evidence: ok ? "ok" : "missing required entity: \"ticket\"",
      };
    },
  };
}

test("groundWithOracle forces review fail when oracle rejects", () => {
  const goal = `Reply\n\`\`\`expectation\n${JSON.stringify(matrix)}\n\`\`\``;
  const g = groundWithOracle({
    oracle: oracle(false),
    goal,
    transcript: [{ kind: "assistant", text: "thin" }],
    review: passReview,
  });
  expect(g.expectations).not.toBeNull();
  expect(g.verdict?.ok).toBe(false);
  expect(g.review.verdict).toBe("fail");
  expect(g.evidenceLine).toMatch(/^oracle:/);
});

test("groundWithOracle leaves devops review untouched without matrix", () => {
  const g = groundWithOracle({
    oracle: oracle(false),
    goal: "restart nginx",
    transcript: [{ kind: "assistant", text: "done" }],
    review: passReview,
  });
  expect(g.expectations).toBeNull();
  expect(g.review.verdict).toBe("pass");
});

test("applyOracleToReview is no-op when ok", () => {
  const v: OracleVerdict = {
    ok: true,
    markers: { zpdFail: false, zpdPass: false, structuralMiss: false, laziness: false },
    evidence: "ok",
  };
  expect(applyOracleToReview(passReview, v).verdict).toBe("pass");
});

test("resolveOutcomeOk soft path ignores LLM review pass", () => {
  expect(resolveOutcomeOk({
    soft: true,
    reviewPass: true,
    corrected: false,
    oracle: { ok: false, markers: { zpdFail: false, zpdPass: false, structuralMiss: true, laziness: false }, evidence: "x" },
  })).toBe(false);
  expect(resolveOutcomeOk({
    soft: true,
    reviewPass: false,
    corrected: false,
    oracle: { ok: true, markers: { zpdFail: false, zpdPass: false, structuralMiss: false, laziness: false }, evidence: "x" },
  })).toBe(true);
});

test("resolveReviewFailForPe does not double-count soft oracle", () => {
  expect(resolveReviewFailForPe({
    soft: true,
    reviewPass: false,
    corrected: false,
    oracleOk: false,
  })).toBe(false);
  expect(resolveReviewFailForPe({
    soft: false,
    reviewPass: false,
    corrected: false,
    oracleOk: null,
  })).toBe(true);
});
