import { expect, test } from "bun:test";
import { applyTwoLayerVerify, runDeterministicLayer } from "./twoLayerVerify.ts";

test("deterministic layer catches missing write", () => {
  const fails = runDeterministicLayer({
    latest: "Write hello.txt with hi",
    evidence: "thinking about writing",
  });
  expect(fails.some((f) => f.code === "missing_artifact")).toBe(true);
});

test("semantic pass cannot override deterministic fail", () => {
  const result = applyTwoLayerVerify({
    semantic: {
      verdict: "pass",
      summary: "done",
      achieved: true,
    },
    latest: "Create out/data.json",
    evidence: "planned the file",
  });
  expect(result.detOk).toBe(false);
  expect(result.review.verdict).toBe("fail");
  expect(result.line).toContain("verify_layer:");
  expect(result.line).toContain("det=0");
});

test("both layers pass when evidence shows write", () => {
  const result = applyTwoLayerVerify({
    semantic: { verdict: "pass", summary: "wrote file", achieved: true },
    latest: "Write note.txt",
    evidence: "fs_write note.txt\nwrote note.txt\nexit 0",
  });
  expect(result.detOk).toBe(true);
  expect(result.semOk).toBe(true);
  expect(result.review.verdict).toBe("pass");
});
